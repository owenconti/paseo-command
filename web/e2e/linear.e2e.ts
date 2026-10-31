/**
 * The Linear tab (the macOS app's mode bar shows it in the map's place):
 * Linear's navigation (my issues, teams, projects, initiatives), an issue's
 * details, and New agent launched from it. The page's Linear requests run the
 * real server route over the fake Linear (`linearFake.ts`); every other /api
 * request is answered in the browser. Nothing reaches a daemon or Linear.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
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
