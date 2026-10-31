/**
 * Slack's Web API, one method call at a time, with the tokens and the
 * per-method rate-limit cooldowns kept here. Slack is opt-in: the user token
 * (`slackUserToken`, xoxp) and the Socket Mode app token (`slackAppToken`,
 * xapp) are read from the data directory's secrets.json only while Slack is
 * enabled in settings.json (`integrationKey`); the environment is never read.
 * A method Slack rate limits waits out its `Retry-After`: reads during the
 * cooldown fail at once, `essential` calls (the user's own writes) still try.
 */
import WebSocket from "ws";
import { integrationEnabled, integrationKey } from "../integrations";

/** The smallest socket Socket Mode needs (ws's WebSocket, or the tests' fake). */
export type SlackSocket = {
  send(data: string): void;
  close(code?: number): void;
  on(event: "open", fn: () => void): unknown;
  on(event: "message", fn: (data: unknown) => void): unknown;
  on(event: "close", fn: (code: number) => void): unknown;
  on(event: "error", fn: (error: Error) => void): unknown;
  /** WebSocket-level pings and pongs: any frame shows the connection is alive. */
  on(event: "ping" | "pong", fn: () => void): unknown;
  /** Sends a WebSocket ping (Slack answers with a pong). */
  ping?(): void;
};

export const SLACK = {
  api: "https://slack.com/api/",
  timeoutMs: 10_000,
  /** Tests inject this; nothing else calls Slack. */
  fetch: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch,
  /** Opens Socket Mode's WebSocket (a handshake that stalls fails after 10 s); tests inject a fake. */
  connect: (url: string): SlackSocket => new WebSocket(url, { handshakeTimeout: 10_000 }) as unknown as SlackSocket,
};

export type SlackErrorKind = "no-key" | "refused" | "limited" | "failed" | "invalid";

export class SlackError extends Error {
  kind: SlackErrorKind;
  retryAt?: number;
  /** Slack's own error code ("channel_not_found"), when it gave one. */
  code?: string;
  constructor(kind: SlackErrorKind, message: string, retryAt?: number, code?: string) {
    super(message);
    this.name = "SlackError";
    this.kind = kind;
    this.retryAt = retryAt;
    this.code = code;
  }
}

export const DISABLED = "Enable Slack in Settings to see your messages.";
export const NO_TOKEN = "Add your Slack user token in Settings to use Slack.";
export const NO_APP_TOKEN = "Add a Slack app token in Settings for live updates; messages refresh every 20 s.";

/** The user token, only while Slack is enabled; else undefined. */
export const slackUserToken = () => integrationKey("slack");
/** The Socket Mode app token, only while Slack is enabled; else undefined. */
export const slackAppToken = () => integrationKey("slackApp");
/** Whether Slack is on in settings.json. */
export const slackEnabled = () => integrationEnabled("slack");

/** Why there is no token: Slack is off, or on without `slackUserToken`. */
export const slackUnavailable = () => (slackEnabled() ? NO_TOKEN : DISABLED);

/** When each method may be called again (epoch ms), after Slack rate limited it. */
const cooldowns = new Map<string, number>();

/** Forgets the cooldowns (tests). */
export function resetSlackClient(): void {
  cooldowns.clear();
}

/** When `method` may be called again, if Slack has it cooling down. */
export function slackCooldown(method: string): number | undefined {
  const until = cooldowns.get(method);
  return until !== undefined && until > Date.now() ? until : undefined;
}

const REFUSED = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "not_allowed_token_type"]);
/** Slack's errors that mean the request itself was wrong (or no longer fits), not that Slack failed. */
const INVALID = new Set([
  "channel_not_found",
  "message_not_found",
  "thread_not_found",
  "user_not_found",
  "users_not_found",
  "file_not_found",
  "cant_update_message",
  "cant_delete_message",
  "cant_broadcast_message",
  "edit_window_closed",
  "msg_too_long",
  "no_text",
  "invalid_arguments",
  "invalid_arg_name",
  "invalid_blocks",
  "invalid_name",
  "invalid_timestamp",
  "invalid_ts_latest",
  "invalid_ts_oldest",
  "invalid_cursor",
  "already_reacted",
  "no_reaction",
  "too_many_reactions",
  "too_many_emoji",
  "not_in_channel",
  "is_archived",
  "restricted_action",
  "cannot_dm_bot",
  "too_many_users",
  "not_enough_users",
  "markdown_text_conflict",
]);
const PLAIN: Record<string, string> = {
  channel_not_found: "Slack can't find that conversation.",
  message_not_found: "Slack can't find that message.",
  not_in_channel: "You're not in that channel.",
  is_archived: "That conversation is archived.",
  msg_too_long: "The message is too long for Slack.",
  edit_window_closed: "Slack no longer lets you edit that message.",
  cant_update_message: "Slack won't let you edit that message.",
  cant_delete_message: "Slack won't let you delete that message.",
  already_reacted: "You've already reacted with that emoji.",
  no_reaction: "You haven't reacted with that emoji.",
  invalid_name: "Slack doesn't know that emoji.",
  file_not_found: "Slack can't find that file.",
};

/** Slack's error code in plain words ("channel_not_found" → "Slack said: channel not found."). */
export const plainError = (code: string) =>
  PLAIN[code] ?? `Slack said: ${code.replace(/_/g, " ").replace(/[^\w :.'-]/g, "").slice(0, 100) || "it failed"}.`;

/** When to try again after HTTP 429 or `ratelimited`: Retry-After seconds, else a minute on. */
function retryTime(headers: Headers): number {
  const after = Number(headers.get("retry-after")?.trim());
  return Date.now() + (Number.isFinite(after) && after > 0 ? Math.min(after, 3600) : 60) * 1000;
}

type Params = Record<string, unknown>;
export type CallOptions = {
  /** The user's own action: sent even while the method is cooling down. */
  essential?: boolean;
  /** Which token: the user's (default) or the Socket Mode app token. */
  token?: "user" | "app";
  /** Send a JSON body (chat.postMessage and others that take structured fields); else a form. */
  json?: boolean;
};

/** Calls one Web API method and returns Slack's answer (with `ok: true`); failures are SlackErrors. */
export async function slackCall<T = Record<string, unknown>>(
  method: string,
  params: Params = {},
  opts: CallOptions = {},
): Promise<T> {
  const token = opts.token === "app" ? slackAppToken() : slackUserToken();
  if (!token) {
    if (opts.token === "app") throw new SlackError("no-key", slackEnabled() ? NO_APP_TOKEN : DISABLED);
    throw new SlackError("no-key", slackUnavailable());
  }
  const until = slackCooldown(method);
  if (!opts.essential && until !== undefined)
    throw new SlackError("limited", "Slack asked us to slow down; trying again shortly.", until, "ratelimited");
  const defined = Object.entries(params).filter(([, v]) => v !== undefined);
  let body: string;
  let type: string;
  if (opts.json) {
    body = JSON.stringify(Object.fromEntries(defined));
    type = "application/json; charset=utf-8";
  } else {
    const form = new URLSearchParams();
    for (const [k, v] of defined) form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    body = form.toString();
    type = "application/x-www-form-urlencoded";
  }
  let res: Response;
  try {
    res = await SLACK.fetch(SLACK.api + method, {
      method: "POST",
      headers: { "Content-Type": type, Authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(SLACK.timeoutMs),
    });
  } catch {
    throw new SlackError("failed", "Slack could not be reached.");
  }
  if (res.status === 429) {
    const retryAt = retryTime(res.headers);
    cooldowns.set(method, retryAt);
    throw new SlackError("limited", "Slack asked us to slow down; trying again shortly.", retryAt, "ratelimited");
  }
  const answer = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean }) | null;
  if (!answer || typeof answer !== "object") throw new SlackError("failed", `Slack answered ${res.status}.`);
  if (answer.ok === true) return answer as T;
  const code = typeof answer.error === "string" ? answer.error : "";
  if (code === "ratelimited" || code === "rate_limited") {
    const retryAt = retryTime(res.headers);
    cooldowns.set(method, retryAt);
    throw new SlackError("limited", "Slack asked us to slow down; trying again shortly.", retryAt, code);
  }
  if (REFUSED.has(code)) throw new SlackError("refused", "Slack refused the token.", undefined, code);
  if (code === "missing_scope") {
    const needed = typeof answer.needed === "string" && /^[\w:.,]{1,200}$/.test(answer.needed) ? answer.needed : "";
    throw new SlackError(
      "refused",
      needed ? `Slack refused: the token needs the ${needed} scope.` : "Slack refused: the token is missing a scope.",
      undefined,
      code,
    );
  }
  if (!code) throw new SlackError("failed", `Slack answered ${res.status}.`);
  throw new SlackError(INVALID.has(code) ? "invalid" : "failed", plainError(code), undefined, code);
}
