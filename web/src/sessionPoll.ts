/**
 * The session view polls two things: the agent record (header, approvals)
 * and the conversation. Each runs its own loop, on its own timer, with its
 * own error, so a slow or failing one never delays or clears the other.
 */
import { errorMessage } from "./api";
import type { SessionHandlers } from "./live";
import {
  applyComplete,
  applyUpdate,
  changesCursor,
  emptyHistory,
  hasOlder as hasOlderRows,
  nextCursor,
  rowsOf,
  ticket,
  type HistoryItem,
  type HistoryPage,
  type Ticket,
} from "./history";

export type Stream<T> = {
  fetch: (signal: AbortSignal) => Promise<T>;
  /** A fresh answer; the stream's error is cleared. */
  apply: (value: T) => void;
  /** This stream's error; "" clears it. Never touches the other stream's. */
  error: (message: string) => void;
};

/** Each stream polls on its own loop, whatever the type of its value. */
export function pollSession<T extends unknown[]>(
  streams: { [K in keyof T]: Stream<T[K]> },
  options: {
    /** Delay before the next poll of a stream, read when it's scheduled. */
    interval: () => number;
    signal: AbortSignal;
    schedule?: (fn: () => void, ms: number) => unknown;
    /** Called with a handle `schedule` returned. */
    cancel?: (handle: unknown) => void;
  },
) {
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel =
    options.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const handles = new Set<unknown>();
  const loop = async <V>(stream: Stream<V>) => {
    try {
      const value = await stream.fetch(options.signal);
      if (options.signal.aborted) return;
      stream.apply(value);
      stream.error("");
    } catch (e) {
      if (options.signal.aborted) return;
      stream.error(errorMessage(e) || "Request failed");
    }
    const handle = schedule(() => {
      handles.delete(handle);
      void loop(stream);
    }, options.interval());
    handles.add(handle);
  };
  for (const stream of streams) void loop(stream);
  options.signal.addEventListener("abort", () => {
    for (const h of handles) cancel(h);
    handles.clear();
  });
}

/**
 * The session, pushed over the tab's live connection (src/live.ts), which
 * sends the header and the conversation as they change. While it is live
 * nothing polls; when the connection drops, or the server can't watch the
 * agent, the streams above poll slowly as a fallback, each on its own loop,
 * until pushes resume. Aborting unsubscribes and stops everything.
 *
 * The conversation is held as a History (src/history.ts): pushed resets
 * and updates, fallback reads and older pages all go through its one
 * reconciliation, so none can drop what another brought. What a reconnect
 * or a burst left out is repaired on its own (REPAIR): changes missed are
 * read from the daemon's change feed, gaps by paging, in paced batches that
 * continue until nothing is missing, back off on errors, and stop with the
 * session. Only the open session is watched, so only it repairs.
 */
/** Repair pacing (tests shorten it). */
export const REPAIR = {
  batch: 20,
  pauseMs: 250,
  hiddenPauseMs: 5000,
  retryMs: 1000,
  retryMaxMs: 30000,
};

/** A message pushed for a watched session (detail, timeline or state). */
type SessionMessage = HistoryPage & {
  /** The watch's message number. */
  rev?: number;
  /** A reset split into parts. */
  part?: number;
  parts?: number;
  upsert?: HistoryItem[];
  remove?: string[];
  live?: boolean;
  [key: string]: unknown;
};

export function watchSession<D>(
  streams: {
    detail: Stream<D>;
    conversation: Omit<Stream<HistoryPage>, "apply"> & {
      /** Not called: fallback reads land in the history (`timeline`). */
      apply?: unknown;
    };
  },
  options: {
    /** Subscribe over the live connection; returns how to stop. */
    subscribe: (h: SessionHandlers) => () => void;
    /** Fallback poll delay, read when each poll is scheduled. */
    interval: () => number;
    signal: AbortSignal;
    /**
     * The conversation, in order, after any change; whether older rows (or
     * a gap) remain to be read.
     */
    timeline: (
      items: HistoryItem[],
      unavailable?: string,
      hasOlder?: boolean,
    ) => void;
    /**
     * Read the page before `before` (a daemon sequence) in `epoch`, or the
     * changes after `after`.
     */
    older?: (cursor: {
      epoch: string;
      before?: number;
      after?: number;
      until?: number;
    }) => Promise<HistoryPage>;
    /** Whether the tab is hidden (repair goes slower). */
    hidden?: () => boolean;
  },
) {
  let fallback: AbortController | undefined;
  const history = emptyHistory();
  let rev = -1;
  /** A reset arriving in parts, applied once whole. */
  let parts: SessionMessage[] = [];
  const emit = () => {
    options.timeline(
      rowsOf(history),
      history.unavailable,
      hasOlderRows(history),
    );
    void repair();
  };
  // Fallback reads land in the same history as everything else, with the
  // generation they were asked in: one answered after a rewind can't undo it.
  const conversation: Stream<{ page: HistoryPage; issued: Ticket }> = {
    fetch: (signal) => {
      const issued = ticket(history);
      // A fallback read is a tail: the newest rows, and earlier ones changed since.
      return streams.conversation.fetch(signal).then((page: HistoryPage) => ({
        page: { ...page, tail: true },
        issued,
      }));
    },
    apply: ({ page, issued }) => {
      applyComplete(history, page, issued);
      emit();
    },
    error: streams.conversation.error,
  };
  const startFallback = () => {
    if (fallback || options.signal.aborted) return;
    fallback = new AbortController();
    pollSession([streams.detail, conversation], {
      interval: options.interval,
      signal: fallback.signal,
    });
  };
  const stopFallback = () => {
    fallback?.abort();
    fallback = undefined;
  };
  // Something to show at once, whatever the connection does.
  startFallback();
  const stop = options.subscribe({
    down: (down) => {
      if (down) startFallback();
      // A reconnect re-asks for the session; its reset comes as events.
      else {
        rev = -1;
        parts = [];
      }
    },
    event: (event, raw) => {
      if (options.signal.aborted) return;
      // The server's JSON, as it sends it for these events.
      const data = (raw ?? {}) as SessionMessage;
      // One watch numbers its messages; a repeat or older one is dropped.
      if (typeof data?.rev === "number") {
        if (data.rev <= rev && !data.reset) return;
        rev = Math.max(rev, data.rev);
      }
      if (event === "detail") {
        // Data from the stream supersedes any poll in flight.
        stopFallback();
        const { rev: _r, ...detail } = data;
        streams.detail.apply(detail as D);
        streams.detail.error("");
      } else if (event === "timeline") {
        stopFallback();
        if (data?.reset) {
          if (!data.part) parts = [];
          parts.push(data);
          if ((data.part ?? 0) < (data.parts ?? 1) - 1) return;
          const whole = { ...data, items: parts.flatMap((p) => p.items ?? []) };
          parts = [];
          applyComplete(history, whole);
        } else applyUpdate(history, data);
        emit();
        streams.conversation.error("");
      } else if (event === "state") {
        if (data.live) stopFallback();
        else startFallback();
      }
    },
  });
  options.signal.addEventListener("abort", () => {
    stop();
    stopFallback();
    clearTimeout(resume);
  });

  let loading: Promise<void> | undefined;
  /** One read, applied; it must move its cursor on. */
  const read = (
    cursor: { epoch: string; before?: number; after?: number; until?: number },
    moved: () => boolean,
  ): Promise<void> => {
    if (loading) return loading;
    if (!options.older) return Promise.resolve();
    const issued = ticket(history);
    return (loading = options
      .older(cursor)
      .then((page) => {
        if (options.signal.aborted) return;
        applyComplete(history, page, issued);
        if (!moved())
          throw new Error("The earlier conversation couldn't be read.");
      })
      .finally(() => {
        loading = undefined;
        if (!options.signal.aborted) emit();
      }));
  };
  /** One page before the oldest range held (or into the highest gap). */
  const loadOlder = (): Promise<void> => {
    if (loading) return loading;
    const cursor = nextCursor(history);
    if (!cursor) return Promise.resolve();
    return read({ epoch: cursor.epoch, before: cursor.before }, () => {
      const next = nextCursor(history);
      return (
        !next || next.epoch !== cursor.epoch || next.before !== cursor.before
      );
    });
  };
  /** One page of the changes missed (I6). */
  const loadChanges = (): Promise<void> => {
    if (loading) return loading;
    const cursor = changesCursor(history);
    if (!cursor) return Promise.resolve();
    return read(cursor, () => {
      const next = changesCursor(history);
      return (
        !next || next.epoch !== cursor.epoch || next.after !== cursor.after
      );
    });
  };
  // Repair: missed changes first (what is shown may be out of date), then
  // gaps. Batches are bounded and paced; another follows while anything is
  // missing, sooner on progress, later after errors.
  const missing = () =>
    Boolean(
      options.older && (changesCursor(history) || nextCursor(history)?.gap),
    );
  let repairing = false;
  let resume: ReturnType<typeof setTimeout> | undefined;
  let backoff = REPAIR.retryMs;
  const later = (ms: number) => {
    if (resume !== undefined || options.signal.aborted) return;
    resume = setTimeout(() => {
      resume = undefined;
      void repair();
    }, ms);
  };
  const repair = async () => {
    if (
      repairing ||
      resume !== undefined ||
      options.signal.aborted ||
      !missing()
    )
      return;
    repairing = true;
    try {
      for (
        let i = 0;
        i < REPAIR.batch && missing() && !options.signal.aborted;
        i++
      )
        await (changesCursor(history) ? loadChanges() : loadOlder());
      backoff = REPAIR.retryMs;
      if (missing())
        later(options.hidden?.() ? REPAIR.hiddenPauseMs : REPAIR.pauseMs);
    } catch {
      // Shown as it is meanwhile; tried again later, less often each time.
      later(backoff);
      backoff = Math.min(backoff * 2, REPAIR.retryMaxMs);
    } finally {
      repairing = false;
    }
  };
  return { loadOlder, history };
}

/** Apply a timeline message: a reset, or upserts/removals with the new order. */
export function mergeTimeline(
  items: HistoryItem[],
  msg: SessionMessage & { order?: string[] },
): HistoryItem[] {
  if (msg?.reset) return Array.isArray(msg.items) ? msg.items : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of msg?.remove ?? []) byId.delete(id);
  for (const i of msg?.upsert ?? []) byId.set(i.id, i);
  const order: string[] = Array.isArray(msg?.order)
    ? msg.order
    : [...byId.keys()];
  return order
    .map((id) => byId.get(id))
    .filter((i): i is HistoryItem => Boolean(i));
}
