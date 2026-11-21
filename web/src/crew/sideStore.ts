/** The crew list beside the Command tab's conversation (CrewSide.tsx): shown or hidden (⌘S, ⌘K), and its width, kept in
 *  localStorage and shared across the page (main's palette entry says which it would do). */
import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "../api";

const HIDDEN = "crew:sideHidden";
const WIDTH = "crew:sideWidth";
export const SIDE = { width: 260, min: 200, max: 440 };

let hidden = readStore<boolean>(HIDDEN, false) === true;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const crewSideHidden = () => hidden;
export function setCrewSideHidden(next: boolean): void {
  if (next === hidden) return;
  hidden = next;
  writeStore(HIDDEN, next);
  changed();
}
export const toggleCrewSide = () => setCrewSideHidden(!hidden);

export function useCrewSideHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hidden,
  );
}

/** Its width once resized (clamped), else the default. */
export function readCrewSideWidth(): number {
  const w = readStore<number | null>(WIDTH, null);
  return typeof w === "number" && Number.isFinite(w) ? Math.max(SIDE.min, Math.min(SIDE.max, w)) : SIDE.width;
}
export function writeCrewSideWidth(w: number | null): number {
  const next = w === null ? SIDE.width : Math.round(Math.max(SIDE.min, Math.min(SIDE.max, w)));
  writeStore(WIDTH, w === null ? null : next);
  return next;
}
