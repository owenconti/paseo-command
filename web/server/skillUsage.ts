/**
 * Skill usage (the user's ask): the skills you invoke by hand, kept in the app's data folder as `skill-usage.json`.
 * Only those sent from Paseo Command's own message box (`POST /api/skill-usage`, the user's call), each checked against
 * the agent's own list of skills and commands, plus your past runs imported once from the Claude Code transcripts on
 * this Mac (`~/.claude/projects`, or `CLAUDE_CONFIG_DIR`). Recorded only: the app shows nothing of it yet.
 * Claude Code's own commands (/compact, /model…) aren't skills and are left out.
 */
import { createReadStream, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { dataDir } from "./subagentArchive";

export const skillUsageFile = () => join(dataDir(), "skill-usage.json");

export type SkillRun = {
  skill: string;
  /** When it was sent (ISO). */
  at: string;
  /** Where it was seen: this app's message box, or a Claude Code transcript (the import). */
  source: "app" | "claude-code";
  /** The agent's own word for it, where the app knew it. */
  kind?: "skill" | "command";
  provider?: string;
  host?: string;
  agent?: string;
  cwd?: string;
  /** A Claude Code session's id (the import). */
  session?: string;
};
export type SkillUsage = {
  version: 1;
  /** The one-time imports done: when, and how many runs each brought. */
  imports: { "claude-code"?: { at: string; runs: number } };
  runs: SkillRun[];
};

/** The most runs kept, the oldest going first. */
const KEEP = 100_000;

/** Claude Code's own slash commands: not skills. */
export const BUILTIN = new Set(
  (
    "add-dir agents bashes branch bug clear compact config context cost doctor effort exit export fast feedback help " +
    "hooks ide init install-github-app insights login logout mcp memory model output-style permissions plan plugin plugins " +
    "pr-comments privacy-settings quit release-notes reload-plugins rename resume rewind sandbox skills status statusline " +
    "tasks terminal-setup theme todos upgrade usage vim"
  ).split(" "),
);

const NAME = /^[A-Za-z0-9][\w:.-]{0,80}$/;
/** The skill a message invokes: its `/name` at the start, followed by a space or nothing. */
export const skillNameOf = (text: string) => /^\/([A-Za-z0-9][\w:.-]{0,80})(?=\s|$)/.exec(text.trimStart())?.[1];

function read(): SkillUsage {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(skillUsageFile(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, imports: {}, runs: [] };
    // Never overwrite a record that can't be read.
    throw new Error("The skill usage record (skill-usage.json) can't be read.");
  }
  return {
    version: 1,
    imports: raw?.imports && typeof raw.imports === "object" ? raw.imports : {},
    runs: Array.isArray(raw?.runs) ? raw.runs : [],
  };
}

function write(record: SkillUsage) {
  const file = skillUsageFile();
  mkdirSync(dirname(file), { recursive: true });
  if (record.runs.length > KEEP) record.runs = record.runs.slice(-KEEP);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record) + "\n");
  renameSync(tmp, file);
  return record;
}

export const skillUsage = () => read();

const text = (v: unknown, max = 500) => (typeof v === "string" && v && v.length <= max ? v : undefined);

/**
 * A skill sent from the app's message box. `known` answers whether the agent lists it (and as what) when the page
 * didn't say; a name it doesn't list (a message that merely starts with a path) isn't recorded.
 */
export async function recordSkillRun(
  body: Record<string, unknown>,
  known?: (agent: string, host: string | undefined, skill: string) => Promise<"skill" | "command" | undefined>,
  now = () => new Date(),
): Promise<{ recorded: boolean }> {
  const skill = text(body.skill, 81);
  if (!skill || !NAME.test(skill)) throw new Error("Invalid skill");
  if (BUILTIN.has(skill)) return { recorded: false };
  const agent = text(body.agent, 200);
  const host = text(body.host, 200);
  let kind: SkillRun["kind"] = body.kind === "skill" || body.kind === "command" ? body.kind : undefined;
  if (!kind) {
    if (!agent || !known) return { recorded: false };
    kind = await known(agent, host, skill);
    if (!kind) return { recorded: false };
  }
  const run: SkillRun = { skill, at: now().toISOString(), source: "app", kind };
  const provider = text(body.provider, 200);
  const cwd = text(body.cwd, 4096);
  if (provider) run.provider = provider;
  if (host) run.host = host;
  if (agent) run.agent = agent;
  if (cwd) run.cwd = cwd;
  const record = read();
  record.runs.push(run);
  write(record);
  return { recorded: true };
}

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const TAG = "<command-name>/";

/** The skills a transcript line records you invoking: Claude Code writes `<command-name>/name</command-name>` in your message. */
export function runsInLine(line: string): SkillRun[] {
  if (!line.includes(TAG)) return [];
  let entry: any;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  if (entry?.type !== "user" || entry.isSidechain) return [];
  const content = entry.message?.content;
  const said =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n")
        : "";
  const at = typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp)) ? entry.timestamp : undefined;
  if (!at) return [];
  const runs: SkillRun[] = [];
  for (const m of said.matchAll(/<command-name>\/([A-Za-z0-9][\w:.-]{0,80})<\/command-name>/g)) {
    if (BUILTIN.has(m[1])) continue;
    const run: SkillRun = { skill: m[1], at, source: "claude-code", provider: "claude" };
    if (typeof entry.cwd === "string") run.cwd = entry.cwd;
    if (typeof entry.sessionId === "string") run.session = entry.sessionId;
    runs.push(run);
  }
  return runs;
}

async function transcripts(root: string): Promise<string[]> {
  const files: string[] = [];
  let projects: string[];
  try {
    projects = await readdir(root);
  } catch {
    return files;
  }
  for (const p of projects) {
    // A project's sessions; subagents' transcripts (in folders beneath) are the agent's, not yours.
    let names: string[];
    try {
      names = await readdir(join(root, p));
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith(".jsonl")) files.push(join(root, p, n));
  }
  return files;
}

let importing: Promise<void> | undefined;
/**
 * Your past runs from the Claude Code transcripts on this Mac, once (`imports["claude-code"]` marks it done). Read in
 * the background, a line at a time, only lines holding a command tag parsed; a message copied into a resumed session's
 * file counts once (by its uuid).
 */
export function importClaudeCodeOnce(root = join(claudeDir(), "projects")): Promise<void> {
  if (importing) return importing;
  importing = (async () => {
    if (read().imports["claude-code"]) return;
    const started = new Date().toISOString();
    const found: SkillRun[] = [];
    const seen = new Set<string>();
    for (const file of await transcripts(root)) {
      try {
        const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
        for await (const line of lines) {
          if (!line.includes(TAG)) continue;
          const uuid = /"uuid":"([^"]+)"/.exec(line)?.[1];
          if (uuid && seen.has(uuid)) continue;
          if (uuid) seen.add(uuid);
          found.push(...runsInLine(line));
        }
      } catch {
        // A file that went or can't be read: the rest still count.
      }
    }
    found.sort((a, b) => a.at.localeCompare(b.at));
    // Runs recorded while the import read come after it.
    const record = read();
    record.runs = [...found, ...record.runs];
    record.imports["claude-code"] = { at: started, runs: found.length };
    write(record);
  })().catch((error) => {
    console.error("skill usage: the Claude Code import failed:", error);
    importing = undefined;
  });
  return importing;
}
