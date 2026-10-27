/**
 * The one boundary where values become bytes for a client, whatever the
 * transport (JSON replies, SSE, WebSocket): every `error` field is redacted
 * and bounded here, so no route or stream can send a daemon's raw message.
 */
import { messageOf } from "./errors";
import { redactText } from "./redact";

/**
 * A failure's text, for an `error` field. Not redacted here: `encode`
 * redacts every `error` field on the way out, the one place that does.
 */
export function errorText(error: unknown, fallback = "Request failed") {
  const raw = messageOf(error) ?? (typeof error === "string" ? error : "");
  return String(raw || fallback);
}

/** Serialize for any client. */
export function encode(value: unknown) {
  return JSON.stringify(value, (key, v) =>
    key === "error" && typeof v === "string" ? redactText(v).slice(0, 500) : v,
  );
}
