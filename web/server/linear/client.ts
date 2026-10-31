/**
 * Linear's GraphQL API, one request at a time, with the key and the hourly
 * budget kept here. Linear is opt-in: the key is `linearApiKey` in the data
 * directory's secrets.json, read only once Linear is enabled in settings.json
 * (`integrationKey("linear")`); the environment is never read. Every reply's `x-ratelimit-*` headers update the
 * budget; below `LOW_BUDGET` only `essential` requests (the user's own writes)
 * go out until the budget resets.
 */
import type { LinearBudget } from "../../src/linear/types";
import { integrationEnabled, integrationKey } from "../integrations";
import { LINEAR } from "../links";

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

export const NO_KEY = "Add linearApiKey to secrets.json to use Linear.";
export const DISABLED = "Enable Linear in Settings to see your issues.";

/** The key, only while Linear is enabled; else undefined. */
export const linearApiKey = () => integrationKey("linear");

/** Why there is no key: Linear is off, or on without `linearApiKey`. */
export const linearUnavailable = () => (integrationEnabled("linear") ? NO_KEY : DISABLED);

let budget: LinearBudget | null = null;

/** What the last reply said was left, or null before any reply. */
export function linearBudget(): LinearBudget | null {
  return budget ? { ...budget } : null;
}

/** Forgets the budget (tests). */
export function resetLinearClient(): void {
  budget = null;
}

/** A header's number; undefined when it's missing, empty or not a number (`Number("")` is 0). */
function headerNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** When the budget resets (epoch ms); a reset at or before 0 is no reset at all. */
function resetHeader(headers: Headers): number | undefined {
  const reset = headerNumber(headers, "x-ratelimit-requests-reset");
  return reset !== undefined && reset > 0 ? reset : undefined;
}

function readBudget(headers: Headers) {
  const requests = headerNumber(headers, "x-ratelimit-requests-remaining");
  const complexity = headerNumber(headers, "x-ratelimit-complexity-remaining");
  const reset = resetHeader(headers);
  if (requests === undefined || complexity === undefined || reset === undefined) return;
  budget = { requestsRemaining: requests, complexityRemaining: complexity, resetAt: reset };
}

type GraphQlError = {
  message?: string;
  extensions?: { type?: string; code?: string; userPresentableMessage?: string };
};

/** When to try again after a limit: this reply's reset, else the known one if still ahead, else a minute on. */
function retryTime(headers: Headers): number {
  const reset = resetHeader(headers);
  if (reset !== undefined) return reset;
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
  if (!key) throw new LinearError("no-key", linearUnavailable());
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
