/** The mini games, shared by the app and the server that deals them out and
 * keeps their best scores. `lower`: fewer is better (moves, crates, seconds). */
export const CATALOG = [
  { id: "roundup", name: "Round-up", unit: "crates", lower: true },
  { id: "clearing", name: "Clearing", unit: "points" },
  { id: "shoreline", name: "Shoreline", unit: "points" },
  { id: "lamplighter", name: "Lamplighter", unit: "moves", lower: true },
  { id: "pairs", name: "Robot Pairs", unit: "turns", lower: true },
  { id: "beacons", name: "Beacon Rush", unit: "answered" },
  { id: "boardwalk", name: "Boardwalk", unit: "turns", lower: true },
  { id: "signal", name: "Signal", unit: "steps" },
  { id: "reefs", name: "Reefs", unit: "seconds", lower: true },
  { id: "bays", name: "Charging Bays", unit: "moves", lower: true },
] as const satisfies readonly { id: string; name: string; unit: string; lower?: boolean }[];

/** "1 crate", "3 crates", "7 answered". */
export const amount = (n: number, unit: string) =>
  `${n} ${n === 1 && unit.endsWith("s") ? unit.slice(0, -1) : unit}`;

export type GameId = (typeof CATALOG)[number]["id"];

/** The game being played, as the server keeps it. `state` is the game's own
 * JSON (null until the game deals its board); `result` is set once it ends
 * (a score, or null for a loss). */
export type Current = { id: GameId; state: unknown; result?: number | null };
export type GamesRecord = { current: Current; best: Partial<Record<GameId, number>> };
