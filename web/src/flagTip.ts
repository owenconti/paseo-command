/** A medallion's hover card on the map: what the flag means, and the facts
 *  behind it from the workspace's pull request (or Probe's verdict on it). */
import { prFlags, prLabel, type MapFlag } from "../../rendering/src/prStatus";
import { probeLine, probeState, type ProbeVerdict } from "../../rendering/src/probe";
import type { PullRequest } from "./types";

/** `probe` is Probe's verdict, for Probe's medallion. */
export function flagTip(flag: MapFlag, pr: PullRequest | null | undefined, probe?: ProbeVerdict) {
  if (flag === "probe") {
    const state = probe && probeState(probe.state);
    return {
      title: state?.name ?? "Probe",
      description: state?.description ?? "",
      facts: probe ? probeLine(probe) : "",
      autoMerge: "",
      pr: pr ? `#${pr.number} · ${pr.title}` : "",
    };
  }
  const label = prLabel(flag);
  const checks = pr?.ci?.checks ?? [];
  const count = (status: string) => checks.filter((c) => c.status === status).length;
  const of = (n: number, verb: string) =>
    `${n} of ${checks.length} check${checks.length === 1 ? "" : "s"} ${verb}.`;
  const facts =
    flag === "ci-failing" && count("failure")
      ? of(count("failure"), "failed")
      : flag === "ci-running" && count("pending")
        ? of(count("pending"), "still running")
        : flag === "ci-green" && checks.length
          ? of(count("success") + count("skipped"), "passed or skipped")
          : "";
  return {
    title: label.name,
    description: label.description,
    facts,
    autoMerge: autoMergeLine(pr),
    pr: pr ? `#${pr.number} · ${pr.title}` : "",
  };
}

/** The auto-merge seal's line: how it will merge, and who turned it on. */
export function autoMergeLine(pr: PullRequest | null | undefined) {
  const on = pr?.autoMerge;
  if (!on || (pr.state !== "open" && pr.state !== "draft")) return "";
  const how = on.method ? ` (${on.method})` : "";
  const by = on.by ? `, turned on by ${on.by}` : "";
  return `Auto-merge on${how}${by}: merges once its checks and reviews pass.`;
}

const PR_STATE_WORDS: Partial<Record<PullRequest["state"], string>> = { draft: "Draft", merged: "Merged", closed: "Closed" };

/** A workspace's pull request as its hover card says it where the map draws no medallions (the
 *  Overworld): the PR, its CI and review flags and Probe's verdict, and auto-merge. Empty without a PR. */
export function workspacePrLines(
  labels: readonly string[] | undefined,
  pr: PullRequest | null | undefined,
  probe?: ProbeVerdict,
  autoMerge?: boolean,
): string[] {
  const flags = prFlags(labels);
  const status = [
    flags.ci && prLabel(flags.ci).name,
    flags.review && prLabel(flags.review).name,
    probe && flags.review && (probe.state === "findings"
      ? probe.findings
        ? `Probe: ${probe.findings} finding${probe.findings === 1 ? "" : "s"} open`
        : "Probe: findings open"
      : probeState(probe.state).name),
  ].filter(Boolean);
  const merge = autoMergeLine(pr) || (autoMerge ? "Auto-merge on." : "");
  // A PR that isn't open says so (a workspace keeps its PR after it merges), as the session header does.
  const state = pr && pr.state !== "open" ? PR_STATE_WORDS[pr.state] : undefined;
  const head = pr ? [`#${pr.number}`, pr.title, state].filter(Boolean).join(" · ") : "";
  return [head, status.join(" · "), merge].filter(Boolean);
}
