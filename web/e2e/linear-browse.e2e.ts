/**
 * Finding issues in the Linear tab (cycles, display options, views, search,
 * the inbox) and attaching files and links to them. The page's Linear
 * requests run the real server route over the fake Linear (`linearFake.ts`);
 * every other /api request is answered in the browser. Nothing reaches a
 * daemon or Linear.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { FAKE_IDS, fakeWorkspace } from "../server/linear/fake";
import { PNG, headOverlaps, launch, mockApi, newContext, startApp, waitFor, appEvent } from "./harness";
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
  await appEvent(page, "paseo:mode", { mode: "linear" });
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

/** A list's groups, or a board's columns (over its swimlanes, when it has them). */
const groupNames = (page: Page) =>
  page.locator(".linear-list .linear-group h3 span[id], .linear-list .linear-column-label").allInnerTexts();
const subNames = (page: Page) => page.locator(".linear-list .linear-subgroup").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
const laneNames = (page: Page) => page.locator(".linear-list .linear-lane-label").allInnerTexts();
const focusedKey = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key);

test("a list's display: grouping, ordering and finished issues, kept for the place; filters as chips", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 6, "ENG's issues");
    assert.deepEqual(await groupNames(page), ["In Progress", "In Review", "Todo", "Triage", "Done"]);

    // Grouped by assignee (you first), ordered by title, without what's finished.
    await view.getByRole("button", { name: "Display" }).click();
    const menu = view.getByRole("dialog", { name: "Display options" });
    await menu.getByLabel("Grouping", { exact: true }).selectOption("assignee");
    await menu.getByLabel("Ordering").selectOption("title");
    assert.deepEqual(await groupNames(page), ["Owen Conti", "Sam Rivera", "No assignee"]);
    assert.deepEqual(await rowKeys(page), ["ENG-5", "ENG-3", "ENG-1", "ENG-2", "ENG-6", "ENG-4"]);
    // A team's All keeps what finished in the past month: no "All" to promise more.
    const completed = menu.getByLabel("Completed issues");
    assert.deepEqual(await completed.locator("option").allInnerTexts(), ["Past month", "Past week", "None"]);
    await completed.selectOption("week");
    await waitFor(() => rowKeys(page), (keys) => !keys.includes("ENG-6") && keys.includes("ENG-5"), "only the past week's");
    await menu.getByLabel("Completed issues").selectOption("none");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-3,ENG-1,ENG-2,ENG-4", "nothing finished");
    assert.equal(await view.locator(".linear-list-head .linear-count").first().innerText(), "4");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });

    // Kept for the place across a reload; another place has its own.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await appEvent(page, "paseo:mode", { mode: "linear" });
    await waitFor(() => groupNames(page), (names) => names.join() === "Owen Conti,Sam Rivera,No assignee", "the display again");
    await sidebar.getByRole("button", { name: "Assigned" }).click();
    await waitFor(() => groupNames(page), (names) => names.join() === "In Progress,In Review", "Assigned's own display");
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    await waitFor(() => groupNames(page), (names) => names[0] === "Owen Conti", "ENG All's display");
    await view.getByRole("button", { name: "Display" }).click();
    await menu.getByRole("button", { name: "Reset to default" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 6, "the default display");
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
    await waitFor(() => rowKeys(page), (keys) => keys.length === 6, "no filters");
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
    await waitFor(() => rowKeys(page), (keys) => keys.length === 6, "ENG's issues");
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

test("sub-grouping: groups hold sub-groups in a list, swimlanes on a board; swapped, cleared, and drops take both", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 6, "ENG's issues");

    // Sub-grouped by assignee; ⇅ (only with a sub-grouping) swaps the two.
    await view.getByRole("button", { name: "Display" }).click();
    const menu = view.getByRole("dialog", { name: "Display options" });
    const swap = menu.getByRole("button", { name: "Swap grouping and sub-grouping" });
    await menu.waitFor();
    assert.equal(await swap.count(), 0);
    assert.deepEqual(await menu.getByLabel("Sub-grouping", { exact: true }).locator("option").allInnerTexts(), [
      "None",
      "Status",
      "Assignee",
      "Priority",
      "Project",
      "Cycle",
    ]);
    await menu.getByLabel("Sub-grouping", { exact: true }).selectOption("assignee");
    await waitFor(() => subNames(page), (names) => names.length === 6, "sub-groups");
    assert.deepEqual((await subNames(page)).slice(0, 2), ["In Progress · Owen Conti", "In Review · Owen Conti"]);
    await swap.click();
    assert.equal(await menu.getByLabel("Grouping", { exact: true }).inputValue(), "assignee");
    assert.equal(await menu.getByLabel("Sub-grouping", { exact: true }).inputValue(), "status");
    assert.deepEqual(await groupNames(page), ["Owen Conti", "Sam Rivera", "No assignee"]);
    assert.deepEqual(await subNames(page), [
      "Owen Conti · In Progress",
      "Owen Conti · In Review",
      "Owen Conti · Done",
      "Sam Rivera · Todo",
      "Sam Rivera · Done",
      "No assignee · Triage",
    ]);
    // Rows in display order (not the group's priority order).
    assert.deepEqual(await rowKeys(page), ["ENG-1", "ENG-3", "ENG-5", "ENG-2", "ENG-6", "ENG-4"]);
    // Sub-grouped by the grouping's own property: swapped back.
    await menu.getByLabel("Sub-grouping", { exact: true }).selectOption("assignee");
    assert.equal(await menu.getByLabel("Grouping", { exact: true }).inputValue(), "status");
    assert.equal(await menu.getByLabel("Sub-grouping", { exact: true }).inputValue(), "assignee");
    await swap.click();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });

    // J/K go through the rows as shown.
    await view.locator('.linear-row[data-key="ENG-1"]').focus();
    for (const key of ["ENG-3", "ENG-5", "ENG-2"]) {
      await page.keyboard.press("j");
      assert.equal(await focusedKey(page), key);
    }
    await page.keyboard.press("k");
    assert.equal(await focusedKey(page), "ENG-5");

    // Kept for the place across a reload.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await appEvent(page, "paseo:mode", { mode: "linear" });
    await waitFor(() => subNames(page), (names) => names[0] === "Owen Conti · In Progress", "the sub-groups again");

    // ⌘K swaps and clears.
    const palette = async (label: string) => {
      await page.keyboard.press("Meta+k");
      await page.keyboard.type(label);
      await page.getByRole("option", { name: label }).first().waitFor();
      await page.keyboard.press("Enter");
    };
    await palette("Swap the Linear list's grouping and sub-grouping");
    await waitFor(() => groupNames(page), (names) => names[0] === "In Progress", "grouped by status");
    await palette("Clear the Linear list's sub-grouping");
    await waitFor(() => subNames(page), (names) => names.length === 0, "no sub-groups");
    await palette("Sub-group the Linear list by assignee");
    await waitFor(() => subNames(page), (names) => names.length === 6, "sub-grouped by assignee");

    // A board: the team's states as columns, a swimlane for each assignee with issues.
    // (A board's issue opens in its place: none open.)
    await view.locator(".linear-close").click();
    await view.locator(".linear-issue").waitFor({ state: "detached" });
    await palette("Show the Linear issues as a board");
    await view.locator(".linear-board.has-lanes").waitFor();
    assert.deepEqual(await groupNames(page), ["In Progress", "In Review", "Todo", "Triage", "Backlog", "Done", "Canceled"]);
    assert.deepEqual(await laneNames(page), ["Owen Conti", "Sam Rivera", "No assignee"]);
    const cell = (lane: string, column: string) =>
      view.locator(`.linear-lane[data-lane="${lane}"] .linear-cell[data-group="state:${column}"]`);
    const sam = `user:${FAKE_IDS.sam}`;
    const owen = `user:${FAKE_IDS.owen}`;
    assert.equal(await cell(sam, "Todo").locator(".linear-card").count(), 1);
    // ←/→ stay in the lane.
    await cell(owen, "In Progress").locator('.linear-card[data-key="ENG-1"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await focusedKey(page), "ENG-3");
    await page.keyboard.press("ArrowRight");
    assert.equal(await focusedKey(page), "ENG-5");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await focusedKey(page), "ENG-1");

    // Dropped in Owen's In Progress: both its status and assignee, as one write.
    const writes = () => linear.requests.filter((r) => r.operation === "IssueUpdate").length;
    const before = writes();
    await cell(sam, "Todo").locator('.linear-card[data-key="ENG-2"]').dragTo(cell(owen, "In Progress"));
    await cell(owen, "In Progress").locator('.linear-card[data-key="ENG-2"]').waitFor();
    await waitFor(
      async () => {
        const eng2 = linear.ws.issues.find((i) => i.identifier === "ENG-2")!;
        return [eng2.state.id, eng2.assignee?.id];
      },
      ([state, assignee]) => state === FAKE_IDS.states.eng["In Progress"] && assignee === FAKE_IDS.owen,
      "the status and assignee in Linear",
    );
    assert.equal(writes(), before + 1);
    // Refused: it goes back where it was.
    linear.fail("IssueUpdate", { message: "Not allowed" });
    await cell(owen, "In Progress").locator('.linear-card[data-key="ENG-2"]').dragTo(cell("user:none", "Triage"));
    await page.locator(".toast", { hasText: "Not allowed" }).waitFor();
    await cell(owen, "In Progress").locator('.linear-card[data-key="ENG-2"]').waitFor();

    // A lane folds and unfolds.
    const samHead = view.locator(`.linear-lane[data-lane="${sam}"] .linear-lane-head button`);
    await samHead.click();
    assert.equal(await samHead.getAttribute("aria-expanded"), "false");
    assert.equal(await view.locator(`.linear-lane[data-lane="${sam}"] .linear-card`).count(), 0);
    await samHead.click();
    await view.locator(`.linear-lane[data-lane="${sam}"] .linear-card[data-key="ENG-6"]`).waitFor();
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
    // Issue views and project views; a project's own view (Launch bugs) is under its project.
    assert.deepEqual(await views.locator(".linear-nav-label").allInnerTexts(), [
      "Due soon",
      "Estimated work",
      "Launch in flight",
      "Sam's work",
      "Under way",
    ]);

    // Sam's work: a list without groups, nothing finished (as the view is set in Linear).
    await views.getByRole("button", { name: "Sam's work" }).click();
    await view.locator(".linear-list-head h2", { hasText: "Sam's work" }).waitFor();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 2, "Sam's open issues");
    assert.deepEqual((await rowKeys(page)).sort(), ["DE-1", "ENG-2"]);
    assert.match(await view.locator(".linear-view-about").innerText(), /Only you · by Owen Conti/);
    assert.ok(linear.requests.some((r) => r.operation === "ViewIssues"));

    // Launch in flight: a board by assignee, its swimlanes by priority.
    await views.getByRole("button", { name: "Launch in flight" }).click();
    await view.locator(".linear-board").waitFor();
    await waitFor(() => groupNames(page), (names) => names.join() === "Owen Conti", "a column for Owen");
    assert.deepEqual(await laneNames(page), ["Urgent", "High"]);
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
    await appEvent(page, "paseo:mode", { mode: "linear" });
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
    // Read now, never waiting for a badge that isn't there (none: nothing unread).
    const badge = () => inboxItem.locator(".linear-nav-badge").allInnerTexts().then((t) => t.join(""));
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
    // An app's notification shows its avatar, as Linear names it.
    const probe = launch.locator(".linear-person");
    assert.equal(await probe.getAttribute("aria-label"), "Probe");
    await waitFor(
      () => probe.locator("img").evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth),
      (w) => w === 1,
      "Probe's avatar",
    );
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
    await appEvent(page, "paseo:mode", { mode: "linear" });
    await view.locator(".linear-list .linear-row").first().waitFor();
    release();
    await view.locator(".linear-board").waitFor();
    await waitFor(() => groupNames(page), (names) => names.join() === "Owen Conti", "grouped by assignee");
  } finally {
    linear.restore();
    await context.close();
  }
});

test("attachments: links and uploaded files on an issue, files in a comment, removing one", async () => {
  const { context, page, linear, view } = await openLinear();
  try {
    // Thumbnails load through the image route: answered here, as nothing may reach the test server.
    await page.route("**/api/linear/image**", (route) => route.fulfill({ body: PNG, contentType: "image/png" }));
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    const issue = view.locator(".linear-issue");
    const section = issue.locator(".linear-attachments");
    const titles = () => section.locator(".linear-attachment-title").allInnerTexts();
    await waitFor(titles, (t) => t.join() === "Design doc", "the issue's attachment");
    assert.match(await section.locator(".linear-attachment-meta").first().innerText(), /Sam Rivera · 5d ago/);
    const eng1 = linear.ws.issues.find((i) => i.identifier === "ENG-1")!;

    // A link: Linear names a pull request itself.
    await section.getByRole("button", { name: "Add link" }).click();
    await section.getByRole("textbox", { name: "Link to attach" }).fill("https://github.com/o/r/pull/9");
    await section.getByRole("button", { name: "Attach" }).click();
    await waitFor(titles, (t) => t.length === 2, "the link attached");
    assert.equal(eng1.attachments.nodes.at(-1)?.sourceType, "github");

    // Files chosen: uploaded to Linear, then attached with their kind and size.
    await section.locator('input[type="file"]').setInputFiles([
      { name: "shot.png", mimeType: "image/png", buffer: PNG },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    ]);
    await waitFor(titles, (t) => t.includes("shot.png") && t.includes("notes.txt"), "both files attached");
    const shot = eng1.attachments.nodes.find((a) => a.title === "shot.png")!;
    assert.match(shot.url, /^https:\/\/uploads\.linear\.app\//);
    assert.deepEqual(linear.uploads.get(shot.url)?.bytes, PNG);
    assert.equal(eng1.attachments.nodes.find((a) => a.title === "notes.txt")?.subtitle, "TXT · 5 B");
    await section.locator(`img.linear-attachment-thumb[src*="${encodeURIComponent(shot.url)}"]`).waitFor();
    // An image opens in the lightbox.
    await section.getByRole("button", { name: "Open shot.png" }).click();
    await page.locator(".lightbox").waitFor();
    await page.keyboard.press("Escape");

    // Files dropped on the section upload too.
    await section.evaluate((el) => {
      const data = new DataTransfer();
      data.items.add(new File(["drop"], "dropped.txt", { type: "text/plain" }));
      el.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    await waitFor(titles, (t) => t.includes("dropped.txt"), "the dropped file attached");

    // Removed after confirming, in Linear too.
    const row = section.locator(".linear-attachment", { hasText: "notes.txt" });
    await row.hover();
    await row.getByRole("button", { name: "Remove notes.txt" }).click();
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await waitFor(titles, (t) => !t.includes("notes.txt"), "notes.txt removed");
    assert.ok(!eng1.attachments.nodes.some((a) => a.title === "notes.txt"));

    // A comment with a file: uploaded, then in the comment as a link that downloads through the app.
    // The comment composer, last in the issue.
    const composer = issue.locator(".linear-composer").last();
    await composer.locator('input[type="file"]').setInputFiles({ name: "log.txt", mimeType: "text/plain", buffer: Buffer.from("log") });
    const box = composer.getByRole("textbox");
    await waitFor(() => box.inputValue(), (v) => /\[log\.txt\]\(https:\/\/uploads\.linear\.app\/.+\/log\.txt\)/.test(v), "the file's Markdown");
    await box.focus();
    await page.keyboard.press("Meta+Enter");
    const sent = issue.locator(".linear-comment", { hasText: "log.txt" });
    await sent.waitFor();
    assert.match((await sent.locator("a", { hasText: "log.txt" }).getAttribute("href")) ?? "", /\/api\/linear\/file\?url=https%3A%2F%2Fuploads\.linear\.app/);
    assert.ok(linear.ws.comments.some((c) => c.body.includes("](https://uploads.linear.app/") && c.body.includes("log.txt")));
  } finally {
    linear.restore();
    await context.close();
  }
});

test("the edge between the list and the open issue resizes it, kept across a reload; double-click shares the room again", async () => {
  const { context, page, linear, view } = await openLinear();
  try {
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    const detail = view.locator(".linear-detail");
    await detail.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();
    const edge = view.getByRole("separator", { name: "Resize the open issue" });
    const before = (await detail.boundingBox())!.width;
    const box = (await edge.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + 200, { steps: 5 });
    await page.mouse.up();
    const wider = (await detail.boundingBox())!.width;
    assert.ok(Math.abs(wider - (before + 120)) <= 3, `${wider} is ${before} + 120`);

    // Kept.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await appEvent(page, "paseo:mode", { mode: "linear" });
    await detail.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();
    assert.ok(Math.abs((await detail.boundingBox())!.width - wider) <= 3);

    // The keys narrow it; double-click goes back to sharing the room.
    await edge.focus();
    await page.keyboard.press("ArrowRight");
    assert.ok(Math.abs((await detail.boundingBox())!.width - (wider - 16)) <= 3);
    await edge.dblclick();
    await waitFor(async () => (await detail.boundingBox())!.width, (w) => Math.abs(w - before) <= 3, "the shared width");
  } finally {
    linear.restore();
    await context.close();
  }
});

test("the list's head never overlaps: beside an open issue and at the narrowest, the title gives way and the tools go to icons", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "Active" }).click();
    const head = view.locator(".linear-list-head");
    const title = head.locator("h2");
    await title.getByText("Active").waitFor();
    const filter = head.getByRole("button", { name: "Filter" });
    const display = head.getByRole("button", { name: "Display" });
    const box = async (l: typeof head) => (await l.boundingBox())!;
    const apart = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
    const noOverlap = async (where: string) => {
      assert.deepEqual(await headOverlaps(head), [], `nothing in the head overlaps ${where}`);
      // The breadcrumb's parts as drawn (clipped by the title), the count, the tools.
      const parts = [
        ...(await title.locator(".page-crumb, .page-head-name").evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            const t = e.parentElement!.getBoundingClientRect();
            const right = Math.min(r.right, t.right);
            return { x: r.x, y: r.y, width: right - r.x, height: r.height };
          }),
        )),
        await box(filter),
        await box(display),
      ];
      const count = head.locator(".linear-count");
      if (await count.isVisible()) parts.push(await box(count));
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) assert.ok(apart(parts[i], parts[j]), `the title, count and tools apart ${where}`);
      const own = await box(head);
      for (const p of parts) assert.ok(p.x >= own.x - 0.5 && p.x + p.width <= own.x + own.width + 0.5, `inside the head ${where}`);
    };
    // Wide: the tools have their words, the title is whole with no hint.
    await noOverlap("when wide");
    assert.equal(await head.locator(".page-tool-label").first().isVisible(), true);
    assert.equal(await title.getAttribute("data-tip"), null);

    // Beside an open issue widened as far as it goes, the list keeps its least.
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await view.locator(".linear-detail h1", { hasText: "Ship the Linear tab" }).waitFor();
    await view.getByRole("separator", { name: "Resize the open issue" }).focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+ArrowLeft");
    await waitFor(() => box(head), (b) => b.width <= 340, "the list at its least beside the issue");
    await noOverlap("beside the open issue");
    // The tools are icons, still named and hinted.
    assert.equal(await filter.locator(".page-tool-label").evaluate((e) => e.getBoundingClientRect().width), 1);
    assert.equal(await filter.getAttribute("data-tip"), "Filter (F)");
    assert.equal(await display.getAttribute("data-tip"), "Display options");

    // The narrowest window, the issue closed: the list is what the sidebar leaves.
    await view.locator(".linear-close").click();
    await page.setViewportSize({ width: 760, height: 800 });
    await waitFor(() => box(head), (b) => b.width < 200, "the narrowest list");
    // The sidebar's width follows the view's a frame later: the head settles after.
    let last = "";
    await waitFor(
      async () => JSON.stringify([await box(head), await box(title)]),
      (now) => {
        const same = now === last;
        last = now;
        return same;
      },
      "the head to settle",
    );
    await noOverlap("at the narrowest");
    // The breadcrumb is cut short (its earlier part first) and says itself on hover.
    await waitFor(() => title.getAttribute("data-tip"), (tip) => tip === "Engineering › Active", "the whole title as a hint");
    const crumb = title.locator(".page-crumb");
    assert.ok(await crumb.evaluate((e) => e.scrollWidth > e.clientWidth), "the team's name is cut short");
  } finally {
    linear.restore();
    await context.close();
  }
});

test("people show their avatar where Linear has one, else their initials", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    const sam = view.locator('.linear-row[data-key="ENG-2"] .linear-person');
    const img = sam.locator("img");
    await waitFor(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth), (w) => w === 1, "Sam's avatar");
    assert.equal(await sam.getAttribute("aria-label"), "Sam Rivera");
    const owen = view.locator('.linear-row[data-key="ENG-1"] .linear-person');
    assert.equal(await owen.innerText(), "OC");
    assert.equal(await owen.locator("img").count(), 0);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("back and forward through the places and issues opened, not each step through a list", async () => {
  const { context, page, linear, view, sidebar } = await openLinear();
  try {
    const title = view.locator(".linear-list-head h2");
    const openTitle = () => view.locator(".linear-issue h1").allInnerTexts().then((t) => t.join(""));
    const back = sidebar.getByRole("button", { name: "Go back", exact: true });
    const forward = sidebar.getByRole("button", { name: "Go forward", exact: true });
    assert.equal(await back.isDisabled(), true);

    // Assigned, then ENG-1 opened, then ↓ to ENG-3 (moving through the list, not a new place).
    await waitFor(() => rowKeys(page), (keys) => keys.length === 2, "your issues");
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await view.locator(".linear-issue h1", { hasText: "Ship the Linear tab" }).waitFor();
    await view.locator('.linear-row[data-key="ENG-1"]').focus();
    await page.keyboard.press("ArrowDown");
    await view.locator(".linear-issue h1", { hasText: "Review the sync design" }).waitFor();
    // Then ENG's All, and a search typed there.
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    await title.filter({ hasText: "All issues" }).waitFor();
    await sidebar.getByRole("button", { name: "Search Linear" }).click();
    await page.keyboard.type("sync");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-3", "the search");

    // ⌘[: the search (once, not per letter), then ENG All, then Assigned with ENG-3 open.
    await page.keyboard.press("Meta+[");
    await title.filter({ hasText: "All issues" }).waitFor();
    await back.click();
    await title.filter({ hasText: "Assigned to you" }).waitFor();
    await waitFor(openTitle, (t) => t === "Review the sync design", "ENG-3 open again");
    await page.keyboard.press("Meta+[");
    await waitFor(() => view.locator(".linear-issue").count(), (n) => n === 0, "Assigned with nothing open");
    assert.equal(await back.isDisabled(), true);

    // Forward: ⌘], the sidebar's arrow, a mouse's forward button, ⌘K.
    await page.keyboard.press("Meta+]");
    await waitFor(openTitle, (t) => t === "Review the sync design", "forward to ENG-3");
    await forward.click();
    await title.filter({ hasText: "All issues" }).waitFor();
    await view.evaluate((el) => el.dispatchEvent(new MouseEvent("mouseup", { button: 4, bubbles: true })));
    await view.getByRole("searchbox", { name: "Search all issues in Linear" }).waitFor();
    assert.equal(await forward.isDisabled(), true);
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Go back (Linear)");
    await page.keyboard.press("Enter");
    await title.filter({ hasText: "All issues" }).waitFor();

    // Somewhere new drops what was ahead.
    await sidebar.getByRole("button", { name: "Projects" }).click();
    await title.filter({ hasText: "Projects" }).waitFor();
    assert.equal(await forward.isDisabled(), true);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("an issue opened from outside the tab stands alone, Back returning to the list; one linked inside opens beside it", async () => {
  const ws = fakeWorkspace();
  ws.issues.find((i) => i.identifier === "ENG-1")!.description = "Waits on [ENG-3](https://linear.app/fake/issue/ENG-3).";
  const { context, page, linear, view, sidebar } = await openLinear(ws);
  try {
    const title = view.locator(".linear-list-head h2");
    const openTitle = () => view.locator(".linear-issue h1").allInnerTexts().then((t) => t.join(""));
    const back = sidebar.getByRole("button", { name: "Go back", exact: true });
    const forward = sidebar.getByRole("button", { name: "Go forward", exact: true });
    const eng = sidebar.locator('.linear-team[data-team="ENG"]');
    const list = view.locator(".linear-list");
    // Engineering › Active, with ENG-1 open beside it.
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await eng.getByRole("button", { name: "Active" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.includes("ENG-1"), "ENG's active issues");
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await waitFor(openTitle, (t) => t === "Ship the Linear tab", "ENG-1 beside the list");

    // A link inside the tab (ENG-1's description) opens beside the list, as a row does.
    await view.locator(".linear-issue a", { hasText: "ENG-3" }).click();
    await waitFor(openTitle, (t) => t === "Review the sync design", "ENG-3 beside the list");
    assert.equal(await list.isVisible(), true);
    assert.equal(await eng.getByRole("button", { name: "Active" }).getAttribute("aria-current"), "page");
    await back.click();
    await waitFor(openTitle, (t) => t === "Ship the Linear tab", "back to ENG-1");

    // A link from outside (the app's paseo:link: the chat, Conquer, the header's chip): the issue alone, the sidebar marking nothing.
    const fromOutside = (url: string) =>
      appEvent(page, "paseo:link", { url });
    await fromOutside("https://linear.app/fake/issue/ENG-2");
    await waitFor(openTitle, (t) => t === "Draw the issue list", "ENG-2 from outside");
    assert.equal(await list.count(), 0, "no list beside it");
    assert.equal(await view.evaluate((v) => v.classList.contains("issue-only")), true);
    assert.equal(await sidebar.locator('[aria-current="page"]').count(), 0);
    await page.screenshot({ path: "/tmp/linear-focused.png" });

    // A reload comes back to it, and Back to the list it came from.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await appEvent(page, "paseo:mode", { mode: "linear" });
    await waitFor(openTitle, (t) => t === "Draw the issue list", "ENG-2 after the reload");
    assert.equal(await list.count(), 0);
    await back.click();
    await title.filter({ hasText: "Active" }).waitFor();
    await waitFor(openTitle, (t) => t === "Ship the Linear tab", "Active with ENG-1 open, as it was");
    assert.equal(await eng.getByRole("button", { name: "Active" }).getAttribute("aria-current"), "page");

    // Forward to it again; its keys work, and Esc goes back.
    await forward.click();
    await waitFor(openTitle, (t) => t === "Draw the issue list", "forward to ENG-2");
    await view.focus();
    await page.keyboard.press("s");
    await page.getByRole("listbox", { name: "Status" }).waitFor();
    await page.keyboard.press("Escape");
    await waitFor(() => page.getByRole("listbox", { name: "Status" }).count(), (n) => n === 0, "the picker to close");
    assert.equal(await openTitle(), "Draw the issue list", "Esc closes the picker first");
    await page.keyboard.press("Escape");
    await waitFor(openTitle, (t) => t === "Ship the Linear tab", "Esc returns to the list");
    await list.waitFor();

    // A Back button in the focused issue goes back too.
    await fromOutside("https://linear.app/fake/issue/ENG-3");
    await waitFor(openTitle, (t) => t === "Review the sync design", "ENG-3 from outside");
    await view.getByRole("button", { name: "Back", exact: true }).click();
    await waitFor(openTitle, (t) => t === "Ship the Linear tab", "Back returns to the list");
    assert.equal(await list.isVisible(), true);
  } finally {
    linear.restore();
    await context.close();
  }
});
