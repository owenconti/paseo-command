/**
 * A PR's merge box in the GitHub tab: merging with a method (remembered per
 * repository), its commit text and deleting the branch; auto-merge on and
 * off (a refusal put back); the merge queue; ready for review, update
 * branch, close with a comment and reopen; and what blocks a merge. Each
 * from the header, the Merge section or ⌘K. `/api/github/…` is answered in
 * the browser, keeping what's written as GitHub would; nothing reaches GitHub.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import type { PrDetail, PrDiff, PrMerge, PrRow } from "../src/github/types";
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

const SHA = "b".repeat(40);
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const MERGE: PrMerge = {
  status: "clean",
  methods: ["merge", "squash", "rebase"],
  canMerge: true,
  canMergeAsAdmin: false,
  canUpdate: true,
  canClose: true,
  canReopen: true,
  canUpdateBranch: true,
  autoMergeAllowed: true,
  canEnableAutoMerge: true,
  canDisableAutoMerge: true,
  autoMerge: null,
  queueRequired: false,
  queue: null,
  deleteBranchOnMerge: false,
  headBranchExists: true,
  canDeleteBranch: true,
  messages: {
    merge: { title: "Merge pull request #41 from acme/ship-it", body: "Ship it" },
    squash: { title: "Ship it (#41)", body: "* Ship it" },
  },
};
function pr(number: number, title: string, o: Partial<PrDetail> = {}, m: Partial<PrMerge> = {}): PrDetail {
  const row: PrRow = {
    id: `PR_${number}`,
    repo: "acme/atlas",
    number,
    title,
    url: `https://github.com/acme/atlas/pull/${number}`,
    author: { login: "sam" },
    state: "open",
    createdAt: ago(600),
    updatedAt: ago(number),
    headRef: `branch-${number}`,
    baseRef: "main",
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    comments: 0,
    reviewDecision: "approved",
    checks: "passing",
    yourReview: null,
    labels: [],
  };
  return {
    ...row,
    body: "Body.",
    headSha: SHA,
    headRepo: "acme/atlas",
    mergeable: "mergeable",
    viewerIsAuthor: false,
    files: [],
    timeline: [],
    threads: [],
    commits: [],
    checkRuns: [{ name: "test", state: "passing" }],
    reviewers: [],
    assignees: [],
    ...o,
    merge: { ...MERGE, ...m },
  };
}
const SAMPLES = () =>
  new Map<number, PrDetail>([
    [41, pr(41, "Ship it")],
    [42, pr(42, "Waiting on review", { reviewDecision: "review", checkRuns: [{ name: "test", state: "pending" }] }, { status: "blocked" })],
    [43, pr(43, "Still a draft", { state: "draft" }, { status: "behind" })],
    [44, pr(44, "Through the queue", {}, { queueRequired: true })],
    [45, pr(45, "Close me")],
    [46, pr(46, "Conflicted", { mergeable: "conflicting" }, { status: "dirty", autoMergeAllowed: false })],
    // The base branch's rules allow only squash (Diagonal-HQ/diagonal's), or no method the repository allows.
    [47, pr(47, "Squash only", {}, { methods: ["squash"] })],
    [48, pr(48, "Squash only, waiting", { reviewDecision: "review" }, { methods: ["squash"], status: "blocked" })],
    [49, pr(49, "No method", {}, { methods: [], methodsNote: "The base branch’s rules allow none of the repository’s merge methods." })],
  ]);

const DIFF: PrDiff = {
  tooLarge: false,
  files: [
    {
      path: "src/merge.ts",
      isNew: false,
      isDeleted: false,
      additions: 2,
      deletions: 1,
      hunks: [
        {
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 3,
          lines: [
            { type: "header", content: "@@ -1,2 +1,3 @@" },
            { type: "context", content: "const a = 1;" },
            { type: "remove", content: "const b = 2;" },
            { type: "add", content: "const b = 3;" },
            { type: "add", content: "const c = 4;" },
          ],
        },
      ],
    },
  ],
};

type Write = { name: string; body: Record<string, unknown> };

/** The app over a fleet, GitHub on, with `prs` answered and each write kept as GitHub would (unless refused). */
async function setUp(page: Page, prs: Map<number, PrDetail>, refuse: Set<string>, workspaces = small.workspaces) {
  await mockApi(page, {
    agents: () => small.agents,
    permissions: () => [],
    hosts: () => small.hosts,
    projects: () => small.projects,
    workspaces: () => workspaces,
    lists: { settings: { integrations: { github: true, linear: false, typesafe: false } } },
  });
  const writes: Write[] = [];
  await page.route("**/api/github/**", async (route) => {
    const u = new URL(route.request().url());
    const name = u.pathname.split("/").pop()!;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ name, body });
      const key = `${name}${"enable" in body ? `:${body.enable}` : ""}`;
      if (refuse.has(key)) return route.fulfill({ status: 422, json: { error: "Pull request auto merge is not allowed right now." } });
      const p = prs.get(body.number as number)!;
      const now = new Date().toISOString();
      let merged: boolean | undefined;
      switch (name) {
        case "merge":
          Object.assign(p, { state: "merged" });
          p.merge = { ...p.merge, mergedBy: { login: "me" }, mergedAt: now };
          merged = true;
          break;
        case "deleteBranch":
          p.merge = { ...p.merge, headBranchExists: false, canDeleteBranch: false };
          break;
        case "autoMerge":
          p.merge = { ...p.merge, autoMerge: body.enable ? { method: body.method as PrMerge["methods"][number], by: { login: "me" }, at: now } : null };
          break;
        case "queue":
          p.merge = { ...p.merge, queue: body.action === "add" ? { state: "awaiting_checks", position: 2 } : null };
          break;
        case "ready":
          p.state = body.ready ? "open" : "draft";
          break;
        case "updateBranch":
          p.merge = { ...p.merge, status: "clean" };
          break;
        case "state":
          p.state = body.state === "closed" ? "closed" : "open";
          if (p.state === "closed") p.merge = { ...p.merge, closedAt: now };
          break;
      }
      return route.fulfill({ json: { ok: true, ...(merged !== undefined ? { merged } : {}) } });
    }
    if (name === "viewer") return route.fulfill({ json: { viewer: { login: "me" } } });
    if (name === "repos") return route.fulfill({ json: { repos: [], stars: { repos: [], orgs: [] } } });
    if (name === "prs") return route.fulfill({ json: { scope: u.searchParams.get("scope"), rows: [], viewer: { login: "me" } } });
    if (name === "pr") return route.fulfill({ json: prs.get(Number(u.searchParams.get("number"))) });
    if (name === "diff") return route.fulfill({ json: DIFF });
    return route.fulfill({ status: 404, json: { error: "not mocked" } });
  });
  return writes;
}

async function openPr(page: Page, number: number) {
  await page.evaluate(
    (n) => localStorage.setItem("paseo-command:github:place", JSON.stringify({ kind: "pr", repo: "acme/atlas", number: n, tab: "conversation" })),
    number,
  );
  await page.reload();
  await page.locator(".fleet-sidebar").waitFor();
  await appEvent(page, "paseo:mode", { mode: "github" });
  await page.locator(".gh-pr-title", { hasText: `#${number}` }).waitFor();
}

async function palette(page: Page, query: string) {
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.getByRole("combobox", { name: "Search commands" }).fill(query);
  return dialog;
}
const paletteLabels = async (page: Page, query: string) => {
  const dialog = await palette(page, query);
  await page.waitForTimeout(150);
  const labels = await dialog.getByRole("option").allInnerTexts();
  await page.keyboard.press("Escape");
  return labels.map((l) => l.split("\n")[0]!.trim());
};

test("Merge: the method chosen (remembered for the repository), its commit text, confirmed, and the branch deleted after", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const prs = SAMPLES();
  const writes = await setUp(page, prs, new Set());
  try {
    await page.goto(app.url);
    await openPr(page, 41);
    const view = page.locator(".github-view");
    const section = view.locator(".gh-merge-section");
    await section.getByText("Ready to merge.").waitFor();
    await section.getByText("No conflicts with the base branch.").waitFor();

    // ⌘K offers each method, not what doesn't apply.
    const offered = await paletteLabels(page, "merge");
    for (const label of ["Merge pull request…", "Squash and merge…", "Rebase and merge…"]) assert.ok(offered.includes(label), `${label} in ${offered}`);
    assert.ok(!offered.some((l) => /auto-merge|Reopen/i.test(l)), offered.join());

    // The split button's menu chooses squash, opening its confirmation with GitHub's commit text.
    await view.getByRole("button", { name: "Choose how it merges" }).click();
    await page.getByRole("menuitemradio", { name: /Squash and merge/ }).click();
    const panel = page.getByRole("dialog", { name: "Squash and merge" });
    const title = panel.getByLabel("Commit title");
    assert.equal(await title.inputValue(), "Ship it (#41)");
    assert.equal(await panel.getByLabel("Commit message").inputValue(), "* Ship it");
    await title.fill("Ship the merge box (#41)");
    const del = panel.getByRole("checkbox", { name: /Delete branch-41 after merging/ });
    assert.equal(await del.isChecked(), true);

    if (process.env.GITHUB_SHOT)
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${process.env.GITHUB_SHOT}/merge-confirm-${scheme}.png` });
      }

    await panel.getByRole("button", { name: "Confirm squash and merge" }).click();
    await page.locator(".toast", { hasText: "Merged #41 and deleted branch-41." }).waitFor();
    assert.deepEqual(
      writes.map((w) => w.name),
      ["merge", "deleteBranch"],
    );
    assert.deepEqual(writes[0]!.body, { repo: "acme/atlas", number: 41, prId: "PR_41", method: "squash", headSha: SHA, title: "Ship the merge box (#41)", message: "* Ship it" });
    await view.locator(".gh-state-pill.merged").waitFor();
    await section.getByText(/Merged by me/).waitFor();
    assert.equal(await panel.count(), 0);

    // The method is remembered for the repository: another PR's button says it.
    await openPr(page, 45);
    await view.locator(".gh-merge-anchor").getByRole("button", { name: "Squash and merge" }).waitFor();

    if (process.env.GITHUB_SHOT)
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${process.env.GITHUB_SHOT}/merge-clean-${scheme}.png` });
      }
  } finally {
    await context.close();
  }
});

test("Only the methods the base branch's rules allow: the button says its method, auto-merge and ⌘K offer no other, none says why", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const prs = SAMPLES();
  const writes = await setUp(page, prs, new Set());
  try {
    await page.goto(app.url);
    // A merge commit last used here isn't one these allow.
    await page.evaluate(() => localStorage.setItem("paseo-command:github:mergeMethod", JSON.stringify({ "acme/atlas": "merge" })));
    await openPr(page, 47);
    const view = page.locator(".github-view");
    const anchor = view.locator(".gh-merge-anchor");
    await anchor.getByRole("button", { name: "Squash and merge" }).waitFor();
    assert.equal(await view.getByRole("button", { name: "Choose how it merges" }).count(), 0, "one method: no ▾");
    const offered = await paletteLabels(page, "merge");
    assert.ok(offered.includes("Squash and merge…"), offered.join());
    assert.ok(!offered.some((l) => /Merge pull request…|Rebase and merge…/.test(l)), offered.join());
    await anchor.getByRole("button", { name: "More actions for this pull request" }).click();
    const menu = await page.getByRole("menu").allInnerTexts();
    assert.ok(!/Merge pull request…|Rebase and merge/.test(menu.join()), menu.join());
    await page.keyboard.press("Escape");
    await anchor.getByRole("button", { name: "Squash and merge" }).click();
    const panel = page.getByRole("dialog", { name: "Squash and merge" });
    assert.equal(await panel.getByRole("radio").count(), 0);
    await panel.getByRole("button", { name: "Confirm squash and merge" }).click();
    await page.locator(".toast", { hasText: /Merged #47/ }).waitFor();
    assert.equal(writes.find((w) => w.name === "merge")!.body.method, "squash");

    // Blocked: auto-merge only by squash.
    await openPr(page, 48);
    await anchor.getByRole("button", { name: "Auto-merge", exact: true }).waitFor();
    const autoOffered = await paletteLabels(page, "auto-merge");
    assert.deepEqual(autoOffered.filter((l) => /^Enable auto-merge/.test(l)), ["Enable auto-merge (squash and merge)…"]);

    // None allowed: it says so, and nothing offers a merge.
    await openPr(page, 49);
    await view.locator(".gh-merge-section").getByText("The base branch’s rules allow none of the repository’s merge methods.").waitFor();
    const merge = anchor.getByRole("button", { name: "Merge", exact: true });
    assert.equal(await merge.isDisabled(), true);
    assert.ok(!(await paletteLabels(page, "merge")).some((l) => /and merge…|Merge pull request…|Enable auto-merge/.test(l)));
  } finally {
    await context.close();
  }
});

test("Blocked: it says why; auto-merge turns on with a method and, refused off, is put back with a notice", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const prs = SAMPLES();
  const refuse = new Set<string>();
  const writes = await setUp(page, prs, refuse);
  try {
    await page.goto(app.url);
    // Conflicts: Merge shows, disabled, saying why; there's no auto-merge.
    await openPr(page, 46);
    const view = page.locator(".github-view");
    const section = view.locator(".gh-merge-section");
    await section.getByText("This branch has conflicts that must be resolved.").waitFor();
    const merge = view.locator(".gh-merge-anchor").getByRole("button", { name: "Merge pull request", exact: true });
    assert.equal(await merge.isDisabled(), true);
    assert.equal(await merge.getAttribute("data-tip"), "This branch has conflicts that must be resolved.");
    assert.ok(!(await paletteLabels(page, "merge")).some((l) => /…$/.test(l) && /merge/i.test(l) && !/Close/.test(l)));

    // Review required and checks pending: the reasons, and Enable auto-merge instead.
    await openPr(page, 42);
    await section.getByText("Review required.").waitFor();
    await section.getByText("Some checks haven’t completed yet.").waitFor();
    if (process.env.GITHUB_SHOT)
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${process.env.GITHUB_SHOT}/merge-blocked-${scheme}.png` });
      }
    const dialog = await palette(page, "Enable auto-merge (rebase");
    await dialog.getByRole("option", { name: /Enable auto-merge \(rebase and merge\)…/ }).click();
    const panel = page.getByRole("dialog", { name: "Enable auto-merge" });
    assert.equal(await panel.getByLabel("Commit title").count(), 0, "a rebase has no commit text");
    await panel.getByText("Review required.").waitFor();
    await panel.getByRole("button", { name: "Confirm auto-merge" }).click();
    await section.getByText(/Auto-merge is on \(rebase and merge\), turned on by/).waitFor();
    assert.deepEqual(writes.at(-1), { name: "autoMerge", body: { repo: "acme/atlas", number: 42, prId: "PR_42", enable: true, method: "rebase", headSha: SHA } });

    // Disabling, refused: off at once, then back on, the notice saying why.
    refuse.add("autoMerge:false");
    await view.getByRole("button", { name: "Disable auto-merge" }).first().click();
    await page.locator(".toast", { hasText: "Couldn’t disable auto-merge: Pull request auto merge is not allowed right now." }).waitFor();
    await section.getByText(/Auto-merge is on/).waitFor();
    // Allowed: it goes.
    refuse.clear();
    await section.getByRole("button", { name: "Disable auto-merge" }).click();
    await waitFor(() => section.getByText(/Auto-merge is on/).count(), (n) => n === 0, "auto-merge off");
  } finally {
    await context.close();
  }
});

test("Ready for review, update branch, the merge queue, close with a comment and reopen", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const prs = SAMPLES();
  const writes = await setUp(page, prs, new Set());
  try {
    await page.goto(app.url);
    // A draft behind its base: the reasons; Ready for review in the header; Update branch in ⋯.
    await openPr(page, 43);
    const view = page.locator(".github-view");
    const section = view.locator(".gh-merge-section");
    await section.getByText("This pull request is still a draft.").waitFor();
    await section.getByText("This branch is out of date with the base branch.").waitFor();
    await view.locator(".gh-merge-anchor").getByRole("button", { name: "Ready for review" }).click();
    await view.locator(".gh-state-pill.open").waitFor();
    assert.deepEqual(writes.at(-1), { name: "ready", body: { repo: "acme/atlas", number: 43, prId: "PR_43", ready: true } });
    await view.getByRole("button", { name: "More actions for this pull request" }).click();
    await page.getByRole("menuitem", { name: "Update branch by rebasing" }).click();
    await page.locator(".toast", { hasText: "Rebasing branch-43 onto main…" }).waitFor();
    assert.deepEqual(writes.at(-1), { name: "updateBranch", body: { repo: "acme/atlas", number: 43, prId: "PR_43", method: "rebase", headSha: SHA } });
    await waitFor(() => section.getByText("This branch is out of date with the base branch.").count(), (n) => n === 0, "up to date");
    // Back to a draft from ⌘K.
    await (await palette(page, "Convert to draft")).getByRole("option", { name: /Convert to draft/ }).click();
    await view.locator(".gh-state-pill.draft").waitFor();

    // A merge queue: Merge when ready adds it; the section says where it stands; Remove takes it out.
    await openPr(page, 44);
    await section.getByText("main merges through a merge queue.").waitFor();
    await view.locator(".gh-merge-anchor").getByRole("button", { name: "Merge when ready" }).click();
    await section.getByText("In the merge queue (position 2): awaiting checks.").waitFor();
    assert.deepEqual(writes.at(-1), { name: "queue", body: { repo: "acme/atlas", number: 44, prId: "PR_44", action: "add", headSha: SHA } });
    await view.locator(".gh-merge-anchor").getByRole("button", { name: "Remove from queue" }).click();
    await waitFor(() => section.getByText(/In the merge queue/).count(), (n) => n === 0, "dequeued");
    assert.equal(writes.at(-1)!.body.action, "remove");

    // Close with a comment (⌘K), confirmed in its panel; then Reopen.
    await openPr(page, 45);
    await (await palette(page, "Close pull request")).getByRole("option", { name: /Close pull request…/ }).click();
    const close = page.getByRole("dialog", { name: "Close pull request" });
    await close.locator("textarea").fill("Superseded by #41.");
    if (process.env.GITHUB_SHOT)
      for (const scheme of ["dark", "light"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${process.env.GITHUB_SHOT}/merge-close-${scheme}.png` });
      }
    await close.getByRole("button", { name: "Close pull request" }).click();
    await view.locator(".gh-state-pill.closed").waitFor();
    assert.deepEqual(writes.at(-1), { name: "state", body: { repo: "acme/atlas", number: 45, prId: "PR_45", state: "closed", comment: "Superseded by #41." } });
    await section.getByText(/Closed without merging/).waitFor();
    const labels = await paletteLabels(page, "pull request");
    assert.ok(labels.includes("Reopen pull request") && !labels.includes("Close pull request…"), labels.join());
    await view.locator(".gh-merge-anchor").getByRole("button", { name: "Reopen" }).click();
    await view.locator(".gh-state-pill.open").waitFor();
    assert.deepEqual(writes.at(-1), { name: "state", body: { repo: "acme/atlas", number: 45, prId: "PR_45", state: "open" } });
  } finally {
    await context.close();
  }
});

test("The PR view's controls: one height, one row, nothing wrapping, and Merge isn't the primary action while a review is required", async () => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  const prs = SAMPLES();
  // #42 as the user's: waiting on a review and checks, its branch checked out in a Paseo workspace.
  Object.assign(prs.get(42)!, {
    additions: 354,
    deletions: 3,
    changedFiles: 1,
    files: [{ path: "src/merge.ts", additions: 2, deletions: 1, changeType: "modified", viewed: "unviewed" }],
    commits: [{ sha: SHA, title: "Ship the merge box", author: { login: "sam" }, at: ago(30) }],
    timeline: [{ kind: "comment", id: "c1", author: { login: "ada" }, body: "Looks close.", createdAt: ago(20), url: "https://github.com/acme/atlas/pull/42#c1" }],
    checkRuns: [
      { name: "test", state: "pending", source: "CI" },
      { name: "lint", state: "passing", source: "CI", url: "https://github.com/acme/atlas/actions/runs/1" },
      { name: "deploy preview", state: "skipped", source: "Vercel" },
    ],
  });
  const workspaces = small.workspaces.map((w) => (w.workspaceId === "wks_a" ? { ...w, branch: "branch-42", repo: "https://github.com/acme/atlas" } : w));
  await setUp(page, prs, new Set(), workspaces);
  const shoot = async (name: string) => {
    if (!process.env.GITHUB_SHOT) return;
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${process.env.GITHUB_SHOT}/${name}-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: "dark" });
  };
  try {
    await page.goto(app.url);
    await openPr(page, 42);
    const view = page.locator(".github-view");
    await view.getByRole("button", { name: "Open Paseo agent" }).waitFor();
    await shoot("pr-blocked");

    // The header's actions: one row, one height, none wrapping.
    const head = view.locator(".gh-tabs");
    const boxes = await head.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("button:not([role=tab])")]
        .filter((b) => b.offsetParent)
        .map((b) => ({ name: b.getAttribute("aria-label") ?? b.textContent!.trim(), top: Math.round(b.getBoundingClientRect().top), height: Math.round(b.getBoundingClientRect().height), wraps: b.scrollWidth > b.clientWidth + 1 || getComputedStyle(b).whiteSpace !== "nowrap" })),
    );
    const names = boxes.map((b) => b.name);
    for (const n of ["Open Paseo agent", "Review", "Auto-merge", "Choose how it merges", "More actions for this pull request"]) assert.ok(names.includes(n), `${n} in ${names}`);
    assert.equal(new Set(boxes.map((b) => b.height)).size, 1, JSON.stringify(boxes));
    assert.equal(new Set(boxes.map((b) => b.top)).size, 1, JSON.stringify(boxes));
    assert.deepEqual(boxes.filter((b) => b.wraps), []);
    assert.ok(boxes[0]!.height <= 28, `header buttons ${boxes[0]!.height}px tall`);
    // The stat sits in that row too.
    await head.locator(".gh-churn").waitFor();

    // Review required: Review is the one primary action; Merge stays quiet.
    const primaries = await view.locator(".page-btn.solid").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent).map((e) => e.textContent!.trim()).filter(Boolean));
    assert.deepEqual(primaries, ["Review"]);

    // The Merge section: small buttons on a line each, at the header's height, none wrapping.
    const section = view.locator(".gh-merge-section");
    await section.getByText("Review required.").waitFor();
    const actions = await section.locator(".gh-merge-actions button").evaluateAll((els) =>
      els.map((b) => ({ text: b.textContent!.trim(), height: Math.round(b.getBoundingClientRect().height), wraps: b.scrollWidth > b.clientWidth + 1 || getComputedStyle(b).whiteSpace !== "nowrap" })),
    );
    assert.ok(actions.some((a) => a.text === "Auto-merge…"), JSON.stringify(actions));
    assert.deepEqual(actions.filter((a) => a.wraps || a.height !== boxes[0]!.height), []);

    // The conversation's order toggle and Comment keep the same scale.
    const toggle = await view.getByRole("radio", { name: "Newest first" }).evaluate((b) => Math.round(b.getBoundingClientRect().height));
    assert.ok(toggle <= boxes[0]!.height, `order toggle ${toggle}px`);
    const comment = await view.locator("#gh-pr-comment").getByRole("button", { name: "Comment" }).evaluate((b) => Math.round(b.getBoundingClientRect().height));
    assert.equal(comment, boxes[0]!.height);

    // An administrator past the requirements: Merge says it bypasses them.
    prs.get(42)!.merge = { ...prs.get(42)!.merge, canMergeAsAdmin: true };
    await openPr(page, 42);
    await view.locator(".gh-merge-anchor").getByRole("button", { name: "Merge pull request (bypass)" }).waitFor();
    assert.deepEqual(
      await view.locator(".page-btn.solid").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent).map((e) => e.textContent!.trim()).filter(Boolean)),
      ["Review"],
    );
    await view.locator(".gh-merge-section").getByRole("button", { name: "Merge pull request (bypass)…" }).waitFor();
    await shoot("pr-admin");

    // A clean PR: Merge is the primary, Review quiet.
    await openPr(page, 41);
    await view.locator(".gh-merge-section").getByText("Ready to merge.").waitFor();
    assert.deepEqual(
      await view.locator(".page-btn.solid").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent).map((e) => e.textContent!.trim()).filter(Boolean)),
      ["Merge pull request"],
    );
    await shoot("pr-clean");

    // Files changed and Checks.
    await openPr(page, 42);
    await view.getByRole("tab", { name: /Files changed/ }).click();
    await view.locator(".gh-toolbar").waitFor();
    await page.waitForTimeout(800);
    await shoot("pr-files");
    await view.locator(".gh-tabs").getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("dialog", { name: "Submit your review" }).waitFor();
    await shoot("pr-review-panel");
    await page.keyboard.press("Escape");
    await view.getByRole("tab", { name: /Checks/ }).click();
    await view.locator(".gh-check-list").waitFor();
    await shoot("pr-checks");
  } finally {
    await context.close();
  }
});
