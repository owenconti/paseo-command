/** @-mentions in a GitHub comment (`CommentBox` in bits.tsx, `MentionField`): the word being typed after an `@` at the
 *  caret, the people it fits, and the text with one put in. Pure. */
import type { Person } from "./types";

/** A GitHub login: letters, digits and single hyphens, at most 39 characters. */
const PARTIAL = /^[A-Za-z0-9-]{0,39}$/;

/** The `@word` the caret is in (at its end), if it starts a word: where its `@` is, and what follows it so far. Not an
 *  e-mail address (`a@b`), not inside a code span or block. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (!PARTIAL.test(query)) return null;
  const prev = at > 0 ? before[at - 1]! : "";
  if (prev && !/[\s([{>"'*_~]/.test(prev)) return null;
  // In code: an odd number of backticks before it on its line, or inside a fenced block.
  const line = before.slice(before.lastIndexOf("\n") + 1, at);
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return null;
  if ((before.slice(0, at).match(/^\s*(```|~~~)/gm)?.length ?? 0) % 2 === 1) return null;
  return { start: at, query };
}

/** The people `query` fits, best first: logins starting with it, then a name's word starting with it, then logins
 *  holding it; at most `max`. An empty query lists the first `max` as they come. */
export function rankMentions(people: readonly Person[], query: string, max = 8): Person[] {
  const q = query.toLowerCase();
  if (!q) return people.slice(0, max);
  const score = (p: Person) => {
    const login = p.login.toLowerCase();
    if (login === q) return 0;
    if (login.startsWith(q)) return 1;
    if ((p.name ?? "").toLowerCase().split(/[\s.\-_]+/).some((w) => w.startsWith(q))) return 2;
    if (login.includes(q)) return 3;
    return -1;
  };
  return people
    .map((p, i) => ({ p, i, s: score(p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, max)
    .map((x) => x.p);
}

/** `text` with the mention at `start` (to `caret`) replaced by `@login ` (no extra space when one follows). */
export function insertMention(text: string, start: number, caret: number, login: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const insert = `@${login}${/^\s/.test(after) ? "" : " "}`;
  return { text: text.slice(0, start) + insert + after, caret: start + insert.length + (/^\s/.test(after) ? 1 : 0) };
}
