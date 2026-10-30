/** A medallion's hover card on the map: what the flag means, and the facts
 *  behind it from the workspace's pull request (or Probe's verdict on it). */
import { prLabel, type MapFlag } from "../../rendering/src/prStatus";
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
