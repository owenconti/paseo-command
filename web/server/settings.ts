/**
 * This app's settings file, `~/.paseo-command/settings.json`
 * (`PASEO_COMMAND_SETTINGS` overrides): preset prompts (presets.ts), optional
 * integration opt-ins and the Linear workspace issue links open in (`GET /api/settings`,
 * `POST /api/settings`). Each save keeps the file's other keys; an
 * unreadable file is never overwritten. A file an earlier version kept in
 * the data directory is moved here when this one doesn't exist yet.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { linearSlug } from "../src/linearSlug";
import { dataDir } from "./subagentArchive";
import {
  INTEGRATIONS,
  integrationSettings,
  type Integration,
} from "../src/integrations";

export const settingsFile = () =>
  process.env.PASEO_COMMAND_SETTINGS || join(homedir(), ".paseo-command", "settings.json");
/** Where earlier versions kept it. */
export const legacySettingsFile = () => join(dataDir(), "settings.json");

/** Move an earlier version's file into place, once. */
function adoptLegacy(file: string) {
  const legacy = legacySettingsFile();
  if (legacy === file || existsSync(file) || !existsSync(legacy)) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    renameSync(legacy, file);
  } catch {
    // Left where it is: read from the new place, it is simply absent.
  }
}
export const UNREADABLE = "settings.json can't be read.";

/** The file's contents: `{}` when there is none, null when it can't be read. */
export function readSettings(): Record<string, unknown> | null {
  const file = settingsFile();
  adoptLegacy(file);
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
  if (!Object.keys(change).length) throw new Error("Nothing to save");
  writeSettings(change);
  return appSettings();
}
