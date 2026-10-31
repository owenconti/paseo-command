/**
 * Whether Slack's messages arrive live (Socket Mode) or by polling, as the
 * socket (`socket.ts`) last set it. Without an app token it is always polling.
 */
import type { SlackLive } from "../../src/slack/types";
import { NO_APP_TOKEN, slackAppToken } from "./client";
import { emitSlack } from "./events";

const IDLE: SlackLive = { mode: "polling", reason: "Connecting to Slack for live updates…" };
let live: SlackLive = IDLE;

/** How messages arrive now. */
export function slackLive(): SlackLive {
  if (!slackAppToken()) return { mode: "polling", reason: NO_APP_TOKEN };
  return { ...live };
}

/** Sets how messages arrive, telling the pages when it changes. */
export function setSlackLive(next: SlackLive): void {
  if (next.mode === live.mode && next.reason === live.reason) return;
  live = next;
  emitSlack({ type: "live", live: slackLive() });
}

/** Back to not connected (tests). */
export function resetSlackLive(): void {
  live = IDLE;
}
