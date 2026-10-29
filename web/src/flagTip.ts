/** A PR flag's hover card on the map: what the flag means, and the facts
 *  behind it from the workspace's pull request. */
import { prLabel, type PrFlag } from "../../rendering/src/prStatus";
import { probeLine, type ProbeVerdict } from "../../rendering/src/probe";
import type { PullRequest } from "./types";

/** `probe` is Probe's verdict, when its streamer hangs from this flag. */
export function flagTip(flag: PrFlag, pr: PullRequest | null | undefined, probe?: ProbeVerdict) {
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
    probe: probe ? probeLine(probe) : "",
    pr: pr ? `#${pr.number} · ${pr.title}` : "",
  };
}
