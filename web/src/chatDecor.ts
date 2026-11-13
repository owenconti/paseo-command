/** What a map can add to the conversation it holds (the Crew map's robots, src/crew/): an avatar beside each reply
 * (`live` while that reply is still being written by a running agent) and what stands in the working row's place.
 * Without a provider the conversation looks as it always has. */
import { createContext, type ReactNode } from "react";

export type ChatDecor = {
  replyAvatar?: (live: boolean) => ReactNode;
  working?: ReactNode;
};
export const ChatDecorContext = createContext<ChatDecor>({});
/** What a map shows at the conversation's foot, just above its message box (Crew's robot, state and progress), in
 * place of the working summary line. Apart from the replies' decor, so its updates never redraw the transcript. */
export const ChatFooterContext = createContext<ReactNode>(null);
