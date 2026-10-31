import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { Keyboard, X } from "lucide-react";
import { modalOpen, useFocusTrap } from "./focus";
import { macApp } from "./worldBridge";
import { isTyping } from "./worldShortcut";
import { onAppCommand } from "./appCommands";
import { useIntegrations } from "./integrationSettings";

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
const NATIVE: Group = {
  title: "macOS app",
  rows: [
    { keys: [["⌃", "`"]], label: "Show or hide the terminal" },
    {
      keys: [["⌘", "`"]],
      label: "Next in the map's place: the map, the browser (Conquer), Linear",
    },
  ],
};
/** The Linear tab's keys (`linear/keys.ts`), as in Linear, while the keyboard is in it. */
const LINEAR: Group = {
  title: "Linear",
  note: "In the Linear tab, outside text fields",
  rows: [
    { keys: [["J"], ["↓"]], label: "Next issue" },
    { keys: [["K"], ["↑"]], label: "Previous issue" },
    { keys: [["Enter"], ["O"]], label: "Open the issue" },
    { keys: [["Esc"]], label: "Close the issue" },
    { keys: [["/"]], label: "Search the list" },
    { keys: [["F"]], label: "Filter the list" },
    { keys: [["C"]], label: "Create an issue" },
    { keys: [["S"]], label: "Change the status" },
    { keys: [["P"]], label: "Change the priority" },
    { keys: [["A"]], label: "Assign" },
    { keys: [["I"]], label: "Assign to you" },
    { keys: [["L"]], label: "Change the labels" },
    { keys: [["M"]], label: "Change the project" },
    { keys: [["⇧", "C"]], label: "Change the cycle" },
    { keys: [["⌘", "."]], label: "Copy the issue's branch name" },
    { keys: [["⌘", "⇧", ","]], label: "Copy the issue's link" },
    { keys: [["⌘", "S"]], label: "Show or hide the sidebar" },
    { keys: [["⌘", "+"], ["⌘", "−"]], label: "Bigger or smaller text" },
    { keys: [["⌘", "0"]], label: "Actual text size" },
    { keys: [["⌘", "Enter"]], label: "Send a comment, reply or edit" },
    { keys: [["⌘", "Enter"]], label: "Create the issue (New issue)" },
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
    { keys: [["⌘", "1…9"]], label: "Go to a tab (9: the last)" },
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

/** The panel header's keyboard button, and ? from anywhere outside a text
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
    return () => {
      window.removeEventListener("keydown", key);
      offCommand();
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
  const groups = (
    macApp()
      ? [...GROUPS, NATIVE, ...(integrations.linear ? [LINEAR] : []), CONQUER]
      : GROUPS
  ).map((group) => ({
    ...group,
    rows: group.rows
      .filter(
        (row) =>
          integrations.linear ||
          !/^(Open the Linear issue|Linear:)/.test(row.label),
      )
      .map((row) =>
        !integrations.linear &&
        row.label.startsWith("Next in the map's place")
          ? {
              ...row,
              label: "Next in the map's place: the map, the browser (Conquer)",
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
