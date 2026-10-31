import type { LinearPlace } from "./place";

/** Where the Linear tab has been, as a browser's history: the places, and which one shows. */
export type PlaceHistory = { stack: LinearPlace[]; at: number };

/** At most this many places are kept; the oldest go first. */
export const HISTORY_MAX = 100;

const same = (a: LinearPlace, b: LinearPlace) => JSON.stringify(a) === JSON.stringify(b);

export const startHistory = (place: LinearPlace): PlaceHistory => ({ stack: [place], at: 0 });

/**
 * Going to `place`: a new entry after the current one (anything ahead of it
 * is dropped, as a browser does), or in its place with `replace` (a list's
 * ↑/↓, a search's words, a correction). Going where it already is changes nothing.
 */
export function visit(h: PlaceHistory, place: LinearPlace, replace = false): PlaceHistory {
  const current = h.stack[h.at];
  if (current && same(current, place)) return h;
  if (replace) return { stack: [...h.stack.slice(0, h.at), place, ...h.stack.slice(h.at + 1)], at: h.at };
  const stack = [...h.stack.slice(0, h.at + 1), place].slice(-HISTORY_MAX);
  return { stack, at: stack.length - 1 };
}

/** One step back (-1) or forward (1); null when there's nowhere to go. */
export function step(h: PlaceHistory, by: -1 | 1): PlaceHistory | null {
  const at = h.at + by;
  return at < 0 || at >= h.stack.length ? null : { stack: h.stack, at };
}

/** The place it shows. */
export const currentPlace = (h: PlaceHistory) => h.stack[h.at];
