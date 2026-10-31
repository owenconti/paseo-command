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
  } finally {
    await context.close();
  }
});
