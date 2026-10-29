/**
 * This app's settings file, `settings.json` in its data directory: the
 * preset prompts (presets.ts) and the Linear workspace issue links open in
 * (`GET /api/settings`, `POST /api/settings`). Each save keeps the file's
 * other keys; an unreadable file is never overwritten.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { linearSlug } from "../src/linearSlug";
import { dataDir } from "./subagentArchive";

export const settingsFile = () => join(dataDir(), "settings.json");
export const UNREADABLE = "settings.json can't be read.";

/** The file's contents: `{}` when there is none, null when it can't be read. */
export function readSettings(): Record<string, unknown> | null {
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

/** Set some keys, keeping the rest. */
export function writeSettings(change: Record<string, unknown>) {
  const settings = readSettings();
  if (!settings)
    throw new Error("settings.json can't be read: fix or remove it before saving settings here.");
  const file = settingsFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...settings, ...change }, null, 2) + "\n");
  renameSync(tmp, file);
}

/** The settings the page reads (presets have their own route). */
export function appSettings() {
  const raw = readSettings();
  const slug = typeof raw?.linearWorkspace === "string" ? linearSlug(raw.linearWorkspace) : null;
  return { linearWorkspace: slug ?? "", error: raw ? null : UNREADABLE };
}

/** Save the settings given; an empty Linear workspace clears it. */
export function saveAppSettings(body: Record<string, unknown>) {
  const change: Record<string, unknown> = {};
  if ("linearWorkspace" in body) {
    const value = typeof body.linearWorkspace === "string" ? body.linearWorkspace : null;
    if (value === null) throw new Error("Invalid Linear workspace");
    const slug = value.trim() ? linearSlug(value) : "";
    if (slug === null) throw new Error("Invalid Linear workspace");
    change.linearWorkspace = slug;
  }
  if (!Object.keys(change).length) throw new Error("Nothing to save");
  writeSettings(change);
  return appSettings();
}
