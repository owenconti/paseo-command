import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, it } from "node:test";
import type { WebSocket } from "ws";
import { Channel } from "./channel";
import {
  MAX_VIEWS,
  stopWatches,
  tell,
  unwatch,
  unwatchSid,
  watch,
  watchFits,
  watchOf,
  watchedTimelines,
  type SessionSource,
} from "./sessions";
import { socketChannel, stopStream } from "./stream";
import { LIVE } from "./tuning";

type Sent = { event: string; data: Record<string, unknown> };
/** What a session message carries to one view. */
type View = { sid: unknown; event: unknown; data: Record<string, unknown> };

/** A channel that keeps what it's sent; multiplexed (a socket) unless told it's SSE. */
class FakeChannel extends Channel {
  readonly multiplexed: boolean;
  sent: Sent[] = [];
  constructor(multiplexed = true) {
    super(false);
    this.multiplexed = multiplexed;
  }
  protected encode(event: string, data: unknown) {
    return JSON.stringify({ event, data });
  }
  protected write(text: string) {
    this.sent.push(JSON.parse(text));
  }
  buffered() {
    return 0;
  }
  protected end() {}
  /** The session messages sent since last asked, per view. */
  take(): View[] {
    const out = this.sent
      .filter((m) => m.event === "session")
      .map((m) => m.data as View);
    this.sent = [];
    return out;
  }
}

/** A session whose host never answers: no daemon is contacted, and its watch keeps connecting. */
const source = (agentId: string, hostKey = "local"): SessionSource => ({
  hostKey,
  agentId,
  resolve: () => new Promise(() => {}),
  detail: () => ({}),
});
const sidsOf = (views: View[]) => views.map((v) => v.sid);

afterEach(() => {
  stopStream();
  stopWatches();
});

describe("a channel's views of one session", () => {
  it("sends every message to each view", () => {
    const c = new FakeChannel();
    watch(c, source("a1"), "s1");
    watch(c, source("a1"), "s2");
    c.take();
    assert.deepEqual(watchedTimelines(), ["local|a1"]);
    assert.equal(c.watches.size, 1);
    tell(watchOf("local|a1")!, "detail", { Title: "Fix it" });
    const views = c.take();
    assert.deepEqual(sidsOf(views), ["s1", "s2"]);
    assert.ok(views.every((v) => v.event === "detail" && v.data.Title === "Fix it"));
    assert.equal(views[0].data.rev, views[1].data.rev);
  });

  it("starts a joining view from what is held, and sends the others nothing again", () => {
    const c = new FakeChannel();
    watch(c, source("a1"), "s1");
    watch(c, source("a1"), "s2");
    const w = watchOf("local|a1")!;
    // As a read leaves it: one row, a header, live.
    const row = { id: "i1", seq: 1, kind: "message", text: "hi" };
    w.items = new Map([["i1", JSON.stringify(row)]]);
    w.order = ["i1"];
    w.epoch = "e1";
    w.from = w.to = 1;
    w.detail = JSON.stringify({ Title: "Fix it" });
    w.live = true;
    w.error = "";
    c.take();
    watch(c, source("a1"), "s3");
    const views = c.take();
    assert.deepEqual(sidsOf(views), ["s3", "s3", "s3"]);
    assert.deepEqual(
      views.map((v) => v.event),
      ["timeline", "detail", "state"],
    );
    assert.equal(views[0].data.reset, true);
    assert.equal(views[0].data.epoch, "e1");
    assert.deepEqual(views[0].data.items, [row]);
    assert.equal(views[2].data.live, true);
    assert.deepEqual([...w.sids.get(c)!], ["s1", "s2", "s3"]);
    tell(w, "state", { live: true });
    assert.deepEqual(sidsOf(c.take()), ["s1", "s2", "s3"]);
  });

  it("keeps the watch while any view is left, and stops it with the last", () => {
    const c = new FakeChannel();
    watch(c, source("a1"), "s1");
    watch(c, source("a1"), "s2");
    const w = watchOf("local|a1")!;
    unwatchSid(c, "s1");
    assert.deepEqual(watchedTimelines(), ["local|a1"]);
    assert.equal(c.watches.get("local|a1"), w);
    c.take();
    tell(w, "detail", { Title: "Fix it" });
    assert.deepEqual(sidsOf(c.take()), ["s2"]);
    unwatchSid(c, "s1");
    assert.deepEqual(watchedTimelines(), ["local|a1"]);
    unwatchSid(c, "s2");
    assert.deepEqual(watchedTimelines(), []);
    assert.equal(c.watches.size, 0);
    assert.equal(w.stopped, true);
  });

  it("drops all of a closing channel's views; another channel's stay", () => {
    const a = new FakeChannel();
    const b = new FakeChannel();
    watch(a, source("a1"), "s1");
    watch(a, source("a1"), "s2");
    watch(b, source("a1"), "t1");
    const w = watchOf("local|a1")!;
    assert.deepEqual(sidsOf(b.take()), ["t1"]);
    a.close();
    assert.equal(a.watches.size, 0);
    assert.equal(w.sids.has(a), false);
    assert.deepEqual(watchedTimelines(), ["local|a1"]);
    a.take();
    tell(w, "detail", { Title: "Fix it" });
    assert.deepEqual(a.take(), []);
    assert.deepEqual(sidsOf(b.take()), ["t1"]);
    unwatch(b, "local|a1");
    assert.deepEqual(watchedTimelines(), []);
    assert.equal(w.stopped, true);
  });

  it("keeps channels' views apart", () => {
    const a = new FakeChannel();
    const b = new FakeChannel();
    watch(a, source("a1"), "s1");
    watch(b, source("a1"), "s1");
    watch(b, source("a2"), "s2");
    a.take();
    b.take();
    // The same id on another channel is another view.
    unwatchSid(b, "s1");
    tell(watchOf("local|a1")!, "detail", { Title: "One" });
    assert.deepEqual(sidsOf(a.take()), ["s1"]);
    assert.deepEqual(b.take(), []);
    tell(watchOf("local|a2")!, "detail", { Title: "Two" });
    assert.deepEqual(a.take(), []);
    assert.deepEqual(sidsOf(b.take()), ["s2"]);
    assert.deepEqual(watchedTimelines().sort(), ["local|a1", "local|a2"]);
  });

  it("treats a renamed view as a new subscription", () => {
    const c = new FakeChannel();
    watch(c, source("a1"), "s1");
    const first = watchOf("local|a1")!;
    // The same id for another agent leaves the first, its only view.
    watch(c, source("a2"), "s1");
    assert.equal(first.stopped, true);
    assert.deepEqual(watchedTimelines(), ["local|a2"]);
    assert.deepEqual([...c.watches.keys()], ["local|a2"]);
    // Asked again for the same agent beside another view: it joins once more.
    watch(c, source("a2"), "s2");
    c.take();
    watch(c, source("a2"), "s1");
    assert.deepEqual(sidsOf(c.take()), ["s1"]);
    assert.deepEqual([...watchOf("local|a2")!.sids.get(c)!].sort(), ["s1", "s2"]);
  });

  it("caps the views of a session and the sessions of a channel", () => {
    const c = new FakeChannel();
    for (let i = 0; i < MAX_VIEWS; i++) watch(c, source("a0"), `v${i}`);
    assert.equal(watchFits(c, source("a0"), "more"), false);
    assert.equal(watchFits(c, source("a0"), "v0"), true);
    for (let i = 1; i < LIVE.maxWatches; i++) watch(c, source(`a${i}`), `s${i}`);
    assert.equal(c.watches.size, LIVE.maxWatches);
    assert.equal(watchFits(c, source("other"), "x"), false);
    // A new view of a session already watched adds no session.
    assert.equal(watchFits(c, source("a1"), "x"), true);
  });

  it("serves an SSE channel its one session, unaddressed", () => {
    const sse = new FakeChannel(false);
    const tab = new FakeChannel();
    watch(sse, source("a1"));
    watch(tab, source("a1"), "s1");
    // The first viewer: nothing is held to resend.
    assert.equal(sse.sent.length, 0);
    assert.deepEqual(sidsOf(tab.take()), ["s1"]);
    tell(watchOf("local|a1")!, "detail", { Title: "Fix it" });
    assert.equal(sse.sent.length, 1);
    assert.equal(sse.sent[0].event, "detail");
    assert.equal(sse.sent[0].data.Title, "Fix it");
    assert.deepEqual(sidsOf(tab.take()), ["s1"]);
    sse.close();
    assert.deepEqual(watchedTimelines(), ["local|a1"]);
  });
});

/** A WebSocket the test drives: it is told what the tab asks and keeps what it's sent. */
class FakeSocket extends EventEmitter {
  sent: Sent[] = [];
  bufferedAmount = 0;
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {}
  terminate() {}
  ask(msg: object) {
    this.emit("message", JSON.stringify(msg));
  }
  take(): View[] {
    const out = this.sent
      .filter((m) => m.event === "session")
      .map((m) => m.data as View);
    this.sent = [];
    return out;
  }
}

describe("a tab's socket", () => {
  it("watches one agent under several ids, within the cap", () => {
    const ws = new FakeSocket();
    socketChannel(ws as unknown as WebSocket, (msg) => source(String(msg.agentId)));
    for (let i = 1; i <= MAX_VIEWS; i++)
      ws.ask({ type: "watch", sid: `s${i}`, agentId: "a1" });
    assert.deepEqual(watchedTimelines(), ["local|a1"]);
    const w = watchOf("local|a1")!;
    assert.equal(w.sids.size, 1);
    assert.equal([...w.sids.values()][0].size, MAX_VIEWS);
    ws.take();
    ws.ask({ type: "watch", sid: "extra", agentId: "a1" });
    const [refused] = ws.take();
    assert.equal(refused.sid, "extra");
    assert.deepEqual(refused.data, {
      live: false,
      error: "Too many open sessions.",
      refused: true,
    });
    ws.ask({ type: "unwatch", sid: "s1" });
    tell(w, "detail", { Title: "Fix it" });
    assert.deepEqual(
      sidsOf(ws.take()),
      Array.from({ length: MAX_VIEWS - 1 }, (_, i) => `s${i + 2}`),
    );
    ws.emit("close");
    assert.deepEqual(watchedTimelines(), []);
  });
});
