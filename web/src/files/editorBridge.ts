/**
 * The Files page's editor terminals in the macOS app (`EditorOverlay.swift`):
 * the page says which tab's terminal shows over its viewer and where
 * (`editor`), gives it the keyboard (`editorFocus`), asks to close tabs whose
 * editors run (`editorClose`, which the app confirms, ends and answers) and
 * forgets terminals whose tabs went (`editorForget`). The app tells the page
 * (`paseo:editor`) when an editor quits on its own (`exited`), its relay went
 * (`lost`), it was clicked (`focus`), and how a close went (`closed`, `cancelled`).
 */
const channel = () =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: { postMessage(m: unknown): void } } } }).webkit?.messageHandlers
    ?.paseoWorld;

export type EditorPlacement = { terminal?: string; host?: string; x: number; y: number; width: number; height: number; covered: boolean };
let last = "";
/** Where the shown tab's editor goes (no terminal: none shows). Sent only when it changes, unless `force`. */
export function postEditorPlacement(p: EditorPlacement, force = false) {
  const key = JSON.stringify(p);
  if (key === last && !force) return;
  last = key;
  channel()?.postMessage({ type: "editor", ...p });
}
export const hideEditor = () => postEditorPlacement({ x: 0, y: 0, width: 0, height: 0, covered: false });
export const focusEditor = () => channel()?.postMessage({ type: "editorFocus" });
export const forgetEditors = (terminals: string[]) => terminals.length && channel()?.postMessage({ type: "editorForget", terminals });

export type EditorEvent =
  | { type: "exited" | "lost" | "focus"; terminal: string }
  | { type: "closed"; token: string; terminals: string[] }
  | { type: "cancelled"; token: string };
export function onEditorEvent(handler: (e: EditorEvent) => void) {
  const receive = (event: Event) => {
    const d = (event as CustomEvent).detail;
    if (d && typeof d.type === "string") handler(d as EditorEvent);
  };
  window.addEventListener("paseo:editor", receive);
  return () => window.removeEventListener("paseo:editor", receive);
}

export type CloseItem = { terminal: string; host?: string; name: string; running: boolean };
let tokens = 0;
/** Close these tabs' editors, asking first while any runs: true once they're ended, false if cancelled. */
export function closeEditors(items: CloseItem[]): Promise<boolean> {
  const c = channel();
  if (!c || !items.length) return Promise.resolve(true);
  const token = `close-${++tokens}`;
  return new Promise((resolve) => {
    const off = onEditorEvent((e) => {
      if ((e.type !== "closed" && e.type !== "cancelled") || e.token !== token) return;
      off();
      resolve(e.type === "closed");
    });
    c.postMessage({ type: "editorClose", token, items: items.map((i) => ({ ...i, host: i.host ?? "" })) });
  });
}
