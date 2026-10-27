/**
 * A session's conversation as the browser holds it: one merge for every
 * source (pushed resets and updates, fallback reads, older pages), in
 * whatever order they arrive.
 *
 * What the daemon guarantees (its timeline store): within an epoch every row
 * keeps its position (`seq`, its first sequence) and every change to it
 * raises its version (`last`, its latest sequence) past every sequence
 * before; a new row's position is past every sequence before it. A rewind
 * starts a new epoch.
 *
 * The merge is a join over those facts, so the state after any set of
 * answers is the same whatever order they arrived in:
 *
 *  I1 Versions only rise. A row is replaced only by a copy with a higher
 *     `last`; a duplicate or older copy changes nothing.
 *  I2 Deletions are versioned. Dropping a row leaves a tombstone at the
 *     version it was dropped as of; a copy at or below it can't bring the
 *     row back, a genuinely newer one can.
 *  I3 Absence proves deletion only within what an answer saw. A complete
 *     answer for [from, to] drops a held row positioned in that range only
 *     if the held copy is no newer than `to` (a row changed after the
 *     answer was read is not the answer's to judge). It also certifies the
 *     absence of every row it doesn't list, held or not: positions keep the
 *     highest `to` that certified them, and a copy of a row not held there
 *     at or below it is older than that answer (a delayed page can't bring
 *     back a row a newer answer showed gone; a re-created row, newer, can).
 *  I4 Coverage is what complete answers certified, unioned within an
 *     epoch; gaps between ranges are what paging reads next, by daemon
 *     position, never by what renders. (Absence certifications, I3, only
 *     rise; coverage says which positions are held as of when they were
 *     read, and I6 says how current that is.)
 *  I5 Epochs are a generation. Each request is issued with the history's
 *     generation; an answer for a different epoch replaces everything only
 *     if nothing moved the history on since that request was issued, and an
 *     epoch once left (retired) never comes back. Pushed resets are the
 *     server's current state and always replace a different epoch. Being
 *     unavailable (a host that may not be contacted, a missing working
 *     directory) is not an epoch: it is shown alongside what is held, and
 *     the next answer in the same epoch picks up from there.
 *  I6 Changes are known through a sequence (`through`): every change at
 *     or before it, to any row, is held. Only answers that carry every
 *     change in a range move it: pushed updates and tails (a window holds
 *     its rows and every earlier row changed since its `from`) and change
 *     pages (every entry changed after a cursor, up to their `to`). One
 *     that joins on (`from` at most one past `through`) carries it forward;
 *     one that starts beyond it (a reconnect after more happened than a
 *     window holds, or a burst of changes while connected) is known only
 *     for its own range (`chain`), and the changes between are read from
 *     the daemon's change feed, after `through`, until they join. Older
 *     pages never move it; nothing is inferred from a burst. Nothing held
 *     is given up meanwhile: what is shown is current as of `through`, and
 *     the change feed brings only what changed, not what is held.
 *  I7 Every answer is as of a read (`asOf`, the daemon's head then; a page
 *     may be served late, or shared from a cache). The changes known are
 *     unbroken from `since` to `through`, and every row held was read at or
 *     after `since - 1`. What a read older than that brings (rows not held,
 *     coverage, absences) is only as current as the read: `through` falls
 *     back to it, and the changes after it are read from the feed like any
 *     others (what was known beyond is kept as the chain to join). Fresh
 *     reads are never that old; late or cached ones can be.
 *
 * Equal versions are taken to be equal content: the daemon raises a row's
 * version with every change, so two copies at one version are one copy.
 */
export type HistoryItem = {
  id: string;
  seq?: number;
  last?: number;
  [k: string]: unknown;
};
export type HistoryPage = {
  epoch?: string;
  from?: number;
  to?: number;
  items?: HistoryItem[];
  hasOlder?: boolean;
  /**
   * The newest rows, with earlier rows changed since `from` (pushed resets,
   * fallback reads, stale-cursor answers), not an older page (I6).
   */
  tail?: boolean;
  /**
   * A change page (I6): every entry changed after this sequence, through
   * `to` (and complete for the rows positioned in `from`..`to`).
   */
  after?: number;
  /** The daemon could no longer list changes after the cursor: start over. */
  changesLost?: boolean;
  /** The daemon answered another epoch's tail (a stale cursor). */
  reset?: boolean;
  staleCursor?: boolean;
  unavailable?: string;
  /** Served from what the server holds for a host it may not contact. */
  stale?: boolean;
  /** I7: the daemon's head when this was read (`to` if not given). */
  asOf?: number;
};
export type History = {
  epoch?: string;
  /** Bumped whenever the epoch is replaced (I5). */
  generation: number;
  retired: Set<string>;
  rows: Map<string, HistoryItem>;
  /** Versioned deletions (I2). */
  tombstones: Map<string, number>;
  /** Covered ranges, sorted and disjoint (I4). */
  ranges: [number, number][];
  /** [from, to, asOf]: the newest complete answer certifying each position (I3). */
  certified: [number, number, number][];
  /** I6: every change up to this sequence is held (-1: none yet). */
  through: number;
  /** I6: a range of changes known beyond `through`, not yet joined to it. */
  chain?: [number, number];
  /** I7: where the changes known up to `through` start. */
  since: number;
  /** The conversation's start is held. */
  start: boolean;
  unavailable?: string;
  /** The last complete answer was held data for an unreachable host. */
  stale: boolean;
};
/** What a request was issued against (I5). */
export type Ticket = { generation: number; epoch?: string };

export const emptyHistory = (): History => ({
  generation: 0,
  retired: new Set(),
  rows: new Map(),
  tombstones: new Map(),
  ranges: [],
  certified: [],
  through: -1,
  since: 0,
  start: false,
  stale: false,
});
/** Take before asking for an answer; pass with it when it arrives. */
export const ticket = (h: History): Ticket => ({
  generation: h.generation,
  epoch: h.epoch,
});

const seqOf = (i: HistoryItem) =>
  typeof i.seq === "number" ? i.seq : parseInt(String(i.id), 10) || 0;
const lastOf = (i: HistoryItem) =>
  typeof i.last === "number" ? i.last : seqOf(i);

function cover(h: History, from: number, to: number) {
  if (!(to >= from)) return;
  const ranges = [...h.ranges, [from, to] as [number, number]].sort(
    (a, b) => a[0] - b[0],
  );
  const out: [number, number][] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  h.ranges = out;
}

/** I3: raise the certification of [from, to] to `asOf`. */
function certify(h: History, from: number, to: number, asOf: number) {
  if (!(to >= from)) return;
  const out: [number, number, number][] = [];
  let next = from;
  for (const [a, b, v] of h.certified) {
    if (b < from || a > to) {
      out.push([a, b, v]);
      continue;
    }
    if (a < from) out.push([a, from - 1, v]);
    if (next < a) out.push([next, a - 1, asOf]);
    out.push([Math.max(a, from), Math.min(b, to), Math.max(v, asOf)]);
    next = Math.min(b, to) + 1;
    if (b > to) out.push([to + 1, b, v]);
  }
  if (next <= to) out.push([next, to, asOf]);
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last[2] === r[2] && last[1] + 1 === r[0]) last[1] = r[1];
    else merged.push(r);
  }
  h.certified = merged;
}
/** I3: the newest complete answer's `to` covering position `seq` (-1: none). */
function certifiedAt(h: History, seq: number) {
  let lo = 0;
  let hi = h.certified.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b, v] = h.certified[mid];
    if (seq < a) hi = mid - 1;
    else if (seq > b) lo = mid + 1;
    else return v;
  }
  return -1;
}

/** I1 + I2 + I3: take a copy only if it is newer than what is held, dropped or certified absent. */
function offer(h: History, item: HistoryItem) {
  const v = lastOf(item);
  const held = h.rows.get(item.id);
  if (held && lastOf(held) >= v) return;
  const dropped = h.tombstones.get(item.id);
  if (dropped !== undefined && dropped >= v) return;
  if (!held && v <= certifiedAt(h, seqOf(item))) return;
  h.tombstones.delete(item.id);
  h.rows.set(item.id, item);
}
/** I7: what a read at `asOf` brings is current only as of it. */
function readAt(h: History, asOf: number) {
  if (h.through < 0 || asOf + 1 >= h.since) return;
  // What was known beyond stays to be joined (the newest, if both).
  if (!h.chain && h.through > asOf) h.chain = [h.since, h.through];
  h.through = Math.min(h.through, asOf);
  h.since = asOf + 1;
}
/** I2: drop a row as of version `asOf`, unless the held copy is newer. */
function drop(h: History, id: string, asOf: number) {
  const held = h.rows.get(id);
  if (held && lastOf(held) > asOf) return;
  h.rows.delete(id);
  h.tombstones.set(id, Math.max(asOf, h.tombstones.get(id) ?? -Infinity));
}

/** I5: start over in another epoch. */
function replace(h: History, epoch: string | undefined) {
  if (h.epoch !== undefined && h.epoch !== epoch) h.retired.add(h.epoch);
  h.epoch = epoch;
  h.generation++;
  h.rows = new Map();
  h.tombstones = new Map();
  h.ranges = [];
  h.certified = [];
  h.through = -1;
  h.chain = undefined;
  h.since = 0;
  h.start = false;
}

/** I6: every change in [from, to] is held. */
function know(h: History, from: number, to: number) {
  if (!(to >= from - 1)) return;
  if (h.through < 0) {
    h.through = to;
    h.since = from;
  } else if (from <= h.through + 1) h.through = Math.max(h.through, to);
  else if (h.chain && from <= h.chain[1] + 1 && to >= h.chain[0] - 1)
    h.chain = [Math.min(h.chain[0], from), Math.max(h.chain[1], to)];
  // Disjoint: the newest knowledge is kept; the feed reads the rest.
  else if (!h.chain || from > h.chain[1]) h.chain = [from, to];
  if (h.chain && h.through >= h.chain[0] - 1) {
    h.through = Math.max(h.through, h.chain[1]);
    h.chain = undefined;
  }
}

/**
 * A complete answer for its range: a pushed reset (no ticket), a fallback
 * read or a page (with the ticket it was requested with). Returns whether it
 * was applied.
 */
export function applyComplete(h: History, page: HistoryPage, issued?: Ticket) {
  const epoch = page.epoch;
  if (epoch !== undefined && h.retired.has(epoch)) return false;
  if (issued && issued.generation !== h.generation && epoch !== h.epoch)
    return false;
  if (page.unavailable) {
    if (issued && issued.generation !== h.generation) return false;
    // Not an epoch: what is held stays, and so does its epoch, unless the
    // answer names a different one.
    if (epoch !== undefined && epoch !== h.epoch) replace(h, epoch);
    h.unavailable = page.unavailable;
    h.stale = Boolean(page.stale);
    return true;
  }
  if (epoch !== h.epoch || page.changesLost) replace(h, epoch);
  h.unavailable = undefined;
  h.stale = Boolean(page.stale);
  const from = page.from ?? 0;
  const to = page.to ?? from;
  const items = page.items ?? [];
  const ids = new Set(items.map((i) => i.id));
  // I3: absence within the range, as of what the answer could see.
  for (const [id, row] of [...h.rows])
    if (
      !ids.has(id) &&
      seqOf(row) >= from &&
      seqOf(row) <= to &&
      lastOf(row) <= to
    )
      drop(h, id, to);
  for (const i of items) offer(h, i);
  // I7: what it brings (rows, coverage, absences) is only as of its read.
  readAt(h, page.asOf ?? to);
  certify(h, from, to, to);
  cover(h, from, to);
  // I6: tails and change pages carry every change in their range.
  if (page.after !== undefined) know(h, page.after + 1, to);
  else {
    if (!issued || page.tail || page.staleCursor || page.changesLost)
      know(h, from, to);
    if (!page.hasOlder && h.ranges[0]?.[0] === from) h.start = true;
  }
  return true;
}

/**
 * A pushed update: rows replaced wherever they are (if newer), ids dropped
 * as of the update's range end, the range covered.
 */
export function applyUpdate(
  h: History,
  msg: HistoryPage & { upsert?: HistoryItem[]; remove?: string[] },
) {
  if (msg.epoch !== undefined && msg.epoch !== h.epoch) return false;
  h.stale = false;
  h.unavailable = undefined;
  const asOf = msg.to ?? Math.max(0, ...(msg.upsert ?? []).map(lastOf));
  for (const id of msg.remove ?? []) drop(h, id, asOf);
  for (const i of msg.upsert ?? []) offer(h, i);
  if (msg.from !== undefined && msg.to !== undefined) {
    cover(h, msg.from, msg.to);
    know(h, msg.from, msg.to);
  }
  return true;
}

/** The rows in conversation order. */
export function rowsOf(h: History) {
  return [...h.rows.values()].sort(
    (a, b) => seqOf(a) - seqOf(b) || String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * Where to page next: the top of the highest gap first (so what is on
 * screen joins up), else before the oldest range. `undefined` when
 * everything back to the start is held.
 */
export function nextCursor(
  h: History,
): { epoch: string; before: number; gap: boolean } | undefined {
  if (!h.epoch || !h.ranges.length) return undefined;
  for (let i = h.ranges.length - 1; i > 0; i--)
    if (h.ranges[i][0] > h.ranges[i - 1][1] + 1)
      return { epoch: h.epoch, before: h.ranges[i][0], gap: true };
  if (h.start || h.ranges[0][0] <= 0) return undefined;
  return { epoch: h.epoch, before: h.ranges[0][0], gap: false };
}

/** I6: where the change feed reads next, while changes are missing. */
export function changesCursor(
  h: History,
): { epoch: string; after: number; until: number } | undefined {
  if (!h.epoch || !h.chain || h.through < 0) return undefined;
  // Up to what is already known: nothing held is read again.
  return { epoch: h.epoch, after: h.through, until: h.chain[0] - 1 };
}

/** Whether there are older rows (or a gap) still to read. */
export const hasOlder = (h: History) => nextCursor(h) !== undefined;
