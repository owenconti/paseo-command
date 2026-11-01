/**
 * The GitHub integration's credential: a classic personal access token, saved
 * as `githubToken` in the data directory's `secrets.json` (Settings → GitHub).
 * Its scopes, each for what the app does with it:
 * - `repo`: read pull requests, their diffs, checks and threads (private
 *   repositories too), and write your comments, reviews, replies, resolved
 *   threads and viewed files;
 * - `notifications`: read Activity's notifications and mark them read or done;
 * - `read:org`: see review requests made of your teams, and team reviewers.
 */
export const GITHUB_TOKEN_SCOPES = ["repo", "notifications", "read:org"] as const;

/** GitHub's New personal access token (classic) page, with the scopes ticked and a name filled in. */
export const GITHUB_TOKEN_URL = `https://github.com/settings/tokens/new?${new URLSearchParams({
  scopes: GITHUB_TOKEN_SCOPES.join(","),
  description: "Paseo Command",
})}`;
