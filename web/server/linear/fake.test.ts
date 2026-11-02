import assert from "node:assert/strict";
import { test } from "node:test";
import { LINEAR } from "../links";
import { existsSync } from "node:fs";
import { secretsFile } from "../secrets";
import { settingsFile } from "../settings";
import { LinearError, linearApiKey, linearRequest } from "./client";
import { FAKE_IDS, FAKE_KEY, fakeWorkspace, installFakeLinear } from "./fake";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function raw(operationName: string) {
  const res = await LINEAR.fetch(LINEAR.endpoint, {
    method: "POST",
    body: JSON.stringify({ operationName, query: "", variables: {} }),
  });
  return { res, body: (await res.json()) as any };
}

test("refuses an unknown operation and restores the real fetch", async () => {
  const real = LINEAR.fetch;
  const fake = installFakeLinear();
  assert.equal(linearApiKey(), FAKE_KEY);
  const { body } = await raw("Nope");
  assert.match(body.errors[0].message, /Unknown operation Nope/);
  assert.deepEqual(fake.requests, [{ operation: "Nope", variables: {} }]);
  fake.restore();
  assert.equal(LINEAR.fetch, real);
  assert.equal(linearApiKey(), undefined);
  assert.equal(existsSync(secretsFile()), false);
  assert.equal(existsSync(settingsFile()), false);
});

test("answers rate-limit headers with a reset in the future", async () => {
  const fake = installFakeLinear();
  try {
    const { res } = await raw("Nope");
    assert.equal(res.headers.get("x-ratelimit-requests-remaining"), "2500");
    assert.equal(res.headers.get("x-ratelimit-complexity-remaining"), "3000000");
    const reset = Number(res.headers.get("x-ratelimit-requests-reset"));
    assert.ok(reset > Date.now() + 59 * 60_000);
  } finally {
    fake.restore();
  }
});

test("fail makes an operation answer an error", async () => {
  const fake = installFakeLinear();
  try {
    fake.fail("Workspace", { status: 429, message: "slow down", type: "ratelimited" });
    await assert.rejects(
      linearRequest("Workspace", "query Workspace { viewer { id } }", {}),
      (e: unknown) => e instanceof LinearError && e.kind === "limited",
    );
  } finally {
    fake.restore();
  }
});

test("the sample workspace has the documented shape", () => {
  const ws = fakeWorkspace();
  for (const id of [FAKE_IDS.owen, FAKE_IDS.sam, FAKE_IDS.eng, FAKE_IDS.de, FAKE_IDS.issues["ENG-1"]]) {
    assert.match(id, UUID);
  }
  assert.equal(ws.viewerId, FAKE_IDS.owen);
  assert.deepEqual(ws.teams.map((t) => t.key), ["ENG", "DE"]);
  assert.deepEqual(
    ws.notifications.map((n) => [n.kind, n.issue?.identifier ?? n.project?.id]),
    [
      ["issue", "ENG-1"],
      ["issue", "ENG-1"],
      ["issue", "ENG-3"],
      ["project", FAKE_IDS.projects.launch],
      ["issue", "DE-2"],
    ],
  );
});
