/** Reading a watched session's timeline tail and sending what changed. */
import { TUNING } from "../fleet";
import { timelineWindow, type WindowItem } from "../daemon";
import {
  MISSING_CWD,
  missingCwd,
  within,
  type LiveClient,
  type TimelinePage,
} from "./client";
import { feedOf } from "./hub";
import { detailFromFeed, pushDetail, tell, type Watch } from "./sessions";
import { LIVE } from "./tuning";

const TIMELINE_CHUNK_BYTES = 512 * 1024;

/** Re-read the tail and send what changed. Only the newest read publishes. */
export async function fetchTimeline(w: Watch, client: LiveClient) {
  const s = w.source;
  const seq = ++w.seq;
  const feed = feedOf(s.hostKey);
  const req = feed ? feed.issue() : 0;
  let t: TimelinePage | undefined;
  try {
    t = await within(
      client.fetchAgentTimeline(s.agentId, {
        direction: "tail",
        limit: LIVE.timelineLimit,
        projection: "canonical",
      }),
      TUNING.sdkReadMs,
      "The timeline",
      client,
    );
  } catch (error) {
    if (!missingCwd(error)) throw error;
    // A deleted worktree: nothing to read, and nothing will change.
    if (seq !== w.seq || w.stopped) return;
    if (w.unavailable !== MISSING_CWD) {
      w.unavailable = MISSING_CWD;
      w.items = new Map();
      w.order = [];
      w.sent = new Map();
      w.epoch = undefined;
      tell(w, "timeline", {
        reset: true,
        items: [],
        unavailable: MISSING_CWD,
        from: 0,
        to: 0,
        hasOlder: false,
      });
    }
    return;
  }
  if (seq !== w.seq || w.stopped) return;
  if (t?.agent) {
    // The header follows the feed's ordered store; the answer's own record
    // only fills in agents the feed doesn't push, in request order.
    if (feed?.state === "live") {
      feed.offer(t.agent, req);
      detailFromFeed(w);
    } else if (seq > w.detailSeq) {
      w.detailSeq = seq;
      pushDetail(w, s.detail(t.agent));
    }
  }
  // The newest rows within the byte budget (plus earlier rows updated
  // since), and the daemon range they certify.
  const win = timelineWindow(t);
  const reset = win.epoch !== w.epoch || Boolean(w.unavailable);
  if (w.epoch !== undefined && win.epoch !== w.epoch) w.source.epochChanged?.();
  w.epoch = win.epoch;
  w.unavailable = undefined;
  const changed =
    win.hasOlder !== w.hasOlder || win.from !== w.from || win.to !== w.to;
  w.hasOlder = win.hasOlder;
  w.from = win.from;
  w.to = win.to;
  const json = (i: WindowItem) => JSON.stringify(i);
  const range = {
    epoch: win.epoch,
    from: win.from,
    to: win.to,
    hasOlder: win.hasOlder,
  };
  if (reset) {
    w.items = new Map(win.items.map((i) => [i.id, json(i)]));
    w.order = win.items.map((i) => i.id);
    w.sent = new Map(w.items);
    for (const msg of chunks(win.items, (items, i, n) => ({
      ...range,
      items,
      reset: true,
      part: i,
      parts: n,
    })))
      tell(w, "timeline", msg);
    return;
  }
  // Every row a viewer may hold gets its update, not only the window's: an
  // early tool that just finished is outside the newest rows but still on
  // screen. Rows the daemon no longer has go; rows that only left the
  // window stay with the viewers.
  const pageIds = new Set(win.page.map((i) => i.id));
  const upsert = [
    ...win.items.filter((i) => w.sent.get(i.id) !== json(i)),
    ...win.page.filter(
      (i) =>
        !w.items.has(i.id) && w.sent.has(i.id) && w.sent.get(i.id) !== json(i),
    ),
  ];
  // A row missing from the page is gone only if the page covers where it
  // sits: one that fell off the daemon's page (row count) or our window
  // (bytes) is history the viewers keep.
  const pageFrom = win.pageFrom;
  const remove = [...w.sent.entries()]
    .filter(([id, row]) => !pageIds.has(id) && JSON.parse(row).seq >= pageFrom)
    .map(([id]) => id);
  w.items = new Map(win.items.map((i) => [i.id, json(i)]));
  w.order = win.items.map((i) => i.id);
  for (const i of upsert) w.sent.set(i.id, json(i));
  for (const id of [...w.sent.keys()]) if (!pageIds.has(id)) w.sent.delete(id);
  if (!upsert.length && !remove.length && !changed) return;
  for (const msg of chunks(upsert, (items, i) => ({
    ...range,
    upsert: items,
    remove: i === 0 ? remove : [],
  })))
    tell(w, "timeline", msg);
}

/**
 * Split rows into messages of at most the byte budget each (one row may be
 * alone in its message), so no single message nears a channel's cap.
 */
export function chunks<M>(
  items: WindowItem[],
  make: (items: WindowItem[], index: number, count: number) => M,
) {
  const batches: WindowItem[][] = [];
  let batch: WindowItem[] = [];
  let size = 0;
  for (const i of items) {
    const n = Buffer.byteLength(JSON.stringify(i));
    if (batch.length && size + n > TIMELINE_CHUNK_BYTES) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(i);
    size += n;
  }
  batches.push(batch);
  // A reset in parts is applied by the viewer once its last part arrives.
  return batches.map((b, i) => make(b, i, batches.length));
}
