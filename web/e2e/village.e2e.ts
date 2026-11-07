/**
 * The Village against the concept's fleet: switching to it and away (⌘K,
 * Settings → Map and the app's View → Map Style, kept in localStorage), what it
 * draws (a square per host, a building per project, a tile per workspace from its
 * PR, every agent's state, the host's load, the HUD's counts and status), and
 * picking and hovering on it. The macOS app draws it; here its side of the bridge is
 * a stub that answers as Swift does and keeps what the page sends. Every /api
 * request is answered in the browser; none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { VILLAGE_STATS, village } from "./fleets";

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

type Native = { arts: string[]; scenes: { scene: string; style?: string; entities: { id: string; kind: string }[] }[]; agents: { hud?: Record<string, unknown>; robots?: { id: string }[] }[]; selected: string | null; styles: string[] };
async function open(style: "islands" | "overworld" | "dungeon" | "village"): Promise<{ page: Page }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.addInitScript((initial) => {
    // The style kept from before, unless this page has been opened already (a test's reload keeps its choice).
    if (!sessionStorage.getItem("e2e-opened")) localStorage.setItem("paseo-command:atlas:style", JSON.stringify(initial));
    sessionStorage.setItem("e2e-opened", "1");
    const host = { arts: [] as string[], scenes: [] as unknown[], agents: [] as unknown[], selected: null as string | null, styles: [] as string[] };
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
            if (m.type === "agents") host.agents.push({ hud: m.hud, robots: m.robots });
            if (m.type === "select") host.selected = m.id;
            if (m.type === "mapStyle") host.styles.push(m.style);
          },
        },
      },
    };
  }, style);
  await mockApi(page, {
    agents: () => village.agents,
    permissions: () => village.permissions,
    hosts: () => village.hosts,
    projects: () => village.projects,
    workspaces: () => village.workspaces,
    lists: { hoststats: VILLAGE_STATS },
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

test("⌘K and View → Map Style switch to the Village and back, keeping the choice", async () => {
  const { page } = await open("islands");
  await waitFor(() => inspect(page), (i) => i?.scene === "atlas", "the Islands", 30000);
  let dialog = await palette(page, "village");
  await dialog.getByRole("option", { name: /Use the Village map/ }).click();
  await waitFor(() => inspect(page), (i) => i?.scene === "village", "the Village", 30000);
  assert.equal(await kept(page), "village");
  assert.deepEqual((await native(page)).arts, ["atlas", "village"], "Swift is told the world with the art");
  dialog = await palette(page, "map");
  assert.equal(await dialog.getByRole("option", { name: /Use the Village map/ }).count(), 0, "no entry for the style shown");
  // To the Dungeon Board (another world of its own) and back through View → Map Style.
  await dialog.getByRole("option", { name: /Use the Dungeon Board map/ }).click();
  await waitFor(() => inspect(page), (i) => i?.scene === "dungeon", "the Dungeon Board", 30000);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:command", { detail: "map-style-village" })));
  await waitFor(() => inspect(page), (i) => i?.scene === "village", "View → Map Style's choice", 30000);
  assert.deepEqual([...new Set((await native(page)).styles)], ["islands", "village", "dungeon"]);
  await page.reload();
  await waitFor(() => inspect(page), (i) => i?.scene === "village", "the Village after a reload", 30000);
  // Back to the Islands.
  await (await palette(page, "map")).getByRole("option", { name: /Use the Islands map/ }).click();
  await waitFor(() => inspect(page), (i) => i?.scene === "atlas", "the Islands", 30000);
  await page.context().close();
});

test("Settings → Map lists the Village", async () => {
  const { page } = await open("islands");
  await waitFor(() => inspect(page), (i) => i?.scene === "atlas", "the Islands", 30000);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "settings" } })));
  await page.getByRole("navigation", { name: "Settings sections" }).getByText("Map").click();
  await page.getByRole("radiogroup", { name: "Map style" }).getByText("Village", { exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "command" } })));
  await waitFor(() => inspect(page), (i) => i?.scene === "village", "the Village", 30000);
  assert.equal(await kept(page), "village");
  await page.context().close();
});

test("the Village draws every project, workspace and agent truthfully", async () => {
  const { page } = await open("village");
  const v = await waitFor(() => inspect(page), (i) => i?.scene === "village" && i.agents?.length === village.agents.length && i.squares?.[0]?.stats?.length, "the Village", 30000);
  assert.equal(v.squares.length, 1);
  assert.deepEqual(v.squares[0].stats, ["CPU 34%", "MEM 61%", "DISK 92%"]);
  assert.deepEqual(v.projects.map((p: any) => p.name), ["agents-lab", "api-gateway", "web-app", "workspaces"]);
  assert.equal(new Set(v.projects.map((p: any) => p.building)).size, 4, "neighbours' buildings differ");
  const tile = (name: string) => v.workspaces.find((w: any) => w.name === name)?.tile;
  assert.equal(tile("auth"), "merged");
  assert.equal(tile("routing"), "review");
  assert.equal(tile("billing"), "draft");
  assert.equal(tile("search"), "failing");
  assert.equal(tile("export"), "failing", "merge conflicts are failing");
  assert.equal(tile("settings"), "none");
  const state = (name: string) => v.agents.find((a: any) => a.name === name)?.state;
  assert.equal(state("auth agent 1"), "running");
  assert.equal(state("billing agent 1"), "question");
  assert.equal(state("experiments agent 1"), "approval");
  assert.equal(state("experiments agent 2"), "done");
  assert.equal(state("core agent 1"), "idle");
  const robot = (name: string) => v.agents.find((a: any) => a.name === name)?.robot;
  assert.equal(robot("auth agent 1"), "orange", "Claude's robots are orange");
  assert.equal(robot("dashboard agent 1"), "white", "ChatGPT's white");
  assert.ok(!["orange", "white"].includes(robot("core agent 1")), "another provider has a colour of its own");
  // The HUD's counts agree with the app's own: only approvals and questions need you.
  assert.equal(v.counts.needYou, 2);
  assert.equal(v.counts.running, 2);
  assert.equal(v.counts.unread, 1);
  assert.equal(v.counts.prs, 8);
  assert.equal(v.status, "2 need you");
  const sent = (await native(page)).agents.at(-1)!;
  assert.ok(sent.hud?.panel && sent.hud?.pill, "the panel and the pill go to Swift with the agents");
  const scene = (await native(page)).scenes.at(-1)!;
  assert.equal(scene.scene, "village");
  assert.equal(scene.entities.filter((e) => e.kind === "agent").length, 6);
  assert.equal(scene.entities.filter((e) => e.kind === "workspace").length, 12);
  assert.equal(scene.entities.filter((e) => e.kind === "host").length, 0, "hosts are never picked on the map");
  await page.context().close();
});

test("picking a robot in the Village opens its conversation; hovering shows its card", async () => {
  const { page } = await open("village");
  await waitFor(() => inspect(page), (i) => i?.scene === "village" && !!i.agents?.length, "the Village", 30000);
  const robot = key("a-billing-0");
  await swift(page, { type: "hover", id: robot, x: 300, y: 200 });
  const tip = await waitFor(
    () => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""),
    (t) => !!t,
    "a hover card",
  );
  assert.match(tip!, /billing agent 1/);
  await swift(page, { type: "pick", id: robot });
  await waitFor(async () => (await inspect(page))?.selected, (v) => v === robot, "the robot to be selected");
  await page.locator(".session-title h2", { hasText: "billing agent 1" }).waitFor();
  assert.equal((await native(page)).selected, robot, "the selection reaches Swift");
  await swift(page, { type: "hover", id: key("wks_routing"), x: 200, y: 150, flag: "review-awaiting" });
  await waitFor(
    () => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""),
    (t) => !!t && /Awaiting review/.test(t),
    "the medallion's card",
  );
  await page.context().close();
});
