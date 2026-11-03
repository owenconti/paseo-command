/**
 * A workspace's Changes, in the Files tab (the macOS app's mode bar shows it in
 * the map's place): the branch against main, all, committed or uncommitted; ⇧⌘G
 * from anywhere; the diff's file list, filter and find; its place kept through
 * refreshes; Files and Changes opening each other; Review #N only while GitHub is
 * on; an old GitHub place for the changes sent here. `/api/changes`, `/api/files/…`
 * and `/api/github/…` are answered in the browser; nothing reaches GitHub or a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { DiffFile, WorkspaceChanges } from "../src/github/types";
import type { FileEntry } from "../src/files/types";
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

const file = (path: string): DiffFile => ({
  path,
  isNew: false,
  isDeleted: false,
  additions: 2,
  deletions: 1,
  hunks: [
    {
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 4,
      lines: [
        { type: "header", content: "@@ -1,3 +1,4 @@" },
        { type: "context", content: "const a = 1;" },
        { type: "remove", content: "const b = 2;" },
        { type: "add", content: "const b = 3;" },
        { type: "add", content: "const c = 4;" },
        { type: "context", content: "export { a };" },
      ],
    },
  ],
});

const CHANGES = (mode: string): WorkspaceChanges => ({
  cwd: "/work/atlas/a",
  branch: "map-polish",
  baseRef: "main",
  mode: mode as WorkspaceChanges["mode"],
  files: mode === "base" ? [file("src/committed.ts")] : [file("src/committed.ts"), file("src/working.ts")],
  tooLarge: false,
  ahead: 2,
  behind: 0,
  dirty: true,
  repo: "acme/atlas",
  pr: { number: 7, url: "https://github.com/acme/atlas/pull/7", title: "Map polish", state: "open", repo: "acme/atlas" },
});

const f = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, kind: "file", size: 40 });
const TREE: Record<string, FileEntry[]> = {
  "": [{ name: "src", path: "src", kind: "directory", size: 0 }, f("README.md")],
  src: [f("src/committed.ts"), f("src/working.ts")],
};

type Asked = { path: string; query: Record<string, string> };

async function setUp(page: Page, opts: { github?: boolean } = {}) {
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    lists: { settings: { integrations: { github: opts.github ?? true, linear: false, typesafe: false } } },
  });
  const asked: Asked[] = [];
  // Registered after mockApi, so these answer first.
  await page.route("**/api/files/**", (route) => {
    const u = new URL(route.request().url());
    const query = Object.fromEntries(u.searchParams);
    const name = u.pathname.replace("/api/files/", "");
    if (name === "tree") return route.fulfill({ json: { dir: query.dir ?? "", entries: TREE[query.dir ?? ""] ?? [] } });
    if (name === "read") return route.fulfill({ json: { path: query.path, size: 20, text: `// ${query.path}\nexport {};\n` } });
    if (name === "all") return route.fulfill({ json: { files: ["README.md", "src/committed.ts", "src/working.ts"], capped: false } });
    if (name === "changed")
      return route.fulfill({ json: { files: [{ path: "src/committed.ts", change: "modified" }, { path: "src/working.ts", change: "modified" }] } });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  // The GitHub tab's own reads (it shows only to redirect here): none answered, nothing asked of GitHub.
  await page.route("**/api/github/**", (route) => route.fulfill({ status: 404, json: { error: "not mocked" } }));
  await page.route("**/api/changes?**", (route) => {
    const u = new URL(route.request().url());
    asked.push({ path: u.pathname, query: Object.fromEntries(u.searchParams) });
    return route.fulfill({ json: CHANGES(u.searchParams.get("mode") ?? "all") });
  });
  return { asked };
}

/** The Files tab, its Changes shown by their button (kept per workspace, so perhaps already). */
async function showChanges(page: Page) {
  await appEvent(page, "paseo:mode", { mode: "files" });
  const view = page.locator(".files-view");
  const button = view.locator(".fv-changes-btn");
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await view.locator(".fv-changes-btn[aria-pressed=true]").waitFor();
  return view;
}

/** The macOS app's channel: what the page sends it is kept in `sentToApp`. */
const asMacApp = (page: Page) =>
  page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(m) } } };
  `);
const menusAsked = (page: Page, action: string) =>
  page.evaluate(
    (a) => (window as unknown as { sentToApp: { type: string; action?: string }[] }).sentToApp.filter((m) => m.type === "menu" && m.action === a).length,
    action,
  );

test("Files' Changes show the selected workspace's branch against main, all or committed", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { asked } = await setUp(page);
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();

    const view = await showChanges(page);
    // The button counts the changed files and is pressed while Changes show.
    await view.locator(".fv-changes-btn[aria-pressed=true] .fv-changes-count", { hasText: "2" }).waitFor();
    await view.locator(".gd-file").nth(1).waitFor();
    const last = () => asked.filter((a) => a.path === "/api/changes").at(-1)!;
    assert.deepEqual(last().query, { workspace: "wks_a", mode: "all" });
    assert.deepEqual(
      await view.locator(".gd-file").evaluateAll((s) => s.map((e) => (e as HTMLElement).dataset.path)),
      ["src/committed.ts", "src/working.ts"],
    );
    await view.locator(".gh-branches", { hasText: "map-polish" }).waitFor();

    // M: committed only.
    await view.locator(".gh-head h2").click();
    await page.keyboard.press("m");
    await waitFor(() => view.locator(".gd-file").count(), (n) => n === 1, "only what's committed");
    assert.equal(last().query.mode, "base");
    assert.equal(await view.getByRole("radio", { name: "Committed", exact: true }).getAttribute("aria-checked"), "true");
    // ⌘K: the other modes, and the diff's commands, under Files.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Show uncommitted changes");
    await palette.getByRole("option", { name: /Show uncommitted changes.*Files/ }).click();
    await waitFor(() => Promise.resolve(last().query.mode), (m) => m === "uncommitted", "uncommitted from ⌘K");
  } finally {
    await context.close();
  }
});

test("⇧⌘G shows the selected workspace's (or agent's) branch changes, else says why", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  // The macOS app's channel: its View → Show Branch Changes (⇧⌘G) sends the page `branch-changes`.
  await asMacApp(page);
  const { asked } = await setUp(page);
  const filesAsked = () => menusAsked(page, "files");
  const toast = page.locator(".toast[role=status]");
  try {
    // Nothing selected: a notice, and the tab isn't asked for.
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await appEvent(page, "paseo:command", "branch-changes");
    await toast.filter({ hasText: "Select a workspace or agent to see its branch's changes." }).waitFor();
    assert.equal(await filesAsked(), 0);

    // An agent selected: its workspace's changes, the Files tab asked for (no GitHub needed).
    await page.goto(`${app.url}?agent=a-running`);
    await page.locator(".session").waitFor();
    // In the app the menu takes the key, so the page leaves ⇧⌘G alone.
    await page.keyboard.press("Meta+Shift+g");
    assert.equal(await filesAsked(), 0);
    await appEvent(page, "paseo:command", "branch-changes");
    await waitFor(filesAsked, (n) => n === 1, "the Files tab asked for");
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    await view.locator(".gh-branches", { hasText: "map-polish" }).waitFor();
    assert.equal(await view.locator(".fv-changes-btn").getAttribute("aria-pressed"), "true");
    assert.equal(asked.filter((a) => a.path === "/api/changes").at(-1)?.query.workspace, "wks_a");

    // ⌘K's entry names the key.
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("changes against main");
    const entry = palette.getByRole("option", { name: /Show Map polish’s changes against main/ });
    assert.match(await entry.locator(".palette-keys").innerText(), /⇧\s*⌘\s*G/);
    assert.match(await entry.innerText(), /Files/);
    await page.keyboard.press("Escape");
    // The workspace view's Changes button: the Files tab too.
    await page.locator(".place").getByRole("button", { name: "Changes", exact: true }).click();
    await waitFor(filesAsked, (n) => n === 1, "the Files tab asked for from the workspace");
    // The shortcuts dialog lists ⇧⌘G and the Changes' keys under Files, none under GitHub.
    await appEvent(page, "paseo:command", "show-shortcuts");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await dialog.getByText(/^From anywhere: the selected workspace's \(or agent's\) Changes/).waitFor();
    await dialog.getByText("In the Changes: all, committed or uncommitted", { exact: true }).waitFor();
    assert.equal(await dialog.getByText("A workspace's changes: all, committed or uncommitted").count(), 0);
  } finally {
    await context.close();
  }
});

test("In a browser the page takes ⇧⌘G itself: nothing selected or no Files tab each say so, GitHub on or off", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const toast = page.locator(".toast[role=status]");
  try {
    await setUp(page, { github: false });
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await page.keyboard.press("Meta+Shift+g");
    await toast.filter({ hasText: "The Files tab, with its Changes, is in the macOS app." }).waitFor();

    const on = await context.newPage();
    await setUp(on);
    await on.goto(app.url);
    await on.locator(".fleet-sidebar").waitFor();
    await on.keyboard.press("Meta+Shift+g");
    await on.locator(".toast[role=status]", { hasText: "Select a workspace or agent to see its branch's changes." }).waitFor();
    await on.goto(`${app.url}?workspace=wks_a`);
    await on.locator(".place").waitFor();
    await on.keyboard.press("Meta+Shift+g");
    await on.locator(".toast[role=status]", { hasText: "The Files tab, with its Changes, is in the macOS app." }).waitFor();
  } finally {
    await context.close();
  }
});

test("The diff's file list resizes by its edge (drag, keys, double-click), kept across reloads, and leaves the diff room", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setUp(page);
  try {
    const open = async () => {
      await page.goto(`${app.url}?workspace=wks_a`);
      await page.locator(".place").waitFor();
      await showChanges(page);
      await page.locator(".gd-file").nth(1).waitFor();
    };
    const width = (sel: string) =>
      page
        .locator(sel)
        .evaluate((e) => Math.round(e.getBoundingClientRect().width));
    await open();
    const edge = page.getByRole("separator", { name: "Resize the file list" });
    const start = await width(".gd-list-pane");
    // Drag it 120 px wider.
    const box = (await edge.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, {
      steps: 6,
    });
    await page.mouse.up();
    await waitFor(
      () => width(".gd-list-pane"),
      (w) => Math.abs(w - (start + 120)) <= 1,
      "the dragged width",
    );
    // ← narrows by 16, ⇧→ widens by 64.
    await edge.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowRight");
    const chosen = start + 120 - 16 + 64;
    await waitFor(
      () => width(".gd-list-pane"),
      (w) => Math.abs(w - chosen) <= 1,
      "the keyed width",
    );
    // Kept across a reload.
    await open();
    await waitFor(
      () => width(".gd-list-pane"),
      (w) => Math.abs(w - chosen) <= 1,
      "the kept width",
    );
    // A narrow window keeps the diff usable: the list gives way.
    await page.setViewportSize({ width: 1300, height: 800 });
    await waitFor(
      () => width(".gd-scroll-wrap"),
      (w) => w >= 419,
      "the diff's least width",
    );
    assert.ok((await width(".gd-list-pane")) < chosen, "the list gives way");
    // Too narrow for both, the list hides.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.locator(".gd-list-pane").waitFor({ state: "detached" });
    await page.setViewportSize({ width: 1600, height: 1000 });
    // Double-click restores the default.
    await edge.dblclick();
    await waitFor(
      () => width(".gd-list-pane"),
      (w) => Math.abs(w - start) <= 1,
      "the default width",
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("paseo-command:github:diffListWidth"),
      ),
      null,
    );
    // Long names show in full on hover.
    assert.equal(
      await page.locator(".gd-list-file").first().getAttribute("title"),
      "src/committed.ts",
    );
  } finally {
    await context.close();
  }
});

// A workspace's changes to search: small files, and one big enough to show folded with a match deep in it.
const lines = (path: string, contents: [DiffFile["hunks"][number]["lines"][number]["type"], string][]): DiffFile => ({
  path,
  isNew: false,
  isDeleted: false,
  additions: contents.filter(([t]) => t === "add").length,
  deletions: contents.filter(([t]) => t === "remove").length,
  hunks: [
    {
      oldStart: 1,
      oldCount: contents.filter(([t]) => t !== "add").length,
      newStart: 1,
      newCount: contents.filter(([t]) => t !== "remove").length,
      lines: [{ type: "header", content: "@@" }, ...contents.map(([type, content]) => ({ type, content }))],
    },
  ],
});
const SEARCHED: DiffFile[] = [
  lines("src/a.ts", [["context", "const needle = 1;"], ["add", "const hay = 2;"]]),
  lines("src/b.ts", [["remove", "export const Needle = 3;"], ["add", "export const pin = 3;"]]),
  lines("src/util/strings.ts", [["add", "export const trim = (s: string) => s.trim();"]]),
  lines("docs/readme.md", [["add", "# Read me"]]),
  lines(
    "web/big.json",
    Array.from({ length: 2000 }, (_, i) => ["add", i === 1700 ? '  "needle": true,' : `  "line${i}": ${i},`] as ["add", string]),
  ),
];

test("The diff's file filter narrows the list and jumps; ⌘F finds in every file's lines, a folded one too", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setUp(page);
  await page.route("**/api/changes?**", (route) => route.fulfill({ json: { ...CHANGES("all"), files: SEARCHED } }));
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    const view = await showChanges(page);
    await view.locator(".gd-file").nth(4).waitFor();
    assert.ok(await view.locator('.gd-file[data-path="web/big.json"]').evaluate((e) => e.classList.contains("folded")), "the big file shows folded");

    // T: the filter, fuzzy on paths; the tree narrows to what fits, its characters marked.
    await view.locator(".gd-file-head").first().click();
    await page.keyboard.press("t");
    const filter = view.locator(".gd-list-pane").getByRole("searchbox", { name: "Filter files" });
    await waitFor(() => filter.evaluate((e) => e === document.activeElement), Boolean, "the filter focused");
    await filter.fill("utilstr");
    await waitFor(() => view.locator(".gd-list-file").count(), (n) => n === 1, "one file fits");
    assert.equal(await view.locator(".gd-list-head").first().innerText(), "1 of 5");
    assert.equal(await view.locator(".gd-list-dir").innerText(), "src/util");
    assert.deepEqual(await view.locator(".gd-list mark").allTextContents(), ["util", "str"]);
    // Enter shows it in the diff.
    await page.keyboard.press("Enter");
    await view.locator(".gd-list-file.current", { hasText: "strings.ts" }).waitFor();
    // ↓/↑ pick among several; Esc clears.
    await filter.fill("ts");
    await waitFor(() => view.locator(".gd-list-file").count(), (n) => n === 3, "the .ts files");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await view.locator(".gd-list-file.picked.current").waitFor();
    await page.keyboard.press("Escape");
    await waitFor(() => view.locator(".gd-list-file").count(), (n) => n === 5, "every file again");
    assert.equal(await filter.inputValue(), "");

    // ⌘F: Find in the diff, over added, removed and unchanged lines, case-insensitive.
    await view.locator(".gd-file-head").first().click();
    await page.keyboard.press("Meta+f");
    const find = view.getByRole("searchbox", { name: "Find in the diff" });
    await waitFor(() => find.evaluate((e) => e === document.activeElement), Boolean, "the find field focused");
    await find.fill("needle");
    const count = view.locator(".gd-find-count");
    await waitFor(() => count.innerText(), (t) => t === "1 of 3", "three matches");
    const marks = () =>
      page.evaluate(() => {
        const reg = (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights;
        return [reg.get("gd-find")?.size ?? 0, reg.get("gd-find-current")?.size ?? 0];
      });
    // The two drawn (the third is folded): one current.
    await waitFor(marks, ([all, now]) => all === 1 && now === 1, "the marks");
    await page.keyboard.press("Enter");
    await waitFor(() => count.innerText(), (t) => t === "2 of 3", "the next");
    // The third is in the folded file: it unfolds, and the line is drawn in view.
    await page.keyboard.press("Enter");
    await waitFor(() => count.innerText(), (t) => t === "3 of 3", "the folded file's match");
    const big = view.locator('.gd-file[data-path="web/big.json"]');
    await waitFor(() => big.evaluate((e) => e.classList.contains("folded")), (f) => !f, "the big file unfolded");
    await waitFor(
      () =>
        big.evaluate((s) => {
          const root = s.querySelector("diffs-container")?.shadowRoot;
          const line = root?.querySelector<HTMLElement>('[data-line="1701"][data-line-type="change-addition"]');
          const box = line?.getBoundingClientRect();
          const scroller = document.querySelector(".gd-scroll")!.getBoundingClientRect();
          return !!box && box.top >= scroller.top && box.bottom <= scroller.bottom;
        }),
      Boolean,
      "the match's line drawn in view",
    );
    await waitFor(marks, ([, now]) => now === 1, "the folded file's match marked");
    // ⇧Enter and the bar's arrows step back; Enter wraps round.
    await page.keyboard.press("Shift+Enter");
    await waitFor(() => count.innerText(), (t) => t === "2 of 3", "back one");
    await view.getByRole("button", { name: "Next match" }).click();
    await page.keyboard.press("Enter");
    await waitFor(() => count.innerText(), (t) => t === "1 of 3", "round to the first");
    // Match case: only "needle" as typed.
    await view.getByRole("button", { name: "Match case" }).click();
    await waitFor(() => count.innerText(), (t) => t === "1 of 2", "two as typed");
    await find.fill("Needle");
    await waitFor(() => count.innerText(), (t) => t === "1 of 1", "one as typed");
    // A regular expression, when asked.
    await view.getByRole("button", { name: "Regular expression" }).click();
    await find.fill("[Nn]eedle|pin");
    await waitFor(() => count.innerText(), (t) => t.endsWith("of 4"), "the pattern's matches");
    await find.fill("(");
    await waitFor(() => count.innerText(), (t) => t === "Invalid pattern", "an invalid pattern");
    // Esc closes the bar and clears the marks.
    await find.fill("needle");
    await waitFor(() => count.innerText(), (t) => t.endsWith("of 2"), "matches again");
    await find.press("Escape");
    await view.locator(".gd-find").waitFor({ state: "detached" });
    assert.deepEqual(await marks(), [0, 0]);

    // ⌘K has both, while a diff shows.
    const palette = page.getByRole("dialog", { name: "Command palette" });
    for (const [label, field] of [["Find in the diff", find], ["Filter the diff’s files", filter]] as const) {
      await view.locator(".gd-file-head .gd-file-path").first().click();
      await page.keyboard.press("Meta+k");
      await palette.getByRole("combobox", { name: "Search commands" }).fill(label);
      await palette.getByRole("option", { name: new RegExp(`${label}.*Files`) }).click();
      await palette.waitFor({ state: "detached" });
      await waitFor(() => field.evaluate((e) => e === document.activeElement), Boolean, `${label} from ⌘K`);
    }
  } finally {
    await context.close();
  }
});

test("Files and Changes open each other: a changed file's dot, Show changes, a diff file's Open in Files; kept per workspace; no GitHub needed", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { asked } = await setUp(page, { github: false });
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await page.evaluate(() => localStorage.setItem("paseo-command:github:changesMode", '"base"'));
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    await view.getByRole("treeitem", { name: /^src/ }).click();
    // A changed file's dot: Changes, at that file, all changes.
    await view.getByRole("button", { name: "Modified: show its changes" }).nth(1).click();
    await view.locator(".fv-changes-btn[aria-pressed=true]").waitFor();
    await view.locator(".gd-list-file.current", { hasText: "working.ts" }).waitFor();
    assert.equal(asked.at(-1)?.query.mode, "all");
    // GitHub off: no Review #N, no Compare on GitHub.
    await view.locator(".gh-branches", { hasText: "map-polish" }).waitFor();
    assert.equal(await view.getByRole("button", { name: /Review #7/ }).count(), 0);
    assert.equal(await view.getByRole("button", { name: "Compare on GitHub" }).count(), 0);
    // A diff file's head opens it in Files, as a kept tab; Changes no longer pressed.
    await view.getByRole("button", { name: "Open src/committed.ts in Files" }).click();
    await view.locator(".fv-head .page-head-name", { hasText: "committed.ts" }).waitFor();
    assert.equal(await view.locator(".fv-changes-btn").getAttribute("aria-pressed"), "false");
    await view.locator(".fv-tab.active:not(.preview)", { hasText: "committed.ts" }).waitFor();
    // Its Show changes: Changes again, at it.
    await view.locator(".fv-head").getByRole("button", { name: "Show changes" }).click();
    await view.locator(".gd-list-file.current", { hasText: "committed.ts" }).waitFor();
    // The button again: back to the file.
    await view.locator(".fv-changes-btn").click();
    await view.locator(".fv-head .page-head-name", { hasText: "committed.ts" }).waitFor();
    // ⌃W (a browser's ⌘W) leaves Changes be: it closes only file tabs.
    await view.locator(".fv-changes-btn").click();
    await view.locator(".gh-branches").waitFor();
    await page.keyboard.press("Control+w");
    await view.locator(".fv-tab", { hasText: "committed.ts" }).waitFor();
    assert.equal(await view.locator(".fv-changes-btn").getAttribute("aria-pressed"), "true");
    // Kept per workspace, across a reload.
    await page.reload();
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    await view.locator(".fv-changes-btn[aria-pressed=true]").waitFor();
    await view.locator(".gh-branches", { hasText: "map-polish" }).waitFor();
  } finally {
    await context.close();
  }
});

test("With GitHub on, Changes' Review #N opens the PR in the GitHub tab; an old GitHub place for the changes opens Files' Changes", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await asMacApp(page);
  await setUp(page);
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    const view = await showChanges(page);
    await view.getByRole("button", { name: "Compare on GitHub" }).waitFor();
    await view.getByRole("button", { name: /Review #7/ }).click();
    await waitFor(() => menusAsked(page, "github"), (n) => n === 1, "the GitHub tab asked for");
    assert.deepEqual(JSON.parse((await page.evaluate(() => localStorage.getItem("paseo-command:github:place")))!), { kind: "pr", repo: "acme/atlas", number: 7, tab: "files" });

    // The GitHub tab once kept the changes as its place: shown, it sends them to Files.
    await page.evaluate(() => {
      localStorage.setItem("paseo-command:github:place", JSON.stringify({ kind: "changes", path: "src/working.ts" }));
      localStorage.setItem("paseo-command:files:workspaces", "{}");
    });
    await page.reload();
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "github" });
    await waitFor(() => menusAsked(page, "files"), (n) => n === 1, "the Files tab asked for");
    assert.deepEqual(JSON.parse((await page.evaluate(() => localStorage.getItem("paseo-command:github:place")))!), { kind: "prs", scope: "review" });
    await appEvent(page, "paseo:mode", { mode: "files" });
    await view.locator(".gd-list-file.current", { hasText: "working.ts" }).waitFor();
    assert.equal(await view.locator(".fv-changes-btn").getAttribute("aria-pressed"), "true");
  } finally {
    await context.close();
  }
});

// A long workspace diff whose lines wrap: many files, each with lines far wider than the column.
const WRAPPED: DiffFile[] = Array.from({ length: 30 }, (_, f) =>
  lines(
    `src/long/file${String(f).padStart(2, "0")}.ts`,
    Array.from({ length: 40 }, (_, i) => {
      const words = Array.from({ length: (i % 5) * 12 + 4 }, (_, w) => `word${f}_${i}_${w}`).join(" + ");
      return [i % 3 === 0 ? "context" : i % 3 === 1 ? "add" : "remove", `const v${i} = ${words};`] as ["add", string];
    }),
  ),
);
/** The same diff with its first three files grown by `more` lines each: changes above the middle. */
const grown = (more: number): DiffFile[] =>
  WRAPPED.map((f, i) => (i < 3 ? { ...f, hunks: [{ ...f.hunks[0]!, lines: [...f.hunks[0]!.lines, ...f.hunks[0]!.lines.slice(1, 1 + more)] }] } : f));

/** The first line drawn at or below the diff's top edge: its file, its index and its distance from that edge. */
const firstVisible = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(".gd-scroll")!;
    const top = scroller.getBoundingClientRect().top;
    for (const file of scroller.querySelectorAll<HTMLElement>(".gd-file")) {
      if (file.getBoundingClientRect().bottom <= top) continue;
      for (const line of file.querySelector("diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-line][data-line-index]") ?? []) {
        const at = line.getBoundingClientRect().top - top;
        if (at >= 0) return `${file.dataset.path} line ${line.dataset.lineIndex} at ${Math.round(at)}px`;
      }
    }
    return "none";
  });
/** Waits until the diff stops changing height (drawn, highlighted, measured). */
const settled = (page: Page) =>
  waitFor(
    async () => {
      const h = () => page.evaluate(() => document.querySelector<HTMLElement>(".gd-scroll")!.scrollHeight);
      const before = await h();
      await page.waitForTimeout(400);
      return before === (await h());
    },
    Boolean,
    "the diff settled",
  );

for (const layout of ["unified", "split"] as const)
  test(`A long ${layout} diff keeps its place through refreshes, highlighting and changes above the view`, async () => {
    const context = await newContext(browser);
    const page = await context.newPage();
    // The diff as wide as it was beside the GitHub tab's narrower sidebar.
    await page.setViewportSize({ width: 1500, height: 900 });
    await setUp(page);
    let files = WRAPPED;
    let served = 0;
    await page.route("**/api/changes?**", (route) => {
      served++;
      return route.fulfill({ json: { ...CHANGES("all"), files } });
    });
    try {
      await page.goto(`${app.url}?workspace=wks_a`);
      await page.locator(".place").waitFor();
      const view = await showChanges(page);
      await view.locator(".gd-file").nth(5).waitFor();
      if (layout === "split") await view.getByRole("radio", { name: "Split" }).click();
      await settled(page);
      // The middle of the diff, its lines drawn and highlighted (in the workers) there.
      await page.evaluate(() => {
        const s = document.querySelector<HTMLElement>(".gd-scroll")!;
        s.scrollTop = s.scrollHeight / 2;
      });
      await settled(page);
      const shown = await firstVisible(page);
      assert.notEqual(shown, "none");
      assert.doesNotMatch(shown, /file0[0-2]\.ts/, "the view is below the files that will change");
      const refresh = async () => {
        const was = served;
        await view.getByRole("button", { name: "Refresh", exact: true }).click();
        await waitFor(() => Promise.resolve(served), (n) => n > was, "the changes asked again");
        await settled(page);
      };
      // The same changes read again (as every 15 s): nothing moves.
      await refresh();
      assert.equal(await firstVisible(page), shown, "an unchanged refresh");
      await refresh();
      assert.equal(await firstVisible(page), shown, "another unchanged refresh");
      // Files above the view grow, then grow again: the view keeps its line.
      files = grown(6);
      await refresh();
      assert.equal(await firstVisible(page), shown, "files above grew");
      files = grown(2);
      await refresh();
      assert.equal(await firstVisible(page), shown, "files above shrank");
      // Any other height change above the view (a thread opening, say) doesn't move it either.
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('.gd-file[data-path="src/long/file01.ts"] .gd-file-head')!.style.paddingBottom = "300px";
      });
      await settled(page);
      assert.equal(await firstVisible(page), shown, "a header above grew");
      // Jumping to a file still goes there.
      await view.locator(".gd-list-file", { hasText: "file02.ts" }).click();
      await view.locator(".gd-list-file.current", { hasText: "file02.ts" }).waitFor();
      await settled(page);
      assert.match(await firstVisible(page), /file02\.ts/);
    } finally {
      await context.close();
    }
  });

