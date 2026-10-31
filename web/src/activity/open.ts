/**
 * Opening an Activity item where it lives: a Linear issue or project in the
 * Linear tab, a Slack conversation or thread in the Slack tab, anything else
 * (GitHub) in Conquer. Opening marks it read.
 */
import { readPlace, writePlace } from "../linear/place";
import { openSlackPlace } from "../slack/place";
import { macApp, postAppLink, postAppMenu } from "../worldBridge";
import { writeItems } from "./store";
import type { ActivityItem } from "./types";

/** Whether an item has somewhere to open. */
export const canOpen = (item: ActivityItem) => !!item.open || !!item.url;

export function openActivityItem(item: ActivityItem): void {
  if (item.unread) void writeItems("read", [item.key]);
  const open = item.open;
  if (open && macApp()) {
    if (open.kind === "linear-issue") {
      // The Linear tab opens it where you last were, as the Inbox would.
      writePlace({ ...readPlace(), issue: open.key });
      postAppMenu("linear");
      return;
    }
    if (open.kind === "linear-project") {
      writePlace({ screen: "project", projectId: open.id });
      postAppMenu("linear");
      return;
    }
    if (open.kind === "slack") {
      openSlackPlace({
        conversationId: open.conversationId,
        ...(open.threadTs ? { threadTs: open.threadTs } : {}),
        ...(open.ts ? { ts: open.ts } : {}),
      });
      postAppMenu("slack");
      return;
    }
  }
  if (!item.url) return;
  if (macApp()) postAppLink(item.url);
  else window.open(item.url, "_blank", "noopener,noreferrer");
}
