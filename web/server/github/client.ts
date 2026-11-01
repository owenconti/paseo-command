/**
 * The GitHub tab's gh: the user's own gh sign-in, only while
 * `integrations.github` is on. Reads are cached for `GITHUB_TAB.ttlMs`
 * (`fresh` asks past it); writes clear what they change. Tests replace
 * `GITHUB_TAB.run` (`fake.ts`); nothing else here reaches GitHub.
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import type { GithubUnavailable } from "../../src/github/types";
import { ghFailure } from "../activity/github";
import { integrationEnabled } from "../integrations";
import { GH } from "../links";

export const OFF = "Enable GitHub in Settings to review pull requests.";
export const SIGNED_OUT = "Sign in with gh auth login to review pull requests.";
export const NO_GH = "Install the GitHub CLI (gh) and sign in with gh auth login to review pull requests.";

/** gh non-interactively, in the home directory, with `input` on stdin (`--input -`). */
function runGh(args: string[], input?: string): Promise<string> {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  env.PATH = [env.PATH, ...GH.extraPath].filter(Boolean).join(delimiter);
  Object.assign(env, { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_PAGER: "cat", NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" });
  return new Promise<string>((done, fail) => {
    const child = execFile(
      "gh",
      args,
      { cwd: homedir(), env, encoding: "utf8", timeout: GITHUB_TAB.timeoutMs, maxBuffer: GITHUB_TAB.maxBuffer },
      (error, stdout, stderr) =>
        error ? fail(Object.assign(error, { stderr: String(stderr ?? ""), stdout: String(stdout ?? "") })) : done(stdout),
    );
    child.stdin?.end(input ?? "");
  });
}

export const GITHUB_TAB = {
  ttlMs: 15_000,
  timeoutMs: 30_000,
  maxBuffer: 20 * 1024 * 1024,
  /** Runs gh with these arguments (and stdin) and answers its output (tests put a fake here). */
  run: runGh as (args: string[], input?: string) => Promise<string>,
};

/** Why GitHub can't be asked right now; the view shows `reason`. */
export class GithubTabError extends Error {
  constructor(
    readonly kind: "off" | "no-gh" | "signed-out" | "invalid" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "GithubTabError";
  }
}

/** Refuses while the integration is off. */
export function assertEnabled(): void {
  if (!integrationEnabled("github")) throw new GithubTabError("off", OFF);
}

/** gh's failure in words for the view (GitHub's own message for a refused write when it gives one). */
export function tabFailure(e: unknown): GithubTabError {
  if (e instanceof GithubTabError) return e;
  const f = ghFailure(e);
  if (f.kind === "no-gh") return new GithubTabError("no-gh", NO_GH);
  if (f.kind === "signed-out") return new GithubTabError("signed-out", SIGNED_OUT);
  const said = githubMessage(e);
  if (said) return new GithubTabError("failed", said);
  return new GithubTabError("failed", f.message === "GitHub didn't answer in time." ? f.message : "GitHub didn't answer.");
}

/** The message in GitHub's JSON answer to a refused request (`gh api` prints it), clipped. */
function githubMessage(e: unknown): string | undefined {
  const err = e as { stdout?: unknown; stderr?: unknown };
  for (const text of [err?.stdout, err?.stderr]) {
    if (typeof text !== "string" || !text.trim()) continue;
    try {
      const body = JSON.parse(text) as { message?: unknown; errors?: unknown };
      const errors = Array.isArray(body.errors) ? body.errors : [];
      const first = errors.map((x) => (typeof x === "string" ? x : (x as { message?: unknown })?.message)).find((m) => typeof m === "string");
      const message = [body.message, first].filter((m) => typeof m === "string" && m).join(": ");
      if (message) return message.slice(0, 300);
    } catch {
      // Not JSON: gh's own words, below.
    }
    const line = text.split("\n").map((l) => l.trim()).find(Boolean);
    if (line && !/HTTP 40[13]|ENOENT|timed? ?out/i.test(text)) return line.replace(/^gh: /, "").slice(0, 300);
  }
  return undefined;
}

export const unavailable = (e: GithubTabError): GithubUnavailable => ({ available: false, reason: e.message });

// ── Cache ────────────────────────────────────────────────────────────────────
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** `read()` once per `GITHUB_TAB.ttlMs` for `key`; a failure isn't kept. */
export function cached<T>(key: string, fresh: boolean, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < GITHUB_TAB.ttlMs) return hit.value as Promise<T>;
  const value = read();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

/** Forgets cached reads whose key starts with one of these. */
export function forget(...prefixes: string[]): void {
  for (const key of [...cache.keys()]) if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
}
export const resetGithubTab = () => cache.clear();

/** Runs gh, its failures as `GithubTabError`. */
export async function gh(args: string[], input?: string): Promise<string> {
  try {
    return await GITHUB_TAB.run(args, input);
  } catch (e) {
    throw tabFailure(e);
  }
}

/**
 * A GraphQL query's `data`, with its variables passed as gh's typed fields
 * (`-F` numbers and booleans, `-f` strings, never read as files). A query's
 * partial answer stands; a mutation (`strict`) with any error fails with it.
 */
export async function graphql(
  query: string,
  vars: Record<string, string | number | boolean> = {},
  strict = false,
): Promise<Record<string, unknown>> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === "string" ? "-f" : "-F", `${k}=${v}`);
  let out: string;
  try {
    out = await GITHUB_TAB.run(args);
  } catch (e) {
    // A partial answer (some fields refused) still has its data.
    const stdout = (e as { stdout?: unknown })?.stdout;
    const data = typeof stdout === "string" ? parseData(stdout, strict) : undefined;
    if (data) return data;
    throw tabFailure(e);
  }
  const data = parseData(out, strict);
  if (!data) throw new GithubTabError("failed", "GitHub didn't answer.");
  return data;
}

function parseData(out: string, strict: boolean): Record<string, unknown> | undefined {
  try {
    const body = JSON.parse(out) as { data?: unknown; errors?: unknown };
    const errors = Array.isArray(body.errors) && body.errors.length > 0;
    if (body.data && typeof body.data === "object" && !(strict && errors)) return body.data as Record<string, unknown>;
    if (errors) {
      const list = body.errors as unknown[];
      const m = (list[0] as { message?: unknown })?.message;
      throw new GithubTabError("failed", typeof m === "string" ? m.slice(0, 300) : "GitHub refused the request.");
    }
  } catch (e) {
    if (e instanceof GithubTabError) throw e;
  }
  return undefined;
}
