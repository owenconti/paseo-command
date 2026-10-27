import type { ShortcutKey } from "./appReload";

/** Cmd+N opens the Dispatch Agent flow from anywhere, typing included: no
 * macOS text field uses Cmd+N (Ctrl+N, which moves the caret down a line, is
 * left alone). In the native app the File menu's Dispatch Agent… item takes
 * the key before WebKit and sends a `menu` event instead; this page handler
 * serves the browser and any press that reaches the page. */
export const isDispatchShortcut = (event: ShortcutKey) =>
  event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "n";

type KeyTarget = {
  addEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
    capture: boolean,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
    capture: boolean,
  ): void;
};
/** Listen in the capture phase, ahead of the composer's and the list's own
 * key handlers, and keep the browser's own Cmd+N where it lets the page have
 * it. A held key opens the flow once. */
export function installDispatchShortcut(target: KeyTarget, open: () => void) {
  const key = (event: KeyboardEvent) => {
    if (!isDispatchShortcut(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) open();
  };
  target.addEventListener("keydown", key, true);
  return () => target.removeEventListener("keydown", key, true);
}
