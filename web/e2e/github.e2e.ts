/**
 * The GitHub tab (the macOS app's mode bar shows it in the map's place):
 * pull requests to review, one PR's conversation and files with a review
 * drafted and submitted, Viewed. (A workspace's changes are the Files page's:
 * `changes.e2e.ts`.) `/api/github/…` is answered in the browser from samples;
 * nothing reaches GitHub or a daemon.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { DiffFile, PrCheck, PrDetail, PrDiff, PrList, PrRow, RepoList, RepoPeople, RepoSearch, RepoTeams, ReviewThread } from "../src/github/types";
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

const showGithub = (page: Page) =>
  appEvent(page, "paseo:mode", { mode: "github" });

type Asked = { path: string; query: Record<string, string>; body?: unknown };

async function setUp(
  page: Page,
  opts: {
    refuse?: Set<string>;
    workspaces?: typeof small.workspaces;
    agents?: typeof small.agents;
    github?: boolean;
    detail?: (d: PrDetail) => void;
    /** Pool boxes' status (`GET /api/pool`), turning Pool boxes on; a function answers it afresh each time. */
    pool?: () => unknown;
    accept?: (path: string, body: any) => boolean | object;
  } = {},
) {
  const lists: Record<string, unknown> = {
    settings: { integrations: { github: opts.github ?? true, linear: false, typesafe: false, pool: !!opts.pool } },
  };
  if (opts.pool) Object.defineProperty(lists, "pool", { get: opts.pool, enumerable: true });
  await mockApi(page, {
    agents: () => opts.agents ?? small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => opts.workspaces ?? small.workspaces,
    lists,
    ...(opts.accept ? { accept: opts.accept } : {}),
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
      const reply = entry.body as { commentId?: number; threadId?: string; resolved?: boolean };
      if (pr && entry.path.endsWith("/m/reply")) {
        const t = pr.threads.find((x) => x.comments[0]?.databaseId === reply.commentId);
        t?.comments.push({ id: `RC_new${t.comments.length}`, databaseId: 900 + t.comments.length, author: { login: "me" }, body: w.body!, createdAt: new Date().toISOString(), url: `${pr.url}#r` });
      }
      if (entry.path.endsWith("/m/resolve"))
        for (const p of prs.values()) for (const t of p.threads) if (t.id === reply.threadId) t.isResolved = !!reply.resolved;
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
      const rows = scope === "review" ? REVIEW : scope === "mine" ? MINE : scope === "assigned" ? [] : [...REVIEW, ...MINE];
      return route.fulfill({ json: { scope, rows, viewer: { login: "me" } } satisfies PrList });
    }
    if (name === "pr") {
      const r = [...REVIEW, ...MINE].find((x) => x.number === Number(u.searchParams.get("number")))!;
      const kept = prs.get(r.number);
      if (kept) return route.fulfill({ json: kept });
      const d = detail(r);
      prs.set(r.number, d);
      opts.detail?.(d);
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
    // No Workspace section: a workspace's changes are the Files page's.
    assert.ok(!(await view.locator(".gh-nav h3").allTextContents()).includes("Workspace"));
    assert.equal(await view.getByRole("button", { name: /Map polish|Its pull request/ }).count(), 0);
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

/** #13's line comments: bob's review with two threads (one replied to by ada in a reply-only review), an outdated and
 * resolved thread in it, a single comment of its own, and a thread whose review isn't in the list. */
const threaded = (d: PrDetail) => {
  const c = (id: string, db: number, who: string, review: string, minutes: number, body: string) => ({
    id,
    databaseId: db,
    author: { login: who },
    body,
    createdAt: ago(minutes),
    url: `https://github.com/acme/atlas/pull/13#discussion_r${db}`,
    reviewId: review,
  });
  const t = (id: string, path: string, line: number | null, o: Partial<ReviewThread>, comments: ReviewThread["comments"]): ReviewThread => ({
    id,
    path,
    line,
    startLine: null,
    side: "RIGHT",
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    canReply: true,
    comments,
    ...o,
  });
  d.timeline = [
    { kind: "comment", id: "IC_1", author: sam, body: "Opening note", createdAt: ago(60), url: `${d.url}#c1` },
    { kind: "review", id: "PRR_bob", author: { login: "bob" }, state: "changes", body: "A few things inline.", createdAt: ago(40), url: `${d.url}#r1`, comments: 3 },
    { kind: "review", id: "PRR_reply", author: { login: "ada" }, state: "commented", body: "", createdAt: ago(30), url: `${d.url}#r2`, comments: 1 },
    { kind: "review", id: "PRR_single", author: { login: "ada" }, state: "commented", body: "", createdAt: ago(20), url: `${d.url}#r3`, comments: 1 },
  ];
  d.threads = [
    t("RT_c", "src/a.ts", 3, { diffHunk: "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;" }, [
      c("RC_1", 1, "bob", "PRR_bob", 40, "Name this constant?"),
      c("RC_2", 2, "ada", "PRR_reply", 30, "It's the count."),
    ]),
    t("RT_old", "src/b.ts", null, { originalLine: 2, isOutdated: true, isResolved: true, diffHunk: "@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;" }, [
      c("RC_3", 3, "bob", "PRR_bob", 40, "Was this meant to change?"),
    ]),
    t("RT_single", "src/b.ts", 4, { diffHunk: "@@ -3,1 +3,2 @@\n+const c = 4;\n export { a };" }, [c("RC_4", 4, "ada", "PRR_single", 20, "Export c too?")]),
    t("RT_loose", "src/a.ts", 2, { startLine: 1, diffHunk: "@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;" }, [c("RC_5", 5, "sam", "PRR_elsewhere", 10, "Range note")]),
  ];
};

test("A PR's line comments show in its Conversation: under their review, single ones on their own, with hunks, Reply, Resolve and a jump to Files changed", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { writes } = await setUp(page, { detail: (d) => d.number === 13 && threaded(d), refuse: new Set() });
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-row", { hasText: "Fix the shoreline" }).click();
    const main = view.locator(".gh-conversation-main");
    await main.locator(".gh-thread").first().waitFor();
    const order = () => main.locator(":scope > .gh-entry").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.entry ?? (e.classList.contains("composer") ? "box" : "description")));
    // Newest first: the loose thread, the single comment, bob's review (the reply-only review isn't an entry), the comment.
    assert.deepEqual(await order(), ["description", "box", "RT_loose", "RT_single", "PRR_bob", "IC_1"]);
    assert.equal((await view.locator(".gh-comments-head h3").innerText()).replace(/\s+/g, " "), "Comments · 4");

    // Bob's review holds its threads in order, each with its path, line(s), hunk and comments; ada's reply in its thread.
    const bob = main.locator('[data-entry="PRR_bob"]');
    const threads = bob.locator(".gh-thread");
    assert.deepEqual(await threads.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.thread)), ["RT_c", "RT_old"]);
    const c = bob.locator('[data-thread="RT_c"]');
    assert.equal(await c.locator(".gh-thread-path").innerText(), "src/a.ts");
    assert.equal(await c.locator(".gh-thread-head .gh-hint").innerText(), "line 3");
    assert.deepEqual(await c.locator(".gh-thread-comment b").allTextContents(), ["bob", "ada"]);
    // The hunk is drawn by the diff's renderer, ending on the commented line.
    await waitFor(() => c.locator(".gh-thread-hunk [data-line]").allTextContents(), (lines) => lines.at(-1)?.includes("const c = 4;") === true, "the hunk's lines");
    // The outdated thread is resolved: folded, saying so, with Show resolved.
    const old = bob.locator('[data-thread="RT_old"]');
    await old.locator(".gh-thread-badge.outdated", { hasText: "Outdated" }).waitFor();
    assert.equal(await old.locator(".gh-thread-head .gh-hint").innerText(), "line 2");
    assert.equal(await old.locator(".gh-thread-comment").count(), 0);
    await old.getByRole("button", { name: /Show resolved/ }).click();
    await old.locator(".gh-thread-comment", { hasText: "Was this meant to change?" }).waitFor();
    await old.getByRole("button", { name: "Fold the resolved conversation" }).click();
    await old.locator(".gh-thread-comment").waitFor({ state: "detached" });
    // The loose thread names its range.
    assert.equal(await main.locator('[data-thread="RT_loose"] .gh-thread-head .gh-hint').innerText(), "lines 1–2");

    // Reply: shown at once, written to the thread's first comment, kept after the read.
    await c.getByRole("button", { name: "Reply…" }).click();
    await c.locator("textarea").fill("Renamed it.");
    await c.locator("textarea").press("Meta+Enter");
    await c.locator(".gh-thread-comment", { hasText: "Renamed it." }).waitFor();
    await waitFor(() => Promise.resolve(writes.filter((w) => w.path.endsWith("/m/reply")).length), (n) => n === 1, "the reply");
    assert.deepEqual(writes.find((w) => w.path.endsWith("/m/reply"))!.body, { repo: "acme/atlas", number: 13, commentId: 1, body: "Renamed it." });
    // Resolve folds it; Show resolved (⌘K) shows every resolved one; Unresolve puts it back.
    await c.getByRole("button", { name: "Resolve conversation" }).click();
    await c.locator(".gh-thread-badge.resolved").waitFor();
    await waitFor(() => c.locator(".gh-thread-comment").count(), (n) => n === 0, "the resolved thread folded");
    assert.deepEqual(writes.at(-1)!.body, { threadId: "RT_c", resolved: true });
    await view.locator(".gh-pr-title").click();
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("resolved conversations");
    await palette.getByRole("option", { name: /Show resolved conversations.*GitHub/ }).click();
    await palette.waitFor({ state: "detached" });
    await c.locator(".gh-thread-comment").first().waitFor();
    await old.locator(".gh-thread-comment").first().waitFor();
    await c.getByRole("button", { name: "Unresolve" }).click();
    await waitFor(() => Promise.resolve((writes.at(-1)!.body as { resolved: boolean }).resolved), (r) => r === false, "the unresolve");
    await c.locator(".gh-thread-badge.resolved").waitFor({ state: "detached" });

    // The review's fold toggle hides its threads; ⌘K folds and shows every review's.
    await bob.getByRole("button", { name: "Fold", exact: true }).click();
    assert.equal(await bob.locator(".gh-thread").count(), 0);
    await bob.getByRole("button", { name: "Show 2 conversations" }).click();
    await bob.locator(".gh-thread").first().waitFor();
    await page.keyboard.press("Meta+k");
    await palette.getByRole("combobox", { name: "Search commands" }).fill("fold every review");
    await palette.getByRole("option", { name: /Fold every review’s line comments/ }).click();
    await bob.locator(".gh-thread").first().waitFor({ state: "detached" });
    await bob.getByRole("button", { name: "Show 2 conversations" }).click();

    // Oldest first: the entries turn, each thread's comments keep their order.
    await view.locator(".gh-order").getByRole("radio", { name: "Oldest first" }).click();
    assert.deepEqual(await order(), ["description", "IC_1", "PRR_bob", "RT_single", "RT_loose", "box"]);
    assert.deepEqual(await c.locator(".gh-thread-comment b").allTextContents(), ["bob", "ada", "me"]);

    if (process.env.GITHUB_SHOT) {
      await view.locator(".gh-order").getByRole("radio", { name: "Newest first" }).click();
      await bob.scrollIntoViewIfNeeded();
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${process.env.GITHUB_SHOT}/threads-${scheme}.png` });
      }
      await page.emulateMedia({ colorScheme: "dark" });
    }

    // The path opens Files changed at the thread: its file shown, the thread in view and marked.
    await main.locator('[data-thread="RT_single"] .gh-thread-path').click();
    const diffThread = view.locator('.gd-file[data-path="src/b.ts"] [data-thread="RT_single"]');
    await diffThread.waitFor();
    await waitFor(
      () => diffThread.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const box = e.closest(".gd-scroll")!.getBoundingClientRect();
        return r.top >= box.top && r.top < box.bottom && e.classList.contains("focused");
      }),
      (v) => v,
      "the thread in view in Files changed",
    );
    // View in Files changed on the folded, outdated one: it opens there, unfolded.
    await view.getByRole("tab", { name: /Conversation/ }).click();
    await main.locator('[data-thread="RT_old"]').getByRole("button", { name: "View in Files changed" }).click();
    const oldThere = view.locator('.gd-file[data-path="src/b.ts"] [data-thread="RT_old"]');
    await oldThere.locator(".gh-thread-comment", { hasText: "Was this meant to change?" }).waitFor();
  } finally {
    await context.close();
  }
});

test("Files changed's Comments list: threads and drafts by file, Show resolved, a click shows the thread, N / ⇧N step, ⇧C switches, kept", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await setUp(page, { detail: (d) => d.number === 13 && threaded(d), refuse: new Set() });
  // A drafted comment of your pending review, on src/b.ts's line 3.
  await page.addInitScript(() => {
    if (!localStorage.getItem("paseo-command:github:review:acme/atlas#13"))
      localStorage.setItem(
        "paseo-command:github:review:acme/atlas#13",
        JSON.stringify({ comments: [{ id: "D_1", path: "src/b.ts", line: 3, side: "RIGHT", body: "Draft: *rename* this" }], body: "" }),
      );
  });
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-row", { hasText: "Fix the shoreline" }).click();
    await view.getByRole("tab", { name: /Files changed/ }).click();
    await view.locator('.gd-file[data-path="src/b.ts"]').waitFor();

    // Each file's row counts its comments (replies and drafts too).
    const row = (path: string) => view.locator(`.gd-list-file[title="${path}"] .gd-list-notes`);
    assert.equal(await row("src/a.ts").innerText(), "3");
    assert.equal(await row("src/b.ts").innerText(), "3");

    // Comments: the open ones, by file in the diff's order, by line; the resolved and outdated one behind Show resolved.
    const sw = view.getByRole("radiogroup", { name: "Show in the sidebar" });
    await sw.getByRole("radio", { name: /Comments/ }).click();
    const list = view.getByRole("navigation", { name: "Comments" });
    const ids = () => list.locator(".gd-note").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.entry));
    await waitFor(ids, (v) => v.length === 4, "the open comments listed");
    assert.deepEqual(await ids(), ["RT_loose", "RT_c", "D_1", "RT_single"]);
    assert.equal(await list.locator(".gd-list-head span").first().innerText(), "4 open");
    const c = list.locator('[data-entry="RT_c"]');
    assert.equal(await c.locator(".gd-note-where").innerText(), "L3");
    assert.equal(await c.locator(".gd-note-who").innerText(), "bob");
    assert.equal(await c.locator(".gd-note-text").innerText(), "Name this constant?");
    assert.equal(await c.locator(".gd-note-replies").getAttribute("aria-label"), "1 reply");
    assert.equal(await list.locator('[data-entry="RT_loose"] .gd-note-where').innerText(), "L1–2");
    const draft = list.locator('[data-entry="D_1"]');
    assert.equal(await draft.locator(".gh-pending").innerText(), "Draft");
    assert.equal(await draft.locator(".gd-note-who").innerText(), "You");
    assert.equal(await draft.locator(".gd-note-text").innerText(), "Draft: rename this");
    await list.getByRole("button", { name: "Show resolved (1)" }).click();
    const old = list.locator('[data-entry="RT_old"]');
    await old.waitFor();
    assert.match((await old.getAttribute("class")) ?? "", /\bdim\b/);
    assert.equal(await old.locator(".gd-note-badge", { hasText: "Outdated" }).count(), 1);
    assert.equal(await old.locator(".gd-note-where").innerText(), "L2");

    if (process.env.GITHUB_SHOT)
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${process.env.GITHUB_SHOT}/comments-${scheme}.png` });
      }

    // A click on the resolved, outdated one: shown in the diff, opened, marked, and marked in the list.
    await old.click();
    const there = view.locator('.gd-file[data-path="src/b.ts"] [data-thread="RT_old"]');
    await there.locator(".gh-thread-comment", { hasText: "Was this meant to change?" }).waitFor();
    await waitFor(() => there.evaluate((e) => e.classList.contains("gd-flash") || e.classList.contains("focused")), Boolean, "the thread marked");
    await waitFor(() => old.getAttribute("aria-current"), (v) => v === "true", "the entry in view marked");
    // Hide resolved again; a click on the draft shows it under its line.
    await list.getByRole("button", { name: "Hide resolved" }).click();
    await old.waitFor({ state: "detached" });
    await draft.click();
    const draftThere = view.locator('.gd-file[data-path="src/b.ts"] [data-draft="D_1"]');
    await waitFor(
      () =>
        draftThere.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const box = e.closest(".gd-scroll")!.getBoundingClientRect();
          return r.top >= box.top && r.bottom <= box.bottom;
        }),
      Boolean,
      "the draft in view",
    );
    await waitFor(() => draft.getAttribute("aria-current"), (v) => v === "true", "the draft marked in the list");

    // N and ⇧N step through the list (wrapping) from the one in view.
    await page.keyboard.press("n");
    await waitFor(() => list.locator('[data-entry="RT_single"]').getAttribute("aria-current"), (v) => v === "true", "N: the next comment");
    await page.keyboard.press("n");
    await waitFor(() => list.locator('[data-entry="RT_loose"]').getAttribute("aria-current"), (v) => v === "true", "N wraps to the first");
    await page.keyboard.press("Shift+N");
    await waitFor(() => list.locator('[data-entry="RT_single"]').getAttribute("aria-current"), (v) => v === "true", "⇧N: the previous");
    await view.locator('.gd-file[data-path="src/b.ts"] [data-thread="RT_single"]').waitFor();

    // Kept for PRs: a reload shows the comments again; ⇧C goes back to the files, ⌘K too.
    await page.reload();
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    await list.locator(".gd-note").first().waitFor();
    await view.locator(".gh-pr-title").click();
    await page.keyboard.press("Shift+C");
    await view.getByRole("navigation", { name: "Changed files" }).waitFor();
    assert.equal(await sw.getByRole("radio", { name: "Files" }).getAttribute("aria-checked"), "true");
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("comment in the diff");
    await palette.getByRole("option", { name: /Next comment in the diff/ }).waitFor();
    await palette.getByRole("option", { name: /Previous comment in the diff/ }).waitFor();
    await palette.getByRole("combobox", { name: "Search commands" }).fill("diff’s comments");
    await palette.getByRole("option", { name: /Show the diff’s comments.*GitHub/ }).click();
    await palette.waitFor({ state: "detached" });
    await list.locator(".gd-note").first().waitFor();

    // A PR without comments: the list says how to leave one.
    await view.locator(".gh-pr-title").click();
    await page.keyboard.press("Escape");
    await view.locator(".gh-row", { hasText: "Add the GitHub tab" }).click();
    await view.getByRole("tab", { name: /Files changed/ }).click();
    await list.locator(".gd-notes-empty", { hasText: "No comments yet" }).waitFor();
    assert.match(await list.locator(".gd-notes-empty").innerText(), /in its gutter to comment/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("A refused reply goes again from the Conversation, with a notice", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setUp(page, { detail: (d) => d.number === 13 && threaded(d), refuse: new Set(["/api/github/m/reply"]) });
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-row", { hasText: "Fix the shoreline" }).click();
    const c = view.locator('.gh-conversation-main [data-thread="RT_c"]');
    await c.getByRole("button", { name: "Reply…" }).click();
    await c.locator("textarea").fill("Will it go?");
    await c.locator("textarea").press("Meta+Enter");
    await page.getByText(/Couldn’t reply/).waitFor();
    await waitFor(() => c.locator(".gh-thread-comment", { hasText: "Will it go?" }).count(), (n) => n === 0, "the reply taken back");
    // The box keeps the text to try again.
    assert.equal(await c.locator("textarea").inputValue(), "Will it go?");
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

/** ⌘R as the keyboard sends it, through the page's own listeners (a synthetic event: never the browser's reload). */
const pressRefresh = (page: Page) =>
  page.evaluate(() => {
    const e = new KeyboardEvent("keydown", { key: "r", metaKey: true, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e.defaultPrevented;
  });

test("⌘R refreshes what the GitHub tab shows (a list, a PR and its open tab) without reloading the page or losing a draft; the map leaves it to the browser", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { asked } = await setUp(page);
  // Fresh PR reads answer slowly, so a second ⌘R lands while one is in flight.
  await page.route("**/api/github/q/pr?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("fresh")) await new Promise((r) => setTimeout(r, 400));
    return route.fallback();
  });
  const fresh = (name: string, extra: (q: Record<string, string>) => boolean = () => true) =>
    asked.filter((a) => a.path === `/api/github/q/${name}` && a.query.fresh === "1" && extra(a.query)).length;
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await page.evaluate(() => ((window as unknown as { kept: number }).kept = 1));
    // The map: the page has no refresh of its own there, so the browser's ⌘R (a reload) goes on.
    assert.equal(await pressRefresh(page), false, "the map leaves ⌘R to the browser");

    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-row").first().waitFor();
    // A list: the list, past the server's cache, and nothing else.
    assert.equal(await pressRefresh(page), true);
    await waitFor(() => fresh("prs", (q) => q.scope === "review"), (n) => n === 1, "the list asked fresh");
    assert.equal(fresh("repos") + fresh("viewer") + fresh("prs", (q) => q.scope !== "review"), 0, "only the list shown");

    // A PR's Conversation, a comment drafted: ⌘R (even typing) asks its read fresh once, however often pressed while in flight.
    await view.locator(".gh-row", { hasText: "Add the GitHub tab" }).click();
    await view.locator(".gh-entry.description").waitFor();
    const box = view.locator("#gh-pr-comment textarea");
    await box.fill("Half a thought");
    await box.focus();
    await page.keyboard.press("Meta+r");
    await view.locator(".gh-head .icon-btn[aria-label=Refresh] .spinning").waitFor();
    await page.keyboard.press("Meta+r");
    await view.locator(".gh-head .icon-btn[aria-label=Refresh] .spinning").waitFor({ state: "detached" });
    assert.equal(fresh("pr", (q) => q.number === "12"), 1, "one fresh read while in flight");
    assert.equal(fresh("diff"), 0, "the diff isn't shown");
    assert.equal(await box.inputValue(), "Half a thought", "the draft stays");

    // Files changed: the PR and its diff.
    await view.getByRole("tab", { name: /Files changed/ }).click();
    await view.locator(".gd-file").first().waitFor();
    await page.keyboard.press("Meta+r");
    await waitFor(() => fresh("diff"), (n) => n === 1, "the diff asked fresh");
    await waitFor(() => fresh("pr", (q) => q.number === "12"), (n) => n === 2, "the PR asked fresh");
    assert.ok(await view.getByRole("tab", { name: /Files changed/, selected: true }).isVisible(), "the open tab stays");

    // The macOS app's View → Refresh Page sends `page-refresh`.
    await page.waitForTimeout(450);
    await appEvent(page, "paseo:command", "page-refresh");
    await waitFor(() => fresh("pr", (q) => q.number === "12"), (n) => n === 3, "the app's Refresh Page");

    // ⌘K says the key.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Refresh the pull request");
    await palette.getByRole("option", { name: /Refresh the pull request.*⌘\s*R/ }).waitFor();
    await page.keyboard.press("Escape");

    assert.equal(await page.evaluate(() => (window as unknown as { kept?: number }).kept), 1, "the page never reloaded");
  } finally {
    await context.close();
  }
});

/** ⇧⌘C as the keyboard sends it, to what has focus; whether the page took it. */
const pressCopy = (page: Page) =>
  page.evaluate(() => {
    const e = new KeyboardEvent("keydown", { key: "C", metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e.defaultPrevented;
  });

test("⇧⌘C copies the PR's github.com link (any of its tabs) with a notice, a repository's list its pulls link; never while typing", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setUp(page);
  // The clipboard, recorded (a browser's page writes through navigator.clipboard).
  await page.addInitScript(() => {
    const w = window as unknown as { copied: string[] };
    w.copied = [];
    Clipboard.prototype.writeText = async (text: string) => void w.copied.push(text);
  });
  const copied = () => page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  const notice = page.locator(".toast[role=status]", { hasText: "Link copied" });
  const dismiss = async () => {
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await notice.waitFor({ state: "detached" });
  };
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    // The map: not the GitHub tab's key.
    assert.equal(await pressCopy(page), false);

    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-row").first().waitFor();
    // A scope list (Review requests) has no one address: the key isn't taken.
    assert.equal(await pressCopy(page), false);
    assert.deepEqual(await copied(), []);

    // A PR's Conversation.
    await view.locator(".gh-row", { hasText: "Add the GitHub tab" }).click();
    await view.locator(".gh-entry.description").waitFor();
    await page.keyboard.press("Meta+Shift+c");
    await notice.waitFor();
    assert.deepEqual(await copied(), ["https://github.com/acme/atlas/pull/12"]);
    await dismiss();

    // Typing in the comment box: the field keeps the key and nothing is copied.
    const box = view.locator("#gh-pr-comment textarea");
    await box.fill("Half a thought");
    await box.focus();
    assert.equal(await pressCopy(page), false);
    await page.keyboard.press("Meta+Shift+c");
    await page.waitForTimeout(150);
    assert.equal((await copied()).length, 1, "not while typing");
    assert.equal(await notice.count(), 0);
    await box.blur();

    // Files changed: still the PR's link.
    await view.getByRole("tab", { name: /Files changed/ }).click();
    await view.locator(".gd-file").first().waitFor();
    assert.equal(await pressCopy(page), true);
    await notice.waitFor();
    assert.deepEqual(await copied(), ["https://github.com/acme/atlas/pull/12", "https://github.com/acme/atlas/pull/12"]);
    await dismiss();

    // ⌘K says the key and copies it too.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("Copy the pull request");
    await palette.getByRole("option", { name: /Copy the pull request’s link.*GitHub.*⇧\s*⌘\s*C/ }).click();
    await notice.waitFor();
    assert.equal((await copied()).length, 3);
    await dismiss();

    // A repository's list: its pulls address.
    await view.locator(".gh-repo-row .gh-nav-label", { hasText: "atlas" }).click();
    await view.locator(".gh-head h2", { hasText: "acme/atlas" }).waitFor();
    assert.equal(await pressCopy(page), true);
    await notice.waitFor();
    assert.equal((await copied()).at(-1), "https://github.com/acme/atlas/pulls");
  } finally {
    await context.close();
  }
});

test("main history monitors new arrivals without moving the list, pages from a pinned head and opens a commit diff", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await setUp(page);
  const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
  let tip = A;
  const requests: Record<string, string>[] = [];
  await page.route("**/api/github/q/commit**", async (route) => {
    const u = new URL(route.request().url()), q = Object.fromEntries(u.searchParams);
    requests.push(q);
    if (u.pathname.endsWith("/commits")) {
      const older = !!q.after;
      const rows = older ? [{ sha: B, title: "Earlier change", author: "Ada", date: ago(50) }] : [{ sha: tip, title: tip === A ? "Improve the dungeon" : "A new main commit", author: "Sam", date: ago(2) }];
      return route.fulfill({ json: { repo: q.repo, branch: "main", head: older ? A : tip, rows, cursor: older ? null : "older", more: !older } });
    }
    return route.fulfill({ json: { sha: q.sha, title: "Improve the dungeon", author: "Sam", date: ago(2), message: "Improve the dungeon\n\nKeep the robots calm.", parents: [B], additions: 4, deletions: 2, ...DIFF } });
  });
  try {
    await page.goto(app.url); await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-repo-row .gh-nav-label", { hasText: "atlas" }).click();
    await view.getByRole("button", { name: "Main commits", exact: true }).first().click();
    const history = page.getByRole("region", { name: "Main commit history" });
    await history.getByRole("button", { name: /Improve the dungeon/ }).waitFor();
    if (process.env.GITHUB_SHOT) await page.screenshot({ path: `${process.env.GITHUB_SHOT}/main-history.png` });
    tip = C;
    await history.getByRole("button", { name: "Refresh main history" }).click();
    await history.getByText("New commits on main", { exact: true }).waitFor();
    assert.equal(await history.getByRole("button", { name: /A new main commit/ }).count(), 0, "new arrivals don't move the current list");
    await history.getByRole("button", { name: "Load older commits" }).click();
    await history.getByRole("button", { name: /Earlier change/ }).waitFor();
    assert.ok(requests.some((q) => q.head === A && q.after === "older"), "older commits use the original main head");
    await history.getByRole("button", { name: /Improve the dungeon/ }).click();
    await history.locator(".gd-file").first().waitFor();
    await history.getByText("Keep the robots calm.").waitFor();
    if (process.env.GITHUB_SHOT) await page.screenshot({ path: `${process.env.GITHUB_SHOT}/main-commit-diff.png` });
    await history.getByRole("button", { name: "Back to main history" }).click();
    await history.getByRole("button", { name: /Earlier change/ }).waitFor();
    await history.getByRole("button", { name: "Show latest commits" }).click();
    await history.getByRole("button", { name: /A new main commit/ }).waitFor();
    assert.equal(await history.getByRole("button", { name: /Earlier change/ }).count(), 0);
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("Open commit ccccccc");
    await palette.getByRole("option", { name: /Open commit ccccccc/ }).waitFor();
    await page.keyboard.press("Escape");
    await page.reload(); await showGithub(page);
    await page.getByRole("region", { name: "Main commit history" }).waitFor();
    const finder = page.getByRole("searchbox", { name: "Find a repository" });
    await finder.fill("tool");
    await page.locator(".gh-repo-found .gh-nav-label", { hasText: "sam/tools" }).waitFor();
    await finder.press("Enter");
    await page.getByRole("region", { name: "Main commit history" }).getByText(/sam\/tools/).waitFor();
  } finally { await context.close(); }
});

test("Open in agent opens New agent on the PR's branch, in a checkout of its repository on the host or pool box chosen", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  // Map polish (local) is a checkout of acme/atlas, so atlas is its project's repository.
  const workspaces = small.workspaces.map((w) => (w.workspaceId === "wks_a" ? { ...w, repo: "https://github.com/acme/atlas" } : w));
  let poolRepo = "other/thing";
  const posts: { path: string; body: any }[] = [];
  await setUp(page, {
    workspaces,
    pool: () => ({
      enabled: true,
      problem: "",
      settings: { dir: "~/boxes" },
      checkout: "/srv/app",
      repo: poolRepo,
      boxes: [{ id: "pool-1", label: "pool-1", status: "idle" }],
      job: null,
    }),
    accept: (path, body) => {
      if (path !== "/api/dispatch" && path !== "/api/pool/claim") return false;
      posts.push({ path, body });
      return path === "/api/dispatch" ? { agentId: "a-new" } : { job: { id: "pjx", kind: "claim", phase: "claiming", steps: [], startedAt: 1 } };
    },
  });
  try {
    await page.goto(app.url);
    await page.locator(".fleet-sidebar").waitFor();
    await showGithub(page);
    const view = page.locator(".github-view");
    await view.locator(".gh-row", { hasText: "Add the GitHub tab" }).click();
    await view.locator(".gh-pr-title", { hasText: "Add the GitHub tab" }).waitFor();
    const open = view.getByRole("button", { name: "Open in agent" });
    const form = page.locator(".new-agent");

    // On this Mac: its checkout of acme/atlas, a worktree on #12's branch.
    await open.click();
    await form.waitFor();
    assert.equal(await form.locator("select[name=host]").inputValue(), "local");
    assert.equal(await form.locator("select[name=target]").inputValue(), "p:prj_atlas");
    assert.equal(await form.getByRole("radio", { name: "Worktree" }).getAttribute("aria-checked"), "true");
    assert.match((await form.locator(".form-hint").textContent()) ?? "", /pull request #12’s branch “feature-12”/);
    await form.locator("#composer").fill("Review this change");
    await form.getByRole("button", { name: "Send message" }).click();
    await waitFor(() => Promise.resolve(posts.length), (n) => n === 1, "the dispatch");
    assert.equal(posts[0].path, "/api/dispatch");
    assert.equal(posts[0].body.projectId, "prj_atlas");
    assert.equal(posts[0].body.pr, 12);
    assert.equal(posts[0].body.prHead, "feature-12");
    assert.equal(posts[0].body.branch, undefined);

    // A pool box whose checkout is another repository can't take it.
    await open.click();
    await form.waitFor();
    await waitFor(() => form.locator("select[name=host] option[value='pool:new']").count(), (n) => n === 1, "the pool choice");
    await form.locator("select[name=host]").selectOption("pool:new");
    await waitFor(
      () => form.locator("#composer").getAttribute("placeholder"),
      (t) => !!t?.includes("The pool box's checkout is other/thing, not acme/atlas"),
      "the wrong repository said",
    );
    await form.getByRole("button", { name: "Fleet" }).click();

    // One of acme/atlas takes it: claimed, then the PR's worktree there.
    poolRepo = "acme/atlas";
    await open.click();
    await form.waitFor();
    await waitFor(() => form.locator("select[name=host] option[value='pool:new']").count(), (n) => n === 1, "the pool choice");
    await form.locator("select[name=host]").selectOption("pool:new");
    await waitFor(
      () => form.locator(".form-hint").textContent(),
      (t) => !!t?.includes("creates a worktree on pull request #12’s branch “feature-12” of its checkout, /srv/app"),
      "the pool hint",
    );
    await form.locator("#composer").fill("Review this change on a box");
    await form.getByRole("button", { name: "Send message" }).click();
    await waitFor(() => Promise.resolve(posts.length), (n) => n === 2, "the claim");
    assert.equal(posts[1].path, "/api/pool/claim");
    assert.equal(posts[1].body.pr, 12);
    assert.equal(posts[1].body.prHead, "feature-12");
    assert.equal(posts[1].body.projectId, undefined);
    assert.equal(posts[1].body.host, undefined);

    // ⌘K has it too.
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Search commands" }).fill("in a new agent");
    await palette.getByRole("option", { name: /Open the pull request in a new agent…/ }).waitFor();
    await page.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});
