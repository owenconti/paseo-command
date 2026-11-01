import { useEffect, useSyncExternalStore } from "react";
import { readStore, writeStore } from "./api";
import { onAppCommand } from "./appCommands";

/** The pages' text size (Linear, Slack, Activity and Settings, which the page draws in the
 * map's place): pixels over the app's own sizes, 2 by default, one size for all of them.
 * ⌘+ and ⌘− step it, ⌘0 puts it back; `--page-text` carries it to their stylesheets
 * (`styles/pages.css`), and `--page-scale` grows their columns, rows and controls with it. */
export const TEXT_STEP = { default: 2, min: -2, max: 12 };

export type TextChange = "bigger" | "smaller" | "actual";

/** ⌘+ (or ⌘=, as + needs ⇧ on most layouts), ⌘− and ⌘0; null for any other key. */
export function textSizeKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): TextChange | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "+" || e.key === "=") return "bigger";
  if (e.key === "-" || e.key === "_") return "smaller";
  if (e.key === "0") return "actual";
  return null;
}

/** How much larger than at the default size the text is (1 there): `--page-scale`. */
export const textScale = (step: number) => (14 + step) / (14 + TEXT_STEP.default);

/** The scale now in force, for sizes laid out in script. */
export const shownTextScale = () =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--page-scale")) || 1;

export function changeTextStep(step: number, change: TextChange): number {
  if (change === "actual") return TEXT_STEP.default;
  return Math.max(TEXT_STEP.min, Math.min(TEXT_STEP.max, step + (change === "bigger" ? 1 : -1)));
}

/** A remembered step, or the default for anything that isn't one. */
export function checkTextStep(step: unknown): number {
  return typeof step === "number" && Number.isInteger(step) && step >= TEXT_STEP.min && step <= TEXT_STEP.max
    ? step
    : TEXT_STEP.default;
}

const STORE = "pages:textSize";
// Linear's own size, from before the pages shared one, is where it starts.
let step = checkTextStep(readStore<unknown>(STORE, readStore<unknown>("linear:textSize", undefined)));
const listeners = new Set<() => void>();
function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--page-text", `${step}px`);
  document.documentElement.style.setProperty("--page-scale", String(textScale(step)));
}
apply();

export function resizePageText(change: TextChange) {
  step = changeTextStep(step, change);
  writeStore(STORE, step);
  apply();
  listeners.forEach((listener) => listener());
}

export function usePageTextStep() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => step,
  );
}

/** While a page shows, ⌘+ ⌘− ⌘0 (anywhere in the page) and the palette's commands size its text. */
export function usePageTextKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      const change = textSizeKey(e);
      if (!change) return;
      e.preventDefault();
      resizePageText(change);
    };
    window.addEventListener("keydown", key);
    const offs = [
      onAppCommand("page-text-bigger", () => resizePageText("bigger")),
      onAppCommand("page-text-smaller", () => resizePageText("smaller")),
      onAppCommand("page-text-actual", () => resizePageText("actual")),
    ];
    return () => {
      window.removeEventListener("keydown", key);
      offs.forEach((off) => off());
    };
  }, [active]);
}
