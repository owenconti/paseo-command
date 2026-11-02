/*
 * GitHub's own rendering of a body (GraphQL `bodyHTML`), cleaned again before
 * the page draws it. GitHub sanitizes it already; this is a second, stricter
 * allowlist that needs no DOM, so the server's tests run it as the page does.
 *
 * It reads the HTML leniently and writes it strictly: only listed elements and
 * attributes are written, every attribute value and stray `<` re-escaped, and
 * every element it opens closed, so whatever it misreads comes out as text.
 * Never written: scripts, styles, event handlers, iframes, forms, embeds,
 * `javascript:` and other non-web URLs, ids outside GitHub's `user-content-`.
 * Comments (`<!-- overview-comment -->`) are dropped, as GitHub hides them.
 */

/** Elements written as they are. */
const ALLOWED = new Set(
  (
    "a abbr b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure " +
    "h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p picture pre q rp rt ruby s samp section small source span " +
    "strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var wbr svg path"
  ).split(" "),
);
/** Elements dropped with all they hold. */
const DROPPED = new Set(
  (
    "script style template iframe frame frameset object embed applet noscript noembed noframes textarea select " +
    "option optgroup button form math title xmp plaintext video audio canvas dialog foreignobject head meta link base"
  ).split(" "),
);
/** Elements whose content the HTML parser takes as raw text, to its end tag. */
const RAW_TEXT = new Set("script style textarea title xmp iframe noembed noframes noscript plaintext".split(" "));
const VOID = new Set("br col hr img input source wbr".split(" "));
/** Dropped elements that have no content or end tag. */
const DROPPED_VOID = new Set("meta link base embed frame param track area keygen".split(" "));
/** What a GitHub element is written as. */
const RENAMED: Record<string, string> = { "g-emoji": "span" };

const ALIGN = /^(?:left|right|center|justify)$/i;
const VALIGN = /^(?:top|middle|bottom|baseline)$/i;
const SIZE = /^\d{1,4}(?:px|%)?$/;
const COUNT = /^\d{1,4}$/;
const DIR = /^(?:ltr|rtl|auto)$/i;
/** Only GitHub's own classes: its highlighting, alerts, icons, task lists and footnotes, never the app's. */
const CLASS =
  /^(?:pl-[a-z0-9]{1,4}|highlight(?:-[a-z0-9-]+)?|notranslate|markdown-alert(?:-[a-z]+)?|octicon(?:-[a-z0-9-]+)?|task-list-item(?:-checkbox)?|contains-task-list|footnotes|sr-only|data-footnote-backref|user-mention|team-mention|issue-link|commit-link|emoji|g-emoji|mr-2|color-fg-[a-z]+|anchor)$/;
/** Images load only from GitHub (camo, its uploads and assets), never another site. */
const IMAGE = /^https:\/\/(?:[a-z0-9-]+\.)*(?:githubusercontent\.com|github\.com|githubassets\.com)\/[^\s]*$/i;
const LINK = /^(?:https?:\/\/|mailto:)[^\s]*$/i;
const ANCHOR = /^#user-content-[\w-]{1,200}$/;
const ID = /^user-content-[\w-]{1,200}$/;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  colon: ":",
  tab: "\t",
  newline: "\n",
  sol: "/",
  num: "#",
  lpar: "(",
  rpar: ")",
  period: ".",
  comma: ",",
};
/** An attribute's value as the browser reads it (the entities it knows; others stay as written). */
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (all, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
    }
    return NAMED[ref.toLowerCase()] ?? all;
  });
}
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (s: string) => s.replace(/&(?!(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A URL as it would be followed: no whitespace or control characters, which browsers skip. */
const url = (value: string) => decode(value).replace(/[\u0000- \u007f-\u009f]/g, "");

type Attrs = [name: string, value: string][];

/** The attributes kept for an element, checked and in order. */
function clean(tag: string, attrs: Attrs): Attrs {
  const out: Attrs = [];
  const seen = new Set<string>();
  const put = (name: string, value: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push([name, value]);
  };
  for (const [name, raw] of attrs) {
    const value = decode(raw).trim();
    switch (name) {
      case "title":
      case "alt":
      case "aria-label":
        if (name !== "alt" || tag === "img") put(name, value.slice(0, 500));
        break;
      case "lang":
        if (/^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i.test(value)) put(name, value);
        break;
      case "dir":
        if (DIR.test(value)) put(name, value.toLowerCase());
        break;
      case "align":
        if (ALIGN.test(value)) put(name, value.toLowerCase());
        break;
      case "valign":
        if (VALIGN.test(value) && (tag === "td" || tag === "th" || tag === "tr")) put(name, value.toLowerCase());
        break;
      case "width":
      case "height":
        if (SIZE.test(value) && ["img", "td", "th", "table", "col", "svg", "source"].includes(tag)) put(name, value);
        break;
      case "colspan":
      case "rowspan":
        if (COUNT.test(value) && (tag === "td" || tag === "th")) put(name, value);
        break;
      case "span":
        if (COUNT.test(value) && (tag === "col" || tag === "colgroup")) put(name, value);
        break;
      case "start":
        if (tag === "ol" && /^-?\d{1,9}$/.test(value)) put(name, value);
        break;
      case "type":
        if (tag === "ol" && /^[1aAiI]$/.test(value)) put(name, value);
        if (tag === "input" && value.toLowerCase() === "checkbox") put(name, "checkbox");
        if (tag === "source" && /^image\/[a-z0-9.+-]+$/i.test(value)) put(name, value);
        break;
      case "value":
        if (tag === "li" && /^-?\d{1,9}$/.test(value)) put(name, value);
        break;
      case "checked":
        if (tag === "input") put(name, "");
        break;
      case "open":
        if (tag === "details") put(name, "");
        break;
      case "class": {
        const classes = value.split(/\s+/).filter((c) => CLASS.test(c));
        if (classes.length) put(name, classes.join(" "));
        break;
      }
      case "id":
        if (ID.test(value)) put(name, value);
        break;
      case "href": {
        const href = url(raw);
        if (tag === "a" && (LINK.test(href) || ANCHOR.test(href))) put(name, href);
        break;
      }
      case "src": {
        const src = url(raw);
        if (tag === "img" && IMAGE.test(src)) put(name, src);
        break;
      }
      case "srcset": {
        if (tag !== "source") break;
        const parts = decode(raw)
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        const ok = parts.length > 0 && parts.every((p) => IMAGE.test(p.split(/\s+/)[0] ?? "") && /^\S+(?:\s+\d+(?:\.\d+)?[wx])?$/.test(p));
        if (ok) put(name, parts.join(", "));
        break;
      }
      case "media":
        if (tag === "source" && /^\(prefers-color-scheme:\s*(?:light|dark)\)$/i.test(value)) put(name, value);
        break;
      case "aria-hidden":
        if (value === "true") put(name, "true");
        break;
      case "viewbox":
        if (tag === "svg" && /^[\d.\s-]{1,40}$/.test(value)) put("viewBox", value);
        break;
      case "d":
        if (tag === "path" && /^[MmLlHhVvCcSsQqTtAaZz\d.,\s-]{1,4000}$/.test(value)) put(name, value);
        break;
      case "fill-rule":
        if (tag === "path" && /^(?:evenodd|nonzero)$/.test(value)) put(name, value);
        break;
    }
  }
  if (tag === "a" && seen.has("href")) {
    const href = out.find(([n]) => n === "href")![1];
    if (!href.startsWith("#")) out.push(["target", "_blank"], ["rel", "noopener noreferrer nofollow"]);
  }
  if (tag === "img") out.push(["loading", "lazy"], ["decoding", "async"], ["referrerpolicy", "no-referrer"]);
  if (tag === "input") out.push(["disabled", ""]);
  return out;
}

/** The headings sit under the page's own: h1 → h3 … h6, as the Markdown renderer draws them. */
const HEADING = /^h([1-6])$/;

function open(tag: string, attrs: Attrs): string {
  const heading = HEADING.exec(tag);
  const name = heading ? `h${Math.min(Number(heading[1]) + 2, 6)}` : tag;
  // The app's own classes, which GitHub's can't name: its heading sizes and task boxes.
  const own = heading ? `md-h${heading[1]}` : tag === "input" ? "md-task" : "";
  const all: Attrs = own ? [...attrs.filter(([n]) => n !== "class"), ["class", own]] : attrs;
  return `<${name}${all.map(([n, v]) => (v === "" && n !== "alt" ? ` ${n}` : ` ${n}="${escapeAttr(v)}"`)).join("")}>`;
}
const close = (tag: string) => {
  const heading = HEADING.exec(tag);
  return `</${heading ? `h${Math.min(Number(heading[1]) + 2, 6)}` : tag}>`;
};

type Tag = { name: string; attrs: Attrs; end: boolean; selfClosing: boolean; next: number };

/** Reads a tag at `<`; null when what follows isn't one (it's text). */
function readTag(html: string, at: number): Tag | null {
  let i = at + 1;
  const end = html[i] === "/";
  if (end) i++;
  const m = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(i, i + 64));
  if (!m) return null;
  const name = m[0].toLowerCase();
  i += m[0].length;
  const attrs: Attrs = [];
  let selfClosing = false;
  while (i < html.length) {
    while (i < html.length && /[\s/]/.test(html[i]!)) {
      if (html[i] === "/" && html[i + 1] === ">") selfClosing = true;
      i++;
    }
    if (i >= html.length) break;
    if (html[i] === ">") return { name, attrs, end, selfClosing, next: i + 1 };
    const an = /^[^\s/>"'=][^\s/>"'=]*/.exec(html.slice(i, i + 256));
    if (!an) {
      i++;
      continue;
    }
    i += an[0].length;
    let value = "";
    let j = i;
    while (j < html.length && /\s/.test(html[j]!)) j++;
    if (html[j] === "=") {
      j++;
      while (j < html.length && /\s/.test(html[j]!)) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const stop = html.indexOf(q, j + 1);
        value = html.slice(j + 1, stop < 0 ? html.length : stop);
        i = stop < 0 ? html.length : stop + 1;
      } else {
        const v = /^[^\s>]*/.exec(html.slice(j))![0];
        value = v;
        i = j + v.length;
      }
    }
    attrs.push([an[0].toLowerCase(), value]);
  }
  // A tag never closed: the rest isn't markup.
  return { name, attrs, end, selfClosing, next: html.length };
}

/** At most this much of GitHub's HTML is drawn; past it the body falls back to its Markdown. */
export const HTML_MAX = 400_000;

/** GitHub's HTML for a body, cleaned to the allowlist; "" when there's none. */
export function sanitizeGithubHtml(html: string): string {
  if (!html || html.length > HTML_MAX) return "";
  let out = "";
  /** What's open, as written (an element left out isn't here). */
  const stack: string[] = [];
  /** Inside a dropped element: its name and how deep. */
  let dropping: { name: string; depth: number } | null = null;
  let svg = 0;
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    const text = html.slice(i, lt < 0 ? html.length : lt);
    if (text && !dropping && !svg) out += escapeText(text);
    if (lt < 0) break;
    i = lt;
    if (html.startsWith("<!--", i)) {
      const stop = html.indexOf("-->", i + 4);
      i = stop < 0 ? html.length : stop + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const stop = html.indexOf(">", i);
      i = stop < 0 ? html.length : stop + 1;
      continue;
    }
    const tag = readTag(html, i);
    if (!tag) {
      if (!dropping && !svg) out += "&lt;";
      i++;
      continue;
    }
    i = tag.next;
    const name = RENAMED[tag.name] ?? tag.name;
    if (dropping) {
      if (tag.name === dropping.name) {
        if (tag.end) dropping.depth--;
        else if (!tag.selfClosing) dropping.depth++;
        if (dropping.depth === 0) dropping = null;
      }
      continue;
    }
    if (!tag.end && RAW_TEXT.has(tag.name)) {
      // To its end tag, whatever is in between.
      const stop = lower.indexOf(`</${tag.name}`, i);
      i = stop < 0 ? html.length : html.indexOf(">", stop) + 1 || html.length;
      continue;
    }
    if (DROPPED.has(tag.name)) {
      if (!tag.end && !tag.selfClosing && !DROPPED_VOID.has(tag.name)) dropping = { name: tag.name, depth: 1 };
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    // Inside an icon only its paths; an icon only where GitHub puts one, never svg in svg.
    if (svg && name !== "path" && name !== "svg") continue;
    if (!svg && name === "path") continue;
    if (tag.end) {
      const at = stack.lastIndexOf(name);
      if (at < 0) continue;
      while (stack.length > at) {
        const top = stack.pop()!;
        if (top === "svg") svg--;
        out += close(top);
        if (top === "table") out += "</div>";
      }
      continue;
    }
    if (name === "svg" && svg) continue;
    const attrs = clean(name, tag.attrs);
    if (name === "img" && !attrs.some(([n]) => n === "src")) {
      // An image from elsewhere: its words instead.
      const alt = attrs.find(([n]) => n === "alt")?.[1];
      if (alt) out += escapeText(alt);
      continue;
    }
    if (name === "source" && !attrs.some(([n]) => n === "srcset")) continue;
    if (name === "table") out += '<div class="md-table" tabindex="0" role="region" aria-label="Table">';
    out += open(name, attrs);
    if (VOID.has(name)) continue;
    if (name === "path") {
      out += "</path>";
      continue;
    }
    if (tag.selfClosing) {
      out += close(name);
      if (name === "table") out += "</div>";
      continue;
    }
    if (name === "svg") svg++;
    stack.push(name);
  }
  while (stack.length) {
    const top = stack.pop()!;
    out += close(top);
    if (top === "table") out += "</div>";
  }
  return out;
}
