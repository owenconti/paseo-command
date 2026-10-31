/**
 * The Linear tab (the macOS app's mode bar shows it in the map's place):
 * Linear's navigation (my issues, teams, projects, initiatives), an issue's
 * details, and New agent launched from it. The page's Linear requests run the
 * real server route over the fake Linear (`linearFake.ts`); every other /api
 * request is answered in the browser. Nothing reaches a daemon or Linear.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Locator, Page } from "playwright";
import { FAKE_IDS, fakeWorkspace } from "../server/linear/fake";
import { PNG, launch, mockApi, newContext, startApp, waitFor } from "./harness";
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

/** The app's mode bar switches to Linear. */
const showLinear = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "linear" } })));

const rowKeys = (page: Page) =>
  page.locator(".linear-list .linear-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.key));

test("Linear navigates my issues, teams, projects and initiatives, shows an issue, and launches New agent from it", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const dispatched: any[] = [];
  await mockApi(page, {
    agents: () => [],
    projects: () => [{ projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" }],
    lists: {
      settings: { integrations: { linear: true } },
      presets: { presets: [{ name: "Plan it", prompt: "Plan {{issue}}." }], error: null },
    },
    accept: (path, body) => {
      if (path !== "/api/dispatch") return false;
      dispatched.push(body);
      return { agentId: "a-new" };
    },
  });
  const imageAsked: string[] = [];
  await page.route("**/api/linear/image**", (route) => {
    imageAsked.push(new URL(route.request().url()).searchParams.get("url")!);
    return route.fulfill({ body: PNG, contentType: "image/png" });
  });
  const linear = await mockLinear(page);
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showLinear(page);
    const view = page.locator(".linear-view");
    const sidebar = view.locator(".linear-sidebar");
    await sidebar.getByRole("button", { name: /^ENG/ }).waitFor();
    const nav = (await sidebar.textContent()) ?? "";
    for (const item of ["My issues", "Assigned", "Created", "Subscribed", "Teams", "ENG", "DE", "Projects", "Initiatives"])
      assert.ok(nav.includes(item), `the sidebar lists ${item}`);

    // Assigned to you, by default: started work first, nothing done.
    await waitFor(() => rowKeys(page), (keys) => keys.length === 2, "your assigned issues");
    assert.deepEqual(await view.locator(".linear-group h3").allInnerTexts(), ["In Progress\n1", "In Review\n1"]);
    assert.deepEqual(await rowKeys(page), ["ENG-1", "ENG-3"]);

    // An issue's details: its child, its comments (a reply under its thread) and an uploaded image.
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    const issue = view.locator(".linear-issue");
    await issue.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();
    await issue.locator(".linear-children .linear-row", { hasText: "ENG-2" }).waitFor();
    await waitFor(() => issue.locator(".linear-comment").count(), (n) => n === 3, "three comments");
    await issue.locator(".linear-comment.reply", { hasText: "Yes, list first." }).waitFor();
    await issue.locator(".linear-reaction", { hasText: "👍" }).waitFor();
    const facts = await issue.locator(".linear-facts").innerText();
    for (const fact of ["Owen", "Launch", "Beta", "Cycle 7"]) assert.ok(facts.includes(fact), `the facts name ${fact}`);
    await issue.locator(".linear-description img").waitFor();
    assert.ok(imageAsked.includes("https://uploads.linear.app/fake/shot.png"));
    // Its child opens from there; its parent leads back.
    await issue.locator(".linear-children .linear-row", { hasText: "ENG-2" }).click();
    await issue.locator("h1", { hasText: "Draw the issue list" }).waitFor();
    await issue.getByRole("button", { name: /Part of ENG-1/ }).click();
    await issue.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();

    // A team's views: Triage only where triage is on; Backlog shows only backlog issues.
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    const eng = sidebar.locator('.linear-team[data-team="ENG"]');
    await eng.getByRole("button", { name: "Triage" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-4", "ENG's triage");
    await eng.getByRole("button", { name: "Backlog" }).click();
    await view.locator(".linear-list .linear-note", { hasText: "No issues here" }).waitFor();
    assert.deepEqual(await rowKeys(page), []);
    await sidebar.getByRole("button", { name: /^DE/ }).click();
    const de = sidebar.locator('.linear-team[data-team="DE"]');
    assert.equal(await de.getByRole("button", { name: "Triage" }).count(), 0);
    await de.getByRole("button", { name: "Backlog" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "DE-2", "DE's backlog");
    assert.deepEqual(await view.locator(".linear-group h3").allInnerTexts(), ["Backlog\n1"]);

    // Projects, then one project's issues, those done lately last (ENG-6, done 20 days ago, isn't asked for).
    await sidebar.getByRole("button", { name: "Projects" }).click();
    const projects = view.locator(".linear-projects");
    const launchRow = projects.locator(".linear-project-row", { hasText: "Launch" });
    await launchRow.waitFor();
    const launchText = await launchRow.innerText();
    for (const part of ["Started", "40%", "Owen"]) assert.ok(launchText.includes(part), `the project row shows ${part}`);
    await launchRow.click();
    await view.locator(".linear-list-head h2", { hasText: "Launch" }).waitFor();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 4, "Launch's issues");
    assert.deepEqual(await rowKeys(page), ["ENG-1", "ENG-3", "ENG-2", "ENG-5"]);

    // The place survives a reload.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await showLinear(page);
    await view.locator(".linear-list-head h2", { hasText: "Launch" }).waitFor();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 4, "Launch's issues again");

    // Initiatives, with their projects, each opening that project.
    await sidebar.getByRole("button", { name: "Initiatives" }).click();
    const q4 = view.locator(".linear-initiative-row", { hasText: "Q4" });
    await q4.waitFor();
    await q4.getByRole("button", { name: "Launch" }).click();
    await view.locator(".linear-list-head h2", { hasText: "Launch" }).waitFor();

    // Launch agent: New agent in the panel, on the issue's branch, its first message the issue.
    await sidebar.getByRole("button", { name: "Assigned" }).click();
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await issue.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();
    await issue.getByRole("button", { name: "Launch agent" }).click();
    const form = page.locator(".new-agent");
    await form.locator(".new-agent-issue", { hasText: "ENG-1" }).waitFor();
    assert.equal(await form.locator("select[name=target]").inputValue(), "p:prj_atlas");
    assert.equal(await form.getByRole("radio", { name: "Worktree" }).getAttribute("aria-checked"), "true");
    assert.equal(
      await form.locator('input[aria-description^="The new branch"]').inputValue(),
      "eng-1-ship-the-linear-tab",
    );
    const composer = form.locator("#composer");
    await waitFor(() => composer.inputValue(), (v) => v.includes("Linear issue ENG-1: Ship the Linear tab"), "the issue prompt");
    assert.match(await composer.inputValue(), /The \*\*parent\*\* issue\./);
    // A preset takes the issue too.
    await form.getByRole("button", { name: "Plan it" }).click();
    await waitFor(() => Promise.resolve(dispatched.length), (n) => n === 1, "the dispatch");
    assert.equal(dispatched[0].projectId, "prj_atlas");
    assert.equal(dispatched[0].branch, "eng-1-ship-the-linear-tab");
    assert.match(
      dispatched[0].prompt,
      /^Plan ENG-1 \(Ship the Linear tab\)\.\n\nLinear issue ENG-1: Ship the Linear tab\nhttps:\/\/linear\.app\/fake\/issue\/ENG-1\n\nThe \*\*parent\*\* issue\./,
    );

    // The sidebar's edge resizes it; ⌘S hides and shows it, as in Conquer.
    const before = (await sidebar.boundingBox())!.width;
    const edge = (await view.locator(".linear-resize").boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 100);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 100, { steps: 4 });
    await page.mouse.up();
    assert.ok(Math.abs((await sidebar.boundingBox())!.width - (before + 80)) <= 2);
    await page.keyboard.press("Meta+s");
    await waitFor(() => sidebar.isVisible(), (v) => !v, "the sidebar to hide");
    await view.getByRole("button", { name: "Show the Linear sidebar", exact: true }).click();
    await waitFor(() => sidebar.isVisible(), (v) => v, "the sidebar to show");

    // Narrow, the open issue takes the list's place, with Back.
    await page.setViewportSize({ width: 900, height: 900 });
    await waitFor(() => view.locator(".linear-list").count(), (n) => n === 0, "the list to give way");
    await issue.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();
    await view.getByRole("button", { name: "Back", exact: true }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 2, "the list again");
    assert.equal(await issue.count(), 0);

    // Back to the map: the view goes.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "command" } })));
    await waitFor(() => view.count(), (n) => n === 0, "the Linear view to close");
    // Only reads reached the fake Linear.
    assert.ok(linear.requests.length > 0);
    assert.deepEqual(
      [...new Set(linear.requests.map((r) => r.operation))].filter((o) => !["Workspace", "Issues", "Issue", "Sync"].includes(o)),
      [],
    );
  } finally {
    linear.restore();
    await context.close();
  }
});

/** ENG's next cycle, which the edit tests add. */
const NEXT_CYCLE = "fa4e00ff-0000-4000-8000-000000000008";

/** The sample workspace with ENG-1 outside any project and ENG's next cycle planned, so every edit changes something. */
function editWorkspace() {
  const ws = fakeWorkspace();
  const eng1 = ws.issues.find((i) => i.identifier === "ENG-1")!;
  eng1.project = null;
  eng1.projectMilestone = null;
  const active = ws.cycles.find((c) => c.id === FAKE_IDS.cycles.eng)!;
  ws.cycles.push({ ...active, id: NEXT_CYCLE, number: 8, startsAt: active.endsAt, isActive: false, isNext: true });
  return ws;
}

/** The Linear view, wide enough that the open issue shows beside the list, with nothing but Linear mocked. */
async function openLinear(ws = fakeWorkspace()) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await mockApi(page, { agents: () => [], lists: { settings: { integrations: { linear: true } } } });
  const linear = await mockLinear(page, ws);
  await page.goto(app.url);
  await page.locator(".fleet-sidebar").waitFor();
  await showLinear(page);
  const view = page.locator(".linear-view");
  await view.locator(".linear-sidebar").getByRole("button", { name: /^ENG/ }).waitFor();
  return { context, page, linear, view, issue: view.locator(".linear-issue") };
}

/** A property's button in the open issue ("Status: In Progress"). */
const prop = (issue: Locator, label: string) => issue.getByRole("button", { name: new RegExp(`^${label}:`) });
const fakeIssue = (linear: Awaited<ReturnType<typeof mockLinear>>, key: string) =>
  linear.ws.issues.find((i) => i.identifier === key)!;
const focusedName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "");
const writesMade = (linear: Awaited<ReturnType<typeof mockLinear>>) =>
  linear.requests.map((r) => r.operation).filter((o) => !["Workspace", "Issues", "Issue", "Sync"].includes(o));

test("edits each property", async () => {
  const { context, page, linear, view, issue } = await openLinear(editWorkspace());
  try {
    const sidebar = view.locator(".linear-sidebar");
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "All" }).click();
    const row = view.locator('.linear-list .linear-row[data-key="ENG-1"]');
    await row.click();
    await issue.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();
    const eng1 = () => fakeIssue(linear, "ENG-1");
    const inLinear = (what: string, ok: () => boolean) => waitFor(() => Promise.resolve(ok()), Boolean, what);
    const picker = (label: string) => page.getByRole("listbox", { name: label });

    // Status, from the keyboard: the button opens the picker, typing filters, Enter picks, focus comes back.
    await prop(issue, "Status").focus();
    await page.keyboard.press("Enter");
    await picker("Status").waitFor();
    await page.keyboard.type("rev");
    assert.deepEqual(await picker("Status").getByRole("option").allInnerTexts(), ["In Review"]);
    await page.keyboard.press("Enter");
    await issue.getByRole("button", { name: "Status: In Review" }).waitFor();
    await view.getByRole("group", { name: "In Review" }).locator('.linear-row[data-key="ENG-1"]').waitFor();
    await inLinear("the status in Linear", () => eng1().state.id === FAKE_IDS.states.eng["In Review"]);
    assert.equal(await picker("Status").count(), 0);
    assert.equal(await focusedName(page), "Status: In Review");

    // Priority, by clicking; ↓ and Esc close without changing anything, focus back on the button.
    await prop(issue, "Priority").click();
    await picker("Priority").getByRole("option", { name: "Urgent" }).click();
    await issue.getByRole("button", { name: "Priority: Urgent" }).waitFor();
    await row.locator('.linear-priority[aria-label="Urgent"]').waitFor();
    await inLinear("the priority in Linear", () => eng1().priority === 1);
    await prop(issue, "Priority").focus();
    await page.keyboard.press("Enter");
    await picker("Priority").waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    assert.equal(await picker("Priority").count(), 0);
    assert.equal(await focusedName(page), "Priority: Urgent");
    assert.equal(await issue.getByRole("button", { name: "Priority: Urgent" }).count(), 1);

    await prop(issue, "Assignee").click();
    await picker("Assignee").getByRole("option", { name: /^Sam Rivera/ }).click();
    await issue.getByRole("button", { name: "Assignee: Sam Rivera" }).waitFor();
    await row.locator('.linear-row-person [aria-label="Sam Rivera"]').waitFor();
    await inLinear("the assignee in Linear", () => eng1().assignee?.id === FAKE_IDS.sam);

    // Labels toggle and the picker stays open; Esc closes it.
    await prop(issue, "Labels").click();
    await picker("Labels").getByRole("option", { name: "Bug" }).click();
    await waitFor(
      () => picker("Labels").locator('[role=option][aria-selected="true"]').allInnerTexts(),
      (names) => names.join() === "Bug,Feature",
      "both labels chosen",
    );
    await page.keyboard.press("Escape");
    assert.equal(await picker("Labels").count(), 0);
    await waitFor(() => row.locator(".linear-row-labels").getAttribute("aria-label"), (v) => !!v?.includes("Bug") && v.includes("Feature"), "the row's labels");
    await issue.getByRole("button", { name: /^Labels: (Feature, Bug|Bug, Feature)$/ }).waitFor();
    await inLinear("the labels in Linear", () =>
      eng1().labels.nodes.map((l) => l.id).sort().join() === [FAKE_IDS.labels.bug, FAKE_IDS.labels.feature].sort().join(),
    );

    // The team's estimate scale (fibonacci).
    await prop(issue, "Estimate").click();
    assert.deepEqual(await picker("Estimate").getByRole("option").allInnerTexts(), [
      "No estimate",
      "0 points",
      "1 point",
      "2 points",
      "3 points",
      "5 points",
      "8 points",
    ]);
    await picker("Estimate").getByRole("option", { name: "3 points" }).click();
    await issue.getByRole("button", { name: "Estimate: 3 points" }).waitFor();
    await inLinear("the estimate in Linear", () => eng1().estimate === 3);

    // The team's active and next cycles.
    await prop(issue, "Cycle").click();
    await picker("Cycle").getByRole("option", { name: /^Cycle 8/ }).click();
    await issue.getByRole("button", { name: "Cycle: Cycle 8" }).waitFor();
    await inLinear("the cycle in Linear", () => eng1().cycle?.id === NEXT_CYCLE);

    // Without a project there's no milestone to choose; with one, its milestones.
    assert.equal(await prop(issue, "Milestone").count(), 0);
    await prop(issue, "Project").click();
    await picker("Project").getByRole("option", { name: "Launch" }).click();
    await issue.getByRole("button", { name: "Project: Launch" }).waitFor();
    await row.locator(".linear-row-project", { hasText: "Launch" }).waitFor();
    await inLinear("the project in Linear", () => eng1().project?.id === FAKE_IDS.projects.launch);
    await prop(issue, "Milestone").click();
    assert.deepEqual(await picker("Milestone").getByRole("option").allInnerTexts(), ["No milestone", "Beta", "GA"]);
    await picker("Milestone").getByRole("option", { name: "Beta" }).click();
    await issue.getByRole("button", { name: "Milestone: Beta" }).waitFor();
    await inLinear("the milestone in Linear", () => eng1().projectMilestone?.id === FAKE_IDS.milestones.beta);

    const due = issue.getByLabel("Due date", { exact: true });
    await due.fill("2026-11-15");
    await due.press("Enter");
    await inLinear("the due date in Linear", () => eng1().dueDate === "2026-11-15");
    assert.equal(await due.inputValue(), "2026-11-15");

    // The parent, found by typing; its own sub-issue isn't offered.
    await prop(issue, "Parent").click();
    await page.keyboard.type("ENG-");
    const offered = await picker("Parent").getByRole("option").allInnerTexts();
    assert.ok(!offered.some((o) => o.startsWith("ENG-1 ") || o.startsWith("ENG-2 ")), `offered ${offered}`);
    await page.keyboard.type("3");
    await page.keyboard.press("Enter");
    await issue.getByRole("button", { name: /Part of ENG-3/ }).waitFor();
    await inLinear("the parent in Linear", () => eng1().parent?.id === FAKE_IDS.issues["ENG-3"]);

    assert.ok(writesMade(linear).length >= 10);
    assert.deepEqual([...new Set(writesMade(linear))], ["IssueUpdate"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("rolls back a refused edit", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    linear.fail("IssueUpdate", { message: "Not allowed" });
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await issue.getByRole("button", { name: "Priority: High" }).waitFor();
    await prop(issue, "Priority").click();
    await page.getByRole("listbox", { name: "Priority" }).getByRole("option", { name: "Urgent" }).click();
    await page.locator(".toast", { hasText: "Linear didn't save that: Not allowed" }).waitFor();
    await issue.getByRole("button", { name: "Priority: High" }).waitFor();
    await view.locator('.linear-list .linear-row[data-key="ENG-1"] .linear-priority[aria-label="High"]').waitFor();
    assert.equal(fakeIssue(linear, "ENG-1").priority, 2);
    assert.deepEqual(writesMade(linear), ["IssueUpdate"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("moves an issue out of Assigned when assigned to someone else", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-3", "your assigned issues");
    const menu = page.getByRole("menu", { name: "Edit ENG-3" });
    // A row's context menu; Esc closes it and the row has the focus again.
    await view.locator('.linear-row[data-key="ENG-3"]').click({ button: "right" });
    await menu.waitFor();
    assert.deepEqual(await menu.getByRole("menuitem").allInnerTexts(), ["Status", "Priority", "Assignee", "Labels"]);
    await page.keyboard.press("Escape");
    assert.equal(await menu.count(), 0);
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key), "ENG-3");

    // From the menu, the assignee: ENG-1 is no longer yours, so it leaves the list.
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await issue.getByRole("button", { name: "Assignee: Owen Conti" }).waitFor();
    await view.locator('.linear-row[data-key="ENG-1"]').click({ button: "right" });
    await page.getByRole("menu", { name: "Edit ENG-1" }).getByRole("menuitem", { name: "Assignee" }).click();
    await page.getByRole("listbox", { name: "Assignee" }).getByRole("option", { name: /^Sam Rivera/ }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-3", "ENG-1 to leave Assigned");
    await issue.getByRole("button", { name: "Assignee: Sam Rivera" }).waitFor();
    await waitFor(() => Promise.resolve(fakeIssue(linear, "ENG-1").assignee?.id), (id) => id === FAKE_IDS.sam, "Sam in Linear");

    // ⌘K edits the open issue too: its status picker opens with the keyboard in it.
    await page.keyboard.press("Meta+k");
    await page.getByLabel("Search commands").fill("issue's status");
    await page.keyboard.press("Enter");
    await page.getByRole("listbox", { name: "Status" }).waitFor();
    await page.keyboard.type("todo");
    await page.keyboard.press("Enter");
    await issue.getByRole("button", { name: "Status: Todo" }).waitFor();
    await waitFor(
      () => Promise.resolve(fakeIssue(linear, "ENG-1").state.id),
      (id) => id === FAKE_IDS.states.eng.Todo,
      "Todo in Linear",
    );
  } finally {
    linear.restore();
    await context.close();
  }
});

/** The open issue's comment that says `text` (its own block, not its replies'). */
const commentSaying = (issue: Locator, text: string) =>
  issue.locator(".linear-comment").filter({ has: issue.page().locator(".linear-comment-body", { hasText: text }) });

test("writes, edits, replies to, reacts to, resolves and deletes a comment", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    const inLinear = (what: string, ok: () => boolean) => waitFor(() => Promise.resolve(ok()), Boolean, what);
    const stored = (body: string) => linear.ws.comments.find((c) => c.body === body);
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await waitFor(() => issue.locator(".linear-comment").count(), (n) => n === 3, "three comments");

    // Write one: ⌘↩ sends, the composer empties, and it's yours in Linear.
    const composer = issue.getByRole("textbox", { name: "Write a comment" });
    await composer.fill("Starting on the **list** now.");
    await composer.press("Meta+Enter");
    const mine = commentSaying(issue, "Starting on the list now.");
    await mine.locator(".linear-comment-body strong", { hasText: "list" }).waitFor();
    await inLinear("the comment in Linear", () => !!stored("Starting on the **list** now."));
    const created = stored("Starting on the **list** now.")!;
    assert.equal(created.user?.id, linear.ws.viewerId);
    assert.equal(created.parent, null);
    assert.equal(await composer.inputValue(), "");

    // Edit it: marked edited.
    const edited = issue.locator(`[data-comment="${created.id}"]`);
    await edited.getByRole("button", { name: "Edit" }).click();
    const editor = edited.getByRole("textbox", { name: "Edit comment" });
    await editor.fill("Starting on the list today.");
    await editor.press("Meta+Enter");
    await edited.locator(".linear-comment-body", { hasText: "Starting on the list today." }).waitFor();
    await edited.locator(".linear-comment-head", { hasText: "edited" }).waitFor();
    await inLinear("the edit in Linear", () => created.body === "Starting on the list today." && !!created.editedAt);
    // Someone else's comment can't be edited or deleted.
    const sams = commentSaying(issue, "Can we start with the list?");
    assert.equal(await sams.getByRole("button", { name: "Edit" }).count(), 0);
    assert.equal(await sams.getByRole("button", { name: "Delete" }).count(), 0);

    // Reply to Sam's thread: indented under it.
    await sams.getByRole("button", { name: "Reply" }).click();
    const reply = issue.getByRole("textbox", { name: "Reply to Sam Rivera" });
    await reply.fill("And the detail after.");
    await reply.press("Meta+Enter");
    await issue.locator(".linear-comment.reply", { hasText: "And the detail after." }).waitFor();
    await inLinear("the reply in Linear", () => stored("And the detail after.")?.parent?.id === FAKE_IDS.comments.first);

    // React: 👍 beside Sam's adds yours, again takes it away; the picker adds another.
    const beta = commentSaying(issue, "Beta is on track.");
    const thumbs = beta.getByRole("button", { name: /^👍/ });
    assert.equal(await thumbs.getAttribute("aria-pressed"), "false");
    await thumbs.click();
    await waitFor(() => thumbs.innerText(), (t) => t.includes("2"), "two 👍");
    await waitFor(() => thumbs.getAttribute("aria-pressed"), (v) => v === "true", "your 👍");
    const reacted = linear.ws.comments.find((c) => c.id === FAKE_IDS.comments.reacted)!;
    await inLinear("your 👍 in Linear", () => reacted.reactions.some((r) => r.emoji === "+1" && r.user.id === linear.ws.viewerId));
    await thumbs.click();
    await waitFor(() => thumbs.innerText(), (t) => t.includes("1"), "one 👍");
    await inLinear("your 👍 gone from Linear", () => reacted.reactions.length === 1 && reacted.reactions[0].user.id === FAKE_IDS.sam);
    await beta.getByRole("button", { name: "Add a reaction" }).click();
    await page.getByRole("menu", { name: "Reactions" }).getByRole("menuitem", { name: "🎉" }).click();
    await beta.getByRole("button", { name: /^🎉/ }).waitFor();
    await inLinear("your 🎉 in Linear", () => reacted.reactions.some((r) => r.emoji === "tada"));

    // Resolve Sam's thread: one line with Unresolve, its replies hidden; Unresolve opens it again.
    const thread = issue.locator(".linear-thread").filter({ has: page.locator(".linear-comment-body", { hasText: "Can we start with the list?" }) });
    await thread.getByRole("button", { name: "Resolve" }).click();
    const folded = issue.locator(".linear-thread.resolved");
    await folded.getByRole("button", { name: "Unresolve" }).waitFor();
    assert.equal(await folded.locator(".linear-comment").count(), 0);
    assert.equal(await issue.locator(".linear-comment", { hasText: "Yes, list first." }).count(), 0);
    const first = linear.ws.comments.find((c) => c.id === FAKE_IDS.comments.first)!;
    await inLinear("resolved in Linear", () => !!first.resolvedAt);
    await folded.getByRole("button", { name: "Unresolve" }).click();
    await issue.locator(".linear-comment.reply", { hasText: "Yes, list first." }).waitFor();
    await inLinear("open in Linear", () => first.resolvedAt === null);

    // Delete yours, after the inline question: Keep keeps it, Delete deletes it.
    await edited.getByRole("button", { name: "Delete" }).click();
    await edited.getByText("Delete this comment?").waitFor();
    await edited.getByRole("button", { name: "Keep" }).click();
    assert.equal(await edited.getByText("Delete this comment?").count(), 0);
    await edited.getByRole("button", { name: "Delete" }).click();
    await edited.getByRole("button", { name: "Delete", exact: true }).last().click();
    await waitFor(() => edited.count(), (n) => n === 0, "the comment to go");
    await inLinear("deleted in Linear", () => !linear.ws.comments.some((c) => c.id === created.id));

    // Each kind of comment and reaction write was sent, and nothing else was written.
    assert.deepEqual([...new Set(writesMade(linear))].sort(), [
      "CommentCreate",
      "CommentDelete",
      "CommentResolve",
      "CommentUnresolve",
      "CommentUpdate",
      "ReactionCreate",
      "ReactionDelete",
    ]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("keeps a comment draft across remounts", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    const eng1 = FAKE_IDS.issues["ENG-1"];
    const draft = () => page.evaluate((key) => localStorage.getItem(key), `paseo-command:linear:draft:${eng1}`);
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    const composer = issue.getByRole("textbox", { name: "Write a comment" });
    await composer.fill("Half a thought");

    // Back to the map and to Linear again: still there.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "command" } })));
    await waitFor(() => view.count(), (n) => n === 0, "the Linear view to close");
    await showLinear(page);
    await waitFor(() => composer.inputValue(), (v) => v === "Half a thought", "the draft after a remount");

    // And after a reload.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await showLinear(page);
    await waitFor(() => composer.inputValue(), (v) => v === "Half a thought", "the draft after a reload");

    // A refused send keeps the text and says why.
    linear.fail("CommentCreate", { message: "Not allowed" });
    await composer.press("Meta+Enter");
    await page.locator(".toast", { hasText: "Linear didn't save that: Not allowed" }).waitFor();
    assert.equal(await composer.inputValue(), "Half a thought");
    assert.equal(await draft(), JSON.stringify("Half a thought"));

    // Sent: the draft is gone.
    linear.clear("CommentCreate");
    await composer.press("Meta+Enter");
    await commentSaying(issue, "Half a thought").waitFor();
    assert.equal(await composer.inputValue(), "");
    await waitFor(draft, (v) => v === null, "the draft to be removed");

    // ⌘K's "Comment on ENG-1" puts the keyboard in the composer.
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("Meta+k");
    await page.getByLabel("Search commands").fill("Comment on ENG-1");
    await page.keyboard.press("Enter");
    await waitFor(() => focusedName(page), (name) => name === "Write a comment", "the composer focused");
  } finally {
    linear.restore();
    await context.close();
  }
});

/** The Create issue dialog. */
const createDialog = (page: Page) => page.getByRole("dialog", { name: "New issue" });
/** A ⌘K command, by its label. */
async function paletteRun(page: Page, label: string) {
  await page.keyboard.press("Meta+k");
  await page.getByLabel("Search commands").fill(label);
  await page.getByRole("option", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().waitFor();
  await page.keyboard.press("Enter");
}

test("creates an issue in the place's team and opens it", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    const sidebar = view.locator(".linear-sidebar");
    await sidebar.getByRole("button", { name: /^DE/ }).click();
    await sidebar.locator('.linear-team[data-team="DE"]').getByRole("button", { name: "All" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 2, "DE's issues");

    // The sidebar's New issue: in the place's team, with its default status (DE's is Backlog).
    await sidebar.getByRole("button", { name: "New issue" }).click();
    const dialog = createDialog(page);
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Team: Design Engineering" }).waitFor();
    await dialog.getByRole("button", { name: "Status: Backlog" }).waitFor();
    const title = dialog.getByRole("textbox", { name: "Issue title" });
    assert.equal(await focusedName(page), "Issue title");
    await title.fill("Draw the empty states");
    await dialog.getByRole("textbox", { name: "Description" }).fill("For **every** list.");

    // A draft survives closing (Esc) and opening again, here from ⌘K.
    await page.keyboard.press("Escape");
    await waitFor(() => dialog.count(), (n) => n === 0, "the dialog to close");
    await paletteRun(page, "Create Linear issue");
    await dialog.waitFor();
    assert.equal(await title.inputValue(), "Draw the empty states");
    assert.equal(await dialog.getByRole("textbox", { name: "Description" }).inputValue(), "For **every** list.");

    // Its properties, with the pickers.
    await dialog.getByRole("button", { name: /^Priority:/ }).click();
    await page.getByRole("listbox", { name: "Priority" }).getByRole("option", { name: "High" }).click();
    await dialog.getByRole("button", { name: "Priority: High" }).waitFor();
    await dialog.getByRole("button", { name: /^Assignee:/ }).click();
    await page.getByRole("listbox", { name: "Assignee" }).getByRole("option", { name: /^Sam Rivera/ }).click();
    await dialog.getByRole("button", { name: "Assignee: Sam Rivera" }).waitFor();
    await dialog.getByRole("button", { name: /^Labels:/ }).click();
    await page.getByRole("listbox", { name: "Labels" }).getByRole("option", { name: "Bug" }).click();
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "Labels: Bug" }).waitFor();
    assert.equal(await dialog.count(), 1, "Esc in a picker leaves the dialog open");

    // Refused: everything typed stays, and the dialog says why.
    linear.fail("IssueCreate", { message: "Not allowed" });
    await title.press("Meta+Enter");
    await dialog.getByText("Linear didn't save that: Not allowed").waitFor();
    assert.equal(await title.inputValue(), "Draw the empty states");
    assert.equal(linear.ws.issues.length, 8);

    // Created: it opens, and it's in the list.
    linear.clear("IssueCreate");
    await dialog.getByRole("button", { name: "Create issue" }).click();
    await waitFor(() => dialog.count(), (n) => n === 0, "the dialog to close");
    await issue.locator("h1", { hasText: "Draw the empty states" }).waitFor();
    await issue.locator(".linear-key", { hasText: "DE-3" }).waitFor();
    await view.locator('.linear-list .linear-row[data-key="DE-3"]').waitFor();
    const made = fakeIssue(linear, "DE-3");
    assert.equal(made.team.id, FAKE_IDS.de);
    assert.equal(made.state.id, FAKE_IDS.states.de.Backlog);
    assert.equal(made.description, "For **every** list.");
    assert.equal(made.priority, 2);
    assert.equal(made.assignee?.id, FAKE_IDS.sam);
    assert.deepEqual(made.labels.nodes.map((l) => l.id), [FAKE_IDS.labels.bug]);
    assert.equal(await page.evaluate(() => localStorage.getItem("paseo-command:linear:draft:new")), null);

    // Create more: the dialog stays, emptied of title and description, its choices kept.
    await sidebar.getByRole("button", { name: "New issue" }).click();
    await dialog.waitFor();
    assert.equal(await title.inputValue(), "");
    await dialog.getByRole("checkbox", { name: "Create more" }).check();
    await title.fill("One more");
    await title.press("Meta+Enter");
    await dialog.getByText("Created DE-4").waitFor();
    assert.equal(await title.inputValue(), "");
    await title.fill("And another");
    await title.press("Meta+Enter");
    await dialog.getByText("Created DE-5").waitFor();
    await page.keyboard.press("Escape");
    await waitFor(() => dialog.count(), (n) => n === 0, "the dialog to close");
    assert.deepEqual(writesMade(linear), ["IssueCreate", "IssueCreate", "IssueCreate", "IssueCreate"]);
    assert.ok(linear.ws.issues.every((i) => i.team.id === FAKE_IDS.de || !i.identifier.startsWith("DE")));
  } finally {
    linear.restore();
    await context.close();
  }
});

test("creates a sub-issue", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await issue.locator(".linear-children .linear-row", { hasText: "ENG-2" }).waitFor();
    await issue.getByRole("button", { name: "Add sub-issue" }).click();
    const dialog = createDialog(page);
    await dialog.getByText("Sub-issue of ENG-1").waitFor();
    await dialog.getByRole("button", { name: "Team: Engineering" }).waitFor();
    // ENG's own default status shows, and Linear applies it: no status is sent.
    await dialog.getByRole("button", { name: "Status: Todo" }).waitFor();
    await dialog.getByRole("textbox", { name: "Issue title" }).fill("Draw the board");
    await dialog.getByRole("textbox", { name: "Issue title" }).press("Meta+Enter");
    await issue.locator("h1", { hasText: "Draw the board" }).waitFor();
    await issue.getByRole("button", { name: /Part of ENG-1/ }).waitFor();
    await issue.getByRole("button", { name: "Status: Todo" }).waitFor();
    assert.equal(fakeIssue(linear, "ENG-7").parent?.id, FAKE_IDS.issues["ENG-1"]);
    assert.equal(fakeIssue(linear, "ENG-7").state.id, FAKE_IDS.states.eng.Todo);
    const sent = linear.requests.find((r) => r.operation === "IssueCreate")!.variables.input as Record<string, unknown>;
    assert.equal(sent.stateId, undefined);
    await issue.getByRole("button", { name: /Part of ENG-1/ }).click();
    await issue.locator(".linear-children .linear-row", { hasText: "ENG-7" }).waitFor();

    // ⌘K adds one to the open issue too.
    await paletteRun(page, "Add sub-issue to ENG-1");
    await dialog.getByText("Sub-issue of ENG-1").waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(writesMade(linear), ["IssueCreate"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("adds and removes a blocking relation", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    // Issues are related from those the page knows: DE's are, once its list has shown.
    const sidebar = view.locator(".linear-sidebar");
    await sidebar.getByRole("button", { name: /^DE/ }).click();
    await sidebar.locator('.linear-team[data-team="DE"]').getByRole("button", { name: "All" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.includes("DE-1"), "DE's issues");
    await sidebar.getByRole("button", { name: "Assigned" }).click();
    await view.locator('.linear-row[data-key="ENG-1"]').click();
    await issue.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();
    const relations = issue.locator(".linear-relations");
    await relations.getByRole("button", { name: "Add relation" }).click();
    await page.getByRole("listbox", { name: "Relation" }).getByRole("option", { name: "Blocks" }).click();
    await page.getByRole("listbox", { name: "Related issue" }).waitFor();
    await page.keyboard.type("docs theme");
    await page.keyboard.press("Enter");
    const blocks = relations.locator(".linear-relation-group", { hasText: "Blocks" });
    await blocks.locator(".linear-row", { hasText: "DE-1" }).waitFor();
    const eng1 = () => fakeIssue(linear, "ENG-1");
    const de1 = () => fakeIssue(linear, "DE-1");
    assert.deepEqual(eng1().relations.nodes.map((r) => [r.type, r.relatedIssue.id]), [["blocks", FAKE_IDS.issues["DE-1"]]]);

    // From the other side, DE-1 is blocked by ENG-1; it's removed there.
    await blocks.locator(".linear-row", { hasText: "DE-1" }).click();
    await issue.locator("h1", { hasText: "Refresh the docs theme" }).waitFor();
    const blockedBy = relations.locator(".linear-relation-group", { hasText: "Blocked by" });
    await blockedBy.locator(".linear-row", { hasText: "ENG-1" }).waitFor();
    await blockedBy.getByRole("button", { name: "Remove the relation to ENG-1" }).click();
    await waitFor(() => blockedBy.count(), (n) => n === 0, "the relation to go");
    assert.equal(de1().inverseRelations.nodes.length, 0);
    assert.equal(eng1().relations.nodes.length, 0);

    // And ENG-1 shows it gone too.
    await view.locator('.linear-list .linear-row[data-key="ENG-1"]').click();
    await issue.locator("h1", { hasText: "Ship the Linear tab" }).waitFor();
    await relations.getByRole("button", { name: "Add relation" }).waitFor();
    assert.equal(await relations.locator(".linear-relation-group", { hasText: "Blocks" }).count(), 0);
    assert.deepEqual(writesMade(linear), ["IssueRelationCreate", "IssueRelationDelete"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("subscribes and unsubscribes", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    const subscribed = () => fakeIssue(linear, "ENG-3").subscribers.nodes.some((u) => u.id === FAKE_IDS.owen);
    await view.locator('.linear-row[data-key="ENG-3"]').click();
    await issue.locator("h1", { hasText: "Review the sync design" }).waitFor();
    const detail = view.locator(".linear-detail");
    await detail.getByRole("button", { name: "Subscribe", exact: true }).click();
    await detail.getByRole("button", { name: "Unsubscribe", exact: true }).waitFor();
    await waitFor(() => Promise.resolve(subscribed()), Boolean, "subscribed in Linear");
    // It's in Subscribed now.
    await view.locator(".linear-sidebar").getByRole("button", { name: "Subscribed" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.includes("ENG-3"), "ENG-3 in Subscribed");
    await view.locator('.linear-row[data-key="ENG-3"]').click();

    await detail.getByRole("button", { name: "Unsubscribe", exact: true }).click();
    await detail.getByRole("button", { name: "Subscribe", exact: true }).waitFor();
    await waitFor(() => Promise.resolve(subscribed()), (v) => !v, "unsubscribed in Linear");
    await waitFor(() => rowKeys(page), (keys) => !keys.includes("ENG-3"), "ENG-3 out of Subscribed");

    // Copy its branch name and link, from ⌘K.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await paletteRun(page, "Copy ENG-3's branch name");
    await page.locator(".toast", { hasText: "Copied ENG-3's branch name" }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), fakeIssue(linear, "ENG-3").branchName);
    await paletteRun(page, "Copy ENG-3's link");
    await page.locator(".toast", { hasText: "Copied ENG-3's link" }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "https://linear.app/fake/issue/ENG-3");
    assert.deepEqual(writesMade(linear), ["IssueSubscribe", "IssueUnsubscribe"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("archives, and undoes it", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    await view.locator('.linear-row[data-key="ENG-3"]').click();
    await issue.locator("h1", { hasText: "Review the sync design" }).waitFor();
    // Refused: the issue stays open and listed, and the notice says why.
    linear.fail("IssueArchive", { message: "Not allowed" });
    await view.locator(".linear-detail").getByRole("button", { name: "Archive", exact: true }).click();
    await page.locator(".toast", { hasText: "Linear didn't save that: Not allowed" }).waitFor();
    await issue.locator("h1", { hasText: "Review the sync design" }).waitFor();
    assert.deepEqual(await rowKeys(page), ["ENG-1", "ENG-3"]);
    assert.equal(await view.locator(".linear-undo").count(), 0);
    linear.clear("IssueArchive");

    await view.locator(".linear-detail").getByRole("button", { name: "Archive", exact: true }).click();
    const bar = view.locator(".linear-undo");
    await bar.getByText("ENG-3 archived").waitFor();
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1", "ENG-3 to leave the list");
    assert.equal(await issue.count(), 0);
    await waitFor(() => Promise.resolve(fakeIssue(linear, "ENG-3").archivedAt), Boolean, "archived in Linear");

    await bar.getByRole("button", { name: "Undo" }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-3", "ENG-3 back");
    await waitFor(() => Promise.resolve(fakeIssue(linear, "ENG-3").archivedAt), (v) => v === null, "unarchived in Linear");
    assert.equal(await bar.count(), 0);

    // From ⌘K too.
    await view.locator('.linear-row[data-key="ENG-3"]').click();
    await issue.locator("h1", { hasText: "Review the sync design" }).waitFor();
    await paletteRun(page, "Archive ENG-3");
    await bar.getByText("ENG-3 archived").waitFor();
    assert.deepEqual(writesMade(linear), ["IssueArchive", "IssueArchive", "IssueUnarchive", "IssueArchive"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("deletes only after confirming", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    await view.locator('.linear-row[data-key="ENG-3"]').click();
    await issue.locator("h1", { hasText: "Review the sync design" }).waitFor();
    const detail = view.locator(".linear-detail");
    await detail.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = detail.getByRole("group", { name: "Move ENG-3 to Linear's trash?" });
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Keep" }).click();
    assert.equal(await confirm.count(), 0);
    assert.deepEqual(writesMade(linear), []);

    await detail.getByRole("button", { name: "Delete", exact: true }).click();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await waitFor(() => issue.count(), (n) => n === 0, "the issue to close");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1", "ENG-3 to leave the list");
    assert.equal(fakeIssue(linear, "ENG-3").trashed, true);
    assert.deepEqual(writesMade(linear), ["IssueDelete"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("drives an issue from the keyboard", async () => {
  // ENG-3 waits in Todo, so In Review changes it.
  const ws = fakeWorkspace();
  const eng3 = ws.issues.find((i) => i.identifier === "ENG-3")!;
  eng3.state = { ...eng3.state, id: FAKE_IDS.states.eng.Todo };
  const { context, page, linear, view, issue } = await openLinear(ws);
  try {
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-3", "my issues");
    const sidebar = view.locator(".linear-sidebar");
    await sidebar.getByRole("button", { name: "Assigned" }).focus();

    // j, j, Enter: the second row opens; the page's own J/K stay out of it.
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await issue.locator("h1", { hasText: "Review the sync design" }).waitFor();
    assert.equal(await focusedName(page).then((n) => n.includes("ENG-3")), true);
    // D, the page's New agent, stands down in the view.
    await page.keyboard.press("d");
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".new-agent").count(), 0);

    // s opens Status; typing filters it and Enter sets In Review.
    await page.keyboard.press("s");
    const picker = page.getByRole("listbox", { name: "Status" });
    await picker.waitFor();
    await page.keyboard.type("rev");
    await page.keyboard.press("Enter");
    await issue.getByRole("button", { name: "Status: In Review" }).waitFor();
    await waitFor(
      () => Promise.resolve(fakeIssue(linear, "ENG-3").state.id),
      (id) => id === FAKE_IDS.states.eng["In Review"],
      "the status in Linear",
    );

    // While typing, letters are text: / filters the list, and c there types a c.
    await page.keyboard.press("/");
    const search = view.getByRole("searchbox", { name: "Search these issues" });
    assert.equal(await focusedName(page), "Search these issues");
    await page.keyboard.type("c");
    assert.equal(await search.inputValue(), "c");
    assert.equal(await createDialog(page).count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await search.inputValue(), "");

    // Esc closes the issue, the keyboard staying on its row; c opens Create issue.
    await prop(issue, "Priority").focus();
    await page.keyboard.press("Escape");
    await waitFor(() => issue.count(), (n) => n === 0, "the issue to close");
    assert.equal(await focusedName(page).then((n) => n.includes("ENG-3")), true);
    await page.keyboard.press("c");
    await createDialog(page).waitFor();
    assert.equal(await focusedName(page), "Issue title");
    assert.deepEqual(writesMade(linear), ["IssueUpdate"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

/** Whether ⌘K lists `label` (exactly) for that search; the palette closes again. */
async function paletteHas(page: Page, label: string) {
  await page.keyboard.press("Meta+k");
  await page.getByLabel("Search commands").fill(label);
  await page.waitForTimeout(100);
  const n = await page.getByRole("option", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).count();
  await page.keyboard.press("Escape");
  return n > 0;
}

test("⌘K goes to Linear's places and offers the open issue's other edits, Undo and search, only where they work", async () => {
  const { context, page, linear, view, issue } = await openLinear();
  try {
    const sidebar = view.locator(".linear-sidebar");
    const here = () => sidebar.locator('[aria-current="page"]').innerText();
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-3", "my issues");
    await paletteRun(page, "Go to Linear projects");
    await waitFor(here, (t) => t === "Projects", "Projects");
    assert.equal(await paletteHas(page, "Search the Linear list"), false, "no list to search on Projects");
    await paletteRun(page, "Go to Linear initiatives");
    await waitFor(here, (t) => t === "Initiatives", "Initiatives");
    await paletteRun(page, "Go to Engineering's Triage (Linear)");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-4", "ENG's triage");
    assert.equal(await paletteHas(page, "Go to Design Engineering's Triage"), false, "DE doesn't triage");
    await paletteRun(page, "Go to Linear issues you created");
    await waitFor(here, (t) => t === "Created", "Created");
    await paletteRun(page, "Go to Linear issues assigned to you");
    await waitFor(here, (t) => t === "Assigned", "Assigned");

    await paletteRun(page, "Search the Linear list");
    await waitFor(() => focusedName(page), (n) => n === "Search these issues", "the list's search");

    // ENG-3: ENG estimates, and its project (Launch) has milestones.
    await view.locator('.linear-row[data-key="ENG-3"]').click();
    await issue.locator("h1", { hasText: "Review the sync design" }).waitFor();
    for (const [label, picker] of [
      ["Change the Linear issue's estimate", "Estimate"],
      ["Change the Linear issue's milestone", "Milestone"],
      ["Change the Linear issue's parent", "Parent"],
      ["Add relation to ENG-3", "Relation"],
    ]) {
      await paletteRun(page, label);
      await page.getByRole("listbox", { name: picker }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("listbox", { name: picker }).waitFor({ state: "detached" });
    }
    await paletteRun(page, "Set the Linear issue's due date");
    await waitFor(() => focusedName(page), (n) => n === "Due date", "the due date field");
    await page.keyboard.press("Escape");

    assert.equal(await paletteHas(page, "Undo archiving ENG-3"), false, "nothing archived yet");
    await paletteRun(page, "Archive ENG-3");
    await view.locator(".linear-undo").getByText("ENG-3 archived").waitFor();
    await paletteRun(page, "Undo archiving ENG-3");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-3", "ENG-3 back");
    assert.equal(await paletteHas(page, "Undo archiving ENG-3"), false, "the bar has gone");

    // DE-1: DE doesn't estimate, and Docs has no milestones.
    await paletteRun(page, "Go to Design Engineering's All issues (Linear)");
    await view.locator('.linear-row[data-key="DE-1"]').click();
    await issue.locator('.linear-detail-bar, h1').first().waitFor();
    await waitFor(() => paletteHas(page, "Add relation to DE-1"), Boolean, "DE-1 open");
    assert.equal(await paletteHas(page, "Change the Linear issue's estimate"), false);
    assert.equal(await paletteHas(page, "Change the Linear issue's milestone"), false);
    assert.deepEqual(writesMade(linear), ["IssueArchive", "IssueUnarchive"]);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("Esc with no issue open stays in the Linear view; O opens the selected issue from a sidebar button", async () => {
  const { context, page, view, issue, linear } = await openLinear();
  try {
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-1,ENG-3", "my issues");
    await page.evaluate(() => {
      (window as any).escapes = 0;
      window.addEventListener("keydown", (e) => e.key === "Escape" && (window as any).escapes++);
    });
    await view.locator(".linear-sidebar").getByRole("button", { name: "Assigned" }).focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => (window as any).escapes), 0, "Esc didn't reach the page");

    // O on a sidebar button opens the list's issue (Enter there is the button's own).
    await page.keyboard.press("o");
    await issue.locator("h1").first().waitFor();
    assert.equal(await issue.count(), 1);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("a scope past 1,000 issues says it shows the most recently updated; the list's groups are named", async () => {
  const ws = fakeWorkspace();
  const template = ws.issues.find((i) => i.identifier === "ENG-3")!;
  for (let n = 0; n < 1001; n++) {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    ws.issues.push({ ...template, id, identifier: `ENG-${100 + n}`, sortOrder: 100 + n, subscribers: { nodes: [] } });
  }
  const { context, page, view, linear } = await openLinear(ws);
  try {
    await view.locator(".linear-note", { hasText: "Showing the 1,000 most recently updated" }).waitFor();
    const list = view.getByRole("listbox", { name: "Issues" });
    await list.getByRole("group", { name: "In Review" }).waitFor();
    // The groups' headings stay out of the listbox's tree.
    assert.equal(await list.getByRole("heading").count(), 0);
  } finally {
    linear.restore();
    await context.close();
  }
});
