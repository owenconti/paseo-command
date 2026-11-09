/**
 * The Dungeon Board's conversation, as pure logic: an agent's reply cut into
 * the dialogue box's pages, and what of its conversation the box speaks
 * (its latest reply, what it is doing now, a failure).
 */
import { agentReport, toolSummary, type Entry } from "../transcript";
import { extractImages } from "../imageSource";

/** How much a page holds: characters per line at the box's width, and lines. */
export type PageRoom = { perLine: number; lines: number };
export const PAGE_ROOM: PageRoom = { perLine: 80, lines: 5 };

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}\s/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/;
/** Sentence ends, as `replySentences` (asks/sentences.ts) splits them. */
const SENTENCE = /(?<=[.?!])\s+(?=[A-Z0-9"“'(*_`[])/;

type Kind = "code" | "heading" | "list" | "quote" | "table" | "text";
type Block = { kind: Kind; text: string };

function kindOf(lines: string[]): Kind {
  if (LIST_ITEM.test(lines[0]!)) return "list";
  if (lines.every((l) => /^ {0,3}>/.test(l))) return "quote";
  if (lines.length > 1 && lines.every((l) => l.includes("|")) && /^[\s|:-]+$/.test(lines[1]!)) return "table";
  return "text";
}

/** Markdown as blocks: fenced code whole, headings alone, the rest split at blank lines. */
function blocksOf(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) blocks.push({ kind: kindOf(run), text: run.join("\n") });
    run = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const close = new RegExp(`^ {0,3}${fence[1]![0] === "`" ? "`" : "~"}{${fence[1]!.length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j]!)) j++;
      const body = lines.slice(i + 1, j);
      blocks.push({ kind: "code", text: [line, ...body, j < lines.length ? lines[j]! : fence[1]!].join("\n") });
      i = j;
    } else if (!line.trim()) flush();
    else if (HEADING.test(line)) {
      flush();
      blocks.push({ kind: "heading", text: line });
    } else {
      // A list straight after a lead-in line ("**What changed**" then bullets) is a block of its own.
      if (LIST_ITEM.test(line) && run.length && !LIST_ITEM.test(run[0]!)) flush();
      run.push(line);
    }
  }
  flush();
  return blocks;
}

/** The lines a piece takes in the box: each source line wraps at `perLine`; code
 * blocks also take a line for their frame. */
export function linesOf(text: string, room: PageRoom = PAGE_ROOM) {
  const code = FENCE.test(text.split("\n")[0] ?? "");
  const body = code ? text.split("\n").slice(1, -1) : text.split("\n");
  return body.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / room.perLine)), code ? 1 : 0);
}

/** A run of words cut to pieces of at most `max` characters, at spaces where it can. */
function cutWords(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const space = rest.lastIndexOf(" ", max);
    const at = space > max / 2 ? space : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Pack pieces, in order, into groups that fit `fits`, joined by `join`. */
function pack(pieces: string[], join: string, fits: (text: string) => boolean): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const next = current ? `${current}${join}${piece}` : piece;
    if (current && !fits(next)) {
      out.push(current);
      current = piece;
    } else current = next;
  }
  if (current) out.push(current);
  return out;
}

/** A block too big for one page, cut into pieces that each fit one. */
function split(block: Block, room: PageRoom): string[] {
  const fits = (text: string) => linesOf(text, room) <= room.lines;
  if (fits(block.text) || block.kind === "heading" || block.kind === "table") return [block.text];
  const chars = room.perLine * room.lines;
  if (block.kind === "code") {
    const lines = block.text.split("\n");
    const open = lines[0]!;
    const close = lines.at(-1)!;
    const body = lines.slice(1, -1).flatMap((l) => (l.length > chars ? cutWords(l, chars) : [l]));
    return pack(body, "\n", (text) => fits(`${open}\n${text}\n${close}`)).map((text) => `${open}\n${text}\n${close}`);
  }
  if (block.kind === "list") {
    const items: string[] = [];
    for (const line of block.text.split("\n"))
      if (LIST_ITEM.test(line) || !items.length) items.push(line);
      else items[items.length - 1] += `\n${line}`;
    return pack(
      items.flatMap((item) => (fits(item) ? [item] : sentences(item, chars))),
      "\n",
      fits,
    );
  }
  if (block.kind === "quote") {
    const text = block.text.replace(/^ {0,3}> ?/gm, "");
    return pack(sentences(text, chars - 2), " ", (t) => fits(`> ${t}`)).map((t) => `> ${t}`);
  }
  return pack(sentences(block.text, chars), " ", fits);
}

/** A paragraph's sentences, each cut to `max` characters at most. */
function sentences(text: string, max: number) {
  return text
    .replace(/\s*\n\s*/g, " ")
    .split(SENTENCE)
    .flatMap((s) => cutWords(s, max));
}

/** A reply's pieces, in order: a paragraph's sentences and a list's items carry their block and how they join it again
 * (so a page can take as much of a block as fits), the rest whole (code cut between lines, quotes, tables, headings). */
type Piece = { text: string; block: number; join?: string; heading?: boolean };
function piecesOf(markdown: string, room: PageRoom): Piece[] {
  const chars = room.perLine * room.lines;
  const fits = (text: string) => linesOf(text, room) <= room.lines;
  return blocksOf(markdown.trim()).flatMap((b, block): Piece[] => {
    if (b.kind === "text") return sentences(b.text, chars).map((text) => ({ text, block, join: " " }));
    if (b.kind === "list") {
      const items: string[] = [];
      for (const line of b.text.split("\n"))
        if (LIST_ITEM.test(line) || !items.length) items.push(line);
        else items[items.length - 1] += `\n${line}`;
      // An item too long for a page goes in sentences, as a paragraph of its own.
      return items.flatMap((item, i) =>
        fits(item)
          ? [{ text: item, block, join: "\n" }]
          : sentences(item, chars).map((text) => ({ text, block: block + (i + 1) / (items.length + 1), join: " " })),
      );
    }
    return split(b, room).map((text) => ({ text, block, heading: b.kind === "heading" }));
  });
}

/**
 * A reply as the dialogue box's pages, each filled as far as it holds: paragraphs cut between sentences, lists between
 * items, long code between lines (each piece fenced again), tables kept whole (the box scrolls them). A heading never
 * ends a page when more follows it.
 */
export function pageReply(markdown: string, room: PageRoom = PAGE_ROOM): string[] {
  type Part = { text: string; block: number; heading?: boolean };
  const pages: string[] = [];
  let page: Part[] = [];
  // A blank line's half between blocks.
  const cost = (parts: Part[]) => parts.reduce((n, p, i) => n + linesOf(p.text, room) + (i ? 0.5 : 0), 0);
  const end = () => {
    // A heading goes on with what follows it.
    const carry = page.length > 1 && page.at(-1)!.heading ? page.pop()! : undefined;
    pages.push(page.map((p) => p.text).join("\n\n"));
    page = carry ? [carry] : [];
  };
  for (const piece of piecesOf(markdown, room)) {
    const last = page.at(-1);
    const joined: Part[] =
      last && piece.join && last.block === piece.block
        ? [...page.slice(0, -1), { ...last, text: `${last.text}${piece.join}${piece.text}` }]
        : [...page, { text: piece.text, block: piece.block, heading: piece.heading }];
    if (page.length && cost(joined) > room.lines) {
      end();
      page.push({ text: piece.text, block: piece.block, heading: piece.heading });
    } else page = joined;
  }
  if (page.length) pages.push(page.map((p) => p.text).join("\n\n"));
  return pages;
}

/** What the box speaks of an agent's conversation, from its newest end. */
export type Exchange = {
  /** Its reply since your last message (else its last reply before it, when `earlier`). */
  reply?: { text: string; id: string };
  /** The reply came before your last message: it hasn't answered that yet. */
  earlier?: boolean;
  /** Your last message, as you wrote it (images left out). */
  asked?: string;
  /** A failure reported since your last message. */
  failure?: string;
  /** What it is doing now, from its last step: a tool and its input, a thought, a to-do. */
  doing?: string;
};

const short = (text: string, max: number) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** A stable id for a reply without a message id: its length and a hash of its text. */
function textId(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `t${text.length}:${(h >>> 0).toString(36)}`;
}

/** Subagents' reports are tools and notices, not its own words. */
const isReport = (e: Entry) =>
  (e.kind === "tool" && /(^|__)agent_message$/.test(e.tool)) ||
  (e.kind === "event" && agentReport(e.text) !== null);

/** Read the conversation's newest end: the latest reply, your last message and what came after it. */
export function exchangeOf(entries: Entry[], sent?: string): Exchange {
  const out: Exchange = {};
  let afterUser = true;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === "user") {
      if (afterUser && !e.from) {
        out.asked = short(extractImages(e.text).text, 240);
        afterUser = false;
        // Its reply to it is found: nothing older matters.
        if (out.reply) break;
      }
      continue;
    }
    if (out.reply) continue;
    if (afterUser && !out.doing && !isReport(e)) {
      if (e.kind === "tool") {
        const name = toolSummary(e.tool, e.text).name;
        out.doing = e.text.trim() ? `${name} · ${short(e.text, 120)}` : name;
      } else if (e.kind === "thought" && e.text.trim()) out.doing = "Thinking";
      else if (e.kind === "todo") {
        const next = e.items.find((item) => !item.done);
        if (next) out.doing = short(next.text, 120);
      }
    }
    if (afterUser && !out.failure && e.kind === "event" && /error|fail/i.test(e.label))
      out.failure = e.text.trim() || e.label;
    if (e.kind === "assistant" && e.text.trim()) {
      out.reply = { text: e.text, id: e.messageId ?? textId(e.text) };
      if (!afterUser) {
        out.earlier = true;
        break;
      }
    }
  }
  // A message you just sent, before the timeline has it.
  if (sent?.trim()) {
    out.asked = short(extractImages(sent).text, 240);
    if (out.reply && !out.earlier) out.earlier = true;
    out.failure = undefined;
    out.doing = undefined;
  }
  return out;
}
