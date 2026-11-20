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

/** The app's keys, as main.tsx, Composer, Crew and the native menus
 * handle them. Each entry in `keys` is one combination; several are
 * alternatives. */
const GROUPS: Group[] = [
  {
    title: "Navigate",
    note: "Outside text fields",
    rows: [
      { keys: [["J"], ["↓"], ["→"]], label: "Next agent (Right in Command)" },
      { keys: [["K"], ["↑"], ["←"]], label: "Previous agent (Left in Command)" },
      { keys: [["N"]], label: "Next agent that needs you" },
      { keys: [["Esc"]], label: "Close the open layer, or go back (not from an agent)" },
      { keys: [["?"]], label: "Show these shortcuts" },
      { keys: [["⌘", "K"]], label: "Command palette" },
    ],
  },
  {
    title: "Act",
    rows: [
      { keys: [["⌘", "N"], ["D"]], label: "New agent" },
      { keys: [["⌘", "B"]], label: "Show or hide the session panel beside the other tabs (Crew's drawer is on Command)" },
      { keys: [["⇧", "⌘", "D"], ["Enter"]], label: "Focus the message box (⇧⌘D from anywhere, your editor and the agent's browser too)" },
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
  crew: "the crew",
  command: "the conversation",
  activity: "Activity",
  github: "GitHub",
  settings: "Settings",
};
const NATIVE: Group = {
  title: "macOS app",
  rows: [
    {
      keys: [["⌘", "`"]],
      label: "Next in the map's place: the crew, the conversation, GitHub, Activity",
    },
    {
      keys: [["⌘", "1…4"]],
      label: "The mode bar's tab in that place: the crew, the conversation, GitHub, Activity",
    },
    { keys: [["⇧", "⌘", "E"]], label: "From anywhere: the open agent's editor beside its conversation, with the keyboard" },
    { keys: [["⇧", "⌘", "B"]], label: "From anywhere: the open agent's browser beside its conversation, with the keyboard" },
    { keys: [["⌘", ","]], label: "Settings (the bar's gear), or back from it; Esc goes back too" },
  ],
};
/** What every page (GitHub, Activity, Settings) takes, while it shows (`pageText.ts`). */
const PAGES: Group = {
  title: "Pages",
  note: "In GitHub, Activity and Settings",
  rows: [
    { keys: [["⌘", "+"], ["⌘", "−"]], label: "Bigger or smaller text (one size for every page)" },
    { keys: [["⌘", "0"]], label: "Actual text size" },
    { keys: [["⌘", "R"]], label: "Refresh what's shown (a pull request or list, Activity; Settings has none)" },
  ],
};
/** The Activity tab's keys (`activity/ActivityView.tsx`), while the keyboard is in it. */
/** The Crew map (src/crew/CrewMap.tsx): the map of robots, and an open agent's browser beside its conversation. */
const CREW: Group = {
  title: "The crew",
  note: "The Crew tab: the map of robots; the Command tab: the open conversation (in a browser, both)",
  rows: [
    { keys: [["←"], ["→"], ["↑"], ["↓"]], label: "On the map: move through its robots, workspaces and projects" },
    { keys: [["Home"], ["End"]], label: "On the map: the first or last" },
    { keys: [["⌥", "↑"], ["⌥", "↓"]], label: "On a host's head: move the host earlier or later (or drag its head)" },
    { keys: [["Enter"]], label: "Open the robot, workspace or project" },
    { keys: [["Esc"]], label: "Back to the crew from the conversation, once out of its message box (the robot you left keeps the keyboard)" },
    { keys: [["←"], ["→"]], label: "On the conversation's left edge: make it wider or narrower (⇧ for bigger steps; drag it, double-click for the default)" },
    { keys: [["B"]], label: "Show or hide the open robot's browser beside its conversation (the macOS app's)" },
    { keys: [["F"]], label: "Show or hide its workspace in your editor (Settings → Files), beside the conversation (the macOS app's)" },
    { keys: [["⇧", "⌘", "W"]], label: "Hide the browser, from its page or a field too" },
  ],
};

const ACTIVITY: Group = {
  title: "Activity",
  note: "In the Activity tab, outside text fields",
  rows: [
    { keys: [["J"], ["↓"]], label: "Next notification" },
    { keys: [["K"], ["↑"]], label: "Previous notification" },
    { keys: [["Enter"], ["O"]], label: "Open it (pull requests in the GitHub tab, Linear in its desktop app, else in your browser)" },
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
    { keys: [["J"], ["↓"]], label: "Next pull request or main commit, or the diff's next file" },
    { keys: [["K"], ["↑"]], label: "Previous pull request or main commit, or the diff's previous file" },
    { keys: [["Enter"], ["O"]], label: "Open the pull request or main commit" },
    { keys: [["Esc"]], label: "Back to the list (or from main history to the repository)" },
    { keys: [["1"], ["2"], ["3"], ["4"]], label: "Conversation, Files changed, Commits or Checks" },
    { keys: [["R"]], label: "Finish your review (comment, approve or request changes)" },
    { keys: [["C"]], label: "Comment on the pull request" },
    { keys: [["V"]], label: "Mark the file in view viewed" },
    { keys: [["U"]], label: "Unified or split diff" },
    { keys: [["F"]], label: "Show or hide the diff's file list, or filter a repository's pull requests" },
    { keys: [["T"]], label: "Filter the diff's files by path (↑/↓ pick, Enter shows the file, Esc clears)" },
    { keys: [["⌘", "F"]], label: "Find in the diff (Enter next, ⇧Enter previous, Esc closes)" },
    { keys: [["⇧", "C"]], label: "The diff's sidebar: its files or its comments (review threads and your drafts)" },
    { keys: [["N"], ["⇧", "N"]], label: "The diff's next or previous comment (the Comments list's, resolved ones only while shown)" },
    { keys: [["S"]], label: "Star or unstar the repository as a favourite" },
    { keys: [["⇧", "⌘", "C"]], label: "Copy the pull request's link (on a repository's list, its pull requests' link)" },
    { keys: [["⌘", "↩"]], label: "Send the comment or review being written" },
    { keys: [["⌘", "S"]], label: "Show or hide the sidebar" },
    { keys: [["@"]], label: "In a comment: mention someone from the repository's organization (↑/↓ pick, Enter or Tab put them in, Esc closes the list)" },
  ],
};
/** Your editor beside an agent's conversation (`crew/WorkspaceEditor.tsx`, the macOS app's): the keys the app keeps
 * while it has the keyboard; every other key is the editor's. */
const EDITOR: Group = {
  title: "Your editor",
  note: "Beside an agent's conversation (F), in the macOS app",
  rows: [
    { keys: [["⇧", "⌘", "G"]], label: "From anywhere: the workspace's changes, Settings → Files' changes command run in the editor" },
    { keys: [["Click"]], label: "A file's link in the conversation: open it in the editor, at its line" },
    {
      keys: [["⌘", "K"], ["⌘", "1…3"], ["⌘", "`"]],
      label: "In the editor: the palette, the mode bar's tabs, ⇧⌘G too. Every other key, Esc and ⌃ keys included, is the editor's",
    },
    {
      keys: [["⌘", "+"], ["⌘", "−"], ["⌘", "0"]],
      label: "In the editor: bigger, smaller or actual text size (its font, line height and spacing: Settings → Terminal)",
    },
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
  // The mode bar's tabs shown, in its order (⌘` steps through them, ⌘1…⌘3 pick one).
  const tabNames = shownModes(integrations).map((mode) => TAB_NAMES[mode]);
  const groups = (
    macApp()
      ? [
          ...GROUPS,
          NATIVE,
          CREW,
          PAGES,
          ...(activityEnabled(integrations) ? [ACTIVITY] : []),
          ...(integrations.github ? [GITHUB] : []),
          EDITOR,
        ]
      : [...GROUPS, { ...CREW, rows: CREW.rows.filter((r) => !/browser/i.test(r.label)) }]
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
            ? {
                ...row,
                keys: [["⌘", tabNames.length > 1 ? `1…${tabNames.length}` : "1"]],
                label: `The mode bar's tab in that place: ${tabNames.join(", ")}`,
              }
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
