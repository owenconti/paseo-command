import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importClaudeCodeOnce, recordSkillRun, runsInLine, skillUsage, skillUsageFile } from "./skillUsage";

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const said = (name: string, extra: Record<string, unknown> = {}) =>
  line({
    type: "user",
    uuid: `u-${name}-${Math.random()}`,
    timestamp: "2026-11-05T15:32:08.034Z",
    cwd: "/work/atlas",
    sessionId: "s1",
    message: { role: "user", content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` },
    ...extra,
  });

test("a transcript line gives the skill you invoked, not Claude Code's own commands or a subagent's", () => {
  assert.deepEqual(runsInLine(said("merge-pr")), [
    { skill: "merge-pr", at: "2026-11-05T15:32:08.034Z", source: "claude-code", provider: "claude", cwd: "/work/atlas", session: "s1" },
  ]);
  assert.deepEqual(runsInLine(said("compact")), []);
  assert.deepEqual(runsInLine(said("merge-pr", { isSidechain: true })), []);
  assert.deepEqual(runsInLine(said("merge-pr", { type: "assistant" })), []);
  assert.equal(
    runsInLine(said("x", { message: { content: [{ type: "text", text: "<command-name>/ship-issue</command-name>" }] } }))[0]?.skill,
    "ship-issue",
  );
  assert.deepEqual(runsInLine("not json <command-name>/x</command-name>"), []);
});

test("a skill from the message box is recorded only when the agent lists it", async () => {
  rmSync(skillUsageFile(), { force: true });
  const now = () => new Date("2026-11-22T21:00:00Z");
  const asked: string[] = [];
  const known = async (_agent: string, _host: string | undefined, skill: string) => {
    asked.push(skill);
    return skill === "ship-issue" ? ("skill" as const) : undefined;
  };
  assert.deepEqual(await recordSkillRun({ skill: "merge-pr", kind: "command", agent: "a1", provider: "claude" }, known, now), { recorded: true });
  assert.deepEqual(await recordSkillRun({ skill: "ship-issue", agent: "a1", host: "srv_1" }, known, now), { recorded: true });
  assert.deepEqual(await recordSkillRun({ skill: "tmp", agent: "a1" }, known, now), { recorded: false });
  assert.deepEqual(await recordSkillRun({ skill: "ship-issue" }, known, now), { recorded: false });
  assert.deepEqual(await recordSkillRun({ skill: "compact", kind: "command", agent: "a1" }, known, now), { recorded: false });
  await assert.rejects(recordSkillRun({ skill: "../etc", kind: "skill" }, known, now), /Invalid skill/);
  assert.deepEqual(asked, ["ship-issue", "tmp"]);
  assert.deepEqual(skillUsage().runs, [
    { skill: "merge-pr", at: "2026-11-22T21:00:00.000Z", source: "app", kind: "command", provider: "claude", agent: "a1" },
    { skill: "ship-issue", at: "2026-11-22T21:00:00.000Z", source: "app", kind: "skill", host: "srv_1", agent: "a1" },
  ]);
});

test("past runs are imported once from the Claude Code transcripts, ahead of those recorded since", async () => {
  rmSync(skillUsageFile(), { force: true });
  await recordSkillRun({ skill: "ship-issue", kind: "skill" }, undefined, () => new Date("2026-11-22T21:00:00Z"));
  const root = mkdtempSync(join(tmpdir(), "claude-projects-"));
  try {
    mkdirSync(join(root, "-work-atlas", "s1", "subagents"), { recursive: true });
    const copied = said("merge-pr");
    writeFileSync(join(root, "-work-atlas", "s1.jsonl"), [copied, said("compact"), line({ type: "user", message: { content: "hi" } })].join("\n"));
    // A resumed session's file repeats an earlier message (same uuid): it counts once.
    writeFileSync(join(root, "-work-atlas", "s2.jsonl"), [copied, said("ship-issue")].join("\n") + "\n");
    // Subagents' transcripts are theirs.
    writeFileSync(join(root, "-work-atlas", "s1", "subagents", "agent-1.jsonl"), said("merge-pr"));
    await importClaudeCodeOnce(root);
    const record = skillUsage();
    assert.deepEqual(record.runs.map((r) => `${r.source}:${r.skill}`), ["claude-code:merge-pr", "claude-code:ship-issue", "app:ship-issue"]);
    assert.equal(record.imports["claude-code"]?.runs, 2);
    // Once only.
    writeFileSync(join(root, "-work-atlas", "s3.jsonl"), said("walkthrough"));
    await importClaudeCodeOnce(root);
    assert.equal(skillUsage().runs.length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
