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
  | "linear-back"
  | "linear-forward"
  | "linear-filter"
  | "linear-find"
  | "linear-inbox-read-all"
  | "linear-display"
  | "linear-layout"
  | "linear-sub-group"
  | "linear-swap-groupings"
  | "linear-clear-filters"
  | "linear-save-view"
  | "linear-edit-view"
  | "linear-delete-view"
  | "page-text-bigger"
  | "page-text-smaller"
  | "page-text-actual"
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
  | "linear-edit-title"
  | "linear-edit-description"
  | "linear-create"
  | "linear-sub-issue"
  | "linear-subscribe"
  | "linear-copy-branch"
  | "linear-copy-link"
  | "linear-archive"
  | "linear-delete"
  | "activity-refresh"
  | "activity-filter"
  | "activity-unread-only"
  | "activity-open"
  | "activity-read"
  | "activity-unread"
  | "activity-done"
  | "activity-read-all"
  | "activity-done-all"
  | "github-open"
  | "github-go"
  | "github-refresh"
  | "github-back"
  | "github-tab"
  | "github-layout"
  | "github-files"
  | "github-review"
  | "github-comment"
  | "github-reviewers"
  | "github-assignees"
  | "github-next-file"
  | "github-prev-file"
  | "github-viewed"
  | "github-changes-mode"
  | "github-open-browser"
  | "github-star"
  | "github-find-repo"
  | "github-sidebar"
  | "github-filter"
  | "github-set-filter";

const EVENT = "paseo:command";

/** Asks for `name`; `arg` is what it acts on, where it needs one (`linear-go`: the place; `activity-filter`: the source or "all"; `github-open`/`github-go`: the place; `github-tab`: the PR's tab; `github-review`: the verdict; `github-star`: `{kind, name, starred}`; `github-filter`: the filter to open; `github-set-filter`: `{field, value}` (a people filter's value: its logins) or "clear"). */
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
