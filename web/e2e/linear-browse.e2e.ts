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
