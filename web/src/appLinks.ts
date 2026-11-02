/**
 * Links to a GitHub pull request, opened in the macOS app's own GitHub tab
 * instead of a browser. The app sends the page each such link clicked
 * anywhere (the chat, a Conquer page) as `paseo:link`, only while that tab is
 * on; the page opens it there. (Linear issue links aren't the page's: the app
 * opens them in Linear's desktop app when it's installed, else in Conquer.)
 */
import { openGithubPlace, prPlaceOf, type GithubPlace } from "./github/place";
import { postAppLink, postAppMenu } from "./worldBridge";

export type AppLink = { kind: "github"; place: Extract<GithubPlace, { kind: "pr" }> };

/**
 * What a link opens in the app's tabs: `github.com/<owner>/<name>/pull/<n>[/files|/commits|/checks]`;
 * else null. (The app's `WorldWindow.pageMode` matches the same shape.)
 */
export function parseAppLink(href: string): AppLink | null {
  const pr = prPlaceOf(href);
  return pr ? { kind: "github", place: pr } : null;
}

/** Opens a link the app sent (`paseo:link`) in its tab, else in Conquer. */
export function openAppLink(href: string): void {
  const link = parseAppLink(href);
  if (!link) return postAppLink(href, true);
  openGithubPlace(link.place);
  postAppMenu("github");
}
