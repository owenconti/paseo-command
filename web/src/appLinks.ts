/**
 * Links to a Linear issue or a GitHub pull request, opened in
 * the macOS app's own Linear and GitHub tabs instead of a browser. The app sends the page each such
 * link clicked anywhere (the chat, a Conquer page, an issue's description) as
 * `paseo:link`, only while that tab is on; the page opens it there, or, when
 * it isn't this workspace's, hands it back to open in Conquer.
 */
import { runAppCommand } from "./appCommands";
import { openGithubPlace, prPlaceOf, type GithubPlace } from "./github/place";
import { focusIssue, readPlace as readLinearPlace, writePlace as writeLinearPlace } from "./linear/place";
import { linearStore } from "./linear/store";
import { postAppLink, postAppMenu } from "./worldBridge";

export type AppLink =
  | { kind: "linear"; issue: string }
  | { kind: "github"; place: Extract<GithubPlace, { kind: "pr" }> };

const ISSUE = /^[a-z][a-z0-9]{0,9}-\d{1,6}$/i;

/**
 * What a link opens in the app's tabs: `linear.app/<workspace>/issue/<KEY>…`,
 * `github.com/<owner>/<name>/pull/<n>[/files|/commits|/checks]`; else null.
 * (The app's `WorldWindow.pageMode` matches the same shapes.)
 */
export function parseAppLink(href: string): AppLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "linear.app" && parts[1] === "issue" && ISSUE.test(parts[2] ?? "")) {
    return { kind: "linear", issue: parts[2]!.toUpperCase() };
  }
  const pr = prPlaceOf(href);
  if (pr) return { kind: "github", place: pr };
  return null;
}

/** Whether the link is this workspace's: its team. Before the workspace is in, it stands. */
function ours(link: AppLink): boolean {
  // Any pull request opens in the GitHub tab.
  if (link.kind === "github") return true;
  const ws = linearStore.getState().workspace;
  const team = link.issue.split("-")[0];
  return !ws || ws.teams.some((t) => t.key.toUpperCase() === team);
}

/** The issue a link names, when it's this workspace's (a link the Linear tab opens itself); else null. */
export function linearIssueOfLink(href: string): string | null {
  const link = parseAppLink(href);
  return link?.kind === "linear" && ours(link) ? link.issue : null;
}

/**
 * Opens an issue from outside the Linear tab (a link in the chat or Conquer,
 * Activity, the header's chip) in its own place there: it alone, full width,
 * a new history entry after the place you had, so Back returns there. Read
 * as the view mounts, and asked of the view at once if it shows.
 */
export function openLinearIssue(key: string): void {
  const place = focusIssue(key, readLinearPlace());
  writeLinearPlace(place);
  runAppCommand("linear-go", place);
  postAppMenu("linear");
}

/** Opens a link the app sent (`paseo:link`) in its tab, else in Conquer. */
export function openAppLink(href: string): void {
  const link = parseAppLink(href);
  if (!link || !ours(link)) return postAppLink(href, true);
  if (link.kind === "github") {
    openGithubPlace(link.place);
    postAppMenu("github");
    return;
  }
  openLinearIssue(link.issue);
}
