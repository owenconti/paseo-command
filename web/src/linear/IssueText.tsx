import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { readStore, removeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { Markdown } from "../Markdown";
import { Composer } from "./Comments";
import { shownMarkdown } from "./files";
import { linearStore } from "./store";
import type { LinearIssue } from "./types";

/** Linear's longest title. */
const TITLE_MAX = 255;

/** Where a description being edited is kept until it's saved or cancelled. */
const descriptionDraft = (issueId: string) => `linear:draft:description:${issueId}`;

/** Saves a title or description to Linear, shown at once and rolled back (with a notice) if Linear refuses. */
const update = (issue: LinearIssue, patch: Pick<Partial<LinearIssue>, "title" | "description">) =>
  linearStore.write("issueUpdate", { id: issue.id, ...patch }, { issueId: issue.id, patch });

/**
 * The issue's title, edited in place: click it (or ⌘K "Rename"), then Enter or
 * leaving the field saves and Esc puts it back. An empty title isn't saved.
 */
export function IssueTitle({ issue }: { issue: LinearIssue }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(issue.title);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const start = () => {
    done.current = false;
    setText(issue.title);
    setEditing(true);
  };
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => onAppCommand("linear-edit-title", () => startRef.current()), []);
  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);
  // Another issue opened: leave the edit.
  useEffect(() => setEditing(false), [issue.id]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const title = text.trim();
    if (save && title && title !== issue.title) void update(issue, { title });
  };

  if (!editing)
    return (
      <h1>
        <button
          type="button"
          className="linear-title-edit"
          aria-description="Rename the issue"
          onClick={start}
        >
          {issue.title}
        </button>
      </h1>
    );
  return (
    <h1>
      <input
        ref={field}
        className="linear-title-field"
        aria-label={`${issue.key}'s title`}
        value={text}
        maxLength={TITLE_MAX}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
      />
    </h1>
  );
}

/**
 * The issue's description: Markdown, with Edit (or ⌘K) opening it in a
 * Markdown box (⌘↩ saves, Esc or Cancel leaves it as it was). What's typed is
 * kept until it's saved or cancelled, so a reload or remount reopens the edit.
 * Saving nothing clears the description.
 */
export function IssueDescription({ issue, loaded }: { issue: LinearIssue; loaded: boolean }) {
  const draft = descriptionDraft(issue.id);
  const [editing, setEditing] = useState(() => readStore<string>(draft, "") !== "");
  const startRef = useRef(() => {});
  // The description must be in before it can be edited.
  const ready = issue.description !== undefined || loaded;
  startRef.current = () => ready && setEditing(true);
  useEffect(() => onAppCommand("linear-edit-description", () => startRef.current()), []);
  useEffect(() => setEditing(readStore<string>(descriptionDraft(issue.id), "") !== ""), [issue.id]);

  const cancel = () => {
    removeStore(draft);
    setEditing(false);
  };

  if (editing)
    return (
      <div className="linear-description linear-description-editing">
        <Composer
          key={issue.id}
          draft={draft}
          label={`${issue.key}'s description`}
          placeholder="Add a description…"
          initial={issue.description ?? ""}
          sendLabel="Save"
          autoFocus
          allowEmpty
          onCancel={cancel}
          onSend={async (body) => {
            if (body === (issue.description ?? "").trim()) {
              cancel();
              return true;
            }
            const saved = await update(issue, { description: body });
            if (saved) setEditing(false);
            return saved;
          }}
        />
      </div>
    );
  return (
    <div className="linear-description">
      {issue.description?.trim() ? (
        <Markdown text={shownMarkdown(issue.description, location.origin)} />
      ) : !ready ? (
        <p className="linear-note">Loading the description…</p>
      ) : (
        <p className="linear-note">No description.</p>
      )}
      {ready && (
        <button type="button" className="ghost-btn linear-description-edit" onClick={() => setEditing(true)}>
          <Pencil size={12} aria-hidden="true" />
          {issue.description?.trim() ? "Edit description" : "Add description"}
        </button>
      )}
    </div>
  );
}
