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
