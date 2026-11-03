/**
 * Comments on a workspace's own diff (the Files tab's Changes): the gutter's
 * + keeps one as the workspace's pending comment (`/api/diff-comments`,
 * answered here from a store that outlives a reload), shown under its line;
 * the chat of an agent in that workspace offers "N pending comments · Apply",
 * which sends them as one message (the send answered here) and marks them
 * applied, gone from the diff. Nothing reaches GitHub or a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { DiffFile, WorkspaceChanges } from "../src/github/types";
import type { LocalComment } from "../src/github/localComments";
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

const file = (path: string, extra: string[] = []): DiffFile => ({
  path,
  isNew: false,
  isDeleted: false,
  additions: 2 + extra.length,
  deletions: 1,
  hunks: [
    {
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 4 + extra.length,
      lines: [
        { type: "header", content: `@@ -1,3 +1,${4 + extra.length} @@` },
        ...extra.map((content) => ({ type: "add" as const, content })),
        { type: "context", content: "const a = 1;" },
        { type: "remove", content: "const b = 2;" },
        { type: "add", content: "const b = 3;" },
        { type: "add", content: "const c = 4;" },
        { type: "context", content: "export { a };" },
      ],
    },
  ],
  status: "ok",
});

async function setUp(page: Page) {
  const sent: { path: string; body: { prompt?: string } }[] = [];
  const githubHits: string[] = [];
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    lists: { settings: { integrations: { github: true, linear: false, typesafe: false } } },
    detail: (id: string) => detailOf(id, "idle"),
    timeline: () => ({ items: [{ kind: "assistant", text: "Polished the map.", messageId: "r1" }] }),
    accept: (path: string, body: unknown) => {
      if (path === "/api/agents/a-idle/send") {
        sent.push({ path, body: body as { prompt?: string } });
        return true;
      }
      return false;
    },
  } as never);
  // The workspace's diff, and later three lines added above the commented one.
  const diff = { shifted: false };
  await page.route("**/api/changes?**", (route) => {
    const mode = new URL(route.request().url()).searchParams.get("mode") ?? "all";
    const changes: WorkspaceChanges = {
      cwd: "/work/atlas/a",
      branch: "map-polish",
      baseRef: "main",
      mode: mode as WorkspaceChanges["mode"],
      files: [file("src/a.ts", diff.shifted ? ["// one", "// two", "// three"] : []), file("src/b.ts")],
      tooLarge: false,
      ahead: 1,
      behind: 0,
      dirty: true,
    };
    return route.fulfill({ json: changes });
  });
  // The Files tab, whose Changes these are: an empty tree.
  await page.route("**/api/files/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/files/tree") ? { dir: "", entries: [] } : { files: [] } }),
  );
  await page.route("**/api/github/**", (route) => {
    githubHits.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  // The app's store, as the server keeps it: across reloads.
  const store: LocalComment[] = [];
  const posts: Record<string, unknown>[] = [];
  let n = 0;
  await page.route("**/api/diff-comments**", (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      assert.equal(new URL(req.url()).searchParams.get("workspace"), "wks_a");
      return route.fulfill({ json: { comments: store } });
    }
    const body = req.postDataJSON() as Record<string, any>;
    posts.push(body);
    const now = new Date().toISOString();
    if (body.action === "add") store.push({ ...body.comment, id: `dc_${++n}`, createdAt: now });
    if (body.action === "edit") Object.assign(store.find((c) => c.id === body.id)!, { body: body.body, updatedAt: now });
    if (body.action === "move")
      for (const m of body.moves) Object.assign(store.find((c) => c.id === m.id)!, { line: m.line, ...(m.startLine ? { startLine: m.startLine } : {}) });
    if (body.action === "apply") for (const c of store) if (body.ids.includes(c.id)) c.appliedAt = now;
    if (body.action === "discard") store.splice(0, store.length, ...store.filter((c) => c.appliedAt));
    if (body.action === "remove") store.splice(store.findIndex((c) => c.id === body.id), 1);
    return route.fulfill({ json: { comments: store } });
  });
  return { sent, store, posts, diff, githubHits };
}

const showChanges = async (page: Page) => {
  await appEvent(page, "paseo:mode", { mode: "files" });
  const view = page.locator(".files-view");
  const button = view.locator(".fv-changes-btn");
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await view.locator('.gd-file[data-path="src/a.ts"]').waitFor();
  return view;
};

test("a comment on a local diff is the workspace's pending comment, applied from the agent's chat", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const { sent, store, posts, diff, githubHits } = await setUp(page);
  try {
    await page.goto(`${app.url}?agent=a-idle`);
    await page.locator(".msg.assistant").waitFor();
    let view = await showChanges(page);

    // The gutter's + on src/a.ts's new line 3 ("const c = 4;"): a comment, kept for the workspace.
    const line = (n: number) => view.locator(`.gd-file[data-path="src/a.ts"] [data-line="${n}"][data-line-type="change-addition"]`).first();
    // The + shows while the line is hovered; the diff is drawn again once highlighted, so hover again until it takes.
    for (let i = 0; ; i++) {
      await line(3).hover();
      try {
        await view.locator('.gd-file[data-path="src/a.ts"] [data-utility-button]').click({ timeout: 2000 });
        break;
      } catch (e) {
        if (i >= 5) throw e;
      }
    }
    const box = view.locator(".gh-notes textarea");
    await box.fill("Name this constant.");
    await view.getByRole("button", { name: "Add comment", exact: true }).click();
    await view.locator(".gh-draft", { hasText: "Name this constant." }).waitFor();
    assert.deepEqual(posts[0], {
      workspace: "wks_a",
      action: "add",
      comment: { path: "src/a.ts", side: "RIGHT", line: 3, text: ["const c = 4;"], body: "Name this constant." },
    });
    await view.locator(".gh-local-count", { hasText: "1 pending comment" }).waitFor();
    // No viewed boxes on a local diff, and nothing asked of GitHub for it.
    assert.equal(await view.locator(".gd-viewed").count(), 0);

    // Edited in place.
    await view.getByRole("button", { name: "Edit comment" }).click();
    await view.locator(".gh-draft textarea").fill("Name this constant, please.");
    await view.getByRole("button", { name: "Save" }).click();
    await view.locator(".gh-draft", { hasText: "Name this constant, please." }).waitFor();

    // A reload keeps it; three lines added above it, it follows its line (now 6).
    diff.shifted = true;
    await page.reload();
    await page.locator(".msg.assistant").waitFor();
    view = await showChanges(page);
    await view.locator(".gh-draft", { hasText: "Name this constant, please." }).waitFor();
    await waitFor(() => Promise.resolve(store[0]!.line), (n) => n === 6, "the comment moved with its line");
    await page.screenshot({ path: "/tmp/diff-comments-changes.png" });

    // The chat's control: "1 pending comment · Apply", its list to review first.
    const control = page.getByRole("region", { name: "Pending diff comments" });
    await control.locator(".pending-comments-toggle", { hasText: "1 pending comment" }).waitFor();
    await control.locator(".pending-comments-toggle").click();
    await control.locator(".pending-comment", { hasText: "src/a.ts:6" }).waitFor();
    await control.locator(".pending-comment-quote", { hasText: "const c = 4;" }).waitFor();
    await page.screenshot({ path: "/tmp/diff-comments-chat.png" });
    // Show the changes: the Files tab's Changes (in a browser, it says the tab is the app's).
    await control.getByRole("button", { name: "Show the changes" }).click();
    await page.locator(".toast[role=status]", { hasText: "The Files tab, with its Changes, is in the macOS app." }).waitFor();

    // ⌘K has both entries.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("pending diff comments");
    await palette.getByRole("option", { name: /Apply pending diff comments \(1\)/ }).waitFor();
    await palette.getByRole("option", { name: /Show pending diff comments/ }).waitFor();
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });

    // Apply: one message through the chat's send, then they're applied and gone from the diff.
    await control.getByRole("button", { name: "Apply" }).click();
    const message = await waitFor(() => Promise.resolve(sent[0]), (s) => !!s, "the message sent");
    assert.match(message.body.prompt ?? "", /^Please address these comments on your changes\./);
    assert.match(message.body.prompt ?? "", /1\. src\/a\.ts:6\n {3}> const c = 4;\n {3}Name this constant, please\./);
    await waitFor(() => Promise.resolve(store[0]!.appliedAt), (a) => !!a, "applied");
    await control.waitFor({ state: "detached" });
    await view.locator(".gh-draft").waitFor({ state: "detached" });
    assert.equal(await view.locator(".gh-local-count").count(), 0);
    assert.equal(store.length, 1, "kept as history");
    assert.deepEqual(githubHits.filter((p) => p.includes("/m/")), [], "no GitHub write");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("pending comments whose lines are gone are outdated, still listed; removed and discarded from the chat", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { store, posts } = await setUp(page);
  const at = new Date().toISOString();
  store.push(
    { id: "dc_old", path: "src/gone.ts", side: "RIGHT", line: 4, text: ["removed()"], body: "This went away.", createdAt: at },
    { id: "dc_b", path: "src/b.ts", side: "RIGHT", line: 3, text: ["const c = 4;"], body: "And here.", createdAt: at },
    { id: "dc_c", path: "src/b.ts", side: "LEFT", line: 2, text: ["const b = 2;"], body: "Keep this?", createdAt: at },
  );
  try {
    await page.goto(`${app.url}?agent=a-idle`);
    await page.locator(".msg.assistant").waitFor();
    const view = await showChanges(page);
    await view.locator(".gh-local-count", { hasText: "3 pending comments" }).waitFor();
    const outdated = view.getByRole("region", { name: "Outdated comments" });
    await outdated.locator(".gh-local-place", { hasText: "src/gone.ts:4" }).waitFor();
    await view.locator('.gd-file[data-path="src/b.ts"] .gh-draft', { hasText: "And here." }).waitFor();
    await view.locator('.gd-file[data-path="src/b.ts"] .gh-draft', { hasText: "Keep this?" }).waitFor();

    const control = page.getByRole("region", { name: "Pending diff comments" });
    await control.locator(".pending-comments-toggle").click();
    await control.getByRole("button", { name: "Remove the comment on src/gone.ts:4" }).click();
    await control.locator(".pending-comments-toggle", { hasText: "2 pending comments" }).waitFor();
    await view.locator(".gh-local-count", { hasText: "2 pending comments" }).waitFor();
    await control.getByRole("button", { name: "Discard all" }).click();
    await control.getByRole("button", { name: "Discard", exact: true }).click();
    await control.waitFor({ state: "detached" });
    await view.locator(".gh-draft").waitFor({ state: "detached" });
    assert.deepEqual(
      posts.map((p) => p.action),
      ["remove", "discard"],
    );
  } finally {
    await context.close();
  }
});
