import { useEffect, useRef } from "react";
import { onAppCommand } from "./appCommands";
import type { ShortcutKey } from "./shortcutKey";
import { macApp } from "./worldBridge";

/**
 * ⌘R: the shown page's own refresh, as its head's refresh button does (a GitHub PR or list, Files' tree and open file,
 * Files → Changes, Activity), never a reload of the web page. The view on screen registers it (`usePageRefresh`); the
 * last registered still mounted answers. Settings and the map register none: there the macOS app's View → Refresh Page
 * is disabled and a browser reloads as usual. The macOS app takes ⌘R through that menu item and sends `page-refresh`;
 * a browser's page takes it itself, only while a refresh is registered. One runs at a time: ⌘R in flight is ignored.
 */
type Refresh = () => unknown;
const registered: Array<{ run: () => unknown }> = [];
let running: Promise<unknown> | undefined;

/** Registers `refresh` while it's given (undefined: none, e.g. Files while its Changes show). */
export function usePageRefresh(refresh: Refresh | undefined) {
  const ref = useRef(refresh);
  ref.current = refresh;
  const on = !!refresh;
  useEffect(() => {
    if (!on) return;
    const entry = { run: () => ref.current?.() };
    registered.push(entry);
    return () => {
      const at = registered.indexOf(entry);
      if (at >= 0) registered.splice(at, 1);
    };
  }, [on]);
}

export const canRefreshPage = () => registered.length > 0;

/** Runs the shown page's refresh unless one is still running; false when no page has one. */
export function refreshPage(): boolean {
  const entry = registered.at(-1);
  if (!entry) return false;
  if (running) return true;
  const done: Promise<unknown> = Promise.resolve()
    .then(entry.run)
    .catch(() => {})
    .finally(() => {
      if (running === done) running = undefined;
    });
  running = done;
  return true;
}

/** ⌘R (⇧⌘R, the browser's hard reload, stays its own). */
export const isRefreshShortcut = (event: ShortcutKey) =>
  event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "r";

/** Listens for ⌘R (a browser's page) and `page-refresh` (the macOS app's View → Refresh Page, ⌘K). */
export function installPageRefresh(): () => void {
  const key = (e: KeyboardEvent) => {
    if (macApp() || e.defaultPrevented || !isRefreshShortcut(e) || !canRefreshPage()) return;
    e.preventDefault();
    refreshPage();
  };
  window.addEventListener("keydown", key);
  const off = onAppCommand("page-refresh", () => void refreshPage());
  return () => {
    window.removeEventListener("keydown", key);
    off();
  };
}
