/**
 * `GET /api/glance` (`?fresh=1` past the caches): Crew's glance (`src/glance.ts`). Each part only while its
 * integration is on: your Linear issues in progress, in review and to do (`readMyIssues`); the pull requests asking
 * your review and assigned to you (the GitHub tab's own `readPrs`, so its cache and search budget); and Diagonal's
 * health, `GET app.go-diagonal.com/health/status` (no credentials, 10 s, kept `HEALTH.ttlMs`). A part that can't
 * answer says why; the others still come.
 */
import type { IncomingMessage } from "node:http";
import { GLANCE, HEALTH_URL, healthServices, type Glance, type GlancePrList, type Health } from "../src/glance";
import type { PrList } from "../src/github/types";
import { integrationEnabled } from "./integrations";
import { readMyIssues } from "./linear/reads";
import { readPrs } from "./github/reads";
import { apiFailure, assertEnabled } from "./github/client";
import { errorText } from "./wire";

export const HEALTH = {
  url: HEALTH_URL,
  timeoutMs: 10_000,
  /** The page asks every minute; a check is kept a little less, so each ask checks again. */
  ttlMs: 50_000,
  /** At most this much of its answer is read. */
  maxBytes: 64 * 1024,
  fetch: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch,
};

let healthCache: Health | undefined;
let healthAsk: Promise<Health> | undefined;

/** Forgets the last check (tests). */
export function resetGlance(): void {
  healthCache = undefined;
  healthAsk = undefined;
}

async function checkHealth(): Promise<Health> {
  const started = Date.now();
  const failed = (error: string): Health => ({ checkedAt: Date.now(), up: false, took: Date.now() - started, services: [], error });
  let res: Response;
  try {
    res = await HEALTH.fetch(HEALTH.url, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(HEALTH.timeoutMs) });
  } catch (e) {
    return failed(e instanceof Error && e.name === "TimeoutError" ? `No answer in ${HEALTH.timeoutMs / 1000} s.` : "It couldn't be reached.");
  }
  const text = await res.text().catch(() => "");
  const took = Date.now() - started;
  if (!res.ok) return { ...failed(`It answered ${res.status}.`), took };
  let body: unknown;
  try {
    body = text.length <= HEALTH.maxBytes ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const services = healthServices(body);
  if (!services) return { ...failed("Its answer wasn't the expected JSON."), took };
  return { checkedAt: Date.now(), up: true, took, services };
}

/** Diagonal's health, checked at most every `HEALTH.ttlMs` (`fresh` checks now); one check at a time. */
export function readHealth(fresh = false): Promise<Health> {
  if (!fresh && healthCache && Date.now() - healthCache.checkedAt < HEALTH.ttlMs) return Promise.resolve(healthCache);
  healthAsk ??= checkHealth().then((h) => {
    healthCache = h;
    healthAsk = undefined;
    return h;
  });
  return healthAsk;
}

const prList = (l: PrList): GlancePrList => ({
  total: l.total ?? l.rows.length,
  rows: l.rows.slice(0, GLANCE.listMax).map((r) => ({
    id: r.id,
    repo: r.repo,
    number: r.number,
    title: r.title,
    url: r.url,
    state: r.state,
    checks: r.checks,
    updatedAt: r.updatedAt,
    author: r.author?.login ?? "",
  })),
});

export async function readGlance(fresh = false): Promise<Glance> {
  const [linear, github, health] = await Promise.all([
    integrationEnabled("linear")
      ? readMyIssues(fresh).then(
          (groups) => ({ groups }),
          (e) => ({ error: errorText(e) || "Linear didn't answer." }),
        )
      : undefined,
    integrationEnabled("github")
      ? (async () => {
          try {
            assertEnabled();
            const [review, assigned] = await Promise.all([readPrs("review", fresh), readPrs("assigned", fresh)]);
            return { review: prList(review), assigned: prList(assigned) };
          } catch (e) {
            return { error: apiFailure(e).message };
          }
        })()
      : undefined,
    integrationEnabled("health") ? readHealth(fresh) : undefined,
  ]);
  return { ...(linear ? { linear } : {}), ...(github ? { github } : {}), ...(health ? { health } : {}) };
}

export async function glanceRoute(req: IncomingMessage, url: URL, reply: (status: number, body: unknown) => void): Promise<void> {
  if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
  const keys = [...url.searchParams.keys()];
  const fresh = url.searchParams.get("fresh");
  if (keys.some((k) => k !== "fresh") || keys.length > 1 || (fresh !== null && fresh !== "1")) return reply(400, { error: "Unexpected parameters" });
  return reply(200, await readGlance(fresh === "1"));
}
