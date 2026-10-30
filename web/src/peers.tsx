import { createContext, useContext } from "react";
import type { Agent } from "./types";

/**
 * Other agents a conversation mentions (an `agent_message` report): find one
 * by its daemon ID, and open its conversation.
 */
export type Peers = {
  find: (daemonId: string) => Agent | undefined;
  open: (agent: Agent) => void;
};

export const PeersContext = createContext<Peers | null>(null);

export const usePeers = () => useContext(PeersContext);
