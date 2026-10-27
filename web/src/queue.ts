import { nativeEvents, postNative } from "./worldBridge";
import { agentExcluded } from "./activeAgents";
import { UNKNOWN_AGENT_DESTINATION } from "./agentIdentity";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  ApiError,
  api,
  errorMessage,
  readStore,
  removeStore,
  writeStore,
} from "./api";
import type { Attachment, ImageAttachment, Outgoing } from "./Composer";
import { sendBody } from "./sent";
import type { Agent } from "./types";
import { hostQuery, isArchived, isRunning, isWaiting } from "./types";
import { agentName } from "./names";

/**
 * Messages queued for a running agent. They live here, not in the composer,
 * so they go out when the agent becomes idle whatever the app is showing, and
 * every tab shares them (each change is made under a cross-tab lock).
 *
 * Delivery never risks sending a prompt twice. Each message has one ID for
 * life, sent with every attempt: the daemon keeps a receipt per ID, so a
 * repeat of a delivered message is a no-op there, and the agent's timeline
 * names the ID once it has arrived. Before a send the message is durably
 * marked as sending; it leaves the queue only when the daemon accepts it. If
 * the outcome can't be known (the request failed in a way that may have
 * reached the daemon, or the tab sending it closed), the timeline is checked;
 * unless it shows the message, the message waits for the user, marked as
 * possibly sent. Automatic retries follow only failures that can't have
 * reached the daemon.
 */
export type Queued = {
  id: string;
  /** Client destination captured when queued; absent only in legacy data. */
  target?: string;
  /** A legacy queue never recorded which host owns its raw daemon ID. */
  destinationUnknown?: boolean;
  /** Sent with every attempt; the daemon dedupes on it. */
  messageId?: string;
  text: string;
  /** Uploaded files and GitHub items; images are kept apart (see `images`). */
  attachments: Attachment[];
  /** How many images it carries. Too large to store, they stay in memory in
   * the tab that queued it, so only that tab can send them. */
  images?: number;
  /** The tab holding the images. */
  owner?: string;
  /** Being sent by `tab` since `at`: not to be touched until it answers. */
  sending?: { tab: string; at: number };
  /** Once tried, later attempts repeat the same request (the daemon's
   * receipt matches on it): how it was sent. */
  tried?: { behavior?: "steer" | "interrupt" };
  /** Why it stopped sending on its own; it waits for the user. */
  error?: string;
  /** The error is that it may already have been sent. */
  uncertain?: boolean;
  /** The daemon still has its receipt open (outcome unknown): sending it
   *  again under the same ID can't help, only as a new message. */
  pendingReceipt?: boolean;
  /** Its images went with the tab that held them. */
  imagesLost?: boolean;
  failures?: number;
};

const PREFIX = "paseo-command:";
/** After a send, the next waits until the agent is seen running and idle
 * again, or this long if a short turn finishes between polls. */
export const GRACE = 15000;
/** Automatic attempts (after definite failures) before it waits for the user. */
export const ATTEMPTS = 3;

const tab =
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const newMessageId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${uid()}-${uid()}`;
const storeKey = (agentId: string) => `queue:${agentId}`;
const sentKey = (agentId: string) => `queue-sent:${agentId}`;

type Locks = {
  request: (name: string, run: () => Promise<unknown>) => Promise<unknown>;
  query?: () => Promise<{ held?: { name?: string }[] }>;
};
const locks = () => (globalThis.navigator?.locks ?? null) as Locks | null;

/** This tab's images, by queued message. */
const memory = new Map<string, ImageAttachment[]>();
const listeners = new Set<() => void>();
const sentListeners = new Set<(agentId: string, message: Outgoing) => void>();
const cache = new Map<string, { raw: string | null; items: Queued[] }>();

const notify = () => listeners.forEach((l) => l());

/** The queue couldn't be saved: nothing was changed. */
export class QueueStorageError extends Error {
  constructor() {
    super(
      "Couldn't save the queue: this browser's storage is full or unavailable, so nothing was queued or changed.",
    );
  }
}

function rawOf(agentId: string) {
  try {
    return localStorage.getItem(`${PREFIX}${storeKey(agentId)}`);
  } catch {
    return null;
  }
}

/** The queue as stored (stable identity while unchanged). */
export function readQueue(agentId: string): Queued[] {
  const raw = rawOf(agentId);
  const hit = cache.get(agentId);
  if (hit && hit.raw === raw) return hit.items;
  const items = sanitize(readStore<unknown>(storeKey(agentId), []));
  cache.set(agentId, { raw, items });
  return items;
}

function sanitize(value: unknown): Queued[] {
  return (Array.isArray(value) ? value : []).filter(
    (q): q is Queued =>
      !!q &&
      typeof q.id === "string" &&
      typeof q.text === "string" &&
      Array.isArray(q.attachments),
  );
}

/** Saves the queue and checks it was saved; throws QueueStorageError if not. */
function writeQueue(agentId: string, items: Queued[]) {
  if (items.length) writeStore(storeKey(agentId), items);
  else {
    removeStore(storeKey(agentId));
    // Nothing left to pace; a message queued later waits for a turn anyway.
    removeStore(sentKey(agentId));
  }
  const saved = rawOf(agentId);
  notify();
  if (items.length ? saved !== JSON.stringify(items) : saved !== null)
    throw new QueueStorageError();
}

/** Read-modify-write under the agent's queue lock, shared by every tab. */
function exclusive<T>(agentId: string, run: () => Promise<T> | T): Promise<T> {
  const l = locks();
  if (!l) return Promise.resolve().then(run);
  return l.request(`${PREFIX}queue:${agentId}`, async () =>
    run(),
  ) as Promise<T>;
}

/** Holds this tab's liveness lock, so others can tell its sends and images
 *  are still in hand. */
let alive = false;
function holdTab() {
  if (alive) return;
  alive = true;
  void locks()
    ?.request(`${PREFIX}tab:${tab}`, () => new Promise(() => {}))
    .catch(() => {});
}
async function tabAlive(owner?: string) {
  if (!owner || owner === tab) return owner === tab;
  const l = locks();
  if (!l?.query) return false;
  try {
    const { held = [] } = await l.query();
    return held.some((h) => h.name === `${PREFIX}tab:${owner}`);
  } catch {
    return true; // Unknown: wait rather than give up on it.
  }
}

/** The images a queued message carries, if this tab holds them. */
const imagesOf = (q: Queued) => memory.get(q.id) ?? [];
/** Its images are elsewhere (or gone): this tab can't send it whole. */
export const missingImages = (q: Queued) => !!q.images && !memory.has(q.id);

/** Adds a message; rejects (QueueStorageError) if it couldn't be saved. */
export function enqueue(agentId: string, text: string, items: Attachment[]) {
  holdTab();
  const images = items.filter((a): a is ImageAttachment => a.kind === "image");
  const item: Queued = {
    id: uid(),
    target: agentId,
    messageId: newMessageId(),
    text,
    attachments: items.filter((a) => a.kind !== "image"),
    ...(images.length ? { images: images.length, owner: tab } : {}),
  };
  if (images.length) memory.set(item.id, images);
  return exclusive(agentId, () => {
    writeQueue(agentId, [...readQueue(agentId), item]);
  }).catch((e) => {
    memory.delete(item.id);
    throw e;
  });
}

/** Takes a message out of the queue (to edit or discard), with the images
 *  this tab holds for it. Undefined if it already went or is being sent. */
export function takeQueued(
  agentId: string,
  id: string,
): Promise<{ item: Queued; attachments: Attachment[] } | undefined> {
  return exclusive(agentId, () => {
    const all = readQueue(agentId);
    const item = all.find((q) => q.id === id);
    if (!item || item.sending) return undefined;
    writeQueue(
      agentId,
      all.filter((q) => q.id !== id),
    );
    const images = imagesOf(item);
    memory.delete(id);
    return { item, attachments: [...item.attachments, ...images] };
  });
}

export function toOutgoing(
  value: string,
  items: Attachment[],
  behavior?: "steer" | "interrupt",
  messageId?: string,
): Outgoing {
  return {
    text: value,
    images: items
      .filter((a): a is ImageAttachment => a.kind === "image")
      .map((a) => ({
        data: a.dataUrl.split(",")[1],
        mimeType: a.mimeType,
        dataUrl: a.dataUrl,
      })),
    attachments: items.flatMap((a): unknown[] =>
      a.kind === "file" && a.uploaded
        ? [a.uploaded]
        : a.kind === "github"
          ? [
              {
                type: a.item.kind === "pr" ? "github_pr" : "github_issue",
                number: a.item.number,
                title: a.item.title,
                url: a.item.url,
                body: a.item.body ?? null,
                ...(a.item.kind === "pr"
                  ? {
                      baseRefName: a.item.baseRefName ?? null,
                      headRefName: a.item.headRefName ?? null,
                    }
                  : {}),
              },
            ]
          : [],
    ),
    ...(behavior ? { behavior } : {}),
    ...(messageId ? { messageId } : {}),
  };
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/** Called with each queued message sent (the session shows it at once). */
export function onQueueSent(
  listener: (agentId: string, message: Outgoing) => void,
) {
  sentListeners.add(listener);
  return () => void sentListeners.delete(listener);
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key.startsWith(`${PREFIX}queue:`)) notify();
  });

export function useQueue(agentId: string) {
  return useSyncExternalStore(subscribe, () => readQueue(agentId));
}

const lostError = (n: number) =>
  `Its ${n === 1 ? "image was" : `${n} images were`} lost when the page that queued it closed. Edit it to attach again, or send it without.`;
/**
 * Whether a host is known to recognise a repeated message ID and not run it
 * twice. No daemon advertises that for message sends (its only receipt flag,
 * agentRequestReceipts, is documented for creating agents), so no host is
 * assumed to: the copy never promises it. The ID is still sent with every
 * attempt, for daemons that do keep receipts.
 */
export function dedupes(_agent: { host?: string }) {
  return false;
}
const maybeSent = (why: string, safe: boolean) =>
  safe
    ? `It may have been sent (${why}). Check the conversation: if it isn't there, send it again; this host recognises a repeat, so the agent won't get it twice.`
    : `It may have been sent (${why}). Check the conversation first: this host may not recognise a repeat, so sending it again could make the agent run it twice.`;
const pendingError =
  "The daemon can't tell whether the agent got it: its earlier attempt never finished. Check the conversation; if it isn't there, send it as a new message (if the agent did get it, it gets it twice).";

/** It can't be repeated: its images are in another tab, or gone. */
export class MissingImagesError extends Error {
  constructor(n: number) {
    super(
      `Its ${n === 1 ? "image isn't" : `${n} images aren't`} available here. Edit it to attach ${n === 1 ? "the image" : "them"} again, or send it without as a new message.`,
    );
  }
}
/** The daemon won't take this ID again until its open receipt resolves. */
export class PendingReceiptError extends Error {
  constructor() {
    super(pendingError);
  }
}

/**
 * Whether a failed request certainly never reached the daemon: refused by
 * this app's server before any work (wrong origin, unknown route or host,
 * shutting down). Anything else, including the server's 400 for a daemon
 * error, network errors and timeouts, may have been delivered.
 */
export function neverDelivered(e: unknown) {
  return e instanceof ApiError && [403, 404, 405, 415, 503].includes(e.status);
}

export type Outcome = "sent" | "retry" | "uncertain";
export type RunnerDeps = {
  post: (agent: Agent, message: Outgoing) => Promise<unknown>;
  /** Whether the agent's conversation shows the message (by its ID). */
  delivered: (agent: Agent, messageId: string) => Promise<boolean>;
  now?: () => number;
  /** A message that stopped sending on its own, or trouble saving the queue. */
  onFailed?: (agent: Agent, error: string) => void;
  onSent?: (agent: Agent) => void;
};

/** This tab's sends in progress (shared by every runner in the tab). */
const inFlight = new Set<string>();
let deliveryPaused = false;
const activeRuns = new Set<Promise<unknown>>();
function trackRun<T>(work: Promise<T>): Promise<T> {
  activeRuns.add(work);
  void work.finally(() => activeRuns.delete(work)).catch(() => {});
  return work;
}
/** Hold new queue claims before the native host drains its helper. Persisted
 * sending markers retain uncertainty if an operation outlives shutdown. */
export async function prepareQueueShutdown(timeoutMs = 15000) {
  deliveryPaused = true;
  const deadline = Date.now() + timeoutMs;
  while (activeRuns.size && Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      Promise.allSettled([...activeRuns]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(1, deadline - Date.now()));
      }),
    ]);
    clearTimeout(timer!);
  }
  return { drained: activeRuns.size === 0, pending: activeRuns.size };
}
export function resumeQueueDelivery() {
  deliveryPaused = false;
  notify();
}
if (typeof window !== "undefined")
  nativeEvents((event) => {
    if (event.type !== "lifecycle") return;
    if (event.action === "prepareQuit")
      void prepareQueueShutdown().then((result) =>
        postNative({
          type: "lifecycle",
          action: "preparedQuit",
          id: event.id,
          ...result,
        }),
      );
    else if (event.action === "resume") resumeQueueDelivery();
  });
/** Outcomes known but not yet saved (storage refused): retried each pass. */
type Unsettled = {
  agentId: string;
  item: Queued;
  outcome: Outcome;
  why: string;
  message: Outgoing;
};
const unsettled = new Map<string, Unsettled>();
/** A claim's identity: who claimed it when, and in what state. */
const token = (q: Queued) =>
  JSON.stringify([
    q.messageId,
    q.target,
    !!q.destinationUnknown,
    q.sending?.tab,
    q.sending?.at,
    !!q.uncertain,
    q.error ?? "",
  ]);
const knownDestination = (item: Queued, agentId: string) =>
  !item.destinationUnknown && item.target === agentId;
/** The daemon holds an unresolved receipt for this ID: replaying it can't help. */
const PENDING_RECEIPT = /outcome[_ ]unknown/i;

/** A claimed send this tab isn't making (its tab closed, or this one lost track). */
async function orphaned(q: Queued) {
  if (!q.sending || inFlight.has(q.id) || unsettled.has(q.id)) return false;
  return q.sending.tab === tab || !(await tabAlive(q.sending.tab));
}

/**
 * Sends each agent's queue, one message per turn: the head goes out when the
 * agent is idle, and the next only once the agent has been seen running since
 * (or GRACE has passed).
 */
export class QueueRunner {
  private seenRunning = new Map<string, number>();
  private busy = new Set<string>();
  private checked = new Map<string, number>();
  private reported = new Map<string, number>();
  constructor(private deps: RunnerDeps) {}
  private now() {
    return (this.deps.now ?? Date.now)();
  }
  private waiting(agentId: string) {
    const last = readStore<number>(sentKey(agentId), 0);
    if (!last) return false;
    return (
      (this.seenRunning.get(agentId) ?? 0) <= last && this.now() - last < GRACE
    );
  }
  /** At most every 5s per agent and kind of check. */
  private due(key: string) {
    const last = this.checked.get(key) ?? -Infinity;
    if (this.now() - last < 5000) return false;
    this.checked.set(key, this.now());
    return true;
  }
  /** Runs one pass. `ready`: the agent can take a new turn now. Resolves when
   * every send it started has settled. */
  tick(agents: Agent[], ready: (a: Agent) => boolean) {
    const runs: Promise<unknown>[] = [];
    if (deliveryPaused) return Promise.resolve();
    for (const a of agents) {
      if (agentExcluded(a)) continue;
      if (isRunning(a.status)) this.seenRunning.set(a.id, this.now());
      if (this.busy.has(a.id)) continue;
      const queue = readQueue(a.id);
      const pending = [...unsettled.values()].filter((u) => u.agentId === a.id);
      if (!queue.length && !pending.length) continue;
      const run = (work: () => Promise<unknown>) => {
        this.busy.add(a.id);
        runs.push(
          trackRun(
            work()
              .catch((e) => this.report(a, e))
              .finally(() => this.busy.delete(a.id)),
          ),
        );
      };
      // Outcomes not yet saved come first; then sends nobody is making, and
      // possibly-sent messages, whatever the agent is doing.
      // (The lost-image check settles once per message, so it can't starve
      // the rest; recovery repeats while a message may have been sent.)
      if (pending.length) run(() => this.resettle(a, pending));
      else if (
        queue.some((q) => missingImages(q) && !q.imagesLost && !q.sending) &&
        this.due(`lost:${a.id}`)
      )
        run(() => this.sweep(a.id));
      else if (
        queue.some((q) => (q.sending && !inFlight.has(q.id)) || q.uncertain) &&
        this.due(`recover:${a.id}`)
      )
        run(() => this.recover(a));
      else if (!ready(a)) continue;
      else if (!queue[0].error && !queue[0].sending && !this.waiting(a.id))
        run(() => this.sendHead(a));
    }
    return Promise.all(runs).then(() => {});
  }
  private report(agent: Agent, e: unknown) {
    // Storage trouble repeats every pass: say so once a minute at most.
    const last = this.reported.get(agent.id) ?? -Infinity;
    if (this.now() - last < 60000) return;
    this.reported.set(agent.id, this.now());
    this.deps.onFailed?.(agent, e instanceof Error ? e.message : String(e));
  }
  /** Says so at once (not when its turn comes) if a queued message's images
   *  went with a tab that has closed. */
  private sweep(agentId: string) {
    return exclusive(agentId, async () => {
      const all = readQueue(agentId);
      const marked = await Promise.all(
        all.map(async (q) =>
          missingImages(q) &&
          !q.imagesLost &&
          !q.sending &&
          !(await tabAlive(q.owner))
            ? { ...q, imagesLost: true, error: q.error ?? lostError(q.images!) }
            : q,
        ),
      );
      if (marked.some((q, i) => q !== all[i])) writeQueue(agentId, marked);
    });
  }
  /**
   * Sends nobody is making any more and messages that may have been sent:
   * settled as sent if the timeline shows them; otherwise an orphaned send
   * becomes "may have been sent", for the user to decide. Each result is
   * applied only if the message is still exactly as it was observed (another
   * tab may have claimed it meanwhile).
   */
  private async recover(agent: Agent) {
    const seen: Queued[] = [];
    for (const q of readQueue(agent.id))
      if (
        knownDestination(q, agent.id) &&
        (q.uncertain ? !q.sending : await orphaned(q))
      )
        seen.push(q);
    if (!seen.length) return;
    const shown = new Set<string>();
    for (const q of seen)
      if (
        q.messageId &&
        (await this.deps.delivered(agent, q.messageId).catch(() => false))
      )
        shown.add(q.id);
    let settled = false;
    await exclusive(agent.id, () => {
      const all = readQueue(agent.id);
      const before = new Map(seen.map((q) => [q.id, token(q)]));
      const unchanged = (q: Queued) =>
        before.get(q.id) === token(q) && !inFlight.has(q.id);
      const next = all
        .filter((q) => !(shown.has(q.id) && unchanged(q)))
        .map((q) =>
          q.sending && unchanged(q)
            ? {
                ...q,
                sending: undefined,
                uncertain: true,
                error: maybeSent(
                  "its send was cut off before the daemon answered",
                  dedupes(agent),
                ),
              }
            : q,
        );
      settled = next.length !== all.length;
      if (settled || next.some((q, i) => q !== all[i]))
        writeQueue(agent.id, next);
      for (const q of all)
        if (!next.some((n) => n.id === q.id)) memory.delete(q.id);
    });
    if (settled) this.deps.onSent?.(agent);
  }
  /** Claims the head (durably marked as sending), then sends it. */
  private async sendHead(agent: Agent) {
    const claimed = await exclusive(agent.id, async () => {
      // Another tab may have sent (or the user taken) it meanwhile.
      const [head, ...rest] = readQueue(agent.id);
      if (deliveryPaused || agentExcluded(agent)) return;
      if (!head || head.error || head.sending || this.waiting(agent.id)) return;
      if (!knownDestination(head, agent.id)) {
        writeQueue(agent.id, [
          {
            ...head,
            destinationUnknown: true,
            uncertain: true,
            error: UNKNOWN_AGENT_DESTINATION,
          },
          ...rest,
        ]);
        return;
      }
      if (missingImages(head)) {
        if (await tabAlive(head.owner)) return; // That tab will send it.
        writeQueue(agent.id, [
          { ...head, imagesLost: true, error: lostError(head.images!) },
          ...rest,
        ]);
        return;
      }
      return this.claim(agent.id, head, rest);
    });
    if (claimed) await this.send(agent, claimed);
  }
  private claim(agentId: string, item: Queued, rest: Queued[]) {
    holdTab();
    const claim: Queued = {
      ...item,
      target: agentId,
      messageId: item.messageId ?? newMessageId(),
      sending: { tab, at: this.now() },
      tried: item.tried ?? {},
      error: undefined,
      uncertain: undefined,
      pendingReceipt: undefined,
    };
    writeQueue(agentId, [claim, ...rest]);
    writeStore(sentKey(agentId), this.now());
    inFlight.add(claim.id);
    return claim;
  }
  /**
   * Sends a claimed message and settles it: gone once accepted (or shown in
   * the timeline); back in the queue to retry later only if it certainly
   * didn't arrive; otherwise kept as possibly sent.
   */
  private async send(agent: Agent, item: Queued): Promise<Outcome> {
    const message = toOutgoing(
      item.text,
      [...item.attachments, ...imagesOf(item)],
      item.tried?.behavior,
      item.messageId,
    );
    let outcome: Outcome;
    let why = "";
    try {
      await this.deps.post(agent, message);
      outcome = "sent";
    } catch (e) {
      why = errorMessage(e) || "request failed";
      outcome = neverDelivered(e)
        ? "retry"
        : (await this.deps.delivered(agent, item.messageId!).catch(() => false))
          ? "sent"
          : "uncertain";
    }
    const record: Unsettled = {
      agentId: agent.id,
      item,
      outcome,
      why,
      message,
    };
    try {
      await this.settle(agent, record);
    } catch (e) {
      // The outcome is known; saving it failed. Keep it and try again each
      // pass, rather than leaving the message marked as sending.
      unsettled.set(item.id, record);
      throw e;
    } finally {
      inFlight.delete(item.id);
    }
    return outcome;
  }
  private async resettle(agent: Agent, records: Unsettled[]) {
    for (const r of records) {
      await this.settle(agent, r);
      unsettled.delete(r.item.id);
    }
  }
  /** Saves a send's outcome, if the message is still this send's to settle. */
  private async settle(agent: Agent, r: Unsettled) {
    const { item, outcome, why } = r;
    const failures = (item.failures ?? 0) + 1;
    let applied = false;
    await exclusive(agent.id, () => {
      const all = readQueue(agent.id);
      const current = all.find((q) => q.id === item.id);
      const rest = all.filter((q) => q.id !== item.id);
      if (outcome === "sent") {
        applied = !!current;
        if (current) writeQueue(agent.id, rest);
        return;
      }
      // Only our own claim, untouched since (not one another tab has made).
      if (!current || token(current) !== token(item)) return;
      applied = true;
      const settled: Queued =
        outcome === "retry"
          ? {
              ...item,
              sending: undefined,
              failures,
              ...(failures >= ATTEMPTS
                ? { error: `Couldn't send: ${why}` }
                : {}),
            }
          : {
              ...item,
              sending: undefined,
              uncertain: true,
              ...(PENDING_RECEIPT.test(why)
                ? { pendingReceipt: true, error: pendingError }
                : { error: maybeSent(why, dedupes(agent)) }),
            };
      writeQueue(agent.id, [settled, ...rest]);
      writeStore(sentKey(agent.id), this.now());
    });
    if (outcome === "sent") {
      memory.delete(item.id);
      sentListeners.forEach((l) => l(agent.id, r.message));
      this.deps.onSent?.(agent);
    } else if (!applied) return;
    else if (outcome === "uncertain")
      this.deps.onFailed?.(
        agent,
        PENDING_RECEIPT.test(why)
          ? pendingError
          : maybeSent(why, dedupes(agent)),
      );
    else if (failures >= ATTEMPTS)
      this.deps.onFailed?.(agent, `Couldn't send: ${why}`);
  }
  /**
   * The user's "Send now" or "Send again": the same protections as the
   * runner. A message already tried is repeated exactly, with its own ID, so
   * the daemon can recognise it; one whose images this tab doesn't have is
   * never repeated without them (`asNew` sends what's left as a new message).
   *
   * `asNew`: the user's explicit choice to send it as a new message, with a
   * new ID (the daemon can't connect it to the earlier attempt).
   */
  async sendNow(
    agent: Agent,
    id: string,
    behavior?: "steer" | "interrupt",
    { asNew = false } = {},
  ) {
    if (deliveryPaused)
      throw new Error(
        "The app is shutting down. This queued message has not been sent.",
      );
    if (agentExcluded(agent))
      throw new Error(
        "This agent is archived. Its queued messages will not be sent.",
      );
    const claimed = await exclusive(agent.id, () => {
      if (deliveryPaused || agentExcluded(agent)) return;
      const all = readQueue(agent.id);
      const item = all.find((q) => q.id === id);
      if (!item || item.sending) return undefined;
      if (!knownDestination(item, agent.id) && !asNew)
        throw new Error(UNKNOWN_AGENT_DESTINATION);
      if (missingImages(item) && !asNew)
        throw new MissingImagesError(item.images!);
      if (item.pendingReceipt && !asNew) throw new PendingReceiptError();
      return this.claim(
        agent.id,
        asNew
          ? {
              ...item,
              destinationUnknown: undefined,
              messageId: newMessageId(),
              tried: behavior ? { behavior } : {},
              images: memory.has(item.id) ? item.images : undefined,
              owner: memory.has(item.id) ? item.owner : undefined,
              imagesLost: undefined,
              failures: 0,
            }
          : {
              ...item,
              failures: 0,
              tried: item.tried ?? (behavior ? { behavior } : {}),
            },
        all.filter((q) => q.id !== id),
      );
    });
    return claimed ? trackRun(this.send(agent, claimed)) : undefined;
  }
}

/** Posts a message to the agent, as the composer's send does. */
export async function deliver(agent: Agent, message: Outgoing) {
  if (agentExcluded(agent)) throw new ApiError("This agent is archived.", 404);
  const body = await sendBody(message);
  await api(
    `agents/${agent.id}/send`,
    agent.host ? { ...body, host: agent.host } : body,
  );
}

/** Whether the agent's recent conversation includes the message. */
export async function delivered(agent: Agent, messageId: string) {
  const q = hostQuery(agent.host);
  const r = await api<{ items?: { kind?: string; messageId?: string }[] }>(
    `agents/${agent.id}/timeline${q}${q ? "&" : "?"}limit=200`,
  );
  return (r.items ?? []).some(
    (i) => i.kind === "user" && i.messageId === messageId,
  );
}

type Shared = {
  runner: QueueRunner;
  onSent: () => void;
  onFailed: (m: string) => void;
};
let shared: Shared | null = null;
function sharedRunner(): Shared {
  if (shared) return shared;
  const s: Shared = {
    onSent: () => {},
    onFailed: () => {},
    runner: new QueueRunner({
      post: deliver,
      delivered,
      onSent: () => s.onSent(),
      onFailed: (a, error) =>
        s.onFailed(`Queued message for “${agentName(a)}”: ${error}`),
    }),
  };
  return (shared = s);
}
/** Sends a queued message now (see QueueRunner.sendNow). */
export function sendQueuedNow(
  agent: Agent,
  id: string,
  behavior?: "steer" | "interrupt",
  options?: { asNew?: boolean },
) {
  return sharedRunner().runner.sendNow(agent, id, behavior, options);
}

/**
 * Runs the queue runner for the whole app: whichever view is open, queued
 * messages go out as their agents become idle.
 */
export function useQueueRunner({
  agents,
  online,
  permissionAgents,
  onSent,
  onFailed,
}: {
  agents: Agent[];
  online: boolean;
  permissionAgents: Set<string>;
  onSent: () => void;
  onFailed: (message: string) => void;
}) {
  const latest = useRef({ agents, online, permissionAgents });
  latest.current = { agents, online, permissionAgents };
  const s = sharedRunner();
  s.onSent = onSent;
  s.onFailed = onFailed;
  useEffect(() => {
    const run = () => {
      const { agents, online, permissionAgents } = latest.current;
      if (!online) return;
      void s.runner.tick(
        agents,
        (a) =>
          !a.stale &&
          !isArchived(a) &&
          !isRunning(a.status) &&
          !isWaiting(a.status) &&
          !permissionAgents.has(a.id),
      );
    };
    // Runs on every pushed change of the agents (this effect) and of the
    // queue (here or in another tab); while messages wait, also each second,
    // for the pacing window and checks that end without a push.
    let timer = 0;
    const pass = () => {
      run();
      clearTimeout(timer);
      if (latest.current.agents.some((a) => readQueue(a.id).length))
        timer = window.setTimeout(pass, 1000);
    };
    pass();
    const unsubscribe = subscribe(pass);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [agents, online, permissionAgents, s]);
}
