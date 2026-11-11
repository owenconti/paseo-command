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

/** A setting of the board's kept in localStorage, shared across the page. */
function setting(store: string, initial: boolean) {
  let value = readStore<unknown>(store, initial) === !initial ? !initial : initial;
  const subscribers = new Set<() => void>();
  return {
    get: () => value,
    set(on: boolean) {
      if (on === value) return;
      value = on;
      writeStore(store, on);
      subscribers.forEach((listener) => listener());
    },
    use: () =>
      useSyncExternalStore(
        (listener) => {
          subscribers.add(listener);
          return () => subscribers.delete(listener);
        },
        () => value,
      ),
  };
}

/** Whether agents' own browser tools (Paseo's `browser_*`) open and drive tabs in the board's browser: the macOS
 * app registers as a browser host on each daemon while this is on (off by default: with it on, agents' browser
 * calls come here rather than to the Paseo app's browser). */
const browserTools = setting("world:browserTools", false);
export const browserToolsSetting = browserTools.get;
export const setBrowserTools = browserTools.set;
export const useBrowserTools = browserTools.use;

/** Whether the board's browser shows itself when the agent you are talking to opens a tab (on by default). */
const browserFollows = setting("world:browserFollows", true);
export const browserFollowsSetting = browserFollows.get;
export const setBrowserFollows = browserFollows.set;
export const useBrowserFollows = browserFollows.use;

/** Whether the browser shows above the dialogue box (B; kept as you step from robot to robot and across launches). */
const browserOpen = setting("world:browserOpen", false);
export const browserOpenSetting = browserOpen.get;
export const setBrowserOpen = browserOpen.set;
export const useBrowserOpen = browserOpen.use;
