/**
 * A workspace's pull request standing, as Paseo workspace labels: one for its
 * CI, one for its review. The app's server keeps them (web/server/prLabels.ts);
 * the Atlas plants a flag for each. Pure, shared by both.
 */
export type PrFlag =
  | "ci-running"
  | "ci-green"
  | "ci-failing"
  | "review-awaiting"
  | "review-approved"
  | "review-changes";
export type PrGroup = "ci" | "review";
export type PrLabelColor = "amber" | "emerald" | "red" | "sky" | "violet" | "orange";

/** In the flag atlas's order (CI across the top, review below), as the legend lists them. */
export const PR_LABELS: readonly {
  flag: PrFlag;
  group: PrGroup;
  name: string;
  color: PrLabelColor;
}[] = [
  { flag: "ci-running", group: "ci", name: "CI running", color: "amber" },
  { flag: "ci-green", group: "ci", name: "CI green", color: "emerald" },
  { flag: "ci-failing", group: "ci", name: "CI failing", color: "red" },
  { flag: "review-awaiting", group: "review", name: "Awaiting review", color: "sky" },
  { flag: "review-approved", group: "review", name: "Approved", color: "violet" },
  { flag: "review-changes", group: "review", name: "Changes requested", color: "orange" },
];

/** Most urgent first: when a group carries two labels, the first of these shows. */
const URGENCY: PrFlag[] = [
  "ci-failing",
  "ci-running",
  "ci-green",
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
