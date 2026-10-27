/**
 * The commits on Paseo Command's own `main`, for the panel header's commit
 * list. Read-only: plain `git log`/`rev-parse` with optional locks off, no
 * fetch, nothing written. The repository is this app's main checkout
 * (`mainCheckout()`: `PASEO_COMMAND_REPO`, which the packaged app's helper
 * sets from the checkout recorded in its bundle, else the checkout the dev
 * or production server runs from).
 *
 * `main` is resolved at most every few seconds per repository (the cheap
 * poll); the list is rebuilt only when that sha changes.
 */
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
// Not ./service: that module runs its CLI when it is the entry point, and
// bundled into the native helper every module shares the entry's URL.
import { mainCheckout } from "./checkout";

export type MainCommit = {
  sha: string;
  subject: string;
  author: string;
  /** Author date, ISO 8601. */
  date: string;
};
export type CommitsView =
  | { available: false }
  | { available: true; head: string; commits: MainCommit[] };

export const MAIN_LIMIT = 50;
/** How long a resolved `main` is trusted before it is read again. */
export const HEAD_MAX_AGE_MS = 2000;
const GIT_TIMEOUT_MS = 10000;

export const commitsRepo = () => mainCheckout();

function git(repo: string, args: string[]) {
  // Nothing inherited may point git elsewhere, and discovery stops at the
  // repository itself (a plain directory inside a repo is not that repo).
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!k.startsWith("GIT_")) env[k] = v;
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_CEILING_DIRECTORIES = dirname(resolve(repo));
  env.GIT_TERMINAL_PROMPT = "0";
  return new Promise<string>((done, fail) =>
    execFile(
      "git",
      ["--no-optional-locks", "-C", repo, ...args],
      {
        env,
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout) => (error ? fail(error) : done(stdout)),
    ),
  );
}

const FIELD = "\x1f";
const RECORD = "\x1e";
const FORMAT = `--format=%H${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`;
function parse(out: string) {
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => {
      const [sha, author, date, subject] = r.split(FIELD);
      return {
        sha,
        author,
        date,
        subject: subject ?? "",
      };
    });
}

async function headOf(repo: string): Promise<string | null> {
  try {
    const sha = (
      await git(repo, [
        "rev-parse",
        "--verify",
        "--quiet",
        "refs/heads/main^{commit}",
      ])
    ).trim();
    return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

// The commits themselves, not merges: a merge commit only names a branch,
// so the list shows every commit reachable from main, newest first.
async function build(repo: string, head: string): Promise<CommitsView> {
  const commits = parse(
    await git(repo, [
      "log",
      "--no-merges",
      // Children before parents, a branch's commits together.
      "--topo-order",
      "--no-color",
      `--max-count=${MAIN_LIMIT}`,
      FORMAT,
      head,
    ]),
  );
  return { available: true, head, commits };
}

type Entry = {
  checked: number;
  head: string | null;
  /** The list for `head`, being built or built. */
  view?: Promise<CommitsView>;
  viewHead?: string;
  resolving?: Promise<string | null>;
};
const cache = new Map<string, Entry>();

/** Main's sha now (re-read when older than `maxAgeMs`), or null without one. */
export async function mainHead(
  repo = commitsRepo(),
  options: { maxAgeMs?: number } = {},
): Promise<string | null> {
  const key = resolve(repo);
  const maxAge = options.maxAgeMs ?? HEAD_MAX_AGE_MS;
  let entry = cache.get(key);
  if (!entry) cache.set(key, (entry = { checked: 0, head: null }));
  const e = entry;
  if (e.checked && Date.now() - e.checked < maxAge && !e.resolving)
    return e.head;
  e.resolving ??= headOf(key).then((head) => {
    e.head = head;
    e.checked = Date.now();
    e.resolving = undefined;
    return head;
  });
  return e.resolving;
}

/** The newest commits on main, cached by main's sha. Never throws. */
export async function mainCommits(
  repo = commitsRepo(),
  options: { maxAgeMs?: number } = {},
): Promise<CommitsView> {
  const key = resolve(repo);
  const head = await mainHead(key, options);
  const entry = cache.get(key)!;
  if (!head) return { available: false };
  if (entry.viewHead !== head || !entry.view) {
    entry.viewHead = head;
    entry.view = build(key, head).catch(() => {
      if (entry.viewHead === head) entry.view = undefined;
      return { available: false } as const;
    });
  }
  return entry.view;
}
