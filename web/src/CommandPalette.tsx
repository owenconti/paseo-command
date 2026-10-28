import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { Search } from "lucide-react";
import { isPaletteShortcut } from "./appCommands";
import { modalOpen, useFocusTrap } from "./focus";
import { rankCommands, type Command } from "./palette";
import { plainText } from "./ui";

/** Cmd+K, from anywhere: a searchable list of the app's commands (each with
 * its own keys) and, as you type, its agents, workspaces, projects and hosts.
 * Enter runs the highlighted one; the palette closes first, so the command
 * finds the page as it was. `blocked` (a modal on screen) keeps it shut. */
export function CommandPalette({
  commands,
  blocked = false,
}: {
  commands: Command[];
  blocked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const latest = useRef({ open, blocked });
  latest.current = { open, blocked };
  useEffect(() => {
    // Capture phase, ahead of the composer's and the lists' own keys.
    const key = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      const { open, blocked } = latest.current;
      if (!open && (blocked || modalOpen())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) setOpen(!open);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);
  // The chosen command runs once the dialog has let go of focus (its trap
  // hands focus back as it closes), so a command that focuses something keeps it.
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (open || !pending.current) return;
    const run = pending.current;
    pending.current = null;
    setTimeout(run);
  }, [open]);
  // In the app's main, as the other dialogs are, so it takes the panel theme.
  const host = document.querySelector("main.command-app") ?? document.body;
  return createPortal(
    <AnimatePresence>
      {open && (
        <PaletteDialog
          commands={commands}
          onClose={() => setOpen(false)}
          onRun={(command) => {
            pending.current = command.run;
            setOpen(false);
          }}
        />
      )}
    </AnimatePresence>,
    host,
  );
}

function PaletteDialog({
  commands,
  onClose,
  onRun,
}: {
  commands: Command[];
  onClose: () => void;
  onRun: (command: Command) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const present = useIsPresent();
  useFocusTrap(dialog, input, present);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = rankCommands(commands, query);
  const searching = query.trim() !== "";
  const current = Math.min(active, results.length - 1);
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
  useLayoutEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current, query]);
  const move = (to: number) =>
    results.length && setActive((to + results.length) % results.length);
  const optionId = (i: number) => `${listId}-${i}`;
  return (
    <motion.div
      className="modal-backdrop palette-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      onClick={onClose}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Command palette"
        className="command-palette panel"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.1 } }}
        onClick={(e) => e.stopPropagation()}
        // Keys pressed here are the palette's (not J/K/N/D shortcuts).
        onKeyDown={(e) => {
          if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation();
        }}
      >
        <label className="palette-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              results.length ? optionId(current) : undefined
            }
            placeholder="Type a command, or an agent, workspace or project…"
            {...plainText}
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              const go = {
                ArrowDown: current + 1,
                ArrowUp: current - 1,
                PageDown: current + 8,
                PageUp: current - 8,
              }[e.key as "ArrowDown"];
              if (go !== undefined) {
                e.preventDefault();
                if (e.key.startsWith("Page"))
                  setActive(Math.max(0, Math.min(results.length - 1, go)));
                else move(go);
              } else if (e.key === "Enter" && results[current]) {
                e.preventDefault();
                onRun(results[current]);
              }
            }}
          />
        </label>
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="palette-list"
        >
          {results.map((command, i) => (
            <PaletteRow
              key={command.id}
              id={optionId(i)}
              index={i}
              command={command}
              heading={
                !searching && command.group !== results[i - 1]?.group
                  ? command.group
                  : undefined
              }
              searching={searching}
              active={i === current}
              onHover={() => setActive(i)}
              onRun={() => onRun(command)}
            />
          ))}
        </ul>
        {!results.length && (
          <p className="palette-empty" role="status">
            Nothing matches “{query.trim()}”.
          </p>
        )}
      </motion.section>
    </motion.div>
  );
}

function PaletteRow({
  id,
  index,
  command,
  heading,
  searching,
  active,
  onHover,
  onRun,
}: {
  id: string;
  index: number;
  command: Command;
  heading?: string;
  searching: boolean;
  active: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  return (
    <>
      {heading && (
        <li role="presentation" className="palette-heading section-label">
          {heading}
        </li>
      )}
      <li
        id={id}
        role="option"
        aria-selected={active}
        data-index={index}
        className="palette-row"
        // Moving, not entering: a list scrolled under a still pointer keeps
        // the keyboard's choice.
        onMouseMove={active ? undefined : onHover}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRun}
      >
        <span className="palette-label">
          {command.label}
          {command.detail && <small>{command.detail}</small>}
        </span>
        {command.keys ? (
          <span className="palette-keys">
            {command.keys[0].map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        ) : (
          searching && <span className="palette-group">{command.group}</span>
        )}
      </li>
    </>
  );
}
