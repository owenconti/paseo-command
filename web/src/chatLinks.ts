/**
 * Where a web link clicked in a conversation opens in the macOS app. By default the app decides (`postAppLink`:
 * a Conquer tab; a pull request in the GitHub tab, a Linear issue in Linear's app). While a robot's browser shows
 * on the Dungeon Board (or beside a conversation on the Crew map) it takes the links of that conversation instead
 * (`BoardBrowser.tsx` registers itself here): they open in the browser you are looking at.
 */
import { postAppLink } from "./worldBridge";

/** Takes a link: true when it opened it. */
type Opener = (url: string) => boolean;
let board: Opener | null = null;

/** The board's browser, while it shows: it opens the links of the board's conversation. Returns its removal. */
export function setBoardLinkOpener(opener: Opener) {
  board = opener;
  return () => {
    if (board === opener) board = null;
  };
}

/** Open a web link clicked in a conversation, from the element it was clicked in. */
export function openChatLink(url: string, from: Element | null | undefined) {
  if (board && from?.closest(".world-chat, .crew-detail") && board(url)) return;
  postAppLink(url);
}
