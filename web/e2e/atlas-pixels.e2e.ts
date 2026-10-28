/**
 * Pixel regression for the Atlas world: a screenshot of `.atlas-world-surface`
 * byte-equals the baseline captured in `web/e2e/baseline/` (gitignored — each
 * machine captures its own the first time this runs). Reduced motion stills
 * the plaza lamps and beacon, so the shot is stable run to run. Every /api
 * request is answered in the browser; none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { small } from "./fleets";

const BASELINE_DIR = fileURLToPath(new URL("./baseline/", import.meta.url));
const BASELINE = `${BASELINE_DIR}phaser-atlas.png`;

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

const { hosts, projects, workspaces, agents, permissions } = small;

test("phaser atlas renders the same pixels", async () => {
  const context = await newContext(browser);
  const page: Page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page, {
    agents: () => agents,
    permissions: () => permissions,
    hosts: () => hosts,
    projects: () => projects,
    workspaces: () => workspaces,
  });
  await page.goto(app.url);
  await waitFor(
    () => page.evaluate(() => (window as any).paseoAtlas?.inspect?.()?.agents?.length),
    (n) => n === agents.length,
    "the Atlas to draw every agent",
    30000,
  );
  await page.waitForTimeout(500);
  const shot = await page.locator(".atlas-world-surface").screenshot();
  await context.close();
  if (!existsSync(BASELINE)) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(BASELINE, shot);
    return;
  }
  const baseline = readFileSync(BASELINE);
  assert.ok(
    shot.equals(baseline),
    `the Atlas screenshot no longer byte-equals the baseline (${shot.length} vs ${baseline.length} bytes)`,
  );
});
