/**
 * Preset prompts, kept in the data directory's `settings.json`
 * (`{ "presets": [{ "name": "Review PR", "prompt": "Review {{pr}}…" }] }`).
 * New agent launches one at once with the form's settings; `{{pr}}` is the
 * pull request chosen for its worktree.
 */
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

/** Whether the preset names the chosen pull request. */
export const presetNeedsPr = (preset: Preset) =>
  new RegExp(PR_TOKEN.source).test(preset.prompt);

/** The preset's prompt with `{{pr}}` filled in. */
export function fillPreset(prompt: string, pr?: PullRequestChoice) {
  const text = pr ? (pr.url ? `#${pr.number} (${pr.url})` : `#${pr.number}`) : "";
  return prompt.replace(PR_TOKEN, text);
}

/** A pull request number from what was typed or pasted: `123`, `#123`, or a PR URL. */
export function prNumberOf(text: string): number | undefined {
  const m = text.trim().match(/^#?(\d+)$|\/pull\/(\d+)(?:[/?#].*)?$/);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
