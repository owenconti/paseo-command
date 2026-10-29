/**
 * The mini games' record, in a small file in this app's data directory
 * (`games.json`): which game is being played (dealt here, at random, never
 * chosen by the page), its progress, and the best score for each game. A
 * reload or another window picks up the same game where it was; a finished
 * game's best is written before the next one is dealt.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CATALOG, type Current, type GameId, type GamesRecord } from "../src/games/catalog";
import { dataDir } from "./subagentArchive";

export const gamesFile = () => join(dataDir(), "games.json");

const isGame = (id: unknown): id is GameId => CATALOG.some((g) => g.id === id);

/** A random game other than `not`. */
export function deal(not?: GameId, random = Math.random): GameId {
  const pool = CATALOG.filter((g) => g.id !== not);
  return pool[Math.floor(random() * pool.length)]!.id;
}

/** What the file holds; a game no longer in the catalog is dropped, its
 * best scores kept. No file: nothing. A damaged one throws rather than be
 * overwritten (it holds the best scores). */
function read(): { current: Current | null; best: GamesRecord["best"] } {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(gamesFile(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { current: null, best: {} };
    throw new Error("The games record (games.json) can't be read.");
  }
  const best: GamesRecord["best"] = {};
  for (const g of CATALOG) if (Number.isFinite(raw?.best?.[g.id])) best[g.id] = raw.best[g.id];
  if (!isGame(raw?.current?.id)) return { current: null, best };
  const current: Current = { id: raw.current.id, state: raw.current.state ?? null };
  if ("result" in raw.current)
    current.result = Number.isFinite(raw.current.result) ? raw.current.result : null;
  return { current, best };
}

function write(record: GamesRecord) {
  const file = gamesFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record) + "\n");
  renameSync(tmp, file);
  return record;
}

/** The record, dealing a first game if there is none. */
export function gamesRecord(): GamesRecord {
  const { current, best } = read();
  return current ? { current, best } : write({ current: { id: deal(), state: null }, best });
}

/** Keep the current game's progress (ignored for another or a finished game). */
export function saveGameState(body: Record<string, unknown>): GamesRecord {
  const record = gamesRecord();
  if (body.id !== record.current.id || "result" in record.current) return record;
  record.current.state = body.state ?? null;
  return write(record);
}

/** End the current game with `score` (null: lost), keeping the best. */
export function finishGame(body: Record<string, unknown>): GamesRecord {
  const record = gamesRecord();
  if (body.id !== record.current.id || "result" in record.current) return record;
  const score = body.score === null ? null : Number(body.score);
  if (score !== null && !Number.isFinite(score)) throw new Error("Invalid score");
  if (body.state !== undefined) record.current.state = body.state;
  record.current.result = score;
  const game = CATALOG.find((g) => g.id === record.current.id)!;
  const best = record.best[game.id];
  if (score !== null && (best === undefined || ("lower" in game && game.lower ? score < best : score > best)))
    record.best[game.id] = score;
  return write(record);
}

/** Deal the next game, once the current one has finished. */
export function nextGame(): GamesRecord {
  const record = gamesRecord();
  if (!("result" in record.current)) return record;
  record.current = { id: deal(record.current.id), state: null };
  return write(record);
}
