/**
 * The Dungeon Board has no side panel: what the panel showed there shows in the board's own framed panels in the
 * middle instead. A picked workspace or project, and Add project, open in the board's place panel
 * (src/dungeon/WorldPlace.tsx); a robot's conversation is its dialogue box; New agent is the board's Dispatch.
 * The other map styles keep the panel. Swift's side of the bridge is a stub; every /api request is answered
 * in the browser.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { detailOf, launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { DUNGEON_STATS, DASHBOARD_ISSUES, DASHBOARD_PRS, dungeon } from "./fleets";

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

type Sent = { type: string; [field: string]: any };
async function open(style: "dungeon" | "islands" = "dungeon", store: Record<string, unknown> = {}): Promise<Page> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ([initial, kept]) => {
      if (!sessionStorage.getItem("e2e-opened")) {
        localStorage.setItem("paseo-command:atlas:style", JSON.stringify(initial));
        for (const [key, value] of Object.entries(kept as Record<string, unknown>)) localStorage.setItem(`paseo-command:${key}`, JSON.stringify(value));
      }
      sessionStorage.setItem("e2e-opened", "1");
      const sent: unknown[] = [];
      (window as any).__sent = sent;
      (window as any).webkit = {
        messageHandlers: {
          paseoWorld: {
            postMessage(m: any) {
              if (m.type === "art") setTimeout(() => window.dispatchEvent(new CustomEvent("paseo:world", { detail: { type: "ready" } })));
              if (["barState", "menu", "select", "talk"].includes(m.type)) sent.push(m);
            },
          },
        },
      };
    },
    [style, store] as const,
  );
  await mockApi(page, {
    agents: () => dungeon.agents,
    permissions: () => dungeon.permissions,
    hosts: () => dungeon.hosts,
    projects: () => dungeon.projects,
    workspaces: () => dungeon.workspaces,
    detail: (id: string) => {
      const row = (dungeon.agents as unknown as { id: string; status: string }[]).find((a) => a.id === id);
      return detailOf(id, row?.status ?? "idle", {});
    },
    timeline: () => ({ items: [{ kind: "user", text: "Tidy the README", messageId: "u1" }, { kind: "assistant", text: "Done. Shall I open the pull request?", messageId: "r1" }] }),
    accept: () => true,
    lists: {
      hoststats: DUNGEON_STATS,
      github: DASHBOARD_PRS,
      linear: DASHBOARD_ISSUES,
      settings: { linearWorkspace: "", integrations: { github: true, linear: true, typesafe: false }, error: null },
    },
  } as any);
  await page.goto(app.url);
  await waitFor(() => page.evaluate(() => (window as any).paseoAtlas?.inspect() as any), (i) => !!i?.agents?.length, "the map", 30000);
  return page;
}
const lastOf = (page: Page, type: string) => page.evaluate((t) => ((window as any).__sent as Sent[]).filter((m) => m.type === t).at(-1), type);
const swift = (page: Page, detail: Record<string, unknown>) =>
  page.evaluate((d) => window.dispatchEvent(new CustomEvent("paseo:world", { detail: d })), detail);
const key = (id: string, host = "local") => JSON.stringify([host, id]);
const pick = (page: Page, id: string, host?: string) => swift(page, { type: "pick", id: key(id, host) });
const sidePanel = (page: Page) => page.locator(".floating-command");
const panelWidth = (page: Page) => sidePanel(page).evaluate((el) => Math.round(el.getBoundingClientRect().width));
const place = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });
const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });

test("the Dungeon Board has no side panel: no width, no key, no bar buttons, no ⌘K entry for it; the map has the window", async () => {
  // Shown before (its saved state says so): the board still has none.
  const page = await open("dungeon", { "unity-sidebar": { side: "left", width: 420, mode: "compact", collapsed: false } });
  await page.locator('.floating-command[data-absent="true"][data-collapsed="true"]').waitFor({ state: "attached" });
  assert.equal(await panelWidth(page), 0);
  const frame = await page.evaluate(() => {
    const r = document.querySelector(".native-world-frame")!.getBoundingClientRect();
    return { left: Math.round(r.left), width: Math.round(r.width), window: innerWidth };
  });
  assert.deepEqual([frame.left, frame.width], [0, frame.window], "the board has the window's width");
  // The app's bar is told its panel buttons go.
  const bar = await waitFor(() => lastOf(page, "barState"), (m) => m?.panelAbsent === true, "the bar told");
  assert.equal(bar!.panelCollapsed, true);
  assert.equal(bar!.layoutEnabled, false);
  // ⌘B and the bar's own buttons show nothing.
  await page.keyboard.press("Meta+b");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:bar", { detail: { action: "panel-toggle", rect: { x: 0, y: 0, width: 0, height: 0 } } })));
  await page.waitForTimeout(200);
  assert.equal(await panelWidth(page), 0);
  assert.equal(await sidePanel(page).getAttribute("data-collapsed"), "true");
  // ⌘K has no panel or list entries here.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Show or hide the panel");
  await page.waitForTimeout(250);
  assert.equal(await palette(page).getByRole("option", { name: /Show or hide the panel/ }).count(), 0);
  await palette(page).getByRole("combobox").fill("Show workspaces");
  await page.waitForTimeout(250);
  assert.equal(await palette(page).getByRole("option", { name: /^Show workspaces/ }).count(), 0);
  // Another map style has its panel again, as it was left; back on the board it goes.
  await palette(page).getByRole("combobox").fill("Use the Islands map");
  await palette(page).getByRole("option", { name: /Use the Islands map/ }).click();
  await page.locator('.floating-command[data-collapsed="false"]:not([data-absent])').waitFor();
  assert.ok((await panelWidth(page)) >= 300, "the panel is back at its width");
  await waitFor(() => lastOf(page, "barState"), (m) => m?.panelAbsent === false && m.panelCollapsed === false, "the bar's buttons back");
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Show or hide the panel");
  await palette(page).getByRole("option", { name: /Show or hide the panel/ }).waitFor();
  await palette(page).getByRole("combobox").fill("Use the Dungeon Board map");
  await palette(page).getByRole("option", { name: /Use the Dungeon Board map/ }).click();
  await page.locator('.floating-command[data-absent="true"]').waitFor({ state: "attached" });
  assert.equal(await panelWidth(page), 0);
  await page.context().close();
});

test("a picked workspace opens in the board's own panel: its path, Dispatch, Changes, Archive and its agents, who open their dialogue box", async () => {
  // Picking a robot doesn't talk here (Settings → Map): one picked in the panel still does.
  const page = await open("dungeon", { "world:talkOnPick": false });
  await pick(page, "wks_api");
  const panel = place(page, "Workspace");
  await panel.waitFor();
  assert.equal(await panelWidth(page), 0, "not the side panel");
  // In the middle of the board, above the belt.
  const where = await page.evaluate(() => {
    const p = document.querySelector(".world-place")!.getBoundingClientRect();
    const f = document.querySelector(".native-world-frame")!.getBoundingClientRect();
    const belt = document.querySelector(".dungeon-hud")!.getBoundingClientRect();
    return { centre: Math.round(p.left + p.width / 2 - (f.left + f.width / 2)), bottom: p.bottom, belt: belt.top, top: p.top };
  });
  assert.ok(Math.abs(where.centre) <= 2, `centred: ${where.centre}`);
  assert.ok(where.bottom <= where.belt && where.top >= 0, "above the belt, on screen");
  // The app's own view of it, in the board's colours.
  await panel.getByRole("heading", { name: "api" }).waitFor();
  await panel.getByRole("button", { name: /Dispatch into this workspace/ }).waitFor();
  await panel.getByRole("button", { name: "Changes" }).waitFor();
  await panel.getByRole("button", { name: /^Archive/ }).waitFor();
  await panel.getByText(/Agents here/).waitFor();
  assert.equal(await panel.getByRole("button", { name: /Fleet/ }).count(), 0, "no Back to the fleet: its × and Esc close it");
  const colours = await panel.evaluate((el) => {
    const style = getComputedStyle(el);
    return { text: style.getPropertyValue("--text").trim(), panel: style.getPropertyValue("--panel").trim() };
  });
  assert.deepEqual(colours, { text: "#f2ead6", panel: "#251e40" }, "the dialogue box's palette");
  // Changes asks the app for the Files tab.
  await panel.getByRole("button", { name: "Changes" }).click();
  await waitFor(() => lastOf(page, "menu"), (m) => m?.action === "files", "the Files tab asked for");
  // Dispatch into it: the board's Dispatch takes the panel's place, and gives it back.
  await panel.getByRole("button", { name: /Dispatch into this workspace/ }).click();
  const dispatch = place(page, "Dispatch an agent");
  await dispatch.waitFor();
  assert.equal(await panel.count(), 0);
  await page.keyboard.press("Escape");
  await dispatch.waitFor({ state: "detached" });
  await panel.waitFor();
  // One of its agents: its dialogue box, the panel gone.
  await panel.locator(".place-agents .registry-row").first().click();
  const talk = page.getByRole("dialog", { name: /^Conversation with / });
  await talk.waitFor();
  assert.equal(await panel.count(), 0);
  // Its choices offer the whole conversation over the board, not a side panel's chat.
  for (let i = 0; i < 20 && !(await page.getByRole("menu", { name: "What you can say" }).isVisible()); i++) await page.keyboard.press("Enter");
  const choices = page.getByRole("menu", { name: "What you can say" });
  assert.equal(await choices.getByRole("menuitem", { name: /side panel|full chat/i }).count(), 0);
  await choices.getByRole("menuitem", { name: /Whole conversation/ }).click();
  await talk.locator(".wc-log").waitFor();
  await waitFor(() => page.evaluate(() => document.activeElement?.id), (id) => id === "world-composer", "its message box has the keyboard");
  assert.equal(await panelWidth(page), 0, "still no side panel");
  await page.keyboard.press("Escape");
  await talk.waitFor({ state: "detached" });
  // Esc closes the workspace's panel too, and lets the workspace go.
  await pick(page, "wks_api");
  await panel.waitFor();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  await waitFor(() => lastOf(page, "select"), (m) => m?.id === null, "nothing selected");
  await page.context().close();
});

test("a picked project, Add project and New agent open in the board's panels too", async () => {
  const page = await open();
  await pick(page, "prj_core-platform");
  const project = place(page, "Project");
  await project.waitFor();
  await project.getByRole("button", { name: /Dispatch to this project/ }).waitFor();
  // One of its workspaces: the workspace's panel in its place.
  await project.locator(".workspace-list .registry-row, .place-agents .registry-row").first().waitFor();
  await project.getByRole("button", { name: "Close the project" }).click();
  await project.waitFor({ state: "detached" });
  // ⌘K's Add project.
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("Add project");
  await palette(page).getByRole("option", { name: /^Add project/ }).first().click();
  const add = place(page, "Add a project");
  await add.waitFor();
  assert.equal(await page.locator("#detail-panel .add-project").count(), 0, "not in the side panel");
  assert.equal(await panelWidth(page), 0);
  // ⌘N: the board's Dispatch, in Add project's place.
  await page.keyboard.press("Escape");
  await add.waitFor({ state: "detached" });
  await page.keyboard.press("Meta+k");
  await palette(page).getByRole("combobox").fill("New agent");
  await palette(page).getByRole("option", { name: /^New agent/ }).first().click();
  await place(page, "Dispatch an agent").waitFor();
  assert.equal(await page.locator("#detail-panel .new-agent").count(), 0, "not in the side panel");
  assert.equal(await panelWidth(page), 0);
  await page.context().close();
});

test("the Islands keep the side panel: a picked workspace opens there, with no board panel", async () => {
  const page = await open("islands", { "unity-sidebar": { side: "left", width: 420, mode: "compact", collapsed: false } });
  await pick(page, "wks_api");
  await page.locator("#detail-panel .place").waitFor();
  assert.ok((await panelWidth(page)) >= 300);
  assert.equal(await page.locator(".world-place").count(), 0);
  assert.equal(await sidePanel(page).getAttribute("data-absent"), null);
  await page.context().close();
});
