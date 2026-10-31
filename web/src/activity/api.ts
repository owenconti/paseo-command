import { api } from "../api";
import type { ActivityFeed, ActivityWriteName, ActivityWriteResult } from "./types";

type Transport = (path: string, body?: unknown) => Promise<unknown>;
const real: Transport = (path, body) => api(path, body);
let transport: Transport = real;

/** Tests send the page's requests to a fake instead of the server (null restores the real one). */
export function setActivityTransport(next: Transport | null): void {
  transport = next ?? real;
}

/** The feed; `fresh` asks past the sources' caches. */
export function readActivity(fresh = false): Promise<ActivityFeed> {
  return transport(`activity${fresh ? "?fresh=1" : ""}`) as Promise<ActivityFeed>;
}

/** Marks these items read, unread or done; rejects when the server couldn't try. */
export function writeActivity(name: ActivityWriteName, keys: string[]): Promise<ActivityWriteResult> {
  return transport(`activity/m/${name}`, { keys }) as Promise<ActivityWriteResult>;
}
