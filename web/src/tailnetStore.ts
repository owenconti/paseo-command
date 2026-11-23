import { useSyncExternalStore } from "react";
import { api, errorMessage } from "./api";

/** Access over Tailscale, as the server says (`server/tailnet.ts`, `GET`/`POST /api/tailnet`): the release app's only. */
export type TailnetStatus = {
  available: boolean;
  why?: string;
  enabled: boolean;
  url?: string;
  owner?: string;
  error?: string;
};

let status: TailnetStatus | null = null;
let busy = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** This page was opened through Tailscale, not on the Mac: it can't switch access over Tailscale. */
export const remotePage = () => !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

export function refreshTailnet() {
  return api<TailnetStatus>("tailnet").then(
    (next) => {
      status = next;
      emit();
    },
    () => {},
  );
}

/** Turn it on or off; a refusal comes back as the status's `error`. */
export async function setTailnetOn(on: boolean) {
  if (busy) return;
  busy = true;
  emit();
  try {
    status = await api<TailnetStatus>("tailnet", { enabled: on });
  } catch (e) {
    await refreshTailnet();
    status = status && { ...status, error: errorMessage(e) || "Tailscale didn't take it." };
  } finally {
    busy = false;
    emit();
  }
}

let snapshot: { status: TailnetStatus | null; busy: boolean } = { status, busy };
const read = () => {
  if (snapshot.status !== status || snapshot.busy !== busy) snapshot = { status, busy };
  return snapshot;
};
let asked = false;
export function useTailnet() {
  if (!asked) {
    asked = true;
    void refreshTailnet();
  }
  return useSyncExternalStore(subscribe, read, read);
}
