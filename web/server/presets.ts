/**
 * The preset prompts in this app's data directory's `settings.json`, read
 * afresh on each request (`GET /api/presets`) and saved from the app's
 * editor (`POST /api/presets`), keeping the file's other keys. No file, or
 * no `presets`, is no presets; an unreadable file says so, and is never
 * overwritten. Entries without a name or a prompt are skipped.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Preset } from "../src/presets";
import { MAX_PROMPT } from "./api/validate";
import { dataDir } from "./subagentArchive";

export const settingsFile = () => join(dataDir(), "settings.json");
/** As many presets as the editor keeps. */
const MAX_PRESETS = 50;
const MAX_NAME = 60;

/** The file's contents: `{}` when there is none, null when it can't be read. */
function readSettings(): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(settingsFile(), "utf8"));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? {} : null;
  }
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

export function presets(): { presets: Preset[]; error: string | null } {
  const raw = readSettings();
  if (!raw) return { presets: [], error: "settings.json can't be read." };
  const list: unknown[] = Array.isArray(raw.presets) ? raw.presets : [];
  const rows = list.flatMap((p: any) => {
    const name = typeof p?.name === "string" ? p.name.trim().slice(0, MAX_NAME) : "";
    const prompt = typeof p?.prompt === "string" ? p.prompt.trim() : "";
    return name && prompt && prompt.length <= MAX_PROMPT && !prompt.includes("\0")
      ? [{ name, prompt }]
      : [];
  });
  return { presets: rows, error: null };
}

/** Replace the presets, in the order given; every one needs a unique name and a prompt. */
export function savePresets(body: Record<string, unknown>) {
  if (!Array.isArray(body.presets)) throw new Error("Presets are required");
  if (body.presets.length > MAX_PRESETS)
    throw new Error(`At most ${MAX_PRESETS} presets`);
  const seen = new Set<string>();
  const rows: Preset[] = body.presets.map((p: any, i) => {
    const which = `Preset ${i + 1}`;
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    const prompt = typeof p?.prompt === "string" ? p.prompt.trim() : "";
    if (!name) throw new Error(`${which} needs a name`);
    if (name.length > MAX_NAME) throw new Error(`“${name.slice(0, 20)}…” is longer than ${MAX_NAME} characters`);
    if (seen.has(name.toLowerCase())) throw new Error(`Two presets are named “${name}”`);
    seen.add(name.toLowerCase());
    if (!prompt) throw new Error(`“${name}” needs a prompt`);
    if (prompt.length > MAX_PROMPT || prompt.includes("\0") || name.includes("\0"))
      throw new Error(`“${name}” has an invalid prompt`);
    return { name, prompt };
  });
  const settings = readSettings();
  if (!settings)
    throw new Error("settings.json can't be read: fix or remove it before saving presets here.");
  const file = settingsFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...settings, presets: rows }, null, 2) + "\n");
  renameSync(tmp, file);
  return { presets: rows, error: null };
}
