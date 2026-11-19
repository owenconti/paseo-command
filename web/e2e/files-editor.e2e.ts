/**
 * Your editor (Settings → Files' command, nvim for the user): in the macOS app
 * an agent's workspace opens in it beside the conversation on Crew (`POST
 * /api/terminals/workspace-editor`, answered here by a fake daemon terminal),
 * one per workspace and kept; the page tells the app where to lay it, and a
 * chat's file links and Show changes (⇧⌘G) are sent to it (`POST
 * /api/terminals/editor-send`). Settings edits the commands. Nothing reaches a daemon.
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

const d = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, kind: "directory", size: 0 });
const f = (path: string, size = 40): FileEntry => ({ name: path.split("/").pop()!, path, kind: "file", size });
const TREE: Record<string, FileEntry[]> = { "": [d("src"), f("README.md")], src: [f("src/app.ts"), f("src/long.ts")] };
const LONG = Array.from({ length: 400 }, (_, i) => `const line${i} = ${i};`).join("\n");
const READS: Record<string, FileRead> = {
  "README.md": { path: "README.md", size: 9, text: "# Atlas\n" },
  "src/app.ts": { path: "src/app.ts", size: 20, text: "export const a = 1;\n" },
  "src/long.ts": { path: "src/long.ts", size: LONG.length, text: LONG },
};

type Sent = { type: string; [key: string]: unknown };
/** The macOS app's channel: what the page sends it is kept in `sentToApp`. */
const asMacApp = (page: Page) =>
  page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(JSON.parse(JSON.stringify(m))) } } };
  `);
const sent = (page: Page, type: string) =>
  page.evaluate((t) => (window as unknown as { sentToApp: Sent[] }).sentToApp.filter((m) => m.type === t), type);
const lastPlacement = async (page: Page) => (await sent(page, "editor")).at(-1);

/** The fleet, the files and a fake daemon's terminals: created by the editor route, listed, killed. */
async function setUp(page: Page, files = { openIn: "editor", editorCommand: "nvim +{line} {file}" }) {
  const terminals = new Set<string>();
  const created: Record<string, unknown>[] = [];
  const killed: string[] = [];
  const saved: unknown[] = [];
  const sentToEditor: any[] = [];
  let settings = { integrations: { github: false, linear: false, typesafe: false }, files };
  let n = 0;
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    accept: (path, body) => {
      if (path === "/api/terminals/workspace-editor") {
        created.push({ ...body, workspaceEditor: true });
        const id = `term-${++n}`;
        terminals.add(id);
        return { terminal: { id, name: "paseo editor · nvim", editor: true } };
      }
      if (path === "/api/terminals/editor-send") {
        sentToEditor.push(body);
        return { ok: true };
      }
      if (path === "/api/terminals/editor") {
        created.push(body);
        const id = `term-${++n}`;
        terminals.add(id);
        return { terminal: { id, name: `nvim · ${String(body.path).split("/").pop()}` } };
      }
      if (path === "/api/terminals/kill") {
        killed.push(body.id);
        terminals.delete(body.id);
        return true;
      }
      if (path === "/api/settings") {
        saved.push(body);
        settings = { ...settings, files: { ...settings.files, ...body.files } };
        return settings;
      }
      return false;
    },
  });
  // Registered after mockApi, so these answer first.
  await page.route("**/api/settings", (route) => (route.request().method() === "GET" ? route.fulfill({ json: settings }) : route.fallback()));
  await page.route("**/api/terminals?**", (route) =>
    route.fulfill({ json: { cwd: "/work/atlas/a", terminals: [...terminals].map((id) => ({ id, name: id })) } }),
  );
  await page.route("**/api/files/**", (route) => {
    const u = new URL(route.request().url());
    const q = Object.fromEntries(u.searchParams);
    const name = u.pathname.replace("/api/files/", "");
    if (name === "tree") return route.fulfill({ json: { dir: q.dir ?? "", entries: TREE[q.dir ?? ""] ?? [] } });
    if (name === "read") return route.fulfill({ json: READS[q.path!] });
    if (name === "all") return route.fulfill({ json: { files: Object.keys(READS), capped: false } });
    if (name === "changed") return route.fulfill({ json: { files: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  await page.route("**/api/changes?**", (route) => route.fulfill({ json: { cwd: "/work/atlas/a", branch: "main", baseRef: "main", mode: "all", files: [], tooLarge: false } }));
  return { terminals, created, killed, saved, sentToEditor };
}

test("Settings → Files edits your editor's command and its changes command", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  const { saved } = await setUp(page);
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("region", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Files" }).click();
    assert.equal(await settings.getByRole("radio").count(), 0, "no built-in viewer to choose");
    const field = settings.getByRole("textbox", { name: /^Command/ });
    await waitFor(() => field.inputValue(), (v) => v === "nvim +{line} {file}", "the saved command");
    // Checked as it's typed: {file} needed, unquoted.
    await field.fill('hx "{file}"');
    await settings.getByText("Leave {file} and {line} unquoted: they're quoted for you.").waitFor();
    assert.equal(await settings.getByRole("button", { name: "Save" }).first().isDisabled(), true);
    await field.fill("nvim {file}");
    await field.press("Enter");
    await waitFor(() => Promise.resolve(saved.length), (n) => n === 1, "saved");
    assert.deepEqual(saved[0], { files: { editorCommand: "nvim {file}" } });
  } finally {
    await context.close();
  }
});

test("an agent's workspace in your editor beside its conversation on Crew (F): one nvim in its folder, kept; file links and Show changes go to it", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.addInitScript(() => localStorage.setItem("paseo-command:atlas:style", JSON.stringify("crew")));
  await asMacApp(page);
  const { created, sentToEditor } = await setUp(page);
  try {
    await page.goto(`${app.url}?agent=a-idle`);
    await page.locator(".crew-drawer .crew-detail").waitFor();
    const toggle = page.locator(".crew-files-toggle");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    // F, outside a field: the workspace's editor takes the tools' place, right of the conversation.
    const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await blur();
    await page.keyboard.press("f");
    const pane = page.getByRole("region", { name: /: your editor$/ }).first();
    const slot = page.locator(".crew-editor-slot[data-terminal=term-1]");
    await slot.waitFor();
    assert.deepEqual(created, [{ workspace: "wks_a", workspaceEditor: true }], "started once, in the workspace (the command is the settings file's)");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".crew-tool-tabs").getByRole("tab", { name: "Editor" }).getAttribute("aria-selected"), "true");
    const [box, drawer] = await Promise.all([pane, page.locator(".crew-drawer")].map((l) => l.evaluate((e) => e.getBoundingClientRect().toJSON())));
    assert.ok(box.left >= drawer.right - 1 && box.width > 500, `right of the conversation (focus): ${JSON.stringify({ box, drawer })}`);
    // Laid over the pane for the Command tab, and given the keyboard.
    const frame = await slot.evaluate((e) => e.getBoundingClientRect().toJSON());
    await waitFor(() => lastPlacement(page), (p) => p?.terminal === "term-1" && p.mode === "command" && p.x === frame.x && p.width === frame.width, "placed for Command");
    await waitFor(() => sent(page, "editorFocus"), (s) => s.length >= 1, "the editor given the keyboard");
    // A menu of the page's over the pane (the top bar's glance menus, a row menu): cut out of the terminal, so it shows.
    await page.evaluate(() => {
      const menu = document.createElement("div");
      menu.className = "popover-menu test-menu";
      Object.assign(menu.style, { position: "fixed", right: "20px", top: "160px", width: "300px", height: "120px", zIndex: "50" });
      document.body.appendChild(menu);
    });
    const holed = await waitFor(() => lastPlacement(page), (p) => (p?.holes?.length ?? 0) === 1, "the menu cut out");
    assert.deepEqual(Object.keys(holed.holes[0]).sort(), ["height", "width", "x", "y"]);
    assert.ok(holed.holes[0].width >= 300 && holed.holes[0].height >= 120, JSON.stringify(holed.holes));
    await page.evaluate(() => document.querySelector(".test-menu")?.remove());
    await waitFor(() => lastPlacement(page), (p) => (p?.holes?.length ?? 1) === 0, "the hole goes with the menu");
    // Show changes: Settings → Files' command, in it.
    await pane.getByRole("button", { name: "Show changes" }).click();
    await waitFor(() => Promise.resolve(sentToEditor.length), (n) => n === 1, "show changes sent");
    assert.deepEqual(sentToEditor[0], { workspace: "wks_a", id: "term-1", changes: true });
    // B swaps in the browser, the editor put away (still running); F brings the same one back, not another.
    await blur();
    await page.keyboard.press("b");
    await page.locator(".board-browser").waitFor();
    await waitFor(() => lastPlacement(page), (p) => !p?.terminal, "the editor hidden with the pane");
    await blur();
    await page.keyboard.press("f");
    await page.locator(".crew-editor-slot[data-terminal=term-1]").waitFor();
    assert.equal(created.length, 1, "no second editor");
    // ⌘K hides it; a file link in the chat shows it again and opens the file in it, at its line.
    await blur();
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("Hide the editor");
    await palette.getByRole("option", { name: /Hide the editor beside the conversation/ }).click();
    await page.locator(".crew-editor-slot").waitFor({ state: "detached" });
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "#files:src/app.ts";
      a.dataset.filePath = "src/app.ts";
      a.dataset.fileLine = "7";
      a.textContent = "src/app.ts:7";
      document.querySelector(".crew-drawer .session .timeline")!.appendChild(a);
    });
    await page.locator('.crew-drawer a[data-file-path="src/app.ts"]').click();
    await page.locator(".crew-editor-slot[data-terminal=term-1]").waitFor();
    await waitFor(() => Promise.resolve(sentToEditor.length), (n) => n === 2, "the file sent to the editor");
    assert.deepEqual(sentToEditor[1], { workspace: "wks_a", id: "term-1", open: { path: "src/app.ts", line: 7 } });
    // ⇧⌘G (the app's View menu asks the page) shows the changes in it too.
    await appEvent(page, "paseo:command", "branch-changes");
    await waitFor(() => Promise.resolve(sentToEditor.length), (n) => n === 3, "⇧⌘G sent");
    assert.equal(sentToEditor[2].changes, true);
  } finally {
    await context.close();
  }
});
