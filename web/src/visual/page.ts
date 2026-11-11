/**
 * Visual replies: a page an agent writes in its reply as a fenced `html-render`
 * block, shown in the chat in a sandboxed frame (VisualBlock.tsx). This module
 * is the pure part: which fences are pages, the theme variables a page may use,
 * and the document the frame is given.
 *
 * The page is the agent's own HTML and scripts, so it is kept apart from the
 * app: the frame is sandboxed without `allow-same-origin` (an opaque origin: no
 * cookies, storage or parent access), and a Content-Security-Policy placed
 * ahead of the page's own markup lets it load only https resources, never the
 * app's loopback API. It talks to the app only through the few messages below.
 */

/** The fence language that makes a code block a page. */
export const VISUAL_LANG = "html-render";
export const isVisualLang = (lang: string | undefined) =>
  (lang ?? "").toLowerCase() === VISUAL_LANG;
/** A whole fenced block of it, as Markdown source (the dialogue's paging keeps it whole). */
export const VISUAL_FENCE = /^ {0,3}(?:`{3,}|~{3,})html-render(?:\s|$)/i;

/** A reply's prose without its pages' HTML, for a one-line preview of it. */
export const withoutPages = (text: string) =>
  text.replace(
    /^ {0,3}(`{3,}|~{3,})html-render[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gim,
    "",
  );

export const VISUAL_LIMITS = {
  /** Source size past which the block stays code. */
  source: 512_000,
  /** With local images inlined. */
  page: 25 * 1024 * 1024,
  minHeight: 60,
  /** The frame fits its page up to this height, then scrolls inside. */
  maxHeight: 4000,
  /** A page sized by the viewport can't be fitted: it gets this height and scrolls. */
  fixedHeight: 480,
  title: 120,
};

export type Appearance = "light" | "dark";
export type VisualTheme = {
  appearance: Appearance;
  variables: Record<string, string>;
};

const CHART = {
  light: ["#0d9488", "#d97706", "#9333ea", "#e11d48", "#65a30d"],
  dark: ["#2dd4bf", "#fbbf24", "#c084fc", "#fb7185", "#a3e635"],
};
/** Used where the place the block is drawn in doesn't define a token. */
const FALLBACK: Record<Appearance, Record<string, string>> = {
  light: {
    "--panel": "#fdfefe",
    "--panel-raised": "#ffffff",
    "--surface": "#ffffff",
    "--fill": "#f0f4f8",
    "--fill-strong": "#e9eef5",
    "--line-mid": "#e1e8f0",
    "--line-strong": "#d8e1ec",
    "--text": "#29394e",
    "--text-2": "#4c6079",
    "--text-3": "#586a7f",
    "--accent": "#3567e6",
    "--accent-bright": "#4678e8",
    "--accent-soft": "#edf3ff",
    "--accent-text": "#3a64c9",
    "--focus": "#3567e6",
    "--code-bg": "#f1f4f8",
    "--code-text": "#3f536d",
    "--green": "#25ae7e",
    "--green-text": "#1f7d59",
    "--amber": "#e5ad35",
    "--amber-text": "#8a6516",
    "--amber-soft": "#fff6e2",
    "--red": "#df6564",
    "--red-text": "#b0504e",
    "--red-soft": "#fdf0ee",
  },
  dark: {
    "--panel": "#172130",
    "--panel-raised": "#1c2738",
    "--surface": "#213045",
    "--fill": "#212e42",
    "--fill-strong": "#2a394f",
    "--line-mid": "#2a384c",
    "--line-strong": "#324259",
    "--text": "#e2e9f2",
    "--text-2": "#b6c3d5",
    "--text-3": "#8b9ab0",
    "--accent": "#3a6cec",
    "--accent-bright": "#5b88f2",
    "--accent-soft": "#1d2d4b",
    "--accent-text": "#93b3ff",
    "--focus": "#7097f6",
    "--code-bg": "#101824",
    "--code-text": "#c6d3e3",
    "--green": "#34c08c",
    "--green-text": "#63d3a7",
    "--amber": "#e9b54b",
    "--amber-text": "#f1c66e",
    "--amber-soft": "#302816",
    "--red": "#e8706e",
    "--red-text": "#f59e9a",
    "--red-soft": "#361f26",
  },
};
export const VISUAL_TOKENS = [
  ...Object.keys(FALLBACK.light),
  "--font-sans",
  "--font-mono",
];
const FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  mono: '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

/** No value may end the declaration or the sheet it is written into. */
const clean = (value: string) => value.replace(/[;{}<>]/g, "").trim();

/**
 * The variables a page is given, under the names T3 Code's visual replies use
 * (the shadcn vocabulary agents already know), from the app's own tokens as
 * they read where the block is drawn (`read` returns "" for one not set there).
 */
export function visualTheme(
  appearance: Appearance,
  read: (token: string) => string,
): VisualTheme {
  const t = (token: string) =>
    clean(read(token)) || FALLBACK[appearance][token] || "";
  const chart = CHART[appearance];
  return {
    appearance,
    variables: {
      "--background": t("--panel"),
      "--foreground": t("--text"),
      "--muted": t("--fill"),
      "--muted-foreground": t("--text-3"),
      "--card": t("--surface"),
      "--card-foreground": t("--text"),
      "--popover": t("--panel-raised"),
      "--popover-foreground": t("--text"),
      "--secondary": t("--fill-strong"),
      "--secondary-foreground": t("--text-2"),
      "--border": t("--line-mid"),
      "--input": t("--line-strong"),
      "--ring": t("--focus"),
      "--primary": t("--accent"),
      "--primary-foreground": "#ffffff",
      "--accent": t("--accent"),
      "--accent-foreground": "#ffffff",
      "--accent-surface": t("--accent-soft"),
      "--accent-surface-foreground": t("--accent-text"),
      "--destructive": t("--red"),
      "--destructive-foreground": t("--red-text"),
      "--destructive-surface": t("--red-soft"),
      "--warning": t("--amber"),
      "--warning-foreground": t("--amber-text"),
      "--warning-surface": t("--amber-soft"),
      "--success": t("--green"),
      "--success-foreground": t("--green-text"),
      "--info": t("--accent-bright"),
      "--info-foreground": t("--accent-text"),
      "--code-background": t("--code-bg"),
      "--code-foreground": t("--code-text"),
      "--chart-1": t("--accent"),
      ...Object.fromEntries(chart.map((c, i) => [`--chart-${i + 2}`, c])),
      "--radius": "8px",
      "--font-sans": clean(read("--font-sans")) || FONTS.sans,
      "--font-mono": clean(read("--font-mono")) || FONTS.mono,
    },
  };
}

function rootRule(theme: VisualTheme) {
  return `:root{color-scheme:${theme.appearance};${Object.entries(
    theme.variables,
  )
    .filter(([name]) => /^--[a-z0-9-]+$/.test(name))
    .map(([name, value]) => `${name}:${clean(value)};`)
    .join("")}}`;
}

const BASE_CSS =
  "html{box-sizing:border-box;padding:8px;background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}" +
  "html::-webkit-scrollbar{display:none}body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}" +
  ":where(:focus-visible){outline:2px solid var(--ring);outline-offset:-2px}";

/**
 * Only https resources (a CDN's script, a font, an image), inline code and
 * data: images. Nothing over plain http, so never the app's API on loopback;
 * no frames, forms or `<base>`. A page can add policies of its own but never
 * loosen this one.
 */
export const VISUAL_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'unsafe-inline' https:",
  "img-src data: blob: https:",
  "font-src data: https:",
  "media-src data: blob: https:",
  "connect-src https:",
  "worker-src blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const M = {
  theme: "paseo/theme",
  size: "paseo/size",
  link: "paseo/open-link",
  key: "paseo/key",
} as const;

/**
 * Runs first in the page: applies theme changes the app posts, reports the
 * page's height as it changes, hands web link clicks to the app (or, where
 * the frame may open tabs, `popups`, sends them to a new one), and hands back
 * the app's keys (⌘K, ⌘B, Esc) the page didn't use.
 */
const bootstrap = (popups: boolean) =>
  `(function(){var s=document.getElementById("paseo-theme"),b=${JSON.stringify(BASE_CSS)},up=window.parent!==window;` +
  `window.addEventListener("message",function(e){var d=e.data;if(e.source!==window.parent||!s||!d||d.type!==${JSON.stringify(M.theme)}||!d.variables||typeof d.variables!=="object")return;` +
  `var c=":root{color-scheme:"+(d.appearance==="light"?"light":"dark")+";";for(var k in d.variables)if(/^--[a-z0-9-]+$/.test(k))c+=k+":"+String(d.variables[k]).replace(/[;{}<>]/g,"")+";";s.textContent=c+"}"+b;});` +
  `document.addEventListener("click",function(e){var l=e.isTrusted?e.composedPath().find(function(t){return t&&t.matches&&t.matches("a[href]");}):null,u;if(!l)return;` +
  `try{u=new URL(l.getAttribute("href"),document.baseURI);}catch(x){return;}if(!/^https?:$/.test(u.protocol))return;` +
  (popups
    ? `l.setAttribute("target","_blank");l.setAttribute("rel","noopener noreferrer");`
    : `e.preventDefault();if(up)window.parent.postMessage({type:${JSON.stringify(M.link)},url:u.href},"*");`) +
  `},true);` +
  `if(!up)return;var h,o,z=function(){var r=document.documentElement,v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);if(v===h)return;h=v;window.parent.postMessage({type:${JSON.stringify(M.size)},height:v},"*");};` +
  `if(window.ResizeObserver){o=new ResizeObserver(z);o.observe(document.documentElement);}` +
  `document.addEventListener("DOMContentLoaded",function(){if(o&&document.body)o.observe(document.body);z();});window.addEventListener("load",z);` +
  // After the page's own handlers: the app's keys a focused frame would otherwise keep.
  `window.addEventListener("keydown",function(e){if(!e.isTrusted||e.defaultPrevented||e.isComposing)return;var k=e.key.toLowerCase(),m=(e.metaKey||e.ctrlKey)&&!e.shiftKey&&!e.altKey&&(k==="k"||k==="b");if(!m&&k!=="escape")return;if(m)e.preventDefault();` +
  `window.parent.postMessage({type:${JSON.stringify(M.key)},key:e.key,code:e.code,metaKey:e.metaKey,ctrlKey:e.ctrlKey},"*");});})();`;

/**
 * The document the frame loads. The policy, theme and bootstrap are the first
 * things in it, ahead of everything the agent wrote, wherever its own `<head>`
 * is: a policy applies only to what follows it, so a script placed before the
 * page's `<html>` must still come after ours. (The parser folds the page's own
 * `<html>` and `<head>` tags into the document this opens.)
 */
export function visualDocument(
  html: string,
  theme: VisualTheme,
  options: { popups?: boolean } = {},
): string {
  const body = html.replace(/^\uFEFF?\s*(?:<!doctype[^>]*>)?/i, "");
  return (
    '<!doctype html><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${VISUAL_CSP}">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style id="paseo-theme">${rootRule(theme)}${BASE_CSS}</style>` +
    `<script>${bootstrap(!!options.popups)}</script>` +
    body
  );
}

export const themeMessage = (theme: VisualTheme) => ({
  type: M.theme,
  appearance: theme.appearance,
  variables: theme.variables,
});

/** The page's height, from its size message. */
export function readSize(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { type, height } = data as Record<string, unknown>;
  return type === M.size &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
    ? height
    : undefined;
}

/** The web address a clicked link asks the app to open. */
export function readLink(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { type, url } = data as Record<string, unknown>;
  if (type !== M.link || typeof url !== "string" || url.length > 4096)
    return undefined;
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && !parsed.username
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** One of the app's keys, pressed in the page: ⌘/⌃ K or B, or Escape. */
export function readKey(
  data: unknown,
): { key: string; code: string; metaKey: boolean; ctrlKey: boolean } | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { type, key, code, metaKey, ctrlKey } = data as Record<string, unknown>;
  if (type !== M.key || typeof key !== "string") return undefined;
  const k = key.toLowerCase();
  const chord = (metaKey === true || ctrlKey === true) && (k === "k" || k === "b");
  if (!chord && k !== "escape") return undefined;
  return {
    key,
    code: typeof code === "string" ? code.slice(0, 32) : "",
    metaKey: chord && metaKey === true,
    ctrlKey: chord && ctrlKey === true,
  };
}

export function frameHeight(content: number | undefined, fixed: boolean) {
  if (fixed) return VISUAL_LIMITS.fixedHeight;
  if (content === undefined) return 160;
  return Math.min(
    VISUAL_LIMITS.maxHeight,
    Math.max(VISUAL_LIMITS.minHeight, Math.ceil(content)),
  );
}

const CSS_SOURCE =
  /<!--[\s\S]*?(?:-->|$)|<style\b[^>]*(?:>|$)([\s\S]*?)(?:<\/style\s*>|$)|\sstyle\s*=\s*(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\s>]+))/gi;
const VIEWPORT_HEIGHT = /(?<![\w.+/])(?:\d+(?:\.\d+)?|\.\d+)[sld]?vh(?![\w-])/i;
/**
 * Whether the page's CSS sizes something by the viewport's height. A frame
 * that grows to fit such a page makes it grow again, so it gets a fixed height.
 */
export function usesViewportHeight(html: string) {
  for (const [, sheet, double, single, bare] of html.matchAll(CSS_SOURCE))
    if (VIEWPORT_HEIGHT.test(sheet ?? double ?? single ?? bare ?? ""))
      return true;
  return false;
}

/** The page's own `<title>`, as the block's name. */
export function titleOf(html: string) {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "";
  const text = raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > VISUAL_LIMITS.title
    ? `${text.slice(0, VISUAL_LIMITS.title - 1)}…`
    : text;
}

const IMAGE_EXT = "png|jpe?g|gif|webp";
const LOCAL_IMAGE = new RegExp(
  String.raw`(["'\x60])(/(?!/)(?:(?!\1)[^\r\n]){0,2048}?\.(?:${IMAGE_EXT}))\1` +
    String.raw`|url\(\s*(/(?!/)[^\s"'\x60()]{0,2048}?\.(?:${IMAGE_EXT}))\s*\)`,
  "gid",
);
export type LocalImage = { start: number; end: number; path: string };
/** Absolute paths to image files the page names (quoted, or in a CSS `url()`). */
export function findLocalImages(html: string): LocalImage[] {
  return Array.from(html.matchAll(LOCAL_IMAGE)).flatMap((match) => {
    const span = match.indices?.[2] ?? match.indices?.[3];
    return span
      ? [{ start: span[0], end: span[1], path: html.slice(span[0], span[1]) }]
      : [];
  });
}
/** The page with each found path that has a data: URL replaced by it. */
export function inlineImages(
  html: string,
  images: LocalImage[],
  urls: ReadonlyMap<string, string>,
) {
  const parts: string[] = [];
  let at = 0;
  for (const image of images) {
    const url = urls.get(image.path);
    if (url === undefined) continue;
    parts.push(html.slice(at, image.start), url);
    at = image.end;
  }
  parts.push(html.slice(at));
  return parts.join("");
}

/** Whether a streamed fenced block has its closing fence yet (`raw` is the block's Markdown). */
export function fenceClosed(raw: string) {
  const lines = raw.trimEnd().split("\n"),
    fence = lines[0]?.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
  return (
    !!fence &&
    lines.length > 1 &&
    new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines.at(-1)!)
  );
}
