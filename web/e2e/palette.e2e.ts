/**
 * Cmd+K opens the command palette from anywhere: it runs the app's commands
 * and finds its agents, and keeps the page's own keys out while it is open.
 * Every /api request is answered in the browser; none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import {
  agentRow,
  detailOf,
  launch,
  mockApi,
  newContext,
  startApp,
  appEvent,
} from "./harness";
import { PAGES } from "../src/palette";

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

const AGENT = "agent-0000000000000000000000000000000000000001";

test("Cmd+K lists the commands; Enter runs one after the palette closes", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => [],
    projects: () => [
      { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
    ],
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).waitFor();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("Meta+k");
  await palette.waitFor();
  for (const label of ["New agent", "Next agent", "Keyboard shortcuts"])
    await palette.getByRole("option", { name: label }).first().waitFor();
  if (process.env.SHOT)
    await page.waitForTimeout(400), await page.screenshot({ path: process.env.SHOT });
  // D types into the search; it doesn't start a new agent behind it.
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await page.keyboard.press("d");
  assert.equal(await search.inputValue(), "d");
  assert.equal(await page.locator(".new-agent").count(), 0);
  // Cmd+K again closes it.
  await page.keyboard.press("Meta+k");
  await palette.waitFor({ state: "detached" });
  // Search, then Enter: a new agent opens with its message box focused.
  await page.keyboard.press("Meta+k");
  await search.fill("new ag");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached" });
  await page.locator(".new-agent").waitFor();
  // Text fields take no autofill, autocorrect or auto-capitalisation.
  const plain = async (field: typeof search) => {
    for (const attribute of ["autocomplete", "autocorrect", "autocapitalize"])
      assert.equal(await field.getAttribute(attribute), "off", attribute);
  };
  await plain(page.locator(".new-agent #composer"));
  // From the message box, Cmd+K still opens it; Escape closes it.
  await page.locator(".new-agent #composer").focus();
  await page.keyboard.press("Meta+k");
  await palette.waitFor();
  await plain(search);
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "detached" });
  // Escape went to the palette, not to the new agent behind it.
  assert.equal(await page.locator(".new-agent").count(), 1);
  // The shortcuts dialog, from the palette.
  await page.keyboard.press("Meta+k");
  await search.fill("keyboard");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
  await context.close();
});

test("typing an agent's name finds it, and Enter opens it", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => [agentRow(AGENT, "idle", "Fix the header")],
    detail: (id) => detailOf(id, "idle", { Name: "Fix the header" }),
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).waitFor();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("Meta+k");
  await palette.waitFor();
  // Agents are found by searching, not listed up front.
  assert.equal(
    await palette.getByRole("option", { name: /Fix the header/ }).count(),
    0,
  );
  await page.keyboard.type("header");
  const row = palette.getByRole("option", { name: /Fix the header/ });
  await row.waitFor();
  assert.equal(await row.getAttribute("aria-selected"), "true");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached" });
  await page.waitForFunction(() => location.search.includes("agent"));
  await context.close();
});

test("the open agent's actions and the header's tools are in the palette", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => [agentRow(AGENT, "idle", "Fix the header")],
    detail: (id) => detailOf(id, "idle", { Name: "Fix the header" }),
  });
  await page.goto(`${app.url}?agent=${AGENT}`);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).waitFor();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await page.keyboard.press("Meta+k");
  await palette.waitFor();
  for (const label of [
    "Rename “Fix the header”…",
    "Archive “Fix the header”…",
    "Open the agent in Paseo",
    "Copy the agent's ID",
    "Settings",
    "Open the mini games",
  ])
    await palette.getByRole("option", { name: label }).first().waitFor();
  // Idle: nothing to interrupt.
  assert.equal(
    await palette.getByRole("option", { name: "Interrupt the agent" }).count(),
    0,
  );
  // Settings opens the Settings page, in the map's place.
  await search.fill("settings");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached" });
  await page.getByRole("region", { name: "Settings", exact: true }).waitFor();
  await context.close();
});

test("in the macOS app, the terminal's menu commands are listed and reach the app", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  // The app's message channel, recording the menu items chosen.
  await page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(m) } } };
  `);
  await mockApi(page, { agents: () => [] });
  await page.goto(app.url);
  await page.locator(".fleet-sidebar").waitFor();
  // The app's top bar is native: the page draws none, and tells the app what its tools show.
  assert.equal(await page.locator(".app-bar").count(), 0);
  await page.waitForFunction(() =>
    (window as unknown as { sentToApp: { type: string; panelSide?: string }[] }).sentToApp.some(
      (m) => m.type === "barState" && m.panelSide !== undefined,
    ),
  );
  // Its buttons open what they name beneath themselves (their rectangle is above the page).
  const bar = (action: string) =>
    appEvent(page, "paseo:bar", { action, x: 1100, y: -34, width: 28, height: 26 });
  await bar("releases");
  const notes = page.getByRole("dialog", { name: "What's new" });
  await notes.waitFor();
  assert.ok((await notes.boundingBox())!.y < 20);
  await bar("releases");
  await notes.waitFor({ state: "detached" });
  await bar("panel-toggle");
  await page.locator(".floating-command[data-collapsed='true']").waitFor({ state: "attached" });
  await page.waitForFunction(() =>
    (window as unknown as { sentToApp: { type: string; panelCollapsed?: boolean }[] }).sentToApp.some(
      (m) => m.type === "barState" && m.panelCollapsed === true,
    ),
  );
  await bar("panel-toggle");
  await page.locator(".floating-command[data-collapsed='false']").waitFor();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await page.keyboard.press("Meta+k");
  await search.fill("term");
  for (const label of [
    "Show or hide the terminal",
    "Maximize the terminal",
    "Unsplit terminals",
    "Bigger terminal text",
  ])
    await palette.getByRole("option", { name: label }).waitFor();
  // The mode bar's tabs shown, in its order, with ⌘1…⌘6 by their place (no integrations here).
  await search.fill("next in the map");
  await palette.getByRole("option", { name: /Next in the map's place: map, browser, Settings/ }).waitFor();
  await search.fill("show the browser");
  const browserTab = palette.getByRole("option", { name: /Show the browser \(Conquer\)/ });
  assert.match(await browserTab.locator(".palette-keys").innerText(), /⌘\s*2/);
  await search.fill("maximize term");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached" });
  await page.waitForFunction(() =>
    (window as unknown as { sentToApp: { type: string; action?: string }[] }).sentToApp.some(
      (m) => m.type === "menu" && m.action === "terminal-maximize",
    ),
  );
  await context.close();
});

test("every entry names its page, then its keys", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  // In the macOS app, with an agent open: the most entries the mocks offer.
  await page.addInitScript(`
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: () => {} } } };
  `);
  await mockApi(page, {
    agents: () => [agentRow(AGENT, "idle", "Fix the header")],
    detail: (id) => detailOf(id, "idle", { Name: "Fix the header" }),
  });
  await page.goto(`${app.url}?agent=${AGENT}`);
  await page.locator(".fleet-sidebar").waitFor({ state: "attached" });
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  await page.keyboard.press("Meta+k");
  await palette.waitFor();
  await palette.getByRole("option", { name: /Keyboard shortcuts/ }).waitFor();
  // Every row, unsearched and as each letter finds them (the found agents,
  // workspaces and projects too), shows one of the app's pages.
  const seen = new Set<string>();
  for (const query of ["", ..."abcdefghijklmnopqrstuvwxyz"]) {
    await search.fill(query);
    const rows = await palette.getByRole("option").evaluateAll((options) =>
      options.map((o) => ({
        label: o.querySelector(".palette-label")?.textContent ?? "",
        page: o.querySelector(".palette-page")?.textContent ?? "",
      })),
    );
    for (const row of rows) {
      const name = row.page.split(" · ")[0];
      assert.ok(
        (PAGES as readonly string[]).includes(name),
        `“${row.label}” names no page (${JSON.stringify(row.page)})`,
      );
      seen.add(name);
    }
  }
  for (const name of ["Command", "Conquer", "Settings", "Terminal", "App"])
    assert.ok(seen.has(name), name);
  // The page comes first, then the keys.
  await search.fill("show or hide the terminal");
  const terminal = palette.getByRole("option", { name: /Show or hide the terminal/ });
  assert.deepEqual(
    await terminal.evaluate((o) =>
      [...o.querySelectorAll(".palette-meta > *")].map((e) => e.className),
    ),
    ["palette-page", "palette-keys"],
  );
  assert.equal(await terminal.locator(".palette-page").innerText(), "Terminal");
  // A found thing keeps its kind after its page.
  await search.fill("fix the header");
  assert.equal(
    await palette
      .getByRole("option", { name: /Fix the header/ })
      .first()
      .locator(".palette-page")
      .innerText(),
    "Command · Agent",
  );
  if (process.env.SHOT) {
    await search.fill("th");
    await page.waitForTimeout(300);
    await page.screenshot({ path: process.env.SHOT });
  }
  await context.close();
});
