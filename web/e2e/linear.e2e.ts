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
    lists: { presets: { presets: [{ name: "Plan it", prompt: "Plan {{issue}}." }], error: null } },
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
  await mockApi(page, { agents: () => [] });
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
    await view.locator('.linear-group[aria-label="In Review"] .linear-row[data-key="ENG-1"]').waitFor();
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
