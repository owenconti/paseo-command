import { ExternalLink } from "lucide-react";
import { GITHUB_TOKEN_SCOPES, GITHUB_TOKEN_URL } from "./githubToken";
import { openExternal } from "./links";

/** Opens GitHub's New personal access token (classic) page with the scopes the app needs ticked. */
export const createGithubToken = () => openExternal(GITHUB_TOKEN_URL);

/**
 * Settings' GitHub setup: make a classic token on GitHub, its scopes already
 * ticked, then paste it above.
 */
export function GithubTokenSetup() {
  return (
    <div className="github-token-setup">
      <button type="button" className="secondary" onClick={createGithubToken}>
        <ExternalLink size={12} aria-hidden="true" />
        Create a classic token on GitHub
      </button>
      <small className="integration-note">
        It opens with the scopes it needs ticked: {GITHUB_TOKEN_SCOPES.join(", ")} (pull requests and reviews,
        Activity's notifications, and your teams' review requests). Choose an expiry, generate it and paste it here.
      </small>
    </div>
  );
}
