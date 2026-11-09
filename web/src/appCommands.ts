import type { ShortcutKey } from "./shortcutKey";

/** Actions the command palette asks of components that own them (the map,
 * the floating panel, the header's dialogs, the open agent), as their own
 * keys and buttons do. */
export type AppCommand =
  | "world-talk-actions"
  | "dungeon-tray"
  | "dungeon-tray-close"
  | "dungeon-tray-settings"
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
  | "agent-question-toggle"
  | "diff-comments-apply"
  | "diff-comments-show"
  | "page-text-bigger"
  | "page-text-smaller"
  | "page-text-actual"
  | "page-refresh"
  | "activity-refresh"
  | "activity-filter"
  | "activity-unread-only"
  | "activity-open"
  | "activity-read"
  | "activity-unread"
  | "activity-done"
  | "activity-read-all"
  | "activity-done-all"
  | "github-history-latest"
  | "github-history-older"
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
  | "github-threads"
  | "github-merge"
  | "github-conversation-order"
  | "github-reviewers"
  | "github-assignees"
  | "github-next-file"
  | "github-diff-sidebar"
  | "github-next-comment"
  | "github-prev-comment"
  | "github-prev-file"
  | "github-viewed"
  | "github-open-browser"
  | "github-copy-link"
  | "github-star"
  | "github-find-repo"
  | "github-sidebar"
  | "github-filter"
  | "github-set-filter"
  | "branch-changes"
  | "files-show"
  | "files-quick-open"
  | "files-filter"
  | "files-sidebar"
  | "files-ignored"
  | "files-refresh"
  | "files-find"
  | "files-wrap"
  | "files-markdown-source"
  | "files-markdown-preview"
  | "files-copy-path"
  | "files-show-changes"
  | "files-changes"
  | "files-changes-mode"
  | "files-diff-layout"
  | "files-diff-list"
  | "files-diff-filter"
  | "files-diff-find"
  | "files-diff-next"
  | "files-diff-sidebar"
  | "files-diff-next-comment"
  | "files-diff-prev-comment"
  | "files-diff-prev"
  | "files-open"
  | "files-open-at"
  | "files-close-tab"
  | "files-reopen-tab"
  | "files-next-tab"
  | "files-previous-tab"
  | "files-close-other-tabs"
  | "files-open-editor"
  | "files-open-viewer"
  | "map-style-islands"
  | "map-style-overworld"
  | "map-style-dungeon";

const EVENT = "paseo:command";

/** Asks for `name`; `arg` is what it acts on, where it needs one (`activity-filter`: the source or "all"; `github-open`/`github-go`: the place; `github-tab`: the PR's tab; `github-review`: the verdict; `github-merge`: the merge box's action (`merge.ts` `MergeAction`); `github-star`: `{kind, name, starred}`; `github-filter`: the filter to open; `github-set-filter`: `{field, value}` (a people filter's value: its logins) or "clear"; `files-changes`: `{path?}`, a file to show; `files-open-at`: `files/open.ts`'s `FileAsk`; `files-changes-mode`: the mode, else the next). */
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

/** ⇧⌘G: the selected workspace's branch changes in the Files tab's Changes. The macOS app takes it through its
 * View menu (Show Branch Changes) and sends `branch-changes`; a browser's page takes it itself. */
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
