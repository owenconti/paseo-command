/**
 * HTML in a Markdown file (a README's `<p align="center">`, `<details>`,
 * `<kbd>`, `<br>`), for the Files viewer's preview: a rehype step over
 * react-markdown's tree that rebuilds an allowlist of elements from the raw
 * HTML it carries, so they render as the rest of the Markdown does (links and
 * images through the preview's own rules), and drops everything else.
 *
 * As `sanitizeGithubHtml` (`web/src/github/html.ts`), it reads leniently and
 * writes strictly: only listed elements and attributes are made, every
 * attribute value checked, text kept as text, and what it can't read left
 * out. Never made: scripts, styles, event handlers, frames, forms, embeds,
 * ids, classes or inline styles. A tag opened in one piece of raw HTML and
 * closed in another (`<details>`, Markdown, `</details>`) holds what's
 * between; one never closed ends with its parent.
 *
 * The same step names each heading's anchor as GitHub does (`data-anchor`,
 * never an `id`, which could clash with the page's) and marks elements with
 * the source line they start on (`data-line`), for the line in view.
 */
import { headingSlugger } from "./markdown";

type Props = Record<string, unknown>;
export type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Props;
  children?: HastNode[];
  position?: { start?: { line?: number } };
};

/** Elements made as they are. */
const ALLOWED = new Set(
  (
    "a abbr b bdi bdo blockquote br caption cite code dd del details dfn div dl dt em figcaption figure " +
    "h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp section small span " +
    "strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var wbr"
  ).split(" "),
);
/** Elements left out with all they hold. */
const DROPPED = new Set(
  (
    "script style template iframe frame frameset object embed applet noscript noembed noframes textarea select " +
    "option optgroup button form math svg title xmp plaintext video audio canvas dialog head"
  ).split(" "),
);
const VOID = new Set("br hr img wbr input meta link base source col area param track embed".split(" "));

const ALIGN = /^(?:left|right|center|justify)$/i;
const SIZE = /^\d{1,4}(?:px|%)?$/;
const COUNT = /^\d{1,3}$/;
const DIR = /^(?:ltr|rtl|auto)$/i;

/** An element's checked attributes, as hast properties. */
function propsOf(tag: string, attrs: Map<string, string | true>): Props {
  const out: Props = {};
  const text = (name: string, max = 2000) => {
    const v = attrs.get(name);
    return typeof v === "string" && v.length <= max ? v : undefined;
  };
  const title = text("title", 500);
  if (title) out.title = title;
  const dir = text("dir");
  if (dir && DIR.test(dir)) out.dir = dir.toLowerCase();
  const align = text("align");
  if (align && ALIGN.test(align) && /^(?:p|div|h[1-6]|img|td|th|tr|table|figure|section|caption)$/.test(tag)) out.align = align.toLowerCase();
  if (tag === "a") {
    // Checked where it's drawn, as a Markdown link's.
    const href = text("href");
    if (href) out.href = href.trim();
  }
  if (tag === "img") {
    // Checked where it's drawn, as a Markdown image's.
    const src = text("src");
    if (src) out.src = src.trim();
    const alt = text("alt", 500);
    if (alt !== undefined) out.alt = alt;
    for (const k of ["width", "height"]) {
      const v = text(k);
      if (v && SIZE.test(v)) out[k] = v;
    }
  }
  if (tag === "td" || tag === "th") {
    const colspan = text("colspan");
    const rowspan = text("rowspan");
    if (colspan && COUNT.test(colspan)) out.colSpan = Number(colspan);
    if (rowspan && COUNT.test(rowspan)) out.rowSpan = Number(rowspan);
  }
  if (tag === "details" && attrs.has("open")) out.open = true;
  if (tag === "ol") {
    const start = text("start");
    if (start && /^\d{1,6}$/.test(start)) out.start = Number(start);
  }
  return out;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", middot: "·", bull: "•", rarr: "→", larr: "←", times: "×" };
/** Entities in raw HTML's text and attribute values: the common named ones and numeric ones (others stay as written). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

type Token =
  | { kind: "text"; text: string }
  | { kind: "open"; tag: string; attrs: Map<string, string | true>; selfClosing: boolean }
  | { kind: "close"; tag: string };

const TAG = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[!?][^>]*>?|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Raw HTML as tags and text; comments, doctypes and processing instructions left out. */
export function tokenize(html: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    if (m.index > at) out.push({ kind: "text", text: decodeEntities(html.slice(at, m.index)) });
    at = m.index + m[0].length;
    if (m[1]) out.push({ kind: "close", tag: m[1].toLowerCase() });
    else if (m[2]) {
      const attrs = new Map<string, string | true>();
      ATTR.lastIndex = 0;
      for (let a = ATTR.exec(m[3] ?? ""); a; a = ATTR.exec(m[3] ?? "")) {
        const name = a[1]!.toLowerCase();
        if (attrs.has(name)) continue;
        const value = a[2] ?? a[3] ?? a[4];
        attrs.set(name, value === undefined ? true : decodeEntities(value));
      }
      out.push({ kind: "open", tag: m[2].toLowerCase(), attrs, selfClosing: !!m[4] });
    }
  }
  if (at < html.length) out.push({ kind: "text", text: decodeEntities(html.slice(at)) });
  return out;
}

/** Rebuilds one parent's children: its raw HTML made elements (or left out), the nodes between them inside those opened. */
function rebuild(parent: HastNode) {
  const kids = parent.children;
  if (!kids?.some((k) => k.type === "raw")) return;
  const root: HastNode = { type: "root", children: [] };
  const stack: HastNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  /** The dropped element being skipped, and how deep in it. */
  let dropping: { tag: string; depth: number } | undefined;
  for (const kid of kids) {
    if (kid.type !== "raw") {
      if (!dropping) top().children!.push(kid);
      continue;
    }
    for (const t of tokenize(kid.value ?? "")) {
      if (dropping) {
        if (t.kind === "open" && t.tag === dropping.tag && !t.selfClosing) dropping.depth++;
        else if (t.kind === "close" && t.tag === dropping.tag && --dropping.depth === 0) dropping = undefined;
        continue;
      }
      if (t.kind === "text") {
        if (t.text) top().children!.push({ type: "text", value: t.text });
      } else if (t.kind === "open") {
        if (DROPPED.has(t.tag)) {
          if (!t.selfClosing && !VOID.has(t.tag)) dropping = { tag: t.tag, depth: 1 };
          continue;
        }
        // Others (`<center>`, `<font>`, `<picture>`): left out, what they hold kept.
        if (!ALLOWED.has(t.tag)) continue;
        const el: HastNode = { type: "element", tagName: t.tag, properties: propsOf(t.tag, t.attrs), children: [] };
        if (kid.position) el.position = kid.position;
        top().children!.push(el);
        if (!t.selfClosing && !VOID.has(t.tag)) stack.push(el);
      } else {
        // Closes the nearest one open of its name, and any opened inside it.
        let at = stack.length - 1;
        while (at > 0 && stack[at]!.tagName !== t.tag) at--;
        if (at > 0) stack.length = at;
      }
    }
  }
  parent.children = root.children;
}

const textOf = (n: HastNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join(""));
const HEADING = /^h[1-6]$/;

/** The rehype step: raw HTML rebuilt, headings' anchors and elements' source lines marked. */
export function rehypeFilesMarkdown() {
  return (tree: HastNode) => {
    const slug = headingSlugger();
    const walk = (node: HastNode) => {
      rebuild(node);
      for (const kid of node.children ?? []) {
        if (kid.type !== "element") continue;
        kid.properties ??= {};
        const line = kid.position?.start?.line;
        if (line) kid.properties.dataLine = line;
        walk(kid);
        if (HEADING.test(kid.tagName ?? "")) kid.properties.dataAnchor = slug(textOf(kid));
      }
    };
    walk(tree);
  };
}
