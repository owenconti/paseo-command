/**
 * The dashboard counts outside the agents' own work, for the Dungeon Board's
 * vault: your pull requests (GitHub) and your Linear issues, each in four groups. Pure.
 */
import type { DashboardCounts } from "./world.ts";

/** A group's stained-glass pane: merged green, review blue, draft amber, failing red (the `tiles` sheet). */
export type DashPane = "merged" | "review" | "draft" | "failing";
export type DashHall = "prs" | "issues";

/** Each hall's four groups: the group's key, its pane and its name. */
export const DASH_TILES: Record<DashHall, { key: string; tile: DashPane; name: string }[]> = {
  prs: [
    { key: "merged", tile: "merged", name: "Merged" },
    { key: "review", tile: "review", name: "Review" },
    { key: "draft", tile: "draft", name: "Draft" },
    { key: "conflicts", tile: "failing", name: "Conflicts" },
  ],
  issues: [
    { key: "done", tile: "merged", name: "Done" },
    { key: "inProgress", tile: "review", name: "In Progress" },
    { key: "todo", tile: "draft", name: "Todo" },
    { key: "blocked", tile: "failing", name: "Blocked" },
  ],
};

/** A hall's counts: whether known, the total, each group's, and why not when not. */
export type DashCount = { known: boolean; total: number; by: Record<string, number>; atLeast: string[]; why: string };

/** A count as shown: "—" while unknown, "N+" when a lower bound. */
export const dashText = (d: DashCount, key?: string) =>
  !d.known ? "—" : key === undefined ? `${d.total}${d.atLeast.length ? "+" : ""}` : `${d.by[key] ?? 0}${d.atLeast.includes(key) ? "+" : ""}`;

/** A hall's counts from the page's answer (null or undefined until it has one). */
export function dashCount(d: DashboardCounts | null | undefined, hall: DashHall): DashCount {
  const keys = DASH_TILES[hall].map((t) => t.key);
  const ok = d?.state === "ok" && d.counts;
  const by = Object.fromEntries(keys.map((k) => [k, ok ? (d!.counts![k] ?? 0) : 0]));
  const atLeast = ok ? (d!.atLeast ?? []).filter((k) => keys.includes(k)) : [];
  return { known: !!ok, total: keys.reduce((n, k) => n + (by[k] ?? 0), 0), by, atLeast, why: ok ? "" : (d?.message ?? (d === undefined || d === null ? "" : "Not available")) };
}

/** A group's hover card: its name and count, then its PRs (title, repo#n) or issues (key, title), or why it can't count. */
export function dashCard(d: DashboardCounts | null | undefined, hall: DashHall, key: string): { title: string; detail: string; lines: string[] } {
  const spec = DASH_TILES[hall].find((x) => x.key === key)!;
  const what = hall === "prs" ? "Your pull requests" : "Your Linear issues";
  if (d?.state !== "ok") return { title: spec.name, detail: what, lines: [d?.message ?? (hall === "prs" ? "Turn on GitHub in Settings to count your pull requests." : "Turn on Linear in Settings to count your issues.")] };
  const n = d.counts?.[key] ?? 0;
  const plus = d.atLeast?.includes(key) ? "+" : "";
  const items = d.items?.[key] ?? [];
  const lines = items.map((i) => (hall === "prs" ? `${i.title} · ${i.repo}#${i.number}` : `${i.id} ${i.title}`));
  if (n > items.length) lines.push(`and ${n - items.length}${plus} more`);
  const span = (hall === "prs" && key === "merged") || (hall === "issues" && key === "done") ? " (last 14 days)" : "";
  return { title: `${spec.name} · ${n}${plus}`, detail: `${what}${span}`, lines: lines.length ? lines : ["None"] };
}
