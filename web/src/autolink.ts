/**
 * Plain mentions in a conversation that link themselves: Linear issue keys
 * of the workspace's own teams (`DE-7338`) and pull requests (`#7054`,
 * "PR #7054", "pull request 7054", `owner/repo#7054`). Only text is ever
 * wrapped: what was written stays as written, so it reads and copies the same.
 * Never inside code, links, URLs or paths; a key whose team isn't one of the
 * workspace's (UTF-8, ISO-8601, SHA-256) and a PR without a known repository
 * stay plain.
 */

export type AutolinkContext = {
  /** The agent's workspace's GitHub repository, `owner/name`. */
  repo?: string;
  /** The Linear workspace's address on linear.app (`linear.app/<urlKey>/…`). */
  linearWorkspace?: string;
  /** The Linear workspace's team keys, upper case. */
  teams?: ReadonlySet<string>;
};

export type Autolink = { start: number; end: number; href: string };

// Each mention starts where no word, path, URL or anchor goes on before it
// and ends where none goes on after it (`DE-7338.ts`, `#12/`, `#12a`).
const END = String.raw`(?![\w/-]|\.\w)`;
const QUALIFIED = new RegExp(String.raw`(?<![\w./@#-])([A-Za-z0-9][A-Za-z0-9-]{0,38}/[\w.-]{1,100})#(\d{1,7})` + END, "g");
const NAMED = new RegExp(String.raw`(?<![\w./@#-])(?:PRs?\s?#|[Pp]ull[ -][Rr]equests?\s?#?)(\d{1,7})` + END, "g");
const BARE = new RegExp(String.raw`(?<![\w./@#&:-])#(\d{1,7})` + END, "g");
const LINEAR = new RegExp(String.raw`(?<![\w./@#-])([A-Z][A-Z0-9]{0,9})-(\d{1,7})` + END, "g");

/** Words before a bare `#n` that make it something other than a pull request: "step #3", "colour #333". */
const NOT_PR =
  /\b(?:steps?|items?|options?|phases?|parts?|numbers?|no|nr|rank|round|attempt|lines?|rows?|columns?|issues?|tasks?|points?|pages?|chapters?|sections?|cases?|tests?|runs?|builds?|versions?|places?|levels?|slides?|fig(?:ure)?s?|tables?|questions?|answers?|todos?|bugs?|tickets?|players?|rooms?|seats?|days?|weeks?|colou?rs?|background|fill|stroke|border|hex)\.?\s*$/i;

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[\w.-]{1,100}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/** The mentions in a run of plain text, in order, none overlapping. */
export function autolinks(text: string, ctx: AutolinkContext): Autolink[] {
  const found: Autolink[] = [];
  const add = (start: number, end: number, href: string) => {
    if (found.some((f) => start < f.end && end > f.start)) return;
    found.push({ start, end, href });
  };
  const pr = (repo: string, n: string) => `https://github.com/${repo}/pull/${n}`;
  const number = (n: string) => !n.startsWith("0");
  if (text.includes("#")) {
    for (const m of text.matchAll(QUALIFIED))
      if (REPO.test(m[1]) && number(m[2])) add(m.index, m.index + m[0].length, pr(m[1], m[2]));
  }
  const repo = ctx.repo && REPO.test(ctx.repo) ? ctx.repo : undefined;
  if (repo) {
    for (const m of text.matchAll(NAMED)) if (number(m[1])) add(m.index, m.index + m[0].length, pr(repo, m[1]));
    if (text.includes("#"))
      for (const m of text.matchAll(BARE)) {
        if (!number(m[1])) continue;
        const before = text.slice(Math.max(0, m.index - 24), m.index);
        if (NOT_PR.test(before)) continue;
        // "the #1 priority": a small number after "the" is a rank, not a PR.
        if (/\bthe\s*$/i.test(before) && Number(m[1]) < 100) continue;
        add(m.index, m.index + m[0].length, pr(repo, m[1]));
      }
  }
  const slug = ctx.linearWorkspace && SLUG.test(ctx.linearWorkspace) ? ctx.linearWorkspace.toLowerCase() : undefined;
  if (slug && ctx.teams?.size) {
    for (const m of text.matchAll(LINEAR))
      if (ctx.teams.has(m[1]) && number(m[2])) add(m.index, m.index + m[0].length, `https://linear.app/${slug}/issue/${m[1]}-${m[2]}`);
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Whether there is anything to link with: a repository or Linear teams. */
export const canAutolink = (ctx: AutolinkContext | undefined): ctx is AutolinkContext =>
  !!ctx && (!!ctx.repo || (!!ctx.linearWorkspace && !!ctx.teams?.size));

// ── Markdown: a remark step over the conversation's text nodes ─────────────
type Node = { type: string; value?: string; url?: string; children?: Node[] };
/** Where nothing links itself: code, links and their references, raw HTML, images. */
const LEAVE = new Set(["code", "inlineCode", "link", "linkReference", "definition", "html", "image", "imageReference"]);

function walk(node: Node, ctx: AutolinkContext) {
  const kids = node.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (LEAVE.has(kid.type)) continue;
    if (kid.type !== "text") {
      walk(kid, ctx);
      continue;
    }
    const text = kid.value ?? "";
    const links = autolinks(text, ctx);
    if (!links.length) continue;
    const parts: Node[] = [];
    let at = 0;
    for (const l of links) {
      if (l.start > at) parts.push({ type: "text", value: text.slice(at, l.start) });
      parts.push({ type: "link", url: l.href, children: [{ type: "text", value: text.slice(l.start, l.end) }] });
      at = l.end;
    }
    if (at < text.length) parts.push({ type: "text", value: text.slice(at) });
    kids.splice(i, 1, ...parts);
    i += parts.length - 1;
  }
}

/** The remark plugin: `[remarkAutolink, ctx]`. */
export function remarkAutolink(ctx: AutolinkContext) {
  return (tree: Node) => walk(tree, ctx);
}

/** Plain text (a user's message) split into runs, mentions carrying their link; never inside `code`. */
export function autolinkRuns(text: string, ctx: AutolinkContext): { text: string; href?: string }[] {
  const runs: { text: string; href?: string }[] = [];
  const plain = (s: string) => {
    let at = 0;
    for (const l of autolinks(s, ctx)) {
      if (l.start > at) runs.push({ text: s.slice(at, l.start) });
      runs.push({ text: s.slice(l.start, l.end), href: l.href });
      at = l.end;
    }
    if (at < s.length) runs.push({ text: s.slice(at) });
  };
  let at = 0;
  for (const m of text.matchAll(/(`+)[^`]*?\1/g)) {
    plain(text.slice(at, m.index));
    runs.push({ text: m[0] });
    at = m.index + m[0].length;
  }
  plain(text.slice(at));
  return runs.filter((r) => r.text);
}
