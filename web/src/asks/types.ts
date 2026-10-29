/**
 * What an agent's last reply asks of the user, as judged by a decision
 * model (server/asks.ts). Shared by the server and the page.
 */

/** The answer a question wants: yes or no, one of options it names, or
 *  anything else only the user can give. */
export type AskKind = "yes_no" | "pick" | "open";
export type ReplyQuestion = { text: string; kind: AskKind; options?: string[] };
export type Asks = {
  /** The reply judged, so its questions are never offered for a later one. */
  messageId?: string;
  /** The reply ends by waiting on the user before the work continues. */
  waiting: boolean;
  questions: ReplyQuestion[];
  /** An obvious next reply the user may send as it is ("Okay, I've merged
   *  PR #3."), when one clearly fits. */
  suggestion?: string;
  pending: boolean;
  /** Why nothing could be judged (no key, the key refused, the service down). */
  error?: string;
};
export const NO_ASKS: Asks = { waiting: false, questions: [], pending: false };
