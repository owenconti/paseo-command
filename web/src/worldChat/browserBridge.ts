/**
 * The Dungeon Board's browser in the macOS app (`BoardBrowser.swift`): each agent has its own tabs, whose
 * pages the app draws over a box the page lays out (`BoardBrowser.tsx`). The page says whose browser shows
 * and where (`browser`), asks for what its tab strip and address bar do (`browserDo`), and says whether
 * agents' own browser tools open tabs here (`browserHost`: Settings → Map). The app tells the page
 * (`paseo:browser`) every browser's tabs (`state`), when an agent opened one (`opened`), when an address
 * was refused (`refused`) and a key it took for the page while a web page had the keyboard (`key`: ⌘L its
 * address, ⌘T a new tab, ⇧⌘W hide the browser).
 */
import { useSyncExternalStore } from "react";

type Channel = { postMessage(message: unknown): void };
const channel = () =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: Channel } } }).webkit?.messageHandlers?.paseoWorld;

export type BrowserTab = { id: string; url: string; title: string; loading: boolean; back: boolean; forward: boolean; error?: string };
export type AgentBrowser = { host: string; agent: string; current: string; tabs: BrowserTab[] };
/** Whether the app is a browser host for agents' tools: asked for, its socket open, and each daemon's answer. */
export type BrowserHosting = { enabled: boolean; connected: boolean; hosts: { host: string; state: string; error?: string }[] };
export type BoardBrowserState = { browsers: Record<string, AgentBrowser>; hosting: BrowserHosting };

/** An agent's browser, as the app keys it: its host ("local" for this machine's daemon) and its daemon id. */
export const browserKey = (host: string | undefined, agent: string) => `${host || "local"}|${agent}`;

const EMPTY: BoardBrowserState = { browsers: {}, hosting: { enabled: false, connected: false, hosts: [] } };
let state = EMPTY;
const listeners = new Set<() => void>();

export type BrowserEvent =
  | { type: "opened"; host: string; agent: string; tab: string }
  | { type: "refused"; message: string }
  | { type: "key"; action: "address" | "new" | "hide" };
const watchers = new Set<(event: BrowserEvent) => void>();

const text = (v: unknown, max = 4096) => (typeof v === "string" ? v.slice(0, max) : "");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The app's account, read strictly: only the fields the page draws. */
export function readBrowserState(detail: unknown): BoardBrowserState {
  if (!isRecord(detail)) return EMPTY;
  const browsers: Record<string, AgentBrowser> = {};
  for (const [key, raw] of Object.entries(isRecord(detail.browsers) ? detail.browsers : {})) {
    if (!isRecord(raw) || !Array.isArray(raw.tabs)) continue;
    const tabs = raw.tabs.filter(isRecord).flatMap((t): BrowserTab[] => {
      const id = text(t.id, 80);
      if (!id) return [];
      const error = text(t.error, 600);
      return [{ id, url: text(t.url), title: text(t.title, 300), loading: t.loading === true, back: t.back === true, forward: t.forward === true, ...(error ? { error } : {}) }];
    });
    browsers[key] = { host: text(raw.host, 200) || "local", agent: text(raw.agent, 400), current: text(raw.current, 80), tabs };
  }
  const hosting = isRecord(detail.hosting) ? detail.hosting : {};
  return {
    browsers,
    hosting: {
      enabled: hosting.enabled === true,
      connected: hosting.connected === true,
      hosts: (Array.isArray(hosting.hosts) ? hosting.hosts : []).filter(isRecord).map((h) => {
        const error = text(h.error, 300);
        return { host: text(h.host, 200), state: text(h.state, 40), ...(error ? { error } : {}) };
      }),
    },
  };
}

let listening = false;
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("paseo:browser", (event) => {
    const detail = (event as CustomEvent).detail;
    if (!isRecord(detail)) return;
    if (detail.type === "state") {
      state = readBrowserState(detail);
      listeners.forEach((l) => l());
    } else if (detail.type === "opened") {
      const opened = { type: "opened" as const, host: text(detail.host, 200) || "local", agent: text(detail.agent, 400), tab: text(detail.tab, 80) };
      if (opened.agent && opened.tab) watchers.forEach((w) => w(opened));
    } else if (detail.type === "refused") {
      const message = text(detail.message, 600);
      if (message) watchers.forEach((w) => w({ type: "refused", message }));
    } else if (detail.type === "key" && (detail.action === "address" || detail.action === "new" || detail.action === "hide")) {
      const action = detail.action;
      watchers.forEach((w) => w({ type: "key", action }));
    }
  });
  // What it holds already (tabs from the last launch).
  channel()?.postMessage({ type: "browserState" });
}

/** Every agent's browser and the hosting state, as the app last said. */
export function useBoardBrowsers(): BoardBrowserState {
  return useSyncExternalStore(
    (listener) => {
      listen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
export const boardBrowsers = () => state;

export function onBrowserEvent(handler: (event: BrowserEvent) => void) {
  listen();
  watchers.add(handler);
  return () => {
    watchers.delete(handler);
  };
}

export type Rect = { x: number; y: number; width: number; height: number };
export type BrowserPlacement = Rect & {
  /** The agent whose browser shows (none: nothing shows). */
  host?: string;
  agent?: string;
  workspace?: string;
  /** A dialog of the page's is open over it. */
  covered: boolean;
  /** The page's own things lying over the box (a menu, a hint): cut out of the web page so they show. */
  holes: Rect[];
};
let last = "";
/** Where the browser goes. Sent only when it changes, unless `force`. */
export function postBrowserPlacement(p: BrowserPlacement, force = false) {
  const key = JSON.stringify(p);
  if (key === last && !force) return;
  last = key;
  channel()?.postMessage({ type: "browser", ...p });
}
export const hideBrowser = () => postBrowserPlacement({ x: 0, y: 0, width: 0, height: 0, covered: false, holes: [] });

export type BrowserAction = "open" | "navigate" | "back" | "forward" | "reload" | "stop" | "close" | "select" | "focus";
/** What the tab strip and address bar do, in the app. */
export const browserDo = (action: BrowserAction, fields: { host?: string; agent?: string; workspace?: string; tab?: string; url?: string } = {}) =>
  channel()?.postMessage({ type: "browserDo", action, ...fields, ...(fields.host !== undefined || fields.agent ? { host: fields.host || "local" } : {}) });

/** Agents' own browser tools open and drive tabs in the app (Settings → Map). */
export const postBrowserHost = (enabled: boolean) => channel()?.postMessage({ type: "browserHost", enabled });

/** What an address field shows for a page: its address without the scheme's clutter. */
export function shortAddress(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
/** A tab's label: its page's title, else where it is. */
export const tabLabel = (tab: Pick<BrowserTab, "title" | "url">) => tab.title.trim() || shortAddress(tab.url) || "New tab";
