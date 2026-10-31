import type { ShortcutKey } from "./shortcutKey";

/** Actions the command palette asks of components that own them (the map,
 * the floating panel, the header's dialogs, the open agent), as their own
 * keys and buttons do. */
export type AppCommand =
  | "fit-world"
  | "toggle-panel"
  | "show-shortcuts"
  | "show-settings"
  | "show-games"
  | "show-releases"
  | "agent-interrupt"
  | "agent-open-paseo"
  | "agent-archive"
  | "linear-refresh"
  | "linear-sidebar";

const EVENT = "paseo:command";

export function runAppCommand(name: AppCommand) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: name }));
}

export function onAppCommand(name: AppCommand, run: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent).detail === name) run();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Cmd+K opens the command palette from anywhere, typing included, as Cmd+N
 * opens a new agent (Ctrl+K, which deletes to the line's end in macOS text
 * fields, is left alone). */
export const isPaletteShortcut = (event: ShortcutKey) =>
  event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "k";
