/**
 * What's asked of the Files tab from elsewhere, kept light so the page needn't load the tab to ask: a file at a line
 * (a chat's file link) or a sidebar view (⇧⌘G, ⌘K and a workspace's Show changes: the branch's changes). Main hears
 * each ask (`FILES_ASK_EVENT`) and shows the tab beside the agent's conversation; the tab takes it for its workspace,
 * once (`takeFilesAsk`), as it shows or at once when it already does.
 */
import type { SideView } from "./store";

export type FilesAsk = { workspace: string; host?: string; path?: string; line?: number; side?: SideView };

export const FILES_ASK_EVENT = "paseo:files-ask";
let pending: FilesAsk | null = null;

export function askFilesTab(ask: FilesAsk): void {
  pending = ask;
  window.dispatchEvent(new CustomEvent(FILES_ASK_EVENT, { detail: ask }));
}

/** The ask waiting for this workspace's Files tab, taken (only once). */
export function takeFilesAsk(workspace: string, host: string | undefined): FilesAsk | null {
  if (!pending || pending.workspace !== workspace || (pending.host ?? "") !== (host ?? "")) return null;
  const ask = pending;
  pending = null;
  return ask;
}
