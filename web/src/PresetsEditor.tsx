import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { ArrowDown, ArrowUp, Plus, Trash2, X, Zap } from "lucide-react";
import { useFocusTrap } from "./focus";
import { errorMessage } from "./api";
import {
  closePresetEditor,
  savePresets,
  refreshPresets,
  usePresetEditorOpen,
} from "./presetsStore";
import type { Preset } from "./presets";

/**
 * The preset prompts' editor, opened from Settings or New agent: each
 * preset's name and prompt, in order, saved to settings.json. Cancel (or
 * Esc) drops the edits. Rendered once, in the app's main.
 */
export function PresetsEditorHost() {
  const open = usePresetEditorOpen();
  // In the app's main, as the other dialogs are, so it takes the panel theme.
  const host = document.querySelector("main.command-app") ?? document.body;
  return createPortal(
    <AnimatePresence>{open && <PresetsEditor key="presets" />}</AnimatePresence>,
    host,
  );
}

type Row = Preset & { key: number };
let keys = 0;

function PresetsEditor() {
  // The drafts start from the file as it is when the editor opens.
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const present = useIsPresent();
  useFocusTrap(dialog, first, present);
  useLayoutEffect(() => {
    if (!present && dialog.current?.contains(document.activeElement))
      (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  useEffect(() => {
    let live = true;
    void refreshPresets().then(({ presets, error }) => {
      if (!live) return;
      setRows(presets.map((p) => ({ ...p, key: ++keys })));
      setUnreadable(error);
    });
    return () => {
      live = false;
    };
  }, []);

  const list = rows ?? [];
  const edit = (key: number, change: Partial<Preset>) =>
    setRows(list.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const move = (i: number, by: number) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setRows(next);
  };
  const add = () => {
    const key = ++keys;
    setRows([...list, { name: "", prompt: "", key }]);
    // Focus the new preset's name once it's drawn.
    setTimeout(() =>
      dialog.current
        ?.querySelector<HTMLInputElement>(`[data-preset="${key}"] input`)
        ?.focus(),
    );
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await savePresets(list.map(({ name, prompt }) => ({ name, prompt })));
      closePresetEditor();
    } catch (e) {
      setError(errorMessage(e) || "Couldn't save the presets.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="modal-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={closePresetEditor}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="presets-title"
        aria-describedby="presets-description"
        className="command-dialog presets-dialog panel"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 15, scale: 0.97, transition: { duration: 0.12 } }}
        onClick={(e) => e.stopPropagation()}
        // Keys typed here are the editor's (not the app's shortcuts).
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            closePresetEditor();
          }
          if (e.key !== "Tab") e.stopPropagation();
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="presets-title">Preset prompts</h2>
            <p id="presets-description">
              Each one is a button in New agent that starts the agent at once.{" "}
              <code>{"{{pr}}"}</code> becomes the chosen pull request.
            </p>
          </div>
          <button
            className="icon-btn"
            aria-label="Close without saving"
            data-tip="Close without saving (Esc)"
            onClick={closePresetEditor}
          >
            <X size={18} />
          </button>
        </div>
        {unreadable && (
          <p className="presets-error" role="alert">
            {unreadable} Fix or remove ~/.paseo-command/settings.json before editing presets here.
          </p>
        )}
        <ol className="presets-list">
          {list.map((row, i) => (
            <li key={row.key} data-preset={row.key}>
              <div className="presets-row-head">
                <label>
                  <span>Name</span>
                  <input
                    value={row.name}
                    maxLength={60}
                    placeholder="Review PR"
                    autoComplete="off"
                    onChange={(e) => edit(row.key, { name: e.target.value })}
                  />
                </label>
                <div className="presets-row-actions">
                  <button
                    className="icon-btn"
                    aria-label={`Move “${row.name || "preset"}” up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Move “${row.name || "preset"}” down`}
                    disabled={i === list.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Delete “${row.name || "preset"}”`}
                    onClick={() => setRows(list.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <label>
                <span>Prompt</span>
                <textarea
                  value={row.prompt}
                  rows={4}
                  placeholder="Review {{pr}}. List bugs and risks, most severe first."
                  onChange={(e) => edit(row.key, { prompt: e.target.value })}
                />
              </label>
            </li>
          ))}
        </ol>
        {rows?.length === 0 && (
          <p className="presets-empty">
            <Zap size={14} aria-hidden="true" /> No presets yet.
          </p>
        )}
        <button ref={first} className="secondary presets-add" onClick={add} disabled={!rows || !!unreadable}>
          <Plus size={14} />
          Add preset
        </button>
        <div className="dialog-actions">
          {error && (
            <p className="presets-error" role="alert">
              {error}
            </p>
          )}
          <button className="secondary" onClick={closePresetEditor}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={saving || !rows || !!unreadable}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
