import { useSyncExternalStore } from "react";
import { readStore, removeStore, writeStore } from "../api";

/**
 * The Files tab editor's text size and line height (Settings → Files). Kept in localStorage, apart from the editor's code
 * so Settings and the palette don't load it, and set on the page as `--files-font-size` and `--files-line-height`, which
 * the editor's look reads (`code/editor.ts`); its open views measure again as they change (`store.ts`). Unset, the size
 * follows the pages' text size (⌘+ / ⌘−) and the line height is 1.55.
 */
export const FILES_LOOK = {
  size: { min: 9, max: 28, step: 1 },
  lineHeight: { min: 1, max: 2.4, step: 0.05, default: 1.55 },
};
export type FilesLook = { fontSize: number | null; lineHeight: number };
const SIZE = "files:fontSize";
const LINE = "files:lineHeight";

const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, n));
function read(): FilesLook {
  const size = readStore<unknown>(SIZE, null);
  const line = readStore<unknown>(LINE, null);
  return {
    fontSize: typeof size === "number" && Number.isFinite(size) ? clamp(Math.round(size), FILES_LOOK.size) : null,
    lineHeight: typeof line === "number" && Number.isFinite(line) ? clamp(line, FILES_LOOK.lineHeight) : FILES_LOOK.lineHeight.default,
  };
}
let look = read();
const listeners = new Set<() => void>();

/** The page's variables for it: a size only when set (else the editor's own, the pages' text size). */
function apply() {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  if (look.fontSize === null) root.removeProperty("--files-font-size");
  else root.setProperty("--files-font-size", `${look.fontSize}px`);
  root.setProperty("--files-line-height", String(look.lineHeight));
}
apply();

export const filesLook = () => look;
export function setFilesLook(change: Partial<FilesLook>) {
  const next: FilesLook = {
    fontSize: change.fontSize === undefined ? look.fontSize : change.fontSize === null ? null : clamp(Math.round(change.fontSize), FILES_LOOK.size),
    lineHeight: change.lineHeight === undefined ? look.lineHeight : clamp(Math.round(change.lineHeight * 100) / 100, FILES_LOOK.lineHeight),
  };
  if (next.fontSize === look.fontSize && next.lineHeight === look.lineHeight) return;
  look = next;
  if (look.fontSize === null) removeStore(SIZE);
  else writeStore(SIZE, look.fontSize);
  if (look.lineHeight === FILES_LOOK.lineHeight.default) removeStore(LINE);
  else writeStore(LINE, look.lineHeight);
  apply();
  listeners.forEach((l) => l());
}
export const resetFilesLook = () => setFilesLook({ fontSize: null, lineHeight: FILES_LOOK.lineHeight.default });
export function onFilesLook(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const useFilesLook = () => useSyncExternalStore(onFilesLook, () => look, () => look);
