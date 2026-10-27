import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import {
  MAX_NAME,
  cleanName,
  takeRenameRequest,
  useRenames,
  type RenameKind,
} from "./renames";

/**
 * A title that can be renamed in place: the pencil (or a double-click)
 * turns the heading into a field of the same size; Enter or leaving it
 * saves, Escape cancels. Saving an empty or unchanged name changes nothing.
 */
export function InlineName({
  kind,
  renameKey,
  shown,
  value,
  disabled,
  onSave,
}: {
  kind: RenameKind;
  /** The agent's or workspace's key in the fleet (for "Rename…" requests). */
  renameKey: string;
  /** The name as shown (cleaned of IDs). */
  shown: string;
  /** The name as stored, to edit. */
  value: string;
  disabled?: boolean;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  /** Set once the edit is saved or cancelled, so blur doesn't save again. */
  const done = useRef(false);
  const renames = useRenames();
  const label = `Rename ${kind}`;

  const start = () => {
    if (disabled) return;
    done.current = false;
    setDraft(value);
  };
  // A "Rename…" asked for elsewhere (a fleet row) opens the editor.
  useEffect(() => {
    if (!disabled && takeRenameRequest(kind, renameKey)) {
      done.current = false;
      setDraft(value);
    }
  }, [renames, kind, renameKey, disabled, value]);
  // Focus and select the name when the editor opens.
  const editing = draft !== null;
  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  const finish = (save: boolean) => {
    if (done.current || draft === null) return;
    done.current = true;
    const name = cleanName(draft);
    setDraft(null);
    if (save && name && name !== cleanName(value)) onSave(name);
    // Back to the pencil, so the keyboard keeps its place.
    requestAnimationFrame(() => pencil.current?.focus({ preventScroll: true }));
  };

  if (draft !== null)
    return (
      <div className="inline-name editing">
        <h2>
          <input
            ref={input}
            className="inline-name-input"
            aria-label={label}
            aria-description="Enter saves, Escape cancels"
            value={draft}
            maxLength={MAX_NAME}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                finish(true);
              } else if (e.key === "Escape") {
                // Cancel the edit, not the view.
                e.preventDefault();
                e.nativeEvent.stopPropagation();
                finish(false);
              }
            }}
            onBlur={() => finish(true)}
          />
        </h2>
      </div>
    );
  return (
    <div className="inline-name">
      <h2 onDoubleClick={start}>{shown}</h2>
      {!disabled && (
        <button
          ref={pencil}
          className="icon-btn inline-name-edit"
          data-tip={label}
          aria-label={label}
          onClick={start}
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}
