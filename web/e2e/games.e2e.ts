/**
 * The panel header's games button opens a floating, non-modal window with
 * one dealt game: no choosing, no restarting, and the next game only once it
 * ends. The games' record is the real store (in the test's own data
 * directory), answered in the browser; no request reaches the app server.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Browser, Page } from "playwright";
import { launch, mockApi, newContext, startApp } from "./harness";
import { finishGame, gamesFile, gamesRecord, nextGame, saveGameState } from "../server/games";
import { CATALOG } from "../src/games/catalog";

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;
before(async () => {
  [app, browser] = await Promise.all([startApp(), launch()]);
});
after(async () => {
  await browser?.close();
  await app?.stop();
  assert.deepEqual(app?.apiHits ?? [], []);
});

const games = {
  get games() {
    return gamesRecord();
  },
};
const accept = (path: string, body: unknown) => {
  const b = body as Record<string, unknown>;
  if (path === "/api/games/state") return saveGameState(b);
  if (path === "/api/games/finish") return finishGame(b);
  if (path === "/api/games/next") return nextGame();
  return undefined;
};
const deal = (current: unknown) => {
  mkdirSync(dirname(gamesFile()), { recursive: true });
  writeFileSync(gamesFile(), JSON.stringify({ current, best: { roundup: 4 } }));
};

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockApi(page, { agents: () => [], projects: () => [], lists: games, accept });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Mini games" }).click();
  const win = page.getByRole("region", { name: "Mini games" });
  await win.waitFor();
  return { win, errors };
}

test("a dealt game plays to its end, keeps its best, then the next is dealt", async () => {
  // Round-up with the robot hemmed in but for one cell.
  const around = ["1,0", "1,-1", "0,-1", "-1,0", "-1,1"];
  deal({
    id: "roundup",
    state: { robot: { q: 0, r: 0 }, colour: 1, hedges: around, crates: [], outcome: "playing" },
  });
  const context = await newContext(browser);
  const page = await context.newPage();
  const { win, errors } = await open(page);
  await win.getByRole("heading", { name: "Round-up" }).waitFor();
  await win.getByText("Best 4 crates").waitFor();
  // Nothing to choose or restart.
  assert.equal(await win.getByRole("tab").count(), 0);
  assert.equal(await win.getByRole("button", { name: /new|restart|reset/i }).count(), 0);
  // The last open neighbour.
  await win.locator('.rc-cell[data-hex="0,1"]').click();
  await win.getByText("1 crate: your best!").waitFor();
  assert.equal(gamesRecord().best.roundup, 1);
  assert.equal(gamesRecord().current.result, 1);
  if (process.env.SHOTS) await win.screenshot({ path: `${process.env.SHOTS}/finished.png` });
  // A reload shows the same finished game, not a fresh one.
  await page.reload();
  await page.getByRole("button", { name: "Mini games" }).click();
  await win.getByText("1 crate: your best!").waitFor();
  await win.getByRole("button", { name: "Next game" }).click();
  await win.getByRole("button", { name: "Next game" }).waitFor({ state: "detached" });
  const next = gamesRecord().current;
  assert.notEqual(next.id, "roundup");
  // The new game dealt its board and the server keeps it.
  for (let i = 0; i < 50 && gamesRecord().current.state === null; i++) await page.waitForTimeout(50);
  assert.notEqual(gamesRecord().current.state, null);
  await win.getByRole("heading", { name: CATALOG.find((g) => g.id === next.id)!.name }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test("every game deals a board and shows it", async () => {
  const context = await newContext(browser);
  for (const game of CATALOG) {
    deal({ id: game.id, state: null });
    const page = await context.newPage();
    const { win, errors } = await open(page);
    await win.getByRole("heading", { name: game.name }).waitFor();
    await win.locator(".game-board").first().waitFor();
    if (process.env.SHOTS) await page.waitForTimeout(400), await win.screenshot({ path: `${process.env.SHOTS}/${game.id}.png` });
    assert.deepEqual(errors, [], game.id);
    await page.close();
  }
  await context.close();
});
