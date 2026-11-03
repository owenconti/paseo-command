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
  | "diff-comments-apply"
  | "diff-comments-show"
  | "page-text-bigger"
  | "page-text-smaller"
  | "page-text-actual"
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
  | "github-filter-files"
  | "github-find"
  | "github-review"
  | "github-comment"
  | "github-merge"
  | "github-conversation-order"
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
  | "github-set-filter"
  | "github-branch-changes"
  | "files-show"
  | "files-quick-open"
  | "files-filter"
  | "files-sidebar"
  | "files-ignored"
  | "files-refresh"
  | "files-find"
  | "files-copy-path"
  | "files-show-changes"
  | "files-open"
  | "files-close-tab"
  | "files-reopen-tab"
  | "files-next-tab"
  | "files-previous-tab"
  | "files-close-other-tabs";

const EVENT = "paseo:command";

/** Asks for `name`; `arg` is what it acts on, where it needs one (`activity-filter`: the source or "all"; `github-open`/`github-go`: the place; `github-tab`: the PR's tab; `github-review`: the verdict; `github-merge`: the merge box's action (`merge.ts` `MergeAction`); `github-star`: `{kind, name, starred}`; `github-filter`: the filter to open; `github-set-filter`: `{field, value}` (a people filter's value: its logins) or "clear"). */
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

/** ⇧⌘G: the selected workspace's branch changes in the GitHub tab. The macOS app takes it through its
 * View menu (Show Branch Changes) and sends `github-branch-changes`; a browser's page takes it itself. */
export const isBranchChangesShortcut = (event: ShortcutKey) =>
  event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "g";

/** ⇧⌘E: the selected workspace's files in the Files tab. The macOS app takes it through its View menu
 * (Show Files) and shows the tab itself; a browser's page takes it itself (and says the tab is the app's). */
export const isFilesShortcut = (event: ShortcutKey) =>
  event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "e";

/** Cmd+K opens the command palette from anywhere, typing included, as Cmd+N
 * opens a new agent (Ctrl+K, which deletes to the line's end in macOS text
 * fields, is left alone). */
export const isPaletteShortcut = (event: ShortcutKey) =>
  event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "k";
