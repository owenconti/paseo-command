/**
 * The Slack sidebar's own sections. Slack's Web API gives apps no way to read
 * (or change) the sections made in the Slack app (only its client's
 * undocumented `users.channelSections.*`, which wants a browser session
 * token), so this app keeps sections of its own: per workspace, in the data
 * directory's `settings.json` as `slackSections: { <teamId>: SlackSection[] }`
 * (settings.ts: the file's other keys are kept, an unreadable file is never
 * overwritten). Nothing here reaches Slack.
 */
import type { SlackSection } from "../../src/slack/types";
import { readSettings, writeSettings } from "../settings";
import { SlackError } from "./client";

export const SECTIONS = { max: 50, nameMax: 80, conversationsMax: 500 };
export const SECTION_ID = /^s[a-z0-9]{1,24}$/;
const TEAM = /^[TE][A-Z0-9]{2,20}$/;
/** As reads.ts's (kept here: reads.ts imports this module). */
const CONVERSATION_ID = /^[CDG][A-Z0-9]{2,20}$/;

const invalid = (message: string) => new SlackError("invalid", message);

/** Every team's sections, as the file has them (anything malformed dropped). */
function allSections(): Record<string, unknown> {
  const raw = readSettings()?.slackSections;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** Checks a list of sections; throws `invalid` (with why) for anything off. */
export function checkSections(input: unknown): SlackSection[] {
  if (!Array.isArray(input) || input.length > SECTIONS.max) throw invalid(`sections must be a list of at most ${SECTIONS.max}`);
  const ids = new Set<string>();
  const placed = new Set<string>();
  return input.map((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid(`sections[${i}] must be an object`);
    const s = raw as Record<string, unknown>;
    for (const key of Object.keys(s)) if (!["id", "name", "conversationIds"].includes(key)) throw invalid(`Unexpected field ${key}`);
    if (typeof s.id !== "string" || !SECTION_ID.test(s.id) || ids.has(s.id)) throw invalid(`sections[${i}].id must be a new section id`);
    ids.add(s.id);
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name || name.length > SECTIONS.nameMax) throw invalid(`A section's name must be 1 to ${SECTIONS.nameMax} characters`);
    const list = s.conversationIds;
    if (!Array.isArray(list) || list.length > SECTIONS.conversationsMax)
      throw invalid(`A section holds at most ${SECTIONS.conversationsMax} conversations`);
    const conversationIds = list.map((id) => {
      if (typeof id !== "string" || !CONVERSATION_ID.test(id)) throw invalid("conversationIds must be conversation ids");
      if (placed.has(id)) throw invalid("A conversation can be in one section only");
      placed.add(id);
      return id;
    });
    return { id: s.id, name, conversationIds };
  });
}

/** A workspace's sections (none when it has none, or they or the file can't be read). */
export function readSlackSections(teamId: string): SlackSection[] {
  try {
    return checkSections(allSections()[teamId] ?? []);
  } catch {
    return [];
  }
}

/** Saves a workspace's sections, all of them; the sections as saved. */
export function saveSlackSections(teamId: string, input: unknown): SlackSection[] {
  if (!TEAM.test(teamId)) throw new SlackError("failed", "Slack didn't say which workspace this is.");
  const sections = checkSections(input);
  if (!readSettings()) throw invalid("settings.json can't be read: fix or remove it before changing sections here.");
  writeSettings({ slackSections: { ...allSections(), [teamId]: sections } });
  return sections;
}
