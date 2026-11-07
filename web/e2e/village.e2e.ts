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
import { SPARSE_ISSUES, SPARSE_PRS, SPARSE_STATS, VILLAGE_ISSUES, VILLAGE_PRS, VILLAGE_STATS, sparse, village } from "./fleets";

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
async function open(style: "islands" | "overworld" | "dungeon" | "village", which: "village" | "sparse" = "village"): Promise<{ page: Page }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  const FLEET = which === "sparse" ? sparse : village;
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
    agents: () => FLEET.agents,
    permissions: () => FLEET.permissions,
    hosts: () => FLEET.hosts,
    projects: () => FLEET.projects,
    workspaces: () => FLEET.workspaces,
    lists: {
      hoststats: which === "sparse" ? SPARSE_STATS : VILLAGE_STATS,
      // The dashboard halls' reads (GET /api/github/q/prCounts, /api/linear/issue-counts), GitHub and Linear on.
      github: which === "sparse" ? SPARSE_PRS : VILLAGE_PRS,
      linear: which === "sparse" ? SPARSE_ISSUES : VILLAGE_ISSUES,
      settings: { linearWorkspace: "", integrations: { github: true, linear: which === "village", typesafe: false }, error: null },
    },
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

test("the Village: the dashboard halls, then host, project, workspace and agent as the Islands map nests them", async () => {
  const { page } = await open("village");
  const v = await waitFor(() => inspect(page), (i) => i?.scene === "village" && i.agents?.length === 6 && i.counts?.prs?.known && i.counts?.issues?.known, "the Village", 30000);
  assert.equal(v.squares.length, 1, "a district for its one host");
  assert.deepEqual(v.projects.map((p: any) => p.name), ["GitHub PRs", "Linear Issues", "diagonal"]);
  assert.deepEqual(v.projects.slice(0, 2).map((p: any) => p.building), ["hall-blue", "hall-purple"]);
  assert.ok(!["hall-blue", "hall-purple"].includes(v.projects[2].building), "a project's hall isn't a dashboard's");
  assert.deepEqual(v.counts.prs.by, { merged: 7, review: 3, draft: 1, conflicts: 1 });
  assert.deepEqual(v.counts.issues.by, { done: 11, inProgress: 8, todo: 7, blocked: 2 });
  assert.deepEqual(v.workspaces.map((w: any) => [w.name, w.status]), [["Core", "running"], ["Data", "running"], ["Export", "running"], ["Infra", "running"]]);
  assert.equal(v.counts.running, 5);
  assert.equal(v.counts.idle, 1);
  assert.equal(v.counts.needYou, 0);
  assert.equal(v.status, "All systems operational");
  const robot = (name: string) => v.agents.find((a: any) => a.name === name)?.robot;
  assert.equal(robot("Core agent 1"), "orange", "Claude's robots are orange");
  assert.equal(robot("Infra agent 2"), "white", "ChatGPT's white");
  assert.equal(new Set(v.agents.map((a: any) => a.robot)).size, 6, "six providers, six colours");
  const sent = (await native(page)).agents.at(-1)!;
  assert.ok(sent.hud?.panel && sent.hud?.pill, "the panel and the pill go to Swift with the agents");
  const scene = (await native(page)).scenes.at(-1)!;
  assert.equal(scene.entities.filter((e) => e.kind === "agent").length, 6);
  assert.equal(scene.entities.filter((e) => e.kind === "workspace").length, 4);
  // Eight dashboard tiles and the two dashboard halls with their cards; the project's hall is picked as the project.
  assert.equal(scene.entities.filter((e) => e.kind === "tile" && e.id.startsWith("tile:")).length, 8);
  assert.equal(scene.entities.filter((e) => e.id.startsWith("vhall:")).length, 2);
  assert.equal(scene.entities.filter((e) => e.kind === "project").length, 1);
  assert.equal(scene.entities.filter((e) => e.id.startsWith("vfountain:")).length, 1, "its host's fountain has a card");
  assert.deepEqual(scene.entities.filter((e) => e.kind === "host").map((e) => e.id), ["local"], "its host's keep is picked as the host");
  await page.context().close();
});

test("a sparse fleet: a district per host, each with its keep; PRs at 0, Linear off", async () => {
  const { page } = await open("village", "sparse");
  const v = await waitFor(() => inspect(page), (i) => i?.scene === "village" && i.agents?.length === 3 && i.counts?.prs?.known, "the Village", 30000);
  assert.deepEqual(v.squares.map((s: any) => s.hosts[0].title), ["LOCAL", "DIAGONAL-LAB-1"]);
  assert.equal(v.projects.length, 4, "the two dashboard halls and a hall per project");
  assert.equal(v.counts.prs.total, 0);
  assert.equal(v.counts.issues.known, false, "Linear off: its tiles say —");
  assert.ok(v.workspaces.every((w: any) => w.status === "needs"));
  assert.equal(v.status, "3 need you");
  await page.context().close();
});

test("picking a robot opens its conversation; a tile's card lists its PRs and a click opens the first", async () => {
  const { page } = await open("village");
  await waitFor(() => inspect(page), (i) => i?.scene === "village" && !!i.agents?.length && i.counts?.prs?.known, "the Village", 30000);
  const robot = key("a-data-0");
  await swift(page, { type: "hover", id: robot, x: 300, y: 200 });
  const tip = await waitFor(() => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t, "a hover card");
  assert.match(tip!, /Data agent 1/);
  await swift(page, { type: "pick", id: robot });
  await waitFor(async () => (await inspect(page))?.selected, (v) => v === robot, "the robot to be selected");
  await page.locator(".session-title h2", { hasText: "Data agent 1" }).waitFor();
  // A dashboard tile: its card names the group and its pull requests.
  await swift(page, { type: "hover", id: "tile:prs:merged", x: 200, y: 150 });
  const card = await waitFor(() => page.locator(".atlas-world-card").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t, "the tile's card");
  assert.match(card!, /Merged · 7/);
  assert.match(card!, /diagonal\/app#100/);
  // A hall's card names it and what it holds.
  await swift(page, { type: "hover", id: "vhall:issues", x: 220, y: 150 });
  await waitFor(() => page.locator(".atlas-world-card").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t && /Linear Issues/.test(t) && /Blocked: 2/.test(t), "the hall's card");
  // A workspace's PR medallion keeps its card.
  await swift(page, { type: "hover", id: key("wks_export"), x: 200, y: 150, flag: "review-awaiting" });
  await waitFor(() => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t && /Awaiting review/.test(t), "the medallion's card");
  await page.context().close();
});

test("a keep names its host and targets it: its card, then a click narrows the lists to that host, its keep selected", async () => {
  const { page } = await open("village", "sparse");
  const v = await waitFor(() => inspect(page), (i) => i?.scene === "village" && i.agents?.length === 3, "the Village", 30000);
  const lab = v.squares.find((s: any) => s.hosts[0].title === "DIAGONAL-LAB-1");
  assert.ok(lab.keep && lab.plaque, "the keep carries the host's name board");
  const id = lab.host.id;
  await swift(page, { type: "hover", id, x: 400, y: 300 });
  const card = await waitFor(() => page.locator(".atlas-world-card").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t, "the keep's card");
  assert.match(card!, /DIAGONAL-LAB-1/);
  assert.match(card!, /Online/);
  assert.match(card!, /1 project · 1 workspace · 1 agent/);
  // Before: both hosts' workspaces listed.
  await page.getByRole("tab", { name: /Workspaces/ }).click();
  await page.getByText("jolly-beacon-fede").first().waitFor();
  await swift(page, { type: "pick", id });
  // The Hosts tab's filter: only the lab's workspace listed, and its keep is the map's selection.
  await waitFor(() => page.getByText("jolly-beacon-fede").count(), (n) => n === 0, "the other host's workspaces to leave the list");
  await page.getByText("main", { exact: true }).first().waitFor();
  await waitFor(async () => (await native(page)).selected, (s) => s === id, "the keep to be selected");
  await page.context().close();
});
