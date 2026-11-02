/**
 * The Activity tab (the macOS app's mode bar shows it in the map's place):
 * GitHub, Linear and Slack notifications in one feed, filtered by source and
 * unread, marked read and done from the keyboard and ⌘K. `/api/activity` is
 * answered in the browser from a sample feed; nothing reaches GitHub, Linear,
 * Slack or a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { ActivityFeed, ActivityItem } from "../src/activity/types";
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

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ITEMS: ActivityItem[] = [
  {
    key: "github:101",
    source: "github",
    id: "101",
    kind: "review_requested",
    title: "Add the Slack tab",
    subtitle: "acme/atlas #12",
    subject: "pull",
    at: ago(5),
    unread: true,
    url: "https://github.com/acme/atlas/pull/12",
    state: "open",
  },
  {
    key: "slack:D111:1730000000.000100",
    source: "slack",
    id: "D111:1730000000.000100",
    kind: "dm",
    title: "Sam",
    subtitle: "Can you look at the deploy?",
    subject: "message",
    actor: { name: "Sam" },
    at: ago(15),
    unread: true,
    open: { kind: "slack", conversationId: "D111", ts: "1730000000.000100" },
  },
  {
    key: "linear:issue:11111111-1111-4111-8111-111111111111",
    source: "linear",
    id: "issue:11111111-1111-4111-8111-111111111111",
    kind: "issueNewComment",
    title: "Ship the Linear tab",
    subtitle: "ENG-1",
    subject: "issue",
    actor: { name: "Owen" },
    at: ago(60),
    unread: false,
    open: { kind: "linear-issue", key: "ENG-1" },
  },
];

function feedOf(items: ActivityItem[]): ActivityFeed {
  return {
    items,
    sources: (["github", "linear", "slack"] as const).map((source) => ({
      source,
      enabled: true,
      ok: true,
      unread: items.filter((i) => i.source === source && i.unread).length,
    })),
    at: new Date().toISOString(),
  };
}

const showActivity = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "activity" } })));
const rowKeys = (page: Page) =>
  page.locator(".activity-view .activity-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.key));

test("Activity gathers GitHub, Linear and Slack, filters them, and marks them read and done", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => [],
    lists: { settings: { integrations: { github: true, linear: true, slack: true } } },
  });
  let items = ITEMS.map((i) => ({ ...i }));
  const writes: { name: string; keys: string[] }[] = [];
  await page.route("**/api/activity**", async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.match(/\/api\/activity\/m\/(\w+)$/)?.[1];
    if (name) {
      const { keys } = route.request().postDataJSON() as { keys: string[] };
      writes.push({ name, keys });
      if (name === "done") items = items.filter((i) => !keys.includes(i.key));
      else items = items.map((i) => (keys.includes(i.key) ? { ...i, unread: name === "unread" } : i));
      return route.fulfill({ json: { feed: feedOf(items) } });
    }
    return route.fulfill({ json: feedOf(items) });
  });
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showActivity(page);
    const view = page.locator(".activity-view");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 3, "every source's notifications");
    // Newest first, across sources.
    assert.deepEqual(await rowKeys(page), ITEMS.map((i) => i.key));
    assert.equal(await view.locator(".activity-row.unread").count(), 2);
    const nav = (await view.locator(".activity-sidebar").textContent()) ?? "";
    for (const label of ["All", "Unread", "GitHub", "Linear", "Slack"]) assert.ok(nav.includes(label), `the sidebar has ${label}`);

    // Filter by source from the keyboard: 2 is GitHub, 1 all again.
    await view.locator(".activity-row").first().focus();
    await page.keyboard.press("2");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "github:101", "GitHub only");
    await page.keyboard.press("1");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 3, "all again");

    // J moves to the Slack DM; U marks it read.
    await page.keyboard.press("k");
    await view.locator(`.activity-row.selected[data-key="github:101"]`).waitFor();
    await page.keyboard.press("j");
    await view.locator(`.activity-row.selected[data-key="${ITEMS[1].key}"]`).waitFor();
    await page.keyboard.press("u");
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 1, "the read write");
    assert.deepEqual(writes[0], { name: "read", keys: [ITEMS[1].key] });
    await view.locator(`.activity-row:not(.unread)[data-key="${ITEMS[1].key}"]`).waitFor();

    // E marks it done: it leaves the feed.
    await page.keyboard.press("e");
    await waitFor(() => rowKeys(page), (keys) => !keys.includes(ITEMS[1].key), "done leaves the feed");
    assert.deepEqual(writes[1], { name: "done", keys: [ITEMS[1].key] });

    // ⌘K offers marking all read while something is unread.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Mark all shown activity read");
    await palette.getByRole("option", { name: /Mark all shown activity read/ }).click();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 3, "the read-all write");
    assert.deepEqual(writes[2], { name: "read", keys: ["github:101"] });
    await waitFor(() => view.locator(".activity-row.unread").count(), (n) => n === 0, "nothing unread");

    // Mark all done asks first; Cancel (or Esc) leaves everything, Mark done takes every shown item.
    await view.getByRole("button", { name: "Mark all done" }).click();
    await view.getByRole("button", { name: "Cancel" }).click();
    assert.equal(writes.length, 3, "cancelling writes nothing");
    await view.locator(".activity-row").first().focus();
    await page.keyboard.press("Shift+E");
    await page.keyboard.press("Escape");
    await view.getByRole("button", { name: "Mark all done" }).waitFor();
    assert.equal(writes.length, 3, "Esc writes nothing");
    await view.locator(".activity-row").first().focus();
    await page.keyboard.press("Shift+E");
    await view.getByRole("button", { name: "Mark done", exact: true }).click();
    await waitFor(() => rowKeys(page), (keys) => keys.length === 0, "the feed emptied");
    assert.deepEqual(writes[3], { name: "done", keys: ["github:101", ITEMS[2].key] });
  } finally {
    await context.close();
  }
});

test("in the macOS app, a Linear pull request notification opens its issue in the Linear tab, not yet visited", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1800, height: 1000 });
  // The app's message channel, recording what the page asks of it.
  await page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(m) } } };
  `);
  await mockApi(page, { agents: () => [], lists: { settings: { integrations: { linear: true } } } });
  const linear = await mockLinear(page);
  // As the server gives it: the pull request's branch names DE-1; its address is the pull request's.
  const item: ActivityItem = {
    key: "linear:notification:90000001-0000-4000-8000-000000000001",
    source: "linear",
    id: "notification:90000001-0000-4000-8000-000000000001",
    kind: "pullRequestChecksFailed",
    title: "Refresh the docs theme",
    subtitle: "DE-1 · merge-gate / pass check failed",
    subject: "pull",
    at: ago(5),
    unread: true,
    url: "https://github.com/acme/site/pull/7",
    open: { kind: "linear-issue", key: "DE-1" },
  };
  await page.route("**/api/activity**", (route) =>
    route.fulfill({ json: route.request().method() === "POST" ? { feed: feedOf([{ ...item, unread: false }]) } : feedOf([item]) }),
  );
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showActivity(page);
    const view = page.locator(".activity-view");
    await view.locator(`.activity-row[data-key="${item.key}"]`).click();
    await view.getByRole("button", { name: "Open in Linear" }).click();
    // The page asks the app for the Linear tab, not the pull request's address.
    const sent = () =>
      page.evaluate(() => (window as unknown as { sentToApp: { type: string; action?: string; url?: string }[] }).sentToApp);
    await waitFor(sent, (m) => m.some((x) => x.type === "menu" && x.action === "linear"), "the Linear tab asked for");
    assert.ok(!(await sent()).some((x) => x.url === item.url), "the pull request's address isn't opened");
    // The app switches: the Linear tab mounts with DE-1 open.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "linear" } })));
    await page.locator(".linear-view .linear-issue h1", { hasText: "Refresh the docs theme" }).waitFor();
  } finally {
    linear.restore();
    await context.close();
  }
});

test("Activity's sidebar and preview resize from their edges, kept across a reload", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await mockApi(page, {
    agents: () => [],
    lists: { settings: { integrations: { github: true, linear: true, slack: true } } },
  });
  await page.route("**/api/activity**", (route) => route.fulfill({ json: feedOf(ITEMS) }));
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showActivity(page);
    const view = page.locator(".activity-view");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 3, "the feed");
    await view.locator(".activity-row").first().click();
    const sidebar = view.locator(".activity-sidebar");
    const preview = view.locator(".activity-preview");
    await preview.waitFor();
    const width = async (el: typeof sidebar) => (await el.boundingBox())!.width;
    const drag = async (name: string, by: number) => {
      const box = (await view.getByRole("separator", { name }).boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + by, box.y + 300, { steps: 5 });
      await page.mouse.up();
    };

    const sidebarBefore = await width(sidebar);
    await drag("Resize the activity sidebar", 80);
    assert.ok(Math.abs((await width(sidebar)) - (sidebarBefore + 80)) <= 3, "the sidebar 80 wider");
    const previewBefore = await width(preview);
    await drag("Resize the preview", -150);
    assert.ok(Math.abs((await width(preview)) - (previewBefore + 150)) <= 3, "the preview 150 wider");

    // Kept; the arrow keys step them; double-click restores the default.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await showActivity(page);
    await view.locator(".activity-row").first().click();
    await preview.waitFor();
    assert.ok(Math.abs((await width(sidebar)) - (sidebarBefore + 80)) <= 3);
    assert.ok(Math.abs((await width(preview)) - (previewBefore + 150)) <= 3);
    await view.getByRole("separator", { name: "Resize the activity sidebar" }).focus();
    await page.keyboard.press("ArrowLeft");
    assert.ok(Math.abs((await width(sidebar)) - (sidebarBefore + 64)) <= 3, "16 narrower");
    await view.getByRole("separator", { name: "Resize the activity sidebar" }).dblclick();
    await view.getByRole("separator", { name: "Resize the preview" }).dblclick();
    await waitFor(() => width(sidebar), (w) => Math.abs(w - sidebarBefore) <= 3, "the sidebar's default");
    await waitFor(() => width(preview), (w) => Math.abs(w - previewBefore) <= 3, "the preview's default");
  } finally {
    await context.close();
  }
});
