import assert from "node:assert/strict";
import { test } from "node:test";
import { LINEAR } from "../links";
import { LinearError, linearRequest } from "./client";
import { FAKE_IDS, fakeWorkspace, installFakeLinear } from "./fake";

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
  assert.equal(process.env.LINEAR_API_KEY, "lin_api_fake");
  const { body } = await raw("Nope");
  assert.match(body.errors[0].message, /Unknown operation Nope/);
  assert.deepEqual(fake.requests, [{ operation: "Nope", variables: {} }]);
  fake.restore();
  assert.equal(LINEAR.fetch, real);
  assert.equal(process.env.LINEAR_API_KEY, undefined);
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
  assert.deepEqual(ws.issues.map((i) => i.identifier), ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5", "ENG-6", "DE-1", "DE-2"]);
  const by = (k: string) => ws.issues.find((i) => i.identifier === k)!;
  assert.equal(by("ENG-2").parent?.id, FAKE_IDS.issues["ENG-1"]);
  assert.equal(by("ENG-1").children.nodes[0].id, FAKE_IDS.issues["ENG-2"]);
  assert.equal(by("ENG-3").relations.nodes[0].type, "blocks");
  assert.equal(by("ENG-3").relations.nodes[0].relatedIssue.id, FAKE_IDS.issues["ENG-4"]);
  assert.equal(by("ENG-4").inverseRelations.nodes[0].issue.id, FAKE_IDS.issues["ENG-3"]);
  const comments = ws.comments.filter((c) => c.issue.id === FAKE_IDS.issues["ENG-1"]);
  assert.equal(comments.length, 3);
  assert.ok(comments.some((c) => c.parent));
  assert.ok(comments.some((c) => c.reactions.length));
  const day = 86_400_000;
  const age = (k: string) => (Date.now() - Date.parse(by(k).completedAt!)) / day;
  assert.ok(age("ENG-5") > 0.5 && age("ENG-5") < 1.5);
  assert.ok(age("ENG-6") > 19.5 && age("ENG-6") < 20.5);
  assert.equal(by("ENG-5").project?.id, FAKE_IDS.projects.launch);
  assert.equal(by("ENG-6").project?.id, FAKE_IDS.projects.launch);
  assert.equal(ws.initiatives[0].projects.nodes[0].id, FAKE_IDS.projects.launch);
  assert.equal(ws.states.filter((s) => s.team.id === FAKE_IDS.eng).length, 7);
});
