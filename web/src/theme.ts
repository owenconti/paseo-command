import type { UnityWorldKind } from "./worldBridge";
import { useCallback, useSyncExternalStore } from "react";
import { readStore, writeStore } from "./api";
import { soundEvent, soundSetFor } from "./soundCues";
import {
  THEME_ORDER,
  THEME_BACKGROUND,
  validTheme,
  resolveTheme,
  type ThemeSetting,
  type ResolvedTheme,
} from "./themeOptions";
export {
  themeLabel,
  type ThemeSetting,
  type ResolvedTheme,
} from "./themeOptions";

// Stored as `paseo-command:theme` (JSON string); index.html reads the same key
// before first paint so the page never flashes the wrong theme.
const KEY = "theme";

const media =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined;

let setting: ThemeSetting = validTheme(readStore<unknown>(KEY, "system"));
let unityWorldKind: UnityWorldKind | null = null;
/** The theme shortcut steps through the worlds in this order. */
const WORLD_ORDER: UnityWorldKind[] = ["galaxy", "lake", "atlas", "diorama"];
let worldTheme: ResolvedTheme | null =
  typeof window !== "undefined" && window.__PASEO_UNITY__
    ? readStore<string>("unity-world-ui", "galaxy") === "lake-country"
      ? "lake-country"
      : "galaxy"
    : null;
let resolved: ResolvedTheme = worldTheme || resolve(setting);
const listeners = new Set<() => void>();

function resolve(s: ThemeSetting): ResolvedTheme {
  return resolveTheme(s, !!media?.matches);
}

function apply() {
  resolved = worldTheme || resolve(setting);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_BACKGROUND[resolved]);
  listeners.forEach((l) => l());
}

const onSystemChange = () => {
  if (setting === "system") apply();
};
// Keep other tabs in sync.
const onStorage = (e: StorageEvent) => {
  if (e.key !== null && e.key !== `paseo-command:${KEY}`) return;
  setting = validTheme(readStore<unknown>(KEY, "system"));
  apply();
};
// ⌘⌥T / Ctrl+Alt+T cycles the theme (matches Paseo). Use e.code: Option
// changes e.key on macOS.
const onKey = (e: KeyboardEvent) => {
  if (e.code !== "KeyT" || !e.altKey || e.shiftKey) return;
  if (!(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  cycleTheme();
};
media?.addEventListener("change", onSystemChange);
window.addEventListener("storage", onStorage);
window.addEventListener("keydown", onKey);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("keydown", onKey);
  });
apply();

export function setThemeSetting(next: ThemeSetting) {
  const before = resolved;
  setting = validTheme(next);
  writeStore(KEY, setting);
  apply();
  // Choosing a world's look enters that world (Light and Dark aren't worlds).
  if (
    resolved !== before &&
    (resolved === "galaxy" || resolved === "lake-country")
  )
    soundEvent("worldChanged", { set: soundSetFor(resolved) });
}

/** The theme shown now. */
export const currentTheme = () => resolved;

/** Match the running world without replacing the ordinary browser preference.
 * Atlas and Diorama reuse the Lake Country panel theme. */
export function setUnityWorldTheme(theme: UnityWorldKind | null) {
  unityWorldKind = theme;
  if (theme) writeStore("unity-world-kind", theme);
  worldTheme = theme === "galaxy" || theme === null ? theme : "lake-country";
  if (worldTheme) writeStore("unity-world-ui", worldTheme);
  apply();
}

export function cycleTheme() {
  if (worldTheme) {
    window.dispatchEvent(
      new CustomEvent("paseo:world-theme-request", {
        detail:
          WORLD_ORDER[
            (WORLD_ORDER.indexOf(
              unityWorldKind ?? (worldTheme === "galaxy" ? "galaxy" : "lake"),
            ) +
              1) %
              WORLD_ORDER.length
          ],
      }),
    );
    return;
  }
  setThemeSetting(
    THEME_ORDER[(THEME_ORDER.indexOf(setting) + 1) % THEME_ORDER.length],
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
// One snapshot object per change so useSyncExternalStore sees a stable value.
let snapshot = { setting, resolved, worldMatched: !!worldTheme };
const getSnapshot = () => {
  if (
    snapshot.setting !== setting ||
    snapshot.resolved !== resolved ||
    snapshot.worldMatched !== !!worldTheme
  )
    snapshot = { setting, resolved, worldMatched: !!worldTheme };
  return snapshot;
};

export function useTheme() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setSetting = useCallback((s: ThemeSetting) => setThemeSetting(s), []);
  const cycle = useCallback(() => cycleTheme(), []);
  return { ...state, setSetting, cycle };
}
