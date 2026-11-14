/**
 * The fleet's vocabulary, shared by Crew, the hover tips and the server (Probe, PR labels): agents' states and their
 * names, robots' colours by provider and model, and the fleet as Crew reads it (`atlasData.ts`). The maps that once
 * drew it (Islands, Overworld, the Dungeon Board) were removed; their art stays in `rendering/src/assets`.
 */
import type { ProbeVerdict } from "./probe";
export type State =
  | "running"
  | "idle"
  | "done"
  | "approval"
  | "question"
  | "asking"
  | "failed"
  | "offline";
export type Model = "orange" | "white" | "teal" | "violet" | "lime" | "blue";

/** The fleet as Crew reads it. Every key is unique across hosts. */
export type AtlasData = {
  hosts: { key: string; name: string; online: boolean; local: boolean }[];
  projects: { key: string; host: string; name: string; stale?: boolean }[];
  workspaces: {
    key: string;
    host: string;
    project?: string;
    name: string;
    stale?: boolean;
    /** Its Paseo labels; the PR status ones plant flags. */
    labels?: string[];
    /** Probe's verdict on its PR: a medallion of its own. */
    probe?: ProbeVerdict;
    /** Its PR has auto-merge on: a medallion on a flag's pole. */
    autoMerge?: boolean;
    /** When it was created (ISO 8601): older workspaces take the earlier slots. */
    created?: string;
  }[];
  agents: {
    key: string;
    host: string;
    project?: string;
    workspace?: string;
    name: string;
    /** Provider and model, for example `claude/claude-opus-5-5`. */
    model: string;
    state: State;
    /** Subagents running now. */
    subagents?: number;
    /** Their provider/models, oldest first: each drone takes its own model's colour. */
    subagentModels?: string[];
    /** When it was created (ISO 8601): older agents take the nearer cells. */
    created?: string;
  }[];
};


export const STATE_NAMES: Record<State, string> = {
  running: "Working",
  idle: "Idle",
  done: "Done · waiting for you",
  approval: "Needs approval",
  question: "Has a question",
  asking: "Reply waits on you",
  failed: "Failed · needs attention",
  offline: "Offline · last known",
};
/** Most urgent first. */
export const STATE_PRIORITY: State[] = [
  "failed",
  "approval",
  "question",
  "asking",
  "done",
  "running",
  "idle",
  "offline",
];
/** Agent tile colours by state; idle tiles stay plain. */
export const STATE_TILE: Partial<Record<State, number>> = {
  failed: 0xd2452f,
  approval: 0xef9b1b,
  question: 0x3a86d8,
  asking: 0xa070e0,
  done: 0xf2c94c,
  running: 0x3fbf86,
  offline: 0x8f8b80,
};
/** The state a workspace's tile shows, or undefined when it has no agents. */
export function tileState(states: State[]): State | undefined {
  return STATE_PRIORITY.find((s) => states.includes(s));
}
export const MODEL_COLORS: Record<Model, number> = {
  orange: 0xd97757,
  white: 0xeeeae2,
  teal: 0x25b6b9,
  violet: 0x9962d7,
  lime: 0xa3d640,
  blue: 0x398cdb,
};
const PALETTE: Model[] = ["teal", "violet", "lime", "blue"];

/** Robot colour for a provider/model string: Claude's orange, ChatGPT's white.
 * Other providers keep a stable colour of their own. */
export function modelColor(model: string): Model {
  const m = model.toLowerCase();
  if (/claude|opus|sonnet|haiku|fable|anthropic/.test(m)) return "orange";
  if (/gpt|codex|openai|chatgpt|astra|\bsol\b/.test(m)) return "white";
  return PALETTE[seedOf(m) % PALETTE.length]!;
}
/** The family a robot colour stands for, where it is one maker's. */
export const MODEL_FAMILY: Partial<Record<Model, string>> = {
  orange: "Claude",
  white: "ChatGPT",
};
/** `claude/claude-opus-5-5` → `Claude Opus 5.5`. */
export function modelName(model: string): string {
  const id = model.split("/").pop() || model || "Unknown model";
  return id
    .replace(/^claude-/, "claude ")
    .replace(/-(\d+)-(\d+)(?=$|-)/, " $1.$2")
    .replace(/-/g, " ")
    .replace(/\b(gpt) /i, "$1-")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^Gpt/, "GPT");
}

/** A stable number for a string (FNV-1a): a provider's robot colour. */
export const seedOf = (key: string) => {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

/** Robot sheet frames for each state's glow beneath a robot. */
export const STATE_GLOW: Record<State, string> = {
  running: "glow-running",
  idle: "glow-idle",
  done: "glow-done",
  approval: "glow-approval",
  question: "glow-question",
  asking: "glow-asking",
  failed: "glow-failure",
  offline: "glow-offline",
};
/** The marker over a robot's head, for the states that need you (and running's gear). */
export const STATE_MARK: Partial<Record<State, string>> = {
  approval: "mark-approval",
  question: "mark-question",
  asking: "mark-asking",
  failed: "mark-failure",
  done: "mark-done",
};
/** Other providers' robot colours (the robot sheet has more than the model palette). */
const OTHER_ROBOTS = ["blue", "purple", "green", "yellow", "red", "grey", "teal", "pink"];
/** A robot's colour for its provider/model: Claude orange, ChatGPT white, and any other
 * provider a stable colour of its own (by the provider's name, so its models share it). */
export function robotColor(model: string): string {
  const base = modelColor(model);
  if (base === "orange" || base === "white") return base;
  const provider = (model.split("/")[0] || model).toLowerCase();
  return OTHER_ROBOTS[seedOf(provider) % OTHER_ROBOTS.length]!;
}
/** Robot sheet colours for the model colours (drones whose model isn't known). */
export const ROBOT_OF: Record<string, string> = {
  orange: "orange",
  white: "white",
  teal: "teal",
  violet: "purple",
  lime: "green",
  blue: "blue",
};
