export type Trigger = {
  type: "command" | "file";
  query: string;
  start: number;
};

/** The "/command" or "@file" token being typed just before the caret, if any.
 *  Both start a word: at the start of the text or after whitespace. */
export function composerTrigger(before: string): Trigger | null {
  const m = /(^|\s)([/@])([^\s]*)$/.exec(before);
  if (!m) return null;
  return {
    type: m[2] === "/" ? "command" : "file",
    query: m[3],
    start: before.length - m[3].length - 1,
  };
}
