/**
 * Linear's saved views in the Linear tab: project views (a list of projects,
 * filtered and displayed as Linear has them), a project's own views, and
 * making, changing and deleting views from what a list shows. The page's
 * Linear requests run the real server route over the fake Linear
 * (`linearFake.ts`); nothing reaches a daemon or Linear. With LINEAR_VIEWS_SHOT
 * set to a folder, the tests leave screenshots of the views there.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { FAKE_IDS as I, fakeWorkspace } from "../server/linear/fake";
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
const projectNames = (page: Page) => page.locator(".linear-project-row .linear-project-name").allInnerTexts();
const shot = async (page: Page, name: string) => {
  if (!process.env.LINEAR_VIEWS_SHOT) return;
  // Dialogs settle after their entrance.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${process.env.LINEAR_VIEWS_SHOT}/${name}.png` });
};

async function openLinear(ws = fakeWorkspace()) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 960 });
  await mockApi(page, { agents: () => [], lists: { settings: { integrations: { linear: true } } } });
  const linear = await mockLinear(page, ws);
  await page.goto(app.url);
  await page.locator(".fleet-sidebar").waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "linear" } })));
  const view = page.locator(".linear-view");
  const sidebar = view.locator(".linear-sidebar");
  await sidebar.getByRole("button", { name: /^ENG/ }).waitFor();
  const views = sidebar.locator('section[aria-labelledby="linear-nav-views"]');
  await views.getByRole("button", { name: /^Under way/ }).waitFor();
  return { context, page, linear, view, sidebar, views };
}

/** A ⌘K command, by its label. */
async function paletteRun(page: Page, label: string) {
  await page.keyboard.press("Meta+k");
  await page.getByLabel("Search commands").fill(label);
  await page.getByRole("option", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().waitFor();
  await page.keyboard.press("Enter");
}
/** Whether ⌘K lists `label` for that search; the palette closes again. */
async function paletteHas(page: Page, label: string) {
  await page.keyboard.press("Meta+k");
  await page.getByLabel("Search commands").fill(label);
  await page.waitForTimeout(100);
  const n = await page.getByRole("option", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).count();
  await page.keyboard.press("Escape");
  return n > 0;
}

test("project views list their projects as Linear filters and displays them; a project's own views are in the project", async () => {
  const { context, page, linear, view, views } = await openLinear();
  try {
    // Marked as views of projects.
    assert.equal(await views.getByRole("button", { name: "Under way (project view)" }).count(), 1);
    assert.equal(await views.getByRole("button", { name: "Launch in flight", exact: true }).count(), 1);
    assert.equal(await views.getByRole("button", { name: /Launch bugs/ }).count(), 0, "a project's own view isn't a sidebar view");

    // Under way: Linear's filter (started projects), grouped by health and ordered by name as the view is set.
    await views.getByRole("button", { name: /^Under way/ }).click();
    await view.locator(".linear-list-head h2", { hasText: "Under way" }).waitFor();
    await waitFor(() => projectNames(page), (names) => names.join() === "Launch", "the view's projects");
    assert.ok(linear.requests.some((r) => r.operation === "ViewProjects"));
    assert.deepEqual(await view.locator(".linear-project-group h3").allInnerTexts(), ["On track\n1"]);
    assert.match(await view.locator(".linear-view-about").innerText(), /Projects under way\s*Shared with the workspace · by Owen Conti/);
    await shot(page, "project-view");

    // Narrowed here by a filter: Save to view offers to keep it.
    await view.getByRole("button", { name: "Filter" }).click();
    await view.getByRole("menu", { name: "Filter by" }).getByRole("menuitem", { name: "Lead" }).click();
    await page.getByRole("listbox", { name: "Lead" }).getByRole("option", { name: "No lead" }).click();
    await page.keyboard.press("Escape");
    await view.locator(".linear-note", { hasText: "No project matches these filters." }).waitFor();
    await view.getByRole("button", { name: "Save to view" }).waitFor();
    await view.getByRole("button", { name: "Remove the lead filter" }).click();

    // Projects: the workspace's, with the same filters and display.
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await waitFor(() => projectNames(page), (names) => names.join() === "Launch,Docs", "every project, started first");
    await view.getByRole("button", { name: "Display" }).click();
    await view.getByRole("dialog", { name: "Display options" }).getByLabel("Grouping").selectOption("status");
    await page.keyboard.press("Escape");
    assert.deepEqual(await view.locator(".linear-project-group h3").allInnerTexts(), ["Started\n1", "Planned\n1"]);

    // Launch's own views, under its summary; one opens its issues, under Projects › Launch.
    await view.locator(".linear-project-row", { hasText: "Launch" }).click();
    const own = view.getByRole("navigation", { name: "Launch’s views" });
    await own.getByRole("button", { name: "Launch bugs" }).click();
    await view.locator(".linear-list-head h2", { hasText: "Launch bugs" }).waitFor();
    assert.match(await view.locator(".linear-list-head h2").innerText(), /Projects\s*Launch\s*Launch bugs/);
    await waitFor(() => rowKeys(page), (keys) => keys.length > 0, "the view's issues");
    const bug = I.labels.bug;
    for (const key of await rowKeys(page)) {
      const issue = linear.ws.issues.find((i) => i.identifier === key)!;
      assert.ok(issue.labels.nodes.some((l) => l.id === bug) && issue.project?.id === I.projects.launch, `${key} is a launch bug`);
    }
    await shot(page, "project-own-view");
    assert.equal(await paletteHas(page, "Go to Launch's view Launch bugs (Linear)"), true);
    assert.equal(await paletteHas(page, "Go to Under way (Linear project view)"), true);
  } finally {
    linear.restore();
    await context.close();
  }
});

test("Save as view from a team's filters and display; edit it from the sidebar, save the display to it, delete it", async () => {
  const { context, page, linear, view, sidebar, views } = await openLinear();
  try {
    await sidebar.getByRole("button", { name: /^ENG/ }).click();
    await sidebar.locator('.linear-team[data-team="ENG"]').getByRole("button", { name: "Active" }).click();
    await view.locator(".linear-list-head h2", { hasText: "Active" }).waitFor();
    // Nothing to save until the list is narrowed (⌘K always offers it).
    assert.equal(await view.getByRole("button", { name: "Save as view" }).count(), 0);
    assert.equal(await paletteHas(page, "Save the Linear list as a view…"), true);
    await view.getByRole("button", { name: "Filter" }).click();
    await view.getByRole("menu", { name: "Filter by" }).getByRole("menuitem", { name: "Priority" }).click();
    await page.getByRole("listbox", { name: "Priority" }).getByRole("option", { name: "Urgent" }).click();
    await page.keyboard.press("Escape");
    await view.getByRole("button", { name: "Save as view" }).click();

    const dialog = page.getByRole("dialog", { name: "New view" });
    await dialog.waitFor();
    assert.match(await dialog.locator(".linear-view-summary").innerText(), /Engineering · Active · Priority is Urgent/);
    await dialog.getByRole("textbox", { name: "View name" }).fill("Urgent ENG");
    await dialog.getByRole("textbox", { name: "Description" }).fill("What's on fire");
    await dialog.getByRole("button", { name: "Icon and colour" }).click();
    await dialog.getByRole("radio", { name: "Flag" }).click();
    await dialog.getByRole("radio", { name: "#eb5757" }).click();
    await dialog.getByRole("radio", { name: "A team" }).check();
    await shot(page, "save-as-view");
    await dialog.getByRole("button", { name: "Save view" }).click();
    await dialog.waitFor({ state: "detached" });

    // The new view opens, listed in the sidebar, as Linear saved it.
    await view.locator(".linear-list-head h2", { hasText: "Urgent ENG" }).waitFor();
    await views.getByRole("button", { name: "Urgent ENG" }).waitFor();
    await dialog.waitFor({ state: "detached" });
    const saved = linear.ws.views.find((v) => v.name === "Urgent ENG")!;
    assert.deepEqual([saved.shared, saved.team?.id, saved.icon, saved.color, saved.description], [true, I.eng, "Flag", "#eb5757", "What's on fire"]);
    assert.deepEqual(saved.filterData, {
      and: [{ team: { id: { eq: I.eng } } }, { state: { type: { in: ["unstarted", "started"] } } }, { priority: { in: [1] } }],
    });
    assert.equal(saved.organizationViewPreferences?.preferences.issueGrouping, "workflowState");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "ENG-3", "the view's issues");
    assert.match(await view.locator(".linear-view-about").innerText(), /What's on fire\s*Shared with Engineering/);
    await shot(page, "new-view");

    // Edited from the sidebar's context menu: renamed, now yours alone.
    await views.getByRole("button", { name: "Urgent ENG" }).click({ button: "right" });
    await page.getByRole("menu", { name: "Urgent ENG view" }).getByRole("menuitem", { name: "Edit view…" }).click();
    const edit = page.getByRole("dialog", { name: "Edit view" });
    await edit.getByRole("textbox", { name: "View name" }).fill("Urgent work");
    await edit.getByRole("radio", { name: "Only you" }).check();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await views.getByRole("button", { name: "Urgent work" }).waitFor();
    await waitFor(async () => [saved.name, saved.shared, saved.team], (v) => JSON.stringify(v) === '["Urgent work",false,null]', "Linear to have it");

    // A board here: Save to view keeps it as the view's display (yours, as it's personal), and the list then shows the view's own.
    await view.getByRole("button", { name: "Display" }).click();
    await view.getByRole("dialog", { name: "Display options" }).getByRole("button", { name: "Board" }).click();
    await page.keyboard.press("Escape");
    await view.locator(".linear-board").waitFor();
    await view.getByRole("button", { name: "Save to view" }).click();
    const update = page.getByRole("dialog", { name: "Edit view" });
    assert.equal(await update.getByRole("checkbox", { name: /Save what the list shows now/ }).isChecked(), true);
    assert.match(await update.locator(".linear-view-summary").innerText(), /Board · Grouped by status/);
    await shot(page, "save-to-view");
    await update.getByRole("button", { name: "Save changes" }).click();
    await update.waitFor({ state: "detached" });
    await shot(page, "saved-to-view");
    await waitFor(async () => saved.userViewPreferences?.preferences.layout, (v) => v === "board", "the view's display");
    await view.getByRole("button", { name: "Save to view" }).waitFor({ state: "detached" });
    await view.locator(".linear-board").waitFor();

    // ⌘K edits and deletes the view shown; deleting asks first and leaves for the default place.
    assert.equal(await paletteHas(page, "Edit the Linear view Urgent work…"), true);
    await paletteRun(page, "Delete the Linear view Urgent work…");
    const confirm = page.getByRole("dialog", { name: "Delete view" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    assert.ok(linear.ws.views.some((v) => v.id === saved.id), "cancelled");
    await view.getByRole("button", { name: "Delete the view Urgent work" }).click();
    await page.getByRole("dialog", { name: "Delete view" }).getByRole("button", { name: "Delete view" }).click();
    await view.locator(".linear-list-head h2", { hasText: "Assigned to you" }).waitFor();
    await views.getByRole("button", { name: "Urgent work" }).waitFor({ state: "detached" });
    await waitFor(async () => linear.ws.views.some((v) => v.id === saved.id), (v) => !v, "Linear to delete it");
  } finally {
    linear.restore();
    await context.close();
  }
});

test("a project view saved from the projects' filters; refused writes go back, with the notice", async () => {
  const { context, page, linear, view, views } = await openLinear();
  try {
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await view.getByRole("button", { name: "Filter" }).click();
    await view.getByRole("menu", { name: "Filter by" }).getByRole("menuitem", { name: "Health" }).click();
    await page.getByRole("listbox", { name: "Health" }).getByRole("option", { name: "On track" }).click();
    await page.keyboard.press("Escape");
    await waitFor(() => projectNames(page), (names) => names.join() === "Launch", "on-track projects");

    // Refused: listed at once, then gone again, and the notice says why.
    linear.fail("CustomViewCreate", { message: "Not allowed" });
    await view.getByRole("button", { name: "Save as view" }).click();
    let dialog = page.getByRole("dialog", { name: "New project view" });
    await dialog.getByRole("textbox", { name: "View name" }).fill("On track");
    await dialog.getByRole("button", { name: "Save view" }).click();
    await page.locator(".toast", { hasText: "Linear didn't save the view: Not allowed" }).waitFor();
    assert.equal(await views.getByRole("button", { name: /^On track/ }).count(), 0);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    linear.clear("CustomViewCreate");
    await view.getByRole("button", { name: "Save as view" }).click();
    dialog = page.getByRole("dialog", { name: "New project view" });
    assert.match(await dialog.locator(".linear-view-summary").innerText(), /Health is On track/);
    await dialog.getByRole("textbox", { name: "View name" }).fill("On track");
    await dialog.getByRole("button", { name: "Save view" }).click();
    await view.locator(".linear-list-head h2", { hasText: "On track" }).waitFor();
    const saved = linear.ws.views.find((v) => v.name === "On track")!;
    assert.equal(saved.modelName, "Project");
    assert.deepEqual(saved.projectFilterData, { health: { in: ["onTrack"] } });
    await waitFor(() => projectNames(page), (names) => names.join() === "Launch", "the new view's projects");

    // Deleting refused: it comes back.
    linear.fail("CustomViewDelete", { message: "Locked" });
    await view.getByRole("button", { name: "Delete the view On track" }).click();
    await page.getByRole("dialog", { name: "Delete view" }).getByRole("button", { name: "Delete view" }).click();
    await page.locator(".toast", { hasText: "Linear didn't delete the view: Locked" }).waitFor();
    await views.getByRole("button", { name: /^On track/ }).waitFor();
  } finally {
    linear.restore();
    await context.close();
  }
});

test("a view whose filter the app can't say opens, and only its name, icon, description and sharing change here", async () => {
  const { context, page, linear, view, views } = await openLinear();
  try {
    await views.getByRole("button", { name: "Estimated work" }).click();
    await view.locator(".linear-list-head h2", { hasText: "Estimated work" }).waitFor();
    // Linear filters it: the issues with an estimate.
    await waitFor(() => rowKeys(page), (keys) => keys.length > 0, "its issues");
    for (const key of await rowKeys(page)) assert.ok(linear.ws.issues.find((i) => i.identifier === key)!.estimate! >= 1);
    assert.match(await view.locator(".linear-view-about").innerText(), /Filtered as set in Linear/);
    // Narrowed here, it still can't be saved to the view.
    await view.getByRole("button", { name: "Filter" }).click();
    await view.getByRole("menu", { name: "Filter by" }).getByRole("menuitem", { name: "Priority" }).click();
    await page.getByRole("listbox", { name: "Priority" }).getByRole("option", { name: "High" }).click();
    await page.keyboard.press("Escape");
    assert.equal(await view.getByRole("button", { name: /Save (to|as) view/ }).count(), 0);
    assert.equal(await paletteHas(page, "Save the Linear list as a view…"), false);

    await paletteRun(page, "Edit the Linear view Estimated work…");
    const edit = page.getByRole("dialog", { name: "Edit view" });
    await edit.getByRole("note").getByText(/conditions this app can’t show/).waitFor();
    assert.equal(await edit.getByRole("checkbox").count(), 0);
    await shot(page, "edit-unsupported-view");
    await edit.getByRole("textbox", { name: "View name" }).fill("Sized work");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await views.getByRole("button", { name: "Sized work" }).waitFor();
    const saved = linear.ws.views.find((v) => v.id === I.views.estimated)!;
    assert.equal(saved.name, "Sized work");
    assert.deepEqual(saved.filterData, { estimate: { gte: 1 } }, "its filter stays Linear's");
    const update = linear.requests.filter((r) => r.operation === "CustomViewUpdate").at(-1)!;
    assert.equal("filterData" in (update.variables.input as object), false);
  } finally {
    linear.restore();
    await context.close();
  }
});
