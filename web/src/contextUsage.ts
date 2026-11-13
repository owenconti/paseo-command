/** A conversation's context window, as the session header's meter says it (ContextMeter.tsx). Pure. */
export type Usage = {
  InputTokens?: number;
  OutputTokens?: number;
  CachedTokens?: number;
  CostUsd?: number;
  ContextUsedTokens?: number;
  ContextMaxTokens?: number;
} | null | undefined;

/** 476133 → "476k", 1000000 → "1M", 1250000 → "1.3M", 812 → "812". */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export type ContextLevel = "ok" | "high" | "full";
/** How full the window is: a share (0–1, capped), and a level (high from 70%, full from 90%). */
export function contextOf(usage: Usage): { used: number; max: number; share: number; level: ContextLevel } | null {
  const used = usage?.ContextUsedTokens, max = usage?.ContextMaxTokens;
  if (typeof used !== "number" || typeof max !== "number" || !(max > 0) || used < 0) return null;
  const share = Math.min(1, used / max);
  return { used, max, share, level: share >= 0.9 ? "full" : share >= 0.7 ? "high" : "ok" };
}

/** The meter's words, and its tooltip's: the window, then the last turn's tokens and cost where reported. */
export function contextText(usage: Usage): { label: string; tip: string } | null {
  const c = contextOf(usage);
  const turn = [
    usage?.InputTokens ? `${tokens(usage.InputTokens)} in` : "",
    usage?.CachedTokens ? `${tokens(usage.CachedTokens)} cached` : "",
    usage?.OutputTokens ? `${tokens(usage.OutputTokens)} out` : "",
  ].filter(Boolean).join(" · ");
  const cost = usage?.CostUsd ? `$${usage.CostUsd.toFixed(2)}` : "";
  const last = [turn, cost].filter(Boolean).join(" · ");
  if (!c) return last ? { label: [cost, usage?.OutputTokens ? `${tokens(usage.OutputTokens)} out` : ""].filter(Boolean).join(" · "), tip: `Last turn: ${last}` } : null;
  const pct = Math.round(c.share * 100);
  return {
    label: `${tokens(c.used)} / ${tokens(c.max)} · ${pct}%`,
    tip: [
      `Context: ${c.used.toLocaleString("en-US")} of ${c.max.toLocaleString("en-US")} tokens (${pct}%)`,
      last ? `last turn ${last}` : "",
    ].filter(Boolean).join("; "),
  };
}
