/**
 * Activity's Linear source: your Inbox (its first page, up to 250
 * notifications), one item per issue (or project, or lone notification) as
 * the Inbox shows them, not archived and not snoozed. Only while Linear is on
 * (the reads take the key through `integrationKey("linear")`). Writes are
 * the Inbox's: read, unread and done (archive) on a row's notifications together.
 */
import type { ActivityItem, ActivityWriteName } from "../../src/activity/types";
import { inboxGroups, inboxText, type InboxGroup } from "../../src/linear/inboxRows";
import type { LinearUser } from "../../src/linear/types";
import { readNotifications, readWorkspace } from "../linear/reads";
import { linearWrite } from "../linear/writes";

export const LINEAR_ACTIVITY = { ttlMs: 20_000 };

let cache: { at: number; items: Promise<ActivityItem[]> } | undefined;

/** Forgets what was kept (tests). */
export function resetLinearActivity(): void {
  cache = undefined;
}

/** An Inbox row as an Activity item: `linear:issue:<id>`, `linear:project:<id>` or `linear:notification:<id>`. */
export function linearItem(group: InboxGroup, users: LinearUser[] = []): ActivityItem {
  const n = group.latest;
  const text = inboxText(group);
  const actor = users.find((u) => u.id === n.actorId);
  return {
    key: `linear:${group.key}`,
    source: "linear",
    id: group.key,
    kind: n.type || "notification",
    title: text.title || n.title || "Linear notification",
    ...(text.what || text.key ? { subtitle: [text.key, text.what].filter(Boolean).join(" · ").slice(0, 300) } : {}),
    subject: group.issueId ? "issue" : group.projectId ? "project" : "notification",
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
    ...(n.url ? { url: n.url } : {}),
    ...(group.issueKey
      ? { open: { kind: "linear-issue" as const, key: group.issueKey } }
      : group.projectId
        ? { open: { kind: "linear-project" as const, id: group.projectId } }
        : {}),
  };
}

async function gather(): Promise<ActivityItem[]> {
  const { notifications } = await readNotifications();
  // People's names are nice to have: the workspace is kept five minutes by the reads.
  const users = await readWorkspace().then(
    (ws) => ws.users,
    () => [],
  );
  return inboxGroups(notifications, Date.now()).map((g) => linearItem(g, users));
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
  return (await cache.items).map((i) => ({ ...i }));
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
  const at = new Date().toISOString();
  await Promise.all(
    items.map(async (item) => {
      const entity = linearEntity(item.id);
      if (!entity) return void failed.push({ key: item.key, error: "Not a Linear notification." });
      try {
        await linearWrite(WRITE[name], name === "read" ? { ...entity, readAt: at } : entity);
      } catch (e) {
        failed.push({ key: item.key, error: e instanceof Error && e.message ? e.message : "Linear refused." });
      }
    }),
  );
  cache = undefined;
  return failed;
}
