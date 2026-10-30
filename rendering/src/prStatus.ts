/**
 * A workspace's pull request standing, as Paseo workspace labels: one for its
 * CI, one for its review, and one while it conflicts with its base. The app's server keeps them (web/server/prLabels.ts);
 * the Atlas plants a flag for each. Pure, shared by both.
 */
export type PrFlag =
  | "ci-running"
  | "ci-green"
  | "ci-failing"
  | "review-awaiting"
  | "review-approved"
  | "review-changes"
  | "conflicts";
/** A medallion on the map: a PR flag's, or Probe's. */
export type MapFlag = PrFlag | "probe";
export type PrGroup = "ci" | "review";
export type PrLabelColor = "amber" | "emerald" | "red" | "sky" | "violet" | "orange" | "pink";

/** In the flag atlas's order (CI across the top, review below, then merge
 * conflicts, which fly in the review flag's place), as the legend lists them.
 * `description` is the flag's hover card. */
export const PR_LABELS: readonly {
  flag: PrFlag;
  group: PrGroup;
  name: string;
  color: PrLabelColor;
  description: string;
}[] = [
  {
    flag: "ci-running",
    group: "ci",
    name: "CI running",
    color: "amber",
    description: "The pull request's checks are still running.",
  },
  {
    flag: "ci-green",
    group: "ci",
    name: "CI green",
    color: "emerald",
    description: "Every check on the pull request passed.",
  },
  {
    flag: "ci-failing",
    group: "ci",
    name: "CI failing",
    color: "red",
    description: "A check on the pull request failed.",
  },
  {
    flag: "review-awaiting",
    group: "review",
    name: "Awaiting review",
    color: "sky",
    description: "The pull request is waiting for a review.",
  },
  {
    flag: "review-approved",
    group: "review",
    name: "Approved",
    color: "violet",
    description: "A reviewer approved the pull request.",
  },
  {
    flag: "review-changes",
    group: "review",
    name: "Changes requested",
    color: "orange",
    description: "A reviewer asked for changes to the pull request.",
  },
  {
    flag: "conflicts",
    group: "review",
    name: "Merge conflicts",
    color: "pink",
    description: "The pull request conflicts with its base branch and can't merge until they're resolved.",
  },
];

/** The seal crowning a PR flag's pole while the pull request has auto-merge on. */
export const AUTO_MERGE = {
  name: "Auto-merge on",
  color: 0x14837b,
  description: "GitHub merges the pull request once its checks and reviews pass.",
};

/** Most urgent first: when a group carries two labels, the first of these shows. */
const URGENCY: PrFlag[] = [
  "ci-failing",
  "ci-running",
  "ci-green",
  "conflicts",
  "review-changes",
  "review-awaiting",
  "review-approved",
];

/** A label name as the daemon compares them: spacing and case aside. */
export const labelKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

/** The flags a workspace's labels call for; other labels are ignored. */
export function prFlags(labels: readonly string[] | undefined): { ci?: PrFlag; review?: PrFlag } {
  const out: { ci?: PrFlag; review?: PrFlag } = {};
  const named = new Set((labels ?? []).map(labelKey));
  for (const flag of URGENCY) {
    const label = PR_LABELS.find((l) => l.flag === flag)!;
    if (named.has(labelKey(label.name)) && !out[label.group]) out[label.group] = flag;
  }
  return out;
}

/** A PR flag's label (its name, colour and description). */
export const prLabel = (flag: PrFlag) => PR_LABELS.find((l) => l.flag === flag)!;
