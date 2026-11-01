/**
 * Links to a Linear issue, a Slack message or a GitHub pull request, opened in
 * the macOS app's own Linear, Slack and GitHub tabs instead of a browser. The app sends the page each such
 * link clicked anywhere (the chat, a Conquer page, an issue's description) as
 * `paseo:link`, only while that tab is on; the page opens it there, or, when
 * it isn't this workspace's, hands it back to open in Conquer.
 */
import { runAppCommand } from "./appCommands";
import { openGithubPlace, prPlaceOf, type GithubPlace } from "./github/place";
import { readPlace as readLinearPlace, writePlace as writeLinearPlace } from "./linear/place";
import { linearStore } from "./linear/store";
import { openSlackPlace } from "./slack/place";
import { slackStore } from "./slack/store";
import { postAppLink, postAppMenu } from "./worldBridge";

export type AppLink =
  | { kind: "linear"; issue: string }
  | { kind: "slack"; host: string; conversationId: string; threadTs?: string; ts?: string }
  | { kind: "github"; place: Extract<GithubPlace, { kind: "pr" }> };

const ISSUE = /^[a-z][a-z0-9]{0,9}-\d{1,6}$/i;
const CONVERSATION = /^[CDG][A-Z0-9]{1,30}$/;
const TS = /^\d{9,11}\.\d{1,8}$/;

/** A Slack permalink's `p1700000000123456` as the message's ts, `1700000000.123456`. */
const permalinkTs = (p: string) => (/^p\d{16}$/.test(p) ? `${p.slice(1, 11)}.${p.slice(11)}` : undefined);

/**
 * What a link opens in the app's tabs: `linear.app/<workspace>/issue/<KEY>…`,
 * `<team>.slack.com/archives/<conversation>[/p<ts>][?thread_ts=…]`, or
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
  if (host.endsWith(".slack.com") && parts[0] === "archives" && CONVERSATION.test(parts[1] ?? "")) {
    const ts = permalinkTs(parts[2] ?? "");
    const thread = url.searchParams.get("thread_ts");
    const threadTs = thread && TS.test(thread) ? thread : undefined;
    return {
      kind: "slack",
      host,
      conversationId: parts[1]!,
      ...(threadTs ? { threadTs } : {}),
      ...(ts ? { ts } : {}),
    };
  }
  const pr = prPlaceOf(href);
  if (pr) return { kind: "github", place: pr };
  return null;
}

/** Whether the link is this workspace's: its team, or its Slack address. Before the workspace is in, it stands. */
function ours(link: AppLink): boolean {
  // Any pull request gh can read opens in the GitHub tab.
  if (link.kind === "github") return true;
  if (link.kind === "linear") {
    const ws = linearStore.getState().workspace;
    const team = link.issue.split("-")[0];
    return !ws || ws.teams.some((t) => t.key.toUpperCase() === team);
  }
  const ws = slackStore.getState().workspace;
  if (!ws) return true;
  try {
    return new URL(ws.url).hostname.toLowerCase() === link.host;
  } catch {
    return true;
  }
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
  if (link.kind === "linear") {
    // Where you last were in Linear, with the issue open; asked of the view at once if it shows.
    const place = { ...readLinearPlace(), issue: link.issue };
    writeLinearPlace(place);
    runAppCommand("linear-go", place);
    postAppMenu("linear");
    return;
  }
  openSlackPlace({
    conversationId: link.conversationId,
    // A reply's permalink opens its thread at the reply; a thread's own message, the thread.
    ...(link.threadTs ? { threadTs: link.threadTs } : {}),
    ...(link.ts ? { ts: link.ts } : {}),
  });
  postAppMenu("slack");
}
