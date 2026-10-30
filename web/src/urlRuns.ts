/** A web address in plain text, up to whitespace or a closing bracket or quote. */
const URL = /https?:\/\/[^\s<>"'`)\]]+/gi;
/** Sentence punctuation that ends a URL rather than belongs to it. */
const TRAILING = /[.,;:!?]+$/;

export type Run = { text: string; href?: string };

/** Plain text split into runs, the web addresses in it carrying their link. */
export function urlRuns(text: string): Run[] {
  const runs: Run[] = [];
  let at = 0;
  for (const match of text.matchAll(URL)) {
    const href = match[0].replace(TRAILING, "");
    const start = match.index;
    if (start > at) runs.push({ text: text.slice(at, start) });
    runs.push({ text: href, href });
    at = start + href.length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}
