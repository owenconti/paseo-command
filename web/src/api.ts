import { agentApiPath } from "./agentIdentity";
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  ({ path, body } = agentApiPath(path, body));
  const res = await fetch(`/api/${path}`, {
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(result.error || "Request failed", res.status);
  return result;
}
/** A failed API request, with its HTTP status (404: no such agent). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
/** The message of whatever was thrown, or "" when it carries none. */
export function errorMessage(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? error.message
      : undefined;
  return typeof message === "string" ? message : "";
}
// Keep React inputs stable when a poll reports the same snapshot.
export function retainSnapshot<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
/**
 * Unchanged rows keep their identity across polls, so the map (memoised on
 * them) redraws only what changed.
 */
export function retainRows<T>(previous: T[], next: unknown): T[] {
  if (!Array.isArray(next)) return retainSnapshot(previous, next as T[]);
  const known = new Map(previous.map((row) => [JSON.stringify(row), row]));
  const rows = next.map((row) => known.get(JSON.stringify(row)) ?? (row as T));
  return rows.length === previous.length &&
    rows.every((row, i) => row === previous[i])
    ? previous
    : rows;
}
export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`paseo-command:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function writeStore(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  // Remembered prompt thumbnails are the bulk of what's stored; when the quota
  // is full, drop the oldest of them rather than silently losing drafts.
  do {
    try {
      localStorage.setItem(`paseo-command:${key}`, raw);
      return true;
    } catch {
      // Storage is a convenience; private windows may refuse it.
    }
  } while (evictOldestSent());
  return false;
}
export function removeStore(key: string) {
  try {
    localStorage.removeItem(`paseo-command:${key}`);
  } catch {
    // As above.
  }
}
function evictOldestSent() {
  try {
    const index = readStore<string[]>("sent-index", []);
    if (!index.length) return false;
    for (const id of index.splice(0, 10))
      localStorage.removeItem(`paseo-command:sent:${id}`);
    localStorage.setItem("paseo-command:sent-index", JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}
export function ago(time: number | string | undefined) {
  if (!time) return "";
  const ms = typeof time === "number" ? time : Date.parse(time);
  if (!Number.isFinite(ms)) return typeof time === "string" ? time : "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
/** Paseo lists report "13 minutes ago"; the fleet wants "13m". */
export function compactAgo(text: string) {
  const m =
    /^(\d+)\s+(second|minute|hour|day|week|month|year)s?(?: ago)?$/.exec(
      text.trim(),
    );
  if (!m) return text.replace(/ ago$/, "");
  return `${m[1]}${{ second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y" }[m[2]]}`;
}
