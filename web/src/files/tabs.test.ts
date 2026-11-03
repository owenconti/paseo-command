import { test } from "node:test";
import assert from "node:assert/strict";
import { KEPT_WORKSPACES, readKept, writeKept } from "./kept";
import { closeOtherTabs, closeTab, MAX_CLOSED, moveTab, NO_TABS, openTab, pinTab, readTabs, reopenTab, scrollTab, stepTab, tabLabels, type TabsState } from "./tabs";

const paths = (s: TabsState) => s.tabs.map((t) => `${t.path}${t.preview ? "*" : ""}`);

test("a preview tab: one at most, replaced by the next, pinned by a double-click or use", () => {
  let s = openTab(NO_TABS, "a.ts");
  assert.deepEqual(paths(s), ["a.ts*"]);
  s = openTab(s, "b.ts");
  assert.deepEqual(paths(s), ["b.ts*"], "the next preview takes its place");
  assert.equal(s.active, "b.ts");
  s = pinTab(s, "b.ts");
  s = openTab(s, "c.ts");
  assert.deepEqual(paths(s), ["b.ts", "c.ts*"], "a pinned tab stays; a new preview after the shown one");
  // Opening a preview again keeps it a preview; opening it pinned (a double-click) pins it in place.
  assert.deepEqual(paths(openTab(s, "c.ts")), ["b.ts", "c.ts*"]);
  s = openTab(s, "c.ts", true);
  assert.deepEqual(paths(s), ["b.ts", "c.ts"]);
  // A pinned tab opens after the shown one; showing an open one doesn't move it.
  s = openTab({ ...s, active: "b.ts" }, "d.ts", true);
  assert.deepEqual(paths(s), ["b.ts", "d.ts", "c.ts"]);
  s = openTab(s, "c.ts");
  assert.deepEqual(paths(s), ["b.ts", "d.ts", "c.ts"]);
  assert.equal(s.active, "c.ts");
  // A preview in the middle is replaced where it stands.
  s = openTab({ ...s, active: "b.ts" }, "e.ts");
  assert.deepEqual(paths(s), ["b.ts", "e.ts*", "d.ts", "c.ts"]);
  assert.deepEqual(paths(openTab(s, "f.ts")), ["b.ts", "f.ts*", "d.ts", "c.ts"]);
  assert.equal(pinTab(s, "b.ts"), s, "pinning a pinned tab changes nothing");
});

test("closing: the right neighbour shows, else the left; ⇧⌘T reopens, pinned, newest first", () => {
  let s: TabsState = { tabs: [{ path: "a" }, { path: "b" }, { path: "c" }], active: "b", closed: [] };
  s = closeTab(s, "b");
  assert.deepEqual(paths(s), ["a", "c"]);
  assert.equal(s.active, "c");
  s = closeTab(s, "c");
  assert.equal(s.active, "a");
  assert.deepEqual(s.closed, ["b", "c"]);
  // Closing a tab not shown leaves the shown one.
  s = openTab(s, "d", true);
  s = closeTab(s, "a");
  assert.equal(s.active, "d");
  s = closeTab(s, "d");
  assert.deepEqual(s, { tabs: [], closed: ["b", "c", "a", "d"] }, "no tab shows");
  assert.deepEqual(closeTab(s, "x"), s, "closing nothing changes nothing");
  s = reopenTab(s);
  assert.deepEqual(paths(s), ["d"]);
  assert.equal(s.active, "d");
  s = reopenTab(s);
  assert.deepEqual(paths(s), ["d", "a"]);
  assert.deepEqual(s.closed, ["b", "c"]);
  // A closed path opened again meanwhile is skipped.
  s = openTab(s, "c");
  assert.deepEqual(s.closed, ["b"]);
  s = reopenTab(reopenTab(s));
  assert.deepEqual(paths(s), ["d", "a", "c*", "b"]);
  assert.deepEqual(reopenTab(s).tabs, s.tabs, "nothing left to reopen");
  // A preview reopens pinned.
  s = reopenTab(closeTab(s, "c"));
  assert.deepEqual(paths(s), ["d", "a", "b", "c"]);
  // Close others keeps one and remembers the rest.
  s = closeOtherTabs(s, "a");
  assert.deepEqual(paths(s), ["a"]);
  assert.equal(s.active, "a");
  assert.deepEqual(s.closed.slice(-3), ["d", "b", "c"]);
  // At most MAX_CLOSED remembered.
  let many: TabsState = NO_TABS;
  for (let i = 0; i < MAX_CLOSED + 5; i++) many = closeTab(openTab(many, `f${i}`, true), `f${i}`);
  assert.equal(many.closed.length, MAX_CLOSED);
  assert.equal(many.closed.at(-1), `f${MAX_CLOSED + 4}`);
});

test("reordering, stepping (wrapping) and each tab's scroll", () => {
  let s: TabsState = { tabs: [{ path: "a" }, { path: "b" }, { path: "c" }], active: "a", closed: [] };
  assert.deepEqual(paths(moveTab(s, "a", 2)), ["b", "c", "a"]);
  assert.deepEqual(paths(moveTab(s, "c", 0)), ["c", "a", "b"]);
  assert.deepEqual(paths(moveTab(s, "b", 9)), ["a", "c", "b"]);
  assert.equal(moveTab(s, "b", 1), s);
  assert.equal(stepTab(s, 1).active, "b");
  assert.equal(stepTab(s, -1).active, "c");
  assert.equal(stepTab({ ...s, active: "c" }, 1).active, "a");
  s = scrollTab(s, "b", 840.6);
  assert.equal(s.tabs[1]!.scroll, 841);
  assert.equal(scrollTab(s, "b", 841), s);
  assert.equal(scrollTab(s, "x", 10), s);
});

test("labels: the file name, with as much of its folder as tells clashing names apart", () => {
  const l = tabLabels(["src/index.ts", "test/index.ts", "README.md", "a/lib/x.ts", "b/lib/x.ts", "x.ts", "web/src/main.tsx"]);
  assert.deepEqual(l.get("README.md"), { name: "README.md" });
  assert.deepEqual(l.get("web/src/main.tsx"), { name: "main.tsx" });
  assert.deepEqual(l.get("src/index.ts"), { name: "index.ts", dir: "src" });
  assert.deepEqual(l.get("test/index.ts"), { name: "index.ts", dir: "test" });
  assert.deepEqual(l.get("a/lib/x.ts"), { name: "x.ts", dir: "a/lib" });
  assert.deepEqual(l.get("b/lib/x.ts"), { name: "x.ts", dir: "b/lib" });
  assert.deepEqual(l.get("x.ts"), { name: "x.ts", dir: "/" });
});

test("kept per workspace (host and workspace), read back safely, the old one-file form too", () => {
  const ws = { id: "wks_a" };
  const remote = { id: "wks_a", host: "box" };
  let tabs = openTab(openTab(NO_TABS, "src/app.ts", true), "README.md");
  tabs = scrollTab(tabs, "src/app.ts", 1200);
  tabs = closeTab(openTab(tabs, "gone.ts", true), "gone.ts");
  let all: unknown = writeKept({}, ws, { open: ["src"], recent: ["README.md", "src/app.ts"], tabs });
  all = writeKept(all, remote, { open: [], recent: [], tabs: openTab(NO_TABS, "other.ts", true) });
  // Through storage, as JSON.
  all = JSON.parse(JSON.stringify(all));
  const back = readKept(all, ws);
  assert.deepEqual(back.open, ["src"]);
  assert.deepEqual(back.recent, ["README.md", "src/app.ts"]);
  assert.deepEqual(back.tabs, { tabs: [{ path: "src/app.ts", scroll: 1200 }, { path: "README.md", preview: true }], active: "README.md", closed: ["gone.ts"] });
  assert.deepEqual(paths(readKept(all, remote).tabs), ["other.ts"], "another host's workspace of the same id keeps its own");
  assert.equal(back.changes, undefined, "the file shows, not Changes");
  // Changes shown in the tabs' place: kept, the tabs as they were.
  const changed = readKept(JSON.parse(JSON.stringify(writeKept(all, ws, { ...back, changes: true }))), ws);
  assert.equal(changed.changes, true);
  assert.deepEqual(changed.tabs, back.tabs);
  assert.equal(readKept({ "|wks_a": { changes: "yes" } }, ws).changes, undefined, "only true counts");
  assert.deepEqual(readKept(all, { id: "wks_b" }), { open: [], recent: [], tabs: { tabs: [], closed: [] } });
  // Before tabs: one open file.
  assert.deepEqual(readKept({ "|wks_a": { open: [], file: "a.ts" } }, ws).tabs, { tabs: [{ path: "a.ts" }], active: "a.ts", closed: [] });
  // Odd data: dropped (duplicates, non-strings, a second preview, bad scrolls); the shown tab must be open.
  assert.deepEqual(
    readTabs({ tabs: [{ path: "a", preview: true }, { path: "a" }, { path: 3 }, null, { path: "b", preview: true, scroll: -4 }, { path: "c", scroll: "x" }], active: "zz", closed: ["q", 5] }),
    { tabs: [{ path: "a", preview: true }, { path: "b" }, { path: "c" }], active: "a", closed: ["q"] },
  );
  assert.deepEqual(readKept("junk", ws).tabs, NO_TABS);
  // The most recently written workspaces are kept.
  let many: unknown = {};
  for (let i = 0; i < KEPT_WORKSPACES + 3; i++) many = writeKept(many, { id: `w${i}` }, { open: [], recent: [], tabs: NO_TABS });
  many = writeKept(many, { id: "w0" }, { open: [], recent: [], tabs: NO_TABS });
  const keys = Object.keys(many as object);
  assert.equal(keys.length, KEPT_WORKSPACES);
  assert.equal(keys.at(-1), "|w0");
  assert.ok(!keys.includes("|w3") && keys.includes("|w4"));
});
