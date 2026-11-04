/**
 * The Activity tab (the macOS app's mode bar shows it in the map's place):
 * GitHub and Linear notifications in one feed, filtered by source and
 * unread, marked read and done from the keyboard and ⌘K. `/api/activity` is
 * answered in the browser from a sample feed; nothing reaches GitHub, Linear
 * or a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { ActivityFeed, ActivityItem } from "../src/activity/types";
import { headOverlaps, launch, mockApi, newContext, startApp, waitFor, appEvent } from "./harness";

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
    title: "Add the Activity tab",
    subtitle: "acme/atlas #12",
    subject: "pull",
    at: ago(5),
    unread: true,
    url: "https://github.com/acme/atlas/pull/12",
    state: "open",
  },
  {
    key: "github:102",
    source: "github",
    id: "102",
    kind: "mention",
    title: "The deploy fails on main",
    subtitle: "acme/atlas #13",
    subject: "issue",
    actor: { name: "Sam" },
    at: ago(15),
    unread: true,
    url: "https://github.com/acme/atlas/issues/13",
    state: "open",
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
    url: "https://linear.app/acme/issue/ENG-1",
  },
];

function feedOf(items: ActivityItem[]): ActivityFeed {
  return {
    items,
    sources: (["github", "linear"] as const).map((source) => ({
      source,
      enabled: true,
      ok: true,
      unread: items.filter((i) => i.source === source && i.unread).length,
    })),
    at: new Date().toISOString(),
  };
}

const showActivity = (page: Page) =>
  appEvent(page, "paseo:mode", { mode: "activity" });
const rowKeys = (page: Page) =>
  page.locator(".activity-view .activity-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.key));

test("Activity gathers GitHub and Linear, filters them, and marks them read and done", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => [],
    lists: { settings: { integrations: { github: true, linear: true } } },
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
    for (const label of ["All", "Unread", "GitHub", "Linear"]) assert.ok(nav.includes(label), `the sidebar has ${label}`);
    assert.ok(!nav.includes("Slack"), "the sidebar has no Slack");

    // Filter by source from the keyboard: 2 is GitHub, 3 Linear, 1 all again.
    await view.locator(".activity-row").first().focus();
    await page.keyboard.press("2");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === "github:101,github:102", "GitHub only");
    await page.keyboard.press("3");
    await waitFor(() => rowKeys(page), (keys) => keys.join() === ITEMS[2].key, "Linear only");
    await view.locator(".activity-row").first().focus();
    await page.keyboard.press("1");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 3, "all again");

    // J moves to the GitHub mention; U marks it read.
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

test("a done item stays gone across polls, even one begun before the write; a refused one comes back with a notice", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, {
    agents: () => [],
    lists: { settings: { integrations: { github: true, linear: true } } },
  });
  // The server's list; a held ask answers with the list from when it was asked.
  let items = ITEMS.map((i) => ({ ...i }));
  let hold: Promise<void> | undefined;
  let release = () => {};
  let asks = 0;
  let refuse = false;
  await page.route("**/api/activity**", async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.match(/\/api\/activity\/m\/(\w+)$/)?.[1];
    if (name) {
      const { keys } = route.request().postDataJSON() as { keys: string[] };
      if (refuse) return route.fulfill({ json: { feed: feedOf(items), failed: keys.map((key) => ({ key, error: "Not Found" })) } });
      if (name === "done") items = items.filter((i) => !keys.includes(i.key));
      return route.fulfill({ json: { feed: feedOf(items) } });
    }
    asks++;
    const asked = feedOf(items);
    if (hold) await hold;
    return route.fulfill({ json: asked });
  });
  // Asks again now, as a poll does (a saved key's event asks past the caches).
  const poll = async () => {
    const before = asks;
    await page.evaluate(() => window.dispatchEvent(new Event("paseo:secrets")));
    await waitFor(() => Promise.resolve(asks), (n) => n > before, "an ask");
  };
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showActivity(page);
    const view = page.locator(".activity-view");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 3, "the feed");

    // An ask goes out and is held; meanwhile the mention is marked done.
    hold = new Promise<void>((r) => (release = r));
    await poll();
    await view.locator(`.activity-row[data-key="${ITEMS[1].key}"]`).hover();
    await view.getByRole("button", { name: `Mark ${ITEMS[1].title} done` }).click();
    await waitFor(() => rowKeys(page), (keys) => !keys.includes(ITEMS[1].key), "done leaves the feed");
    // The held ask answers with the list from before the write: dropped.
    release();
    hold = undefined;
    await page.waitForTimeout(300);
    for (let i = 0; i < 3; i++) {
      await poll();
      await page.waitForTimeout(150);
      assert.ok(!(await rowKeys(page)).includes(ITEMS[1].key), `still gone after poll ${i + 1}`);
    }
    assert.deepEqual(await rowKeys(page), [ITEMS[0].key, ITEMS[2].key]);

    // GitHub refuses: back in the feed, with a notice saying why.
    refuse = true;
    await view.locator(`.activity-row[data-key="${ITEMS[0].key}"]`).hover();
    await view.getByRole("button", { name: `Mark ${ITEMS[0].title} done` }).click();
    await page.locator(".toast", { hasText: "Couldn’t mark as done “Add the Activity tab”: Not Found" }).waitFor();
    await waitFor(() => rowKeys(page), (keys) => keys.includes(ITEMS[0].key), "the refused item back");
  } finally {
    await context.close();
  }
});

test("in the macOS app, a Linear pull request notification opens its issue's address, which the app takes to Linear", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1800, height: 1000 });
  // The app's message channel, recording what the page asks of it.
  await page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(m) } } };
  `);
  await mockApi(page, { agents: () => [], lists: { settings: { integrations: { linear: true } } } });
  // As the server gives it: the pull request's branch names DE-1, so its address is the issue's.
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
    url: "https://linear.app/acme/issue/DE-1",
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
    // The page hands the app the issue's address (the app opens it in Linear's desktop app, else in Conquer).
    const sent = () =>
      page.evaluate(() => (window as unknown as { sentToApp: { type: string; action?: string; url?: string; direct?: boolean }[] }).sentToApp);
    await waitFor(sent, (m) => m.some((x) => x.type === "openLink" && x.url === item.url && !x.direct), "the issue's address sent");
    assert.ok(!(await sent()).some((x) => x.type === "menu" && x.action === "linear"), "there is no Linear tab to ask for");
  } finally {
    await context.close();
  }
});

test("Activity's sidebar and preview resize from their edges, kept across a reload", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await mockApi(page, {
    agents: () => [],
    lists: { settings: { integrations: { github: true, linear: true } } },
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

test("Activity's head never overlaps, its tools going to icons and wrapping only at the narrowest", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1800, height: 900 });
  await mockApi(page, {
    agents: () => [],
    lists: { settings: { integrations: { github: true, linear: true } } },
  });
  await page.route("**/api/activity**", (route) => route.fulfill({ json: feedOf(ITEMS.map((i) => ({ ...i, unread: true }))) }));
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showActivity(page);
    const view = page.locator(".activity-view");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 3, "the feed");
    await view.locator(".activity-row").first().click();
    await view.locator(".activity-preview").waitFor();
    const head = view.locator(".activity-head");
    const readAll = head.getByRole("button", { name: "Mark all read" });
    const width = async () => (await head.boundingBox())!.width;
    let last = "";
    const settled = () =>
      waitFor(
        async () => JSON.stringify(await head.boundingBox()),
        (now) => {
          const same = now === last;
          last = now;
          return same;
        },
        "the head to settle",
      );
    const labelShown = () => readAll.locator(".page-tool-label").evaluate((e) => e.getBoundingClientRect().width > 1);

    // Wide: the tools have their words.
    assert.deepEqual(await headOverlaps(head), []);
    assert.equal(await labelShown(), true);
    // Narrower, with the preview beside: icons, still named, hinted.
    for (const w of [1100, 1000, 860, 760]) {
      await page.setViewportSize({ width: w, height: 900 });
      await settled();
      assert.deepEqual(await headOverlaps(head), [], `nothing in the head overlaps at ${w}`);
      const tools = (await readAll.boundingBox())!;
      const own = (await head.boundingBox())!;
      assert.ok(tools.x + tools.width <= own.x + own.width + 0.5, `the tools stay in the head at ${w}`);
    }
    assert.ok((await width()) < 200, "the narrowest head");
    assert.equal(await labelShown(), false);
    assert.equal(await readAll.getAttribute("data-tip"), "Mark all shown read (⇧U)");
    // At the narrowest the tools wrap under the title rather than squeeze it.
    const title = (await head.locator("h2").boundingBox())!;
    assert.ok((await readAll.boundingBox())!.y >= title.y + title.height - 0.5, "the tools under the title");

    // Asking to mark all done: its question and buttons keep inside the head too.
    await head.getByRole("button", { name: "Mark all done" }).click();
    await head.getByRole("button", { name: "Mark done" }).waitFor();
    assert.deepEqual(await headOverlaps(head), [], "nothing overlaps while it asks");
    const own = (await head.boundingBox())!;
    const cancel = (await head.getByRole("button", { name: "Cancel" }).boundingBox())!;
    assert.ok(cancel.x + cancel.width <= own.x + own.width + 0.5, "Cancel stays in the head");
  } finally {
    await context.close();
  }
});

test("⌘R refreshes Activity past the server's cache, spinning its button, without reloading the page or losing the filter", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await mockApi(page, { agents: () => [], lists: { settings: { integrations: { github: true, linear: true } } } });
  const fresh: string[] = [];
  await page.route("**/api/activity**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("fresh")) {
      fresh.push(url.search);
      await new Promise((r) => setTimeout(r, 400));
    }
    return route.fulfill({ json: feedOf(ITEMS) });
  });
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showActivity(page);
    const view = page.locator(".activity-view");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 3, "the feed");
    await view.locator(".activity-row").first().focus();
    await page.keyboard.press("2");
    await waitFor(() => rowKeys(page), (keys) => keys.length === 2, "GitHub only");
    await page.evaluate(() => ((window as unknown as { kept: number }).kept = 1));
    const before = fresh.length;
    await page.keyboard.press("Meta+r");
    await view.getByRole("button", { name: "Refresh activity" }).locator(".spinning").waitFor();
    await page.keyboard.press("Meta+r");
    await view.getByRole("button", { name: "Refresh activity" }).locator(".spinning").waitFor({ state: "detached" });
    assert.equal(fresh.length - before, 1, "one fresh read, the second ⌘R ignored while it ran");
    assert.equal(await page.evaluate(() => (window as unknown as { kept?: number }).kept), 1, "the page never reloaded");
    assert.deepEqual(await rowKeys(page), ["github:101", "github:102"], "the filter stays");
  } finally {
    await context.close();
  }
});
