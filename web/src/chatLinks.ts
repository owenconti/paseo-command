/**
 * Where a web link clicked in a conversation opens in the macOS app. By default the app decides (`postAppLink`:
 * your default browser; a pull request in the GitHub tab, a Linear issue in Linear's app). While a robot's browser
 * shows beside its conversation on Crew it takes the links of that conversation instead
 * (`BoardBrowser.tsx` registers itself here): they open in the browser you are looking at. A tool row's links (a dev
 * server's address, a task notification's) always go to the agent's browser (`openInAgentBrowser`), shown for them.
 */
import { runAppCommand } from "./appCommands";
import { macApp, postAppLink } from "./worldBridge";

/** Takes a link: true when it opened it. */
type Opener = (url: string) => boolean;
let board: Opener | null = null;

/** The board's browser, while it shows: it opens the links of the board's conversation. Returns its removal. */
export function setBoardLinkOpener(opener: Opener) {
  board = opener;
  // A link that asked for the browser to show: it takes it now (else the app does, as any link).
  const waiting = pending && Date.now() - pending.at < PENDING_MS ? pending.url : null;
  pending = null;
  if (waiting && !opener(waiting)) postAppLink(waiting);
  return () => {
    if (board === opener) board = null;
  };
}

/** A tool row's link waiting for the agent's browser to show (it was hidden), for a few seconds at most. */
let pending: { url: string; at: number } | null = null;
const PENDING_MS = 8_000;

/** A tool row's link: in the agent's browser beside its conversation, shown first if hidden (the macOS app's; a
 *  browser opens a tab). A pull request's and a Linear issue's still go to their own places. */
export function openInAgentBrowser(url: string, from: Element | null | undefined) {
  if (!macApp()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (!from?.closest(".world-chat, .crew-detail")) return postAppLink(url);
  if (board) {
    if (!board(url)) postAppLink(url);
    return;
  }
  pending = { url, at: Date.now() };
  runAppCommand("tools-browser");
}

/** Open a web link clicked in a conversation, from the element it was clicked in. */
export function openChatLink(url: string, from: Element | null | undefined) {
  if (board && from?.closest(".world-chat, .crew-detail") && board(url)) return;
  postAppLink(url);
}
