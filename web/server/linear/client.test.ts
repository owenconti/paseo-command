import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { LINEAR } from "../links";
import { LinearError, linearBudget, linearRequest, resetLinearClient } from "./client";

const realFetch = LINEAR.fetch;
let seen: { body: any; auth: string | null }[] = [];

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  LINEAR.fetch = (async (_url: unknown, init?: RequestInit) => {
    seen.push({
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
}

const RESET = "1793461871221";
const budgetHeaders = (requests: string) => ({
  "x-ratelimit-requests-remaining": requests,
  "x-ratelimit-complexity-remaining": "2900000",
  "x-ratelimit-requests-reset": RESET,
});

beforeEach(() => {
  seen = [];
  resetLinearClient();
  process.env.LINEAR_API_KEY = "lin_api_test";
});
afterEach(() => {
  LINEAR.fetch = realFetch;
  delete process.env.LINEAR_API_KEY;
});

test("sends the operation name, query and key", async () => {
  reply(200, { data: { viewer: { id: "x" } } });
  const data = await linearRequest<{ viewer: { id: string } }>("Workspace", "query Workspace { viewer { id } }", {});
  assert.equal(data.viewer.id, "x");
  assert.equal(seen[0].body.operationName, "Workspace");
  assert.equal(seen[0].body.query, "query Workspace { viewer { id } }");
  assert.equal(seen[0].auth, "lin_api_test");
});

test("records the budget from the headers", async () => {
  reply(200, { data: {} }, budgetHeaders("2400"));
  await linearRequest("Workspace", "query Workspace { viewer { id } }", {});
  assert.deepEqual(linearBudget(), {
    requestsRemaining: 2400,
    complexityRemaining: 2900000,
    resetAt: 1793461871221,
  });
});

test("refuses to sync when the budget is low", async () => {
  reply(200, { data: {} }, budgetHeaders("50"));
  await linearRequest("A", "query A { viewer { id } }", {});
  await assert.rejects(
    () => linearRequest("B", "query B { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "limited" && e.retryAt === 1793461871221,
  );
  assert.equal(seen.length, 1);
  await linearRequest("C", "query C { viewer { id } }", {}, { essential: true });
  assert.equal(seen.length, 2);
});

test("names a refused key and Linear's own validation message", async () => {
  reply(401, {});
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "refused" && e.message === "Linear refused the API key.",
  );
  reply(200, {
    errors: [
      {
        message: "Argument Validation Error",
        extensions: { type: "InvalidInput", userPresentableMessage: "Title is too long" },
      },
    ],
  });
  await assert.rejects(
    () => linearRequest("A", "mutation A { x }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "invalid" && e.message === "Title is too long",
  );
});

test("no key: kind no-key, nothing sent", async () => {
  delete process.env.LINEAR_API_KEY;
  reply(200, { data: {} });
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "no-key",
  );
  assert.equal(seen.length, 0);
});

test("a RATELIMITED error is limited, with the reset time", async () => {
  reply(
    400,
    { errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED", userPresentableMessage: "Slow down" } }] },
    budgetHeaders("0"),
  );
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "limited" && e.retryAt === 1793461871221,
  );
});

test("a low complexity budget blocks a non-essential request", async () => {
  reply(200, { data: {} }, { ...budgetHeaders("2400"), "x-ratelimit-complexity-remaining": "99999" });
  await linearRequest("A", "query A { viewer { id } }", {});
  await assert.rejects(
    () => linearRequest("B", "query B { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "limited",
  );
  assert.equal(seen.length, 1);
});

test("HTTP 429 is limited", async () => {
  reply(429, {}, budgetHeaders("0"));
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "limited" && e.retryAt === 1793461871221,
  );
});

test("a GraphQL AUTHENTICATION_ERROR is refused", async () => {
  reply(200, { errors: [{ message: "x", extensions: { code: "AUTHENTICATION_ERROR" } }] });
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "refused",
  );
});
