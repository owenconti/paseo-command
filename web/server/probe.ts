/**
 * Probe's verdict on each workspace's pull request, for the Atlas's review
 * flag streamer (rendering/src/probe.ts). Probe is Diagonal's review bot: it
 * runs as a `probe` GitHub Actions workflow on the PR and posts a review as
 * `diagonalprobe` ("Review: Approved", "Review: Comment" with the findings
 * left open, or a deferral), ending in a `probe-review:v1 … head=<sha>` marker.
 *
 * - The PR is Paseo's (the workspace row's `pr`), else, for a checkout on
 *   this machine, gh's. Remote hosts' PRs are covered when Paseo reports them.
 * - One read-only `gh api graphql` query per open PR, cached for `PROBE.ttlMs`.
 * - No verdict when Probe was never asked, the PR isn't open, or gh can't answer.
 */
import { homedir } from "node:os";
import type { ProbeVerdict } from "../../rendering/src/probe";
import { BASE_BRANCHES, gh, ghPullRequest, prCoordinates, type PullRequest } from "./links";

export const PROBE = { login: "diagonalprobe", ttlMs: 30000 };

export const PROBE_QUERY = `query ProbeReview($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state
      headRefOid
      reviewRequests(first: 30) { nodes { requestedReviewer { ... on User { login } ... on Bot { login } } } }
      reviews(last: 20, author: "${PROBE.login}") { nodes { state body submittedAt } }
      commits(last: 1) { nodes { commit { checkSuites(first: 50) { nodes { checkRuns(first: 50) { nodes { name status conclusion } } } } } } }
    }
  }
}`;

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
/** "One finding remains open", "2 findings remain open": the count, if said. */
export function openFindings(body: string): number | undefined {
  const m = /\b(\d+|[a-z]+) findings? remains? open/i.exec(body);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : WORDS.indexOf(m[1]!.toLowerCase());
  return n >= 0 ? n : undefined;
}

type Node = Record<string, unknown>;
const nodes = (v: unknown): Node[] =>
  Array.isArray((v as { nodes?: unknown })?.nodes) ? ((v as { nodes: Node[] }).nodes.filter(Boolean)) : [];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const FAILED = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE"]);

/** Probe's verdict from the GraphQL answer, or null when it has none. */
export function probeVerdict(raw: unknown): ProbeVerdict | null {
  const pr = (raw as { data?: { repository?: { pullRequest?: Node } } })?.data?.repository?.pullRequest;
  if (!pr || str(pr.state) !== "OPEN") return null;
  const head = str(pr.headRefOid).toLowerCase();
  const requested = nodes(pr.reviewRequests).some(
    (r) => str((r.requestedReviewer as Node | null)?.login).toLowerCase() === PROBE.login,
  );
  const commit = nodes(pr.commits)[0]?.commit as Node | undefined;
  const runs = nodes(commit?.checkSuites)
    .flatMap((s) => nodes(s.checkRuns))
    .filter((r) => /^probe(\s*\/|$)/i.test(str(r.name)));
  if (requested || runs.some((r) => str(r.status) !== "COMPLETED")) return { state: "reviewing" };
  const failed = runs.some((r) => FAILED.has(str(r.conclusion)));
  const review = nodes(pr.reviews)
    .filter((r) => str(r.submittedAt))
    .sort((a, b) => str(a.submittedAt).localeCompare(str(b.submittedAt)))
    .at(-1);
  if (!review) return failed ? { state: "failed" } : null;
  const body = str(review.body);
  const reviewed = /probe-review:v1\b[^>]*\bhead=([0-9a-f]{7,40})/i.exec(body)?.[1]?.toLowerCase();
  const of = reviewed ? { head: reviewed } : {};
  const current = !reviewed || !head || head.startsWith(reviewed) || reviewed.startsWith(head);
  if (failed && !current) return { state: "failed" };
  if (/deferred the review/i.test(body)) return { state: "stale", reason: "deferred" };
  if (!current) return { state: "stale", reason: "head-changed", ...of };
  const findings = openFindings(body);
  if (str(review.state) === "APPROVED" || /\*\*Review: Approved\*\*/i.test(body) || findings === 0)
    return { state: "approved", ...of };
  return { state: "findings", ...(findings ? { findings } : {}), ...of };
}

const cache = new Map<string, { at: number; value: Promise<ProbeVerdict | null | undefined> }>();

/** Probe's verdict on a github.com PR; undefined when gh can't answer. Never throws. */
export function ghProbe(prUrl: string, now = Date.now()): Promise<ProbeVerdict | null | undefined> {
  const at = prCoordinates(prUrl);
  if (!at) return Promise.resolve(undefined);
  const key = `${at.owner}/${at.name}#${at.number}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < PROBE.ttlMs) return hit.value;
  const value = gh(homedir(), [
    "api", "graphql",
    "-f", `query=${PROBE_QUERY}`,
    "-f", `owner=${at.owner}`,
    "-f", `name=${at.name}`,
    "-F", `number=${at.number}`,
  ]).then(
    (out) => {
      try {
        return probeVerdict(JSON.parse(out));
      } catch {
        return undefined;
      }
    },
    () => undefined,
  );
  cache.set(key, { at: now, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

export type ProbeRow = {
  workspaceId?: string;
  host?: string;
  cwd?: string;
  branch?: string;
  pr?: PullRequest | null;
  stale?: boolean;
};
export type ProbeDeps = {
  rows(): Promise<ProbeRow[]>;
  pr(cwd: string, branch: string): Promise<PullRequest | null | undefined>;
  probe(prUrl: string): Promise<ProbeVerdict | null | undefined>;
};

/** Each workspace's verdict, keyed `<host or "local">:<workspaceId>`; workspaces without one are left out. */
export async function probeVerdicts(deps: ProbeDeps): Promise<Record<string, ProbeVerdict>> {
  const out: Record<string, ProbeVerdict> = {};
  await Promise.all(
    (await deps.rows()).map(async (row) => {
      const branch = (row.branch ?? "").trim();
      if (!row.workspaceId || row.stale || BASE_BRANCHES.test(branch)) return;
      const pr =
        row.pr !== undefined ? row.pr : !row.host && row.cwd ? await deps.pr(row.cwd, branch) : undefined;
      if (!pr || (pr.state !== "open" && pr.state !== "draft")) return;
      const verdict = await deps.probe(pr.url);
      if (verdict) out[`${row.host || "local"}:${row.workspaceId}`] = verdict;
    }),
  );
  return out;
}

/** `GET /api/probe`: every workspace's Probe verdict, from the app's own daemons' rows. */
export function probeRoute() {
  return probeVerdicts({
    rows: async () => {
      const { aggregate } = await import("./api/reads");
      return (await aggregate("workspaces")).rows as ProbeRow[];
    },
    pr: async (cwd, branch) => {
      const answer = await ghPullRequest(cwd, branch);
      return answer.available ? answer.pr : undefined;
    },
    probe: (url) => ghProbe(url),
  });
}
