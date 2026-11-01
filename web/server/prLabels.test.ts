/**
 * The PR labeller: which labels a PR calls for, and the changes a pass sends.
 * Daemons are injected (recorded calls, or the fake daemon); nothing reaches GitHub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDaemon } from "./fake-daemon";
import type { PullRequest } from "./links";
import {
  PR_LABELS_TUNING,
  createPrLabeller,
  startPrLabels,
  stopPrLabels,
  wantedLabels,
  type LabelRow,
  type LabellerDeps,
} from "./prLabels";

const pr = (extra: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: "Plant flags",
  state: "open",
  url: "https://github.com/acme/app/pull/7",
  ...extra,
});
const ci = (state: "passing" | "failing" | "pending" | "none") => ({ state, checks: [] });

test("wantedLabels maps a PR's CI and review to their labels", () => {
  assert.deepEqual(wantedLabels(pr({ ci: ci("pending") })), ["CI running", "Awaiting review"]);
  assert.deepEqual(wantedLabels(pr({ ci: ci("pending"), review: "pending" })), [
    "CI running",
    "Awaiting review",
  ]);
  assert.deepEqual(wantedLabels(pr({ state: "draft", ci: ci("passing") })), ["CI green"]);
  assert.deepEqual(
    wantedLabels(pr({ ci: ci("failing"), review: "changes_requested" })),
    ["CI failing", "Changes requested"],
  );
  assert.deepEqual(wantedLabels(pr({ ci: ci("none"), review: "approved" })), ["Approved"]);
  assert.deepEqual(wantedLabels(pr({ review: "approved" })), ["Approved"]);
  assert.deepEqual(wantedLabels(pr({ state: "merged", ci: ci("passing") })), []);
  assert.deepEqual(wantedLabels(pr({ state: "closed" })), []);
  assert.deepEqual(wantedLabels(null), []);
  assert.equal(wantedLabels(undefined), null);
});

test("a PR with merge conflicts carries their label; a merged one doesn't", () => {
  assert.deepEqual(wantedLabels(pr({ ci: ci("passing"), review: "approved", conflicts: true })), [
    "CI green",
    "Approved",
    "Merge conflicts",
  ]);
  assert.deepEqual(wantedLabels(pr({ state: "draft", conflicts: true })), ["Merge conflicts"]);
  assert.deepEqual(wantedLabels(pr({ conflicts: false })), ["Awaiting review"]);
  assert.deepEqual(wantedLabels(pr({ state: "merged", conflicts: true })), []);
});

type SetCall = { host?: string; workspaceId: string; name: string; color: string; assigned: boolean };
function deps(rows: LabelRow[], extra: Partial<LabellerDeps> = {}) {
  const calls: SetCall[] = [];
  const asked: string[] = [];
  const d: LabellerDeps = {
    rows: async () => rows,
    pr: async (repo) => {
      asked.push(repo);
      return { available: false, pr: null };
    },
    catalog: async () => [],
    setLabel: async (host, o) => {
      calls.push({ host, workspaceId: o.workspaceId, ...o.label, assigned: o.assigned });
    },
    log: () => {},
    ...extra,
  };
  return { d, calls, asked };
}
const row = (extra: Partial<LabelRow> = {}): LabelRow => ({
  workspaceId: "wks_a",
  repo: "https://github.com/acme/app",
  branch: "feat/flags",
  ...extra,
});

test("a stale CI label is replaced; other labels are untouched", async () => {
  const { d, calls } = deps([
    row({ labels: ["CI green", "bug", "Awaiting review"], pr: pr({ ci: ci("pending") }) }),
  ]);
  await createPrLabeller(d).pass();
  assert.deepEqual(calls, [
    { host: undefined, workspaceId: "wks_a", name: "CI green", color: "emerald", assigned: false },
    { host: undefined, workspaceId: "wks_a", name: "CI running", color: "amber", assigned: true },
  ]);
});

test("unchanged labels send nothing", async () => {
  const { d, calls } = deps([
    row({ labels: ["CI running", "Awaiting review"], pr: pr({ ci: ci("pending") }) }),
  ]);
  await createPrLabeller(d).pass();
  assert.deepEqual(calls, []);
});

test("stale rows are left alone", async () => {
  const { d, calls } = deps([row({ stale: true, labels: ["Approved"], pr: null })]);
  await createPrLabeller(d).pass();
  assert.deepEqual(calls, []);
});

test("an unknown PR keeps its labels", async () => {
  const { d, calls, asked } = deps([row({ labels: ["Approved"] })]);
  await createPrLabeller(d).pass();
  assert.deepEqual(asked, ["https://github.com/acme/app"]);
  assert.deepEqual(calls, []);
});

test("a workspace without a GitHub remote, or Paseo's PR facts, is skipped", async () => {
  const { d, calls, asked } = deps([row({ repo: undefined, labels: ["Approved"] })]);
  await createPrLabeller(d).pass();
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});

test("GitHub answers for a workspace Paseo can't tell about, on any host", async () => {
  const { d, calls } = deps([row({ host: "srv_far" })], {
    pr: async () => ({ available: true, pr: pr({ state: "draft", ci: ci("failing") }) }),
  });
  await createPrLabeller(d).pass();
  assert.deepEqual(calls.map((c) => [c.name, c.assigned]), [["CI failing", true]]);
});

test("a base branch has no PR labels", async () => {
  const { d, calls, asked } = deps([row({ branch: "main", labels: ["Approved"] })]);
  await createPrLabeller(d).pass();
  assert.deepEqual(asked, []);
  assert.deepEqual(calls.map((c) => [c.name, c.assigned]), [["Approved", false]]);
});

test("catalog colours win", async () => {
  const { d, calls } = deps([row({ host: "srv_far", pr: pr({ review: "approved" }) })], {
    catalog: async (host) => (host === "srv_far" ? [{ name: "approved", color: "blue" }] : []),
  });
  await createPrLabeller(d).pass();
  assert.deepEqual(calls, [
    { host: "srv_far", workspaceId: "wks_a", name: "Approved", color: "blue", assigned: true },
  ]);
});

test("one workspace's failure doesn't stop the others", async () => {
  const logged: string[] = [];
  const done: string[] = [];
  const { d } = deps(
    [
      row({ workspaceId: "wks_bad", pr: pr({ review: "approved" }) }),
      row({ workspaceId: "wks_ok", pr: pr({ review: "approved" }) }),
    ],
    {
      setLabel: async (_host, o) => {
        if (o.workspaceId === "wks_bad") throw new Error("refused");
        done.push(o.workspaceId);
      },
      log: (m) => logged.push(m),
    },
  );
  await createPrLabeller(d).pass();
  assert.deepEqual(done, ["wks_ok"]);
  assert.equal(logged.length, 1);
});

test("a pass never throws, even when the rows can't be read", async () => {
  const { d } = deps([], {
    rows: async () => {
      throw new Error("daemon down");
    },
  });
  await createPrLabeller(d).pass();
});

test("labels land on the fake daemon through the SDK's call", async () => {
  const daemon = new FakeDaemon("srv_local", "Review Mac");
  daemon.addProject({ projectId: "prj", path: "/work" });
  daemon.addWorkspace({ id: "wks_a", projectId: "prj", cwd: "/work/a", branch: "feat/flags" });
  const client = daemon.client("127.0.0.1:6767");
  await client.connect();
  const { d } = deps([row({ pr: pr({ ci: ci("passing"), review: "approved" }) })], {
    setLabel: (_host, o) => client.setWorkspaceLabel(o),
  });
  await createPrLabeller(d).pass();
  assert.deepEqual(daemon.workspaces.get("wks_a")!.labels, ["CI green", "Approved"]);
  assert.deepEqual(
    daemon.workspaceLabels.map((l) => [l.name, l.color]),
    [
      ["CI green", "emerald"],
      ["Approved", "violet"],
    ],
  );
});

test("one labeller loop runs per process, until stopped", async () => {
  const saved = { ...PR_LABELS_TUNING };
  Object.assign(PR_LABELS_TUNING, { firstMs: 5, everyMs: 20 });
  let reads = 0;
  const { d } = deps([], {
    rows: async () => {
      reads++;
      return [];
    },
  });
  try {
    startPrLabels(d);
    startPrLabels(d);
    await new Promise((r) => setTimeout(r, 110));
    assert.ok(reads >= 3 && reads <= 7, `one loop, not two (${reads} passes)`);
    stopPrLabels();
    const after = reads;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(reads, after);
  } finally {
    stopPrLabels();
    Object.assign(PR_LABELS_TUNING, saved);
  }
});

test("passes never overlap", async () => {
  const saved = { ...PR_LABELS_TUNING };
  Object.assign(PR_LABELS_TUNING, { firstMs: 1, everyMs: 5 });
  let running = 0,
    most = 0;
  const { d } = deps([], {
    rows: async () => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 40));
      running--;
      return [];
    },
  });
  try {
    startPrLabels(d);
    await new Promise((r) => setTimeout(r, 120));
  } finally {
    stopPrLabels();
    Object.assign(PR_LABELS_TUNING, saved);
  }
  assert.equal(most, 1);
});

test("PASEO_COMMAND_PR_LABELS=off keeps the labeller from starting", async () => {
  const saved = { ...PR_LABELS_TUNING };
  Object.assign(PR_LABELS_TUNING, { firstMs: 1, everyMs: 5 });
  process.env.PASEO_COMMAND_PR_LABELS = "off";
  let reads = 0;
  const { d } = deps([], {
    rows: async () => {
      reads++;
      return [];
    },
  });
  try {
    startPrLabels(d);
    await new Promise((r) => setTimeout(r, 40));
  } finally {
    stopPrLabels();
    delete process.env.PASEO_COMMAND_PR_LABELS;
    Object.assign(PR_LABELS_TUNING, saved);
  }
  assert.equal(reads, 0);
});
