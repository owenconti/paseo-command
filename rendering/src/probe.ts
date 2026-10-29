/**
 * Probe's verdict on a workspace's pull request (Diagonal's review bot,
 * `diagonalprobe`), as the app's server reads it from GitHub
 * (web/server/probe.ts). The Atlas hangs a streamer from the review flag's
 * pole for it, coloured by the verdict. Pure, shared by both.
 */
export type ProbeState = "reviewing" | "approved" | "findings" | "stale" | "failed";
export type ProbeVerdict = {
  state: ProbeState;
  /** Findings still open, when Probe's review says how many. */
  findings?: number;
  /** The commit Probe's verdict is about (its review's `head=` marker). */
  head?: string;
  /** Why it is stale: new commits since the verdict, or Probe deferred. */
  reason?: "head-changed" | "deferred";
};

/** In the legend's order. `color` is the streamer's cloth; `glyph` what it
 * carries beside Probe's mark (findings show their count instead). */
export const PROBE_STATES: readonly {
  state: ProbeState;
  name: string;
  color: number;
  glyph: string;
  description: string;
}[] = [
  {
    state: "reviewing",
    name: "Probe reviewing",
    color: 0x2c8fd0,
    glyph: "…",
    description: "Probe has been asked to review the pull request, or is reviewing it now.",
  },
  {
    state: "approved",
    name: "Probe approved",
    color: 0x2a9d57,
    glyph: "✓",
    description: "Probe found nothing above its merge bar.",
  },
  {
    state: "findings",
    name: "Probe findings (their count)",
    color: 0xe07412,
    glyph: "!",
    description: "Probe's review left findings open.",
  },
  {
    state: "stale",
    name: "Probe out of date",
    color: 0x7d8690,
    glyph: "↻",
    description: "Probe's verdict is for an older commit, or Probe deferred: request its review again.",
  },
  {
    state: "failed",
    name: "Probe failed",
    color: 0xc62f32,
    glyph: "×",
    description: "Probe's review workflow failed.",
  },
];

export const probeState = (state: ProbeState) => PROBE_STATES.find((s) => s.state === state)!;

/** What the streamer carries beside Probe's mark. */
export const probeGlyph = (v: ProbeVerdict) =>
  v.state === "findings" && v.findings ? String(Math.min(v.findings, 99)) : probeState(v.state).glyph;

/** A verdict's hover-card line. */
export function probeLine(v: ProbeVerdict): string {
  const at = v.head ? ` (review of ${v.head.slice(0, 7)})` : "";
  switch (v.state) {
    case "reviewing":
      return "Probe: reviewing.";
    case "approved":
      return `Probe: approved${at}.`;
    case "findings":
      return v.findings
        ? `Probe: ${v.findings} finding${v.findings === 1 ? "" : "s"} open${at}.`
        : `Probe: findings open${at}.`;
    case "stale":
      return v.reason === "deferred"
        ? "Probe: deferred its review; request it again."
        : `Probe: new commits since its review${at}; request it again.`;
    case "failed":
      return "Probe: its review workflow failed.";
  }
}
