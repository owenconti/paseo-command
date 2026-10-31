/**
 * Slack's message text as one small document model the page renders
 * (`rich.tsx`): from Slack's rich text blocks where a message has them, else
 * parsed from its mrkdwn. Pure, so it's tested without a page.
 */
import { fromCodePoints } from "./emoji";
import type { SlackBlock, SlackMessage, SlackRichElement } from "./types";

export type Style = { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean };

export type Inline =
  | ({ t: "text"; text: string } & Style)
  | ({ t: "link"; url: string; label?: string } & Style)
  | ({ t: "user"; id: string } & Style)
  | ({ t: "channel"; id: string; name?: string } & Style)
  | ({ t: "usergroup"; id: string; name?: string } & Style)
  | { t: "broadcast"; range: string }
  | { t: "emoji"; name: string; unicode?: string; skin?: number }
  | { t: "date"; timestamp: number; format: string; fallback?: string; url?: string };

export type Block =
  | { t: "paragraph"; inlines: Inline[] }
  | { t: "quote"; inlines: Inline[] }
  | { t: "pre"; text: string }
  | { t: "list"; style: "bullet" | "ordered"; indent: number; offset: number; items: Inline[][] };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
/** Slack escapes &, < and > in mrkdwn. */
export const decodeEntities = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);

// ── mrkdwn ────────────────────────────────────────────────────────────

const MARKS: Record<string, keyof Style> = { "*": "bold", _: "italic", "~": "strike" };
const WORD = /[\p{L}\p{N}]/u;
const isWord = (c: string | undefined) => !!c && WORD.test(c);
const isSpace = (c: string | undefined) => !c || /\s/.test(c);

/** A `<…>` special: a link, a mention, a broadcast or a date. */
function special(body: string, style: Style): Inline {
  const [head, label] = splitOnce(body, "|");
  if (head.startsWith("@")) return { t: "user", id: head.slice(1), ...style };
  if (head.startsWith("#")) return { t: "channel", id: head.slice(1), ...(label ? { name: label } : {}), ...style };
  if (head.startsWith("!subteam^")) {
    return { t: "usergroup", id: head.slice("!subteam^".length), ...(label ? { name: label.replace(/^@/, "") } : {}), ...style };
  }
  if (head.startsWith("!date^")) {
    const [, ts, format = "{date}", url] = head.split("^");
    return {
      t: "date",
      timestamp: Number(ts),
      format,
      ...(label ? { fallback: decodeEntities(label) } : {}),
      ...(url ? { url } : {}),
    };
  }
  if (head.startsWith("!")) {
    const range = head.slice(1);
    if (range === "here" || range === "channel" || range === "everyone") return { t: "broadcast", range };
    return { t: "text", text: decodeEntities(label ?? `@${range}`), ...style };
  }
  const url = decodeEntities(head);
  return { t: "link", url, ...(label ? { label: decodeEntities(label) } : {}), ...style };
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const at = s.indexOf(sep);
  return at < 0 ? [s, undefined] : [s.slice(0, at), s.slice(at + 1)];
}

/** Where a style that opens at `i` closes, on the same line; -1 when it doesn't. */
function closing(s: string, i: number, mark: string): number {
  for (let k = i + 2; k < s.length; k++) {
    const c = s[k];
    if (c === "\n") return -1;
    if (c === "<") {
      // A special stays whole.
      const end = s.indexOf(">", k);
      if (end > 0) k = end;
      continue;
    }
    if (c === mark && !isSpace(s[k - 1]) && !isWord(s[k + 1])) return k;
  }
  return -1;
}

/** Text with mrkdwn's inline styles, specials, code and emoji, as inlines. */
export function parseInline(s: string, style: Style = {}): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    const last = out[out.length - 1];
    const text = decodeEntities(buf);
    // Neighbouring plain text joins.
    if (last?.t === "text" && sameStyle(last, style)) last.text += text;
    else out.push({ t: "text", text, ...style });
    buf = "";
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "<") {
      const end = s.indexOf(">", i + 1);
      if (end > i + 1 && !s.slice(i + 1, end).includes("\n")) {
        flush();
        out.push(special(s.slice(i + 1, end), style));
        i = end + 1;
        continue;
      }
    }
    if (c === "`" && !style.code) {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1 && !s.slice(i + 1, end).includes("\n")) {
        flush();
        out.push(...codeInlines(s.slice(i + 1, end), style));
        i = end + 1;
        continue;
      }
    }
    const mark = MARKS[c];
    if (mark && !style[mark] && !isWord(s[i - 1]) && !isSpace(s[i + 1]) && s[i + 1] !== c) {
      const end = closing(s, i, c);
      if (end > 0) {
        flush();
        out.push(...parseInline(s.slice(i + 1, end), { ...style, [mark]: true }));
        i = end + 1;
        continue;
      }
    }
    if (c === ":" && !isWord(s[i - 1])) {
      const m = /^:([a-z0-9_+'-]+):(?::skin-tone-([2-6]):)?/i.exec(s.slice(i));
      if (m) {
        flush();
        out.push({ t: "emoji", name: m[1].toLowerCase(), ...(m[2] ? { skin: Number(m[2]) } : {}) });
        i += m[0].length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Code is literal, but for links (shown as their address or label) and entities. */
function codeInlines(s: string, style: Style): Inline[] {
  const text = s.replace(/<([^<>|]+)(?:\|([^<>]*))?>/g, (_, head: string, label?: string) => label ?? head);
  return [{ t: "text", text: decodeEntities(text), ...style, code: true }];
}

const sameStyle = (a: Style, b: Style) =>
  !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && !!a.code === !!b.code;

/** A line of a quote: `>` or `&gt;`, with one following space dropped. */
const QUOTE = /^(?:>|&gt;)(?!>|&gt;) ?/;
const QUOTE_REST = /^(?:>>>|&gt;&gt;&gt;) ?/;

/** mrkdwn's lines as paragraphs and quotes (`>` lines, `>>>` quoting the rest). */
function textBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let para: string[] = [];
  let quote: string[] = [];
  const endPara = () => {
    const text = para.join("\n").replace(/^\n+|\n+$/g, "");
    if (text) blocks.push({ t: "paragraph", inlines: parseInline(text) });
    para = [];
  };
  const endQuote = () => {
    if (quote.length) blocks.push({ t: "quote", inlines: parseInline(quote.join("\n")) });
    quote = [];
  };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (QUOTE_REST.test(line)) {
      endPara();
      endQuote();
      quote = [line.replace(QUOTE_REST, ""), ...lines.slice(n + 1)];
      break;
    }
    if (QUOTE.test(line)) {
      endPara();
      quote.push(line.replace(QUOTE, ""));
    } else {
      endQuote();
      para.push(line);
    }
  }
  endPara();
  endQuote();
  return blocks.filter((b) => !(b.t === "paragraph" && b.inlines.every((i) => i.t === "text" && !i.text.trim())));
}

/**
 * mrkdwn as blocks: ``` fences as preformatted text (opened anywhere on a
 * line, as Slack allows), `>` and `>>>` as quotes, the rest as paragraphs of
 * styled text with `<…>` specials (links, mentions, broadcasts, dates),
 * `code`, `:emoji:` and Slack's escaped `&amp;`, `&lt;`, `&gt;`.
 */
export function parseMrkdwn(text: string): Block[] {
  const blocks: Block[] = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf("```");
    const close = open < 0 ? -1 : rest.indexOf("```", open + 3);
    if (close < 0) break;
    blocks.push(...textBlocks(rest.slice(0, open).replace(/\n$/, "")));
    const code = rest.slice(open + 3, close).replace(/^\n/, "").replace(/\n$/, "");
    blocks.push({ t: "pre", text: decodeEntities(code.replace(/<([^<>|]+)(?:\|([^<>]*))?>/g, (_, h: string, l?: string) => l ?? h)) });
    rest = rest.slice(close + 3).replace(/^\n/, "");
  }
  blocks.push(...textBlocks(rest));
  return blocks;
}

// ── Rich text blocks ─────────────────────────────────────────────────

function richStyle(el: SlackRichElement): Style {
  const s = el.style ?? {};
  return {
    ...(s.bold ? { bold: true } : {}),
    ...(s.italic ? { italic: true } : {}),
    ...(s.strike ? { strike: true } : {}),
    ...(s.code ? { code: true } : {}),
  };
}

/** One of rich text's inline elements. */
function richInline(el: SlackRichElement): Inline[] {
  const style = richStyle(el);
  switch (el.type) {
    case "text":
      return el.text ? [{ t: "text", text: el.text, ...style }] : [];
    case "link":
      return el.url ? [{ t: "link", url: el.url, ...(el.text ? { label: el.text } : {}), ...style }] : [];
    case "user":
      return el.user_id ? [{ t: "user", id: el.user_id, ...style }] : [];
    case "channel":
      return el.channel_id ? [{ t: "channel", id: el.channel_id, ...style }] : [];
    case "usergroup":
      return el.usergroup_id ? [{ t: "usergroup", id: el.usergroup_id, ...style }] : [];
    case "broadcast":
      return el.range ? [{ t: "broadcast", range: el.range }] : [];
    case "emoji": {
      if (!el.name) return [];
      const skin = (el as { skin_tone?: number }).skin_tone;
      return [{ t: "emoji", name: el.name, ...(el.unicode ? { unicode: el.unicode } : {}), ...(skin ? { skin } : {}) }];
    }
    case "date":
      return el.timestamp !== undefined
        ? [
            {
              t: "date",
              timestamp: el.timestamp,
              format: el.format ?? "{date}",
              ...(el.fallback ? { fallback: el.fallback } : {}),
              ...(el.url ? { url: el.url } : {}),
            },
          ]
        : [];
    case "color":
      return el.text ? [{ t: "text", text: el.text, ...style }] : [];
    default:
      return el.text ? [{ t: "text", text: el.text, ...style }] : [];
  }
}

const inlinesOf = (els: SlackRichElement[] = []) => els.flatMap(richInline);

/** A rich text block's elements as blocks. */
function richBlocks(elements: SlackRichElement[] = []): Block[] {
  const out: Block[] = [];
  for (const el of elements) {
    switch (el.type) {
      case "rich_text_section": {
        const inlines = inlinesOf(el.elements);
        if (inlines.length) out.push({ t: "paragraph", inlines });
        break;
      }
      case "rich_text_quote":
        out.push({ t: "quote", inlines: inlinesOf(el.elements) });
        break;
      case "rich_text_preformatted":
        out.push({
          t: "pre",
          text: (el.elements ?? []).map((e) => (e.type === "link" ? e.text || e.url || "" : e.text ?? "")).join(""),
        });
        break;
      case "rich_text_list":
        out.push({
          t: "list",
          // Slack names it `style`; the server passes it on as `list_style`.
          style: el.list_style ?? ((el as { style?: unknown }).style === "ordered" ? "ordered" : "bullet"),
          indent: el.indent ?? 0,
          offset: el.offset ?? 0,
          items: (el.elements ?? []).map((item) => inlinesOf(item.elements)),
        });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Whether these blocks say everything the message says (rich text, or mrkdwn sections), so `text` isn't needed. */
const richEnough = (blocks: SlackBlock[] | undefined) =>
  !!blocks?.length && blocks.some((b) => b.type === "rich_text" || (b.type === "section" && !!b.text?.text));

/**
 * A message's text as blocks: its rich text where it has some (and sections'
 * mrkdwn), else its mrkdwn `text` parsed.
 */
export function messageBlocks(message: Pick<SlackMessage, "text" | "blocks">): Block[] {
  if (!richEnough(message.blocks)) return parseMrkdwn(message.text ?? "");
  const out: Block[] = [];
  for (const block of message.blocks!) {
    if (block.type === "rich_text") out.push(...richBlocks(block.elements));
    else if (block.type === "section" && block.text?.text)
      out.push(...(block.text.type === "mrkdwn" ? parseMrkdwn(block.text.text) : [{ t: "paragraph" as const, inlines: [{ t: "text" as const, text: block.text.text }] }]));
  }
  return out;
}

// ── Dates ────────────────────────────────────────────────────────────

/**
 * Slack's `<!date>` format ("{date_short} at {time}") for a moment in the
 * page's time zone; the fallback when there's nothing to format.
 */
export function formatSlackDate(timestamp: number, format: string, fallback = "", now = new Date()): string {
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return fallback;
  const day = (opts: Intl.DateTimeFormatOptions) => date.toLocaleDateString(undefined, opts);
  const pretty = (plain: string) => {
    const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
    return days === 0 ? "today" : days === -1 ? "yesterday" : days === 1 ? "tomorrow" : plain;
  };
  const tokens: Record<string, () => string> = {
    date_num: () => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    date: () => day({ month: "long", day: "numeric", year: "numeric" }),
    date_short: () => day({ month: "short", day: "numeric", year: "numeric" }),
    date_long: () => day({ weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    date_pretty: () => pretty(day({ month: "long", day: "numeric", year: "numeric" })),
    date_short_pretty: () => pretty(day({ month: "short", day: "numeric", year: "numeric" })),
    date_long_pretty: () => pretty(day({ weekday: "long", month: "long", day: "numeric", year: "numeric" })),
    time: () => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    time_secs: () => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }),
    ago: () => agoText(date, now),
  };
  let known = false;
  const out = format.replace(/\{(\w+)\}/g, (m, token: string) => {
    const fn = tokens[token];
    if (!fn) return m;
    known = true;
    return fn();
  });
  return known ? out : fallback || out;
}
const pad = (n: number) => String(n).padStart(2, "0");
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function agoText(date: Date, now: Date): string {
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const [n, unit] =
    a < 60 ? [a, "second"] : a < 3600 ? [Math.round(a / 60), "minute"] : a < 86400 ? [Math.round(a / 3600), "hour"] : [Math.round(a / 86400), "day"];
  const words = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return future ? `in ${words}` : `${words} ago`;
}

// ── Plain text ───────────────────────────────────────────────────────

/** How plain text names what a message mentions. */
export type Names = {
  user: (id: string) => string | undefined;
  channel: (id: string) => string | undefined;
  emoji?: (name: string) => string | undefined;
};

function plainInline(i: Inline, names: Names): string {
  switch (i.t) {
    case "text":
      return i.text;
    case "link":
      return i.label && i.label !== i.url ? `${i.label} (${i.url})` : i.url.replace(/^mailto:/, "");
    case "user":
      return `@${names.user(i.id) ?? i.id}`;
    case "channel":
      return `#${i.name ?? names.channel(i.id) ?? i.id}`;
    case "usergroup":
      return `@${i.name ?? i.id}`;
    case "broadcast":
      return `@${i.range}`;
    case "emoji":
      return fromCodePoints(i.unicode) ?? names.emoji?.(i.name) ?? `:${i.name}:`;
    case "date":
      return formatSlackDate(i.timestamp, i.format, i.fallback);
  }
}

/** Blocks as plain text with names (for a prompt, a preview): quotes keep `> `, lists their marks. */
export function plainText(blocks: Block[], names: Names): string {
  const line = (inlines: Inline[]) => inlines.map((i) => plainInline(i, names)).join("");
  return blocks
    .map((b) => {
      switch (b.t) {
        case "paragraph":
          return line(b.inlines);
        case "quote":
          return line(b.inlines)
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
        case "pre":
          return `\`\`\`\n${b.text}\n\`\`\``;
        case "list":
          return b.items
            .map((item, n) => `${"  ".repeat(b.indent)}${b.style === "ordered" ? `${b.offset + n + 1}.` : "•"} ${line(item)}`)
            .join("\n");
      }
    })
    .join("\n")
    .trim();
}

// ── Markdown (for editing) ───────────────────────────────────────────

function markdownInline(i: Inline): string {
  switch (i.t) {
    case "text": {
      if (i.code) return `\`${i.text}\``;
      // Styles wrap the words, not the spaces round them.
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(i.text) ?? ["", "", i.text, ""];
      if (!core) return i.text;
      let s = core;
      if (i.italic) s = `_${s}_`;
      if (i.bold) s = `**${s}**`;
      if (i.strike) s = `~~${s}~~`;
      return `${lead}${s}${trail}`;
    }
    case "link":
      return i.label && i.label !== i.url ? `[${i.label}](${i.url})` : i.url;
    case "user":
      return `<@${i.id}>`;
    case "channel":
      return `<#${i.id}>`;
    case "usergroup":
      return `<!subteam^${i.id}>`;
    case "broadcast":
      return `<!${i.range}>`;
    case "emoji":
      return `:${i.name}:${i.skin ? `:skin-tone-${i.skin}:` : ""}`;
    case "date":
      return formatSlackDate(i.timestamp, i.format, i.fallback);
  }
}

/** Blocks as the Markdown the composer edits (and Slack's `markdown_text` takes back): mentions stay `<@U…>`. */
export function toMarkdown(blocks: Block[]): string {
  const line = (inlines: Inline[]) => inlines.map(markdownInline).join("");
  return blocks
    .map((b) => {
      switch (b.t) {
        case "paragraph":
          return line(b.inlines);
        case "quote":
          return line(b.inlines)
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
        case "pre":
          return `\`\`\`\n${b.text}\n\`\`\``;
        case "list":
          return b.items
            .map((item, n) => `${"  ".repeat(b.indent)}${b.style === "ordered" ? `${b.offset + n + 1}.` : "-"} ${line(item)}`)
            .join("\n");
      }
    })
    .join("\n")
    .trim();
}

/** A message's text as Markdown to edit. */
export const editableText = (message: Pick<SlackMessage, "text" | "blocks">) => toMarkdown(messageBlocks(message));
