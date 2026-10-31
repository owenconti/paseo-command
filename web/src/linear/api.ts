import { api } from "../api";
import type { LinearUnavailable, LinearUploaded } from "./types";

type Transport = (path: string, body?: unknown) => Promise<unknown>;
let transport: Transport = (path, body) => api(path, body);

/** Tests send the page's requests to a fake instead of the server (null restores the real one). */
export function setLinearTransport(next: Transport | null): void {
  transport = next ?? ((path, body) => api(path, body));
}

/** One of the server's named Linear reads; `LinearUnavailable` when Linear can't be asked right now. */
export function linearRead<T>(
  name:
    | "workspace"
    | "issues"
    | "byId"
    | "issue"
    | "cycles"
    | "views"
    | "search"
    | "notifications"
    | "sync"
    | "status",
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

type Uploader = (file: Blob, name: string) => Promise<LinearUploaded>;
const serverUploader: Uploader = async (file, name) => {
  const params = new URLSearchParams({ name, type: file.type || "application/octet-stream" });
  const res = await fetch(`/api/linear/upload?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "The upload didn't go through.");
  return result as LinearUploaded;
};
let uploader = serverUploader;

/** Tests upload to a fake instead of the server (null restores the real one). */
export function setLinearUploader(next: Uploader | null): void {
  uploader = next ?? serverUploader;
}

/** Uploads a file to Linear through the app server (which holds the key); rejects with why it didn't go. */
export function uploadToLinear(file: Blob, name: string): Promise<LinearUploaded> {
  return uploader(file, name);
}
