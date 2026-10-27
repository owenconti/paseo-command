/**
 * One versioning and merge discipline for everything the server holds from
 * the daemons. Pure; unit tested.
 *
 * Sequenced collections (agents, workspaces, projects) follow the daemon's
 * own directory sync: the daemon has a generation (a new one when it
 * restarts), and each collection numbers its changes across all sessions. An entity's version is the sequence of
 * its latest change; a removal leaves a tombstone at the removal's
 * sequence; a snapshot (or a delta read) carries the collection's head, a
 * watermark below which any packet is already reflected. So:
 *
 * - a packet at or below the entity's version (tombstone included) is old;
 * - a packet for an entity we don't hold, at or below the watermark, is old;
 * - versions and tombstones only ever go up;
 * - a snapshot at head H is authoritative only for entities whose version
 *   is at or below H; anything newer came from an event after it, and a
 *   snapshot older than the watermark is older than what is known: ignored;
 * - the watermark only moves with reads, never with events (events can
 *   skip numbers: the daemon numbers changes across all its sessions), so
 *   a delta read from it brings back anything an event didn't;
 * - a packet from another generation, or without a version, can't be
 *   ordered: it is rejected and a resync is asked for.
 *
 * Listings the daemon can't sequence (the archive) are ordered by when
 * they were requested: a read never overrides a value or a removal that
 * came from a read requested after it, and the latest full listing is a
 * watermark: a read requested before it can't add an entity it omitted.
 */

export type Seq = { generation?: string; seq?: number };
export type Outcome = {
  /** The packet was newer than what was held and has been applied. */
  accepted: boolean;
  /** What readers see changed. */
  changed: boolean;
  /** The packet couldn't be ordered; the collection should be re-read. */
  resync?: boolean;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export class Directory<T = unknown> {
  generation?: string;
  /**
   * The head of the latest read: everything at or below it is reflected.
   * Packets at or below it, for entities not held, are old; delta reads
   * resume from it.
   */
  watermark = 0;
  /** The highest sequence applied by anything. */
  head = 0;
  readonly entries = new Map<string, { value: T; seq: number }>();
  readonly tombstones = new Map<string, number>();

  private version(id: string) {
    return this.entries.get(id)?.seq ?? this.tombstones.get(id);
  }
  private orderable(v: Seq) {
    return (
      v.generation !== undefined &&
      v.seq !== undefined &&
      Number.isFinite(v.seq) &&
      v.generation === this.generation
    );
  }

  /** An upsert or removal pushed by the daemon. */
  event(
    kind: "upsert" | "remove",
    id: string,
    value: T | undefined,
    v: Seq,
  ): Outcome {
    if (!this.orderable(v))
      return { accepted: false, changed: false, resync: true };
    const seq = v.seq!;
    const held = this.version(id);
    if (seq <= (held ?? this.watermark))
      return { accepted: false, changed: false };
    this.head = Math.max(this.head, seq);
    if (kind === "remove") {
      const had = this.entries.delete(id);
      this.tombstones.set(id, seq);
      return { accepted: true, changed: had };
    }
    const prev = this.entries.get(id);
    this.tombstones.delete(id);
    this.entries.set(id, { value: value as T, seq });
    return { accepted: true, changed: !prev || !same(prev.value, value) };
  }

  /**
   * A full snapshot (`mode: "snapshot"`) or the changes after a cursor
   * (`mode: "changes"`, with removals), at the collection's head.
   * Returns the ids whose visible value changed.
   */
  read(r: {
    generation?: string;
    headSeq?: number;
    mode?: "snapshot" | "changes";
    items: { id: string; value: T; seq?: number }[];
    removals?: { id: string; seq: number }[];
  }): { changed: string[]; resync?: boolean } {
    const changed: string[] = [];
    if (r.generation === undefined || r.headSeq === undefined)
      return { changed, resync: true };
    const H = r.headSeq;
    if (r.generation !== this.generation) {
      // A restarted daemon (or the first read): start over from it.
      if (r.mode === "changes") return { changed, resync: true };
      const before = new Map(this.entries);
      this.entries.clear();
      this.tombstones.clear();
      this.generation = r.generation;
      this.watermark = this.head = H;
      for (const i of r.items)
        this.entries.set(i.id, { value: i.value, seq: i.seq ?? H });
      for (const id of new Set([...before.keys(), ...this.entries.keys()]))
        if (!same(before.get(id)?.value, this.entries.get(id)?.value))
          changed.push(id);
      return { changed };
    }
    // A whole snapshot from before what a read already confirmed.
    if (r.mode !== "changes" && H < this.watermark) return { changed };
    if (r.mode === "changes") {
      for (const i of r.items)
        if (
          this.event("upsert", i.id, i.value, {
            generation: r.generation,
            seq: i.seq ?? H,
          }).changed
        )
          changed.push(i.id);
      for (const x of r.removals ?? [])
        if (
          this.event("remove", x.id, undefined, {
            generation: r.generation,
            seq: x.seq,
          }).changed
        )
          changed.push(x.id);
    } else {
      const listed = new Map(r.items.map((i) => [i.id, i]));
      for (const id of new Set([
        ...this.entries.keys(),
        ...this.tombstones.keys(),
        ...listed.keys(),
      ])) {
        const held = this.version(id);
        // An event after this snapshot was taken knows better.
        if (held !== undefined && held > H) continue;
        const item = listed.get(id);
        const prev = this.entries.get(id);
        if (item) {
          this.tombstones.delete(id);
          this.entries.set(id, {
            value: item.value,
            seq: Math.max(item.seq ?? H, held ?? 0),
          });
          if (!prev || !same(prev.value, item.value)) changed.push(id);
        } else if (prev) {
          this.entries.delete(id);
          changed.push(id);
        }
      }
    }
    // Everything at or below the head is reflected: tombstones there are
    // covered by the watermark.
    this.watermark = Math.max(this.watermark, H);
    this.head = Math.max(this.head, H);
    for (const [id, seq] of [...this.tombstones])
      if (seq <= this.watermark) this.tombstones.delete(id);
    return { changed };
  }

  /** The cursor for a delta read: after the last read, never after an event. */
  cursor() {
    return this.generation === undefined
      ? {}
      : { generation: this.generation, afterSeq: this.watermark };
  }
  values() {
    return [...this.entries.values()].map((e) => e.value);
  }
  get(id: string) {
    return this.entries.get(id)?.value;
  }
}

/**
 * Values from reads the daemon can't sequence, ordered by when each read was
 * requested (`issue()` before asking). A whole listing replaces what it
 * covers; a single read (`one`) changes one entity. Neither overrides a
 * value or a removal from a read requested later.
 */
export class Listing<T = unknown> {
  private issued = 0;
  readonly entries = new Map<string, { value: T; req: number }>();
  private removed = new Map<string, number>();
  private listedAt = 0;
  /** Number the next read, before it is sent. */
  issue() {
    return ++this.issued;
  }
  private newer(id: string, req: number) {
    return (
      req > (this.entries.get(id)?.req ?? this.removed.get(id) ?? this.listedAt)
    );
  }
  /** A full listing requested as `req`. Returns the ids that changed. */
  listing(req: number, items: { id: string; value: T }[]) {
    const changed: string[] = [];
    if (req <= this.listedAt) return changed;
    const listed = new Set<string>();
    for (const { id, value } of items) {
      listed.add(id);
      if (!this.newer(id, req)) continue;
      const prev = this.entries.get(id);
      this.removed.delete(id);
      this.entries.set(id, { value, req });
      if (!prev || !same(prev.value, value)) changed.push(id);
    }
    for (const [id, e] of [...this.entries])
      if (!listed.has(id) && e.req < req) {
        this.entries.delete(id);
        this.removed.set(id, req);
        changed.push(id);
      }
    // From here this listing is the watermark; removals at or below it are
    // covered by it.
    this.listedAt = req;
    for (const [id, r] of [...this.removed])
      if (r <= req) this.removed.delete(id);
    return changed;
  }
  /** One entity read as `req` (`undefined`: it no longer exists). */
  one(req: number, id: string, value: T | undefined) {
    if (!this.newer(id, req)) return false;
    const prev = this.entries.get(id);
    if (value === undefined) {
      this.entries.delete(id);
      this.removed.set(id, req);
      return Boolean(prev);
    }
    this.removed.delete(id);
    this.entries.set(id, { value, req });
    return !prev || !same(prev.value, value);
  }
  /**
   * Take another listing's values as older than anything this one will
   * request (a feed replaced when its host moved: its request numbers mean
   * nothing here).
   */
  adopt(other: Listing<T>) {
    for (const [id, e] of other.entries)
      this.entries.set(id, { value: e.value, req: 0 });
  }
  /** Drop an entity as of now: no read requested before this can restore it. */
  forget(id: string) {
    return this.one(this.issue(), id, undefined);
  }
  values() {
    return [...this.entries.values()].map((e) => e.value);
  }
  get(id: string) {
    return this.entries.get(id)?.value;
  }
}

// ── Revisions of what is served ────────────────────────────────────────────
let counter = 0;
/** The next revision: one counter for everything that is versioned. */
export const nextRevision = () => ++counter;
export const lastRevision = () => counter;
export function resetRevisions() {
  counter = 0;
  stamps.clear();
}
const stamps = new Map<string, { json: string; rev: number }>();
/**
 * The revision of a view at the moment it is captured: a new one whenever
 * its content differs from the last capture of the same key. Captures
 * read the store as it is, so a later capture never holds older content,
 * and a reader can drop anything with a lower revision than it shows.
 */
export function stamp(key: string, content: unknown) {
  const json = JSON.stringify(content);
  const held = stamps.get(key);
  if (held && held.json === json) return held.rev;
  const rev = nextRevision();
  stamps.set(key, { json, rev });
  return rev;
}
