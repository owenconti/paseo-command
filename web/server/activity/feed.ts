/**
 * The Activity feed: GitHub, Linear and Slack notifications gathered in
 * parallel, newest first. Only sources enabled in settings are asked; each
 * answers for itself, so one failing (its reason in its status) never hides
 * the others. Writes go to each item's own source, then the feed is gathered again.
 */
import type {
  ActivityFeed,
  ActivityItem,
  ActivitySource,
  ActivitySourceStatus,
  ActivityWriteName,
  ActivityWriteResult,
} from "../../src/activity/types";
import { integrationEnabled } from "../integrations";
import { readGithubActivity, writeGithubActivity } from "./github";
import { readLinearActivity, writeLinearActivity } from "./linear";
import { readSlackActivity, writeSlackActivity } from "./slack";

type Failure = { key: string; error: string };
export type ActivitySourceDef = {
  read(fresh: boolean): Promise<ActivityItem[]>;
  write(name: ActivityWriteName, items: ActivityItem[]): Promise<Failure[] | void>;
};

const SOURCE_NAMES: Record<ActivitySource, string> = { github: "GitHub", linear: "Linear", slack: "Slack" };

/** The sources, in the sidebar's order (tests replace them). */
export const SOURCES: Record<ActivitySource, ActivitySourceDef> = {
  github: { read: readGithubActivity, write: writeGithubActivity },
  linear: { read: readLinearActivity, write: writeLinearActivity },
  slack: { read: () => readSlackActivity(), write: (name, items) => writeSlackActivity(name, items) },
};
const ORDER: ActivitySource[] = ["github", "linear", "slack"];

/** A source's failure in words: its own message (a SlackError's, a LinearError's, gh's), else a plain one. */
export function reasonOf(source: ActivitySource, e: unknown): string {
  const message = e && typeof e === "object" && "message" in e ? (e as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.trim() ? message.trim().slice(0, 300) : `${SOURCE_NAMES[source]} didn't answer.`;
}

/** What the last feed had, by key: a write finds its items here. */
let known = new Map<string, ActivityItem>();

/** Forgets the last feed (tests). */
export function resetActivityFeed(): void {
  known = new Map();
}

/** Every enabled source's items, newest first, and how each answered. */
export async function activityFeed(fresh = false): Promise<ActivityFeed> {
  const answers = await Promise.all(
    ORDER.map(async (source): Promise<{ status: ActivitySourceStatus; items: ActivityItem[] }> => {
      if (!integrationEnabled(source))
        return { status: { source, enabled: false, ok: true, unread: 0 }, items: [] };
      try {
        const items = (await SOURCES[source].read(fresh)).filter((i) => i.source === source);
        return { status: { source, enabled: true, ok: true, unread: items.filter((i) => i.unread).length }, items };
      } catch (e) {
        return { status: { source, enabled: true, ok: false, reason: reasonOf(source, e), unread: 0 }, items: [] };
      }
    }),
  );
  const items = answers
    .flatMap((a) => a.items)
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || a.key.localeCompare(b.key));
  known = new Map(items.map((i) => [i.key, i]));
  return { items, sources: answers.map((a) => a.status), at: new Date().toISOString() };
}

/** Marks these items read, unread or done, each through its source; then the feed again, and what failed. */
export async function activityWrite(name: ActivityWriteName, keys: string[]): Promise<ActivityWriteResult> {
  if (keys.some((k) => !known.has(k))) await activityFeed();
  const failed: Failure[] = [];
  const bySource = new Map<ActivitySource, ActivityItem[]>();
  for (const key of new Set(keys)) {
    const item = known.get(key);
    if (!item) {
      failed.push({ key, error: "It's no longer in Activity." });
      continue;
    }
    if (!integrationEnabled(item.source)) {
      failed.push({ key, error: `${SOURCE_NAMES[item.source]} is off in Settings.` });
      continue;
    }
    bySource.set(item.source, [...(bySource.get(item.source) ?? []), item]);
  }
  await Promise.all(
    [...bySource].map(async ([source, items]) => {
      try {
        const out = await SOURCES[source].write(name, items);
        if (out) failed.push(...out);
      } catch (e) {
        const error = reasonOf(source, e);
        failed.push(...items.map((i) => ({ key: i.key, error })));
      }
    }),
  );
  const feed = await activityFeed();
  return { feed, ...(failed.length ? { failed } : {}) };
}
