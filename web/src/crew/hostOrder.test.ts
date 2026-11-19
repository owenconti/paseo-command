import assert from "node:assert/strict";
import { test } from "node:test";
import { hostRank, moveHost, orderHosts } from "./hostOrder";

const h = (...keys: string[]) => keys.map((key) => ({ key }));
const keys = (hs: { key: string }[]) => hs.map((x) => x.key);

test("hosts follow the saved order; those it doesn't name keep their place after, as they came", () => {
  assert.deepEqual(keys(orderHosts(h("local", "lab", "pool-1", "pool-2"), [])), ["local", "lab", "pool-1", "pool-2"]);
  assert.deepEqual(keys(orderHosts(h("local", "lab", "pool-1", "pool-2"), ["pool-1", "local"])), ["pool-1", "local", "lab", "pool-2"]);
  assert.deepEqual(keys(orderHosts(h("local", "lab"), ["gone", "lab"])), ["lab", "local"], "a host no longer listed is passed over");
});

test("moving a host among those shown keeps hidden hosts' names after", () => {
  assert.deepEqual(moveHost([], ["local", "lab", "pool-1"], "pool-1", 0), ["pool-1", "local", "lab"]);
  assert.deepEqual(moveHost([], ["local", "lab", "pool-1"], "local", 9), ["lab", "pool-1", "local"], "past the end is the end");
  assert.deepEqual(moveHost(["lab", "asleep", "local"], ["lab", "local"], "local", 0), ["local", "lab", "asleep"]);
  assert.deepEqual(moveHost(["lab"], ["lab"], "missing", 0), ["lab"], "a host not shown doesn't move");
});

test("ranks for J/K: by the order, unknown hosts after", () => {
  const rank = hostRank(["lab", "local"]);
  assert.deepEqual(["local", "lab", "other"].map(rank), [1, 0, 2]);
});
