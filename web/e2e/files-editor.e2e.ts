/**
 * Files in the user's editor (Settings → Files → Open files in: an editor
 * command). In the macOS app a file opened from the tree, ⌘P, a tab or the
 * Changes runs the command in a daemon terminal (`POST /api/terminals/editor`,
 * answered here by a fake daemon terminal), and the page tells the app where to
 * lay it (the viewer's frame) as it moves, steps it aside for dialogs, gives it
 * the keyboard, closes it with its tab (the app confirms while it runs) and
 * shows the viewer, with Reopen in editor, once it quits. Each tab keeps its
 * own. In a browser the viewer stays, with a note. Settings edits the command.
 * Nothing reaches a daemon.
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
  let settings = { integrations: { github: false, linear: false, typesafe: false }, files };
  let n = 0;
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    accept: (path, body) => {
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
  return { terminals, created, killed, saved };
}

test("Files in the editor (the macOS app): a terminal per tab, laid over the viewer, closed with its tab, reopened once it quits", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await asMacApp(page);
  const { terminals, created, killed } = await setUp(page);
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    const item = (name: RegExp) => view.getByRole("treeitem", { name });
    const tab = (name: string) => view.locator(".fv-tabs [role=tab]", { has: page.locator(".fv-tab-name", { hasText: name }) });

    // A click in the tree: the editor command runs on the file, in the workspace, and the tab is kept (no preview).
    await item(/^src/).click();
    await item(/app\.ts/).click();
    await waitFor(() => Promise.resolve(created.length), (c) => c === 1, "the editor's terminal");
    assert.deepEqual(created[0], { workspace: "wks_a", path: "src/app.ts" });
    const slot = view.locator(".fv-editor[data-terminal=term-1]");
    await slot.waitFor();
    assert.equal(await tab("app.ts").getAttribute("class").then((c) => c!.includes("preview")), false, "opening in the editor keeps the tab");
    assert.equal(await view.getByRole("button", { name: "Editor" }).getAttribute("aria-pressed"), "true");
    // The app is told where: exactly the slot's frame, and the editor takes the keyboard.
    const frame = await slot.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    await waitFor(() => lastPlacement(page), (p) => p?.terminal === "term-1" && p.x === frame.x && p.width === frame.width && p.covered === false, "the placement");
    assert.ok(frame.width > 400 && frame.height > 300, JSON.stringify(frame));
    await waitFor(() => sent(page, "editorFocus"), (s) => s.length >= 1, "the editor given the keyboard");

    // It follows the page: the sidebar hides (⌘S), the viewer widens leftwards.
    await view.locator(".fv-head h2").click();
    await page.keyboard.press("Meta+s");
    await waitFor(() => lastPlacement(page), (p) => p?.terminal === "term-1" && (p.x as number) < frame.x && (p.width as number) > frame.width, "followed the sidebar");
    await page.keyboard.press("Meta+s");
    await waitFor(() => lastPlacement(page), (p) => p?.x === frame.x, "back beside the sidebar");
    // The window narrows.
    await page.setViewportSize({ width: 1200, height: 800 });
    await waitFor(() => lastPlacement(page), (p) => (p?.width as number) < frame.width && (p?.height as number) < frame.height, "followed the window");
    await page.setViewportSize({ width: 1500, height: 900 });

    // ⌘K: a dialog over it, so it steps aside; Open in viewer is offered (page Files), and shows the viewer.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await waitFor(() => lastPlacement(page), (p) => p?.covered === true, "covered by the palette");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Open in");
    await palette.getByRole("option", { name: /Open in viewer.*Files/ }).waitFor();
    assert.equal(await palette.getByRole("option", { name: /Open in editor/ }).count(), 0, "only what applies");
    await palette.getByRole("option", { name: /Open in viewer/ }).click();
    await view.locator(".fv-file").waitFor();
    await waitFor(() => lastPlacement(page), (p) => !!p && p.terminal === undefined, "the editor hidden for the viewer");
    assert.equal(await view.getByRole("button", { name: "View" }).getAttribute("aria-pressed"), "true");
    // Back in the editor (the toggle): the same terminal, none started.
    await view.getByRole("button", { name: "Editor" }).click();
    await slot.waitFor();
    assert.equal(created.length, 1);

    // Another file: its own terminal; back to the first tab: its terminal again.
    await item(/README\.md/).click();
    await view.locator(".fv-editor[data-terminal=term-2]").waitFor();
    assert.deepEqual(created[1], { workspace: "wks_a", path: "README.md" });
    await tab("app.ts").click();
    await slot.waitFor();
    await waitFor(() => lastPlacement(page), (p) => p?.terminal === "term-1", "the first tab's terminal shown again");

    // Leaving the page: the editor goes (the terminals stay); back, it's laid again.
    await appEvent(page, "paseo:mode", { mode: "command" });
    await waitFor(() => lastPlacement(page), (p) => !!p && p.terminal === undefined, "hidden with the page");
    await appEvent(page, "paseo:mode", { mode: "files" });
    await waitFor(() => lastPlacement(page), (p) => p?.terminal === "term-1", "shown again");
    assert.deepEqual(killed, []);

    // Closing its tab asks the app, which confirms while the editor runs: cancelled, the tab stays.
    await tab("app.ts").locator(".fv-tab-close").click();
    const ask = async () => (await sent(page, "editorClose")).at(-1) as { token: string; items: unknown[] } | undefined;
    await waitFor(ask, (a) => !!a, "the close asked");
    assert.deepEqual((await ask())!.items, [{ terminal: "term-1", host: "", name: "app.ts", running: true }]);
    await appEvent(page, "paseo:editor", { type: "cancelled", token: (await ask())!.token });
    await tab("app.ts").waitFor();
    // ⌘W (the app's Close File Tab): asked again; closed, the tab goes.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:command", { detail: "files-close-tab" })));
    await waitFor(() => sent(page, "editorClose"), (s) => s.length === 2, "asked again");
    terminals.delete("term-1");
    await appEvent(page, "paseo:editor", { type: "closed", token: (await ask())!.token, terminals: ["term-1"] });
    await waitFor(() => tab("app.ts").count(), (c) => c === 0, "the tab closed");
    assert.deepEqual(killed, [], "the app ended it, not the page again");

    // The editor quits on its own (:q): its tab shows the viewer, offering it again.
    await view.locator(".fv-editor[data-terminal=term-2]").waitFor();
    terminals.delete("term-2");
    await appEvent(page, "paseo:editor", { type: "exited", terminal: "term-2" });
    await view.getByText("nvim quit. The file shows in the viewer.").waitFor();
    await view.locator(".fv-file").waitFor();
    assert.equal(created.length, 2, "not restarted on its own");
    // Reopen in editor: a new terminal.
    await view.getByRole("button", { name: "Reopen in editor" }).click();
    await view.locator(".fv-editor[data-terminal=term-3]").waitFor();
    assert.deepEqual(created[2], { workspace: "wks_a", path: "README.md" });

    // Kept across reloads; a terminal gone meanwhile shows the viewer.
    terminals.delete("term-3");
    await page.reload();
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    await view.getByText("nvim quit. The file shows in the viewer.").waitFor();
    assert.equal(created.length, 3);
  } finally {
    await context.close();
  }
});

test("Files in the editor: the toggle at the line in view, ⌘K Open in editor, Close other tabs asks once for all", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await asMacApp(page);
  const { created } = await setUp(page, { openIn: "viewer", editorCommand: "nvim +{line} {file}" });
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    // The setting off: the viewer, with the toggle to open the file in the editor at the line in view.
    await view.getByRole("treeitem", { name: /^src/ }).click();
    await view.getByRole("treeitem", { name: /long\.ts/ }).dblclick();
    await view.locator(".fv-file").waitFor();
    assert.equal(created.length, 0);
    await view.locator(".gd-scroll").evaluate((e) => (e.scrollTop = 2000));
    await page.waitForTimeout(150);
    await view.getByRole("button", { name: "Editor" }).click();
    await waitFor(() => Promise.resolve(created.length), (c) => c === 1, "opened in the editor");
    assert.equal(created[0]!.path, "src/long.ts");
    assert.ok((created[0]!.line as number) > 50, JSON.stringify(created[0]));
    // ⌘K Open in editor, for another tab.
    await view.getByRole("treeitem", { name: /app\.ts/ }).dblclick();
    await view.locator(".fv-file").waitFor();
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Open in editor");
    await palette.getByRole("option", { name: /Open in editor.*Files/ }).click();
    await waitFor(() => Promise.resolve(created.length), (c) => c === 2, "⌘K opened it");
    // Close other tabs: one question for the others' editors.
    await view.getByRole("treeitem", { name: /README\.md/ }).dblclick();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:command", { detail: "files-close-other-tabs" })));
    await waitFor(() => sent(page, "editorClose"), (s) => s.length === 1, "asked");
    const ask = (await sent(page, "editorClose"))[0] as unknown as { items: { terminal: string }[] };
    assert.deepEqual(ask.items.map((i) => i.terminal).sort(), ["term-1", "term-2"]);
  } finally {
    await context.close();
  }
});

test("Files in a browser: the viewer stays, with a note; Settings → Files edits the command", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  const { created, saved } = await setUp(page);
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await appEvent(page, "paseo:mode", { mode: "files" });
    const view = page.locator(".files-view");
    await view.getByRole("treeitem", { name: /README\.md/ }).click();
    await view.locator(".fv-file").waitFor();
    await view.getByText("Files open in nvim in the macOS app. A browser shows them in the viewer.").waitFor();
    assert.equal(created.length, 0);
    assert.equal(await view.locator(".fv-mode").count(), 0, "no toggle without the app");

    // Settings → Files.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("region", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Files" }).click();
    await settings.getByRole("radio", { name: /Editor command/ }).waitFor();
    assert.equal(await settings.getByRole("radio", { name: /Editor command/ }).isChecked(), true);
    const field = settings.getByRole("textbox", { name: /Command/ });
    assert.equal(await field.inputValue(), "nvim +{line} {file}");
    // Checked as it's typed: {file} needed, unquoted.
    await field.fill('hx "{file}"');
    await settings.getByText("Leave {file} and {line} unquoted: they're quoted for you.").waitFor();
    assert.equal(await settings.getByRole("button", { name: "Save" }).isDisabled(), true);
    await field.fill("hx {file}:{line}");
    await settings.getByRole("button", { name: "Save" }).click();
    await waitFor(() => Promise.resolve(saved.length), (n) => n === 1, "saved");
    assert.deepEqual(saved[0], { files: { editorCommand: "hx {file}:{line}" } });
    // Back to the viewer (once the save has landed).
    const viewerChoice = settings.getByRole("radio", { name: /Built-in viewer/ });
    await waitFor(() => viewerChoice.isDisabled(), (d) => !d, "saved");
    await viewerChoice.check();
    await waitFor(() => Promise.resolve(saved.length), (n) => n === 2, "saved the choice");
    assert.deepEqual(saved[1], { files: { openIn: "viewer" } });
    await waitFor(() => settings.getByRole("textbox", { name: /Command/ }).count(), (c) => c === 0, "the command only for the editor");
  } finally {
    await context.close();
  }
});
