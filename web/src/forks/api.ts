/** The page's calls to the reply-fork routes (`server/forks.ts`). */
import { api } from "../api";
import { hostQuery } from "../types";
import type { Boundary, Fork, Quote } from "./types";

/** A fork as listed: with whether its helper is answering or waiting on a request. */
export type ForkRow = Fork & { running?: boolean; waiting?: boolean };

export const listForks = (agentId: string, host?: string) =>
  api<{ supported: boolean; forks: ForkRow[] }>(
    `agents/${agentId}/forks${hostQuery(host)}`,
  );

export const createFork = (
  agentId: string,
  host: string | undefined,
  body: { question: string; quotes: Quote[]; boundary: Boundary },
) => api<Fork>(`agents/${agentId}/forks`, host ? { ...body, host } : body);

const act = (id: string, action: "close" | "reopen" | "sent") =>
  api<Fork>(`forks/${id}/${action}`, {});
export const closeFork = (id: string) => act(id, "close");
export const reopenFork = (id: string) => act(id, "reopen");
export const markSent = (id: string) => act(id, "sent");

/** The fork's conclusion, as the message the main agent is sent. */
export const concludeFork = (id: string) =>
  api<{ text: string }>(`forks/${id}/conclude`, {});
