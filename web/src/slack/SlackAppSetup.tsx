import { useState } from "react";
import { Check, ClipboardCopy, ExternalLink } from "lucide-react";
import { errorMessage } from "../api";
import { openExternal } from "../links";
import { copyText } from "../nativePlatform";
import { createAppUrl, manifestJson, SETUP_STEPS, USER_SCOPES } from "./manifest";

/** Opens Slack's Create app page with the Slack tab's manifest filled in. */
export const createSlackApp = () => openExternal(createAppUrl());

/** Copies the manifest, for Slack's "Create New App → From a manifest". */
export const copySlackManifest = () => copyText(manifestJson());

/**
 * Settings' Slack setup: make the app the Slack tab needs from its manifest
 * (opened in Slack filled in, or copied), then the two tokens to paste above.
 */
export function SlackAppSetup() {
  const [copied, setCopied] = useState<"yes" | string>();
  return (
    <details className="slack-app-setup">
      <summary>Set up a Slack app</summary>
      <ol>
        <li>
          {SETUP_STEPS[0]}
          <span className="slack-app-setup-actions">
            <button type="button" className="secondary" onClick={createSlackApp}>
              <ExternalLink size={12} aria-hidden="true" />
              Create the app in Slack
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                copySlackManifest().then(
                  () => setCopied("yes"),
                  (e) => setCopied(errorMessage(e) || "Couldn't copy the manifest."),
                )
              }
            >
              {copied === "yes" ? <Check size={12} aria-hidden="true" /> : <ClipboardCopy size={12} aria-hidden="true" />}
              {copied === "yes" ? "Copied" : "Copy manifest"}
            </button>
          </span>
          {copied && copied !== "yes" && (
            <small className="slack-app-setup-error" role="alert">
              {copied}
            </small>
          )}
        </li>
        <li>{SETUP_STEPS[1]}</li>
        <li>{SETUP_STEPS[2]}</li>
      </ol>
      <small className="integration-note">
        It asks only for what the Slack tab uses, as you: {USER_SCOPES.join(", ")}.
      </small>
    </details>
  );
}
