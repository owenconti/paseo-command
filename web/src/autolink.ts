/**
 * Plain mentions in a conversation that link themselves: Linear issue keys
 * of the workspace's own teams (`DE-7338`), pull requests (`#7054`,
 * "PR #7054", "pull request 7054", `owner/repo#7054`) and paths to the
 * workspace's files (`docs/report.md`, `src/a.ts:12`, `a.ts#L3-L9`, an
 * absolute path inside its folder; inline code that is exactly one too),
 * which open in the Files tab. Only text is ever wrapped: what was written
 * stays as written, so it reads and copies the same. Never inside code
 * blocks, links or URLs; a key whose team isn't one of the workspace's
 * (UTF-8, ISO-8601, SHA-256), a PR without a known repository and a path
 * that isn't one of the workspace's files stay plain.
 */

export type AutolinkContext = {
  /** The agent's workspace's GitHub repository, `owner/name`. */
  repo?: string;
  /** The Linear workspace's address on linear.app (`linear.app/<urlKey>/…`). */
  linearWorkspace?: string;
  /** The Linear workspace's team keys, upper case. */
  teams?: ReadonlySet<string>;
  /** The workspace's files (the Files server's `files/all`), relative to its folder. */
  files?: WorkspaceFiles;
};

/** A workspace's files, as paths link to them: every path, and each file name that only one file has. */
export type WorkspaceFiles = {
  /** The workspace's folder, so absolute paths inside it link too. */
  root?: string;
  paths: ReadonlySet<string>;
  /** A file name (`index.ts`) → its one path; names that several files share are left out. */
  unique: ReadonlyMap<string, string>;
};

/** A path to one of the workspace's files, and the line (or lines) given with it. */
export type FileTarget = { path: string; line?: number; endLine?: number };

export type Autolink = { start: number; end: number; href: string; file?: FileTarget };

/** A file link's address: a fragment of the page's own, so it never leaves it (a click opens the Files tab). */
export const fileHref = (f: FileTarget) =>
  `#files:${encodeURI(f.path)}${f.line ? `:${f.line}${f.endLine ? `-${f.endLine}` : ""}` : ""}`;

/** The workspace's files from its path list (`root`: its folder). */
export function workspaceFiles(list: readonly string[], root?: string): WorkspaceFiles {
  const paths = new Set(list);
  const unique = new Map<string, string>();
  const shared = new Set<string>();
  for (const path of list) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (shared.has(name)) continue;
    if (unique.has(name)) {
      unique.delete(name);
      shared.add(name);
    } else unique.set(name, path);
  }
  return { ...(root ? { root: root.replace(/\/+$/, "") } : {}), paths, unique };
}

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

// A path: `/`-separated names (a leading dot, dots only between word characters, so a sentence's full stop
// stays out), perhaps absolute or `./`, then perhaps a line: `:12`, `:12:3`, `:12-20`, `#L12`, `#L12-L20`.
const NAME = String.raw`\.?[\w@+-]+(?:\.[\w@+-]+)*`;
const LINE = String.raw`(?::(\d{1,6})(?::\d{1,4})?(?:-(\d{1,6}))?|#L(\d{1,6})(?:-L?(\d{1,6}))?)`;
const PATH = new RegExp(
  String.raw`(?<![\w./@#:~%\\-])((?:\/|\.\/)?${NAME}(?:\/${NAME})*)${LINE}?(?![\w/@+\\-]|\.\w|:\d)`,
  "g",
);
const EXACT = new RegExp(String.raw`^((?:\/|\.\/)?${NAME}(?:\/${NAME})*)${LINE}?$`);

/**
 * The workspace's file a path names: relative to its folder (`./` aside), or
 * absolute inside it; a bare name (no slash) only when one file has it, and in
 * prose only with an extension (`index.ts`, not `Makefile`).
 */
function fileOf(raw: string, files: WorkspaceFiles, prose: boolean): string | undefined {
  let path = raw.startsWith("./") ? raw.slice(2) : raw;
  if (path.startsWith("/")) {
    const root = files.root;
    if (!root || !path.startsWith(`${root}/`)) return undefined;
    path = path.slice(root.length + 1);
  }
  if (!path || path.split("/").some((n) => n === "." || n === "..")) return undefined;
  // Written as a path (a folder in it, `./`, absolute): that file. A bare name: the one file with it.
  if (path.includes("/") || raw !== path) return files.paths.has(path) ? path : undefined;
  if (prose && !path.includes(".")) return undefined;
  return files.unique.get(path);
}

const lineOf = (n?: string) => (n && Number(n) > 0 ? Number(n) : undefined);
function targetOf(m: RegExpMatchArray, files: WorkspaceFiles, prose: boolean): FileTarget | undefined {
  const path = fileOf(m[1], files, prose);
  if (!path) return undefined;
  const line = lineOf(m[2] ?? m[4]);
  const end = lineOf(m[3] ?? m[5]);
  return { path, ...(line ? { line, ...(end && end > line ? { endLine: end } : {}) } : {}) };
}

/** Inline code that is exactly a path to one of the workspace's files (perhaps with a line). */
export function codeFile(code: string, ctx: AutolinkContext): FileTarget | undefined {
  const m = ctx.files && code.trim().match(EXACT);
  return m ? targetOf(m, ctx.files!, false) : undefined;
}

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[\w.-]{1,100}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/** The mentions in a run of plain text, in order, none overlapping. */
export function autolinks(text: string, ctx: AutolinkContext): Autolink[] {
  const found: Autolink[] = [];
  const add = (start: number, end: number, href: string, file?: FileTarget) => {
    if (found.some((f) => start < f.end && end > f.start)) return;
    found.push({ start, end, href, ...(file ? { file } : {}) });
  };
  const files = ctx.files;
  if (files?.paths.size && /\w\.\w|\//.test(text)) {
    for (const m of text.matchAll(PATH)) {
      const file = targetOf(m, files, true);
      if (file) add(m.index, m.index + m[0].length, fileHref(file), file);
    }
  }
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

/** Whether there is anything to link with: a repository, Linear teams or the workspace's files. */
export const canAutolink = (ctx: AutolinkContext | undefined): ctx is AutolinkContext =>
  !!ctx && (!!ctx.repo || (!!ctx.linearWorkspace && !!ctx.teams?.size) || !!ctx.files?.paths.size);

// ── Markdown: a remark step over the conversation's text nodes ─────────────
type Node = { type: string; value?: string; url?: string; children?: Node[]; data?: { hProperties?: Record<string, unknown> } };
/** Where nothing links itself: code, links and their references, raw HTML, images. */
const LEAVE = new Set(["code", "inlineCode", "link", "linkReference", "definition", "html", "image", "imageReference"]);

/** A link's node, a file link's carrying its target for the page (`data-file-path`, `-line`, `-end`). */
function linkNode(href: string, children: Node[], file?: FileTarget): Node {
  if (!file) return { type: "link", url: href, children };
  const hProperties: Record<string, unknown> = { dataFilePath: file.path, title: "Open in Files", className: ["file-link"] };
  if (file.line) hProperties.dataFileLine = String(file.line);
  if (file.endLine) hProperties.dataFileEnd = String(file.endLine);
  return { type: "link", url: href, children, data: { hProperties } };
}

function walk(node: Node, ctx: AutolinkContext) {
  const kids = node.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid.type === "inlineCode") {
      // Code that is exactly a path links, keeping its code look.
      const file = codeFile(kid.value ?? "", ctx);
      if (file) kids[i] = linkNode(fileHref(file), [kid], file);
      continue;
    }
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
      parts.push(linkNode(l.href, [{ type: "text", value: text.slice(l.start, l.end) }], l.file));
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

export type AutolinkRun = { text: string; href?: string; file?: FileTarget };

/** Plain text (a user's message) split into runs, mentions carrying their link; never inside `code`, unless it's exactly a file's path. */
export function autolinkRuns(text: string, ctx: AutolinkContext): AutolinkRun[] {
  const runs: AutolinkRun[] = [];
  const plain = (s: string) => {
    let at = 0;
    for (const l of autolinks(s, ctx)) {
      if (l.start > at) runs.push({ text: s.slice(at, l.start) });
      runs.push({ text: s.slice(l.start, l.end), href: l.href, ...(l.file ? { file: l.file } : {}) });
      at = l.end;
    }
    if (at < s.length) runs.push({ text: s.slice(at) });
  };
  let at = 0;
  for (const m of text.matchAll(/(`+)[^`]*?\1/g)) {
    plain(text.slice(at, m.index));
    const fence = m[1]!;
    const file = codeFile(m[0].slice(fence.length, -fence.length), ctx);
    if (file) runs.push({ text: fence }, { text: m[0].slice(fence.length, -fence.length), href: fileHref(file), file }, { text: fence });
    else runs.push({ text: m[0] });
    at = m.index + m[0].length;
  }
  plain(text.slice(at));
  return runs.filter((r) => r.text);
}
