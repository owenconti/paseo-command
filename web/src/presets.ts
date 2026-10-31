/**
 * Preset prompts, kept in `~/.paseo-command/settings.json`
 * (`{ "presets": [{ "name": "Review PR", "prompt": "Review {{pr}}…" }] }`).
 * New agent launches one at once with the form's settings; `{{pr}}` is the
 * pull request chosen for its worktree, `{{issue}}` the Linear issue it
 * was opened from (whose details follow the prompt), and `{{slack}}` the Slack
 * message or thread it was opened from (whose messages follow the prompt).
 */
import { issueBlock, type IssueContext } from "./linear/prompt";
import { slackBlock, slackLabel, type SlackContext } from "./slack/prompt";

export type Preset = { name: string; prompt: string };
/** A pull request a new worktree checks out. */
export type PullRequestChoice = {
  number: number;
  title?: string;
  url?: string;
  /** Its head branch, when known. */
  head?: string;
};

const PR_TOKEN = /\{\{\s*pr\s*\}\}/g;
const ISSUE_TOKEN = /\{\{\s*issue\s*\}\}/g;
const SLACK_TOKEN = /\{\{\s*slack\s*\}\}/g;

/** Whether the preset names the chosen pull request. */
export const presetNeedsPr = (preset: Preset) =>
  new RegExp(PR_TOKEN.source).test(preset.prompt);

/** The preset's prompt with `{{pr}}`, `{{issue}}` and `{{slack}}` filled in;
 * launched from an issue, the issue's details follow it, and from Slack, its messages. */
export function fillPreset(prompt: string, pr?: PullRequestChoice, issue?: IssueContext, slack?: SlackContext) {
  const text = pr ? (pr.url ? `#${pr.number} (${pr.url})` : `#${pr.number}`) : "";
  const filled = prompt
    .replace(PR_TOKEN, text)
    .replace(ISSUE_TOKEN, issue ? `${issue.key} (${issue.title})` : "")
    .replace(SLACK_TOKEN, slack ? slackLabel(slack) : "");
  const details = [issue && issueBlock(issue), slack && slackBlock(slack)].filter(Boolean);
  return details.length ? `${filled.trim()}\n\n${details.join("\n\n")}` : filled;
}

/** A pull request number from what was typed or pasted: `123`, `#123`, or a PR URL. */
export function prNumberOf(text: string): number | undefined {
  const m = text.trim().match(/^#?(\d+)$|\/pull\/(\d+)(?:[/?#].*)?$/);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
