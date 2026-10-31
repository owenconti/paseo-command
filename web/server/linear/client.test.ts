import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { rmSync } from "node:fs";
import { LINEAR } from "../links";
import { saveSecret, secretsFile } from "../secrets";
import { settingsFile, writeSettings } from "../settings";
import { DISABLED, LinearError, NO_KEY, linearBudget, linearRequest, resetLinearClient } from "./client";

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

const RESETAT = Date.now() + 60 * 60_000;
const RESET = String(RESETAT);
const budgetHeaders = (requests: string) => ({
  "x-ratelimit-requests-remaining": requests,
  "x-ratelimit-complexity-remaining": "2900000",
  "x-ratelimit-requests-reset": RESET,
});

beforeEach(() => {
  seen = [];
  resetLinearClient();
  writeSettings({ integrations: { linear: true } });
  saveSecret({ name: "linearApiKey", value: "lin_api_test" });
});
afterEach(() => {
  LINEAR.fetch = realFetch;
  rmSync(secretsFile(), { force: true });
  rmSync(settingsFile(), { force: true });
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
    resetAt: RESETAT,
  });
});

test("refuses to sync when the budget is low", async () => {
  reply(200, { data: {} }, budgetHeaders("50"));
  await linearRequest("A", "query A { viewer { id } }", {});
  await assert.rejects(
    () => linearRequest("B", "query B { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "limited" && e.retryAt === RESETAT,
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
  saveSecret({ name: "linearApiKey", value: null });
  reply(200, { data: {} });
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "no-key" && e.message === NO_KEY,
  );
  assert.equal(seen.length, 0);
});

test("Linear off: kind no-key saying to enable it, nothing sent, even with a key", async () => {
  writeSettings({ integrations: { linear: false } });
  reply(200, { data: {} });
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "no-key" && e.message === DISABLED,
  );
  assert.equal(seen.length, 0);
});

test("the environment's LINEAR_API_KEY is never read", async () => {
  saveSecret({ name: "linearApiKey", value: null });
  process.env.LINEAR_API_KEY = "lin_api_env";
  try {
    reply(200, { data: {} });
    await assert.rejects(
      () => linearRequest("A", "query A { viewer { id } }", {}),
      (e: unknown) => e instanceof LinearError && e.kind === "no-key",
    );
    assert.equal(seen.length, 0);
  } finally {
    delete process.env.LINEAR_API_KEY;
  }
});

test("a RATELIMITED error is limited, with the reset time", async () => {
  reply(
    400,
    { errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED", userPresentableMessage: "Slow down" } }] },
    budgetHeaders("0"),
  );
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "limited" && e.retryAt === RESETAT,
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
    (e: unknown) => e instanceof LinearError && e.kind === "limited" && e.retryAt === RESETAT,
  );
});

test("a GraphQL AUTHENTICATION_ERROR is refused", async () => {
  reply(200, { errors: [{ message: "x", extensions: { code: "AUTHENTICATION_ERROR" } }] });
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) => e instanceof LinearError && e.kind === "refused",
  );
});

test("a limit with no reset header retries a minute on", async () => {
  reply(429, {});
  const before = Date.now();
  await assert.rejects(
    () => linearRequest("A", "query A { viewer { id } }", {}),
    (e: unknown) =>
      e instanceof LinearError && e.kind === "limited" && e.retryAt! >= before + 60_000 && e.retryAt! <= Date.now() + 60_000,
  );
});

test("an empty or non-positive reset header counts as missing", async () => {
  for (const reset of ["", "0", "-5"]) {
    resetLinearClient();
    seen = [];
    // A low budget with no usable reset: not recorded, so it doesn't gate the next request.
    reply(200, { data: {} }, { ...budgetHeaders("50"), "x-ratelimit-requests-reset": reset });
    await linearRequest("A", "query A { viewer { id } }", {});
    assert.equal(linearBudget(), null, `reset ${JSON.stringify(reset)}`);
    // A limit with it pauses a minute on, not until 1970.
    reply(429, {}, { ...budgetHeaders("0"), "x-ratelimit-requests-reset": reset });
    const before = Date.now();
    await assert.rejects(
      () => linearRequest("B", "query B { viewer { id } }", {}),
      (e: unknown) => e instanceof LinearError && e.kind === "limited" && e.retryAt! >= before + 60_000,
    );
  }
});
