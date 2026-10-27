import { createHostClient } from "@getpaseo/client/node";
import { redactText } from "./redact";

/**
 * Some composer features (images, uploads, /commands, @files, GitHub attachments,
 * model/thinking/feature changes, the structured timeline) exist only on
 * the daemon's WebSocket protocol, so they use the official SDK — the same client
 * the Paseo app uses — instead of the CLI. Loopback connections need no credential;
 * no Paseo credential or config file is ever read.
 */
type Client = ReturnType<typeof createHostClient>;
const clients = new Map<string, Promise<Client>>();
/**
 * Failed connects back off (1s, 2s, 4s … 15s) so a dead host fails fast instead
 * of costing every request a fresh connect timeout.
 */
const failures = new Map<string, { count: number; retryAt: number }>();
export const CONNECT = {
  timeoutMs: 8000,
  backoffBaseMs: 1000,
  backoffMaxMs: 15000,
};
/** Tests replace the SDK factory to simulate unreachable daemons. */
export const connector = { create: createHostClient };
export function resetConnections() {
  failures.clear();
  for (const pending of clients.values())
    void pending.then((c) => c.close()).catch(() => {});
  clients.clear();
}

/**
 * Close any client (connected or still connecting) for a target that may
 * no longer be contacted (offline, moved, unregistered). A connection still
 * being made is closed as soon as it completes; nobody can be handed it.
 */
export function release(target: string) {
  const pending = clients.get(target);
  if (!pending) return;
  clients.delete(target);
  withdrawn.add(pending);
  // A connection still being made is abandoned now, not when it completes.
  void opening
    .get(pending)
    ?.close()
    .catch(() => {});
  void pending.then((c) => c.close()).catch(() => {});
}
/**
 * Withdraw every connection, made or being made (the server is shutting
 * down): waiters are refused, and it resolves once none can come up.
 */
export async function withdrawAll() {
  const pendings = [...clients.keys()].map((target) => {
    const pending = clients.get(target)!;
    release(target);
    return pending;
  });
  await Promise.allSettled(pendings);
}
/** The client behind a connection still being made. */
const opening = new WeakMap<Promise<Client>, Client>();
/**
 * Connections released on purpose. Whoever was waiting on one is refused,
 * rather than treating it as a dropped socket and opening another to a
 * target that may no longer be contacted.
 */
const withdrawn = new WeakSet<Promise<Client>>();
export class Withdrawn extends Error {
  constructor() {
    super("The connection to this host was withdrawn.");
  }
}

/**
 * Drop a client whose request timed out: a socket that stops answering can
 * still report itself connected, and every later request would hang on it.
 * The next request opens a fresh connection.
 */
export function discard(client: unknown) {
  for (const [target, pending] of clients)
    void pending
      .then((c) => {
        if (c !== client || clients.get(target) !== pending) return;
        clients.delete(target);
        void c.close().catch(() => {});
      })
      .catch(() => {});
}

export function loopbackTarget(listen: string) {
  const port = /:(\d+)$/.exec(listen.trim())?.[1];
  if (!port) throw new Error("The local daemon is not listening on TCP.");
  return `127.0.0.1:${port}`;
}

/**
 * The client for a target: shared, opened on first use. `allowed` is asked
 * before any new connection is opened (the contact policy); a connection
 * withdrawn while waiting on it refuses its waiters.
 */
export async function daemon(
  target: string,
  allowed?: () => boolean,
): Promise<Client> {
  const existing = clients.get(target);
  if (existing) {
    const client = await existing.catch(() => null);
    if (withdrawn.has(existing)) throw new Withdrawn();
    if (client && client.isConnected !== false) return client;
    // A concurrent caller may already have replaced the dead client; share it
    // rather than opening a second socket that would never be closed.
    const current = clients.get(target);
    if (current && current !== existing) return daemon(target, allowed);
    clients.delete(target);
    void client?.close().catch(() => {});
  }
  if (allowed && !allowed()) throw new Withdrawn();
  const failed = failures.get(target);
  if (failed && failed.retryAt > Date.now())
    throw new Error(
      `Could not connect to the Paseo daemon. Retrying in ${Math.ceil((failed.retryAt - Date.now()) / 1000)}s.`,
    );
  let created: Client | undefined;
  const pending = (async () => {
    const client = (created = connector.create(target, {
      clientId: "paseo-command",
      clientType: "cli",
      appVersion: "paseo-command",
      reconnect: { enabled: false },
      connectTimeoutMs: CONNECT.timeoutMs,
    }));
    try {
      await client.connect();
      return client;
    } catch (error) {
      void client.close().catch(() => {});
      throw error;
    }
  })();
  clients.set(target, pending);
  if (created) opening.set(pending, created);
  pending.then(
    () => failures.delete(target),
    () => {
      if (clients.get(target) === pending) clients.delete(target);
      // Abandoned on purpose: not the host failing.
      if (withdrawn.has(pending)) return;
      const count = (failures.get(target)?.count ?? 0) + 1;
      failures.set(target, {
        count,
        retryAt:
          Date.now() +
          Math.min(
            CONNECT.backoffMaxMs,
            CONNECT.backoffBaseMs * 2 ** (count - 1),
          ),
      });
    },
  );
  let client: Client;
  try {
    client = await pending;
  } catch {
    if (withdrawn.has(pending)) throw new Withdrawn();
    throw new Error("Could not connect to the Paseo daemon.");
  }
  if (withdrawn.has(pending)) throw new Withdrawn();
  return client;
}

// ── Input validation (pure, unit tested) ───────────────────────────────────
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/;
export const LIMITS = {
  images: 10,
  imageBytes: 20 * 1024 * 1024,
  attachments: 20,
  uploadBytes: 50 * 1024 * 1024,
};

export function images(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > LIMITS.images)
    throw new Error(`Attach at most ${LIMITS.images} images`);
  return value.map((img: unknown) => {
    if (!img || typeof img !== "object") throw new Error("Invalid image");
    const { data, mimeType } = img as { data?: unknown; mimeType?: unknown };
    if (typeof mimeType !== "string" || !IMAGE_TYPES.test(mimeType))
      throw new Error("Images must be PNG, JPEG, GIF or WebP");
    if (
      typeof data !== "string" ||
      !data ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data) ||
      (data.length * 3) / 4 > LIMITS.imageBytes
    )
      throw new Error("Invalid image data");
    return { data, mimeType };
  });
}

const str = (v: unknown, max = 2000) =>
  typeof v === "string" && v.length <= max ? v : undefined;
const num = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const url = (v: unknown) => {
  const s = str(v);
  return s && /^https:\/\//.test(s) ? s : undefined;
};

/** Only attachment kinds the composer creates; anything else is rejected. */
export function attachments(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > LIMITS.attachments)
    throw new Error(`Attach at most ${LIMITS.attachments} items`);
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid attachment");
    const a = raw as Record<string, unknown>;
    if (a.type === "uploaded_file") {
      const out = {
        type: "uploaded_file" as const,
        id: str(a.id, 200),
        fileName: str(a.fileName, 500),
        mimeType: str(a.mimeType, 200),
        size: num(a.size),
        path: str(a.path, 4000),
      };
      if (Object.values(out).some((v) => v === undefined))
        throw new Error("Invalid uploaded file");
      return out;
    }
    if (a.type === "github_issue" || a.type === "github_pr") {
      const number = num(a.number);
      const title = str(a.title, 1000);
      const link = url(a.url);
      if (!number || title === undefined || !link)
        throw new Error("Invalid GitHub attachment");
      return {
        type: a.type,
        mimeType:
          a.type === "github_pr"
            ? "application/github-pr"
            : "application/github-issue",
        number,
        title,
        url: link,
        body: str(a.body, 60000) ?? null,
        ...(a.type === "github_pr"
          ? {
              baseRefName: str(a.baseRefName, 300) ?? null,
              headRefName: str(a.headRefName, 300) ?? null,
            }
          : {}),
      };
    }
    throw new Error("Unsupported attachment");
  });
}

export function behavior(value: unknown) {
  if (value === undefined) return undefined;
  if (value !== "steer" && value !== "interrupt")
    throw new Error("Invalid behavior");
  return value;
}

// ── Timeline shaping (pure, unit tested) ───────────────────────────────────
export type TimelineItem =
  | { kind: "user"; id: string; text: string; at?: string; messageId?: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      at?: string;
      messageId?: string;
    }
  | { kind: "reasoning"; id: string; text: string; at?: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      status: string;
      summary: string;
      detail: string;
      at?: string;
    }
  | { kind: "todo"; id: string; items: { text: string; done: boolean }[] }
  | { kind: "notice"; id: string; level: string; text: string; at?: string };

const clip = (s: unknown, max: number) => {
  const text = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s);
  return redactText(text.length > max ? `${text.slice(0, max)}\n…` : text);
};

/** A tool call's detail as the daemon sends it, by `type`; read defensively. */
type ToolDetail = {
  type?: unknown;
  command?: unknown;
  output?: unknown;
  exitCode?: unknown;
  filePath?: unknown;
  content?: unknown;
  unifiedDiff?: unknown;
  oldString?: unknown;
  newString?: unknown;
  query?: unknown;
  filePaths?: string[];
  webResults?: { title?: unknown; url?: unknown }[];
  url?: unknown;
  result?: unknown;
  description?: unknown;
  subAgentType?: unknown;
  log?: unknown;
  label?: unknown;
  text?: unknown;
  branchName?: unknown;
  input?: unknown;
};

export function toolText(raw: unknown): { summary: string; detail: string } {
  const detail = raw as ToolDetail | null | undefined;
  switch (detail?.type) {
    case "shell":
      return {
        summary: clip(detail.command, 400),
        detail: clip(
          `$ ${detail.command}${detail.output ? `\n${detail.output}` : ""}${
            detail.exitCode ? `\n[exit ${detail.exitCode}]` : ""
          }`,
          6000,
        ),
      };
    case "read":
    case "write":
      return {
        summary: clip(detail.filePath, 400),
        detail: clip(detail.content, 4000),
      };
    case "edit":
      return {
        summary: clip(detail.filePath, 400),
        detail: clip(
          detail.unifiedDiff ||
            [
              detail.oldString && `- ${detail.oldString}`,
              detail.newString && `+ ${detail.newString}`,
            ]
              .filter(Boolean)
              .join("\n"),
          6000,
        ),
      };
    case "search":
      return {
        summary: clip(detail.query, 400),
        detail: clip(
          detail.content ||
            (detail.filePaths || []).join("\n") ||
            (detail.webResults || [])
              .map((r) => `${r.title} — ${r.url}`)
              .join("\n"),
          4000,
        ),
      };
    case "fetch":
      return {
        summary: clip(detail.url, 400),
        detail: clip(detail.result, 4000),
      };
    case "sub_agent":
      return {
        summary: clip(detail.description || detail.subAgentType, 400),
        detail: clip(detail.log, 6000),
      };
    case "plain_text":
      return {
        summary: clip(detail.label, 400),
        detail: clip(detail.text, 4000),
      };
    case "plan":
      return { summary: "Plan", detail: clip(detail.text, 8000) };
    case "worktree_setup":
      return {
        summary: clip(detail.branchName, 400),
        detail: clip(detail.log, 4000),
      };
    default:
      return {
        summary: clip(detail?.input, 300),
        detail: clip(detail?.output ?? detail?.input, 4000),
      };
  }
}

/** A daemon timeline row as read here (the SDK's entry; read defensively). */
type TimelineRow = {
  item?: {
    type?: unknown;
    text?: unknown;
    messageId?: unknown;
    callId?: unknown;
    name?: unknown;
    status?: unknown;
    detail?: unknown;
    error?: unknown;
    items?: unknown;
    message?: unknown;
    level?: unknown;
  } | null;
  timestamp?: unknown;
  seqStart?: unknown;
};

export function shapeTimeline(entries: unknown): TimelineItem[] {
  const out: TimelineItem[] = [];
  const rows: (TimelineRow | null | undefined)[] = Array.isArray(entries)
    ? entries
    : [];
  for (const entry of rows) {
    const item = entry?.item;
    const at =
      typeof entry?.timestamp === "string" ? entry.timestamp : undefined;
    const id = `${entry?.seqStart ?? out.length}`;
    if (!item || typeof item !== "object") continue;
    switch (item.type) {
      case "user_message":
      case "assistant_message":
      case "reasoning": {
        const kind =
          item.type === "user_message"
            ? "user"
            : item.type === "assistant_message"
              ? "assistant"
              : "reasoning";
        out.push({
          kind,
          id,
          text: clip(item.text, 60000),
          at,
          // A reply's message: tells its chunks from the next reply's.
          ...(kind !== "reasoning" && typeof item.messageId === "string"
            ? { messageId: item.messageId }
            : {}),
        } as TimelineItem);
        break;
      }
      case "tool_call": {
        const { summary, detail } = toolText(item.detail);
        out.push({
          kind: "tool",
          id: `${id}:${item.callId || ""}`,
          name: clip(item.name, 120),
          status: typeof item.status === "string" ? item.status : "completed",
          summary,
          detail:
            item.status === "failed" && item.error
              ? clip(`${detail}\n${clip(item.error, 2000)}`, 8000)
              : detail,
          at,
        });
        break;
      }
      case "todo":
        out.push({
          kind: "todo",
          id,
          items: (Array.isArray(item.items) ? item.items : [])
            .slice(0, 50)
            .map((t: { text?: unknown; completed?: unknown } | null) => ({
              text: clip(t?.text, 500),
              done: Boolean(t?.completed),
            })),
        });
        break;
      case "error":
        out.push({
          kind: "notice",
          id,
          level: "error",
          text: clip(item.message, 4000),
          at,
        });
        break;
      case "notification":
        out.push({
          kind: "notice",
          id,
          level: typeof item.level === "string" ? item.level : "info",
          text: clip(item.message, 4000),
          at,
        });
        break;
      case "compaction":
        if (item.status === "completed")
          out.push({
            kind: "notice",
            id,
            level: "info",
            text: "Context compacted",
            at,
          });
        break;
    }
  }
  return out;
}

/** Images the daemon saved for sent prompts appear as Markdown links to these files. */
/**
 * The daemon's attention fields for an agent's detail response. With no live
 * record (the SDK read failed) both are omitted, so clients can tell
 * "unknown" from "none" (null): attention names completions by these and
 * waits rather than guess when they're missing.
 */
export function attentionFields(live: unknown): {
  LastUserMessageAt?: string | null;
  AttentionTimestamp?: string | null;
} {
  if (!live || typeof live !== "object") return {};
  const { lastUserMessageAt, attentionTimestamp } = live as Record<
    string,
    unknown
  >;
  return {
    LastUserMessageAt:
      typeof lastUserMessageAt === "string" ? lastUserMessageAt : null,
    AttentionTimestamp:
      typeof attentionTimestamp === "string" ? attentionTimestamp : null,
  };
}

export const ATTACHMENT_IMAGE =
  /^\/(?:private\/)?(?:var\/folders|tmp)\/[\w./-]*\/paseo-attachments-[\w-]+\/[a-f0-9]{16,128}\.(png|jpe?g|gif|webp)$/i;

/** Pending permission requests with enough context to decide on them. */
export type Question = {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
};

/** AskUserQuestion-style input, parsed the way the Paseo app parses it. */
export function parseQuestions(input: unknown): Question[] | null {
  const raw = (input as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: Question[] = [];
  for (const q of raw) {
    if (
      !q ||
      typeof q.question !== "string" ||
      typeof q.header !== "string" ||
      !Array.isArray(q.options)
    )
      return null;
    const options = [];
    for (const o of q.options) {
      if (!o || typeof o.label !== "string") return null;
      options.push({
        label: o.label,
        ...(typeof o.description === "string"
          ? { description: o.description }
          : {}),
      });
    }
    out.push({
      question: q.question,
      header: q.header,
      options,
      multiSelect: q.multiSelect === true,
      allowOther:
        q.allowOther === true || q.isOther === true || options.length === 0,
      allowEmpty: q.allowEmpty === true,
    });
  }
  return out;
}

/** Pending permission requests with enough context to decide on them. */
/** A pending permission request as the daemon sends it; read defensively. */
type PermissionRequest = {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  name?: unknown;
  description?: unknown;
  input?: Record<string, unknown> | null;
  detail?: (ToolDetail & { text?: unknown }) | null;
  actions?: unknown;
};
type PermissionAction = { id?: unknown; label?: unknown; behavior?: unknown };

export function shapePermissions(requests: unknown) {
  const list: (PermissionRequest | null | undefined)[] = Array.isArray(requests)
    ? requests
    : [];
  return list.map((r) => {
    const questions = r?.kind === "question" ? parseQuestions(r?.input) : null;
    const { summary, detail } = toolText(r?.detail ?? { input: r?.input });
    return {
      id: String(r?.id ?? ""),
      name: clip(r?.title || r?.name || "Permission request", 200),
      description: questions ? "" : clip(r?.description || summary, 2000),
      detail: questions || r?.detail?.type === "plan" ? "" : detail,
      plan: r?.detail?.type === "plan" ? clip(r.detail.text, 20000) : "",
      kind: typeof r?.kind === "string" ? r.kind : "tool",
      ...(questions
        ? {
            questions: questions.map((q) => ({
              ...q,
              question: clip(q.question, 4000),
              options: q.options.map((o) => ({
                label: o.label,
                description: o.description
                  ? clip(o.description, 2000)
                  : undefined,
              })),
            })),
          }
        : {}),
      ...(Array.isArray(r?.actions) && r.actions.length
        ? {
            actions: r.actions
              .filter(
                (
                  a: PermissionAction | null,
                ): a is { id: string } & PermissionAction =>
                  !!a && typeof a.id === "string",
              )
              .map((a) => ({
                id: a.id,
                label: clip(a.label || a.id, 120),
                behavior: a.behavior === "deny" ? "deny" : "allow",
              })),
          }
        : {}),
    };
  });
}

/**
 * Build a permission response from the daemon's own copy of the request, so the
 * original tool input never round-trips through the browser.
 */
export function permissionResponse(raw: unknown, input: unknown) {
  const request = raw as PermissionRequest | null | undefined;
  // Anything without a valid `behavior` is refused below.
  const body = (input ?? {}) as {
    behavior?: unknown;
    actionId?: unknown;
    answers?: unknown;
  };
  const decision = body.behavior;
  if (decision !== "allow" && decision !== "deny")
    throw new Error("Invalid decision");
  const actionId =
    body.actionId === undefined
      ? undefined
      : typeof body.actionId === "string" &&
          ((request?.actions || []) as (PermissionAction | null)[]).some(
            (a) => a?.id === body.actionId,
          )
        ? body.actionId
        : (() => {
            throw new Error("Unknown action");
          })();
  if (decision === "deny")
    return {
      behavior: "deny" as const,
      message: "Denied by user",
      ...(actionId ? { selectedActionId: actionId } : {}),
    };
  if (body.answers === undefined)
    return {
      behavior: "allow" as const,
      ...(actionId ? { selectedActionId: actionId } : {}),
    };
  const questions = parseQuestions(request?.input);
  if (!questions) throw new Error("This request has no questions");
  const answers = body.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers))
    throw new Error("Invalid answers");
  const headers = new Set(questions.map((q) => q.header));
  for (const [key, value] of Object.entries(answers))
    if (!headers.has(key) || typeof value !== "string" || value.length > 10000)
      throw new Error("Invalid answers");
  return {
    behavior: "allow" as const,
    updatedInput: { ...(request?.input || {}), answers },
    ...(actionId ? { selectedActionId: actionId } : {}),
  };
}

// ── Bounded history ────────────────────────────────────────────────────────
export const TIMELINE = {
  /** The most of a conversation sent at once; older items are paged. */
  budgetBytes: 512 * 1024,
};
/** A shaped item with its place in the daemon's sequence. */
export type WindowItem = TimelineItem & { seq: number; last: number };
export type TimelineWindow = {
  epoch?: string;
  /**
   * Every row whose position (`seq`, the daemon's seqStart) is in
   * [from, to] is here, as are earlier rows updated since `from`.
   */
  from: number;
  to: number;
  items: WindowItem[];
  /** Rows exist before `from`. */
  hasOlder: boolean;
  /** The daemon answered a different epoch's tail (a stale cursor). */
  reset?: boolean;
  staleCursor?: boolean;
  /** Every row of the page, shaped (the window's superset), for updates. */
  page: WindowItem[];
  /** Where the page itself starts: absence before it proves nothing. */
  pageFrom: number;
  /** The daemon's head when this was read (pages may be served later). */
  asOf: number;
};
/**
 * One daemon timeline page, bounded to the byte budget. The daemon pages by
 * row count, but one row can be tens of kilobytes, so only the newest rows
 * within the budget are kept; as the daemon's own tail does, rows anchored
 * earlier but updated within what is kept (a tool that just finished) stay
 * too. The range it certifies comes from the daemon's rows, never from what
 * renders, so paging advances past rows that render as nothing.
 */
/**
 * One daemon change page (`direction: "after"`), bounded to the byte budget:
 * the entries changed after `after`, earliest change first, and the
 * sequence through which every change is included (`to`). Cut short by
 * bytes, `to` ends before the first entry left out, so the page never
 * claims a change it doesn't carry. A stale cursor's answer is the epoch's
 * tail (shaped as one); the daemon no longer holding changes that far back
 * is `changesLost`. `until` ends it where the reader's knowledge resumes.
 */
/** A daemon timeline page (the SDK's FetchAgentTimelinePayload); read defensively. */
type TimelinePage =
  | {
      epoch?: unknown;
      reset?: unknown;
      staleCursor?: unknown;
      hasOlder?: unknown;
      window?: { maxSeq?: number } | null;
      startCursor?: { seq?: number } | null;
      endCursor?: { seq?: number } | null;
      entries?: unknown;
    }
  | null
  | undefined;
/** A page's row, once it is known to have a position. */
type PageEntry = TimelineRow & {
  seqStart: number;
  seqEnd: number;
  sourceSeqRanges?: { startSeq?: unknown; endSeq?: unknown }[];
};
/** A page's rows that have a position (`seqStart`). */
const pageEntries = (t: TimelinePage): PageEntry[] =>
  (Array.isArray(t?.entries) ? t.entries : []).filter((e: TimelineRow | null) =>
    Number.isFinite(e?.seqStart),
  );

export function changesWindow(
  raw: unknown,
  after: number,
  until = Infinity,
  budget = TIMELINE.budgetBytes,
) {
  const t = raw as TimelinePage;
  if (t?.reset) {
    const {
      page: _page,
      pageFrom: _pageFrom,
      ...win
    } = timelineWindow(t, budget);
    return t?.staleCursor ? win : { ...win, changesLost: true };
  }
  const entries = pageEntries(t);
  const maxSeq = Number(t?.window?.maxSeq ?? t?.endCursor?.seq ?? after);
  const first = (e: PageEntry) => {
    const ranges =
      Array.isArray(e.sourceSeqRanges) && e.sourceSeqRanges.length
        ? e.sourceSeqRanges
        : [{ startSeq: e.seqStart, endSeq: e.seqEnd ?? e.seqStart }];
    const hits = ranges
      .filter((r) => Number(r?.endSeq) > after)
      .map((r) => Math.max(Number(r.startSeq), after + 1));
    return hits.length ? Math.min(...hits) : Infinity;
  };
  const ordered = entries
    .map((e) => ({ e, at: first(e) }))
    .sort((x, y) => x.at - y.at);
  const kept: { seq: number; items: WindowItem[] }[] = [];
  let bytes = 0;
  let to = Math.min(
    entries.length ? Number(t?.endCursor?.seq ?? maxSeq) : maxSeq,
    until,
  );
  for (const [i, { e, at }] of ordered.entries()) {
    // Only up to what the reader already knows from there on.
    if (at > to) break;
    const items = shapeTimeline([e]).map((x) => ({
      ...x,
      seq: e.seqStart,
      last: e.seqEnd ?? e.seqStart,
    }));
    const size = items.reduce(
      (n, x) => n + Buffer.byteLength(JSON.stringify(x)),
      0,
    );
    if (i > 0 && bytes + size > budget) {
      to = Math.min(to, at - 1);
      break;
    }
    bytes += size;
    kept.push({ seq: e.seqStart, items });
  }
  return {
    ...(typeof t?.epoch === "string" ? { epoch: t.epoch } : {}),
    after,
    from: after + 1,
    to,
    items: kept.sort((x, y) => x.seq - y.seq).flatMap((k) => k.items),
    hasNewer: to < maxSeq,
    asOf: maxSeq,
  };
}

export function timelineWindow(
  raw: unknown,
  budget = TIMELINE.budgetBytes,
): TimelineWindow {
  const t = raw as TimelinePage;
  const entries = pageEntries(t);
  const shaped = entries.map((e) =>
    shapeTimeline([e]).map((i) => ({
      ...i,
      seq: e.seqStart,
      last: e.seqEnd ?? e.seqStart,
    })),
  );
  const page = shaped.flat();
  const size = shaped.map((items) =>
    items.reduce((n, i) => n + Buffer.byteLength(JSON.stringify(i)), 0),
  );
  const endSeq =
    t?.endCursor?.seq ??
    t?.window?.maxSeq ??
    (entries.length ? entries[entries.length - 1].seqEnd : 0);
  const startSeq =
    t?.startCursor?.seq ?? (entries.length ? entries[0].seqStart : endSeq);
  // Kept: rows positioned at or after the cut, plus earlier rows updated
  // since. The cut moves later until that fits (at least one row stays).
  const keptFrom = (cut: number) =>
    entries
      .map((e, i) => i)
      .filter(
        (i) => entries[i].seqStart >= cut || (entries[i].seqEnd ?? 0) >= cut,
      );
  const bytes = (idx: number[]) => idx.reduce((n, i) => n + size[i], 0);
  let first = entries.length;
  while (first > 0 && bytes(keptFrom(entries[first - 1].seqStart)) <= budget)
    first--;
  if (first === entries.length && entries.length) first = entries.length - 1;
  const trimmed = first > 0;
  const kept = entries.length
    ? keptFrom(trimmed ? entries[first].seqStart : -Infinity)
    : [];
  return {
    ...(typeof t?.epoch === "string" ? { epoch: t.epoch } : {}),
    from: trimmed ? entries[first].seqStart : t?.hasOlder ? startSeq : 0,
    to: endSeq,
    items: kept.flatMap((i) => shaped[i]),
    hasOlder: trimmed || Boolean(t?.hasOlder),
    ...(t?.reset ? { reset: true } : {}),
    ...(t?.staleCursor ? { staleCursor: true } : {}),
    page,
    pageFrom: t?.hasOlder ? startSeq : 0,
    asOf: Number(t?.window?.maxSeq ?? endSeq),
  };
}
