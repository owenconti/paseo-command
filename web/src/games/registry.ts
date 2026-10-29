import type { GameId } from "./catalog";
import type { GameDef } from "./types";
import { roundUp } from "./RoundUp";
import { clearing } from "./Clearing";
import { shoreline } from "./Shoreline";
import { lamplighter } from "./Lamplighter";
import { pairs } from "./Pairs";
import { beacons } from "./Beacons";
import { boardwalk } from "./Boardwalk";
import { signal } from "./Signal";
import { reefs } from "./Reefs";
import { bays } from "./Bays";

/** Every game in the catalog, by id. */
export const GAMES: Record<GameId, GameDef<any>> = {
  roundup: roundUp,
  clearing,
  shoreline,
  lamplighter,
  pairs,
  beacons,
  boardwalk,
  signal,
  reefs,
  bays,
};
