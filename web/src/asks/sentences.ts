/**
 * A reply's sentences, as candidates for the questions it asks: code finds
 * them, a decision model judges which ask the user something.
 */

/** The reply's prose split into sentences and list items, without code
 *  blocks or Markdown marks; the last `max` of them. */
export function replySentences(reply: string, max = 40): string[] {
  const prose = reply.replace(/```[\s\S]*?(```|$)/g, "\n");
  const out: string[] = [];
  for (const block of prose.split(/\n\s*\n/)) {
    // A list item or heading stands alone; other lines join into a paragraph.
    const lines: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (/^([-*+]|\d+[.)]|#{1,6})\s/.test(line) || !lines.length) lines.push(line);
      else lines[lines.length - 1] += ` ${line}`;
    }
    for (const line of lines)
      for (const s of line
        .replace(/^([-*+]|\d+[.)]|#{1,6})\s+/, "")
        .split(/(?<=[.?!])\s+(?=[A-Z0-9"“'(*_`[])/)) {
        const text = plain(s);
        if (text.split(/\s+/).length >= 3 && text.length <= 400) out.push(text);
      }
  }
  return out.slice(-max);
}

/** Phrasings that ask the user something without a question mark. */
const REQUEST =
  /\b(let me know|tell me|please|confirm|approve|i need (you|your)|you('ll| will)? need to|can you|could you|would you|do you want|shall i|should i|whether you|your call|up to you|if you('d| would) (like|prefer|rather))\b/i;

/** Whether a sentence can ask the user anything: a question, or a request
 *  ("Let me know which file you meant."). Statements, however much they
 *  lead into a question, never do; only these go to the decision model. */
export function mayAsk(sentence: string): boolean {
  return /\?["'”’)\]]*$/.test(sentence) || REQUEST.test(sentence);
}

/** Markdown emphasis, code and link marks removed. */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Readings of the options a question names ("per-host or global"): its
 *  last alternatives, with the first taken at each length up to five
 *  words, for a decision model to pick between; none when it names none. */
export function optionReadings(question: string): string[][] {
  const body = question.replace(/[?.!:]+\s*$/, "").replace(/^.*:\s+/, "");
  const parts = body
    .split(/,\s*(?:or\s+)?|\s+or\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return [];
  const rest = parts.slice(1);
  if (rest.some((p) => p.split(/\s+/).length > 6)) return [];
  const head = parts[0].split(/\s+/);
  const readings: string[][] = [];
  for (let k = 1; k <= Math.min(5, head.length); k++)
    readings.push([head.slice(-k).join(" "), ...rest]);
  return readings;
}

/** "Should I", "do you want me to" and the like, before an alternative. */
const LEAD =
  /^(?:(?:or|and|so|then)\s+)?(?:(?:should|shall|can|could|may|would|do)\s+(?:i|we)|(?:do|would)\s+you\s+(?:want|like|prefer)\s+(?:me|us)\s+to|(?:would|do)\s+you\s+(?:rather|prefer)\s+(?:i|we)|you(?:'d| would)\s+rather\s+(?:i|we)|want\s+me\s+to)\s+/i;
/** "do you want …", with what's wanted after it. */
const WANT =
  /^(?:(?:or|and|so)\s+)?(?:(?:do|would)\s+you\s+(?:want|like|prefer)|you(?:'d| would)\s+(?:like|prefer))\s+/i;
/** A question opening that leaves its alternatives unclear ("Is it A, or B?"). */
const ASKING =
  /^(?:is|are|was|were|should|shall|can|could|would|will|do|does|did|have|has|which|what|how|where|when|who|why)\b/i;
/** Done things, as the thing to do ("the fixtures deleted first"). */
const BASE: Record<string, string> = Object.fromEntries(
  (
    "deleted delete,removed remove,merged merge,fixed fix,pushed push,reverted revert,updated update,added add," +
    "renamed rename,moved move,kept keep,done do,cleaned clean,rebased rebase,squashed squash,dropped drop," +
    "split split,tested test,committed commit,closed close,reset reset,changed change,rewritten rewrite," +
    "written write,deployed deploy,released release,archived archive,restored restore,replaced replace," +
    "refactored refactor,reviewed review,landed land,shipped ship,run run,finished finish,handled handle," +
    "stashed stash,undone undo,cherry-picked cherry-pick,regenerated regenerate,published publish"
  )
    .split(",")
    .map((pair) => pair.split(" ")),
);
const NOT_AN_OPTION = /^(?:not|no|something else|anything else|what|otherwise|vice versa|neither|both)$/i;

/** One alternative as the user would reply with it: "do you want the
 *  fixtures deleted first" becomes "Delete the fixtures first". */
function asReply(part: string): string | undefined {
  let p = part.trim();
  const led = LEAD.test(p);
  p = p.replace(LEAD, "");
  if (!led && WANT.test(p)) {
    const words = p.replace(WANT, "").split(/\s+/);
    const at = words.findIndex((w, i) => i > 0 && BASE[w.toLowerCase()]);
    p =
      at > 0
        ? [BASE[words[at].toLowerCase()], ...words.slice(0, at), ...words.slice(at + 1)].join(" ")
        : words.join(" ");
  } else p = p.replace(/^(?:or|and)\s+/i, "");
  p = p.replace(/^just\s+/i, "Just ").replace(/[,;:\s]+$/, "");
  const words = p.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 12 || NOT_AN_OPTION.test(p)) return undefined;
  return p[0].toUpperCase() + p.slice(1);
}

/** The two alternatives of a clear "A, or B?" question ("Should I push the
 *  branch, or do you want the fixtures deleted first?"), phrased as replies;
 *  none when it isn't one. */
export function pickOptions(question: string): string[] {
  if (!/\?["'”’)\]]*$/.test(question)) return [];
  const body = question.replace(/[?"'”’)\]\s]+$/, "").replace(/^.*:\s+/, "");
  // The alternatives are whole clauses: split at ", or", or at "or" before
  // another lead-in ("…or should I…", "…or do you want…").
  const parts = body.split(
    /,\s*or\s+|\s+or\s+(?=(?:should|shall|would|do|can|could)\s+(?:i|we|you)\b|just\b|you(?:'d| would)\b)/i,
  );
  if (parts.length !== 2) return [];
  const [first, second] = parts;
  // "Use Redis, Memcached, or a map?" is a list; its readings serve it.
  if (!LEAD.test(first) && (ASKING.test(first) || first.includes(","))) return [];
  if (LEAD.test(first) && first.replace(LEAD, "").includes(",")) return [];
  const options = [asReply(first), asReply(/^(?:or\s+)/i.test(second) ? second : `or ${second}`)];
  if (options.some((o) => !o) || options[0]!.toLowerCase() === options[1]!.toLowerCase()) return [];
  return options as string[];
}
