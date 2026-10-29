import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { deal, finishGame, gamesFile, gamesRecord, nextGame, saveGameState } from "./games";
import { CATALOG } from "../src/games/catalog";

const reset = () => rmSync(gamesFile(), { force: true });

test("a first game is dealt and kept, with its progress", () => {
  reset();
  const first = gamesRecord();
  assert.ok(CATALOG.some((g) => g.id === first.current.id));
  assert.equal(first.current.state, null);
  assert.deepEqual(gamesRecord().current, first.current);
  saveGameState({ id: first.current.id, state: { moves: 3 } });
  assert.deepEqual(gamesRecord().current.state, { moves: 3 });
  // Another game's progress is ignored.
  const other = CATALOG.find((g) => g.id !== first.current.id)!.id;
  saveGameState({ id: other, state: { moves: 9 } });
  assert.deepEqual(gamesRecord().current, { id: first.current.id, state: { moves: 3 } });
});

test("the next game waits for the current one to finish, and is a different game", () => {
  reset();
  const { current } = gamesRecord();
  assert.equal(nextGame().current.id, current.id);
  finishGame({ id: current.id, score: 5 });
  // Finished: no more progress, and no second result.
  saveGameState({ id: current.id, state: "late" });
  finishGame({ id: current.id, score: 99 });
  assert.equal(gamesRecord().current.result, 5);
  const next = nextGame().current;
  assert.notEqual(next.id, current.id);
  assert.equal(next.state, null);
  assert.ok(!("result" in next));
});

test("best scores keep the higher or, for lower-is-better games, the lower", () => {
  reset();
  const play = (id: string, score: number | null) => {
    mkdirSync(dirname(gamesFile()), { recursive: true });
    const best = gamesRecord().best;
    writeFileSync(gamesFile(), JSON.stringify({ current: { id, state: null }, best }));
    return finishGame({ id, score }).best;
  };
  play("clearing", 120);
  play("clearing", 80);
  assert.equal(play("clearing", 150).clearing, 150);
  play("roundup", 9);
  assert.equal(play("roundup", 12).roundup, 9);
  assert.equal(play("roundup", 6).roundup, 6);
  // A loss keeps the best.
  assert.equal(play("roundup", null).roundup, 6);
  assert.equal(gamesRecord().current.result, null);
  assert.throws(() => play("clearing", Number.NaN as never));
});

test("a damaged record is never overwritten, and an unknown game keeps the bests", () => {
  writeFileSync(gamesFile(), "{not json");
  assert.throws(() => gamesRecord(), /can't be read/);
  writeFileSync(gamesFile(), JSON.stringify({ current: { id: "gone", state: 1 }, best: { reefs: 40 } }));
  const record = gamesRecord();
  assert.equal(record.best.reefs, 40);
  assert.ok(CATALOG.some((g) => g.id === record.current.id));
});

test("deal never repeats the game just played", () => {
  for (const g of CATALOG)
    for (const r of [0, 0.5, 0.999]) assert.notEqual(deal(g.id, () => r), g.id);
});
