import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, Workspace } from "../types";
import { matchLabel, paseoMatches, repoOf, type PrHead } from "./paseo";

const ws = (id: string, extra: Partial<Workspace> = {}): Workspace => ({
  workspaceId: id,
  project: "atlas",
  name: id,
  isolation: "worktree",
  cwd: `/work/${id}`,
  background: false,
  branch: "feature-12",
  repo: "https://github.com/acme/atlas",
  ...extra,
});
const agent = (id: string, workspaceId: string, updatedAt: string, extra: Partial<Agent> = {}): Agent => ({
  id,
  shortId: id,
  name: id,
  provider: "claude",
  status: "idle",
  cwd: "/",
  created: "",
  workspaceId,
  updatedAt,
  ...extra,
});
const NOW = Date.parse("2026-11-02T12:00:00Z");
const PR: PrHead = { repo: "acme/atlas", number: 12, headRef: "feature-12", headRepo: "acme/atlas" };
const of = (agents: Agent[]) => (w: Workspace) => agents.filter((a) => a.workspaceId === w.workspaceId);
const ids = (pr: PrHead, workspaces: Workspace[], agents: Agent[] = []) =>
  paseoMatches(pr, workspaces, of(agents), [], NOW).map((m) => [m.workspace.workspaceId, m.by, m.agent?.id]);

test("a workspace matches by the PR Paseo names for it, else by its branch and remote", () => {
  assert.deepEqual(ids(PR, [ws("a")]), [["a", "branch", undefined]]);
  // Paseo's PR link wins, whatever the branch.
  const linked = ws("b", { branch: "renamed", pr: { number: 12, title: "", state: "open", url: "https://github.com/Acme/Atlas/pull/12" } });
  assert.deepEqual(ids(PR, [ws("a"), linked]), [["b", "pr", undefined], ["a", "branch", undefined]]);
  // Another PR named for it: its branch doesn't match.
  assert.deepEqual(ids(PR, [ws("c", { pr: { number: 9, title: "", state: "closed", url: "https://github.com/acme/atlas/pull/9" } })]), []);
  // Another branch, another repository, or no known remote.
  assert.deepEqual(ids(PR, [ws("d", { branch: "main" }), ws("e", { repo: "https://github.com/acme/other" }), ws("f", { repo: undefined })]), []);
  // The remote matches whatever its case, and with .git.
  assert.deepEqual(ids(PR, [ws("g", { repo: "https://github.com/ACME/atlas.git" })]), [["g", "branch", undefined]]);
});

test("a PR from a fork matches the fork's checkout, not the base's", () => {
  const fork: PrHead = { ...PR, headRepo: "sam/atlas" };
  assert.deepEqual(ids(fork, [ws("base"), ws("fork", { repo: "https://github.com/sam/atlas" })]), [["fork", "branch", undefined]]);
  // A deleted fork: only Paseo's own link can match.
  const gone: PrHead = { ...PR, headRepo: null };
  assert.deepEqual(ids(gone, [ws("base")]), []);
  assert.deepEqual(ids(gone, [ws("linked", { pr: { number: 12, title: "", state: "open", url: "https://github.com/acme/atlas/pull/12" } })]), [["linked", "pr", undefined]]);
});

test("each match brings its most recent agent, archived and listed subagents aside, the most recent first", () => {
  const agents = [
    agent("old", "a", "2026-11-01T09:00:00Z"),
    agent("new", "a", "2026-11-01T10:00:00Z"),
    agent("archived", "a", "2026-11-01T11:00:00Z", { archived: true }),
    agent("child", "a", "2026-11-01T12:00:00Z", { child: true }),
    agent("newer", "b", "2026-11-02T09:00:00Z"),
  ];
  assert.deepEqual(ids(PR, [ws("a"), ws("b"), ws("c")], agents), [
    ["b", "branch", "newer"],
    ["a", "branch", "new"],
    ["c", "branch", undefined],
  ]);
  // One working counts as active now; a stale row's last word doesn't.
  const busy = [...agents, agent("busy", "a", "2026-10-01T09:00:00Z", { status: "running" }), agent("gone", "b", "2026-10-01T09:00:00Z", { status: "running", stale: true })];
  assert.deepEqual(ids(PR, [ws("a"), ws("b")], busy), [
    ["a", "branch", "busy"],
    ["b", "branch", "newer"],
  ]);
});

test("repoOf and matchLabel", () => {
  assert.equal(repoOf("https://github.com/acme/atlas/"), "acme/atlas");
  assert.equal(repoOf("https://gitlab.com/acme/atlas"), undefined);
  assert.equal(repoOf(undefined), undefined);
  assert.equal(paseoMatches(PR, [ws("Map polish")], () => [])[0]!.label, "local · atlas · Map polish");
  assert.equal(matchLabel(ws("Deploy", { host: "srv_mac", hostLabel: "macmini" })), "macmini · atlas · Deploy");
  // The hosts list names a host its rows don't.
  const mac = { serverId: "srv_mac", label: "Mac mini", status: "online", local: false };
  assert.equal(matchLabel(ws("Deploy", { host: "srv_mac" }), [mac]), "Mac mini · atlas · Deploy");
});
