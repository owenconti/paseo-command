import test from "node:test";
import assert from "node:assert/strict";
import { WORLD_WATCH, applied, behind, newWatch, post } from "../src/native/watch.ts";

test("each post takes the next revision, and the wait starts at the first unanswered one", () => {
  const w = newWatch();
  assert.equal(behind(w, 0), false, "nothing posted, nothing to wait for");
  assert.equal(post(w, "scene", 1000), 1);
  assert.equal(post(w, "agents", 1000), 2);
  assert.equal(post(w, "agents", 4000), 3);
  assert.deepEqual(w, { scene: 1, agents: 3, waitingSince: 1000 });
});

test("Swift caught up ends the wait; behind only after the lag", () => {
  const w = newWatch();
  post(w, "scene", 0);
  post(w, "agents", 0);
  applied(w, { sceneRevision: 1, agentsRevision: 1 });
  assert.notEqual(w.waitingSince, null, "the agents post isn't applied yet");
  assert.equal(behind(w, WORLD_WATCH.lagMs - 1), false);
  assert.equal(behind(w, WORLD_WATCH.lagMs + 1), true);
  applied(w, { sceneRevision: 1, agentsRevision: 2 });
  assert.equal(w.waitingSince, null);
  assert.equal(behind(w, WORLD_WATCH.lagMs * 5), false);
});

test("posts that keep coming don't hide a Swift that applies none of them", () => {
  const w = newWatch();
  for (let t = 0; t <= 20000; t += 1000) post(w, "agents", t);
  assert.equal(behind(w, 20000), true);
});

test("a Swift that reports nothing (an older build, or none yet) counts as behind", () => {
  const w = newWatch();
  post(w, "agents", 0);
  applied(w, {});
  assert.equal(behind(w, WORLD_WATCH.lagMs + 1), true);
});
