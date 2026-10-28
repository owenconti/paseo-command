/** One row of the command palette. */
export type Command = {
  id: string;
  label: string;
  /** The section it is listed under ("Actions", "Agents", …). */
  group: string;
  /** Muted text after the label (where an agent or workspace is). */
  detail?: string;
  /** The keys that do the same, as the shortcuts dialog shows them. */
  keys?: string[][];
  /** Other words it answers to. */
  keywords?: string;
  /** Listed only for a search (agents, workspaces, projects, hosts). */
  searchOnly?: boolean;
  run: () => void;
};

/** Results shown at most: past this, the user narrows the search. */
export const MAX_RESULTS = 60;

/** Whether `needle`'s letters appear in order in `hay` ("nwag" in "new agent"). */
const subsequence = (needle: string, hay: string) => {
  let i = 0;
  for (const ch of hay)
    if (ch === needle[i] && ++i === needle.length) return true;
  return false;
};

/** The commands for `query`: with none, every command not kept for search,
 * in their own order; otherwise those matching every word, best first (a
 * match at the label's start, then at a word's start, then anywhere in the
 * label, then in its detail or keywords; scattered letters last). */
export function rankCommands(commands: Command[], query: string): Command[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands.filter((c) => !c.searchOnly);
  const scored: { command: Command; score: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const label = command.label.toLowerCase();
    const hay = [label, command.detail, command.keywords, command.group]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const word of words) {
      const at = label.indexOf(word);
      if (at === 0) score += 8;
      else if (at > 0 && /[^\p{L}\p{N}]/u.test(label[at - 1])) score += 6;
      else if (at > 0) score += 4;
      else if (hay.includes(word)) score += 2;
      else if (subsequence(word, label)) score += 1;
      else return;
    }
    scored.push({ command, score, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map((s) => s.command);
}
