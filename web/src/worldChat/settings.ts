import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "../api";

/** Whether picking a robot on the Dungeon Board opens its dialogue box (on by default; T and ⌘K open it
 * either way). Kept in localStorage. */
const STORE = "world:talkOnPick";
let talkOnPick = readStore<unknown>(STORE, true) !== false;
const listeners = new Set<() => void>();

export const talkOnPickSetting = () => talkOnPick;

export function setTalkOnPick(on: boolean) {
  if (on === talkOnPick) return;
  talkOnPick = on;
  writeStore(STORE, on);
  listeners.forEach((listener) => listener());
}

export function useTalkOnPick(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => talkOnPick,
  );
}
