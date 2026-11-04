/**
 * The Files viewer's Markdown preview, the parts that need no page: which
 * files are Markdown, where a link or an image in one goes (resolved against
 * the file's folder, kept inside the workspace), the headings' anchors as
 * GitHub names them, and find over the rendered text.
 */
import { FIND_LIMIT, type FindOptions } from "../github/diffSearch";

/** The Markdown files the viewer renders (`.mdx` as plain Markdown), by extension. */
export const MARKDOWN_TYPES = ["md", "markdown", "mdx"] as const;
export type MarkdownType = (typeof MARKDOWN_TYPES)[number];

export function markdownType(path: string): MarkdownType | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return (MARKDOWN_TYPES as readonly string[]).includes(ext) ? (ext as MarkdownType) : undefined;
}

/** Where a link in a Markdown file goes. */
export type MarkdownLink =
  /** One of the workspace's files, maybe at a line (`#L12`, `#L12-L20`) or a heading (`#setup`). */
  | { kind: "file"; path: string; line?: number; endLine?: number; anchor?: string }
  /** One of its folders. */
  | { kind: "folder"; path: string }
  /** A heading in this file. */
  | { kind: "anchor"; id: string }
  /** The web (http, https) or mail: opened as links are. */
  | { kind: "web"; url: string }
  /** Nowhere: another scheme, outside the workspace, or unreadable. */
  | { kind: "none" };

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The folder a file is in ("" the root). */
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/**
 * A path in the workspace from a reference in `from`: relative to its folder,
 * or to the workspace's root when it starts with `/` (as GitHub reads them).
 * `.` and `..` are resolved; null when it leaves the workspace or can't be a
 * path (a NUL, a backslash). A trailing `/` (a folder) is dropped.
 */
export function resolvePath(from: string, ref: string): string | null {
  if (ref.includes("\0") || ref.includes("\\")) return null;
  const parts = ref.startsWith("/") ? [] : folderOf(from).split("/").filter(Boolean);
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LINES = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/;

/** Where `href`, in the Markdown file `from`, goes. */
export function resolveLink(from: string, href: string): MarkdownLink {
  const raw = href.trim().replace(/^<(.*)>$/, "$1");
  if (!raw) return { kind: "none" };
  if (raw.startsWith("#")) {
    const id = decode(raw.slice(1));
    return id ? { kind: "anchor", id } : { kind: "none" };
  }
  if (/^(?:https?:\/\/|mailto:)/i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.username || url.password) return { kind: "none" };
      return { kind: "web", url: url.href };
    } catch {
      return { kind: "none" };
    }
  }
  // Other schemes (javascript:, file:, data:…) and protocol-relative links go nowhere.
  if (SCHEME.test(raw) || raw.startsWith("//")) return { kind: "none" };
  const hash = raw.indexOf("#");
  const fragment = hash < 0 ? "" : decode(raw.slice(hash + 1));
  const ref = decode((hash < 0 ? raw : raw.slice(0, hash)).replace(/\?.*$/, ""));
  if (!ref) return fragment ? { kind: "anchor", id: fragment } : { kind: "none" };
  const path = resolvePath(from, ref);
  if (path === null) return { kind: "none" };
  if (!path || ref.endsWith("/")) return { kind: "folder", path };
  const lines = LINES.exec(fragment);
  if (lines) {
    const line = Number(lines[1]);
    const end = lines[2] ? Number(lines[2]) : undefined;
    if (line < 1) return { kind: "file", path };
    return { kind: "file", path, line, ...(end && end > line ? { endLine: end } : {}) };
  }
  return { kind: "file", path, ...(fragment ? { anchor: fragment } : {}) };
}

/** What a Markdown image may load. */
export type MarkdownImageSource =
  /** One of the workspace's raster images, through `GET /api/files/image`. */
  | { kind: "workspace"; path: string; name: string }
  /** An https image, through the page's bounded loader. */
  | { kind: "remote"; url: string; name: string }
  | { kind: "blocked"; name: string; reason: string };

/** The workspace's images the preview loads (the image route's). */
const RASTER = /\.(?:png|jpe?g|gif|webp)$/i;

const nameOf = (s: string) => decode(s.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() ?? "");

/** What an image's `src`, in the Markdown file `from`, loads: the workspace's raster images and https only. */
export function resolveImageSource(from: string, src: string): MarkdownImageSource {
  const raw = src.trim().replace(/^<(.*)>$/, "$1");
  const name = nameOf(raw) || "image";
  if (/^https:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.username || url.password) return { kind: "blocked", name, reason: "A link with a login" };
      return { kind: "remote", url: url.href, name };
    } catch {
      return { kind: "blocked", name, reason: "Not a link" };
    }
  }
  if (SCHEME.test(raw) || raw.startsWith("//")) return { kind: "blocked", name, reason: "Only https images and the workspace’s own load" };
  const path = raw ? resolvePath(from, decode(raw.replace(/[?#].*$/, ""))) : null;
  if (!path) return { kind: "blocked", name, reason: "Outside the workspace" };
  if (!RASTER.test(path)) return { kind: "blocked", name, reason: "Only PNG, JPEG, GIF and WebP images load" };
  return { kind: "workspace", path, name };
}

/**
 * Heading anchors as GitHub makes them: lower case, punctuation dropped,
 * spaces as hyphens, and a repeat numbered (`setup`, `setup-1`). One per
 * rendering, in the order the headings show.
 */
export function headingSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base);
    seen.set(base, (n ?? -1) + 1);
    return n === undefined ? base : `${base}-${n + 1}`;
  };
}

/** A match in rendered text: from `start` to `end` in the joined text (`TextMatches.text`). */
export type TextMatch = { start: number; end: number };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every match of the query in rendered text, given as its pieces (text nodes)
 * in order, each with the block it's in: a match may cross pieces within a
 * block (`some **bold** words`), never from one block into the next. Offsets
 * are into the pieces joined, blocks apart by a newline (`text`), with each
 * piece's start (`starts`) to map them back.
 */
export function findInPieces(
  pieces: { text: string; block: number }[],
  query: string,
  opts: FindOptions,
): { matches: TextMatch[]; capped: boolean; error?: string; starts: number[] } {
  const starts: number[] = [];
  let text = "";
  for (const [i, p] of pieces.entries()) {
    if (i > 0 && p.block !== pieces[i - 1]!.block) text += "\n";
    starts.push(text.length);
    text += p.text;
  }
  if (!query) return { matches: [], capped: false, starts };
  let re: RegExp;
  try {
    re = new RegExp(opts.regex ? query : escape(query), opts.caseSensitive ? "g" : "gi");
  } catch {
    return { matches: [], capped: false, error: "Invalid pattern", starts };
  }
  const matches: TextMatch[] = [];
  for (let hit = re.exec(text); hit; hit = re.exec(text)) {
    if (!hit[0].length) {
      re.lastIndex++;
      continue;
    }
    // Not across blocks.
    if (hit[0].includes("\n")) continue;
    if (matches.length >= FIND_LIMIT) return { matches, capped: true, starts };
    matches.push({ start: hit.index, end: hit.index + hit[0].length });
  }
  return { matches, capped: false, starts };
}

/** The piece and offset in it of a place in the joined text (`findInPieces`' `starts`). */
export function pieceAt(starts: number[], at: number, end = false): { piece: number; offset: number } {
  let lo = 0;
  let hi = starts.length - 1;
  // The last piece starting at or before `at` (for an end, before it: a match ending where the next piece starts ends in this one).
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (end ? starts[mid]! < at : starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return { piece: lo, offset: at - (starts[lo] ?? 0) };
}
