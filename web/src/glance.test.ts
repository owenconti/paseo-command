import assert from "node:assert/strict";
import { test } from "node:test";
import { groupIssues, healthServices, healthTone, msText, overallTone } from "./glance";

const issue = (key: string, state: { name: string; type: string; position?: number; color?: string }, updatedAt = "2026-11-01T00:00:00Z") => ({
  id: key,
  identifier: key,
  title: `Title ${key}`,
  url: `https://linear.app/acme/issue/${key}`,
  updatedAt,
  team: { key: key.split("-")[0] },
  state,
});

test("issues group by state: started ones by position, then unstarted; others and odd links left out", () => {
  const review = { name: "In Review", type: "started", position: 3, color: "#0f783c" };
  const progress = { name: "In Progress", type: "started", position: 2, color: "#f2c94c" };
  const todo = { name: "Todo", type: "unstarted", position: 1 };
  const groups = groupIssues([
    issue("DE-1", todo),
    issue("DE-2", review),
    issue("DE-3", progress, "2026-11-01T00:00:00Z"),
    issue("ENG-4", { ...progress, position: 1 }, "2026-11-03T00:00:00Z"),
    issue("DE-5", { name: "Backlog", type: "backlog" }),
    issue("DE-6", { name: "Done", type: "completed" }),
    { ...issue("DE-7", todo), url: "javascript:alert(1)" },
  ]);
  assert.deepEqual(groups.map((g) => [g.state, g.total]), [["In Progress", 2], ["In Review", 1], ["Todo", 1]]);
  assert.deepEqual(groups[0]!.issues.map((i) => i.key), ["ENG-4", "DE-3"], "newest first");
  assert.equal(groups[0]!.color, "#f2c94c");
  assert.equal(groups[0]!.issues[0]!.team, "ENG");
});

test("a group lists at most `max` issues but counts them all", () => {
  const todo = { name: "Todo", type: "unstarted" };
  const groups = groupIssues(Array.from({ length: 5 }, (_, i) => issue(`DE-${i + 1}`, todo)), 3);
  assert.equal(groups[0]!.total, 5);
  assert.equal(groups[0]!.issues.length, 3);
});

test("health: every number but iterations is a service; lights by response time", () => {
  assert.deepEqual(healthServices({ iterations: 100, pgsql: 0.47, "redis-default": 0.11, mongodb: 2.5, note: "x", bad: -1 }), [
    { name: "pgsql", ms: 0.47 },
    { name: "redis-default", ms: 0.11 },
    { name: "mongodb", ms: 2.5 },
  ]);
  assert.equal(healthServices([1, 2]), null);
  assert.equal(healthServices("ok"), null);
  assert.deepEqual([0.2, 0.999, 1, 2.99, 3, 40].map(healthTone), ["good", "good", "slow", "slow", "bad", "bad"]);
  const at = Date.now();
  assert.equal(overallTone({ checkedAt: at, up: true, services: [{ name: "a", ms: 0.1 }] }), "good");
  assert.equal(overallTone({ checkedAt: at, up: true, services: [{ name: "a", ms: 0.1 }, { name: "b", ms: 1.5 }] }), "slow");
  assert.equal(overallTone({ checkedAt: at, up: true, services: [{ name: "a", ms: 5 }, { name: "b", ms: 1.5 }] }), "bad");
  assert.equal(overallTone({ checkedAt: at, up: false, services: [] }), "bad");
  assert.equal(msText(0.4753), "0.48 ms");
  assert.equal(msText(123.4), "123 ms");
});

test("the bar's counts: Linear's states, GitHub's two lists, Diagonal's lights and slowest time; parts off or failing", async () => {
  const { glanceItems } = await import("./glance");
  const on = { linear: true, github: true, health: true };
  const g = {
    linear: { groups: [{ state: "In Progress", type: "started" as const, color: "#f2c94c", total: 9, issues: [] }, { state: "Todo", type: "unstarted" as const, color: "", total: 0, issues: [] }] },
    github: { review: { total: 2, rows: [] }, assigned: { total: 0, rows: [] } },
    health: { checkedAt: 0, up: true, services: [{ name: "pgsql", ms: 0.4 }, { name: "mongodb", ms: 3.2 }] },
  };
  const items = glanceItems(g, on);
  assert.deepEqual(items.map((i) => [i.id, i.group, i.text, i.tone]), [
    ["linear:in progress", "Linear", "9", ""],
    ["linear:todo", "Linear", "0", "none"],
    ["review", "GitHub", "2", "ask"],
    ["assigned", "GitHub", "0", "none"],
    ["health", "Diagonal", "3.20 ms", "bad"],
  ]);
  assert.deepEqual(items[1]!.dots, ["#8b9ab0"], "a state without a colour is grey");
  assert.deepEqual(items[4]!.dots, ["#3fbf86", "#d2452f"]);
  assert.equal(items[0]!.tip, "In Progress: 9 issues");
  assert.deepEqual(glanceItems(g, { linear: false, github: true, health: false }).map((i) => i.id), ["review", "assigned"]);
  const failing = glanceItems({ linear: { error: "boom" }, health: { checkedAt: 0, up: false, services: [], error: "It answered 503." } }, on);
  assert.deepEqual(failing.map((i) => [i.id, i.text, i.menu]), [["linear-error", "Unavailable", false], ["health", "Down", true]]);
  assert.equal(failing[0]!.tip, "Linear: boom");
  assert.deepEqual(glanceItems(null, on), []);
});
