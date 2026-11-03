import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fleet, get, install, post } from "../fake-daemon";
import { diffCommentsFile } from "../diffComments";
import { placeComments, type LocalComment } from "../../src/github/localComments";
import type { DiffFile } from "../../src/github/types";

// Only fake daemons: install() points the app's connector at them; this route never asks one.
const { network } = fleet();
let uninstall: () => void;
before(() => {
  uninstall = install(network);
});
after(() => {
  uninstall();
  setTimeout(() => process.exit(0), 50).unref();
});

const list = (host: string | null, workspace: string) =>
  get(`diff-comments?workspace=${workspace}${host ? `&host=${host}` : ""}`);
const add = (host: string | null, workspace: string, comment: Record<string, unknown>) =>
  post("diff-comments", { ...(host ? { host } : {}), workspace, action: "add", comment });
const comment = { path: "src/a.ts", side: "RIGHT", line: 3, text: ["const b = 2;"], body: "Rename b." };

test("diff comments: kept per host and workspace, in the data directory", async () => {
  rmSync(diffCommentsFile(), { force: true });
  assert.deepEqual((await list(null, "ws_a")).data, { comments: [] });
  const r = await add(null, "ws_a", comment);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [made] = r.data.comments as LocalComment[];
  assert.match(made!.id, /^dc_/);
  assert.equal(made!.body, "Rename b.");
  assert.ok(made!.createdAt);
  await add("srv_remote", "ws_a", { ...comment, body: "On the remote host" });
  await add(null, "ws_b", { ...comment, body: "Another workspace" });
  // "local" is the local host as well.
  assert.deepEqual(((await list("local", "ws_a")).data.comments as LocalComment[]).map((c) => c.body), ["Rename b."]);
  assert.deepEqual(((await list("srv_remote", "ws_a")).data.comments as LocalComment[]).map((c) => c.body), ["On the remote host"]);
  assert.deepEqual(((await list(null, "ws_b")).data.comments as LocalComment[]).map((c) => c.body), ["Another workspace"]);
  const file = JSON.parse(readFileSync(diffCommentsFile(), "utf8"));
  assert.deepEqual(Object.keys(file.workspaces).sort(), ["srv_remote|ws_a", "|ws_a", "|ws_b"].sort());
});

test("diff comments: edited, moved, applied (kept as history) and discarded", async () => {
  rmSync(diffCommentsFile(), { force: true });
  const a = (await add(null, "ws_a", comment)).data.comments[0] as LocalComment;
  const b = (await add(null, "ws_a", { ...comment, line: 9, startLine: 7, text: ["x", "y", "z"], body: "Range" })).data.comments[1] as LocalComment;
  assert.equal(b.startLine, 7);
  let r = await post("diff-comments", { workspace: "ws_a", action: "edit", id: a.id, body: " Rename b to total. " });
  assert.equal(r.data.comments[0].body, "Rename b to total.");
  assert.ok(r.data.comments[0].updatedAt);
  r = await post("diff-comments", { workspace: "ws_a", action: "move", moves: [{ id: b.id, line: 12, startLine: 10 }] });
  assert.deepEqual([r.data.comments[1].startLine, r.data.comments[1].line], [10, 12]);
  r = await post("diff-comments", { workspace: "ws_a", action: "apply", ids: [a.id], agentId: "agent-1" });
  assert.ok(r.data.comments[0].appliedAt);
  assert.equal(r.data.comments[0].appliedTo, "agent-1");
  assert.equal(r.data.comments[1].appliedAt, undefined);
  r = await post("diff-comments", { workspace: "ws_a", action: "discard" });
  assert.deepEqual(r.data.comments.map((c: LocalComment) => c.id), [a.id], "only the applied one stays, as history");
  r = await post("diff-comments", { workspace: "ws_a", action: "remove", id: a.id });
  assert.deepEqual(r.data.comments, []);
  assert.equal(JSON.parse(readFileSync(diffCommentsFile(), "utf8")).workspaces["|ws_a"], undefined);
});

test("diff comments: refuses what isn't one, and the file is written atomically keeping unknown data", async () => {
  rmSync(diffCommentsFile(), { force: true });
  for (const bad of [
    { ...comment, body: "  " },
    { ...comment, side: "MIDDLE" },
    { ...comment, line: 0 },
    { ...comment, startLine: 5 },
    { ...comment, text: "not lines" },
  ])
    assert.equal((await add(null, "ws_a", bad)).status, 400, JSON.stringify(bad));
  assert.equal((await post("diff-comments", { workspace: "../x", action: "add", comment })).status, 400);
  assert.equal((await post("diff-comments", { workspace: "ws_a", action: "edit", id: "dc_gone", body: "x" })).status, 400);
  assert.equal((await post("diff-comments", { workspace: "ws_a", action: "explode" })).status, 400);
  assert.equal((await get("diff-comments?workspace=ws_a&extra=1")).status, 400);

  mkdirSync(dirname(diffCommentsFile()), { recursive: true });
  writeFileSync(
    diffCommentsFile(),
    JSON.stringify({ version: 7, other: { keep: true }, workspaces: { "|ws_a": [{ ...comment, id: "dc_old", createdAt: "2026-01-01T00:00:00Z", extra: "kept" }] } }),
  );
  const r = await add(null, "ws_a", comment);
  assert.equal(r.status, 200);
  const file = JSON.parse(readFileSync(diffCommentsFile(), "utf8"));
  assert.equal(file.version, 7);
  assert.deepEqual(file.other, { keep: true });
  assert.equal(file.workspaces["|ws_a"][0].extra, "kept");
  assert.equal(file.workspaces["|ws_a"].length, 2);
  assert.deepEqual(readdirSync(dirname(diffCommentsFile())).filter((f) => f.includes("diff-comments") && f.endsWith(".tmp")), []);

  // A damaged file is never overwritten.
  writeFileSync(diffCommentsFile(), "{ not json");
  assert.equal((await add(null, "ws_a", comment)).status, 400);
  assert.equal((await list(null, "ws_a")).status, 400);
  assert.equal(readFileSync(diffCommentsFile(), "utf8"), "{ not json");
  rmSync(diffCommentsFile(), { force: true });
  assert.ok(!existsSync(diffCommentsFile()));
});

const file = (path: string, newStart: number, lines: [DiffFile["hunks"][number]["lines"][number]["type"], string][]): DiffFile => ({
  path,
  isNew: false,
  isDeleted: false,
  additions: lines.filter(([t]) => t === "add").length,
  deletions: lines.filter(([t]) => t === "remove").length,
  hunks: [
    {
      oldStart: newStart,
      oldCount: lines.filter(([t]) => t !== "add").length,
      newStart,
      newCount: lines.filter(([t]) => t !== "remove").length,
      lines: lines.map(([type, content]) => ({ type, content })),
    },
  ],
  status: "ok",
});
const kept = (c: Partial<LocalComment>): LocalComment => ({
  id: "dc_1",
  path: "src/a.ts",
  side: "RIGHT",
  line: 11,
  text: ["const b = 2;"],
  body: "Rename b.",
  createdAt: "2026-11-01T00:00:00Z",
  ...c,
});

test("re-anchoring: kept in place, moved to the nearest matching lines, else outdated", () => {
  const before = file("src/a.ts", 10, [
    ["context", "const a = 1;"],
    ["add", "const b = 2;"],
    ["context", "return a + b;"],
  ]);
  // Unchanged: it stays.
  assert.deepEqual(placeComments([kept({})], [before]).placed[0]!.line, 11);
  assert.deepEqual(placeComments([kept({})], [before]).moves, []);
  // Three lines added above: it follows its text.
  const shifted = file("src/a.ts", 10, [
    ["add", "// one"],
    ["add", "// two"],
    ["add", "// three"],
    ["context", "const a = 1;"],
    ["add", "const b = 2;"],
    ["context", "return a + b;"],
  ]);
  const moved = placeComments([kept({})], [shifted]);
  assert.equal(moved.placed[0]!.line, 14);
  assert.deepEqual(moved.moves, [{ id: "dc_1", line: 14 }]);
  // A range moves as a whole, to the nearest copy of its lines.
  const range = kept({ startLine: 10, line: 11, text: ["const a = 1;", "const b = 2;"] });
  const twice = file("src/a.ts", 1, [
    ["context", "const a = 1;"],
    ["context", "const b = 2;"],
    ...Array.from({ length: 20 }, (_, i) => ["context", `// ${i}`] as ["context", string]),
    ["add", "const a = 1;"],
    ["add", "const b = 2;"],
  ]);
  assert.deepEqual(
    (({ line, startLine }) => ({ line, startLine }))(placeComments([range], [twice]).placed[0]!),
    { line: 2, startLine: 1 },
    "the copy nearer line 10",
  );
  // Its line changed, or its file left the diff: outdated, still listed.
  const changed = file("src/a.ts", 10, [
    ["context", "const a = 1;"],
    ["add", "const total = 2;"],
  ]);
  assert.equal(placeComments([kept({})], [changed]).outdated.length, 1);
  assert.equal(placeComments([kept({})], []).outdated.length, 1);
  // A removed line is found on the old side only.
  const removed = file("src/a.ts", 10, [["remove", "const b = 2;"]]);
  assert.equal(placeComments([kept({ side: "LEFT", line: 10 })], [removed]).placed.length, 1);
  assert.equal(placeComments([kept({ side: "RIGHT", line: 10 })], [removed]).outdated.length, 1);
});
