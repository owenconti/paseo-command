/**
 * Activity's Linear source: your Inbox (its first page, up to 250
 * notifications), one item per issue (or project, or lone notification) as
 * the Inbox shows them, not archived and not snoozed. An issue's (a pull
 * request's too: the issue its branch or title names) links to the issue on
 * linear.app, which the app opens in Linear's desktop app when it's installed,
 * else in Conquer. Only while Linear is on
 * (the reads take the key through `integrationKey("linear")`). Writes are
 * the Inbox's: read, unread and done (archive) on a row's notifications together.
 * A write forgets the cached list, and its marks (`marks.ts`) keep the Inbox's
 * lag from putting a row back, or its old read state, until something newer.
 */
import type { ActivityItem, ActivityWriteName } from "../../src/activity/types";
import { inboxGroups, inboxText, type InboxGroup } from "../linear/inbox";
import type { LinearUser } from "../linear/types";
import { readNotifications, readWorkspace } from "../linear/reads";
import { appSettings } from "../settings";
import { linearWrite } from "../linear/writes";
import { ACTIVITY_MARKS, applyMarks, newMarks } from "./marks";

export const LINEAR_ACTIVITY = { ttlMs: 20_000 };

let cache: { at: number; items: Promise<ActivityItem[]> } | undefined;
/** Rows marked here, for this launch: Linear keeps what's archived out of the Inbox once it has settled. */
const marks = newMarks();

/** Forgets what was kept (tests). */
export function resetLinearActivity(): void {
  cache = undefined;
  marks.done.clear();
  marks.read.clear();
}

/** Where the row's issue is on linear.app: the notification's own address when it's the issue's, else built from the workspace's. */
function issueUrl(group: InboxGroup, workspace: string): string | undefined {
  const key = group.issueKey;
  if (!key) return undefined;
  const own = group.notifications.map((n) => n.url).find((url) => issueOf(url) === key);
  if (own) return own;
  return workspace ? `https://linear.app/${workspace}/issue/${key}` : undefined;
}
const issueOf = (url: string) => /^https:\/\/linear\.app\/[^/?#]+\/issue\/([^/?#]+)/i.exec(url)?.[1]?.toUpperCase();

/** An Inbox row as an Activity item: `linear:issue:<id>`, `linear:project:<id>` or `linear:notification:<id>`. */
export function linearItem(group: InboxGroup, users: LinearUser[] = [], workspace = ""): ActivityItem {
  const n = group.latest;
  const url = issueUrl(group, workspace) ?? n.url;
  const text = inboxText(group);
  const actor = users.find((u) => u.id === n.actorId);
  return {
    key: `linear:${group.key}`,
    source: "linear",
    id: group.key,
    kind: n.type || "notification",
    title: text.title || n.title || "Linear notification",
    ...(text.what || text.key ? { subtitle: [text.key, text.what].filter(Boolean).join(" · ").slice(0, 300) } : {}),
    subject: group.issueId ? "issue" : group.projectId ? "project" : n.pullRequestId ? "pull" : "notification",
    ...(actor
      ? {
          actor: {
            name: actor.name,
            ...(actor.avatarUrl ? { avatarUrl: `/api/linear/avatar?user=${encodeURIComponent(actor.id)}` } : {}),
          },
        }
      : {}),
    at: n.createdAt || n.updatedAt,
    unread: group.unread,
    ...(url ? { url } : {}),
  };
}

async function gather(): Promise<ActivityItem[]> {
  const { notifications } = await readNotifications();
  // People's names, and the teams whose issues pull requests name, are nice to have: the workspace is kept five minutes by the reads.
  const ws = await readWorkspace().catch(() => undefined);
  const teams = ws?.teams.map((t) => t.key) ?? [];
  // The workspace's address: Linear's, else the one set for the header's issue chip, else a notification's.
  const workspace =
    ws?.urlKey ||
    appSettings().linearWorkspace ||
    notifications.map((n) => /^https:\/\/linear\.app\/([a-z0-9][a-z0-9-]{0,63})\//i.exec(n.url)?.[1]).find(Boolean) ||
    "";
  return inboxGroups(notifications, Date.now(), false, teams).map((g) => linearItem(g, ws?.users, workspace));
}

/** Your Linear Inbox as Activity items; throws a LinearError when Linear can't answer. */
export async function readLinearActivity(fresh = false): Promise<ActivityItem[]> {
  const now = Date.now();
  if (fresh || !cache || now - cache.at >= LINEAR_ACTIVITY.ttlMs) {
    const items = gather();
    cache = { at: now, items };
    items.catch(() => {
      if (cache?.items === items) cache = undefined;
    });
  }
  const items = await cache.items;
  // Done ones past the Inbox's reach (a fortnight) won't show again anyway.
  const cut = ACTIVITY_MARKS.now() - 15 * 86_400_000;
  for (const [id, mark] of marks.done) if (Date.parse(mark.doneAt) < cut) marks.done.delete(id);
  return applyMarks(marks, items).items;
}

/** Whom an item's write names: its issue's or project's notifications, or the one; null when the id isn't one of these. */
export function linearEntity(id: string): Record<string, string> | null {
  const m = /^(issue|project|notification):([0-9a-f-]{8,64})$/i.exec(id);
  if (!m) return null;
  return m[1] === "issue" ? { issueId: m[2]! } : m[1] === "project" ? { projectId: m[2]! } : { id: m[2]! };
}

const WRITE = {
  read: "notificationMarkReadAll",
  unread: "notificationMarkUnreadAll",
  done: "notificationArchiveAll",
} as const;

/** Marks these Linear items read, unread or done (archived); answers those that failed, with why. */
export async function writeLinearActivity(
  name: ActivityWriteName,
  items: ActivityItem[],
): Promise<{ key: string; error: string }[]> {
  const failed: { key: string; error: string }[] = [];
  const at = new Date(ACTIVITY_MARKS.now()).toISOString();
  await Promise.all(
    items.map(async (item) => {
      const entity = linearEntity(item.id);
      if (!entity) return void failed.push({ key: item.key, error: "Not a Linear notification." });
      // Marked before Linear is asked, so no read answering meanwhile puts it back; undone if Linear refuses.
      const before = { done: marks.done.get(item.id), read: marks.read.get(item.id) };
      if (name === "done") marks.done.set(item.id, { at: item.at, doneAt: at });
      else marks.read.set(item.id, { unread: name === "unread", at: item.at, markedAt: at });
      try {
        await linearWrite(WRITE[name], name === "read" ? { ...entity, readAt: at } : entity);
      } catch (e) {
        if (before.done) marks.done.set(item.id, before.done);
        else marks.done.delete(item.id);
        if (before.read) marks.read.set(item.id, before.read);
        else marks.read.delete(item.id);
        failed.push({ key: item.key, error: e instanceof Error && e.message ? e.message : "Linear refused." });
      }
    }),
  );
  cache = undefined;
  return failed;
}
