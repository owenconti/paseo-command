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
} from "./harness";

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
  // From the message box, Cmd+K still opens it; Escape closes it.
  await page.locator(".new-agent #composer").focus();
  await page.keyboard.press("Meta+k");
  await palette.waitFor();
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
