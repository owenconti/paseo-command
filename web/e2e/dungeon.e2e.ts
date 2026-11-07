/**
 * The Dungeon Board against the concept's fleet: switching the map's style
 * (⌘K, Settings → Map and the app's View → Map Style, kept in localStorage) among
 * the Islands, the Overworld and the board, what the board
 * draws (floors, counts, every agent's state, the hosts' loads), and picking
 * and hovering on it. The macOS app draws it; here its side of the bridge is
 * a stub that answers as Swift does and keeps what the page sends. Every /api
 * request is answered in the browser; none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { DUNGEON_STATS, dungeon } from "./fleets";

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

type Native = { arts: string[]; scenes: { scene: string; style?: string; entities: { id: string; kind: string }[] }[]; selected: string | null; styles: string[] };
async function open(style: "islands" | "overworld" | "dungeon"): Promise<{ page: Page }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.addInitScript((initial) => {
    // The style kept from before, unless this page has been opened already (a test's reload keeps its choice).
    if (!sessionStorage.getItem("e2e-opened")) localStorage.setItem("paseo-command:atlas:style", JSON.stringify(initial));
    sessionStorage.setItem("e2e-opened", "1");
    const host = { arts: [] as string[], scenes: [] as unknown[], selected: null as string | null, styles: [] as string[] };
    (window as any).__native = host;
    (window as any).webkit = {
      messageHandlers: {
        paseoWorld: {
          postMessage(m: any) {
            if (m.type === "art") {
              host.arts.push(m.scene);
              setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
            }
            if (m.type === "scene") host.scenes.push({ scene: host.arts.at(-1), style: m.style, entities: m.entities ?? [] });
            if (m.type === "select") host.selected = m.id;
            if (m.type === "mapStyle") host.styles.push(m.style);
          },
        },
      },
    };
  }, style);
  await mockApi(page, {
    agents: () => dungeon.agents,
    permissions: () => dungeon.permissions,
    hosts: () => dungeon.hosts,
    projects: () => dungeon.projects,
    workspaces: () => dungeon.workspaces,
    lists: { hoststats: DUNGEON_STATS },
  } as any);
  await page.goto(app.url);
  return { page };
}
const kept = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("paseo-command:atlas:style") ?? "null"));
const native = (page: Page) => page.evaluate(() => (window as any).__native as Native);
const inspect = (page: Page) => page.evaluate(() => (window as any).paseoAtlas?.inspect() as any);
const swift = (page: Page, detail: Record<string, unknown>) =>
  page.evaluate((d) => window.dispatchEvent(new CustomEvent("paseo:world", { detail: d })), detail);
const key = (id: string, host = "local") => JSON.stringify([host, id]);

async function palette(page: Page, query: string) {
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.waitFor();
  await dialog.getByRole("combobox", { name: "Search commands" }).fill(query);
  return dialog;
}

test("⌘K switches among the Islands, the Overworld and the Dungeon Board, keeping the choice", async () => {
  const { page } = await open("islands");
  await waitFor(() => inspect(page), (i) => i?.scene === "atlas", "the Islands", 30000);
  let dialog = await palette(page, "map");
  assert.equal(await dialog.getByRole("option", { name: /Use the Islands map/ }).count(), 0, "no entry for the style shown");
  assert.equal(await dialog.getByRole("option", { name: /Use the Overworld map/ }).count(), 1);
  await dialog.getByRole("option", { name: /Use the Dungeon Board map/ }).click();
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon", "the Dungeon Board", 30000);
  assert.equal(await kept(page), "dungeon");
  assert.deepEqual((await native(page)).arts, ["atlas", "dungeon"], "Swift is told the world with the art");
  // Into the Overworld: the Atlas's world again, drawn in its other style.
  dialog = await palette(page, "map");
  assert.equal(await dialog.getByRole("option", { name: /Use the Dungeon Board map/ }).count(), 0);
  await dialog.getByRole("option", { name: /Use the Overworld map/ }).click();
  await waitFor(() => inspect(page), (i) => i?.scene === "atlas", "the Atlas's world", 30000);
  await waitFor(() => native(page), (n) => n.scenes.at(-1)?.style === "overworld", "the Overworld's scene", 30000);
  // Back to the board, then the Islands, without a reload.
  (await palette(page, "map")).getByRole("option", { name: /Use the Dungeon Board map/ }).click();
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon", "the board again", 30000);
  await (await palette(page, "map")).getByRole("option", { name: /Use the Islands map/ }).click();
  await waitFor(() => native(page), (n) => n.scenes.at(-1)?.scene === "atlas" && n.scenes.at(-1)?.style !== "overworld", "the Islands", 30000);
  assert.equal(await kept(page), "islands");
  // The app's View → Map Style is told each style, and asks for one by name.
  assert.deepEqual([...new Set((await native(page)).styles)], ["islands", "dungeon", "overworld"]);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:command", { detail: "map-style-dungeon" })));
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon", "View → Map Style's choice", 30000);
  // A reload keeps it.
  await page.reload();
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon", "the board after a reload", 30000);
  await page.context().close();
});

test("Settings → Map chooses the style", async () => {
  const { page } = await open("islands");
  await waitFor(() => inspect(page), (i) => i?.scene === "atlas", "the Islands", 30000);
  // The app shows Settings in the map's place when it says so (its gear, ⌘,).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "settings" } })));
  await page.getByRole("navigation", { name: "Settings sections" }).getByText("Map").click();
  const styles = page.getByRole("radiogroup", { name: "Map style" });
  await styles.getByText("Dungeon Board").click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "command" } })));
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon", "the Dungeon Board", 30000);
  assert.equal(await kept(page), "dungeon");
  await page.context().close();
});

test("the board draws every host, project, workspace and agent truthfully", async () => {
  const { page } = await open("dungeon");
  const board = await waitFor(() => inspect(page), (i) => i?.scene === "dungeon" && i.agents?.length === dungeon.agents.length && i.floors?.[0]?.stats?.length, "the board", 30000);
  assert.deepEqual(board.counts, { hosts: 3, projects: 6, workspaces: 11, agents: 27 });
  assert.deepEqual(board.floors.map((f: any) => f.title), ["LOCAL", "PROD", "STAGING"]);
  assert.deepEqual(board.floors[0].stats, ["CPU 42%", "MEM 58%", "DISK 70%"]);
  const state = (name: string) => board.agents.find((a: any) => a.name === name)?.state;
  assert.equal(state("api agent 1"), "running");
  assert.equal(state("web agent 2"), "approval");
  assert.equal(state("analytics agent 1"), "question");
  assert.equal(state("events agent 1"), "failed");
  assert.equal(state("cli agent 1"), "done");
  assert.equal(board.agents.find((a: any) => a.name === "api agent 1").model, "orange", "Claude's robots are orange");
  assert.equal(board.agents.find((a: any) => a.name === "web agent 1").model, "white", "ChatGPT's white");
  // Other providers each keep a colour of their own on the board.
  const robot = (name: string) => board.agents.find((a: any) => a.name === name)?.robot;
  assert.equal(robot("api agent 1"), "orange");
  assert.equal(robot("web agent 1"), "white");
  assert.equal(robot("api agent 2"), robot("cli agent 1"), "one provider, one colour");
  assert.ok(new Set(board.agents.map((a: any) => a.robot)).size >= 7, "the fleet's providers vary the colours");
  assert.deepEqual(board.workspaces.find((w: any) => w.name === "api").flags, ["ci-running", "review-awaiting"]);
  assert.match(board.subtitle, /^\d+ running · \d+ needs? you$/);
  // Swift gets every project, workspace and agent to pick, and never a host.
  const scene = (await native(page)).scenes.at(-1)!;
  assert.equal(scene.scene, "dungeon");
  assert.equal(scene.entities.filter((e) => e.kind === "agent").length, 27);
  assert.equal(scene.entities.filter((e) => e.kind === "host").length, 0);
  await page.context().close();
});

test("picking a robot on the board opens its conversation; hovering one shows its card", async () => {
  const { page } = await open("dungeon");
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon" && !!i.agents?.length, "the board", 30000);
  const robot = key("a-events-0", "srv_staging");
  await swift(page, { type: "hover", id: robot, x: 300, y: 200 });
  const tip = await waitFor(
    () => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""),
    (t) => !!t,
    "a hover card",
  );
  assert.match(tip!, /events agent 1.*Failed/);
  await swift(page, { type: "pick", id: robot });
  await waitFor(async () => (await inspect(page))?.selected, (v) => v === robot, "the robot to be selected");
  await page.locator(".session-title h2", { hasText: "events agent 1" }).waitFor();
  assert.equal((await native(page)).selected, robot, "the selection reaches Swift");
  // A workspace's PR medallion: its card says what the PR's CI is doing.
  const workspace = key("wks_api");
  await swift(page, { type: "hover", id: workspace, x: 200, y: 150, flag: "ci-running" });
  await waitFor(
    () => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""),
    (t) => !!t && /CI running/.test(t),
    "the medallion's card",
  );
  await page.context().close();
});
