/**
 * Opening an Activity item where it lives: a pull request in the GitHub tab
 * (the app routes its link there), a Linear issue in Linear's desktop app when
 * it's installed (the app routes that too), anything else in Conquer; in a
 * browser, a new tab. Opening marks it read.
 */
import { macApp, postAppLink } from "../worldBridge";
import { writeItems } from "./store";
import type { ActivityItem } from "./types";

/** Whether an item has somewhere to open. */
export const canOpen = (item: ActivityItem) => !!item.url;

export function openActivityItem(item: ActivityItem): void {
  if (item.unread) void writeItems("read", [item.key]);
  if (!item.url) return;
  if (macApp()) postAppLink(item.url);
  else window.open(item.url, "_blank", "noopener,noreferrer");
}
