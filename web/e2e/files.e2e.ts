/**
 * The Files tab (the macOS app's mode bar shows it in the map's place): the
 * selected workspace's tree, read as folders open, ignored files hidden until
 * asked; the filter and ⌘P quick-open; a file opened highlighted, found in
 * with ⌘F; big, binary and image files refused politely; Show changes for a
 * changed file (Changes themselves: `changes.e2e.ts`); the open files' tabs (preview and kept, closing, reopening,
 * stepping, reordering, each one's scroll, per workspace); Markdown rendered (its links, images and HTML,
 * Preview / Source, find in the preview) and long lines wrapped (or not). `/api/files/…` is
 * answered in the browser; nothing reaches a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { FileEntry, FileRead } from "../src/files/types";
import { small } from "./fleets";
import { appEvent, launch, mockApi, newContext, startApp, waitFor } from "./harness";

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

const d = (path: string, ignored = false): FileEntry => ({ name: path.split("/").pop()!, path, kind: "directory", size: 0, ...(ignored ? { ignored: true as const } : {}) });
const f = (path: string, size = 40): FileEntry => ({ name: path.split("/").pop()!, path, kind: "file", size });
const APP_TS = `import { join } from "node:path";\n\nexport const answer = 42;\n\nexport function greet(name: string): string {\n  return \`hello \${name}, the answer is \${answer}\`;\n}\n`;
// Long enough that only part of it is drawn: the find scrolls to a match far down.
const LONG = Array.from({ length: 3000 }, (_, i) => (i === 2700 ? "const needle = true;" : `const line${i} = ${i};`)).join("\n");
const TREE: Record<string, FileEntry[]> = {
  "": [d(".git", true), d("node_modules", true), d("src"), f("README.md"), f("big.log", 5 * 1024 * 1024), f("data.bin"), f("logo.png")],
  src: [d("src/util"), f("src/app.ts"), f("src/long.ts")],
  "src/util": [f("src/util/app.ts"), f("src/util/strings.ts")],
  ".git": [f(".git/HEAD")],
};
const READS: Record<string, FileRead> = {
  "README.md": { path: "README.md", size: 9, text: "# Atlas\n" },
  "src/app.ts": { path: "src/app.ts", size: APP_TS.length, text: APP_TS },
  "src/long.ts": { path: "src/long.ts", size: LONG.length, text: LONG },
  "src/util/strings.ts": { path: "src/util/strings.ts", size: 30, text: "export const s = 'strings';\n" },
  "src/util/app.ts": { path: "src/util/app.ts", size: 24, text: "export const util = 1;\n" },
  "big.log": { path: "big.log", size: 5 * 1024 * 1024, refused: "large" },
  "data.bin": { path: "data.bin", size: 4, refused: "binary" },
  "logo.png": { path: "logo.png", size: 2048, refused: "image", mime: "image/png" },
};
const ALL = ["README.md", "big.log", "data.bin", "logo.png", "src/app.ts", "src/long.ts", "src/util/app.ts", "src/util/strings.ts"];

type Asked = { path: string; query: Record<string, string> };

async function setUp(page: Page) {
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    lists: { settings: { integrations: { github: true, linear: false, typesafe: false } } },
  });
  const asked: Asked[] = [];
  // Registered after mockApi, so these answer first.
  await page.route("**/api/files/**", (route) => {
    const u = new URL(route.request().url());
    const query = Object.fromEntries(u.searchParams);
    asked.push({ path: u.pathname, query });
    const name = u.pathname.replace("/api/files/", "");
    if (query.workspace !== "wks_a") return route.fulfill({ status: 400, json: { error: "Unknown workspace" } });
    if (name === "tree") return route.fulfill({ json: { dir: query.dir ?? "", entries: TREE[query.dir ?? ""] ?? [] } });
    if (name === "read") {
      const r = READS[query.path!];
      return r ? route.fulfill({ json: r }) : route.fulfill({ status: 400, json: { error: "That file or folder isn't there any more." } });
    }
    if (name === "all") return route.fulfill({ json: { files: ALL, capped: false } });
    if (name === "changed") return route.fulfill({ json: { files: [{ path: "src/app.ts", change: "modified" }] } });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  await page.route("**/api/changes?**", (route) => route.fulfill({ json: { cwd: "/work/atlas/a", branch: "map-polish", baseRef: "main", mode: "all", files: [], tooLarge: false } }));
  return { asked };
}

const rows = (page: Page) =>
  page.locator(".files-view [role=treeitem]").evaluateAll((els) => els.map((e) => `${"  ".repeat(Number(e.getAttribute("aria-level")) - 1)}${e.querySelector(".fv-name")!.textContent}`));

test("Files: the tree, ignored files on request, a file highlighted, find, filter, quick-open and refusals", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  const { asked } = await setUp(page);
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();

    // ⌘K offers the tab (and its ⇧⌘E) while it isn't showing.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Show files");
    await palette.getByRole("option", { name: /Show files \(Map polish\)/ }).waitFor();
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });

    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    await view.getByRole("treeitem", { name: /README\.md/ }).waitFor();
    await view.locator(".fv-workspace", { hasText: "Map polish" }).waitFor();
    // Directories first; .git and node_modules (ignored) hidden.
    assert.deepEqual(await rows(page), ["src", "README.md", "big.log", "data.bin", "logo.png"]);
    assert.deepEqual(asked.find((a) => a.path === "/api/files/tree")!.query, { workspace: "wks_a" });

    // Shown on request, dimmed; hidden again.
    await view.getByRole("button", { name: "Show ignored files" }).click();
    await waitFor(() => rows(page), (r) => r[0] === ".git", "ignored entries shown");
    assert.ok(await view.locator(".fv-row.ignored", { hasText: "node_modules" }).isVisible());
    await view.getByRole("button", { name: "Hide ignored files" }).click();
    await waitFor(() => rows(page), (r) => r[0] === "src", "ignored entries hidden");

    // A folder opens (read then), its changed file dotted; the file opens highlighted.
    await view.getByRole("treeitem", { name: /^src/ }).click();
    await view.getByRole("treeitem", { name: /app\.ts/ }).waitFor();
    assert.deepEqual(await rows(page), ["src", "  util", "  app.ts", "  long.ts", "README.md", "big.log", "data.bin", "logo.png"]);
    assert.ok(asked.some((a) => a.path === "/api/files/tree" && a.query.dir === "src"));
    await view.locator(".fv-row", { hasText: "app.ts" }).locator(".fv-changed.modified").waitFor();
    await view.getByRole("treeitem", { name: /app\.ts/ }).click();
    const head = view.locator(".fv-head");
    await head.locator(".page-head-name", { hasText: "app.ts" }).waitFor();
    await head.locator(".page-crumb", { hasText: "src/" }).waitFor();
    await head.locator(".fv-meta", { hasText: "7 lines" }).waitFor();
    await head.getByRole("button", { name: "Show changes" }).waitFor();
    // Highlighted: the line's words in tokens of their own colours, with its line number.
    await waitFor(
      () =>
        view.locator("diffs-container").evaluate((host) => {
          const line = host.shadowRoot?.querySelector('[data-line="3"][data-line-type="context"]');
          const colours = new Set([...(line?.querySelectorAll("span") ?? [])].map((s) => getComputedStyle(s).color));
          return { text: line?.textContent ?? "", colours: colours.size, numbers: host.shadowRoot?.querySelectorAll("[data-column-number]").length ?? 0 };
        }),
      (r) => r.text.includes("export const answer = 42;") && r.colours >= 3 && r.numbers >= 7,
      "the file drawn highlighted with line numbers",
    );

    // ⌘F: find in the file.
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Meta+f");
    const find = view.getByRole("searchbox", { name: "Find in the file" });
    await find.waitFor();
    await find.fill("answer");
    const count = view.locator(".gd-find-count");
    await waitFor(() => count.textContent(), (t) => t === "1 of 3", "three matches");
    await page.keyboard.press("Enter");
    await waitFor(() => count.textContent(), (t) => t === "2 of 3", "the next");
    await page.keyboard.press("Escape");
    await find.waitFor({ state: "detached" });

    // A long file: the find scrolls it to a match far below, drawn by then.
    await view.getByRole("treeitem", { name: /long\.ts/ }).click();
    await head.locator(".fv-meta", { hasText: "3,000 lines" }).waitFor();
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Meta+f");
    await find.fill("needle");
    await waitFor(() => count.textContent(), (t) => t === "1 of 1", "the needle found");
    await waitFor(
      () =>
        view.locator("diffs-container").evaluate((host) => {
          const drawn = host.shadowRoot?.querySelectorAll("[data-line]").length ?? 0;
          const line = host.shadowRoot?.querySelector('[data-line="2701"]');
          const box = line?.getBoundingClientRect();
          const scroller = document.querySelector(".fv-scroll")!.getBoundingClientRect();
          return { drawn, shown: !!box && box.top >= scroller.top && box.bottom <= scroller.bottom };
        }),
      (r) => r.shown && r.drawn < 1500,
      "the match scrolled into view, only part of the file drawn",
    );
    await page.keyboard.press("Escape");

    // The filter: fuzzy over every path, its folders kept; Enter opens the best.
    const filter = view.getByRole("searchbox", { name: "Filter files" });
    await filter.click();
    await filter.fill("strs");
    await waitFor(() => rows(page), (r) => r.join("|") === "src|  util|    strings.ts", "the filter's tree");
    await view.locator(".fv-count", { hasText: "1 of 8" }).waitFor();
    await page.keyboard.press("Enter");
    await head.locator(".page-head-name", { hasText: "strings.ts" }).waitFor();
    await filter.focus();
    await page.keyboard.press("Escape");
    await waitFor(() => rows(page), (r) => r.includes("  util") && r.includes("    strings.ts"), "the tree back, the file's folders open");

    // ⌘P: any file by name.
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Meta+p");
    const quick = page.getByRole("dialog", { name: "Open a file" });
    await quick.getByRole("combobox", { name: "Find a file" }).fill("readme");
    await quick.getByRole("option", { name: /README\.md/ }).waitFor();
    await page.keyboard.press("Enter");
    await quick.waitFor({ state: "detached" });
    await head.locator(".page-head-name", { hasText: "README.md" }).waitFor();
    // Recently opened, while nothing's typed.
    await page.keyboard.press("Meta+p");
    assert.deepEqual(await quick.getByRole("option").allTextContents(), ["README.md", "strings.tssrc/util", "long.tssrc", "app.tssrc"]);
    await page.keyboard.press("Escape");
    await quick.waitFor({ state: "detached" });

    // Keys in the tree: ↓ and Enter open the next file.
    await view.getByRole("treeitem", { name: /README\.md/ }).click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    // Refused politely: too big, binary, an image.
    await view.getByText("This file is 5.0 MB, more than the 1.0 MB the viewer opens.").waitFor();
    await view.getByRole("treeitem", { name: /data\.bin/ }).click();
    await view.getByText("A binary file (4 B). Only text files are shown.").waitFor();
    await view.getByRole("treeitem", { name: /logo\.png/ }).click();
    await view.getByText("An image (2.0 KB). Images aren’t shown here.").waitFor();
    assert.equal(await view.locator("diffs-container").count(), 0);

    // ⌘S hides the sidebar, and brings it back.
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Meta+s");
    await view.locator(".fv-sidebar").waitFor({ state: "hidden" });
    // Its show button is first in the tab row, centred on it, left of Changes; the row keeps its height.
    const tabbar = view.locator(".fv-tabbar");
    const rowHeight = (await tabbar.boundingBox())!.height;
    const show = tabbar.getByRole("button", { name: "Show the Files sidebar" });
    const [row, btn, changesBtn] = await Promise.all([tabbar.boundingBox(), show.boundingBox(), tabbar.locator(".fv-changes-btn").boundingBox()]);
    assert.ok(Math.abs(btn!.y + btn!.height / 2 - (row!.y + row!.height / 2)) <= 1, "the show button centred in the tab row");
    assert.ok(btn!.x >= row!.x && btn!.x + btn!.width <= changesBtn!.x, "the show button left of Changes");
    assert.ok(btn!.height < row!.height, "the show button within the row");
    await show.click();
    await view.locator(".fv-sidebar").waitFor();
    assert.equal((await tabbar.boundingBox())!.height, rowHeight, "the row's height unchanged");

    // ⌘K, in the tab: its own entries.
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("files");
    for (const name of [/Go to file…/, /Show ignored files/, /Copy the file’s path/, /Refresh the files/]) await palette.getByRole("option", { name }).waitFor();
    await page.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});

test("Files: Show changes opens the Changes at the file, all changes; no workspace says so", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await setUp(page);
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    await view.getByText("Select a workspace (or one of its agents) on the map or in the panel to see its files.").waitFor();

    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await page.evaluate(() => {
      localStorage.setItem("paseo-command:files:workspaces", JSON.stringify({ "|wks_a": { open: ["src"], file: "src/app.ts" } }));
      localStorage.setItem("paseo-command:github:changesMode", '"uncommitted"');
    });
    await page.reload();
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    // The workspace's folders and file as left.
    await view.locator(".fv-head .page-head-name", { hasText: "app.ts" }).waitFor();
    await view.getByRole("treeitem", { name: /app\.ts/ }).waitFor();
    // Show changes: Changes in the tabs' place, all changes; the file's tab stays.
    await view.getByRole("button", { name: "Show changes" }).click();
    await view.locator(".fv-changes-btn[aria-pressed=true]").waitFor();
    await view.locator(".gh-branches", { hasText: "map-polish" }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("paseo-command:github:changesMode")), '"all"');
    assert.equal(await view.getByRole("radio", { name: "All changes" }).getAttribute("aria-checked"), "true");
    await view.locator(".fv-tab", { hasText: "app.ts" }).waitFor();
  } finally {
    await context.close();
  }
});

const tabs = (page: Page) =>
  page.locator(".fv-tabs [role=tab]").evaluateAll((els) =>
    els.map((e) => {
      const dir = e.querySelector(".fv-tab-dir")?.textContent;
      return `${e.getAttribute("aria-selected") === "true" ? ">" : ""}${e.querySelector(".fv-tab-name")!.textContent}${dir ? ` (${dir})` : ""}${e.classList.contains("preview") ? "*" : ""}`;
    }),
  );
const kept = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("paseo-command:files:workspaces") ?? "{}")["|wks_a"]);

test("Files: tabs (a preview, kept ones), ⌘W / ⌃W, ⇧⌘T, ⌃Tab and ⌥⌘→, middle-click, drag, each tab's scroll, per workspace", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await setUp(page);
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    const head = view.locator(".fv-head");
    const item = (name: RegExp) => view.getByRole("treeitem", { name });
    const tab = (name: string) => view.locator(".fv-tabs [role=tab]", { has: page.locator(".fv-tab-name", { hasText: new RegExp(`^${name.replace(".", "\\.")}$`) }) });
    await view.getByText("Choose a file in the tree, or press ⌘P to open one by name.").waitFor();
    assert.equal(await view.locator(".fv-tabs").count(), 0, "no tabs yet");

    // A click opens a preview (italic), the next click's file takes its place.
    await item(/^src/).click();
    await item(/app\.ts/).first().click();
    await waitFor(() => tabs(page), (t) => t.join("|") === ">app.ts*", "a preview tab");
    assert.equal(await tab("app.ts").locator(".fv-tab-name").evaluate((e) => getComputedStyle(e).fontStyle), "italic");
    await tab("app.ts").locator(".fv-changed.modified").waitFor();
    await item(/long\.ts/).click();
    await waitFor(() => tabs(page), (t) => t.join("|") === ">long.ts*", "the preview replaced");
    // Double-clicking its tab keeps it; the next file opens beside it.
    await tab("long.ts").dblclick();
    await waitFor(() => tabs(page), (t) => t.join("|") === ">long.ts", "kept");
    await item(/README\.md/).click();
    await waitFor(() => tabs(page), (t) => t.join("|") === "long.ts|>README.md*", "a preview beside it");
    // Double-click in the tree keeps it too; same-named files show their folders.
    await item(/^util/).click();
    await view.locator(".fv-row", { hasText: "strings.ts" }).waitFor();
    await view.locator(".fv-row[aria-level='2']", { hasText: "app.ts" }).dblclick();
    await waitFor(() => tabs(page), (t) => t.join("|") === "long.ts|>app.ts", "the preview replaced, then kept");
    await view.locator(".fv-row[aria-level='3']", { hasText: "app.ts" }).dblclick();
    await waitFor(() => tabs(page), (t) => t.join("|") === "long.ts|app.ts (src)|>app.ts (util)", "folders tell them apart");
    await head.locator(".page-crumb", { hasText: "src/util/" }).waitFor();

    // Using a preview keeps it: a wheel over the file.
    await item(/strings\.ts/).click();
    await waitFor(() => tabs(page), (t) => t.at(-1) === ">strings.ts*", "a preview");
    await view.locator("diffs-container").waitFor();
    await view.locator(".fv-scroll").hover();
    await page.mouse.wheel(0, 40);
    await waitFor(() => tabs(page), (t) => t.at(-1) === ">strings.ts", "kept once scrolled");

    // Each tab's scroll: kept, and put back when it shows again.
    await tab("long.ts").click();
    await head.locator(".fv-meta", { hasText: "3,000 lines" }).waitFor();
    await view.locator("diffs-container").waitFor();
    await view.locator(".fv-scroll").evaluate((el) => (el.scrollTop = 20000));
    await waitFor(() => kept(page), (k) => Math.abs(k?.tabs?.find((t: { path: string }) => t.path === "src/long.ts")?.scroll - 20000) <= 40, "the scroll kept");
    await tab("strings.ts").click();
    await head.locator(".page-head-name", { hasText: "strings.ts" }).waitFor();
    await tab("long.ts").click();
    await waitFor(() => view.locator(".fv-scroll").evaluate((el) => Math.round(el.scrollTop)), (t) => Math.abs(t - 20000) <= 40, "the scroll put back");

    // ⌃Tab / ⌃⇧Tab and ⌥⌘→ / ⌥⌘← step, wrapping.
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Control+Tab");
    await waitFor(() => tabs(page), (t) => t[1] === ">app.ts (src)", "the next tab");
    await page.keyboard.press("Control+Shift+Tab");
    await page.keyboard.press("Control+Shift+Tab");
    await waitFor(() => tabs(page), (t) => t[3] === ">strings.ts", "wrapped to the last");
    await page.keyboard.press("Meta+Alt+ArrowRight");
    await waitFor(() => tabs(page), (t) => t[0] === ">long.ts", "wrapped to the first");
    await page.keyboard.press("Meta+Alt+ArrowLeft");
    await waitFor(() => tabs(page), (t) => t[3] === ">strings.ts", "back");

    // ⌘W closes the shown tab (the one to its left shows); ⌃W too; ⇧⌘T brings them back, last closed first.
    await page.keyboard.press("Meta+w");
    await waitFor(() => tabs(page), (t) => t.join("|") === "long.ts|app.ts (src)|>app.ts (util)", "closed");
    await page.keyboard.press("Control+w");
    await waitFor(() => tabs(page), (t) => t.join("|") === "long.ts|>app.ts", "closed again; no clash left");
    await page.keyboard.press("Meta+Shift+t");
    await waitFor(() => tabs(page), (t) => t.join("|") === "long.ts|app.ts (src)|>app.ts (util)", "reopened");
    // A middle-click closes; the × too.
    await tab("long.ts").click({ button: "middle" });
    await waitFor(() => tabs(page), (t) => t.join("|") === "app.ts (src)|>app.ts (util)", "middle-click closed it");
    await view.getByRole("button", { name: "Close app.ts" }).first().click();
    await waitFor(() => tabs(page), (t) => t.join("|") === ">app.ts", "× closed it");
    await page.keyboard.press("Meta+Shift+t");
    await page.keyboard.press("Meta+Shift+t");
    await waitFor(() => tabs(page), (t) => t.length === 3 && t.includes(">long.ts"), "both back");

    // Dragging reorders: the first onto the last's far half goes to the end.
    const before = await tabs(page);
    const strip = view.locator(".fv-tabs [role=tab]");
    const lastBox = (await strip.nth(2).boundingBox())!;
    await strip.nth(0).dragTo(strip.nth(2), { targetPosition: { x: lastBox.width - 6, y: lastBox.height / 2 } });
    await waitFor(() => tabs(page), (t) => t.join("|") === [before[1], before[2], before[0]].join("|"), "moved to the end");

    // ⌘K has the tabs' commands.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    const search = palette.getByRole("combobox", { name: "Search commands" });
    await search.fill("tab");
    for (const name of [/Close the file’s tab/, /Reopen the closed tab/, /Next tab/, /Previous tab/, /Close other tabs/]) await palette.getByRole("option", { name }).waitFor();
    await search.fill("close other tabs");
    await palette.getByRole("option", { name: /Close other tabs/ }).click();
    await waitFor(() => tabs(page), (t) => t.join("|") === ">long.ts", "only the shown tab left");

    // Per workspace, across a reload: the tabs, the shown one and its scroll.
    await item(/README\.md/).dblclick();
    await tab("long.ts").click();
    await view.locator("diffs-container").waitFor();
    await view.locator(".fv-scroll").evaluate((el) => (el.scrollTop = 12000));
    await waitFor(() => kept(page), (k) => Math.abs(k?.tabs?.find((t: { path: string }) => t.path === "src/long.ts")?.scroll - 12000) <= 40, "kept");
    await page.reload();
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    await waitFor(() => tabs(page), (t) => t.join("|") === ">long.ts|README.md", "the tabs back");
    await waitFor(() => view.locator(".fv-scroll").evaluate((el) => Math.round(el.scrollTop)), (t) => Math.abs(t - 12000) <= 40, "its scroll back");
    // Kept under the host and workspace (another workspace's own are the unit tests').
    assert.deepEqual(Object.keys(await page.evaluate(() => JSON.parse(localStorage.getItem("paseo-command:files:workspaces")!))), ["|wks_a"]);

    // ⌘W until none is left; then it does nothing (the page stays).
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Meta+w");
    await waitFor(() => tabs(page), (t) => t.join("|") === ">README.md", "one closed");
    await page.keyboard.press("Meta+w");
    await waitFor(() => view.locator(".fv-tabs").count(), (n) => n === 0, "all closed");
    await page.keyboard.press("Meta+w");
    await view.getByText("Choose a file in the tree, or press ⌘P to open one by name.").waitFor();
  } finally {
    await context.close();
  }
});

// A Markdown file as the user's report was: headings, prose, lists, a table, code, HTML, images and links.
const WIDE = "A long line that runs well past the viewer's width, ".repeat(12).trim();
const GUIDE = [
  "# Atlas guide",
  "",
  "Some **bold words**, a [link to the app](../src/app.ts#L3), a [section link](#long-lines), a [wide line](wide.md#L30),",
  "a [web link](https://example.com/page), a [folder](../src/), a [script](javascript:alert(1)) and a <kbd>⌘K</kbd> key.",
  "",
  "- [x] done item",
  "- [ ] open item",
  "",
  "| Name | Value |",
  "| --- | --- |",
  "| alpha | 1 |",
  "",
  "> A quote, rendered.",
  "",
  "```ts",
  `const answer = 42; // ${WIDE}`,
  "```",
  "",
  ...Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} keeps the next heading below the view.\n`),
  "## Long lines",
  "",
  WIDE,
  "",
  "<details><summary>More</summary>",
  "",
  "Hidden needle text.",
  "",
  "</details>",
  "",
  '<p align="center"><img src="shot.png" alt="Shot"></p>',
  "",
  "![Remote](https://images.example.com/a.png) ![Plain](http://images.example.com/b.png) ![Vector](icon.svg)",
  "",
  '<script>window.ran = 1</script><img src="x.png" onerror="window.ran = 2"><iframe src="https://example.com"></iframe>',
  "",
  ...Array.from({ length: 30 }, (_, i) => `Closing paragraph ${i + 1}, so the heading can scroll to the top.\n`),
].join("\n");
const WIDE_MD = Array.from({ length: 60 }, (_, i) => (i === 29 ? `Line 30: ${WIDE}` : `Line ${i + 1}: ${WIDE}`)).join("\n");
// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** The Markdown files and their images, ahead of `setUp`'s answers. */
async function withMarkdown(page: Page) {
  const images: string[] = [];
  await page.route("**/api/files/**", (route) => {
    const u = new URL(route.request().url());
    const q = Object.fromEntries(u.searchParams);
    const name = u.pathname.replace("/api/files/", "");
    if (name === "tree" && !q.dir) return route.fulfill({ json: { dir: "", entries: [d("docs"), ...TREE[""]!] } });
    if (name === "tree" && q.dir === "docs") return route.fulfill({ json: { dir: "docs", entries: [f("docs/guide.md"), f("docs/shot.png"), f("docs/wide.md")] } });
    if (name === "read" && q.path === "docs/guide.md") return route.fulfill({ json: { path: q.path, size: GUIDE.length, text: GUIDE } });
    if (name === "read" && q.path === "docs/wide.md") return route.fulfill({ json: { path: q.path, size: WIDE_MD.length, text: WIDE_MD } });
    if (name === "image") {
      images.push(q.path!);
      return q.path === "docs/shot.png" ? route.fulfill({ body: PNG, contentType: "image/png" }) : route.fulfill({ status: 400, json: { error: "Not an image" } });
    }
    if (name === "all") return route.fulfill({ json: { files: ["docs/guide.md", "docs/shot.png", "docs/wide.md", ...ALL], capped: false } });
    return route.fallback();
  });
  // The https image, answered here: nothing leaves the browser.
  await page.route("https://images.example.com/**", (route) => route.fulfill({ body: PNG, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }));
  return { images };
}

/** The open file's lines: whether any runs past the viewer's width, and line `n`'s number beside its first row. */
const sourceLayout = (page: Page, n: number) =>
  page.locator(".files-view diffs-container").evaluate((host, n) => {
    const root = host.shadowRoot!;
    const pre = root.querySelector("pre")!;
    const line = root.querySelector<HTMLElement>(`[data-line="${n}"][data-line-type]`);
    const number = root.querySelector<HTMLElement>(`[data-column-number="${n}"]`);
    const lr = line?.getBoundingClientRect();
    const nr = number?.getBoundingClientRect();
    return {
      overflows: [...root.querySelectorAll("code")].some((c) => c.scrollWidth > c.clientWidth + 1) || pre.scrollWidth > pre.clientWidth + 1,
      rows: lr && line ? Math.round(lr.height / (parseFloat(getComputedStyle(line).lineHeight) || 20)) : 0,
      // Its number on the first row: at the line's top, one row high.
      numberAtTop: !!lr && !!nr && !!number && Math.abs(nr.top - lr.top) <= 2 && number.textContent!.trim() === String(n),
    };
  }, n);

test("Files: Markdown renders (links, images, HTML kept safe), Preview / Source kept per type, find in the preview; lines wrap", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });
  const { asked } = await setUp(page);
  const { images } = await withMarkdown(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    const head = view.locator(".fv-head");
    const item = (name: RegExp) => view.getByRole("treeitem", { name });
    await item(/^docs/).click();
    await item(/guide\.md/).click();

    // Rendered: headings, a list's tasks, a table, a quote, code highlighted, the HTML that's allowed.
    const md = view.locator("article.fv-md");
    await md.locator("h1", { hasText: "Atlas guide" }).waitFor();
    assert.equal(await md.locator("h2").getAttribute("data-anchor"), "long-lines");
    assert.equal(await md.locator("input.md-task").count(), 2);
    assert.equal(await md.locator("table td", { hasText: "alpha" }).count(), 1);
    await md.locator("blockquote", { hasText: "A quote, rendered." }).waitFor();
    assert.ok((await md.locator(".md-code code span[class^=tok-]").count()) >= 2, "the code block highlighted");
    assert.equal(await md.locator("kbd").textContent(), "⌘K");
    await md.locator("details summary", { hasText: "More" }).waitFor();
    assert.equal(await md.locator("p[align=center]").count(), 1);
    // Never a script, a handler, a frame; a javascript: link stays text.
    assert.equal(await md.locator("script, iframe, [onerror]").count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as { ran?: number }).ran), undefined);
    assert.equal(await md.locator(".md-link-text", { hasText: "script" }).count(), 1);
    // Images (each asked for once near the view): the workspace's through the image route, https loaded, http and SVG blocked.
    assert.deepEqual(images, []);
    await md.locator("p[align=center]").scrollIntoViewIfNeeded();
    await waitFor(() => md.locator("img.fv-md-image").count(), (n) => n === 2, "the workspace's and the https image");
    assert.equal(await md.locator("img.fv-md-image").first().getAttribute("alt"), "Shot");
    assert.ok(images.includes("docs/shot.png"));
    assert.ok(!images.some((p) => p.endsWith(".svg")), "an SVG is never asked for");
    assert.deepEqual(await md.locator(".fv-md-image-off .md-image-name").allTextContents(), ["Plain", "Vector", "x.png"]);
    assert.ok((await head.getByRole("button", { name: "Preview", exact: true }).getAttribute("aria-pressed")) === "true");

    // Wrapped (the default): nothing runs past the column, the code block's line included.
    const overflow = () =>
      md.evaluate((a) => {
        const scroller = a.parentElement!;
        const pre = a.querySelector(".md-code pre")!;
        return { page: scroller.scrollWidth > scroller.clientWidth + 1, code: pre.scrollWidth > pre.clientWidth + 1 };
      });
    assert.deepEqual(await overflow(), { page: false, code: false });
    await md.evaluate((a) => a.parentElement!.scrollTo(0, 0));
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: `/tmp/files-markdown-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: "dark" });

    // Find in the rendered text: across a bold run, and inside a closed <details> (opened).
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Meta+f");
    const find = view.getByRole("searchbox", { name: "Find in the preview" });
    await find.fill("bold words");
    const count = view.locator(".gd-find-count");
    await waitFor(() => count.textContent(), (t) => t === "1 of 1", "a match across the bold run");
    await find.fill("keeps the next");
    await waitFor(() => count.textContent(), (t) => !!t?.endsWith(" of 40"), "one in each paragraph");
    await find.fill("needle");
    await waitFor(() => count.textContent(), (t) => t === "1 of 1", "the hidden needle");
    await waitFor(() => md.locator("details[open]").count(), (n) => n === 1, "its <details> opened");
    const marks = await page.evaluate(() => {
      const h = (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights;
      return { all: h?.get("gd-find")?.size ?? -1, current: h?.get("gd-find-current")?.size ?? -1 };
    });
    assert.deepEqual(marks, { all: 0, current: 1 });
    await page.screenshot({ path: "/tmp/files-markdown-find.png" });
    await page.keyboard.press("Escape");
    await find.waitFor({ state: "detached" });

    // A heading's anchor scrolls to it; a folder opens in the tree.
    await md.locator("h2").evaluate((h) => h.closest(".fv-md-scroll")!.scrollTo(0, 0));
    await md.getByRole("link", { name: "section link" }).click();
    await waitFor(
      () => md.locator("h2").evaluate((h) => Math.round(h.getBoundingClientRect().top - h.closest(".fv-md-scroll")!.getBoundingClientRect().top)),
      (top) => top >= 0 && top < 40,
      "the heading at the top",
    );
    // Web links open as links do (a browser tab here).
    const popup = context.waitForEvent("page");
    await md.getByRole("link", { name: "web link" }).click();
    const opened = await popup;
    assert.equal(opened.url(), "https://example.com/page");
    await opened.close();

    // Source: the file's text, wrapped; kept for every .md, so README.md opens as source too.
    await head.getByRole("button", { name: "Source", exact: true }).click();
    await view.locator("diffs-container").waitFor();
    assert.equal(await md.count(), 0);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("paseo-command:files:markdownView") ?? "null")), { md: "source" });
    await item(/README\.md/).click();
    await head.locator(".page-head-name", { hasText: "README.md" }).waitFor();
    await view.locator("diffs-container").waitFor();
    assert.equal(await head.getByRole("button", { name: "Source", exact: true }).getAttribute("aria-pressed"), "true");
    // ⌘K offers the other view, and wrapping.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("preview");
    await palette.getByRole("option", { name: /Show the preview/ }).click();
    await palette.waitFor({ state: "detached" });
    await view.locator("article.fv-md h1", { hasText: "Atlas" }).waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("paseo-command:files:markdownView") ?? "null")), {});

    // An in-repo link opens the file as a kept tab, at its line, marked.
    await item(/guide\.md/).click();
    await md.getByRole("link", { name: "link to the app" }).click();
    await head.locator(".page-head-name", { hasText: "app.ts" }).waitFor();
    assert.match((await view.locator(".fv-tab.active").getAttribute("class")) ?? "", /^(?!.*preview)/, "a kept tab");
    await waitFor(
      () => page.evaluate(() => (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights?.get("gd-find")?.size ?? 0),
      (n) => n === 1,
      "line 3 marked",
    );

    // A Markdown file opened at a line shows its source there, the line in view though the lines above it wrap.
    await item(/guide\.md/).click();
    await md.getByRole("link", { name: "wide line" }).click();
    await head.locator(".page-head-name", { hasText: "wide.md" }).waitFor();
    assert.equal(await head.getByRole("button", { name: "Source", exact: true }).getAttribute("aria-pressed"), "true");
    await waitFor(
      () =>
        page.evaluate(() => {
          const scroller = document.querySelector(".files-view .gd-scroll")!.getBoundingClientRect();
          const line = document.querySelector(".files-view diffs-container")?.shadowRoot?.querySelector('[data-line="30"][data-line-type]');
          const r = line?.getBoundingClientRect();
          return !!r && r.top >= scroller.top && r.bottom <= scroller.bottom && line!.textContent!.startsWith("Line 30:");
        }),
      (shown) => shown,
      "line 30 in view",
    );
    // Wrapped: no line runs off the right; a wrapped line takes rows, its number on the first.
    const wrapped = await waitFor(() => sourceLayout(page, 30), (r) => r.rows >= 2, "line 30 wrapped");
    assert.deepEqual({ overflows: wrapped.overflows, numberAtTop: wrapped.numberAtTop }, { overflows: false, numberAtTop: true });
    await page.screenshot({ path: "/tmp/files-wrap-on.png" });
    // Wrap off (the head's toggle, kept): the lines run on, scrolling sideways.
    await head.getByRole("button", { name: "Wrap lines" }).click();
    await waitFor(() => sourceLayout(page, 30), (r) => r.overflows && r.rows === 1, "lines unwrapped");
    assert.equal(await page.evaluate(() => localStorage.getItem("paseo-command:files:wrap")), "false");
    await page.screenshot({ path: "/tmp/files-wrap-off.png" });
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("wrap");
    await palette.getByRole("option", { name: /^Wrap lines/ }).click();
    await waitFor(() => sourceLayout(page, 30), (r) => !r.overflows && r.rows >= 2, "wrapped again");
    // Find still lands on its line in wrapped text.
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Meta+f");
    await view.getByRole("searchbox", { name: "Find in the file" }).fill("Line 55:");
    await waitFor(
      () =>
        page.evaluate(() => {
          const scroller = document.querySelector(".files-view .gd-scroll")!.getBoundingClientRect();
          const line = document.querySelector(".files-view diffs-container")?.shadowRoot?.querySelector('[data-line="55"][data-line-type]');
          const r = line?.getBoundingClientRect();
          return !!r && r.top >= scroller.top && r.top <= scroller.bottom;
        }),
      (shown) => shown,
      "line 55 in view",
    );
    assert.ok(asked.length > 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("Files: ⌘R refreshes the tree and the open file (not every file read), without reloading the page", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  const { asked } = await setUp(page);
  const fresh = (name: string, extra: (q: Record<string, string>) => boolean = () => true) =>
    asked.filter((a) => a.path === `/api/files/${name}` && a.query.fresh === "1" && extra(a.query)).length;
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    await view.getByRole("treeitem", { name: /^src/ }).click();
    await view.getByRole("treeitem", { name: /README\.md/ }).click();
    await view.locator(".fv-head .page-head-name", { hasText: "README.md" }).waitFor();
    await view.getByRole("treeitem", { name: /app\.ts/ }).dblclick();
    await view.locator(".fv-head .page-head-name", { hasText: "app.ts" }).waitFor();
    await page.evaluate(() => ((window as unknown as { kept: number }).kept = 1));

    await page.keyboard.press("Meta+r");
    await waitFor(() => fresh("tree"), (n) => n === 2, "the root and src asked fresh");
    await waitFor(() => fresh("read", (q) => q.path === "src/app.ts"), (n) => n === 1, "the open file asked fresh");
    await waitFor(() => fresh("changed") + fresh("all"), (n) => n === 2, "the changed files and the list");
    assert.equal(fresh("read", (q) => q.path === "README.md"), 0, "a file not shown isn't asked again");
    // The macOS app's View → Refresh Page.
    await page.waitForTimeout(100);
    await appEvent(page, "paseo:command", "page-refresh");
    await waitFor(() => fresh("read", (q) => q.path === "src/app.ts"), (n) => n === 2, "the app's Refresh Page");
    assert.equal(await page.evaluate(() => (window as unknown as { kept?: number }).kept), 1, "the page never reloaded");
    assert.deepEqual(await rows(page), ["src", "  util", "  app.ts", "  long.ts", "README.md", "big.log", "data.bin", "logo.png"], "the tree stays open");
  } finally {
    await context.close();
  }
});
