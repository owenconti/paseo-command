import test from "node:test";
import assert from "node:assert/strict";
import { checkPlace, placeLink, DEFAULT_PLACE } from "./place";
const sha = "a".repeat(40);
test("main history and selected commit survive saved navigation with valid repository and SHA", () => {
  assert.deepEqual(checkPlace({ kind: "commits", repo: "owen/app", sha }), {
    kind: "commits",
    repo: "owen/app",
    sha,
  });
  assert.deepEqual(
    checkPlace({ kind: "commits", repo: "owen/app", sha: "invalid" }),
    { kind: "commits", repo: "owen/app" },
  );
  assert.deepEqual(
    checkPlace({ kind: "commits", repo: "../app", sha }),
    DEFAULT_PLACE,
  );
  assert.equal(
    placeLink({ kind: "commits", repo: "owen/app" }),
    "https://github.com/owen/app/commits/main",
  );
  assert.equal(
    placeLink({ kind: "commits", repo: "owen/app", sha }),
    `https://github.com/owen/app/commit/${sha}`,
  );
});
