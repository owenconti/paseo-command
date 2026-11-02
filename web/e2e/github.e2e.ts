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
import type { DiffFile, PrCheck, PrDetail, PrDiff, PrList, PrRow, RepoList, RepoPeople, RepoSearch, RepoTeams, WorkspaceChanges } from "../src/github/types";
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
const TOOLS: PrRow[] = [row(31, "Tools: faster build", { repo: "sam/tools", url: "https://github.com/sam/tools/pull/31" }), row(32, "Tools: approved one", { repo: "sam/tools", url: "https://github.com/sam/tools/pull/32", reviewDecision: "approved" })];
const REPOS: RepoList = {
  repos: [
    { repo: "acme/atlas", owner: "acme", open: 3, starred: true, ownerStarred: false, private: false },
    { repo: "sam/tools", owner: "sam", open: 2, starred: false, ownerStarred: false, private: true },
  ],
  stars: { repos: ["acme/atlas"], orgs: [] },
};
const PEOPLE: RepoPeople = {
  repo: "sam/tools",
  viewer: { login: "me", name: "Me" },
  people: [sam, { login: "ada", name: "Ada Lovelace" }, { login: "bob" }],
};
const found = (q: string): RepoSearch => ({
  query: q,
  repos: [
    { repo: "sam/tools", owner: "sam", open: 2, starred: false, ownerStarred: false, private: true },
    { repo: "sam/toolbox", owner: "sam", open: 0, starred: false, ownerStarred: false, private: false },
  ].filter((r) => r.repo.includes(q.toLowerCase().replace(/^sam\/?/, ""))),
  ...(q.toLowerCase() === "sam" ? { owner: { login: "sam", starred: false } } : {}),
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
const DIFF: PrDiff = { files: [file("src/a.ts"), file("src/b.ts")], tooLarge: false };

const detail = (r: PrRow): PrDetail => ({
  ...r,
  body: "This adds **the GitHub tab** to the app.",
  headSha: SHA,
  headRepo: r.repo,
  mergeable: "mergeable",
  viewerIsAuthor: false,
  files: DIFF.files.map((f) => ({ path: f.path, additions: 2, deletions: 1, changeType: "modified", viewed: "unviewed" })),
  timeline: [],
  threads: [],
  commits: [{ sha: SHA, title: "Add it", author: sam, at: ago(30) }],
  checkRuns: [{ name: "test", state: "passing" }],
  reviewers: [{ kind: "user", login: "me", requested: true, verdict: null }],
  assignees: [],
});
const TEAMS: RepoTeams = { repo: "acme/atlas", teams: [{ slug: "map-team", name: "Map team" }] };
/** #12's checks: one failing, one running, seven passing and a skipped one. */
const CHECKS: PrCheck[] = [
  ...Array.from({ length: 7 }, (_, i): PrCheck => ({ name: `unit ${i + 1}`, state: "passing", source: "CI", startedAt: ago(20), completedAt: ago(18), url: `https://github.com/acme/atlas/actions/runs/${i + 1}` })),
  { name: "deploy preview", state: "pending", source: "vercel", startedAt: ago(3) },
  { name: "lint", state: "failing", source: "CI", startedAt: ago(10), completedAt: ago(9), url: "https://github.com/acme/atlas/actions/runs/99", summary: "2 errors" },
  { name: "docs", state: "skipped", source: "CI" },
];

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

async function setUp(page: Page, opts: { refuse?: Set<string>; workspaces?: typeof small.workspaces; agents?: typeof small.agents } = {}) {
  await mockApi(page, {
    agents: () => opts.agents ?? small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => opts.workspaces ?? small.workspaces,
    lists: { settings: { integrations: { github: true, linear: false, slack: false, typesafe: false } } },
  });
  const asked: Asked[] = [];
  const writes: Asked[] = [];
  const prs = new Map<number, PrDetail>();
  // Registered after mockApi, so these answer first.
  await page.route("**/api/github/**", async (route) => {
    const u = new URL(route.request().url());
    const entry: Asked = { path: u.pathname, query: Object.fromEntries(u.searchParams) };
    if (route.request().method() === "POST") {
      entry.body = route.request().postDataJSON();
      writes.push(entry);
      if (opts.refuse?.has(entry.path)) return route.fulfill({ status: 422, json: { error: "Reviews may only be requested from collaborators." } });
      // GitHub keeps what's written: the PR read next says so.
      const w = entry.body as { number?: number; action?: string; users?: string[]; teams?: string[] };
      const pr = w.number ? prs.get(w.number) : undefined;
      if (pr && entry.path.endsWith("/m/assignees"))
        pr.assignees = w.action === "add" ? [...pr.assignees, ...w.users!.map((login) => ({ login }))] : pr.assignees.filter((a) => !w.users!.includes(a.login));
      if (pr && entry.path.endsWith("/m/reviewers")) {
        const items = [...w.users!.map((login) => ({ kind: "user" as const, login })), ...w.teams!.map((login) => ({ kind: "team" as const, login }))];
        for (const item of items) {
          const was = pr.reviewers.find((r) => r.kind === item.kind && r.login === item.login);
          if (w.action === "add") was ? (was.requested = true) : pr.reviewers.push({ ...item, requested: true, verdict: null });
          else if (was) was.verdict ? (was.requested = false) : pr.reviewers.splice(pr.reviewers.indexOf(was), 1);
        }
      }
      return route.fulfill({ json: entry.path.endsWith("/m/star") ? { ok: true, stars: REPOS.stars } : { ok: true } });
    }
    asked.push(entry);
    const name = u.pathname.replace("/api/github/q/", "");
    if (name === "viewer") return route.fulfill({ json: { viewer: { login: "me" } } });
    if (name === "repos") return route.fulfill({ json: REPOS });
    if (name === "repoSearch") return route.fulfill({ json: found(u.searchParams.get("q") ?? "") });
    if (name === "people") return route.fulfill({ json: { ...PEOPLE, repo: u.searchParams.get("repo")! } });
    if (name === "teams") return route.fulfill({ json: TEAMS });
    if (name === "prs" && u.searchParams.get("repo")) {
      const repo = u.searchParams.get("repo")!;
      let rows = repo === "sam/tools" ? TOOLS : REVIEW;
      if (u.searchParams.get("review") === "approved") rows = rows.filter((r) => r.reviewDecision === "approved");
      const authors = u.searchParams.get("author")?.split(",");
      if (authors) rows = rows.filter((r) => authors.some((a) => (a === "@me" ? "me" : a) === r.author?.login));
      return route.fulfill({ json: { repo, rows, total: rows.length, viewer: { login: "me" } } satisfies PrList });
    }
    if (name === "prs") {
      const scope = u.searchParams.get("scope") as PrList["scope"];
      const rows = scope === "review" ? REVIEW : scope === "mine" ? MINE : [...REVIEW, ...MINE];
      return route.fulfill({ json: { scope, rows, viewer: { login: "me" } } satisfies PrList });
    }
    if (name === "pr") {
      const r = [...REVIEW, ...MINE].find((x) => x.number === Number(u.searchParams.get("number")))!;
      const kept = prs.get(r.number);
      if (kept) return route.fulfill({ json: kept });
      const d = detail(r);
      prs.set(r.number, d);
      if (r.number === 12)
        Object.assign(d, {
          checkRuns: CHECKS,
          reviewers: [
            { kind: "user", login: "me", requested: true, verdict: null },
            { kind: "user", login: "bob", requested: false, verdict: "approved" },
          ],
          assignees: [sam],
        });
      return route.fulfill({ json: d });
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
      (counts) => counts.join() === "2,1,3,3",
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

test("A PR's reviewers and assignees are edited in place, rolled back if GitHub refuses; its checks are listed", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const refuse = new Set<string>();
  const { writes } = await setUp(page, { refuse });
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-row", { hasText: "Add the GitHub tab" }).click();
    const side = view.getByRole("complementary", { name: "About this pull request" });
    const reviewers = side.getByRole("list", { name: "Reviewers" });
    await reviewers.locator("li").nth(1).waitFor();
    assert.deepEqual(await reviewers.locator(".gh-person-name").allTextContents(), ["me", "bob"]);
    await reviewers.getByLabel("Awaiting review").waitFor();
    await reviewers.getByLabel("Approved", { exact: true }).waitFor();
    assert.deepEqual(await side.getByRole("list", { name: "Assignees" }).locator(".gh-person-name").allTextContents(), ["sam"]);

    // Checks: failing, then running, then passing folded behind a toggle.
    const checks = side.getByRole("list", { name: "Checks" });
    assert.deepEqual(await checks.locator(".gh-side-check-name").allTextContents(), ["lint", "deploy preview"]);
    assert.match((await checks.locator("li").nth(0).locator("small").textContent())!, /^CI · 1m$/);
    assert.match((await checks.locator("li").nth(1).locator("small").textContent())!, /^vercel · running for 3m$/);
    await side.getByRole("button", { name: "Show 7 passing, 1 skipped" }).click();
    await waitFor(() => checks.locator("li").count(), (n) => n === 10, "every check");
    assert.equal(await checks.locator(".gh-side-check-name").nth(2).textContent(), "unit 1");

    // The gear's picker: you first, the author (sam) left out, a team offered; picking ada asks her.
    await side.getByRole("button", { name: "Request review…" }).click();
    const picker = page.getByRole("listbox", { name: "Request a review" });
    await picker.getByRole("option", { name: /Map team/ }).waitFor();
    const offered = await picker.getByRole("option").allTextContents();
    assert.ok(offered[0]!.includes("You"), offered.join());
    assert.ok(!offered.some((o) => o.includes("sam")), offered.join());
    await picker.getByRole("option", { name: /^ada/ }).click();
    await reviewers.locator(".gh-person-name", { hasText: "ada" }).waitFor();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 1, "the reviewers write");
    assert.deepEqual(writes[0], {
      path: "/api/github/m/reviewers",
      query: {},
      body: { repo: "acme/atlas", number: 12, action: "add", users: ["ada"], teams: [] },
    });
    await picker.getByRole("option", { name: /Map team/ }).click();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 2, "the team's write");
    assert.deepEqual((writes[1]!.body as { teams: string[] }).teams, ["map-team"]);
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "detached" });

    // Re-request bob's review from his row; remove your own request.
    await reviewers.locator("li", { hasText: "bob" }).hover();
    await reviewers.getByRole("button", { name: "Re-request review from bob" }).click();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 3, "the re-request");
    assert.deepEqual(writes[2]!.body, { repo: "acme/atlas", number: 12, action: "add", users: ["bob"], teams: [] });
    await reviewers.locator("li", { hasText: "me" }).hover();
    await reviewers.getByRole("button", { name: "Remove the review request for me" }).click();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 4, "the removal");
    assert.equal((writes[3]!.body as { action: string }).action, "remove");

    // A refused write: shown at once, then put back, the notice saying why.
    refuse.add("/api/github/m/assignees");
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Assign…");
    await palette.getByRole("option", { name: /^Assign…/ }).click();
    const assign = page.getByRole("listbox", { name: "Assign" });
    await assign.getByRole("option", { name: /^ada/ }).click();
    await page.locator(".toast", { hasText: "Couldn’t assign ada: Reviews may only be requested from collaborators." }).waitFor();
    await waitFor(
      () => side.getByRole("list", { name: "Assignees" }).locator(".gh-person-name").allTextContents(),
      (names) => names.join() === "sam",
      "the assignee put back",
    );
    assert.deepEqual(writes.at(-1)!.body, { repo: "acme/atlas", number: 12, action: "add", users: ["ada"] });
    await page.keyboard.press("Escape");
    await assign.waitFor({ state: "detached" });

    // ⌘K's Request review… opens the reviewers' picker.
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Request review");
    await palette.getByRole("option", { name: /^Request review…/ }).click();
    await page.getByRole("listbox", { name: "Request a review" }).waitFor();
  } finally {
    await context.close();
  }
});

test("A PR whose branch a Paseo workspace has checked out opens its most recent agent, a menu choosing among several", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  // The app's message channel, recording what the page asks of it.
  await page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(m) } } };
  `);
  const repo = "https://github.com/acme/atlas";
  // #12's branch is checked out in Map polish (here) and Deploy (macmini); Paseo names #13 as Labels' PR; #20's branch is nowhere.
  const workspaces = small.workspaces.map((w) =>
    w.workspaceId === "wks_a" || w.workspaceId === "wks_d"
      ? { ...w, branch: "feature-12", repo }
      : w.workspaceId === "wks_b"
        ? { ...w, branch: "labels", repo, pr: { number: 13, title: "Fix the shoreline", state: "open", url: "https://github.com/acme/atlas/pull/13" } }
        : w,
  );
  // Runner (running) is Map polish's most recent agent; Finisher Labels'.
  const agents = small.agents.map((a) =>
    a.id === "a-idle" ? { ...a, updatedAt: ago(1) } : a.id === "a-running" ? { ...a, updatedAt: ago(30) } : a.id === "a-done" ? { ...a, updatedAt: ago(2) } : a.id === "a-approval" ? { ...a, updatedAt: ago(10) } : a,
  );
  await setUp(page, { workspaces, agents });
  const sent = () => page.evaluate(() => (window as unknown as { sentToApp: { type: string; action?: string }[] }).sentToApp);
  const commandAsked = async () => (await sent()).filter((m) => m.type === "menu" && m.action === "command").length;
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");

    // #13: Paseo's own link to it; one workspace, so the button opens its agent at once.
    await view.locator(".gh-row", { hasText: "Fix the shoreline" }).click();
    await view.locator(".gh-pr-title", { hasText: "Fix the shoreline" }).waitFor();
    await view.getByRole("button", { name: "Open Paseo agent" }).click();
    await waitFor(() => page.evaluate(() => location.search), (q) => q.includes("agent=a-done"), "Finisher selected");
    await waitFor(commandAsked, (n) => n === 1, "the map asked for");

    // #12: two workspaces on its branch; a menu chooses, host · project · workspace.
    await view.locator(".gh-nav-item", { hasText: "Review requests" }).click();
    await view.locator(".gh-row", { hasText: "Add the GitHub tab" }).click();
    await view.locator(".gh-pr-title", { hasText: "Add the GitHub tab" }).waitFor();
    await view.getByRole("button", { name: "Open Paseo agent" }).click();
    const menu = page.getByRole("menu", { name: "Open the Paseo agent in" });
    assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["local · atlas · Map polish", "macmini · infra · Deploy"]);
    await menu.getByRole("menuitem", { name: "local · atlas · Map polish" }).click();
    await waitFor(() => page.evaluate(() => location.search), (q) => q.includes("agent=a-running"), "Runner selected");
    await waitFor(commandAsked, (n) => n === 2, "the map asked for again");

    // ⌘K has one entry for each.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Open the Paseo agent");
    await palette.getByRole("option", { name: /for this pull request in macmini · infra · Deploy/ }).click();
    await waitFor(() => page.evaluate(() => location.search), (q) => q.includes("a-offline"), "Far away selected");

    // #20: nobody has its branch, so nothing new shows, nor in ⌘K.
    await view.locator(".gh-nav-item", { hasText: "Your pull requests" }).click();
    await view.locator(".gh-row", { hasText: "My own change" }).click();
    await view.locator(".gh-pr-title", { hasText: "My own change" }).waitFor();
    assert.equal(await view.getByRole("button", { name: "Open Paseo agent" }).count(), 0);
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Open the Paseo agent");
    await palette.getByRole("option").first().waitFor();
    assert.equal(await palette.getByRole("option", { name: /for this pull request/ }).count(), 0);
    await page.keyboard.press("Escape");
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

test("The diff's file list resizes by its edge (drag, keys, double-click), kept across reloads, and leaves the diff room", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setUp(page);
  try {
    const open = async () => {
      await page.goto(`${app.url}?workspace=wks_a`);
      await page.locator(".place").waitFor();
      await showGithub(page);
      await page
        .locator(".github-view")
        .getByRole("button", { name: /Map polish/ })
        .click();
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

test("GitHub's sidebar: favourites, finding any repository, ⌘S, and a repository's filters (people too)", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { asked, writes } = await setUp(page);
  try {
    // A repository's author filter kept from before (anyone or you) comes back as you.
    await page.addInitScript(() => {
      if (!localStorage.getItem("paseo:e2e-seeded")) {
        localStorage.setItem("paseo:e2e-seeded", "1");
        localStorage.setItem("paseo-command:github:repoFilters", JSON.stringify({ "sam/tools": { state: "open", author: "me" } }));
      }
    });
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");

    // Only Favourites (the starred acme/atlas): no list of every repository.
    await view.locator(".gh-repo-row").first().waitFor();
    assert.deepEqual(await view.locator(".gh-nav-sub").allTextContents(), ["Favourites"]);
    assert.deepEqual(await view.locator(".gh-repo-row .gh-nav-label").allTextContents(), ["atlas"]);
    assert.equal(await view.getByRole("button", { name: "Unstar acme/atlas" }).getAttribute("aria-pressed"), "true");

    // Typing finds repositories: GitHub is asked once typing pauses; Enter opens the first.
    const box = view.getByRole("searchbox", { name: "Find a repository" });
    await box.fill("tool");
    await waitFor(() => view.locator(".gh-repo-found .gh-nav-label").allTextContents(), (t) => t.join() === "sam/tools,sam/toolbox", "what's found");
    assert.ok(asked.some((a) => a.path.endsWith("/q/repoSearch") && a.query.q === "tool"));
    // ↓ moves into what's found; a star there stars it.
    await view.getByRole("button", { name: "Star sam/toolbox" }).click();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 1, "the star write");
    assert.deepEqual(writes[0], { path: "/api/github/m/star", query: {}, body: { kind: "repo", name: "sam/toolbox", starred: true } });
    await box.focus();
    await box.press("Enter");
    await view.locator(".gh-head h2", { hasText: "sam/tools" }).waitFor();
    // The field clears; the open repository stays in the sidebar though it isn't a favourite.
    assert.equal(await box.inputValue(), "");
    assert.deepEqual(await view.locator(".gh-nav-sub").allTextContents(), ["Favourites", "Open"]);
    assert.equal(await view.locator(".gh-repo-row .gh-nav-item.selected .gh-nav-label").textContent(), "sam/tools");

    // The old author filter (you) came back, as a people filter.
    await view.getByRole("button", { name: "Author: You. Change" }).waitFor();
    await waitFor(() => view.locator(".gh-row-title").allTextContents(), (t) => t.length === 0, "your (none) pull requests");
    assert.ok(asked.some((a) => a.query.repo === "sam/tools" && a.query.author === "@me"));

    // Author: the repository's people, you first, with names to search by; several at once.
    await view.getByRole("button", { name: "Author: You. Change" }).click();
    const picker = view.getByRole("listbox", { name: "Author" });
    await waitFor(() => picker.locator(".linear-picker-text").allTextContents(), (t) => t.join() === "You,sam,ada,bob", "the repository's people");
    assert.ok(asked.some((a) => a.path.endsWith("/q/people") && a.query.repo === "sam/tools"));
    await view.getByRole("combobox", { name: "Filter author" }).fill("lovelace");
    assert.deepEqual(await picker.locator(".linear-picker-text").allTextContents(), ["ada"]);
    await view.getByRole("combobox", { name: "Filter author" }).fill("");
    await picker.getByRole("option", { name: /sam/ }).click();
    await waitFor(() => view.locator(".gh-row-title").allTextContents(), (t) => t.join() === "Tools: faster build,Tools: approved one", "sam's pull requests");
    assert.ok(asked.some((a) => a.query.repo === "sam/tools" && a.query.author === "@me,sam"));
    await page.keyboard.press("Escape");
    await view.getByRole("button", { name: "Author: You, sam. Change" }).waitFor();
    assert.match((await view.locator(".gh-filters .linear-filter-chip").nth(1).textContent()) ?? "", /Authoris any ofYou, sam/);

    // F: the filter menu offers every filter, people ones too; Review → Approved asks GitHub with it.
    await view.locator(".gh-row").first().focus();
    await page.keyboard.press("f");
    const menu = view.getByRole("menu", { name: "Filter by" });
    assert.deepEqual(
      (await menu.getByRole("menuitem").allTextContents()).map((t) => t.replace(/You.*$/, "")),
      ["State", "Author", "Reviewer", "Assignee", "Review", "Draft", "CI"],
    );
    await menu.getByRole("menuitem", { name: /^Review$/ }).click();
    await view.getByRole("listbox", { name: "Review" }).getByRole("option", { name: "Approved" }).click();
    await waitFor(() => view.locator(".gh-row-title").allTextContents(), (t) => t.join() === "Tools: approved one", "the filtered list");
    assert.ok(asked.some((a) => a.query.repo === "sam/tools" && a.query.review === "approved" && a.query.author === "@me,sam"));

    // The place and its filters come back after a reload.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    await view.locator(".gh-head h2", { hasText: "sam/tools" }).waitFor();
    await view.getByRole("button", { name: "Review: Approved. Change" }).waitFor();
    await view.getByRole("button", { name: "Author: You, sam. Change" }).waitFor();
    // × removes a filter.
    await view.getByRole("button", { name: "Remove the review filter" }).click();
    await view.getByRole("button", { name: "Remove the author filter" }).click();
    await waitFor(() => view.locator(".gh-row").count(), (n) => n === 2, "the unfiltered list");

    // ⌘S hides the sidebar (kept), and shows it again; a PR's view too.
    await view.locator(".gh-row").first().focus();
    await page.keyboard.press("Meta+s");
    await view.locator(".gh-sidebar").waitFor({ state: "hidden" });
    await view.getByRole("button", { name: "Show the GitHub sidebar" }).waitFor();
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    await view.getByRole("button", { name: "Show the GitHub sidebar" }).waitFor();
    assert.equal(await view.locator(".gh-sidebar").isVisible(), false);
    await view.getByRole("button", { name: "Show the GitHub sidebar" }).click();
    await view.locator(".gh-sidebar").waitFor();

    // ⌘K: Find a GitHub repository… (the sidebar's field; an owner found can be starred).
    await page.keyboard.press("Meta+s");
    await view.locator(".gh-sidebar").waitFor({ state: "hidden" });
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Find a GitHub repository");
    await palette.getByRole("option", { name: /Find a GitHub repository/ }).click();
    await palette.waitFor({ state: "detached" });
    await waitFor(() => box.evaluate((el) => el === document.activeElement), (v) => v, "the search field focused, the sidebar shown");
    await page.keyboard.type("sam");
    await view.locator(".gh-found-owner", { hasText: "sam" }).waitFor();
    await view.getByRole("button", { name: "Star sam", exact: true }).click();
    await waitFor(() => Promise.resolve(writes.length), (n) => n === 2, "the organization's star");
    assert.deepEqual(writes[1]!.body, { kind: "org", name: "sam", starred: true });
    await box.press("Escape");
    assert.equal(await box.inputValue(), "");

    // ⌘K: the sidebar toggle, and opening a repository's pull requests.
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Show or hide the GitHub sidebar");
    await palette.getByRole("option", { name: /Show or hide the GitHub sidebar/ }).click();
    await view.locator(".gh-sidebar").waitFor({ state: "hidden" });
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Open acme/atlas");
    await palette.getByRole("option", { name: /Open acme\/atlas’s pull requests/ }).click();
    await view.locator(".gh-head h2", { hasText: "acme/atlas" }).waitFor();
  } finally {
    await context.close();
  }
});
