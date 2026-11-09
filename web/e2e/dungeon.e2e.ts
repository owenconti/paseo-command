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
import { DUNGEON_STATS, DUNGEON_GITHUB_QUEUES, DUNGEON_LINEAR_INBOX, DASHBOARD_ISSUES, DASHBOARD_PRS, dungeon } from "./fleets";

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
      githubQueues: DUNGEON_GITHUB_QUEUES,
      activity: DUNGEON_LINEAR_INBOX,
      github: DASHBOARD_PRS,
      linear: DASHBOARD_ISSUES,
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

test("the top integration totals are gone; seven belt slots show actionable queues", async () => {
  const {page}=await open("dungeon");
  const board=await waitFor(()=>inspect(page),i=>i?.scene === "dungeon" && i?.agents?.length,"Dungeon ready",30000);
  assert.deepEqual(board.vault,[]); assert.deepEqual(board.vaultSigns,[]);
  assert.equal((await native(page)).scenes.at(-1)!.entities.filter(e=>e.kind === "tile").length,0);
  assert.equal(await page.locator(".dh-slot").count(),7);
  await page.getByRole("button",{name:"GitHub review requests: 3",exact:true}).click();
  const reviews=page.getByRole("dialog",{name:/GitHub review requests/});
  await reviews.getByText("Requested review 1",{exact:true}).waitFor();
  assert.equal(await reviews.getByText(/Assigned PR/).count(),0);
  await page.getByRole("button",{name:"Assigned pull requests: 2",exact:true}).click();
  await page.getByRole("dialog",{name:/Assigned pull requests/}).getByText("Assigned PR 1",{exact:true}).waitFor();
  await page.getByRole("button",{name:/Failures and blocked work:/}).click();
  const problems=page.getByRole("dialog",{name:/Failures and blocked work/});
  await problems.getByRole("heading",{name:/Failed agents/}).waitFor();
  await problems.getByRole("heading",{name:/Blocked issues/}).waitFor();
  await problems.getByText("DE-1",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Assigned Linear issues: 17",exact:true}).click();
  const issues=page.getByRole("dialog",{name:/Assigned Linear issues/});
  await issues.getByText("In progress",{exact:true}).first().waitFor();
  assert.equal(await issues.getByText(/Done issue/).count(),0,"completed issues don't inflate active work");
  await page.getByRole("button",{name:"Unread Linear Inbox: 2",exact:true}).click();
  await page.getByRole("dialog",{name:/Unread Linear Inbox/}).getByText("New comment on issue 1",{exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await page.setViewportSize({width:800,height:800});
  for(const box of await page.locator(".dh-slot").evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()))) assert.ok(box.width >= 40 && box.x >= 0 && box.x+box.width <= 800,"compact belt keeps controls clickable and on screen");
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
  await waitFor(() => replies.evaluate((e) => e === document.activeElement), Boolean, "Escape restores the slot’s focus");
  await page.getByRole("button", { name: /Waiting on you:/ }).click();
  await page.getByRole("dialog", { name: /Waiting on you/ }).waitFor();
  await page.getByRole("button", { name: /Running agents:/ }).click();
  const running = page.getByRole("dialog", { name: /Running agents/ });
  assert.equal(await running.locator(".dh-entry").count(), board.counts.running);
  // Queues keep the source's counts even though PR/issue sample lists are capped.
  await page.getByRole("button", { name: "GitHub review requests: 3", exact: true }).click();
  await page.getByRole("dialog", { name: /GitHub review requests/ }).getByText(/diagonal/).first().waitFor();
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
  await page.getByRole("button", { name: "Assigned Linear issues: —", exact: true }).click();
  const tray = page.getByRole("dialog", { name: /Assigned Linear issues/ });
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


test("Linear Inbox reads only the notification selected, and capped or failed sources stay honest", async () => {
  const {page}=await open("dungeon");
  let feed=structuredClone(DUNGEON_LINEAR_INBOX);
  feed.sources.find(s=>s.source === "linear")!.limited=true;
  const writes: string[][]=[];
  await page.route("**/api/activity**",async route=>{
    if(route.request().method() === "POST") {
      const keys=route.request().postDataJSON().keys as string[];writes.push(keys);
      feed={...feed,items:feed.items.map(i=>keys.includes(i.key)?{...i,unread:false}:i)};
      feed.sources=feed.sources.map(s=>({...s,unread:feed.items.filter(i=>i.source === s.source && i.unread).length}));
      return route.fulfill({json:{feed}});
    }
    return route.fulfill({json:feed});
  });
  await page.evaluate(()=>window.dispatchEvent(new Event("paseo:secrets")));
  await page.getByRole("button",{name:"Unread Linear Inbox: 2+",exact:true}).click();
  const inbox=page.getByRole("dialog",{name:/Unread Linear Inbox/});
  await inbox.getByText("New comment on issue 1",{exact:true}).waitFor();
  assert.equal(writes.length,0,"opening the tray marks nothing read");
  await inbox.getByRole("button",{name:/New comment on issue 1/}).click();
  await waitFor(()=>Promise.resolve(writes.length),n=>n === 1,"one notification read");
  assert.deepEqual(writes[0],[DUNGEON_LINEAR_INBOX.items[0]!.key]);
  await page.getByRole("button",{name:"Unread Linear Inbox: 1+",exact:true}).waitFor();
  feed={...feed,items:[],sources:feed.sources.map(s=>s.source === "linear"?{...s,ok:false,reason:"Linear is temporarily unavailable"}:s)};
  await page.evaluate(()=>window.dispatchEvent(new Event("paseo:secrets")));
  await page.getByRole("button",{name:"Unread Linear Inbox: —",exact:true}).click();
  await page.getByRole("dialog",{name:/Unread Linear Inbox/}).getByText("Linear is temporarily unavailable").waitFor();
  await page.getByRole("button",{name:"GitHub review requests: 3",exact:true}).waitFor();
  await page.context().close();
});
