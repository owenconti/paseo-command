/**
 * Reply forks: short side conversations about highlighted parts of an
 * agent's reply. Shared by the server (`server/forks.ts`) and the page.
 */

/** The label on every fork's helper agent (its value is the fork id). */
export const FORK_LABEL = "paseo-command-fork";
export const FORK_COLOURS = 6;
/** How a fork's first prompt begins (the pane shows its question instead). */
export const FIRST_PROMPT_LEAD =
  "This is a short side conversation forked from the conversation above.";

/** A highlighted piece of a reply: its text, and where it stood in the
 *  reply's rendered text when it was chosen. */
export type Quote = {
  messageId?: string;
  replyKey: string;
  text: string;
  start: number;
  end: number;
};
/** Where the main conversation is cut for the fork: a message, or else a
 *  daemon timeline position. */
export type Boundary = { messageId?: string; epoch?: string; seq?: number };
export type Fork = {
  id: string;
  host: string | null;
  agentId: string;
  helperId: string;
  boundary: Boundary;
  quotes: Quote[];
  question: string;
  colour: number;
  createdAt: string;
  closedAt?: string;
  sentBackAt?: string;
};

/** The lowest colour not in use, else round the palette. */
export function nextColour(used: number[]): number {
  for (let c = 0; c < FORK_COLOURS; c++) if (!used.includes(c)) return c;
  return used.length % FORK_COLOURS;
}
