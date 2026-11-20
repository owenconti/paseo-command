/**
 * What a GitHub notification is about, in words: the comment (or review,
 * line comment or description) that notified you, who wrote it and its
 * address, so Activity can say "sam mentioned you: …" rather than only
 * "You were mentioned". GitHub's notification names only the thread's
 * latest comment (`subject.latest_comment_url`), which is often not the one
 * that mentioned you, so when it isn't the one, the thread's comments,
 * line comments and reviews since you last read it are read for the newest
 * that is (and, for a mention, the description). Kept per thread until it
 * changes (`updated_at`); a thread GitHub can't answer for is left without.
 */
import type { ActivityItem, ActivitySaid } from "../../src/activity/types";
import { githubRest } from "../githubApi";
import { readViewer } from "../github/reads";

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const SAID = {
  /** Characters of what was said kept: the row shows two lines, the preview all of it. */
  textMax: 1000,
  /** Threads read at once, and at most in one gathering (the newest). */
  concurrency: 6,
  max: 40,
  /** Without your last read, how far back a thread's comments are read. */
  sinceMs: 14 * 86_400_000,
};

/** What the notification says of a thread, beside its item: the API addresses and when you last read it. */
export type ThreadRefs = { latestCommentUrl?: string; subjectUrl?: string; lastReadAt?: string };

const API = /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\//;
const PAGE = /^https:\/\/github\.com\//;

/**
 * Markdown as one plain line: no HTML comments, quoted replies, images or
 * code blocks (each `[code]`), links as their words, HTML tags and emphasis
 * marks gone, whitespace collapsed; clipped.
 */
export function plainText(markdown: string, max = SAID.textMax): string {
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?(```|$)/g, " [code] ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether the text @-mentions this login (not an address, nor a longer login). */
export const mentions = (body: string, login: string) =>
  !!login && new RegExp(`(^|[^\\w/@.-])@${escape(login)}(?![\\w-])`, "i").test(body);
/** Whether the text @-mentions a team (`@org/team`). */
export const mentionsTeam = (body: string) => /(^|[^\w/@.-])@[\w-]+\/[\w.-]+/.test(body);

/** One thing said on a thread, as read from GitHub. */
type Said = ActivitySaid & { author?: { login: string; name: string; avatarUrl?: string }; at: string; body: string };

const verdictOf = (state: string): ActivitySaid["verdict"] =>
  state === "APPROVED" ? "approved" : state === "CHANGES_REQUESTED" ? "changes requested" : undefined;

/** A comment, line comment, review or the thread itself (its description) as said. */
export function saidOf(raw: unknown, what: ActivitySaid["what"]): Said | null {
  const c = rec(raw);
  const body = str(c.body);
  const user = rec(c.user);
  const login = str(user.login);
  const verdict = what === "review" ? verdictOf(str(c.state)) : undefined;
  // A review without words says only its verdict.
  if (!body.trim() && !verdict) return null;
  const url = str(c.html_url);
  const avatar = str(user.avatar_url);
  const path = what === "line comment" ? str(c.path) : "";
  return {
    what,
    text: plainText(body),
    body,
    at: str(c.submitted_at) || str(c.created_at) || str(c.updated_at),
    ...(verdict ? { verdict } : {}),
    ...(path ? { path: path.slice(0, 300) } : {}),
    ...(PAGE.test(url) ? { url } : {}),
    ...(login
      ? {
          author: {
            login,
            name: login,
            ...(/^https:\/\/avatars\.githubusercontent\.com\//.test(avatar) ? { avatarUrl: avatar } : {}),
          },
        }
      : {}),
  };
}

/** What a thread's notification is for: one mentioning you (or your team), else one by someone else. */
export function fits(reason: string, said: Said, viewer: string): boolean {
  if (said.author && viewer && said.author.login.toLowerCase() === viewer.toLowerCase()) return false;
  if (reason === "mention") return !viewer || mentions(said.body, viewer);
  if (reason === "team_mention") return mentionsTeam(said.body);
  return true;
}

/** The kind of comment an API address names. */
const whatOf = (url: string): ActivitySaid["what"] =>
  /\/pulls\/comments\/\d+$/.test(url) ? "line comment" : /\/(issues|pulls|discussions)\/\d+$/.test(url) ? "description" : "comment";

async function get(url: string): Promise<unknown> {
  return (await githubRest<unknown>("GET", url)).data;
}
const list = async (url: string): Promise<unknown[]> => {
  const data = await get(url).catch(() => []);
  return Array.isArray(data) ? data : [];
};

/** What notified you on this thread: the newest thing said that fits its reason, else its latest comment; null when there's nothing to say. */
export async function readSaid(item: ActivityItem, refs: ThreadRefs, viewer: string): Promise<Said | null> {
  const latestUrl = API.test(refs.latestCommentUrl ?? "") ? refs.latestCommentUrl! : "";
  const subjectUrl = API.test(refs.subjectUrl ?? "") ? refs.subjectUrl! : "";
  const latestIsSubject = !!latestUrl && latestUrl === subjectUrl;
  const latest = latestUrl ? saidOf(await get(latestUrl).catch(() => null), whatOf(latestUrl)) : null;
  if (latest && !latestIsSubject && fits(item.kind, latest, viewer)) return latest;
  // The latest comment isn't the one: look through what was said since you last read the thread.
  const thread = /\/(issues|pulls)\/(\d+)$/.exec(subjectUrl);
  if (!thread) return latest && fits(item.kind, latest, viewer) ? latest : null;
  const base = subjectUrl.replace(/\/(issues|pulls)\/\d+$/, "");
  const n = thread[2]!;
  const read = Date.parse(refs.lastReadAt ?? "");
  const since = new Date(Number.isFinite(read) ? read : Date.parse(item.at) - SAID.sinceMs).toISOString();
  const q = `since=${encodeURIComponent(since)}&per_page=100`;
  const pull = item.subject === "pull";
  const [comments, lines, reviews] = await Promise.all([
    list(`${base}/issues/${n}/comments?${q}`),
    pull ? list(`${base}/pulls/${n}/comments?${q}&sort=created&direction=desc`) : Promise.resolve([]),
    pull ? list(`${base}/pulls/${n}/reviews?per_page=100`) : Promise.resolve([]),
  ]);
  const said = [
    ...comments.map((c) => saidOf(c, "comment")),
    ...lines.map((c) => saidOf(c, "line comment")),
    ...reviews.map((c) => saidOf(c, "review")),
    // A mention in the description (the latest "comment" GitHub names for a new thread).
    ...(item.kind === "mention" || item.kind === "team_mention"
      ? [latestIsSubject ? latest : saidOf(await get(subjectUrl).catch(() => null), "description")]
      : []),
  ].filter((s): s is Said => s !== null && (s.what === "description" || !(Date.parse(s.at) < Date.parse(since))));
  const best = said
    .filter((s) => fits(item.kind, s, viewer))
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))[0];
  return best ?? (latest && !latestIsSubject && fits(item.kind, latest, viewer) ? latest : null);
}

/** What was said on each thread, kept until the thread changes. */
const kept = new Map<string, { at: string; said: Said | null }>();

export function resetSaid(): void {
  kept.clear();
}

/** Adds what was said, and who said it, to these items (the newest `SAID.max`), in place. */
export async function addSaid(items: ActivityItem[], refs: Map<string, ThreadRefs>): Promise<void> {
  const viewer = await readViewer()
    .then((v) => v.viewer.login)
    .catch(() => "");
  const queue = items.slice(0, SAID.max);
  const work = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      let entry = kept.get(item.id);
      if (!entry || entry.at !== item.at) {
        const said = await readSaid(item, refs.get(item.id) ?? {}, viewer).catch(() => null);
        entry = { at: item.at, said };
        kept.set(item.id, entry);
      }
      const said = entry.said;
      if (!said) continue;
      item.said = {
        what: said.what,
        text: said.text,
        ...(said.verdict ? { verdict: said.verdict } : {}),
        ...(said.path ? { path: said.path } : {}),
        ...(said.url ? { url: said.url } : {}),
      };
      if (said.author) item.actor = { name: said.author.name, ...(said.author.avatarUrl ? { avatarUrl: said.author.avatarUrl } : {}) };
    }
  };
  await Promise.all(Array.from({ length: SAID.concurrency }, work));
  while (kept.size > 500) kept.delete(kept.keys().next().value!);
}
