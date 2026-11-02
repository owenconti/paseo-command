/**
 * Opening an Activity item where it lives: a Linear issue or project in the
 * Linear tab (a Linear pull request notification, the issue it names), a pull request
 * in the GitHub tab (the app routes its link there), anything else (GitHub) in
 * Conquer. Opening marks it read.
 */
import { openLinearIssue } from "../appLinks";
import { writePlace } from "../linear/place";
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
      // The Linear tab opens it on its own, Back returning to where you were.
      openLinearIssue(open.key);
      return;
    }
    if (open.kind === "linear-project") {
      writePlace({ screen: "project", projectId: open.id });
      postAppMenu("linear");
      return;
    }
  }
  if (!item.url) return;
  if (macApp()) postAppLink(item.url);
  else window.open(item.url, "_blank", "noopener,noreferrer");
}
