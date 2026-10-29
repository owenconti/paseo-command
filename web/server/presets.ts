/**
 * The preset prompts in this app's data directory's `settings.json`, edited
 * by hand and read afresh on each request (`GET /api/presets`). No file, or
 * no `presets`, is no presets; an unreadable file says so. Entries without a
 * name or a prompt are skipped.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Preset } from "../src/presets";
import { MAX_PROMPT } from "./api/validate";
import { dataDir } from "./subagentArchive";

export const settingsFile = () => join(dataDir(), "settings.json");

export function presets(): { presets: Preset[]; error: string | null } {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(settingsFile(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { presets: [], error: null };
    return { presets: [], error: "settings.json can't be read." };
  }
  const list: unknown[] = Array.isArray(raw?.presets) ? raw.presets : [];
  const rows = list.flatMap((p: any) => {
    const name = typeof p?.name === "string" ? p.name.trim().slice(0, 60) : "";
    const prompt = typeof p?.prompt === "string" ? p.prompt.trim() : "";
    return name && prompt && prompt.length <= MAX_PROMPT && !prompt.includes("\0")
      ? [{ name, prompt }]
      : [];
  });
  return { presets: rows, error: null };
}
