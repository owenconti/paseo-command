/**
 * The macOS app's terminal font (Settings → Terminal): its family, size, line height and letter spacing, for
 * the terminal panel and the Files page's editors alike. The app keeps them in its preferences; the page asks
 * for them (`terminalFont`) and the installed monospaced families, and sets them (`terminalFont` with `set`);
 * the app answers each, and ⌘+ / ⌘− / ⌘0 in a terminal, with `paseo:terminal-font`. In a browser there is none.
 */
import { useEffect, useSyncExternalStore } from "react";
import { askAppTerminalFont, macApp, postAppTerminalFont } from "./worldBridge";

export type TerminalFontValues = { family: string; size: number; lineHeight: number; letterSpacing: number };
export type TerminalFont = TerminalFontValues & {
  defaults: TerminalFontValues;
  ranges: Record<"size" | "lineHeight" | "letterSpacing", [number, number]>;
  /** The installed monospaced families ("" is the system's monospace, not listed). */
  families: string[];
};

let font: TerminalFont | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
let listening = false;
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("paseo:terminal-font", (event) => {
    const detail = (event as CustomEvent).detail as Partial<TerminalFont> | null;
    if (!detail || typeof detail.size !== "number") return;
    // A change's answer leaves the families out; the ones asked for stay.
    font = { ...(font ?? { families: [] }), ...detail } as TerminalFont;
    emit();
  });
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The terminal font, asked for as it's first shown (null in a browser, or until the app answers). */
export function useTerminalFont(): TerminalFont | null {
  useEffect(() => {
    if (!macApp()) return;
    listen();
    askAppTerminalFont();
  }, []);
  return useSyncExternalStore(subscribe, () => font);
}

/** Change some of the values; the app clamps them, applies them to every terminal and answers. */
export function setTerminalFont(change: Partial<TerminalFontValues>) {
  if (font) {
    font = { ...font, ...change };
    emit();
  }
  postAppTerminalFont(change);
}

/** A family's name as shown: the system's monospace is "" in the app. */
export const familyLabel = (family: string) => family || "System monospace";
/** The CSS family a preview is drawn in. */
export const familyCss = (family: string) =>
  family ? `"${family.replace(/["\\]/g, "")}", ui-monospace, monospace` : "ui-monospace, SFMono-Regular, Menlo, monospace";
