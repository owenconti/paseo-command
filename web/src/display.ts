/*
 * Readable names for the Paseo UI, independent of components and rendering. Labels never show opaque identifiers (hex agent IDs,
 * commit hashes, UUIDs): they show a Linear issue key when there is one, and
 * a readable title.
 */

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A UUID anywhere in the text, even fused onto other letters. */
const UUID = new RegExp(UUID_SOURCE, "gi");
/**
 * Opaque identifiers, wherever they sit (fused onto words or not):
 * - any UUID;
 * - any run of 7+ hex characters with at least one digit and at least one
 *   letter a–f (hashes, short agent IDs: `agentc87cd9a`). Words never have a
 *   digit in them, so "Facade", "Decade", "Accede" and "Beef" stay words;
 * - 8+ hex letters standing alone (`deadbeef`, `cafebabe`): no English word
 *   is spelt with a–f alone at that length;
 * - 10+ digits in a row (timestamps, numeric IDs).
 */
const OPAQUE = new RegExp(
  `${UUID_SOURCE}|(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}|(?<![0-9a-z])[a-f]{8,}(?![0-9a-z])|\\d{10,}`,
  "gi",
);
/**
 * Characters that are invisible but can split an ID on screen
 * (`c8​7cd9a`): zero-width space, word joiner, BOM, soft hyphen,
 * Mongolian vowel separator, and joiners between two ASCII letters or digits
 * (which never shape anything there; emoji and Indic joiners are kept).
 */
const INVISIBLE = /[​⁠﻿­᠎]|(?<=[0-9a-z])[‌‍](?=[0-9a-z])/gi;

/** Escape text for use inside a regular expression. */
export const escapeRegExp = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Ids = readonly (string | null | undefined)[];
/*
 * Every agent's ID and short ID in the fleet, removed from every label
 * wherever they appear (one agent's title can name another). Set from the
 * fleet data (see main.tsx). They are matched exactly, with a trie built
 * once per change of the set, so only the ID's own characters go: "node"
 * fused to an ID stays "node". Labels re-render when the set changes (see
 * `knownIdsRevision`).
 */
type Trie = { next: Map<string, Trie>; end: boolean };
const trieOf = (ids: Iterable<string>): Trie => {
  const root: Trie = { next: new Map(), end: false };
  for (const id of ids) {
    let node = root;
    for (const ch of id) {
      let n = node.next.get(ch);
      if (!n) node.next.set(ch, (n = { next: new Map(), end: false }));
      node = n;
    }
    node.end = true;
  }
  return root;
};
const usable = (ids: Iterable<string | null | undefined>) =>
  [
    ...new Set(
      [...ids]
        .filter((id): id is string => !!id && id.length >= 4)
        .map((id) => id.toLowerCase()),
    ),
  ].sort();
let knownKey = "";
let knownTrie: Trie | null = null;
let revision = 0;
const listeners = new Set<() => void>();
/** Set the fleet's IDs. Only a change of the set publishes a new revision. */
export function setKnownIds(ids: Iterable<string | null | undefined>) {
  const list = usable(ids);
  const key = list.join("\n");
  if (key === knownKey) return;
  knownKey = key;
  knownTrie = list.length ? trieOf(list) : null;
  revision++;
  listeners.forEach((l) => l());
}
/** Changes whenever the known IDs do: a dependency of every label's text. */
export const knownIdsRevision = () => revision;
export function onKnownIds(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/** ASCII-only lower case, one character for one (IDs are ASCII). */
const lowerAscii = (ch: string) =>
  ch >= "A" && ch <= "Z" ? String.fromCharCode(ch.charCodeAt(0) + 32) : ch;
/** Replace every exact match of an ID in the tries (longest wins) with the cut mark. */
function cutExact(text: string, tries: Trie[]): string {
  if (!tries.length) return text;
  let out = "";
  for (let i = 0; i < text.length;) {
    let longest = 0;
    for (const root of tries) {
      let node: Trie | undefined = root;
      for (let j = i; j < text.length; j++) {
        node = node.next.get(lowerAscii(text[j]));
        if (!node) break;
        if (node.end) longest = Math.max(longest, j + 1 - i);
      }
    }
    if (longest) {
      out += CUT;
      i += longest;
    } else out += text[i++];
  }
  return out;
}
const CUT = "\u0000";
/**
 * The text with each ID replaced by a cut mark, in order: complete UUIDs,
 * then exact known IDs (longest first), then the generic patterns.
 */
function cutIds(text: string, ids: Ids = []): string {
  let out = text.replace(INVISIBLE, "").replace(UUID, CUT);
  const own = usable(ids);
  out = cutExact(out, [
    ...(knownTrie ? [knownTrie] : []),
    ...(own.length ? [trieOf(own)] : []),
  ]);
  OPAQUE.lastIndex = 0;
  return out.replace(OPAQUE, CUT);
}

/** Whether the text contains an opaque identifier (or one of `ids`). */
export function hasOpaqueId(text: string, ids?: Ids): boolean {
  return cutIds(text, ids) !== text.replace(INVISIBLE, "");
}
/** The text without its opaque identifiers (and the punctuation they leave). */
function scrub(text: string, ids?: Ids): string {
  // Removing one ID can join its neighbours into another: repeat until clean.
  let out = scrubOnce(text, ids);
  for (let i = 0; i < 4 && hasOpaqueId(out, ids); i++)
    out = scrubOnce(out, ids);
  return hasOpaqueId(out, ids) ? "" : out;
}
function scrubOnce(text: string, ids?: Ids): string {
  return (
    cutIds(text, ids)
      // With the separators that joined it on: "session_c87cd9a" → "session".
      .replace(/[_\-/.]*\u0000[_\-/.]*/g, " ")
      .replace(/\s+([,.;:!?)\]])/g, "$1")
      .replace(/([([])\s+/g, "$1")
      .replace(/\(\s*\)|\[\s*\]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s,;:.\-–—]+|[\s,;:\-–—]+$/g, "")
      .trim()
  );
}
/** `text` without the issue key `key` (and the separator after it). */
const withoutKey = (text: string, key: string) =>
  text
    .replace(new RegExp(`\\s*\\b${escapeRegExp(key)}\\b[:\\s-]*`, "i"), " ")
    .trim();

/*
 * Linear keys. A team key is 2–5 letters (Linear allows a trailing digit, as
 * in WEB2), then a dash and the issue number. Technical tokens of the same
 * shape (model names, encodings, standards, versions) are not teams.
 */
const NOT_TEAMS = new Set(
  (
    "gpt utf ucs iso sha md rfc ipv cve es ecma http https tls ssl html css " +
    "rgb rgba srgb argb hsl mp aac mpeg h av win macos ios node py php go " +
    "gpu cpu tpu llama qwen opus haiku grok gemma phi mistr glm sol " +
    "pr mr step phase part round pass try take test page ver rev day week " +
    "top x86 arm amd base utc gmt"
  ).split(" "),
);
const KEY = /^([a-z]{2,5}\d?)-(\d{1,6})$/i;
function asKey(team: string, number: string): string | null {
  if (NOT_TEAMS.has(team.toLowerCase()) || !/[1-9]/.test(number)) return null;
  return `${team.toUpperCase()}-${number}`;
}

/** Kind prefixes branches often start with before their name. */
const KINDS =
  /^(?:feature|feat|fix|bugfix|hotfix|chore|refactor|docs|test|perf|ci|build|release|wip)$/i;

/**
 * The Linear key a branch was made for, upper-cased. Linear names branches
 * `de-7394-let-authors-link` (optionally under `user/` or `feature/`), so the
 * key must open a path segment; anything else (`gpt-6-support`,
 * `fix/utf-8-encoding`, `v2-1`) is not an issue branch.
 */
export function branchKey(branch: string | undefined | null): string | null {
  if (!branch) return null;
  for (const segment of branch.trim().split("/")) {
    if (!segment) continue;
    const m = /^([a-z]{2,5}\d?)-(\d{1,6})(?=$|[-_.])/i.exec(segment);
    if (m) {
      const key = asKey(m[1], m[2]);
      if (key) return key;
    }
  }
  return null;
}

/**
 * The Linear key named in free text ("Ship DE-7376", "fix(web): WEB2-9
 * crash"). In prose a key is written upper-case, as Linear shows it; a lone
 * key (the whole text, or a command's argument) may be any case. Every
 * candidate is tried, so a technical token before the key doesn't hide it.
 */
export function textKey(text: string | undefined | null): string | null {
  if (!text) return null;
  const t = text.replace(UUID, " ").trim();
  if (KEY.test(t)) {
    const [, team, number] = KEY.exec(t)!;
    return asKey(team, number);
  }
  const re = /(?:^|[\s([:,])([A-Z]{2,5}\d?)-(\d{1,6})(?=$|[\s.,:;!?)\]])/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const key = asKey(m[1], m[2]);
    if (key) return key;
  }
  return null;
}

/** A key from a branch name (or, failing that, a title), upper-cased. */
export function issueKey(text: string | undefined | null): string | null {
  return branchKey(text) ?? textKey(text);
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * A branch as words: `owen/de-7394-let-authors-link` → "Let authors link".
 * Kind prefixes, user prefixes, the issue key and opaque IDs are dropped.
 */
export function branchTitle(branch: string): string {
  const segments = branch.trim().split("/").filter(Boolean);
  // The segment the key opens, else the last: `user/kind/name` → name.
  const key = branchKey(branch);
  let rest =
    (key && segments.find((s) => s.toUpperCase().startsWith(key))) ||
    segments.filter((s) => !KINDS.test(s)).pop() ||
    "";
  rest = rest.replace(
    /^(?:feature|feat|fix|bugfix|hotfix|chore|refactor|docs|wip)[_-]+/i,
    "",
  );
  if (key && rest.toUpperCase().startsWith(key))
    rest = rest.slice(key.length).replace(/^[-_.]+/, "");
  return capitalise(scrub(scrub(rest).replace(/[-_]+/g, " ")));
}

/** Leading phrases that make a title read like a prompt. */
const PROMPT_LEADS = [
  /^(?:please|pls),?\s+/i,
  /^(?:can|could|would|will) you(?: please)?\s+/i,
  /^i(?:'d| would)? (?:like|want|need) (?:you )?to\s+/i,
  /^i want (?:you )?\s*/i,
  /^help me(?: to)?\s+/i,
  /^let'?s\s+/i,
  /^you are\s+(?:an?\s+|the\s+)?/i,
  /^i am\s+/i,
  /^i'm\s+/i,
  /^we need to\s+/i,
  /^hey,?\s+/i,
];
/** Whether a title is really the first words of a prompt rather than a name. */
export function looksLikePrompt(title: string): boolean {
  const t = title.trim();
  return (
    t.length > 48 ||
    /\n/.test(t) ||
    /^\/\S/.test(t) ||
    /\?$/.test(t) ||
    PROMPT_LEADS.some((re) => re.test(t)) ||
    /^(?:how|what|why|when|where|which|who|does|do|is|are|can|should)\b/i.test(
      t,
    )
  );
}

/** User-perceived characters, so a cut never splits an emoji or an accent. */
function graphemes(text: string): string[] {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg)
    return Array.from(
      new Seg(undefined, { granularity: "grapheme" }).segment(text),
      (s) => s.segment,
    );
  return Array.from(text);
}
/** Cut on a word boundary to at most `max` characters, with an ellipsis. */
function clip(text: string, max: number) {
  const g = graphemes(text);
  if (g.length <= max) return text;
  const cut = g.slice(0, max - 1).join("");
  // Already on a word boundary: keep the whole last word.
  if (g[max - 1] === " ") return `${cut.replace(/[\s,;:.-]+$/, "")}…`;
  const space = cut.lastIndexOf(" ");
  const keep = space > 0 && graphemes(cut.slice(0, space)).length > max * 0.5;
  return `${(keep ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** "tests" → "test", for a subject used as a modifier ("PEST test analysis"). */
const singular = (word: string) =>
  /[^su]s$/i.test(word) && word.length > 3 ? word.slice(0, -1) : word;

/**
 * Requests that name their subject: "do a thorough analysis of our PEST
 * tests" is a "PEST test analysis"; "rebuild ONLY THE PIECES of the Laravel
 * Data" is about Laravel Data.
 */
function subjectOf(request: string): string {
  const study =
    /^(?:do|perform|run|make|write|give me|carry out)\s+(?:an?\s+|the\s+)?(?:(?:very|really|quick|full|complete|deep|thorough|detailed|careful|comprehensive|proper|in-depth)\s+)*(analysis|review|audit|investigation|assessment|breakdown|overview|comparison|cleanup|clean-up|refactor|pass|sweep)\s+(?:of|on|for|into|over)\s+(?:(?:our|the|my|this|these|those|all|all of|all the|every)\s+)*(.+)$/i.exec(
      request,
    );
  if (study) {
    const words = study[2].trim().split(" ");
    words[words.length - 1] = singular(words[words.length - 1]);
    return `${words.join(" ")} ${study[1].toLowerCase()}`;
  }
  // "rebuild only the pieces of X" / "fix some of the X": the X matters.
  return request.replace(
    /^(\w+)\s+(?:only\s+|just\s+)?(?:the\s+|some\s+|all\s+)?(?:pieces|parts|bits|rest|remainder|some|all)\s+of\s+(?:the\s+|our\s+|my\s+)?/i,
    "$1 ",
  );
}

/** A title (after cleanup) that says nothing on its own. */
const EMPTY_WORDS =
  /^(?:please|agent|task|fix|do|run|check|look at|see|for|the|a|an|it|this|that|ok|okay)?$/i;

/**
 * A short title from an agent's name. Names that are just the start of a
 * prompt are trimmed to their first clause, without filler, and shortened.
 * Opaque IDs are never part of a title; a name that is only an ID is "".
 */
export function shortTitle(name: string, max = 34, ids?: Ids): string {
  const raw = name.replace(/\s+/g, " ").trim();
  let t = scrub(raw, ids);
  // Nothing left but a word like "Please" or "Fix" once the ID is gone.
  if (!t || (t !== raw && EMPTY_WORDS.test(t.replace(/[^\w\s']/g, "").trim())))
    return "";
  if (/^\/\S/.test(t)) {
    // A slash command. With a request after it ("/goal I need you to…"),
    // title the request; otherwise the command itself ("/fix-gh-checks" →
    // "Fix gh checks"; "/ship-issue DE-7304" → "Ship issue", the key shown apart).
    const [command, ...rest] = t.slice(1).split(" ");
    const args = rest.join(" ").trim();
    const request =
      args.split(" ").length >= 5 || PROMPT_LEADS.some((re) => re.test(args));
    // (Only the key itself, "/ship-issue DE-7304", isn't a request.)
    if (request && textKey(args)?.toLowerCase() !== args.toLowerCase())
      return shortTitle(args, max, ids);
    return clip(capitalise(command.replace(/[-_:]+/g, " ")), max);
  }
  if (looksLikePrompt(t)) {
    // First clause only, then drop the conversational lead-in.
    t = t.split(/(?<=[.!?;:])\s|\s[—–-]\s|\n/)[0].replace(/[.!?;:]+$/, "");
    for (const re of PROMPT_LEADS) t = t.replace(re, "");
    t = subjectOf(t.replace(/^(?:an?|the)\s+/i, ""));
  }
  t = t.trim();
  if (EMPTY_WORDS.test(t)) return "";
  return clip(capitalise(t), max);
}

export type AgentLike = {
  id?: string | null;
  shortId?: string | null;
  name?: string | null;
  /** The workspace title set in the Paseo app, if any. */
  title?: string | null;
  provider?: string | null;
  branch?: string | null;
};
export type AgentDisplay = {
  /** Linear issue key from the branch or title, if any. */
  key: string | null;
  /** A readable title; never an opaque ID. */
  title: string;
};

/** The last line of defence: a shown string with an ID in it loses the ID. */
function safe(text: string, fallback: string, ids?: Ids): string {
  if (!hasOpaqueId(text, ids)) return text;
  return scrub(text, ids) || fallback;
}
/**
 * Any shown text (a name, a message, a host label) without opaque IDs: the
 * fleet's known IDs, `ids` (e.g. the subject's own), and the generic
 * patterns. `fallback` if nothing readable is left.
 */
export function cleanText(
  text: string | null | undefined,
  ids?: Ids,
  fallback = "",
): string {
  try {
    return safe(String(text ?? "").trim(), fallback, ids) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * How to name an agent on a sign: its Linear key (from its workspace's
 * branch, else its own branch, else its title) and a short readable title
 * (its own, else its branch's, else its provider).
 */
export function agentLabel(
  agent: AgentLike,
  branch?: string | null,
): AgentDisplay {
  try {
    return label(agent, branch);
  } catch {
    // A label must never take the app down: an odd title degrades to the mark.
    return { key: null, title: providerMark(agent.provider) };
  }
}
function label(agent: AgentLike, branch?: string | null): AgentDisplay {
  const ids = [agent.id, agent.shortId];
  const name = agent.name ?? "";
  const branches = [branch, agent.branch].filter((b): b is string => !!b);
  const key =
    branches.map(branchKey).find(Boolean) ??
    textKey(agent.title) ??
    textKey(name.replace(/^\/\S+\s*/, "")) ??
    null;
  let title = shortTitle(name, 34, ids);
  // A title that is only the key repeats nothing useful; fall back to the branch.
  if (!title || (key && title.toUpperCase() === key))
    title =
      branches
        .map((b) => clip(safe(branchTitle(b), "", ids), 34))
        .find(Boolean) ?? "";
  if (key && title) title = withoutKey(title, key) || title;
  const mark = providerMark(agent.provider);
  return { key, title: safe(capitalise(title), mark, ids) || mark };
}

/** A provider's fallback label: CLAUDE, CODEX, OPENCODE… */
export function providerMark(provider?: string | null): string {
  const p = String(provider ?? "")
    .split("/")[0]
    .trim();
  return p && !hasOpaqueId(p) && /^[\p{L}\p{N} ._-]{1,16}$/u.test(p)
    ? p.toUpperCase()
    : "AGENT";
}

/**
 * How to name a workspace's branch: an issue branch shows its
 * key and a readable title; any other branch is already a name and is kept.
 * A branch that is only a hash (a detached checkout) falls back to `name`.
 */
export function branchLabel(branch: string, name = ""): AgentDisplay {
  try {
    return branchSign(String(branch ?? ""), String(name ?? ""));
  } catch {
    return { key: null, title: "Workspace" };
  }
}
function branchSign(branch: string, name: string): AgentDisplay {
  const key = branchKey(branch);
  const fallback = shortTitle(name, 48) || "Workspace";
  if (key)
    return { key, title: safe(clip(branchTitle(branch), 48), "") || fallback };
  if (!branch.trim()) {
    // An unnamed branch: the workspace's own name, which may name the issue.
    const named = textKey(name);
    const rest = named ? withoutKey(fallback, named) : "";
    return named
      ? { key: named, title: rest || fallback }
      : { key: null, title: fallback };
  }
  return {
    key: null,
    title: hasOpaqueId(branch) ? fallback : clip(branch, 48),
  };
}

/** A project's or machine's readable name: as named, without IDs. */
export function placeName(
  name: string | undefined | null,
  fallback = "",
): string {
  try {
    return safe(String(name ?? "").trim(), fallback) || fallback;
  } catch {
    return fallback;
  }
}
