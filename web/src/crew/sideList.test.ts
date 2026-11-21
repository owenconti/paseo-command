import assert from "node:assert/strict";
import { test } from "node:test";
import { groupItems, type SideItem } from "./sideList";

const local = { key: "local", name: "Local", local: true };
const lab = { key: "srv", name: "diagonal-lab-1", local: false };
const item = (key: string, o: Partial<SideItem> = {}): SideItem => ({ key, state: "idle", host: local, order: 0, ...o });
const items: SideItem[] = [
  item("a", { order: 0, project: { key: "p1", name: "diagonal-hq/diagonal" }, prompted: "2026-11-20T09:00:00Z" }),
  item("b", { order: 1, project: { key: "p2", name: "paseo-command" }, state: "running", prompted: "2026-11-20T11:00:00Z" }),
  item("c", { order: 2, host: lab, project: { key: "p3", name: "Diagonal-HQ/diagonal" }, state: "approval", prompted: "2026-11-20T10:00:00Z" }),
  item("d", { order: 3, host: lab, created: "2026-11-19T00:00:00Z" }),
];
const shape = (g: ReturnType<typeof groupItems>) => g.map((x) => [x.label, x.items.map((i) => i.key)]);

test("by project, one group per name across hosts, by name; the last prompt first", () => {
  assert.deepEqual(shape(groupItems(items, "project", "recent")), [
    ["diagonal-hq/diagonal", ["c", "a"]],
    ["paseo-command", ["b"]],
    ["Without a project", ["d"]],
  ]);
  assert.deepEqual(shape(groupItems(items, "project", "created"))[0], ["diagonal-hq/diagonal", ["a", "c"]]);
});

test("by status, needing you first; by host in the map's order; or not at all", () => {
  assert.deepEqual(shape(groupItems(items, "status", "recent")), [
    ["Needs you", ["c"]],
    ["Working", ["b"]],
    ["Idle", ["a", "d"]],
  ]);
  assert.deepEqual(shape(groupItems(items, "host", "created")), [
    ["Local", ["a", "b"]],
    ["diagonal-lab-1", ["c", "d"]],
  ]);
  assert.deepEqual(shape(groupItems(items, "none", "recent")), [["", ["b", "c", "a", "d"]]]);
});
