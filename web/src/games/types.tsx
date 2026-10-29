import type { ReactNode } from "react";
import type { GameId } from "./catalog";

/**
 * What a game is given. `state` is the game's own plain JSON (no Sets, Maps
 * or class instances): it is kept on the server, so a reload or another
 * window carries on from it. Every change goes through `setState`.
 */
export type GameProps<S> = {
  state: S;
  setState: (next: S) => void;
  /** End the game: a score in the catalog's unit, or null for a loss. Pass
   * the final state so the finished board stays on show. Called once. */
  finish: (score: number | null, state: S) => void;
  /** False while the window is hidden or the game has finished: timed games
   * stop their clocks and nothing moves. */
  active: boolean;
  /** The game has finished: it takes no more input. */
  over: boolean;
};

export type GameDef<S> = {
  id: GameId;
  /** A fresh board, dealt at random. */
  init: () => S;
  View: (props: GameProps<S>) => ReactNode;
};

/** Each game's status row (its score so far), above its board. */
export function GameBar({ children }: { children: ReactNode }) {
  return <div className="game-bar">{children}</div>;
}
