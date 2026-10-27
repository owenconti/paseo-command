/** Cmd+R in the Unity app shows the latest build on disk. The native shortcut
 * monitor normally handles it before WebKit sees the key; this page handler
 * covers the same press if it reaches the page, and never reloads the page
 * by itself. Native code chooses the reload (see AppReload.Decide). */
export type ShortcutKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;
export const isAppReloadShortcut = (event: ShortcutKey) =>
  event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "r";

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
export function installAppReloadShortcut(
  target: KeyTarget,
  request: () => void,
) {
  const key = (event: KeyboardEvent) => {
    if (!isAppReloadShortcut(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // A held key repeats; one press asks once.
    if (!event.repeat) request();
  };
  target.addEventListener("keydown", key, true);
  return () => target.removeEventListener("keydown", key, true);
}
