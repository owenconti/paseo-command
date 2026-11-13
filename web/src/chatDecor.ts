/** What a map can add to the conversation it holds (the Crew map's robots, src/crew/): an avatar beside each reply
 * (`live` while that reply is still being written by a running agent) and what stands in the working row's place.
 * Without a provider the conversation looks as it always has. */
import { createContext, type ReactNode } from "react";

export type ChatDecor = {
  replyAvatar?: (live: boolean) => ReactNode;
  working?: ReactNode;
};
export const ChatDecorContext = createContext<ChatDecor>({});
