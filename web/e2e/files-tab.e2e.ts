/**
 * The Files tab beside an agent's conversation (src/code/FilesPane.tsx): its sidebar's uncommitted and branch changes
 * and every file, a changed file's diff, the editor's vim keys and save (over the version read only), an agent's edit
 * on disk, ⌘P, and a language server's definition, usages and hover, through a fake `/api/lsp` socket. Every request
 * is answered in the browser: nothing reaches a daemon or a language server.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
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

const ROOT = "/work/atlas/a";
const d = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, kind: "directory", size: 0 });
const f = (path: string, size = 40): FileEntry => ({ name: path.split("/").pop()!, path, kind: "file", size });
const T0 = "2026-01-01T00:00:00.000Z";

/** The macOS app's channel, and a fake language server behind `/api/lsp` (other sockets are the real ones). */
const asMacAppWithLsp = (page: Page) =>
  page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(JSON.parse(JSON.stringify(m))) } } };
    window.lspSeen = [];
    window.lspSockets = { opened: 0, closed: 0 };
    const Real = window.WebSocket;
    const ROOT = ${JSON.stringify(ROOT)};
    const uri = (p) => "file://" + ROOT + "/" + p;
    class FakeLsp extends EventTarget {
      constructor(url) {
        super();
        this.url = url;
        this.readyState = 0;
        window.lspSockets.opened++;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen && this.onopen({});
          this.frame({ type: "ready", root: ROOT, server: "fake-ts" });
        }, 10);
      }
      frame(f) { setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(f) }), 5); }
      reply(id, result) { this.frame({ type: "recv", data: JSON.stringify({ jsonrpc: "2.0", id, result }) }); }
      send(raw) {
        const f = JSON.parse(raw);
        if (f.type !== "send") return;
        const m = JSON.parse(f.data);
        window.lspSeen.push(m.method || "response");
        if (m.method === "initialize") return this.reply(m.id, { capabilities: { textDocumentSync: 1, definitionProvider: true, referencesProvider: true, hoverProvider: true, renameProvider: true } });
        if (m.method === "textDocument/definition") return this.reply(m.id, [{ uri: uri("src/util.ts"), range: { start: { line: 1, character: 13 }, end: { line: 1, character: 18 } } }]);
        if (m.method === "textDocument/references") return this.reply(m.id, [
          { uri: uri("src/app.ts"), range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } } },
          { uri: uri("src/util.ts"), range: { start: { line: 1, character: 13 }, end: { line: 1, character: 19 } } },
        ]);
        if (m.method === "textDocument/hover") return this.reply(m.id, { contents: { kind: "markdown", value: "**const helper**: the fake's hover" } });
        if (m.id !== undefined) return this.reply(m.id, null);
      }
      close() { if (this.readyState !== 3) window.lspSockets.closed++; this.readyState = 3; }
    }
    window.WebSocket = function (url, protocols) {
      return String(url).includes("/api/lsp") ? new FakeLsp(url) : new Real(url, protocols);
    };
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket.prototype = Real.prototype;
  `);

/** The workspace's files and changes, a save route that checks the version, and its versions on disk. */
async function setUp(page: Page) {
  const files: Record<string, { text: string; at: string }> = {
    "README.md": { text: "# Atlas\n", at: T0 },
    "src/app.ts": { text: 'import { helper } from "./util";\nexport const a = helper(2);\n', at: T0 },
    "src/util.ts": { text: "// util\nexport const helper = (n: number) => n * 2;\n", at: T0 },
    "src/long.ts": { text: "export const long = 1;\n", at: T0 },
  };
  const writes: { path: string; text: string; modifiedAt: string }[] = [];
  const tree: Record<string, FileEntry[]> = { "": [d("src"), f("README.md")], src: [f("src/app.ts"), f("src/long.ts"), f("src/util.ts")] };
  // The branch changed one line of src/app.ts (helper(1) → helper(2)); nothing is uncommitted.
  const branch = {
    cwd: ROOT,
    branch: "feature",
    baseRef: "main",
    mode: "all",
    tooLarge: false,
    files: [
      {
        path: "src/app.ts",
        isNew: false,
        isDeleted: false,
        additions: 1,
        deletions: 1,
        status: "ok",
        hunks: [
          {
            oldStart: 1,
            oldCount: 2,
            newStart: 1,
            newCount: 2,
            lines: [
              { type: "header", content: "@@ -1,2 +1,2 @@" },
              { type: "context", content: 'import { helper } from "./util";' },
              { type: "remove", content: "export const a = helper(1);" },
              { type: "add", content: "export const a = helper(2);" },
            ],
          },
        ],
      },
    ],
  };
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    accept: (path, body) => {
      if (path === "/api/files/write") {
        const now = files[body.path];
        if (now.at !== body.modifiedAt) return { status: "conflict", path: body.path, version: { path: body.path, status: "ready", size: now.text.length, modifiedAt: now.at } };
        writes.push(body);
        files[body.path] = { text: body.text, at: `2026-01-01T00:00:0${writes.length}.000Z` };
        return { status: "written", path: body.path, size: body.text.length, modifiedAt: files[body.path].at };
      }
      return false;
    },
  });
  await page.route("**/api/files/**", (route) => {
    const u = new URL(route.request().url());
    const q = Object.fromEntries(u.searchParams);
    const name = u.pathname.replace("/api/files/", "");
    if (name === "tree") return route.fulfill({ json: { dir: q.dir ?? "", entries: tree[q.dir ?? ""] ?? [] } });
    if (name === "read") {
      const file = files[q.path!];
      return route.fulfill({ json: { path: q.path, size: file.text.length, text: file.text, modifiedAt: file.at } });
    }
    if (name === "version") {
      const file = files[q.path!];
      return route.fulfill({ json: file ? { path: q.path, status: "ready", size: file.text.length, modifiedAt: file.at } : { path: q.path, status: "missing" } });
    }
    if (name === "all") return route.fulfill({ json: { files: Object.keys(files).sort(), capped: false } });
    return route.fallback();
  });
  await page.route("**/api/changes?**", (route) => {
    const mode = new URL(route.request().url()).searchParams.get("mode");
    return route.fulfill({ json: mode === "uncommitted" ? { ...branch, mode, files: [] } : branch });
  });
  return { files, writes };
}

async function openFilesTab(page: Page) {
  await page.addInitScript(() => localStorage.setItem("paseo-command:atlas:style", JSON.stringify("crew")));
  await asMacAppWithLsp(page);
  const state = await setUp(page);
  await page.goto(`${app.url}?agent=a-idle`);
  await page.locator(".crew-drawer .crew-detail").waitFor();
  await appEvent(page, "paseo:command", "tools-files");
  await page.locator(".files-view").waitFor();
  return state;
}
const editor = (page: Page) => page.locator(".files-editor .cm-content");
/** The shown file's text: its lines, not a diff's deleted ones (small files are drawn whole). */
const docText = (page: Page) =>
  page.locator(".files-editor .cm-content").evaluate((el) => [...el.children].filter((c) => c.classList.contains("cm-line")).map((c) => c.textContent).join("\n"));

test("the Files tab: first of the four tools, the branch's changes with a file's diff, every file, and ⌘P", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  try {
    await openFilesTab(page);
    const tabs = page.locator(".crew-tool-tabs [role=tab]");
    assert.deepEqual(await tabs.allInnerTexts(), ["Files", "Editor", "Terminal", "Browser"]);
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
    // Branch (the default): the changed file, its counts and the base.
    await page.getByText("1 file · +1 −1 · against main").waitFor();
    await page.locator(".files-row[data-kind=M]").click();
    await editor(page).waitFor();
    // Its diff: the base's line shown deleted, inline, above the new one.
    await page.locator(".cm-deletedChunk").getByText("helper(1)").waitFor();
    assert.equal(await page.getByRole("button", { name: "Diff" }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".files-path").textContent(), "src/app.ts");
    // Split: the base beside the file, its removed line on the left, the new one on the right; then stacked again.
    await page.getByRole("radio", { name: "Split" }).click();
    await page.locator(".files-split-side.base .cm-splitDeletedLine").getByText("helper(1)").waitFor();
    await page.locator(".files-split-side.mine .cm-changedLine").getByText("helper(2)").waitFor();
    assert.equal(await page.locator(".files-split .cm-splitRevert").count(), 1);
    // Revert puts the base's line back in the file (left unsaved).
    await page.locator(".files-split .cm-splitRevert").dispatchEvent("mousedown");
    await page.locator(".files-split-side.mine .cm-line").getByText("helper(1)").waitFor();
    await page.locator(".files-split .cm-splitRevert").waitFor({ state: "detached" });
    // …and it's an edit like any other: undone with u.
    await page.locator(".files-split-side.mine .cm-content").click();
    await page.keyboard.press("Escape");
    await page.keyboard.type("u");
    await page.locator(".files-split-side.mine .cm-changedLine").getByText("helper(2)").waitFor();
    await page.getByRole("radio", { name: "Stacked" }).click();
    await page.locator(".files-split").waitFor({ state: "detached" });
    await page.locator(".cm-deletedChunk").getByText("helper(1)").waitFor();
    // Uncommitted: nothing.
    await page.getByRole("radio", { name: "Uncommitted" }).click();
    await page.getByText("Nothing uncommitted.").waitFor();
    // All files: the tree, folder by folder.
    await page.getByRole("radio", { name: "All files" }).click();
    await page.locator(".files-tree").getByText("src").click();
    await page.locator(".files-tree").getByText("util.ts").click();
    await page.locator(".files-tab[aria-selected=true]").getByText("util.ts").waitFor();
    // ⌘B, in the editor too: the sidebar hides and shows again.
    await editor(page).click();
    await page.keyboard.press("Meta+b");
    await page.locator(".files-side").waitFor({ state: "detached" });
    await page.keyboard.press("Meta+b");
    await page.locator(".files-side").waitFor();
    // ⌘P: any file, fuzzy.
    await page.keyboard.press("Meta+p");
    await page.getByRole("dialog", { name: "Go to file" }).waitFor();
    await page.keyboard.type("lng");
    // Each row: the file's name as one piece (its matched letters marked in runs), then its folder; the best fit first.
    const first = page.locator(".files-quick li").first();
    assert.equal(await first.locator(".files-quick-name").innerText(), "long.ts");
    assert.equal(await first.locator(".files-quick-name mark").count(), 2, "l and ng: runs, not letters");
    const gaps = await first.locator(".files-quick-name").evaluate((el) => {
      const boxes = [...el.children].map((c) => c.getBoundingClientRect());
      return boxes.slice(1).map((b, i) => Math.round(b.left - boxes[i]!.right));
    });
    assert.ok(gaps.every((g) => g <= 1), `the name's letters sit together: ${gaps}`);
    if (process.env.QUICK_SHOT) await page.screenshot({ path: process.env.QUICK_SHOT });
    await page.keyboard.press("Enter");
    await page.locator(".files-tab[aria-selected=true]").getByText("long.ts").waitFor();
    assert.equal(await page.locator(".files-tab").count(), 3);
  } finally {
    await context.close();
  }
});

test("vim keys edit, :w saves over the version read, and an agent's edit on disk reloads a clean file or is flagged", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  try {
    const { files, writes } = await openFilesTab(page);
    await page.locator(".files-row[data-kind=M]").click();
    await editor(page).click();
    // Normal mode: to the end of line 2, append, back to normal, :w.
    await page.keyboard.press("Escape");
    await page.keyboard.type("2GA");
    await page.keyboard.type(" // edited");
    await page.keyboard.press("Escape");
    await page.locator(".files-tab .files-dirty").waitFor();
    await page.keyboard.type(":w");
    await page.keyboard.press("Enter");
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 1, "saved");
    assert.deepEqual(writes[0], { workspace: "wks_a", path: "src/app.ts", text: 'import { helper } from "./util";\nexport const a = helper(2); // edited\n', modifiedAt: T0 });
    await page.locator(".files-tab .files-dirty").waitFor({ state: "detached" });
    // An agent writes it: the clean buffer follows.
    files["src/app.ts"] = { text: "export const a = 3;\n", at: "2026-01-02T00:00:00.000Z" };
    await waitFor(() => docText(page), (t) => t === "export const a = 3;\n", "reloaded from disk");
    // With unsaved edits it isn't overwritten: it's flagged, and Keep mine saves over theirs.
    await editor(page).click();
    await page.keyboard.press("Escape");
    await page.keyboard.type("ggA");
    await page.keyboard.type(" // mine");
    await page.keyboard.press("Escape");
    files["src/app.ts"] = { text: "export const a = 4;\n", at: "2026-01-03T00:00:00.000Z" };
    await page.getByText(/changed on disk/).waitFor();
    assert.equal(await docText(page), "export const a = 3; // mine\n");
    await page.getByRole("button", { name: "Keep mine" }).click();
    await page.keyboard.press("Meta+s");
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 2, "saved over theirs");
    assert.equal(writes[1].modifiedAt, "2026-01-03T00:00:00.000Z");
  } finally {
    await context.close();
  }
});

test("the language server: gd goes to a definition in another file, ⌃O comes back, gr lists usages, K hovers", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  try {
    await openFilesTab(page);
    await page.getByRole("radio", { name: "All files" }).click();
    await page.locator(".files-tree").getByText("src").click();
    await page.locator(".files-tree").getByText("app.ts").click();
    await page.locator(".files-lsp[data-state=ready]").getByText("fake-ts").waitFor();
    await waitFor(() => page.evaluate(() => (window as unknown as { lspSeen: string[] }).lspSeen), (s) => s.includes("textDocument/didOpen"), "opened on the server");
    await editor(page).click();
    await page.keyboard.press("Escape");
    // On "helper" in line 1.
    await page.keyboard.type("gg0ww");
    await page.keyboard.type("gd");
    await page.locator(".files-tab[aria-selected=true]").getByText("util.ts").waitFor();
    await page.keyboard.press("Control+o");
    await page.locator(".files-tab[aria-selected=true]").getByText("app.ts").waitFor();
    await page.keyboard.type("gr");
    const usages = page.getByLabel("Usages of helper");
    await usages.getByText("2 usages of").waitFor();
    assert.equal(await usages.locator(".files-usage").count(), 2);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.locator(".files-tab[aria-selected=true]").getByText("util.ts").waitFor();
    await page.keyboard.type("K");
    await page.locator(".cm-lsp-hover-tooltip").getByText("the fake's hover").waitFor();
    // Its server stays while a TypeScript file is open, goes with the last, and comes back with the next one opened.
    const sockets = () => page.evaluate(() => (window as unknown as { lspSockets: { opened: number; closed: number } }).lspSockets);
    assert.deepEqual(await sockets(), { opened: 1, closed: 0 });
    await page.getByRole("button", { name: "Close util.ts" }).click();
    assert.deepEqual(await sockets(), { opened: 1, closed: 0 }, "app.ts is still open");
    await page.getByRole("button", { name: "Close app.ts" }).click();
    await waitFor(sockets, (s) => s.closed === 1, "stopped with the last TypeScript file");
    await page.locator(".files-tree").getByText("long.ts").click();
    await page.locator(".files-lsp[data-state=ready]").waitFor();
    assert.deepEqual(await sockets(), { opened: 2, closed: 1 });
  } finally {
    await context.close();
  }
});
