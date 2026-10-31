/**
 * Activity's GitHub source: your notifications, through gh (`gh api
 * /notifications`, the user's own gh sign-in), only while `integrations.github`
 * is on. Unread ones and those read in the last 14 days, at most 100, kept
 * for `GITHUB_ACTIVITY.ttlMs`; each pull request's or issue's state is asked
 * for in one GraphQL query alongside, and left out when gh can't answer it.
 * Writes: read (`PATCH /notifications/threads/:id`) and done (`DELETE`).
 * GitHub can't mark a notification unread.
 */
import { homedir } from "node:os";
import type { ActivityItem, ActivityWriteName } from "../../src/activity/types";
import { gh } from "../links";

export const GITHUB_ACTIVITY = {
  ttlMs: 60_000,
  days: 14,
  perPage: 50,
  max: 100,
  /** Runs gh with these arguments and answers its output (tests put a fake here). */
  run: (args: string[]): Promise<string> => gh(homedir(), args),
};

export class GithubActivityError extends Error {
  kind: "no-gh" | "signed-out" | "failed";
  constructor(kind: GithubActivityError["kind"], message: string) {
    super(message);
    this.name = "GithubActivityError";
    this.kind = kind;
  }
}

export const SIGNED_OUT = "Sign in with gh auth login to see GitHub notifications.";
export const NO_GH = "Install the GitHub CLI (gh) and sign in with gh auth login to see GitHub notifications.";
export const NO_SCOPE = "gh's sign-in can't read notifications: run gh auth refresh -s notifications.";

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const SLUG = /^[\w.-]{1,100}$/;

/** What gh's failure means, in words for the sidebar. */
export function ghFailure(e: unknown): GithubActivityError {
  if (e instanceof GithubActivityError) return e;
  const err = e as { code?: unknown; stderr?: unknown; message?: unknown };
  if (err?.code === "ENOENT") return new GithubActivityError("no-gh", NO_GH);
  const text = `${str(err?.stderr)} ${str(err?.message)}`;
  if (/gh auth login|not logged in|authentication|HTTP 401|Bad credentials/i.test(text))
    return new GithubActivityError("signed-out", SIGNED_OUT);
  if (/HTTP 403|HTTP 404|Resource not accessible|scope/i.test(text)) return new GithubActivityError("failed", NO_SCOPE);
  if (/timed? ?out|ETIMEDOUT|SIGTERM/i.test(text)) return new GithubActivityError("failed", "GitHub didn't answer in time.");
  return new GithubActivityError("failed", "GitHub didn't answer.");
}

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

/** One of gh's notifications as an Activity item; null without an id. */
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

let cache: { at: number; items: Promise<ActivityItem[]> } | undefined;
/** Threads marked done here, by when GitHub last changed them: left out until they change again. */
const done = new Map<string, string>();

/** Forgets what was kept (tests). */
export function resetGithubActivity(): void {
  cache = undefined;
  done.clear();
}

const repoOf = (item: ActivityItem) => {
  const m = /^([\w.-]+\/[\w.-]+) #(\d+)$/.exec(item.subtitle ?? "");
  return m && (item.subject === "pull" || item.subject === "issue") ? { repo: m[1]!, number: m[2]! } : null;
};

async function gather(): Promise<ActivityItem[]> {
  const since = new Date(Date.now() - GITHUB_ACTIVITY.days * 86_400_000).toISOString();
  const page = async (n: number) => {
    let out: string;
    try {
      out = await GITHUB_ACTIVITY.run([
        "api",
        "-X",
        "GET",
        `/notifications?all=true&since=${encodeURIComponent(since)}&per_page=${GITHUB_ACTIVITY.perPage}&page=${n}`,
      ]);
    } catch (e) {
      throw ghFailure(e);
    }
    let list: unknown;
    try {
      list = JSON.parse(out);
    } catch {
      throw new GithubActivityError("failed", "GitHub's answer couldn't be read.");
    }
    return Array.isArray(list) ? list : [];
  };
  const raw: unknown[] = [];
  for (let n = 1; raw.length < GITHUB_ACTIVITY.max; n++) {
    const list = await page(n);
    raw.push(...list);
    if (list.length < GITHUB_ACTIVITY.perPage) break;
  }
  const items = raw
    .map(githubItem)
    .filter((i): i is ActivityItem => i !== null)
    .slice(0, GITHUB_ACTIVITY.max);
  // Each pull request's and issue's state: nice to have, so a failure leaves them without.
  const refs = items.map(repoOf).filter((r) => r !== null);
  const query = stateQuery(refs);
  if (query) {
    let out: string | undefined;
    try {
      out = await GITHUB_ACTIVITY.run(["api", "graphql", "-f", `query=${query}`]);
    } catch (e) {
      // GraphQL errors for some items (a deleted repo, no access) make gh exit non-zero, but the
      // others' data is still in its output: use what's there.
      const stdout = (e as { stdout?: unknown })?.stdout;
      out = typeof stdout === "string" && stdout.trim() ? stdout : undefined;
    }
    let answer: unknown;
    try {
      answer = out === undefined ? undefined : JSON.parse(out);
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
  return items;
}

/** Your GitHub notifications as Activity items; throws a GithubActivityError when gh can't answer. */
export async function readGithubActivity(fresh = false): Promise<ActivityItem[]> {
  const now = Date.now();
  if (fresh || !cache || now - cache.at >= GITHUB_ACTIVITY.ttlMs) {
    const items = gather();
    cache = { at: now, items };
    // A failure isn't kept: the next read asks again.
    items.catch(() => {
      if (cache?.items === items) cache = undefined;
    });
  }
  const items = await cache.items;
  return items.filter((i) => !(done.has(i.id) && i.at <= done.get(i.id)!)).map((i) => ({ ...i }));
}

/** Marks these GitHub items read or done; answers those that failed, with why. */
export async function writeGithubActivity(
  name: ActivityWriteName,
  items: ActivityItem[],
): Promise<{ key: string; error: string }[]> {
  if (name === "unread")
    return items.map((i) => ({ key: i.key, error: "GitHub can't mark a notification unread." }));
  const failed: { key: string; error: string }[] = [];
  const kept = cache ? await cache.items.catch(() => undefined) : undefined;
  await Promise.all(
    items.map(async (item) => {
      if (!/^\d{1,30}$/.test(item.id)) return void failed.push({ key: item.key, error: "Not a GitHub notification." });
      try {
        await GITHUB_ACTIVITY.run(["api", "-X", name === "read" ? "PATCH" : "DELETE", `/notifications/threads/${item.id}`]);
      } catch (e) {
        failed.push({ key: item.key, error: ghFailure(e).message });
        return;
      }
      // What GitHub now has, without asking it again (its list can lag behind).
      const mine = kept?.find((i) => i.id === item.id);
      if (name === "read" && mine) mine.unread = false;
      if (name === "done") {
        done.set(item.id, mine?.at ?? item.at);
        if (done.size > 1000) done.delete(done.keys().next().value!);
      }
    }),
  );
  return failed;
}
