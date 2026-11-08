/**
 * The map's hover cards fit inside the map: above the thing hovered when there's room, below it when it's at the
 * top of the view, kept inside the view at its edges and cut to its height when taller (`MapCard` in
 * NativeWorld.tsx, `placeCard` in cardPlace.ts). The macOS app draws the world; here its side of the bridge is a
 * stub that answers as Swift does. Every /api request is answered in the browser; none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { VILLAGE_ISSUES, VILLAGE_PRS, VILLAGE_STATS, small, village } from "./fleets";

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

async function open(style: "islands" | "village"): Promise<Page> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.addInitScript((initial) => {
    localStorage.setItem("paseo-command:atlas:style", JSON.stringify(initial));
    (window as any).webkit = {
      messageHandlers: {
        paseoWorld: {
          postMessage(m: any) {
            if (m.type === "art") setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
          },
        },
      },
    };
  }, style);
  const fleet = style === "village" ? village : small;
  await mockApi(page, {
    agents: () => fleet.agents,
    permissions: () => fleet.permissions,
    hosts: () => fleet.hosts,
    projects: () => fleet.projects,
    workspaces: () => fleet.workspaces,
    ...(style === "village"
      ? {
          lists: {
            hoststats: VILLAGE_STATS,
            github: VILLAGE_PRS,
            linear: VILLAGE_ISSUES,
            settings: { linearWorkspace: "", integrations: { github: true, linear: true, typesafe: false }, error: null },
          },
        }
      : {}),
  } as any);
  await page.goto(app.url);
  return page;
}
const inspect = (page: Page) => page.evaluate(() => (window as any).paseoAtlas?.inspect() as any);
/** What Swift reports: the pointer over a thing, its top centre and bottom edge in the surface's points. */
const swift = (page: Page, detail: Record<string, unknown>) =>
  page.evaluate((d) => window.dispatchEvent(new CustomEvent("paseo:world", { detail: d })), detail);
const key = (id: string, host = "local") => JSON.stringify([host, id]);
type Rect = { x: number; y: number; width: number; height: number };
const surfaceRect = async (page: Page) => (await page.locator(".atlas-world-surface").boundingBox())!;
/** The card's box once it shows with `text` in it. */
async function cardRect(page: Page, selector: string, text: RegExp): Promise<Rect> {
  await waitFor(() => page.locator(selector).textContent({ timeout: 500 }).catch(() => ""), (t) => !!t && text.test(t), `a card with ${text}`);
  return (await page.locator(selector).boundingBox())!;
}
function assertInside(card: Rect, view: Rect, what: string) {
  const near = 0.5;
  assert.ok(card.x >= view.x - near, `${what}: its left (${card.x}) is inside the map (${view.x})`);
  assert.ok(card.y >= view.y - near, `${what}: its top (${card.y}) is inside the map (${view.y})`);
  assert.ok(card.x + card.width <= view.x + view.width + near, `${what}: its right (${card.x + card.width}) is inside the map (${view.x + view.width})`);
  assert.ok(card.y + card.height <= view.y + view.height + near, `${what}: its bottom (${card.y + card.height}) is inside the map (${view.y + view.height})`);
}

test("a hover card stands above its thing when it fits, below it at the top of the map, inside it at the edges", async () => {
  const page = await open("islands");
  await waitFor(() => inspect(page), (i) => !!i?.agents?.length, "the Atlas", 30000);
  const view = await surfaceRect(page);
  const robot = key("a-failed");
  // Room above: as it always stood, centred over the thing's top, 8 px clear of it.
  await swift(page, { type: "hover", id: robot, x: 400, y: 400, bottom: 440 });
  const above = await cardRect(page, ".atlas-world-tip", /Breaker/);
  assertInside(above, view, "a card in the middle");
  assert.ok(Math.abs(above.y + above.height - (view.y + 400 - 8)) <= 1, `its bottom (${above.y + above.height}) sits 8 px above the thing (${view.y + 400})`);
  assert.ok(Math.abs(above.x + above.width / 2 - (view.x + 400)) <= 1, "centred on the thing");
  assert.equal(await page.locator(".atlas-world-tip").getAttribute("data-side"), "above");
  // At the very top of the map: beneath the thing, wholly in view.
  await swift(page, { type: "hover", id: null });
  await swift(page, { type: "hover", id: robot, x: 400, y: 4, bottom: 40 });
  await waitFor(() => page.locator(".atlas-world-tip").getAttribute("data-side", { timeout: 500 }).catch(() => ""), (s) => s === "below", "the card below");
  const top = await cardRect(page, ".atlas-world-tip", /Breaker/);
  assertInside(top, view, "a card at the top");
  assert.ok(Math.abs(top.y - (view.y + 40 + 8)) <= 1, `its top (${top.y}) sits 8 px below the thing's bottom (${view.y + 40})`);
  // At the right edge: kept inside it.
  await swift(page, { type: "hover", id: null });
  await swift(page, { type: "hover", id: robot, x: view.width - 2, y: 300, bottom: 340 });
  await waitFor(() => page.locator(".atlas-world-tip").boundingBox({ timeout: 500 }).catch(() => null), (b) => !!b && b.x + b.width < view.x + view.width, "the card at the right edge");
  const right = await cardRect(page, ".atlas-world-tip", /Breaker/);
  assertInside(right, view, "a card at the right edge");
  assert.ok(view.x + view.width - (right.x + right.width) >= 7.5, "8 px clear of the map's right edge");
  // And the left.
  await swift(page, { type: "hover", id: null });
  await swift(page, { type: "hover", id: robot, x: 1, y: 300, bottom: 340 });
  await waitFor(() => page.locator(".atlas-world-tip").boundingBox({ timeout: 500 }).catch(() => null), (b) => !!b && b.x > view.x, "the card at the left edge");
  assertInside(await cardRect(page, ".atlas-world-tip", /Breaker/), view, "a card at the left edge");
  await page.context().close();
});

test("the Village's dashboard cards fit in the map at its top and corner, and are cut to it when taller", async () => {
  const page = await open("village");
  await waitFor(() => inspect(page), (i) => i?.scene === "village" && !!i.agents?.length && i.counts?.prs?.known, "the Village", 30000);
  const view = await surfaceRect(page);
  // A tile at the very top of the map, listing its pull requests.
  await swift(page, { type: "hover", id: "tile:prs:merged", x: 300, y: 4, bottom: 30 });
  const top = await cardRect(page, ".atlas-world-card", /Merged · 7/);
  assertInside(top, view, "a tile's card at the top");
  assert.ok(top.y >= view.y + 4 + 8 - 1, "below the tile's top");
  // The top right corner.
  await swift(page, { type: "hover", id: "tile:issues:done", x: view.width - 3, y: 2, bottom: 26 });
  await waitFor(() => page.locator(".atlas-world-card").boundingBox({ timeout: 500 }).catch(() => null), (b) => !!b && b.x + b.width < view.x + view.width, "the card in the corner");
  assertInside(await cardRect(page, ".atlas-world-card", /Done/), view, "a tile's card in the top right corner");
  // A map shorter than the card: cut to the map's height, never spilling out of it.
  await swift(page, { type: "hover", id: "tile:prs:merged", x: 300, y: 4, bottom: 30 });
  await cardRect(page, ".atlas-world-card", /Merged · 7/);
  const natural = (await page.locator(".atlas-world-card").boundingBox())!.height;
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: Math.round(view.y + natural * 0.6) });
  const short = await waitFor(() => surfaceRect(page), (r) => r.height < natural, "the map shorter than the card");
  const cut = await waitFor(
    () => page.locator(".atlas-world-card").boundingBox({ timeout: 500 }).catch(() => null),
    (b) => !!b && b.height < natural,
    "the card cut to the map",
  );
  assertInside(cut!, short, "a card taller than the map");
  await page.context().close();
});
