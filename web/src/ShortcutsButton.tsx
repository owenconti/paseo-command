import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { Keyboard, X } from "lucide-react";
import { useFocusTrap } from "./focus";
import { nativeAvailable } from "./worldBridge";

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
      { keys: [["Esc"]], label: "Close the open layer, or go back" },
    ],
  },
  {
    title: "Act",
    rows: [
      { keys: [["⌘", "N"], ["D"]], label: "New agent" },
      { keys: [["⌘", "L"], ["Enter"]], label: "Focus the message box" },
      { keys: [["R"]], label: "Reply to the selected agent" },
      { keys: [["G"]], label: "Open the workspace's pull request" },
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
    { keys: [["⌘", "R"]], label: "Reload, with the latest build" },
    { keys: [["⌃", "`"]], label: "Show or hide the terminal" },
  ],
};

/** The panel header's keyboard button: opens a dialog listing the shortcuts. */
export function ShortcutsButton() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // In the app's main, as the archive dialog is, so it takes the panel theme.
  const host = trigger.current?.closest("main") ?? document.body;
  return (
    <>
      <button
        ref={trigger}
        className="panel-tool"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Keyboard shortcuts"
        data-tip="Keyboard shortcuts"
        onClick={() => setOpen(true)}
      >
        <Keyboard size={16} />
      </button>
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
  const groups = nativeAvailable() ? [...GROUPS, NATIVE] : GROUPS;
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
