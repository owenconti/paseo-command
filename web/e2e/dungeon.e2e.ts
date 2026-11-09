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
import { DUNGEON_STATS, VILLAGE_ISSUES, VILLAGE_PRS, dungeon } from "./fleets";

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

type Native = {
  arts: string[];
  scenes: { scene: string; style?: string; entities: { id: string; kind: string }[]; sprites: { f?: string; e?: string; dim?: number; y: number; z: number; shade?: number }[] }[];
  agents: { hud: Record<string, { key: string }> }[];
  links: string[];
  selected: string | null;
  styles: string[];
};
/** `linear: false` leaves Linear off (its niches dim, their cards say why). */
async function open(style: "islands" | "overworld" | "dungeon", { linear = true } = {}): Promise<{ page: Page }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.addInitScript((initial) => {
    // The style kept from before, unless this page has been opened already (a test's reload keeps its choice).
    if (!sessionStorage.getItem("e2e-opened")) localStorage.setItem("paseo-command:atlas:style", JSON.stringify(initial));
    sessionStorage.setItem("e2e-opened", "1");
    const host = { arts: [] as string[], scenes: [] as unknown[], agents: [] as unknown[], links: [] as string[], selected: null as string | null, styles: [] as string[] };
    (window as any).__native = host;
    (window as any).webkit = {
      messageHandlers: {
        paseoWorld: {
          postMessage(m: any) {
            if (m.type === "art") {
              host.arts.push(m.scene);
              setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
            }
            if (m.type === "scene") host.scenes.push({ scene: host.arts.at(-1), style: m.style, entities: m.entities ?? [], sprites: m.sprites ?? [] });
            if (m.type === "agents") host.agents.push({ hud: m.hud });
            if (m.type === "openLink") host.links.push(m.url);
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
    lists: {
      hoststats: DUNGEON_STATS,
      // The vault's reads (GET /api/github/q/prCounts, /api/linear/issue-counts), GitHub and Linear on.
      github: VILLAGE_PRS,
      linear: VILLAGE_ISSUES,
      settings: { linearWorkspace: "", integrations: { github: true, linear, typesafe: false }, error: null },
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
  const { hosts, projects, workspaces, agents } = board.counts;
  assert.deepEqual({ hosts, projects, workspaces, agents }, { hosts: 3, projects: 6, workspaces: 11, agents: 27 });
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
  // With no name labels on the board (only the hosts' plaques, as on the Islands), each hover card names its thing.
  const tipFor = async (id: string) => {
    await swift(page, { type: "hover", id: null });
    await swift(page, { type: "hover", id, x: 220, y: 160 });
    return waitFor(() => page.locator(".atlas-world-tip").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t, `a card for ${id}`);
  };
  assert.match((await tipFor(key("wks_api")))!, /^api.*Workspace/);
  assert.match((await tipFor(key("prj_core-platform")))!, /^core-platform.*Project/);
  assert.match((await tipFor(key("a-api-0")))!, /^api agent 1/);
  const board = await inspect(page);
  assert.ok(board.workspaces.every((w: any) => w.label === undefined), "no workspace labels");
  await page.context().close();
});

test("the vault: your PRs' and issues' stained-glass niches over the first gate, their cards, a click opening the first; current-state footer", async () => {
  const { page } = await open("dungeon");
  const board = await waitFor(() => inspect(page), (i) => i?.scene === "dungeon" && i.vault?.length === 8 && i.counts?.prs?.known && i.counts?.issues?.known, "the vault", 30000);
  assert.deepEqual(board.counts.prs.by, { merged: 7, review: 3, draft: 1, conflicts: 1 });
  assert.deepEqual(board.counts.issues.by, { done: 11, inProgress: 8, todo: 7, blocked: 2 });
  assert.deepEqual(board.vault.map((t: any) => t.pane), ["merged", "review", "draft", "failing", "merged", "review", "draft", "failing"]);
  // The issues' glass is their own (Linear's status shapes), not the PRs' again; each row is named on a board above it.
  assert.deepEqual(board.vault.map((t: any) => t.frame), ["tile-merged", "tile-review", "tile-draft", "tile-failing", "issue-done", "issue-progress", "issue-todo", "issue-blocked"]);
  assert.deepEqual(board.vaultSigns.map((v: any) => v.label), ["PULL REQUESTS", "LINEAR ISSUES"]);
  // Swift gets each niche to hover and pick (as a tile, never a selection), its stone and glass tagged to glow with it.
  const scene = (await native(page)).scenes.at(-1)!;
  assert.deepEqual(scene.entities.filter((e) => e.kind === "tile").map((e) => e.id), board.vault.map((t: any) => t.id));
  for (const t of board.vault) assert.deepEqual(scene.sprites.filter((s) => s.e === t.id).map((s) => s.f), ["niche-arch", t.frame]);
  assert.ok(scene.sprites.filter((s) => s.e?.startsWith("tile:")).every((s) => !s.dim), "both halls count: nothing dim");
  // The accessible game HUD owns its live controls; Swift no longer paints the static footer.
  const hud = (await native(page)).agents.at(-1)!.hud;
  assert.deepEqual(hud, {});
  await page.getByLabel("Dungeon command belt").waitFor();
  await page.getByRole("button", { name: `Waiting on you: ${board.counts.needYou}`, exact: true }).waitFor();
  await page.getByRole("button", { name: `Unread replies: ${board.counts.unread}`, exact: true }).waitFor();
  // The upper masonry cap sits behind the cloth and the pillar capitals, never cutting across either.
  const z = (f: string) => scene.sprites.filter((s) => s.f === f).map((s) => s.z);
  assert.ok(scene.sprites.filter((s) => s.f === "pillar-capital" && s.y > 80).every((s) => s.z > Math.min(...z("rampart-x"))));
  assert.ok(Math.min(...z("banner-purple-plain")) > Math.min(...z("rampart-x")));
  assert.ok(scene.sprites.filter((s) => /^(brazier|forge)-/.test(s.f ?? "") && !s.dim).every((s) => !s.shade), "lit fire props keep their own colour");
  // A tile's card names its group, its count and its pull requests.
  await swift(page, { type: "hover", id: "tile:prs:merged", x: 400, y: 60 });
  const card = await waitFor(() => page.locator(".atlas-world-card").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t, "the tile's card");
  assert.match(card!, /Merged · 7/);
  assert.match(card!, /diagonal\/app#100/);
  await swift(page, { type: "hover", id: "tile:issues:blocked", x: 500, y: 60 });
  await waitFor(() => page.locator(".atlas-world-card").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t && /Blocked · 2/.test(t) && /DE-1 Blocked issue 1/.test(t), "the issues tile's card");
  // A click opens its first issue as the app opens links (Linear's app, else Conquer), and selects nothing.
  await swift(page, { type: "pick", id: "tile:issues:blocked" });
  await waitFor(async () => (await native(page)).links, (l) => l.includes("https://linear.app/diagonal/issue/DE-1"), "the issue to open");
  assert.equal((await inspect(page)).selected, null);
  // Leaving it hides the card; a robot's card shows as before.
  await swift(page, { type: "hover", id: null });
  await waitFor(() => page.locator(".atlas-world-card").count(), (n) => n === 0, "the card to go");
  await page.context().close();
});

test("the vault with Linear off: its niches dim and their cards say why", async () => {
  const { page } = await open("dungeon", { linear: false });
  const board = await waitFor(() => inspect(page), (i) => i?.scene === "dungeon" && i.vault?.length === 8 && i.counts?.prs?.known && i.counts?.issues?.why, "the vault", 30000);
  assert.equal(board.counts.issues.known, false);
  const scene = (await native(page)).scenes.at(-1)!;
  const dim = (hall: string) => scene.sprites.filter((s) => s.e?.startsWith(`tile:${hall}:`)).map((s) => !!s.dim);
  assert.ok(dim("issues").every(Boolean), "Linear's niches dim");
  assert.ok(!dim("prs").some(Boolean), "GitHub's stay lit");
  await swift(page, { type: "hover", id: "tile:issues:todo", x: 500, y: 60 });
  await waitFor(() => page.locator(".atlas-world-card").textContent({ timeout: 500 }).catch(() => ""), (t) => !!t && /Enable Linear in Settings/.test(t), "the card saying why");
  await page.context().close();
});


test("the command belt opens real queues, keeps requests unread until opened, and gives the map room", async () => {
  const { page } = await open("dungeon");
  const board = await waitFor(() => inspect(page), (i) => i?.counts?.unread > 0 && i?.counts?.needYou > 0, "the fleet", 30000);
  const replies = page.getByRole("button", { name: `Unread replies: ${board.counts.unread}`, exact: true });
  await replies.click();
  const tray = page.getByRole("dialog", { name: /Unread replies/ });
  await tray.waitFor();
  assert.equal(await tray.locator(".dh-entry").count(), board.counts.unread);
  assert.equal((await inspect(page)).counts.unread, board.counts.unread, "opening a tray reads no reply");
  await page.keyboard.press("Escape");
  await tray.waitFor({ state: "detached" });
  assert.equal(await replies.evaluate((e) => e === document.activeElement), true, "Escape restores the slot's focus");
  await page.getByRole("button", { name: /Waiting on you:/ }).click();
  await page.getByRole("dialog", { name: /Waiting on you/ }).waitFor();
  await page.getByRole("button", { name: /Running agents:/ }).click();
  const running = page.getByRole("dialog", { name: /Running agents/ });
  assert.equal(await running.locator(".dh-entry").count(), board.counts.running);
  // Queues keep the source's counts even though PR/issue sample lists are capped.
  await page.getByRole("button", { name: "Pull requests in review: 3", exact: true }).click();
  await page.getByRole("dialog", { name: /Pull requests in review/ }).getByText(/diagonal/).first().waitFor();
  await page.keyboard.press("Escape");
  const bounds = await page.evaluate(() => {
    const map = document.querySelector(".native-map-surface")!.getBoundingClientRect();
    const hud = document.querySelector(".dungeon-hud")!.getBoundingClientRect();
    return { mapBottom: map.bottom, hudTop: hud.top };
  });
  assert.ok(Math.abs(bounds.mapBottom - bounds.hudTop) <= 1, "the native viewport ends above the belt");
  await replies.click();
  await tray.locator(".dh-entry").first().click();
  await tray.waitFor({ state: "detached" });
  await waitFor(() => inspect(page), (i) => !!i?.selected, "the reply's agent selection");
  await page.context().close();
});

test("the belt's Dispatch opens the New agent form in the world's own panel", async () => {
  const { page } = await open("dungeon");
  await page.getByLabel("Dungeon command belt").waitFor();
  assert.equal(await page.locator(".dungeon-hud").getByText("Command belt").count(), 0, "the belt carries no name");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const dispatch = page.getByRole("dialog", { name: "Dispatch an agent" });
  await dispatch.waitFor();
  assert.equal(await dispatch.locator(".new-agent-form select[name=host]").count(), 1, "the app's own form");
  assert.equal(await page.locator("#detail-panel .new-agent").count(), 0, "the side panel stays as it was");
  await dispatch.locator("textarea").first().waitFor();
  await page.keyboard.press("Escape");
  await dispatch.waitFor({ state: "detached" });
  await page.context().close();
});

test("an unavailable integration shows a reason instead of a misleading zero", async () => {
  const { page } = await open("dungeon", { linear: false });
  await page.getByRole("button", { name: "Blocked issues: —", exact: true }).click();
  const tray = page.getByRole("dialog", { name: /Blocked issues/ });
  await tray.getByText(/Enable Linear in Settings/).waitFor();
  assert.equal(await tray.locator(".dh-entry").count(), 0);
  await page.context().close();
});

test("the belt gives Escape to a palette first and keeps its tray open beneath it", async () => {
  const { page } = await open("dungeon");
  await page.getByRole("button", { name: /Unread replies:/ }).click();
  const tray = page.getByRole("dialog", { name: /Unread replies/ });
  await tray.waitFor();
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await tray.count(), 1, "the underlying tray is still open");
  await page.keyboard.press("Escape");
  await tray.waitFor({ state: "detached" });
  await page.context().close();
});
