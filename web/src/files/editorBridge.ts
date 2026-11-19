/**
 * Your editor's terminal in the macOS app (`EditorOverlay.swift`), beside an agent's conversation on Crew
 * (`crew/WorkspaceEditor.tsx`): the page says which terminal shows over its pane and where (`editor`, on the
 * Command tab) and gives it the keyboard (`editorFocus`). The app tells the page (`paseo:editor`) when the editor
 * quits on its own (`exited`), its relay went (`lost`) or it was clicked (`focus`).
 */
const channel = () =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: { postMessage(m: unknown): void } } } }).webkit?.messageHandlers
    ?.paseoWorld;

export type EditorPlacement = {
  terminal?: string;
  host?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  covered: boolean;
  /** The page's things over the pane (`overlays.ts`), in page coordinates: the app cuts them out of the terminal. */
  holes?: { x: number; y: number; width: number; height: number }[];
};
let last = "";
/** Where the editor goes (no terminal: none shows). Sent only when it changes, unless `force`. */
export function postEditorPlacement(p: EditorPlacement, force = false) {
  const message = { ...p, mode: "command" };
  const key = JSON.stringify(message);
  if (key === last && !force) return;
  last = key;
  channel()?.postMessage({ type: "editor", ...message });
}
export const hideEditor = () => postEditorPlacement({ x: 0, y: 0, width: 0, height: 0, covered: false });
export const focusEditor = () => channel()?.postMessage({ type: "editorFocus" });

export type EditorEvent = { type: "exited" | "lost" | "focus"; terminal: string };
export function onEditorEvent(handler: (e: EditorEvent) => void) {
  const receive = (event: Event) => {
    const d = (event as CustomEvent).detail;
    if (d && typeof d.type === "string") handler(d as EditorEvent);
  };
  window.addEventListener("paseo:editor", receive);
  return () => window.removeEventListener("paseo:editor", receive);
}
