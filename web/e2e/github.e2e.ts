/**
 * The GitHub tab (the macOS app's mode bar shows it in the map's place):
 * pull requests to review, one PR's conversation and files with a review
 * drafted and submitted, Viewed, and the selected workspace's changes against
 * main. `/api/github/…` and `/api/changes` are answered in the browser from
 * samples; nothing reaches GitHub or a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { DiffFile, PrDetail, PrDiff, PrList, PrRow, WorkspaceChanges } from "../src/github/types";
import { small } from "./fleets";
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
const SHA = "a".repeat(40);
const sam = { login: "sam", name: "Sam" };

const row = (number: number, title: string, extra: Partial<PrRow> = {}): PrRow => ({
  id: `PR_${number}`,
  repo: "acme/atlas",
  number,
  title,
  url: `https://github.com/acme/atlas/pull/${number}`,
  author: sam,
  state: "open",
  createdAt: ago(600),
  updatedAt: ago(number),
  headRef: `feature-${number}`,
  baseRef: "main",
  additions: 2,
  deletions: 1,
  changedFiles: 2,
  comments: 0,
  reviewDecision: "review",
  checks: "passing",
  yourReview: null,
  labels: [],
  ...extra,
});
const REVIEW: PrRow[] = [row(12, "Add the GitHub tab"), row(13, "Fix the shoreline")];
const MINE: PrRow[] = [row(20, "My own change", { author: { login: "me" } })];

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
const DIFF: PrDiff = { files: [file("src/a.ts"), file("src/b.ts")], tooLarge: false };

const detail = (r: PrRow): PrDetail => ({
  ...r,
  body: "This adds **the GitHub tab** to the app.",
  headSha: SHA,
  mergeable: "mergeable",
  viewerIsAuthor: false,
  files: DIFF.files.map((f) => ({ path: f.path, additions: 2, deletions: 1, changeType: "modified", viewed: "unviewed" })),
  timeline: [],
  threads: [],
  commits: [{ sha: SHA, title: "Add it", author: sam, at: ago(30) }],
  checkRuns: [{ name: "test", state: "passing" }],
  reviewers: [{ name: "me", state: "requested" }],
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
});

const showGithub = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent("paseo:mode", { detail: { mode: "github" } })));

type Asked = { path: string; query: Record<string, string>; body?: unknown };

async function setUp(page: Page) {
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => small.workspaces,
    lists: { settings: { integrations: { github: true, linear: false, slack: false, typesafe: false } } },
  });
  const asked: Asked[] = [];
  const writes: Asked[] = [];
  // Registered after mockApi, so these answer first.
  await page.route("**/api/github/**", async (route) => {
    const u = new URL(route.request().url());
    const entry: Asked = { path: u.pathname, query: Object.fromEntries(u.searchParams) };
    if (route.request().method() === "POST") {
      entry.body = route.request().postDataJSON();
      writes.push(entry);
      return route.fulfill({ json: { ok: true } });
    }
    asked.push(entry);
    const name = u.pathname.replace("/api/github/q/", "");
    if (name === "viewer") return route.fulfill({ json: { viewer: { login: "me" } } });
    if (name === "prs") {
      const scope = u.searchParams.get("scope") as PrList["scope"];
      const rows = scope === "review" ? REVIEW : scope === "mine" ? MINE : [...REVIEW, ...MINE];
      return route.fulfill({ json: { scope, rows, viewer: { login: "me" } } satisfies PrList });
    }
    if (name === "pr") {
      const r = [...REVIEW, ...MINE].find((x) => x.number === Number(u.searchParams.get("number")))!;
      return route.fulfill({ json: detail(r) });
    }
    if (name === "diff") return route.fulfill({ json: DIFF });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  await page.route("**/api/changes?**", (route) => {
    const u = new URL(route.request().url());
    asked.push({ path: u.pathname, query: Object.fromEntries(u.searchParams) });
    return route.fulfill({ json: CHANGES(u.searchParams.get("mode") ?? "all") });
  });
  return { asked, writes };
}

test("GitHub lists PRs to review, opens one, drafts a line comment and submits an approval", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { asked, writes } = await setUp(page);
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");

    // Review requests, with each list's count in the sidebar.
    await view.locator(".gh-row").first().waitFor();
    assert.deepEqual(await view.locator(".gh-row-title").allTextContents(), ["Add the GitHub tab", "Fix the shoreline"]);
    await waitFor(
      () => view.locator(".gh-nav-item .gh-count").allTextContents(),
      (counts) => counts.join() === "2,1,3",
      "the sidebar's counts",
    );
    // Keyboard: J moves, K back, J again, Enter opens #13.
    await view.locator(".gh-row").first().focus();
    await page.keyboard.press("j");
    await view.locator(".gh-row.selected", { hasText: "Fix the shoreline" }).waitFor();
    await page.keyboard.press("k");
    await view.locator(".gh-row.selected", { hasText: "Add the GitHub tab" }).waitFor();
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await view.locator(".gh-pr-title", { hasText: "Fix the shoreline" }).waitFor();
    await view.locator(".gh-body", { hasText: "the GitHub tab" }).waitFor();
    assert.ok(!asked.some((a) => a.path.endsWith("/diff")), "the diff waits for Files changed");

    // 2: Files changed asks for the diff and shows each file; U splits it.
    await view.locator(".gh-pr-title").click();
    await page.keyboard.press("2");
    await view.locator(".gd-file").nth(1).waitFor();
    assert.ok(asked.some((a) => a.path.endsWith("/q/diff") && a.query.number === "13"));
    assert.deepEqual(
      await view.locator(".gd-file").evaluateAll((s) => s.map((e) => (e as HTMLElement).dataset.path)),
      ["src/a.ts", "src/b.ts"],
    );
    // @pierre/diffs draws them in an open shadow root, which locators reach.
    await page.keyboard.press("u");
    await view.locator('[data-diff-type="split"]').first().waitFor();
    await page.keyboard.press("u");
    await view.locator('[data-diff-type="single"]').first().waitFor();

    // A line comment on src/a.ts's new line 3 ("const c = 4;"), kept as a pending draft.
    const added = view.locator('.gd-file[data-path="src/a.ts"] [data-line="3"][data-line-type="change-addition"]').first();
    await added.hover();
    await view.locator('.gd-file[data-path="src/a.ts"] [data-utility-button]').click();
    const box = view.locator(".gh-notes textarea");
    await box.fill("Name this constant?");
    await box.press("Meta+Enter");
    await view.locator(".gh-draft .gh-pending").waitFor();
    assert.equal(await view.locator(".gh-pending-count").textContent(), "1");

    // ⌘K offers submitting the review while a PR shows.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Submit your review");
    await palette.getByRole("option", { name: /Submit your review \(1 pending\)/ }).waitFor();
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });

    // R opens the review panel; Approve and submit.
    await view.locator(".gh-pr-title").click();
    await page.keyboard.press("r");
    const panel = view.getByRole("dialog", { name: "Submit your review" });
    await panel.waitFor();
    await panel.locator("textarea").fill("Looks good");
    await panel.getByRole("radio", { name: /Approve/ }).check();
    await panel.getByRole("button", { name: "Submit review" }).click();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 1, "the review write");
    assert.equal(writes[0]!.path, "/api/github/m/review");
    assert.deepEqual(writes[0]!.body, {
      repo: "acme/atlas",
      number: 13,
      event: "APPROVE",
      body: "Looks good",
      commitId: SHA,
      comments: [{ path: "src/a.ts", line: 3, side: "RIGHT", body: "Name this constant?" }],
    });
    await panel.waitFor({ state: "detached" });
    await view.locator(".gh-draft").waitFor({ state: "detached" });
    assert.equal(await view.locator(".gh-pending-count").count(), 0);

    // Viewed: written, and the file folds.
    await view.locator('.gd-file[data-path="src/b.ts"] .gd-viewed input').check();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 2, "the viewed write");
    assert.deepEqual(writes[1], {
      path: "/api/github/m/viewed",
      query: {},
      body: { prId: "PR_13", path: "src/b.ts", viewed: true },
    });
    await view.locator('.gd-file.folded[data-path="src/b.ts"]').waitFor();

    // Esc goes back to the list.
    await view.locator(".gh-pr-title").click();
    await page.keyboard.press("Escape");
    await view.locator(".gh-row").first().waitFor();
    assert.equal(await view.locator(".gh-head h2").first().textContent(), "Review requests2");
  } finally {
    await context.close();
  }
});

test("GitHub shows the selected workspace's changes against main, all or committed", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { asked } = await setUp(page);
  try {
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();

    // ⌘K offers the tab while it isn't showing.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Show GitHub");
    await palette.getByRole("option", { name: /Show GitHub/ }).waitFor();
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });

    await showGithub(page);
    const view = page.locator(".github-view");
    await view.getByRole("button", { name: /Map polish/ }).click();
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
  } finally {
    await context.close();
  }
});
