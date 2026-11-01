import { useSyncExternalStore } from "react";
import { macApp, postAppMenu } from "./worldBridge";

/** A part of Settings to open at: an integration's key editor. */
export type SettingsTarget = "linear" | "slack" | "typesafe" | null;

/**
 * Settings is a page in the map's place. In the macOS app it is one of the
 * app's sides (`paseo:mode` `settings`), which its mode bar's gear, the app
 * menu's Settings… (⌘,) and these calls switch to; in a browser the page keeps
 * whether it shows itself.
 */
let shown = false;
/** Where the next opening puts the keyboard, with a revision so a second request refocuses. */
let request = { target: null as SettingsTarget, revision: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function openSettings(target: SettingsTarget = null) {
  request = { target, revision: request.revision + 1 };
  if (macApp()) postAppMenu("settings");
  else shown = true;
  emit();
}

export function closeSettings() {
  if (macApp()) postAppMenu("settings-close");
  else shown = false;
  emit();
}

/** Whether Settings shows: the app's side in the macOS app, else the page's own choice. */
export function useSettingsShown(appMode: string): boolean {
  const own = useSyncExternalStore(subscribe, () => shown);
  return macApp() ? appMode === "settings" : own;
}

/** The latest request's target and revision (the page focuses there as it changes). */
export function useSettingsRequest() {
  return useSyncExternalStore(subscribe, () => request);
}
