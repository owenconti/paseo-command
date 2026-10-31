import { api } from "../api";
import type { LinearUnavailable } from "./types";

type Transport = (path: string, body?: unknown) => Promise<unknown>;
let transport: Transport = (path, body) => api(path, body);

/** Tests send the page's requests to a fake instead of the server (null restores the real one). */
export function setLinearTransport(next: Transport | null): void {
  transport = next ?? ((path, body) => api(path, body));
}

/** One of the server's named Linear reads; `LinearUnavailable` when Linear can't be asked right now. */
export function linearRead<T>(
  name: "workspace" | "issues" | "byId" | "issue" | "cycles" | "views" | "search" | "sync" | "status",
  params: Record<string, string> = {},
): Promise<T | LinearUnavailable> {
  const query = new URLSearchParams(params).toString();
  return transport(`linear/q/${name}${query ? `?${query}` : ""}`) as Promise<T | LinearUnavailable>;
}

/** One of the server's whitelisted Linear writes; rejects with Linear's message. */
export function linearWrite<T>(name: string, input: unknown): Promise<T> {
  return transport(`linear/m/${name}`, input ?? {}) as Promise<T>;
}

/** Whether a read answered "not now" (no key, refused, rate limited) instead of with data. */
export function isUnavailable(value: unknown): value is LinearUnavailable {
  return typeof value === "object" && value !== null && (value as { available?: unknown }).available === false;
}
