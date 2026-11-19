/**
 * At a glance, on Crew's head (`crew/Glance.tsx`, `GET /api/glance`, `server/glance.ts`): your Linear issues in
 * progress, in review and to do; the GitHub pull requests asking your review and assigned to you; and Diagonal's
 * health (`app.go-diagonal.com/health/status`, its database services' response times). Each part is there only while
 * its integration is on; one that can't answer says why (`error`) without hiding the others. Pure, shared with the server.
 */
import type { PrRow } from "./github/types";

export type GlanceIssue = { id: string; key: string; title: string; url: string; team: string; priority: number; updatedAt: string };
/** Your issues in one workflow state (by name, across teams): started states first, in their order, then unstarted. */
export type GlanceIssueGroup = { state: string; type: "started" | "unstarted"; color: string; total: number; issues: GlanceIssue[] };
export type GlancePr = Pick<PrRow, "id" | "repo" | "number" | "title" | "url" | "state" | "checks" | "updatedAt"> & { author: string };
export type GlancePrList = { total: number; rows: GlancePr[] };

/** A database service's average response time (ms), as Diagonal's health endpoint gives it. */
export type HealthService = { name: string; ms: number };
export type Health = {
  /** When it was checked (epoch ms). */
  checkedAt: number;
  /** It answered 2xx with JSON. */
  up: boolean;
  /** How long the whole check took (ms). */
  took?: number;
  services: HealthService[];
  error?: string;
};

export type Glance = {
  linear?: { groups: GlanceIssueGroup[] } | { error: string };
  github?: { review: GlancePrList; assigned: GlancePrList } | { error: string };
  health?: Health;
};

export const GLANCE = {
  /** The page asks this often while Crew shows (the server keeps each part a little less). */
  pollMs: 60_000,
  /** At most this many issues or pull requests are listed in each group. */
  listMax: 20,
};

export const HEALTH_URL = "https://app.go-diagonal.com/health/status";

export type Tone = "good" | "slow" | "bad";
/** A service's light: under 1 ms green, under 3 ms yellow, else red. */
export const healthTone = (ms: number): Tone => (ms < 1 ? "good" : ms < 3 ? "slow" : "bad");
/** The whole check's light: red when it didn't answer, else its slowest service's. */
export function overallTone(h: Health): Tone {
  if (!h.up) return "bad";
  const tones = h.services.map((s) => healthTone(s.ms));
  return tones.includes("bad") ? "bad" : tones.includes("slow") ? "slow" : "good";
}
/** "0.48 ms", "12 ms". */
export const msText = (ms: number) => `${ms < 10 ? ms.toFixed(2) : Math.round(ms)} ms`;

/** The services in Diagonal's answer (`{"iterations":100,"pgsql":0.47,…}`): every finite number but `iterations`. */
export function healthServices(body: unknown): HealthService[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return Object.entries(body as Record<string, unknown>)
    .filter(([name, v]) => name !== "iterations" && typeof v === "number" && Number.isFinite(v) && v >= 0 && /^[\w.-]{1,40}$/.test(name))
    .map(([name, ms]) => ({ name, ms: ms as number }));
}

type RawIssue = {
  id?: unknown;
  identifier?: unknown;
  title?: unknown;
  url?: unknown;
  priority?: unknown;
  updatedAt?: unknown;
  team?: { key?: unknown } | null;
  state?: { name?: unknown; type?: unknown; position?: unknown; color?: unknown } | null;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Your started and unstarted issues by state: started states by their position (In Progress, In Review), then unstarted (Todo). */
export function groupIssues(raw: RawIssue[], max = GLANCE.listMax): GlanceIssueGroup[] {
  const groups = new Map<string, GlanceIssueGroup & { position: number }>();
  for (const r of raw) {
    const type = str(r.state?.type);
    const state = str(r.state?.name).trim();
    const key = str(r.identifier);
    const url = str(r.url);
    if ((type !== "started" && type !== "unstarted") || !state || !key || !/^https:\/\/linear\.app\//.test(url)) continue;
    const name = state.toLowerCase();
    const position = typeof r.state?.position === "number" ? r.state.position : 0;
    const group = groups.get(name) ?? { state, type, color: "", total: 0, issues: [], position };
    if (!groups.has(name)) groups.set(name, group);
    const color = str(r.state?.color);
    if (!group.color && /^#[0-9a-f]{6}$/i.test(color)) group.color = color;
    group.position = Math.min(group.position, position);
    group.total += 1;
    group.issues.push({
      id: str(r.id) || key,
      key,
      title: str(r.title).slice(0, 160),
      url,
      team: str(r.team?.key),
      priority: typeof r.priority === "number" ? r.priority : 0,
      updatedAt: str(r.updatedAt),
    });
  }
  return [...groups.values()]
    .sort((a, b) => (a.type === b.type ? a.position - b.position : a.type === "started" ? -1 : 1))
    .map(({ position: _, ...g }) => ({ ...g, issues: g.issues.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, max) }));
}

/** The lights' and dots' colours, as Crew's states draw them (the same in either theme). */
export const TONE_COLOR: Record<Tone, string> = { good: "#3fbf86", slow: "#f2c94c", bad: "#d2452f" };
const GREY = "#8b9ab0";

/** One count on the top bar (the page's own in a browser, the macOS app's native one): plain data the app can draw. */
export type GlanceItem = {
  id: string;
  group: "Linear" | "GitHub" | "Diagonal";
  text: string;
  /** Dots before the text, `#rrggbb`. */
  dots: string[];
  icon: "" | "review" | "assigned" | "warning";
  /** "" strong, "none" nothing there, "ask" waits on you, "slow", "bad". */
  tone: "" | "none" | "ask" | "slow" | "bad";
  /** Its name and tooltip, saying what the count is. */
  tip: string;
  /** It opens a menu (an error or "nothing open" doesn't). */
  menu: boolean;
};

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const hex = (color: string) => (/^#[0-9a-f]{6}$/i.test(color) ? color : GREY);

/** The bar's counts for what the glance says, each part only while its integration is on. */
export function glanceItems(g: Glance | null, on: { linear: boolean; github: boolean; health: boolean }): GlanceItem[] {
  if (!g) return [];
  const out: GlanceItem[] = [];
  const failed = (group: GlanceItem["group"], error: string) =>
    out.push({ id: `${group.toLowerCase()}-error`, group, text: "Unavailable", dots: [], icon: "warning", tone: "none", tip: `${group}: ${error}`, menu: false });
  if (on.linear && g.linear) {
    if ("error" in g.linear) failed("Linear", g.linear.error);
    else if (!g.linear.groups.length)
      out.push({ id: "linear-none", group: "Linear", text: "Nothing open", dots: [], icon: "", tone: "none", tip: "No Linear issues in progress, in review or to do", menu: false });
    else
      for (const s of g.linear.groups)
        out.push({
          id: `linear:${s.state.toLowerCase()}`,
          group: "Linear",
          text: String(s.total),
          dots: [hex(s.color)],
          icon: "",
          tone: s.total ? "" : "none",
          tip: `${s.state}: ${n(s.total, "issue")}`,
          menu: true,
        });
  }
  if (on.github && g.github) {
    if ("error" in g.github) failed("GitHub", g.github.error);
    else {
      const { review, assigned } = g.github;
      out.push({ id: "review", group: "GitHub", text: String(review.total), dots: [], icon: "review", tone: review.total ? "ask" : "none", tip: `Review requests: ${n(review.total, "pull request")}`, menu: true });
      out.push({ id: "assigned", group: "GitHub", text: String(assigned.total), dots: [], icon: "assigned", tone: assigned.total ? "" : "none", tip: `Assigned to you: ${n(assigned.total, "pull request")}`, menu: true });
    }
  }
  if (on.health && g.health) {
    const h = g.health;
    const up = h.up && h.services.length > 0;
    const tone = overallTone(h);
    out.push({
      id: "health",
      group: "Diagonal",
      text: up ? msText(Math.max(...h.services.map((s) => s.ms))) : "Down",
      dots: up ? h.services.map((s) => TONE_COLOR[healthTone(s.ms)]) : [TONE_COLOR.bad],
      icon: "",
      tone: tone === "good" ? "" : tone,
      tip: up ? `Diagonal health: ${h.services.map((s) => `${s.name} ${msText(s.ms)}`).join(", ")}` : `Diagonal health: down, ${h.error ?? "no answer"}`,
      menu: true,
    });
  }
  return out;
}
