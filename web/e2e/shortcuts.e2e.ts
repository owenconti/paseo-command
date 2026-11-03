/**
 * The panel header's keyboard button lists the shortcuts in a dialog that
 * keeps the page's own keys out while it is open. Every /api request is
 * answered in the browser; none reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright";
import { appEvent, launch, mockApi, newContext, startApp } from "./harness";

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

test("the keyboard button opens the shortcuts, and Escape closes them", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, { agents: () => [], projects: () => [] });
  await page.goto(app.url);
  const button = page.getByRole("button", { name: "Keyboard shortcuts" });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await dialog.waitFor();
  for (const label of ["Next agent", "New agent", "Fit the whole map", "New line"])
    await dialog.getByText(label, { exact: true }).waitFor();
  if (process.env.SHOT) await page.waitForTimeout(600), await page.screenshot({ path: process.env.SHOT });
  // D would start a new agent behind it; the dialog keeps it.
  const before = page.url();
  await page.keyboard.press("d");
  assert.equal(page.url(), before);
  assert.equal(await page.locator(".new-agent").count(), 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Keyboard shortcuts",
  );
  await context.close();
});

test("? opens the shortcuts from the page, but types in a text field", async () => {
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
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await page.keyboard.press("?");
  await dialog.getByText("Show these shortcuts", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  // In the new agent's message box, ? is just a character.
  await page.locator("body").press("d");
  const composer = page.locator(".new-agent #composer");
  await composer.focus();
  await page.keyboard.press("?");
  assert.equal(await composer.inputValue(), "?");
  assert.equal(await dialog.count(), 0);
  await context.close();
});

test("in the macOS app, the mode bar's keys list its tabs in order, Settings being the gear", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.addInitScript(`
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: () => {} } } };
  `);
  await mockApi(page, { agents: () => [], projects: () => [] });
  await page.goto(app.url);
  await page.locator(".fleet-sidebar").waitFor({ state: "attached" });
  await appEvent(page, "paseo:command", "show-shortcuts");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await dialog.waitFor();
  // No integrations here: the map, Files and the browser.
  await dialog.getByText("Next in the map's place: the map, Files, the browser (Conquer)", { exact: true }).waitFor();
  const tabs = dialog.locator("li, tr, div").filter({
    has: page.getByText("The mode bar's tab in that place: the map, Files, the browser (Conquer)", { exact: true }),
  }).last();
  assert.match(await tabs.innerText(), /1…3/);
  await dialog.getByText("Settings (the bar's gear), or back from it; Esc goes back too", { exact: true }).waitFor();
  await context.close();
});
