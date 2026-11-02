/**
 * A PR's merge box, as GitHub's: what's blocking a merge and why, and which
 * actions apply to it now that the token may take (merge, auto-merge, the
 * merge queue, ready for review or draft, update branch, close, reopen,
 * delete branch). The header, the Merge section and ⌘K all ask here, so each
 * offers the same actions under the same conditions.
 */
import { readStore, writeStore } from "../api";
import type { MergeMethod, PrDetail } from "./types";

export const METHOD_BUTTON: Record<MergeMethod, string> = {
  merge: "Merge pull request",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};
export const METHOD_HINT: Record<MergeMethod, string> = {
  merge: "All commits from this branch will be added to the base branch via a merge commit.",
  squash: "The commits from this branch will be combined into one commit in the base branch.",
  rebase: "The commits from this branch will be rebased and added to the base branch.",
};
/** How auto-merge (or a past merge) merges, in a sentence: "squash and merge". */
export const METHOD_WORDS: Record<MergeMethod, string> = { merge: "merge commit", squash: "squash and merge", rebase: "rebase and merge" };

/** Something standing between the PR and merging: `block` stops it, `warn` is worth knowing. */
export type Blocker = { key: string; text: string; level: "block" | "warn" };

/** Its checks' state, from its check runs (as the header's icon). */
export function checksOf(pr: Pick<PrDetail, "checkRuns">): "passing" | "failing" | "pending" | null {
  const runs = pr.checkRuns;
  if (runs.some((c) => c.state === "failing")) return "failing";
  if (runs.some((c) => c.state === "pending")) return "pending";
  return runs.length ? "passing" : null;
}

const live = (pr: PrDetail) => pr.state === "open" || pr.state === "draft";

/** It could merge now: GitHub's merge state is clean (or merely has failing checks that aren't required). */
export function mergeableNow(pr: PrDetail): boolean {
  return pr.state === "open" && ["clean", "unstable", "has_hooks"].includes(pr.merge.status) && pr.mergeable !== "conflicting";
}

/** Why it can't merge (or what to know before it does), most pressing first; none once merged or closed. */
export function blockers(pr: PrDetail): Blocker[] {
  if (!live(pr)) return [];
  const m = pr.merge;
  const out: Blocker[] = [];
  const blocked = m.status === "blocked";
  if (pr.state === "draft" || m.status === "draft") out.push({ key: "draft", text: "This pull request is still a draft.", level: "block" });
  if (pr.mergeable === "conflicting" || m.status === "dirty")
    out.push({ key: "conflicts", text: "This branch has conflicts that must be resolved.", level: "block" });
  if (m.status === "behind") out.push({ key: "behind", text: "This branch is out of date with the base branch.", level: "block" });
  if (pr.reviewDecision === "changes") out.push({ key: "changes", text: "Changes were requested.", level: blocked ? "block" : "warn" });
  else if (pr.reviewDecision === "review") out.push({ key: "review", text: "Review required.", level: blocked ? "block" : "warn" });
  const checks = checksOf(pr);
  if (checks === "failing")
    out.push({
      key: "checks-failing",
      text: m.status === "unstable" ? "Some checks were not successful, though none is required." : "Some checks were not successful.",
      level: blocked ? "block" : "warn",
    });
  else if (checks === "pending") out.push({ key: "checks-pending", text: "Some checks haven’t completed yet.", level: blocked ? "block" : "warn" });
  if (blocked && !out.some((b) => b.level === "block"))
    out.push({ key: "rules", text: "Merging is blocked: the base branch’s rules aren’t met yet.", level: "block" });
  if (m.status === "unknown" && pr.state === "open" && !out.some((b) => b.level === "block"))
    out.push({ key: "unknown", text: "Checking whether it can merge…", level: "warn" });
  return out;
}

/** What the merge box can do with it. Each needs confirming but Ready, Draft, Update, Reopen, Disable auto-merge and the queue. */
export type MergeAction =
  | { kind: "merge"; method: MergeMethod }
  | { kind: "auto"; method: MergeMethod }
  | { kind: "auto-off" }
  | { kind: "queue" }
  | { kind: "dequeue" }
  | { kind: "ready" }
  | { kind: "draft" }
  | { kind: "update"; method: "merge" | "rebase" }
  | { kind: "close" }
  | { kind: "reopen" }
  | { kind: "delete-branch" };

export const MERGE_ACTION_KINDS: MergeAction["kind"][] = ["merge", "auto", "auto-off", "queue", "dequeue", "ready", "draft", "update", "close", "reopen", "delete-branch"];

/** An administrator's merge past unmet requirements (GitHub's "bypass rules"); never past conflicts or a draft. */
export function adminMerge(pr: PrDetail): boolean {
  const m = pr.merge;
  return pr.state === "open" && m.canMergeAsAdmin && (m.status === "blocked" || m.status === "behind") && pr.mergeable !== "conflicting";
}

/** A merge can be asked for now (the repository's methods; not where a merge queue takes them). */
export function canMergeNow(pr: PrDetail): boolean {
  const m = pr.merge;
  return m.canMerge && !m.queueRequired && m.methods.length > 0 && (mergeableNow(pr) || adminMerge(pr));
}

/** Auto-merge can be turned on: it can't merge yet, but will once its requirements pass. */
export function canAutoMerge(pr: PrDetail): boolean {
  const m = pr.merge;
  return (
    pr.state === "open" &&
    m.autoMergeAllowed &&
    m.canEnableAutoMerge &&
    !m.autoMerge &&
    !m.queueRequired &&
    m.methods.length > 0 &&
    !mergeableNow(pr) &&
    m.status !== "dirty" &&
    m.status !== "draft" &&
    pr.mergeable !== "conflicting"
  );
}

/** Every action that applies to it now, in the order the ⋯ menu lists them. `method` is the merge method chosen. */
export function mergeActions(pr: PrDetail, method: MergeMethod): MergeAction[] {
  const m = pr.merge;
  const out: MergeAction[] = [];
  if (canMergeNow(pr)) out.push({ kind: "merge", method });
  if (m.queueRequired && pr.state === "open" && m.canMerge && !m.queue && pr.mergeable !== "conflicting") out.push({ kind: "queue" });
  if (m.queue && m.canMerge && live(pr)) out.push({ kind: "dequeue" });
  if (canAutoMerge(pr)) out.push({ kind: "auto", method });
  if (m.autoMerge && m.canDisableAutoMerge && live(pr)) out.push({ kind: "auto-off" });
  if (pr.state === "draft" && m.canUpdate) out.push({ kind: "ready" });
  if (live(pr) && m.status === "behind" && m.canUpdateBranch) out.push({ kind: "update", method: "merge" }, { kind: "update", method: "rebase" });
  if (pr.state === "open" && m.canUpdate && !m.queue) out.push({ kind: "draft" });
  if (live(pr) && m.canClose) out.push({ kind: "close" });
  if (pr.state === "closed" && m.canReopen) out.push({ kind: "reopen" });
  if ((pr.state === "merged" || pr.state === "closed") && m.canDeleteBranch) out.push({ kind: "delete-branch" });
  return out;
}

/** An action's words, for the menus and ⌘K (those that open a confirmation end in "…"). */
export function actionLabel(a: MergeAction, pr: Pick<PrDetail, "headRef">): string {
  switch (a.kind) {
    case "merge":
      return `${METHOD_BUTTON[a.method]}…`;
    case "auto":
      return `Enable auto-merge (${METHOD_WORDS[a.method]})…`;
    case "auto-off":
      return "Disable auto-merge";
    case "queue":
      return "Merge when ready (add to the merge queue)";
    case "dequeue":
      return "Remove from the merge queue";
    case "ready":
      return "Ready for review";
    case "draft":
      return "Convert to draft";
    case "update":
      return a.method === "merge" ? "Update branch with a merge commit" : "Update branch by rebasing";
    case "close":
      return "Close pull request…";
    case "reopen":
      return "Reopen pull request";
    case "delete-branch":
      return `Delete branch ${pr.headRef}`;
  }
}

/** An action as a stable key (⌘K's id, a menu item's). */
export const actionKey = (a: MergeAction) => ("method" in a ? `${a.kind}:${a.method}` : a.kind);

// ── Remembered choices ───────────────────────────────────────────────────────
/** The merge method last used in `repo`, while the repository still allows it; else its first allowed. */
export function mergeMethodFor(repo: string, methods: MergeMethod[]): MergeMethod {
  const kept = readStore<Record<string, string>>("github:mergeMethod", {})[repo.toLowerCase()];
  return methods.includes(kept as MergeMethod) ? (kept as MergeMethod) : (methods[0] ?? "merge");
}
export function rememberMergeMethod(repo: string, method: MergeMethod): void {
  const kept = readStore<Record<string, string>>("github:mergeMethod", {});
  writeStore("github:mergeMethod", { ...kept, [repo.toLowerCase()]: method });
}
/** Whether to delete the head branch after merging (one choice for every PR; on by default, as GitHub suggests it). */
export const deleteAfterMerge = () => readStore<boolean>("github:deleteBranchAfterMerge", true) !== false;
export const rememberDeleteAfterMerge = (on: boolean) => writeStore("github:deleteBranchAfterMerge", on);

/** It can offer deleting the branch after merging: the token may, and the repository doesn't already. */
export const offersDelete = (pr: PrDetail) => pr.merge.canDeleteBranch && !pr.merge.deleteBranchOnMerge;
