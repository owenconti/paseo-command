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

    // C there makes an issue in the cycle's team, in the cycle.
    await view.locator('.linear-row[data-key="ENG-2"]').focus();
    await page.keyboard.press("c");
    const dialog = page.locator(".linear-create");
    await dialog.getByRole("button", { name: "Team: Engineering" }).waitFor();
    assert.match(await dialog.locator(".linear-create-parent").innerText(), /In Cycle 7/);
    await dialog.getByRole("textbox", { name: "Issue title" }).fill("Plan the next cycle");
    await page.keyboard.press("Meta+Enter");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 3, "the new issue in the cycle");
    assert.equal(
      linear.ws.issues.find((i) => i.title === "Plan the next cycle")?.cycle?.id,
      FAKE_IDS.cycles.eng,
    );
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

test("saved views: listed in the sidebar, each with its own filter and Linear's display, kept current as issues change", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    const views = sidebar.locator('section[aria-labelledby="linear-nav-views"]');
    await views.getByRole("button", { name: "Sam's work" }).waitFor();
    assert.deepEqual(await views.locator(".linear-nav-label").allInnerTexts(), ["Launch in flight", "Sam's work"]);

    // Sam's work: a list without groups, nothing finished (as the view is set in Linear).
    await views.getByRole("button", { name: "Sam's work" }).click();
    await view.locator(".linear-list-head h2", { hasText: "Sam's work" }).waitFor();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 2, "Sam's open issues");
    assert.deepEqual((await rowKeys(page)).sort(), ["DE-1", "ENG-2"]);
    assert.match(await view.locator(".linear-view-about").innerText(), /Only you · by Owen Conti/);
    assert.ok(linear.requests.some((r) => r.operation === "ViewIssues"));

    // Launch in flight: a board by assignee.
    await views.getByRole("button", { name: "Launch in flight" }).click();
    await view.locator(".linear-board").waitFor();
    await waitFor(() => groupNames(page), (names) => names.join() === "Owen Conti", "a column for Owen");
    assert.deepEqual(
      await view.locator(".linear-card").evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.key)),
      ["ENG-3", "ENG-1"],
      "urgent first",
    );
    assert.match(await view.locator(".linear-view-about").innerText(), /Started work on the launch/);

    // ENG-3 is done elsewhere: the next sync asks for the view again, and it leaves.
    const eng3 = linear.ws.issues.find((i) => i.identifier === "ENG-3")!;
    eng3.state = { id: FAKE_IDS.states.eng.Done };
    eng3.updatedAt = new Date().toISOString();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(
      () => view.locator(".linear-card").evaluateAll((cards) => cards.map((c) => (c as HTMLElement).dataset.key)),
      (keys) => keys.join() === "ENG-1",
      "ENG-3 to leave the view",
    );

    // ⌘K goes to a view.
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Sam's work (Linear view)");
    await page.keyboard.press("Enter");
    await view.locator(".linear-list-head h2", { hasText: "Sam's work" }).waitFor();
  } finally {
    linear.restore();
    await context.close();
  }
});

test("search: every issue in the workspace, most relevant first, as typing pauses", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: "Search Linear" }).click();
    const field = view.getByRole("searchbox", { name: "Search all issues in Linear" });
    await waitFor(() => field.evaluate((el) => el === document.activeElement), (v) => v, "the field to have the keyboard");
    await view.locator(".linear-note", { hasText: "Type two or more characters" }).waitFor();

    // Across teams, finished issues too; one request once typing pauses.
    await page.keyboard.type("the");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 7, "seven issues found");
    const found = await rowKeys(page);
    for (const key of ["DE-1", "DE-2", "ENG-3", "ENG-6"]) assert.ok(found.includes(key), `${key} is found`);
    assert.equal(linear.requests.filter((r) => r.operation === "SearchIssues").length, 1);
    assert.deepEqual(linear.requests.find((r) => r.operation === "SearchIssues")?.variables.term, "the");
    await field.fill("sync design");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-3", "ENG-3 found");

    // ↓ goes into the results, which open beside.
    await page.keyboard.press("ArrowDown");
    await view.locator(".linear-issue h1", { hasText: "Review the sync design" }).waitFor();

    // Nothing found says so; the words come back after a reload.
    await field.fill("no such words");
    await view.locator(".linear-note", { hasText: "No issues match." }).waitFor();
    await field.fill("draw");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-2", "ENG-2 found");
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "linear" } })));
    assert.equal(await field.inputValue(), "draw");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-2", "ENG-2 again");

    // ⌘K comes back to it from elsewhere, the words kept.
    await sidebar.getByRole("button", { name: "Assigned" }).click();
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Search all Linear issues");
    await page.keyboard.press("Enter");
    await waitFor(() => field.evaluate((el) => el === document.activeElement), (v) => v, "the field again");
    assert.equal(await field.inputValue(), "draw");
  } finally {
    linear.restore();
    await context.close();
  }
});

test("the inbox: your notifications by issue, read as they open, U, H and ⌫, snoozed ones apart, archive with Undo", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    const inboxItem = sidebar.getByRole("button", { name: /^Inbox/ });
    const badge = () => inboxItem.locator(".linear-nav-badge").innerText().catch(() => "");
    await waitFor(badge, (n) => n === "2", "two unread rows");
    await inboxItem.click();
    const inbox = view.locator(".linear-inbox");
    const rowKeysIn = () =>
      inbox.locator(".linear-inbox-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.key));
    await waitFor(rowKeysIn, (keys) => keys.length === 3, "three rows");
    const I = FAKE_IDS;
    assert.deepEqual(await rowKeysIn(), [`issue:${I.issues["ENG-1"]}`, `issue:${I.issues["ENG-3"]}`, `project:${I.projects.launch}`]);
    const row = (key: string) => inbox.locator(`.linear-inbox-row[data-key="${key}"]`);
    const eng1 = row(`issue:${I.issues["ENG-1"]}`);
    const eng3 = row(`issue:${I.issues["ENG-3"]}`);
    const launch = row(`project:${I.projects.launch}`);
    assert.match(await eng1.innerText(), /Ship the Linear tab/);
    assert.match(await eng1.innerText(), /Sam Rivera commented: “Can we start with the list\?”/);
    assert.equal(await eng1.locator(".linear-count").innerText(), "2");
    const note = (id: string) => linear.ws.notifications.find((n) => n.id === id)!;

    // Opening a row opens its issue beside, and reads it, in Linear too.
    await eng1.click();
    await view.locator(".linear-issue h1", { hasText: "Ship the Linear tab" }).waitFor();
    await waitFor(badge, (n) => n === "1", "one unread row");
    await waitFor(async () => !!note(I.notifications.eng1Comment).readAt && !!note(I.notifications.eng1Reaction).readAt, (v) => v, "read in Linear");

    // U marks it unread again.
    await eng3.focus();
    await page.keyboard.press("u");
    await waitFor(async () => note(I.notifications.eng3Assigned).readAt, (v) => v === null, "unread in Linear");
    await waitFor(badge, (n) => n === "2", "two unread rows again");

    // H snoozes it: it leaves for Snoozed, with DE-2 already there.
    await eng3.focus();
    await page.keyboard.press("h");
    await page.getByRole("menu", { name: "Snooze until" }).getByRole("menuitem", { name: /An hour/ }).click();
    await waitFor(rowKeysIn, (keys) => keys.length === 2, "ENG-3 snoozed");
    assert.ok(note(I.notifications.eng3Assigned).snoozedUntilAt);
    await inbox.getByRole("button", { name: "Snoozed 2" }).click();
    await waitFor(rowKeysIn, (keys) => keys.length === 2, "two snoozed");
    await row(`issue:${I.issues["ENG-3"]}`).hover();
    await inbox.getByRole("button", { name: "Unsnooze ENG-3" }).click();
    await waitFor(async () => note(I.notifications.eng3Assigned).snoozedUntilAt, (v) => v === null, "woken in Linear");
    await inbox.getByRole("button", { name: "Inbox", exact: true }).click();
    await waitFor(rowKeysIn, (keys) => keys.length === 3, "ENG-3 back");

    // ⌫ archives the project's row; Undo brings it back.
    await launch.focus();
    await page.keyboard.press("Backspace");
    await waitFor(rowKeysIn, (keys) => keys.length === 2, "Launch archived");
    assert.ok(note(I.notifications.launchUpdate).archivedAt);
    await inbox.locator(".linear-undo").getByRole("button", { name: "Undo" }).click();
    await waitFor(rowKeysIn, (keys) => keys.length === 3, "Launch back");
    assert.equal(note(I.notifications.launchUpdate).archivedAt, null);

    // ⌘K marks every row read; a project's row opens the project.
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Mark all Linear notifications read");
    await page.keyboard.press("Enter");
    await waitFor(badge, (n) => n === "", "nothing unread");
    assert.ok(linear.ws.notifications.filter((n) => !n.snoozedUntilAt).every((n) => n.readAt));
    await launch.click();
    await view.locator(".linear-list-head h2", { hasText: "Launch" }).waitFor();
  } finally {
    linear.restore();
    await context.close();
  }
});

test("the inbox's Mark all read works from ⌘K while an issue opened from it takes its place", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await page.setViewportSize({ width: 1000, height: 900 });
    await sidebar.getByRole("button", { name: /^Inbox/ }).click();
    const inbox = view.locator(".linear-inbox");
    await inbox.locator(".linear-inbox-row").nth(2).waitFor();
    // Narrow: the issue opens in the Inbox's place.
    await inbox.locator(".linear-inbox-row").first().click();
    await view.locator(".linear-issue h1", { hasText: "Ship the Linear tab" }).waitFor();
    assert.equal(await inbox.count(), 0);
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Mark all Linear notifications read");
    await page.keyboard.press("Enter");
    await waitFor(
      async () => linear.ws.notifications.filter((n) => !n.snoozedUntilAt).every((n) => n.readAt),
      (v) => v,
      "every notification read in Linear",
    );
  } finally {
    linear.restore();
    await context.close();
  }
});

test("a saved view shows as Linear has it even when the views come in after its issues", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: "Launch in flight" }).click();
    await view.locator(".linear-board").waitFor();
    // Reloaded with the views slow to come: the list shows first, then the board Linear has.
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/linear/q/views", async (route) => {
      await slow;
      await route.fallback();
    });
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "linear" } })));
    await view.locator(".linear-list .linear-row").first().waitFor();
    release();
    await view.locator(".linear-board").waitFor();
    await waitFor(() => groupNames(page), (names) => names.join() === "Owen Conti", "grouped by assignee");
  } finally {
    linear.restore();
    await context.close();
  }
});
