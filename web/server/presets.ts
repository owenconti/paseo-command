/**
 * The preset prompts in the data directory's `settings.json` (settings.ts), read afresh on each request (`GET /api/presets`) and saved
 * from the app's editor (`POST /api/presets`), keeping the file's other
 * keys. No file, or
 * no `presets`, is no presets; an unreadable file says so, and is never
 * overwritten. Entries without a name or a prompt are skipped.
 */
import type { Preset } from "../src/presets";
import { MAX_PROMPT } from "./api/validate";
import { UNREADABLE, readSettings, writeSettings } from "./settings";

export { settingsFile } from "./settings";
/** As many presets as the editor keeps. */
const MAX_PRESETS = 50;
const MAX_NAME = 60;

export function presets(): { presets: Preset[]; error: string | null } {
  const raw = readSettings();
  if (!raw) return { presets: [], error: UNREADABLE };
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
  writeSettings({ presets: rows });
  return { presets: rows, error: null };
}
