import type { ShortcutKey } from "./shortcutKey";

/** Actions the command palette asks of components that own them (the map,
 * the floating panel, the header's dialogs, the open agent), as their own
 * keys and buttons do. */
export type AppCommand =
  | "fit-world"
  | "toggle-panel"
  | "show-shortcuts"
  | "show-settings"
  | "manage-linear-key"
  | "manage-typesafe-key"
  | "show-games"
  | "show-releases"
  | "agent-interrupt"
  | "agent-open-paseo"
  | "agent-archive"
  | "linear-refresh"
  | "linear-sidebar"
  | "linear-status"
  | "linear-priority"
  | "linear-assignee"
  | "linear-labels"
  | "linear-project"
  | "linear-cycle"
  | "linear-estimate"
  | "linear-milestone"
  | "linear-parent"
  | "linear-due-date"
  | "linear-add-relation"
  | "linear-undo-archive"
  | "linear-search"
  | "linear-go"
  | "linear-assign-me"
  | "linear-comment"
  | "linear-create"
  | "linear-sub-issue"
  | "linear-subscribe"
  | "linear-copy-branch"
  | "linear-copy-link"
  | "linear-archive"
  | "linear-delete";

const EVENT = "paseo:command";

/** Asks for `name`; `arg` is what it acts on, where it needs one (`linear-go`: the place). */
export function runAppCommand(name: AppCommand, arg?: unknown) {
  // The detail stays the bare name: the macOS app sends its own that way.
  window.dispatchEvent(Object.assign(new CustomEvent(EVENT, { detail: name }), { arg }));
}

export function onAppCommand(name: AppCommand, run: (arg?: unknown) => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent).detail === name) run((event as Event & { arg?: unknown }).arg);
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
