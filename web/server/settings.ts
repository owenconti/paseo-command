/**
 * This app's settings file, `settings.json` in its data directory beside
 * `secrets.json` (`PASEO_COMMAND_SETTINGS` overrides), so the macOS app's Dev and
 * release copies each keep their own: preset prompts (presets.ts), optional
 * integration opt-ins, the Linear workspace issue links open in and where the
 * Files page opens files (`files`: the viewer or an editor command; `GET /api/settings`,
 * `POST /api/settings`). Each save keeps the file's other keys; an
 * unreadable file is never overwritten.
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { linearSlug } from "../src/linearSlug";
import { dataDir } from "./subagentArchive";
import {
  INTEGRATIONS,
  integrationSettings,
  type Integration,
} from "../src/integrations";
import { editorCommandProblem, filesSettings } from "../src/files/editorCommand";

export const settingsFile = () =>
  process.env.PASEO_COMMAND_SETTINGS || join(dataDir(), "settings.json");
export const UNREADABLE = "settings.json can't be read.";

/** The file's contents: `{}` when there is none, null when it can't be read. */
export function readSettings(): Record<string, unknown> | null {
  const file = settingsFile();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? {} : null;
  }
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Set some keys, keeping the rest. */
export function writeSettings(change: Record<string, unknown>) {
  const settings = readSettings();
  if (!settings)
    throw new Error(
      "settings.json can't be read: fix or remove it before saving settings here.",
    );
  const file = settingsFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({ ...settings, ...change }, null, 2) + "\n",
  );
  renameSync(tmp, file);
}

/** The settings the page reads (presets have their own route). */
export function appSettings() {
  const raw = readSettings();
  const slug =
    typeof raw?.linearWorkspace === "string"
      ? linearSlug(raw.linearWorkspace)
      : null;
  return {
    linearWorkspace: slug ?? "",
    integrations: integrationSettings(raw?.integrations),
    files: filesSettings(raw?.files),
    error: raw ? null : UNREADABLE,
  };
}

/** Save the settings given; an empty Linear workspace clears it. */
export function saveAppSettings(body: Record<string, unknown>) {
  const change: Record<string, unknown> = {};
  if ("integrations" in body) {
    const input = body.integrations;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid integrations");
    for (const [name, enabled] of Object.entries(input))
      if (
        !INTEGRATIONS.includes(name as Integration) ||
        typeof enabled !== "boolean"
      )
        throw new Error("Invalid integration setting");
    const existing = readSettings()?.integrations;
    change.integrations = {
      ...(existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing
        : {}),
      ...input,
    };
  }
  if ("linearWorkspace" in body) {
    const value =
      typeof body.linearWorkspace === "string" ? body.linearWorkspace : null;
    if (value === null) throw new Error("Invalid Linear workspace");
    const slug = value.trim() ? linearSlug(value) : "";
    if (slug === null) throw new Error("Invalid Linear workspace");
    change.linearWorkspace = slug;
  }
  if ("files" in body) {
    // Settings → Files: where files open, and the editor command (checked, never run here).
    const input = body.files;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid Files settings");
    const { openIn, editorCommand } = input as Record<string, unknown>;
    if (openIn !== undefined && openIn !== "viewer" && openIn !== "editor")
      throw new Error("Invalid Files settings");
    if (editorCommand !== undefined) {
      if (typeof editorCommand !== "string") throw new Error("Invalid editor command");
      const problem = editorCommandProblem(editorCommand);
      if (problem) throw new Error(problem);
    }
    const existing = readSettings()?.files;
    const kept =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};
    change.files = {
      ...kept,
      ...(openIn !== undefined ? { openIn } : {}),
      ...(typeof editorCommand === "string" ? { editorCommand: editorCommand.trim() } : {}),
    };
  }
  if (!Object.keys(change).length) throw new Error("Nothing to save");
  writeSettings(change);
  return appSettings();
}
