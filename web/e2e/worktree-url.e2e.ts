/**
 * A Diagonal workspace's own app (`bin/worktree status`'s URL, `GET /api/workspace-url`) opens by itself in its agent's
 * browser while that has no tab, once an agent and address; other repositories ask nothing. In the macOS app (mocked:
 * what the page sends it is kept). Every /api request is answered in the browser; nothing reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { small } from "./fleets";
import { appEvent, detailOf, launch, mockApi, newContext, startApp, waitFor } from "./harness";

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

const URL = "https://chamber.17.diagonal.test/admin";
type Sent = { type: string; action?: string; url?: string; agent?: string; workspace?: string };

async function setUp(page: Page, repo: string) {
  await page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(JSON.parse(JSON.stringify(m))) } } };
  `);
  const asked: string[] = [];
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces.map((w) => (w.workspaceId === "wks_a" ? { ...w, repo } : w)),
    detail: (id: string) => detailOf(id, "idle"),
  } as never);
  await page.route("**/api/workspace-url?**", (route) => {
    asked.push(new globalThis.URL(route.request().url()).search);
    return route.fulfill({ json: { url: URL, slot: "diagonal-17", setup: "complete" } });
  });
  return asked;
}
const opens = (page: Page) =>
  page.evaluate(() => (window as unknown as { sentToApp: Sent[] }).sentToApp.filter((m) => m.type === "browserDo" && m.action === "open"));
/** The app says its browsers (none has a tab yet, or this agent's has one). */
const browsers = (page: Page, tabs: Record<string, { tabs: { id: string; url: string }[] }> = {}) =>
  appEvent(page, "paseo:browser", { type: "state", browsers: Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, { host: "local", agent: k.split("|")[1], current: v.tabs[0]?.id ?? "", tabs: v.tabs }])), hosting: {} });

test("a Diagonal workspace's URL opens by itself in its agent's empty browser, once", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const asked = await setUp(page, "https://github.com/Diagonal-HQ/diagonal");
  try {
    await page.goto(`${app.url}?agent=a-idle`);
    await page.locator(".crew-detail .session").waitFor();
    await browsers(page);
    const opened = await waitFor(() => opens(page), (o) => o.length === 1, "opened in its browser");
    assert.equal(opened[0]!.url, URL);
    assert.equal(opened[0]!.workspace, "wks_a");
    assert.match(asked[0]!, /workspace=wks_a/);
    // The app reports the tab, then it's closed: nothing opens it again.
    await browsers(page, { "local|a-idle": { tabs: [{ id: "t1", url: URL }] } });
    await browsers(page);
    await page.waitForTimeout(300);
    assert.equal((await opens(page)).length, 1, "once an agent and address");
  } finally {
    await context.close();
  }
});

test("other repositories don't ask for a worktree URL", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const asked = await setUp(page, "https://github.com/acme/atlas");
  try {
    await page.goto(`${app.url}?agent=a-idle`);
    await page.locator(".crew-detail .session").waitFor();
    await browsers(page);
    await page.waitForTimeout(500);
    assert.deepEqual(asked, []);
    assert.equal((await opens(page)).length, 0);
  } finally {
    await context.close();
  }
});
