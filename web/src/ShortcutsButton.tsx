import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { Keyboard, X } from "lucide-react";
import { modalOpen, useFocusTrap } from "./focus";
import { macApp } from "./worldBridge";
import { isTyping } from "./worldShortcut";
import { onAppCommand } from "./appCommands";
import { useIntegrations } from "./integrationSettings";
import { activityEnabled } from "./integrations";
import { shownModes, type AppMode } from "./appMode";
import { onAppBar } from "./worldBridge";

type Shortcut = { keys: string[][]; label: string };
type Group = { title: string; note?: string; rows: Shortcut[] };

/** The app's keys, as main.tsx, Composer, NativeWorld and the native menus
 * handle them. Each entry in `keys` is one combination; several are
 * alternatives. */
const GROUPS: Group[] = [
  {
    title: "Navigate",
    note: "Outside text fields",
    rows: [
      { keys: [["J"], ["↓"]], label: "Next agent" },
      { keys: [["K"], ["↑"]], label: "Previous agent" },
      { keys: [["N"]], label: "Next agent that needs you" },
      { keys: [["F"]], label: "Fit the whole map" },
      { keys: [["Esc"]], label: "Close the open layer, or go back (not from an agent)" },
      { keys: [["?"]], label: "Show these shortcuts" },
      { keys: [["B"]], label: "Open the mini games" },
      { keys: [["⌘", "K"]], label: "Command palette" },
    ],
  },
  {
    title: "Act",
    rows: [
      { keys: [["⌘", "N"], ["D"]], label: "New agent" },
      { keys: [["⌘", "B"]], label: "Show or hide the panel" },
      { keys: [["⌘", "L"], ["Enter"]], label: "Focus the message box" },
      { keys: [["R"]], label: "Reply to the selected agent" },
      {
        keys: [["G"]],
        label: "Open the workspace's pull request, or the project on GitHub",
      },
      { keys: [["L"]], label: "Open the Linear issue" },
    ],
  },
  {
    title: "Message box",
    rows: [
      { keys: [["Enter"]], label: "Send" },
      { keys: [["⇧", "Enter"]], label: "New line" },
      { keys: [["⌥", "Enter"]], label: "Send into the running turn" },
      { keys: [["⌘", "Enter"]], label: "Stop the turn and send" },
      { keys: [["↑"], ["↓"]], label: "Recall earlier messages" },
      { keys: [["Tab"]], label: "Pick a / or @ suggestion" },
      { keys: [["Esc"]], label: "Leave the message box" },
    ],
  },
];
const TAB_NAMES: Record<AppMode, string> = {
  command: "the map",
  conquer: "the browser (Conquer)",
  activity: "Activity",
  github: "GitHub",
  files: "Files",
  settings: "Settings",
};
const NATIVE: Group = {
  title: "macOS app",
  rows: [
    { keys: [["⌃", "`"]], label: "Show or hide the terminal" },
    {
      keys: [["⌘", "`"]],
      label: "Next in the map's place: the map, the browser (Conquer), Activity, GitHub, Files, Settings",
    },
    { keys: [["⌘", "1…6"]], label: "The mode bar's tab in that place: the map, the browser (Conquer), Files, Settings" },
    { keys: [["⇧", "⌘", "E"]], label: "From anywhere: the selected workspace's (or agent's) files" },
    { keys: [["⌘", ","]], label: "Settings, or back from it" },
  ],
};
/** What every page (GitHub, Activity, Files, Settings) takes, while it shows (`pageText.ts`). */
const PAGES: Group = {
  title: "Pages",
  note: "In GitHub, Activity, Files and Settings",
  rows: [
    { keys: [["⌘", "+"], ["⌘", "−"]], label: "Bigger or smaller text (one size for every page)" },
    { keys: [["⌘", "0"]], label: "Actual text size" },
  ],
};
/** The Activity tab's keys (`activity/ActivityView.tsx`), while the keyboard is in it. */
const ACTIVITY: Group = {
  title: "Activity",
  note: "In the Activity tab, outside text fields",
  rows: [
    { keys: [["J"], ["↓"]], label: "Next notification" },
    { keys: [["K"], ["↑"]], label: "Previous notification" },
    { keys: [["Enter"], ["O"]], label: "Open it (pull requests in the GitHub tab, Linear in its desktop app, else in Conquer)" },
    { keys: [["U"]], label: "Mark it read or unread" },
    { keys: [["⇧", "U"]], label: "Mark every shown notification read" },
    { keys: [["E"], ["⌫"]], label: "Done: leave it out of Activity" },
    { keys: [["⇧", "E"]], label: "Mark every shown notification done (asks first)" },
    { keys: [["1"], ["2"], ["3"]], label: "Show all, GitHub or Linear" },
  ],
};
/** The GitHub tab's keys (`github/GitHubView.tsx`), while the keyboard is in it. */
const GITHUB: Group = {
  title: "GitHub",
  note: "In the GitHub tab, outside text fields",
  rows: [
    { keys: [["J"], ["↓"]], label: "Next pull request, or the diff's next file" },
    { keys: [["K"], ["↑"]], label: "Previous pull request, or the diff's previous file" },
    { keys: [["Enter"], ["O"]], label: "Open the pull request" },
    { keys: [["Esc"]], label: "Back to the list" },
    { keys: [["1"], ["2"], ["3"], ["4"]], label: "Conversation, Files changed, Commits or Checks" },
    { keys: [["R"]], label: "Finish your review (comment, approve or request changes)" },
    { keys: [["C"]], label: "Comment on the pull request" },
    { keys: [["V"]], label: "Mark the file in view viewed" },
    { keys: [["U"]], label: "Unified or split diff" },
    { keys: [["F"]], label: "Show or hide the diff's file list, or filter a repository's pull requests" },
    { keys: [["T"]], label: "Filter the diff's files by path (↑/↓ pick, Enter shows the file, Esc clears)" },
    { keys: [["⌘", "F"]], label: "Find in the diff (Enter next, ⇧Enter previous, Esc closes)" },
    { keys: [["S"]], label: "Star or unstar the repository as a favourite" },
    { keys: [["M"]], label: "A workspace's changes: all, committed or uncommitted" },
    { keys: [["⌘", "↩"]], label: "Send the comment or review being written" },
    { keys: [["⌘", "S"]], label: "Show or hide the sidebar" },
    {
      keys: [["⇧", "⌘", "G"]],
      label: "From anywhere: the selected workspace's (or agent's) branch changes (Conquer keeps it for find previous while it has the keyboard)",
    },
  ],
};
/** The Files page's keys (`files/FilesView.tsx`), while it shows. */
const FILES: Group = {
  title: "Files",
  note: "In the Files tab",
  rows: [
    { keys: [["⌘", "P"]], label: "Open a file by name (fuzzy over every path; ↑/↓ pick, Enter opens)" },
    { keys: [["Click"], ["Double-click"]], label: "A file in the tree: open it in a preview tab (italic, replaced by the next), or keep it open" },
    { keys: [["T"]], label: "Filter the tree by path (↑/↓ pick, Enter opens, Esc clears)" },
    { keys: [["↓"], ["↑"]], label: "In the tree: the next or previous file or folder" },
    { keys: [["→"], ["←"]], label: "In the tree: open or close a folder (or go into it, or up to its parent)" },
    { keys: [["Enter"]], label: "In the tree: open the file, or open or close the folder" },
    { keys: [["⌘", "F"]], label: "Find in the file (Enter next, ⇧Enter previous, Esc closes)" },
    { keys: [["⌘", "S"]], label: "Show or hide the sidebar" },
    { keys: [["⌘", "W"], ["⌃", "W"]], label: "Close the tab (with none open, nothing; in a browser ⌘W is the browser's: use ⌃W)" },
    { keys: [["⇧", "⌘", "T"]], label: "Reopen the last closed tab" },
    {
      keys: [
        ["⌃", "Tab"],
        ["⌃", "⇧", "Tab"],
      ],
      label: "The next or previous tab",
    },
    {
      keys: [
        ["⌥", "⌘", "→"],
        ["⌥", "⌘", "←"],
      ],
      label: "The next or previous tab, too",
    },
  ],
};
/** Conquer's own keys (the macOS app's browser), which it takes ahead of its pages
 * while it has the keyboard. */
const CONQUER: Group = {
  title: "Conquer (browser)",
  rows: [
    { keys: [["⌘", "B"]], label: "Show or hide the app panel" },
    { keys: [["⌘", "S"]], label: "Show or hide the tab sidebar" },
    { keys: [["⌘", "T"]], label: "New tab" },
    { keys: [["⇧", "⌘", "T"]], label: "Reopen the closed tab" },
    { keys: [["⌘", "W"]], label: "Close the tab (a pinned one only unloads)" },
    {
      keys: [
        ["⌘", "E"],
        ["⌃", "Tab"],
      ],
      label: "Next tab",
    },
    { keys: [["⌥", "⌘", "1…9"]], label: "Go to a tab (9: the last)" },
    { keys: [["⌘", "D"]], label: "Pin or unpin the tab" },
    { keys: [["⌘", "L"]], label: "Address bar" },
    { keys: [["⌘", "R"]], label: "Reload page" },
    { keys: [["⇧", "⌘", "R"]], label: "Reload page without cache" },
    {
      keys: [
        ["⌘", "["],
        ["⌘", "]"],
      ],
      label: "Back, forward",
    },
    {
      keys: [
        ["⌘", "F"],
        ["⌘", "G"],
      ],
      label: "Find in page, next match",
    },
    {
      keys: [
        ["⌘", "+"],
        ["⌘", "−"],
        ["⌘", "0"],
      ],
      label: "Zoom (each site keeps its own)",
    },
    { keys: [["⌘", "P"]], label: "Print" },
    { keys: [["⇧", "⌘", "J"]], label: "Downloads" },
  ],
};

/** The top bar's keyboard button, and ? from anywhere outside a text
 * field: opens a dialog listing the shortcuts. `hidden` drops the button
 * (a collapsed panel) but keeps ?. */
export function ShortcutsButton({ hidden = false }: { hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key !== "?" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.defaultPrevented ||
        modalOpen() ||
        isTyping(e.target as HTMLElement | null)
      )
        return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", key);
    const offCommand = onAppCommand("show-shortcuts", () => setOpen(true));
    // The macOS app's top bar button (its own; this one is then hidden).
    const offBar = onAppBar("shortcuts", () => setOpen((o) => !o));
    return () => {
      window.removeEventListener("keydown", key);
      offCommand();
      offBar();
    };
  }, []);
  // In the app's main, as the archive dialog is, so it takes the panel theme.
  const host = document.querySelector("main.command-app") ?? document.body;
  return (
    <>
      {!hidden && (
        <button
          className="panel-tool"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Keyboard shortcuts"
          data-tip="Keyboard shortcuts (?)"
          onClick={() => setOpen(true)}
        >
          <Keyboard size={16} />
        </button>
      )}
      {createPortal(
        <AnimatePresence>
          {open && <ShortcutsDialog onClose={() => setOpen(false)} />}
        </AnimatePresence>,
        host,
      )}
    </>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const present = useIsPresent();
  useFocusTrap(dialog, close, present);
  // Leaving: keys go back to the page at once, not to the fading dialog.
  useLayoutEffect(() => {
    if (!present && dialog.current?.contains(document.activeElement))
      (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  // Ahead of the page's Escape (which would also go back a selection).
  useEffect(() => {
    if (!present) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [present, onClose]);
  const { integrations } = useIntegrations();
  // The mode bar's tabs shown, in its order (⌘` steps through them, ⌘1…⌘6 pick one).
  const tabNames = shownModes(integrations).map((mode) => TAB_NAMES[mode]);
  const groups = (
    macApp()
      ? [
          ...GROUPS,
          NATIVE,
          PAGES,
          ...(activityEnabled(integrations) ? [ACTIVITY] : []),
          ...(integrations.github ? [GITHUB] : []),
          FILES,
          CONQUER,
        ]
      : GROUPS
  ).map((group) => ({
    ...group,
    rows: group.rows
      .filter(
        (row) =>
          integrations.linear ||
          !/^Open the Linear issue/.test(row.label),
      )
      .map((row) =>
        row.label.startsWith("Next in the map's place")
          ? { ...row, label: `Next in the map's place: ${tabNames.join(", ")}` }
          : row.label.startsWith("The mode bar's tab")
            ? { ...row, label: `The mode bar's tab in that place: ${tabNames.join(", ")}` }
            : row,
      ),
  }));
  return (
    <motion.div
      className="modal-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={onClose}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="command-dialog shortcuts-dialog panel"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
          opacity: 0,
          y: 15,
          scale: 0.97,
          transition: { duration: 0.12 },
        }}
        onClick={(e) => e.stopPropagation()}
        // Keys pressed here are the dialog's (not J/K/N/D shortcuts).
        onKeyDown={(e) => {
          if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation();
        }}
      >
        <div className="dialog-heading">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button
            ref={close}
            data-tip="Close (Esc)"
            className="icon-btn"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="shortcuts-content">
          {groups.map((g) => (
            <section key={g.title} className="shortcuts-group">
              <h3 className="section-label">
                {g.title}
                {g.note && <small>{g.note}</small>}
              </h3>
              <dl>
                {g.rows.map((row) => (
                  <div key={row.label} className="shortcut-row">
                    <dt>{row.label}</dt>
                    <dd>
                      {row.keys.map((combo, i) => (
                        <span key={i} className="shortcut-combo">
                          {i > 0 && <span className="shortcut-or">or</span>}
                          {combo.map((k) => (
                            <kbd key={k}>{k}</kbd>
                          ))}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </motion.section>
    </motion.div>
  );
}
