import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LIVE_CLIENT, LiveConnection, type SocketLike } from "./live";

/** A socket the test drives: it opens at once and is told what the server sends. */
class FakeSocket implements SocketLike {
  readyState = 1;
  closed = false;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  push(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
}

const agent = (id: string, state: string) => ({ id, host: "", state, status: "running", title: id });
const reset = (rev: number, state = "running") => ({
  data: { agents: { local: [agent("a-1", state)] } },
  revs: { agents: { local: rev } },
  status: null,
  statusRev: 1,
});

/** A connection over fake sockets, whose reads answer `server`'s fleet, live once its first reset is in. */
async function withLive(
  test: (c: Awaited<ReturnType<typeof setup>>) => Promise<void> | void,
) {
  const c = await setup();
  try {
    await test(c);
  } finally {
    c.stop();
  }
}
async function setup() {
  const sockets: FakeSocket[] = [];
  const server = { rev: 1, state: "running", reads: 0 };
  const live = new LiveConnection({
    socket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    read: async (path): Promise<{ value: unknown; revs: Record<string, number> }> => {
      server.reads++;
      if (path === "status") return { value: null, revs: { "": 1 } };
      if (path === "agents") return { value: [agent("a-1", server.state)], revs: { local: server.rev } };
      return { value: [], revs: {} };
    },
    hidden: () => false,
  });
  const changes: string[] = [];
  const stop = live.subscribeFleet({ changed: (_s, _r, source) => changes.push(source) });
  // The read subscribing starts, settled before the test begins.
  await live.refresh();
  sockets[0].push("reset", reset(1));
  return { live, sockets, server, changes, stop };
}

describe("the live connection's quiet check", () => {
  it("leaves a quiet connection alone while reads agree with its pushes", () => withLive(async ({ live, sockets, server }) => {
    const reads = server.reads;
    const later = Date.now() + LIVE_CLIENT.quietMs + 1;
    assert.equal(await live.verify(later), false);
    assert.equal(server.reads, reads + 6, "it read the fleet once");
    assert.equal(sockets.length, 1, "and kept the connection");
    assert.equal(sockets[0].closed, false);
    assert.equal(live.diagnostics(later).reconnects, 0);
  }));

  it("doesn't check a connection that isn't quiet yet", () => withLive(async ({ live, server }) => {
    const reads = server.reads;
    assert.equal(await live.verify(Date.now() + LIVE_CLIENT.quietMs - 1000), false);
    assert.equal(server.reads, reads);
  }));

  it("connects again when a read has newer rows than the pushes brought", () => withLive(async ({ live, sockets, server }) => {
    // The daemon moved on, but the open socket stopped delivering its pushes.
    server.rev = 2;
    server.state = "idle";
    const later = Date.now() + LIVE_CLIENT.quietMs + 1;
    assert.equal(await live.verify(later), true);
    assert.equal(sockets[0].closed, true, "the silent socket is dropped");
    assert.equal(sockets.length, 2, "and a fresh one opened");
    assert.equal(live.connected, true, "without marking the fleet stale meanwhile");
    assert.equal(live.diagnostics(later).reconnects, 1);
    // The fresh connection's reset replaces everything; the silent one is ignored from now on.
    sockets[0].push("reset", reset(1, "running"));
    sockets[1].push("reset", reset(3, "idle"));
    assert.equal(live.state.groups.agents.get("local")?.rev, 3);
    // The fresh connection's messages show it works: no check until it's quiet in turn.
    const reads = server.reads;
    assert.equal(await live.verify(Date.now() + 1000), false);
    assert.equal(server.reads, reads);
  }));

  it("isn't fooled by a push that lands during its read", () => withLive(async ({ live, sockets, server }) => {
    server.rev = 2;
    const later = Date.now() + LIVE_CLIENT.quietMs + 1;
    const checking = live.verify(later);
    sockets[0].push("patch", { resource: "agents", host: "local", rev: 2, upsert: [agent("a-1", "idle")] });
    assert.equal(await checking, false);
    assert.equal(sockets.length, 1);
  }));

  it("says how the connection stands, for the app's diagnostics", () => withLive(({ live }) => {
    const d = live.diagnostics();
    assert.equal(d.live, true);
    assert.ok(d.sinceMessage >= 0 && d.sinceMessage < 1000);
  }));
});
