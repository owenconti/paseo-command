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
import { launch, mockApi, newContext, startApp, waitFor, appEvent } from "./harness";

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
  merge: {
    status: "clean",
    methods: ["merge", "squash"],
    canMerge: true,
    canMergeAsAdmin: false,
    canUpdate: true,
    canClose: true,
    canReopen: true,
    canUpdateBranch: false,
    autoMergeAllowed: false,
    canEnableAutoMerge: false,
    canDisableAutoMerge: false,
    autoMerge: null,
    queueRequired: false,
    queue: null,
    deleteBranchOnMerge: false,
    headBranchExists: true,
    canDeleteBranch: true,
    messages: {},
  },
});
/** #20 as GitHub renders it: a description with a folded block and an alert, a dependency bot's table, a hostile
 * comment, one of only a hidden marker, and a line comment; each beside its Markdown. */
const CAMO = "https://camo.githubusercontent.com/5c0ffee/68747470733a2f2f";
const RENDERED: Partial<PrDetail> = {
  body: "Adds it.\n\n<details><summary>Why</summary>\n\nThe list was **short**.\n\n</details>",
  html:
    '<p dir="auto">Adds it, see <a href="https://github.com/acme/atlas/pull/13">#13</a>.</p>' +
    '<details><summary>Why</summary><p dir="auto">The list was <strong>short</strong>; press <kbd>⌘K</kbd>.</p></details>' +
    '<div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0Z"></path></svg>Note</p><p dir="auto">Mind the gap.</p></div>' +
    '<div class="highlight highlight-source-ts notranslate position-relative overflow-auto" dir="auto"><pre><span class="pl-k">const</span> <span class="pl-s1">b</span> <span class="pl-c1">=</span> <span class="pl-c1">3</span><span class="pl-kos">;</span> <span class="pl-c">// was 2</span></pre></div>' +
    '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> Tests</li></ul>',
  timeline: [
    {
      kind: "comment",
      id: "IC_bot",
      author: { login: "socket-security" },
      body: "Review the following changes…\n\n<table>…</table>\n\n<!-- overview-comment -->",
      html:
        '<p dir="auto">Review the following changes in direct dependencies. Learn more about <a href="https://socket.dev" rel="nofollow">Socket for GitHub</a>.</p>' +
        '<markdown-accessiblity-table><table><thead><tr><th>Diff</th><th width="200px">Package</th><th align="center">Supply Chain<br>Security</th></tr></thead>' +
        `<tbody><tr><td><a href="https://socket.dev/diff/npm/left-pad">Added</a></td><td>left-pad@1.3.0</td><td align="center"><img src="${CAMO}" alt="100" width="50" height="40"></td></tr></tbody></table></markdown-accessiblity-table>` +
        '<p dir="auto"><a href="https://socket.dev/report" rel="nofollow">View full report</a></p>',
      createdAt: ago(50),
      url: "https://github.com/acme/atlas/pull/20#issuecomment-1",
    },
    {
      kind: "comment",
      id: "IC_hostile",
      author: { login: "mallory" },
      body: "hi",
      html: '<p>Hello<img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script><a href="javascript:window.__pwned=3">click</a><iframe src="https://evil.example"></iframe></p><style>.github-view{display:none}</style>',
      createdAt: ago(45),
      url: "https://github.com/acme/atlas/pull/20#issuecomment-2",
    },
    { kind: "comment", id: "IC_marker", author: { login: "bot" }, body: "<!-- marker -->", html: "", createdAt: ago(44), url: "https://github.com/acme/atlas/pull/20#issuecomment-3" },
    { kind: "comment", id: "IC_md", author: sam, body: "Plain **Markdown**\n\n<!-- still hidden -->", createdAt: ago(40), url: "https://github.com/acme/atlas/pull/20#issuecomment-4" },
  ],
};
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
  appEvent(page, "paseo:mode", { mode: "github" });

type Asked = { path: string; query: Record<string, string>; body?: unknown };

async function setUp(page: Page, opts: { refuse?: Set<string>; workspaces?: typeof small.workspaces; agents?: typeof small.agents; github?: boolean } = {}) {
  await mockApi(page, {
    agents: () => opts.agents ?? small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => opts.workspaces ?? small.workspaces,
    lists: { settings: { integrations: { github: opts.github ?? true, linear: false, typesafe: false } } },
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
      const w = entry.body as { number?: number; action?: string; users?: string[]; teams?: string[]; body?: string };
      const pr = w.number ? prs.get(w.number) : undefined;
      if (pr && entry.path.endsWith("/m/comment"))
        pr.timeline = [
          ...pr.timeline,
          { kind: "comment", id: `IC_new${pr.timeline.length}`, author: { login: "me" }, body: w.body!, createdAt: new Date().toISOString(), url: `${pr.url}#new` },
        ];
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
      if (r.number === 20) Object.assign(d, RENDERED);
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
    assert.equal(await view.locator(".page-btn-count").textContent(), "1");

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
    assert.equal(await view.locator(".page-btn-count").count(), 0);

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

test("A PR's conversation: the description first, then Comments newest first, or oldest first as chosen (kept across reloads and ⌘K), and a posted comment shows in its place", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.route("https://camo.githubusercontent.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="40"/>' }));
  const { writes } = await setUp(page);
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-nav-item", { hasText: "Your pull requests" }).click();
    await view.locator(".gh-row", { hasText: "My own change" }).click();
    await view.locator(".gh-entry.description").waitFor();
    const order = () =>
      view.locator(".gh-entry").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.entry ?? (e.classList.contains("composer") ? "box" : "description")));
    const inView = (id: string) =>
      view.locator(`[data-entry="${id}"]`).evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.top >= 0 && r.top < innerHeight;
      });
    const head = view.locator(".gh-comments-head");
    const toggle = head.getByRole("radiogroup", { name: "Conversation order" });
    // The description, then the Comments head (with its count and the toggle), then the comments.
    const layout = () =>
      view.locator(".gh-conversation-main > *").evaluateAll((els) =>
        els.map((e) => (e.classList.contains("gh-comments-head") ? "head" : ((e as HTMLElement).dataset.entry ?? (e.classList.contains("composer") ? "box" : "description")))),
      );
    assert.equal((await head.locator("h3").innerText()).replace(/\s+/g, " "), "Comments · 4");

    // Newest first by default: the description, the head, the comment box, then the newest comment first.
    assert.deepEqual(await layout(), ["description", "head", "box", "IC_md", "IC_marker", "IC_hostile", "IC_bot"]);
    assert.equal(await toggle.getByRole("radio", { name: "Newest first" }).getAttribute("aria-checked"), "true");

    // Oldest first: as GitHub lists it, the description still first, the box at the foot; kept across a reload.
    await toggle.getByRole("radio", { name: "Oldest first" }).click();
    assert.deepEqual(await order(), ["description", "IC_bot", "IC_hostile", "IC_marker", "IC_md", "box"]);
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    await view.locator(".gh-entry.description").waitFor();
    assert.deepEqual(await order(), ["description", "IC_bot", "IC_hostile", "IC_marker", "IC_md", "box"]);

    // Posting oldest first: the comment goes above the box, in view.
    const box = view.locator("#gh-pr-comment textarea");
    await box.fill("First from me");
    await view.locator("#gh-pr-comment").getByRole("button", { name: "Comment" }).click();
    await view.locator('[data-entry="IC_new4"]', { hasText: "First from me" }).waitFor();
    assert.deepEqual(await layout(), ["description", "head", "IC_bot", "IC_hostile", "IC_marker", "IC_md", "IC_new4", "box"]);
    await waitFor(() => head.locator("h3").innerText(), (t) => t.replace(/\s+/g, " ") === "Comments · 5", "the count");
    await waitFor(() => inView("IC_new4"), (v) => v, "the new comment in view");
    assert.equal(await box.inputValue(), "");
    assert.ok(writes.some((w) => w.path.endsWith("/m/comment") && (w.body as { body: string }).body === "First from me"));

    // ⌘K turns it newest first; then a comment goes just under the box, in view.
    await view.locator(".gh-pr-title").click();
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("conversation newest first");
    await palette.getByRole("option", { name: /Show the conversation newest first.*GitHub/ }).click();
    await palette.waitFor({ state: "detached" });
    await waitFor(order, (o) => o.join() === "description,box,IC_new4,IC_md,IC_marker,IC_hostile,IC_bot", "newest first");
    // Scrolled to the foot, the box and the newest comments out of sight above.
    await view.locator(".gh-conversation").evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await box.fill("Second from me");
    await view.locator("#gh-pr-comment").getByRole("button", { name: "Comment" }).click();
    await view.locator('[data-entry="IC_new5"]', { hasText: "Second from me" }).waitFor();
    assert.deepEqual(await layout(), ["description", "head", "box", "IC_new5", "IC_new4", "IC_md", "IC_marker", "IC_hostile", "IC_bot"]);
    await waitFor(() => inView("IC_new5"), (v) => v, "the new comment in view");

    // ⌘K offers the other order now.
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("conversation oldest first");
    await palette.getByRole("option", { name: /Show the conversation oldest first/ }).waitFor();
    assert.equal(await palette.getByRole("option", { name: /Show the conversation newest first/ }).count(), 0);
    await page.keyboard.press("Escape");

    if (process.env.GITHUB_SHOT) {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await view.locator(".gh-conversation").evaluate((e) => e.closest(".gh-main-inner, .gh-main")?.scrollTo(0, 0));
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.screenshot({ path: `${process.env.GITHUB_SHOT}/newest-${scheme}.png` });
      }
    }
  } finally {
    await context.close();
  }
});

test("A PR's description and comments render as GitHub shows them: tables, images, details, alerts; nothing hostile; links in the app", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const images: string[] = [];
  // GitHub's image proxy, answered here: nothing reaches GitHub.
  await page.route("https://camo.githubusercontent.com/**", (route) => {
    images.push(route.request().url());
    return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="40"><rect width="50" height="40" fill="#2a2"/></svg>' });
  });
  await page.route("https://evil.example/**", (route) => route.abort());
  await setUp(page);
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-nav-item", { hasText: "Your pull requests" }).click();
    await view.locator(".gh-row", { hasText: "My own change" }).click();
    const entries = view.locator(".gh-entry");
    const bot = entries.filter({ hasText: "socket-security" });
    await bot.locator("table").waitFor();
    // The table, not its markup as text, and no hidden marker.
    const botText = await bot.innerText();
    assert.ok(!botText.includes("<table>") && !botText.includes("<br") && !botText.includes("overview-comment"), botText);
    assert.deepEqual(await bot.locator("th").allTextContents(), ["Diff", "Package", "Supply ChainSecurity"]);
    assert.equal(await bot.locator(".md-table").count(), 1, "a wide table scrolls in its frame");
    const img = bot.locator("img");
    assert.equal(await img.getAttribute("loading"), "lazy");
    await waitFor(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), (w) => w === 50, "the camo image loads");
    assert.deepEqual(images, [CAMO]);
    await bot.getByRole("link", { name: "View full report" }).waitFor();

    // The description: a folded block that opens, an alert, a task box.
    const description = view.locator(".gh-entry.description");
    const details = description.locator("details");
    assert.equal(await details.evaluate((d: HTMLDetailsElement) => d.open), false);
    await details.locator("summary").click();
    await waitFor(() => details.evaluate((d: HTMLDetailsElement) => d.open), (open) => open, "the block opens");
    await description.locator("kbd", { hasText: "⌘K" }).waitFor();
    await description.locator(".markdown-alert-note .markdown-alert-title", { hasText: "Note" }).waitFor();
    assert.equal(await description.locator("input.md-task").isDisabled(), true);

    // The hostile comment: its words only; nothing ran, loaded or hid the view.
    const hostile = entries.filter({ hasText: "mallory" });
    await hostile.locator(".gh-html", { hasText: "Hello" }).waitFor();
    assert.equal(await hostile.locator(".gh-html script, .gh-html iframe, .gh-html style, .gh-html img").count(), 0);
    assert.equal(await hostile.locator(".gh-html a").getAttribute("href"), null);
    await hostile.locator(".gh-html a", { hasText: "click" }).click();
    assert.equal(await page.evaluate(() => (window as { __pwned?: number }).__pwned ?? null), null);
    assert.ok(await view.isVisible());

    // A body of only a hidden marker shows nothing; Markdown without HTML still hides its comment.
    assert.equal(await entries.filter({ hasText: "bot" }).filter({ hasNot: page.locator(".gh-html") }).locator(".gh-body").count(), 0);
    const md = entries.filter({ hasText: "Plain" });
    await md.locator("strong", { hasText: "Markdown" }).waitFor();
    assert.ok(!(await md.innerText()).includes("still hidden"));

    if (process.env.GITHUB_SHOT) {
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.screenshot({ path: `${process.env.GITHUB_SHOT}/rendered-${scheme}.png` });
      }
    }

    // A pull request link opens in the tab.
    await description.getByRole("link", { name: "#13" }).click();
    await view.locator(".gh-pr-title", { hasText: "Fix the shoreline" }).waitFor();
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

test("⇧⌘G shows the selected workspace's (or agent's) branch changes, else says why", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  // The macOS app's channel: its View → Show Branch Changes (⇧⌘G) sends the page `github-branch-changes`.
  await page.addInitScript(`
    window.sentToApp = [];
    window.webkit = { messageHandlers: { paseoWorld: { postMessage: (m) => window.sentToApp.push(m) } } };
  `);
  const { asked } = await setUp(page);
  const sent = () => page.evaluate(() => (window as unknown as { sentToApp: { type: string; action?: string }[] }).sentToApp);
  const githubAsked = async () => (await sent()).filter((m) => m.type === "menu" && m.action === "github").length;
  const toast = page.locator(".toast[role=status]");
  try {
    // Nothing selected: a notice, and the tab isn't asked for.
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await appEvent(page, "paseo:command", "github-branch-changes");
    await toast.filter({ hasText: "Select a workspace or agent to see its branch's changes." }).waitFor();
    assert.equal(await githubAsked(), 0);

    // An agent selected: its workspace's changes, the GitHub tab asked for.
    await page.goto(`${app.url}?agent=a-running`);
    await page.locator(".session").waitFor();
    // In the app the menu takes the key, so the page leaves ⇧⌘G alone.
    await page.keyboard.press("Meta+Shift+g");
    assert.equal(await githubAsked(), 0);
    await appEvent(page, "paseo:command", "github-branch-changes");
    await waitFor(githubAsked, (n) => n === 1, "the GitHub tab asked for");
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-branches", { hasText: "map-polish" }).waitFor();
    assert.equal(asked.filter((a) => a.path === "/api/changes").at(-1)?.query.workspace, "wks_a");

    // ⌘K's entry names the key.
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("changes against main");
    const entry = palette.getByRole("option", { name: /Show Map polish’s changes against main/ });
    assert.match(await entry.locator(".palette-keys").innerText(), /⇧\s*⌘\s*G/);
    await page.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});

test("In a browser the page takes ⇧⌘G itself: GitHub off, nothing selected or no GitHub tab each say so", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const toast = page.locator(".toast[role=status]");
  try {
    await setUp(page, { github: false });
    await page.goto(`${app.url}?workspace=wks_a`);
    await page.locator(".place").waitFor();
    await page.keyboard.press("Meta+Shift+g");
    await toast.filter({ hasText: "Turn on GitHub in Settings to see a branch's changes." }).waitFor();

    const on = await context.newPage();
    await setUp(on);
    await on.goto(app.url);
    await on.locator(".fleet-sidebar").waitFor();
    await on.keyboard.press("Meta+Shift+g");
    await on.locator(".toast[role=status]", { hasText: "Select a workspace or agent to see its branch's changes." }).waitFor();
    await on.goto(`${app.url}?workspace=wks_a`);
    await on.locator(".place").waitFor();
    await on.keyboard.press("Meta+Shift+g");
    await on.locator(".toast[role=status]", { hasText: "The GitHub tab is in the macOS app." }).waitFor();
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
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.getByRole("button", { name: /Map polish/ }).click();
    await view.locator(".gd-file").nth(4).waitFor();
    assert.ok(await view.locator('.gd-file[data-path="web/big.json"]').evaluate((e) => e.classList.contains("folded")), "the big file shows folded");

    // T: the filter, fuzzy on paths; the tree narrows to what fits, its characters marked.
    await view.locator(".gd-file-head").first().click();
    await page.keyboard.press("t");
    const filter = view.getByRole("searchbox", { name: "Filter files" });
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
      await palette.getByRole("option", { name: new RegExp(`${label}.*GitHub`) }).click();
      await palette.waitFor({ state: "detached" });
      await waitFor(() => field.evaluate((e) => e === document.activeElement), Boolean, `${label} from ⌘K`);
    }
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
    await page.setViewportSize({ width: 1400, height: 900 });
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
      await showGithub(page);
      const view = page.locator(".github-view");
      await view.getByRole("button", { name: /Map polish/ }).click();
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
