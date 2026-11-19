/** What's asked of a workspace's own editor (crew/WorkspaceEditor.tsx) from elsewhere: a file at a line (a chat's file
 *  link), or its changes (⇧⌘G, ⌘K). Kept until that workspace's editor is running to take it; main hears each ask
 *  (`ASK_EVENT`) and shows the editor beside the agent's conversation. */
export type EditorAsk = { workspace: string; host?: string; open?: { path: string; line?: number }; changes?: true };

export const ASK_EVENT = "paseo:workspace-editor-ask";
let pending: EditorAsk | null = null;

export function askWorkspaceEditor(ask: EditorAsk): void {
  pending = ask;
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: ask }));
}

/** The ask waiting for this workspace's editor, taken (only once). */
export function takeEditorAsk(workspace: string, host: string | undefined): EditorAsk | null {
  if (!pending || pending.workspace !== workspace || (pending.host ?? "") !== (host ?? "")) return null;
  const ask = pending;
  pending = null;
  return ask;
}
