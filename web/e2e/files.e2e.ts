/**
 * The Files tab (the macOS app's mode bar shows it in the map's place): the
 * selected workspace's tree, read as folders open, ignored files hidden until
 * asked; the filter and ⌘P quick-open; a file opened highlighted, found in
 * with ⌘F; big, binary and image files refused politely; Show changes for a
 * changed file. `/api/files/…` is answered in the browser; nothing reaches a daemon.
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
  "src/util": [f("src/util/strings.ts")],
  ".git": [f(".git/HEAD")],
};
const READS: Record<string, FileRead> = {
  "README.md": { path: "README.md", size: 9, text: "# Atlas\n" },
  "src/app.ts": { path: "src/app.ts", size: APP_TS.length, text: APP_TS },
  "src/long.ts": { path: "src/long.ts", size: LONG.length, text: LONG },
  "src/util/strings.ts": { path: "src/util/strings.ts", size: 30, text: "export const s = 'strings';\n" },
  "big.log": { path: "big.log", size: 5 * 1024 * 1024, refused: "large" },
  "data.bin": { path: "data.bin", size: 4, refused: "binary" },
  "logo.png": { path: "logo.png", size: 2048, refused: "image", mime: "image/png" },
};
const ALL = ["README.md", "big.log", "data.bin", "logo.png", "src/app.ts", "src/long.ts", "src/util/strings.ts"];

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
    await view.locator(".fv-count", { hasText: "1 of 7" }).waitFor();
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
    await view.getByRole("button", { name: "Show the Files sidebar" }).click();
    await view.locator(".fv-sidebar").waitFor();

    // ⌘K, in the tab: its own entries.
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("files");
    for (const name of [/Go to file…/, /Show ignored files/, /Copy the file’s path/, /Refresh the files/]) await palette.getByRole("option", { name }).waitFor();
    await page.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});

test("Files: Show changes opens the GitHub tab's Changes at the file; no workspace says so", async () => {
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
    await page.evaluate(() => localStorage.setItem("paseo-command:files:workspaces", JSON.stringify({ "|wks_a": { open: ["src"], file: "src/app.ts" } })));
    await page.reload();
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    // The workspace's folders and file as left.
    await view.locator(".fv-head .page-head-name", { hasText: "app.ts" }).waitFor();
    await view.getByRole("treeitem", { name: /app\.ts/ }).waitFor();
    // Show changes: the GitHub tab's Changes, at the file, all changes (the macOS app then shows the tab).
    await view.getByRole("button", { name: "Show changes" }).click();
    assert.deepEqual(JSON.parse((await page.evaluate(() => localStorage.getItem("paseo-command:github:place")))!), { kind: "changes", path: "src/app.ts" });
    assert.equal(await page.evaluate(() => localStorage.getItem("paseo-command:github:changesMode")), '"all"');
  } finally {
    await context.close();
  }
});
