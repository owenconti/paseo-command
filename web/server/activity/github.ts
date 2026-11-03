/**
 * Activity's GitHub source: your notifications, from GitHub's API with the
 * GitHub token (`githubApi.ts`: `GET /notifications`), only while
 * `integrations.github` is on. Unread ones and those read in the last 14 days, at most 100, kept
 * for `GITHUB_ACTIVITY.ttlMs`; each pull request's or issue's state is asked
 * for in one GraphQL query alongside, and left out when GitHub can't answer it.
 * Writes: read (`PATCH /notifications/threads/:id`) and done (`DELETE`).
 * GitHub can't mark a notification unread. GitHub's list (`all=true`) still
 * has threads marked done, as read ones, and moves their `updated_at` for
 * activity that doesn't notify you, so those done here are kept in the data
 * directory's `github-activity.json` (GitHub's time for them and when they were
 * marked) and left out, across launches, until a genuinely newer event
 * (`marks.ts`). A write forgets the cached list; its marks keep lagging lists
 * (and reads begun before it) from putting anything back.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActivityItem, ActivityWriteName } from "../../src/activity/types";
import { githubGraphql, githubRest } from "../githubApi";
import { dataDir } from "../subagentArchive";
import { ACTIVITY_MARKS, applyMarks, newMarks, type DoneMark } from "./marks";

export const GITHUB_ACTIVITY = {
  ttlMs: 60_000,
  days: 14,
  perPage: 50,
  max: 100,
};

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const SLUG = /^[\w.-]{1,100}$/;

/** A notification's subject as Activity's: pull, issue, release, discussion, commit, check, else alert. */
export function subjectKind(type: string): string {
  switch (type) {
    case "PullRequest":
      return "pull";
    case "Issue":
      return "issue";
    case "Release":
      return "release";
    case "Discussion":
      return "discussion";
    case "Commit":
      return "commit";
    case "CheckSuite":
    case "WorkflowRun":
      return "check";
    default:
      return "alert";
  }
}

/** The repository's page, when it's an https address. */
function repoPage(repo: Raw, full: string): string | undefined {
  const html = str(repo.html_url);
  if (/^https:\/\/[^/\s]+\/[\w.-]+\/[\w.-]+$/.test(html)) return html;
  return full && /^[\w.-]+\/[\w.-]+$/.test(full) ? `https://github.com/${full}` : undefined;
}

/**
 * The subject's page from its API address (`api.github.com/repos/o/r/pulls/12`
 * → `github.com/o/r/pull/12`): issues and commits likewise, a release the
 * repository's releases, a discussion its discussions, a check its actions, else the repository.
 */
export function subjectUrl(apiUrl: string, type: string, repo?: string): string | undefined {
  const m = /^https:\/\/api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+)\/([a-z]+)\/([\w.-]+)$/.exec(apiUrl);
  if (m) {
    const [, owner, name, kind, id] = m;
    const base = `https://github.com/${owner}/${name}`;
    if (kind === "pulls" && /^\d+$/.test(id!)) return `${base}/pull/${id}`;
    if (kind === "issues" && /^\d+$/.test(id!)) return `${base}/issues/${id}`;
    if (kind === "commits" && /^[0-9a-f]{7,40}$/i.test(id!)) return `${base}/commit/${id}`;
    if (kind === "releases") return `${base}/releases`;
    if (kind === "discussions" && /^\d+$/.test(id!)) return `${base}/discussions/${id}`;
    return base;
  }
  if (!repo) return undefined;
  if (type === "Release") return `${repo}/releases`;
  if (type === "Discussion") return `${repo}/discussions`;
  if (type === "CheckSuite" || type === "WorkflowRun") return `${repo}/actions`;
  return repo;
}

/** The subject's number (a pull request's, an issue's, a discussion's), from its API address. */
const subjectNumber = (apiUrl: string) => /\/(?:pulls|issues|discussions)\/(\d+)$/.exec(apiUrl)?.[1];

/** One of GitHub's notifications as an Activity item; null without an id. */
export function githubItem(raw: unknown): ActivityItem | null {
  const n = rec(raw);
  const id = str(n.id);
  if (!/^\d{1,30}$/.test(id)) return null;
  const subject = rec(n.subject);
  const repo = rec(n.repository);
  const full = str(repo.full_name);
  const type = str(subject.type);
  const apiUrl = str(subject.url);
  const number = subjectNumber(apiUrl);
  const page = repoPage(repo, full);
  const url = subjectUrl(apiUrl, type, page);
  return {
    key: `github:${id}`,
    source: "github",
    id,
    kind: clip(str(n.reason) || "subscribed", 60),
    title: clip(str(subject.title) || full || "GitHub notification", 300),
    ...(full ? { subtitle: clip(number ? `${full} #${number}` : full, 300) } : {}),
    subject: subjectKind(type),
    at: str(n.updated_at) || new Date(0).toISOString(),
    unread: n.unread === true,
    ...(url ? { url } : {}),
  };
}

/** One query for the states of these pull requests and issues (`o/r#n`), by alias. */
export function stateQuery(items: { repo: string; number: string }[]): string | null {
  const byRepo = new Map<string, Set<string>>();
  for (const { repo, number } of items) {
    const [owner, name] = repo.split("/");
    if (!owner || !name || !SLUG.test(owner) || !SLUG.test(name) || !/^\d{1,9}$/.test(number)) continue;
    byRepo.set(repo, (byRepo.get(repo) ?? new Set()).add(number));
  }
  if (!byRepo.size) return null;
  const parts = [...byRepo].map(([repo, numbers], r) => {
    const [owner, name] = repo.split("/");
    const nodes = [...numbers]
      .map((n) => `n${n}: issueOrPullRequest(number: ${n}) { ... on PullRequest { state isDraft } ... on Issue { state } }`)
      .join(" ");
    return `r${r}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${nodes} }`;
  });
  return `query ActivityStates { ${parts.join(" ")} }`;
}

/** The states the query answered, by `o/r#n`: open, closed, merged or draft. */
export function statesFrom(items: { repo: string; number: string }[], answer: unknown): Map<string, string> {
  const repos = [...new Set(items.map((i) => i.repo))].filter((repo) => {
    const [owner, name] = repo.split("/");
    return owner && name && SLUG.test(owner) && SLUG.test(name);
  });
  const data = rec(rec(answer).data);
  const out = new Map<string, string>();
  repos.forEach((repo, r) => {
    const nodes = rec(data[`r${r}`]);
    for (const [alias, node] of Object.entries(nodes)) {
      const number = /^n(\d+)$/.exec(alias)?.[1];
      const n = rec(node);
      const state = str(n.state).toLowerCase();
      if (!number || !state) continue;
      out.set(`${repo}#${number}`, n.isDraft === true && state === "open" ? "draft" : state);
    }
  });
  return out;
}

type Gathered = { items: ActivityItem[]; lastRead: Map<string, string> };
let cache: { at: number; list: Promise<Gathered> } | undefined;
/** Threads marked here: done ones (kept in the file) left out until something newer, read ones while GitHub's list settles. */
const marks = newMarks();
const done = marks.done;
let doneLoaded = false;

export const githubActivityFile = () => join(dataDir(), "github-activity.json");

/** The threads marked done, from the file (once a launch). */
function loadDone(): void {
  if (doneLoaded) return;
  doneLoaded = true;
  try {
    const raw = JSON.parse(readFileSync(githubActivityFile(), "utf8")) as { done?: unknown };
    const kept = raw.done && typeof raw.done === "object" && !Array.isArray(raw.done) ? raw.done : {};
    const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
    for (const [id, mark] of Object.entries(kept)) {
      if (!/^\d{1,30}$/.test(id)) continue;
      // Earlier launches kept only GitHub's time.
      if (isTime(mark)) done.set(id, { at: mark, doneAt: mark });
      else if (mark && isTime(mark.at) && isTime(mark.doneAt)) done.set(id, { at: mark.at, doneAt: mark.doneAt });
    }
  } catch {
    // None yet (or unreadable): nothing was marked done.
  }
}

/** Saves them, without those older than the list reaches (they won't show again anyway), at most 1,000. */
function saveDone(): void {
  const cut = Date.now() - (GITHUB_ACTIVITY.days + 1) * 86_400_000;
  for (const [id, mark] of done) if (Math.max(Date.parse(mark.at), Date.parse(mark.doneAt)) < cut) done.delete(id);
  while (done.size > 1000) done.delete(done.keys().next().value!);
  mkdirSync(dataDir(), { recursive: true });
  const file = githubActivityFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ done: Object.fromEntries(done) }) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Forgets what was kept (tests); `relaunch` keeps the file, as a new launch would find it. */
export function resetGithubActivity({ relaunch = false } = {}): void {
  cache = undefined;
  done.clear();
  marks.read.clear();
  doneLoaded = false;
  if (!relaunch) rmSync(githubActivityFile(), { force: true });
}

const repoOf = (item: ActivityItem) => {
  const m = /^([\w.-]+\/[\w.-]+) #(\d+)$/.exec(item.subtitle ?? "");
  return m && (item.subject === "pull" || item.subject === "issue") ? { repo: m[1]!, number: m[2]! } : null;
};

async function gather(): Promise<Gathered> {
  const since = new Date(Date.now() - GITHUB_ACTIVITY.days * 86_400_000).toISOString();
  const page = async (n: number) => {
    const { data } = await githubRest<unknown>(
      "GET",
      `notifications?all=true&since=${encodeURIComponent(since)}&per_page=${GITHUB_ACTIVITY.perPage}&page=${n}`,
    );
    return Array.isArray(data) ? data : [];
  };
  const raw: unknown[] = [];
  for (let n = 1; raw.length < GITHUB_ACTIVITY.max; n++) {
    const list = await page(n);
    raw.push(...list);
    if (list.length < GITHUB_ACTIVITY.perPage) break;
  }
  // When GitHub says you last read each thread: something newer than that is new to you.
  const lastRead = new Map<string, string>();
  for (const n of raw) {
    const { id, last_read_at } = rec(n);
    if (typeof id === "string" && typeof last_read_at === "string") lastRead.set(id, last_read_at);
  }
  const items = raw
    .map(githubItem)
    .filter((i): i is ActivityItem => i !== null)
    .slice(0, GITHUB_ACTIVITY.max);
  // Each pull request's and issue's state: nice to have, so a failure leaves them without.
  const refs = items.map(repoOf).filter((r) => r !== null);
  const query = stateQuery(refs);
  if (query) {
    let answer: unknown;
    try {
      // Errors for some items (a deleted repo, no access) still leave the others' data.
      answer = { data: await githubGraphql(query) };
    } catch {
      // Without states.
    }
    if (answer !== undefined) {
      const states = statesFrom(refs, answer);
      for (const item of items) {
        const ref = repoOf(item);
        const state = ref && states.get(`${ref.repo}#${ref.number}`);
        if (state) item.state = state;
      }
    }
  }
  return { items, lastRead };
}

/** Your GitHub notifications as Activity items; throws a GithubApiError (off, no token, refused…) when GitHub can't answer. */
export async function readGithubActivity(fresh = false): Promise<ActivityItem[]> {
  const now = Date.now();
  if (fresh || !cache || now - cache.at >= GITHUB_ACTIVITY.ttlMs) {
    const list = gather();
    cache = { at: now, list };
    // A failure isn't kept: the next read asks again.
    list.catch(() => {
      if (cache?.list === list) cache = undefined;
    });
  }
  const { items, lastRead } = await cache.list;
  // The marks as they are now, whenever this list was asked for.
  loadDone();
  const { items: shown, back } = applyMarks(marks, items, (id) => lastRead.get(id));
  if (back.length) save();
  return shown;
}

function save(): void {
  try {
    saveDone();
  } catch {
    // Not saved: kept until the app closes.
  }
}

/** Marks these GitHub items read or done; answers those that failed, with why. */
export async function writeGithubActivity(
  name: ActivityWriteName,
  items: ActivityItem[],
): Promise<{ key: string; error: string }[]> {
  if (name === "unread")
    return items.map((i) => ({ key: i.key, error: "GitHub can't mark a notification unread." }));
  const failed: { key: string; error: string }[] = [];
  loadDone();
  let marked = false;
  await Promise.all(
    items.map(async (item) => {
      if (!/^\d{1,30}$/.test(item.id)) return void failed.push({ key: item.key, error: "Not a GitHub notification." });
      // Marked before GitHub is asked, so no read answering meanwhile puts it back; undone if GitHub refuses.
      const at = item.at;
      const markedAt = new Date(ACTIVITY_MARKS.now()).toISOString();
      const before = { done: done.get(item.id), read: marks.read.get(item.id) };
      if (name === "done") done.set(item.id, { at, doneAt: markedAt } satisfies DoneMark);
      else marks.read.set(item.id, { unread: false, at, markedAt });
      try {
        await githubRest(name === "read" ? "PATCH" : "DELETE", `notifications/threads/${item.id}`);
        if (name === "done") marked = true;
      } catch (e) {
        if (before.done) done.set(item.id, before.done);
        else if (name === "done") done.delete(item.id);
        if (before.read) marks.read.set(item.id, before.read);
        else if (name === "read") marks.read.delete(item.id);
        failed.push({ key: item.key, error: e instanceof Error ? e.message : "GitHub didn't answer." });
      }
    }),
  );
  // The list from before the writes is forgotten: the next read asks GitHub, the marks covering its lag.
  cache = undefined;
  // Kept across launches: GitHub's list still has them.
  if (marked) save();
  return failed;
}
