/**
 * Linear's GraphQL API, one request at a time, with the key and the hourly
 * budget kept here. The key is LINEAR_API_KEY, else `linearApiKey` in the data
 * directory's secrets.json. Every reply's `x-ratelimit-*` headers update the
 * budget; below `LOW_BUDGET` only `essential` requests (the user's own writes)
 * go out until the budget resets.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LinearBudget } from "../../src/linear/types";
import { LINEAR } from "../links";
import { dataDir } from "../subagentArchive";

export const LOW_BUDGET = { requests: 100, complexity: 100_000 };

export type LinearErrorKind = "no-key" | "refused" | "limited" | "failed" | "invalid";

export class LinearError extends Error {
  kind: LinearErrorKind;
  retryAt?: number;
  constructor(kind: LinearErrorKind, message: string, retryAt?: number) {
    super(message);
    this.name = "LinearError";
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

export function linearApiKey(): string | undefined {
  const env = process.env.LINEAR_API_KEY?.trim();
  if (env) return env;
  try {
    const secrets = JSON.parse(readFileSync(join(dataDir(), "secrets.json"), "utf8"));
    const key = secrets?.linearApiKey;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

let budget: LinearBudget | null = null;

/** What the last reply said was left, or null before any reply. */
export function linearBudget(): LinearBudget | null {
  return budget ? { ...budget } : null;
}

/** Forgets the budget (tests). */
export function resetLinearClient(): void {
  budget = null;
}

function readBudget(headers: Headers) {
  const requests = Number(headers.get("x-ratelimit-requests-remaining"));
  const complexity = Number(headers.get("x-ratelimit-complexity-remaining"));
  const reset = Number(headers.get("x-ratelimit-requests-reset"));
  if (
    headers.get("x-ratelimit-requests-remaining") === null ||
    headers.get("x-ratelimit-complexity-remaining") === null ||
    ![requests, complexity, reset].every(Number.isFinite)
  ) {
    return;
  }
  budget = { requestsRemaining: requests, complexityRemaining: complexity, resetAt: reset };
}

type GraphQlError = {
  message?: string;
  extensions?: { type?: string; code?: string; userPresentableMessage?: string };
};

/** When to try again after a limit: this reply's reset, else the known one if still ahead, else a minute on. */
function retryTime(headers: Headers): number {
  const reset = Number(headers.get("x-ratelimit-requests-reset"));
  if (headers.get("x-ratelimit-requests-reset") !== null && Number.isFinite(reset)) return reset;
  if (budget && budget.resetAt > Date.now()) return budget.resetAt;
  return Date.now() + 60_000;
}

function errorFrom(errors: GraphQlError[], retryAt: number): LinearError {
  const first = errors[0] ?? {};
  const labels = [first.extensions?.code, first.extensions?.type].map((v) => (v ?? "").toLowerCase());
  if (labels.includes("ratelimited")) {
    return new LinearError("limited", "Linear's hourly limit is used up.", retryAt);
  }
  if (labels.includes("authentication_error") || labels.includes("authentication error")) {
    return new LinearError("refused", "Linear refused the API key.");
  }
  const type = first.extensions?.type;
  const message = first.extensions?.userPresentableMessage || first.message || "Linear failed.";
  if (type === "InvalidInput" || first.extensions?.userPresentableMessage) {
    return new LinearError("invalid", message);
  }
  return new LinearError("failed", message);
}

/** Sends one named GraphQL operation and returns its data; failures are LinearErrors. */
export async function linearRequest<T>(
  operation: string,
  query: string,
  variables: Record<string, unknown>,
  opts: { essential?: boolean } = {},
): Promise<T> {
  const key = linearApiKey();
  if (!key) throw new LinearError("no-key", "Set LINEAR_API_KEY, or linearApiKey in secrets.json, to use Linear.");
  if (
    !opts.essential &&
    budget &&
    Date.now() < budget.resetAt &&
    (budget.requestsRemaining < LOW_BUDGET.requests || budget.complexityRemaining < LOW_BUDGET.complexity)
  ) {
    throw new LinearError("limited", "Linear's hourly limit is nearly used up.", budget.resetAt);
  }
  let res: Response;
  try {
    res = await LINEAR.fetch(LINEAR.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ operationName: operation, query, variables }),
      signal: AbortSignal.timeout(LINEAR.timeoutMs),
    });
  } catch {
    throw new LinearError("failed", "Linear could not be reached.");
  }
  readBudget(res.headers);
  const body = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: GraphQlError[];
  } | null;
  if (res.status === 401) throw new LinearError("refused", "Linear refused the API key.");
  if (res.status === 429) {
    throw new LinearError("limited", "Linear's hourly limit is used up.", retryTime(res.headers));
  }
  if (body?.errors?.length) throw errorFrom(body.errors, retryTime(res.headers));
  if (!res.ok || !body?.data) throw new LinearError("failed", `Linear answered ${res.status}.`);
  return body.data;
}
