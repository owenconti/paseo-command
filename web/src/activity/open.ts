/**
 * Opening an Activity item where it lives: a pull request in the GitHub tab
 * (the app routes its link there), a Linear issue in Linear's desktop app when
 * it's installed (the app routes that too), anything else in your default
 * browser (a GitHub issue at the comment that notified you); in a browser, a
 * new tab. Opening marks it read.
 */
import { prPlaceOf } from "../github/place";
import { macApp, postAppLink } from "../worldBridge";
import { writeItems } from "./store";
import type { ActivityItem } from "./types";

/** Whether an item has somewhere to open. */
export const canOpen = (item: ActivityItem) => !!item.url;

/** Where it opens: a pull request in the GitHub tab; other GitHub threads at the comment that notified you. */
export const openUrl = (item: ActivityItem): string | undefined =>
  item.source === "github" && item.said?.url && !(item.url && prPlaceOf(item.url)) ? item.said.url : item.url;

export function openActivityItem(item: ActivityItem): void {
  if (item.unread) void writeItems("read", [item.key]);
  const url = openUrl(item);
  if (!url) return;
  if (macApp()) postAppLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
