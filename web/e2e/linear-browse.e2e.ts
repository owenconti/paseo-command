/**
 * Finding issues in the Linear tab: a team's cycles. The page's Linear
 * requests run the real server route over the fake Linear (`linearFake.ts`);
 * every other /api request is answered in the browser. Nothing reaches a
 * daemon or Linear.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { FAKE_IDS, fakeWorkspace } from "../server/linear/fake";
import { launch, mockApi, newContext, startApp, waitFor } from "./harness";
import { mockLinear } from "./linearFake";

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

const rowKeys = (page: Page) =>
  page.locator(".linear-list .linear-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.key));

/** The Linear view, wide enough that the open issue shows beside the list, with nothing but Linear mocked. */
async function openLinear(ws = fakeWorkspace()) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await mockApi(page, { agents: () => [], lists: { settings: { integrations: { linear: true } } } });
  const linear = await mockLinear(page, ws);
  await page.goto(app.url);
  await page.locator(".fleet-sidebar").waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "linear" } })));
  const view = page.locator(".linear-view");
  const sidebar = view.locator(".linear-sidebar");
  await sidebar.getByRole("button", { name: /^ENG/ }).waitFor();
  return { context, page, linear, view, sidebar };
}

test("a team's cycles: current and past with their progress, each opening its issues", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    const eng = sidebar.locator('.linear-team[data-team="ENG"]');
    await eng.getByRole("button", { name: "Cycles" }).click();
    // DE doesn't run cycles.
    await sidebar.getByRole("button", { name: /^DE/ }).click();
    assert.equal(await sidebar.locator('.linear-team[data-team="DE"]').getByRole("button", { name: "Cycles" }).count(), 0);

    const cycles = view.locator(".linear-cycles");
    await cycles.locator(".linear-cycle-row").first().waitFor();
    assert.deepEqual(await cycles.locator(".linear-cycle-section h3").allInnerTexts(), ["CURRENT", "PAST"]);
    const current = cycles.locator(".linear-cycle-row", { hasText: "Cycle 7" });
    assert.match(await current.innerText(), /0 of 2 done/);
    const past = cycles.locator(".linear-cycle-row", { hasText: "Cycle 6 · Groundwork" });
    assert.match(await past.innerText(), /1 of 1 done/);
    assert.match(await past.innerText(), /100%/);

    // A cycle's issues, its days and what's done, counted as edits come.
    await current.click();
    await view.locator(".linear-list-head h2", { hasText: "Cycle 7" }).waitFor();
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-2", "cycle 7's issues");
    const summary = view.locator(".linear-project-summary");
    assert.match(await summary.innerText(), /Current/);
    assert.match(await summary.innerText(), /0 of 2 done/);
    assert.ok(linear.requests.some((r) => r.operation === "Issues" && JSON.stringify(r.variables.filter).includes(FAKE_IDS.cycles.eng)));

    // The crumb goes back to the cycles, which the sidebar marks.
    await view.locator(".linear-list-head").getByRole("button", { name: "Cycles" }).click();
    await cycles.locator(".linear-cycle-row", { hasText: "Cycle 6" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-6", "cycle 6's issue");
    assert.match(await summary.innerText(), /Ended/);
    assert.equal(await eng.getByRole("button", { name: "Cycles" }).getAttribute("aria-current"), "page");

    // ⌘K goes to a team's current cycle.
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Engineering's current cycle");
    await page.keyboard.press("Enter");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-2", "the current cycle from ⌘K");
  } finally {
    linear.restore();
    await context.close();
  }
});

const groupNames = (page: Page) =>
  page.locator(".linear-list .linear-group h3 span[id]").allInnerTexts();
const focusedKey = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key);

test("a list's display: grouping, ordering and finished issues, kept for the place; filters as chips", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 5, "ENG's issues");
    assert.deepEqual(await groupNames(page), ["In Progress", "In Review", "Todo", "Triage", "Done"]);

    // Grouped by assignee (you first), ordered by title, without what's finished.
    await view.getByRole("button", { name: "Display" }).click();
    const menu = view.getByRole("dialog", { name: "Display options" });
    await menu.getByLabel("Grouping").selectOption("assignee");
    await menu.getByLabel("Ordering").selectOption("title");
    assert.deepEqual(await groupNames(page), ["Owen Conti", "Sam Rivera", "No assignee"]);
    assert.deepEqual(await rowKeys(page), ["ENG-5", "ENG-3", "ENG-1", "ENG-2", "ENG-4"]);
    await menu.getByLabel("Completed issues").selectOption("none");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-3,ENG-1,ENG-2,ENG-4", "nothing finished");
    assert.equal(await view.locator(".linear-list-head .linear-count").first().innerText(), "4");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });

    // Kept for the place across a reload; another place has its own.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "linear" } })));
    await waitFor(() => groupNames(page), (names) => names.join() === "Owen Conti,Sam Rivera,No assignee", "the display again");
    await sidebar.getByRole("button", { name: "Assigned" }).click();
    await waitFor(() => groupNames(page), (names) => names.join() === "In Progress,In Review", "Assigned's own display");
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    await waitFor(() => groupNames(page), (names) => names[0] === "Owen Conti", "ENG All's display");
    await view.getByRole("button", { name: "Display" }).click();
    await menu.getByRole("button", { name: "Reset to default" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 5, "the default display");
    await page.keyboard.press("Escape");

    // F: Filter's menu, a property's picker, its values; the chip says what's chosen.
    await view.locator('.linear-row[data-key="ENG-1"]').focus();
    await page.keyboard.press("f");
    await view.getByRole("menu", { name: "Filter by" }).getByRole("menuitem", { name: "Priority" }).click();
    const priorities = page.getByRole("listbox", { name: "Priority" });
    await priorities.getByRole("option", { name: "Urgent" }).click();
    await priorities.getByRole("option", { name: "High" }).click();
    await page.keyboard.press("Escape");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-3", "urgent and high issues");
    const chip = view.locator(".linear-filter-chip");
    assert.match(await chip.innerText(), /Priority\s+is any of\s+Urgent, High/);
    // ⌘K clears them.
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Clear the Linear list's filters");
    await page.keyboard.press("Enter");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 5, "no filters");
    assert.equal(await chip.count(), 0);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("a board: a column for each of the team's states, cards dragged between them change the issue's status", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 5, "ENG's issues");
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Show the Linear issues as a board");
    await page.keyboard.press("Enter");
    const board = view.locator(".linear-board");
    await board.waitFor();
    assert.deepEqual(await groupNames(page), ["In Progress", "In Review", "Todo", "Triage", "Backlog", "Done", "Canceled"]);
    const column = (name: string) => board.locator(".linear-column", { has: page.locator(`h3 span[id]:text-is("${name}")`) });
    assert.equal(await column("Backlog").locator(".linear-card").count(), 0);

    // A card opens its issue in the board's place (it needs the width), and Back returns.
    await column("In Progress").locator('.linear-card[data-key="ENG-1"]').click();
    await view.locator(".linear-issue h1", { hasText: "Ship the Linear tab" }).waitFor();
    assert.equal(await board.count(), 0);
    await view.getByRole("button", { name: "Back", exact: true }).click();
    await board.waitFor();

    // ←/→ go between columns.
    await column("In Progress").locator('.linear-card[data-key="ENG-1"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await focusedKey(page), "ENG-3");
    await page.keyboard.press("ArrowRight");
    assert.equal(await focusedKey(page), "ENG-2");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await focusedKey(page), "ENG-3");

    // Dragged to In Progress: the issue's status, in Linear too.
    await column("Todo").locator('.linear-card[data-key="ENG-2"]').dragTo(column("In Progress"));
    await column("In Progress").locator('.linear-card[data-key="ENG-2"]').waitFor();
    await waitFor(
      async () => linear.ws.issues.find((i) => i.identifier === "ENG-2")!.state.id,
      (id) => id === FAKE_IDS.states.eng["In Progress"],
      "the status in Linear",
    );
    assert.equal(await column("Todo").locator(".linear-card").count(), 0);

    // Back to a list from ⌘K.
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Show the Linear issues as a list");
    await page.keyboard.press("Enter");
    await view.locator(".linear-groups .linear-row").first().waitFor();
    assert.equal(await board.count(), 0);
  } finally {
    linear.restore();
    await context.close();
  }
});
