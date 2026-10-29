/**
 * Answering an agent's questions in place: pieces of its reply quoted into
 * the composer, each with an answer of its own.
 */

/** A quoted question and the answer written under it; `options` are its
 *  quick replies (Yes and No, or the alternatives it names). */
export type Answer = {
  id: string;
  question: string;
  answer: string;
  options?: string[];
};

/** Answered questions as quote and answer pairs, then the rest of the
 *  message; questions left unanswered are dropped. */
export function answersMessage(answers: Answer[], text: string): string {
  const pairs = answers
    .filter((a) => a.answer.trim())
    .map(
      (a) =>
        `${a.question
          .trim()
          .split("\n")
          .map((line) => `> ${line}`.trimEnd())
          .join("\n")}\n${a.answer.trim()}`,
    );
  return [...pairs, text.trim()].filter(Boolean).join("\n\n");
}

/** A detected question's quick replies: Yes and No, the alternatives it
 *  names, or answers drafted for it. */
export function quickReplies(q: { kind: string; options?: string[]; answers?: string[] }) {
  return q.kind === "yes_no"
    ? ["Yes", "No"]
    : q.kind === "pick"
      ? q.options
      : q.answers?.length
        ? q.answers
        : undefined;
}
