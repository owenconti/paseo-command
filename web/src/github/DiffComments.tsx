import { memo, useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, MessageSquare, Plus } from "lucide-react";
import { Avatar } from "./bits";
import { isDim, readDiffSidebar, writeDiffSidebar, type DiffKind, type DiffSidebar, type NoteEntry, type NoteGroup } from "./commentList";
import { splitPath } from "./rows";
import type { Person } from "./types";

const Entry = memo(function Entry({
  entry,
  current,
  local,
  me,
  onShow,
}: {
  entry: NoteEntry;
  current: boolean;
  local: boolean;
  me?: Person;
  onShow: (e: NoteEntry) => void;
}) {
  const who = entry.kind === "draft" ? (me ?? { login: "you" }) : entry.author;
  const name = entry.kind === "draft" ? "You" : (entry.author?.login ?? "ghost");
  return (
    <button
      className={`gd-note${current ? " current" : ""}${isDim(entry) ? " dim" : ""}`}
      data-entry={entry.id}
      aria-current={current ? "true" : undefined}
      onClick={() => onShow(entry)}
      title={entry.text}
    >
      <span className="gd-note-top">
        <Avatar person={who} size={16} />
        <b className="gd-note-who">{name}</b>
        <span className="gd-note-where" title={entry.side === "LEFT" ? "On the old file’s line" : undefined}>
          {entry.where}
        </span>
        <span className="gh-spacer" />
        {/* On a workspace's Changes every comment is pending: only a PR's drafts are marked. */}
        {entry.kind === "draft" && !local && <span className="gh-pending">Draft</span>}
        {entry.outdated && <span className="gd-note-badge">Outdated</span>}
        {entry.resolved && (
          <span className="gd-note-badge resolved" aria-label="Resolved">
            <CircleCheck size={11} aria-hidden="true" />
          </span>
        )}
        {entry.replies > 0 && (
          <span className="gd-note-replies" aria-label={`${entry.replies} ${entry.replies === 1 ? "reply" : "replies"}`}>
            <MessageSquare size={11} aria-hidden="true" />
            {entry.replies}
          </span>
        )}
      </span>
      <span className="gd-note-text">{entry.text || <i>No text</i>}</span>
    </button>
  );
});

/**
 * The diff sidebar's Comments: each file's threads (and drafts) in the diff's
 * order, the one in view marked; a click shows it in the diff. Resolved and
 * outdated ones hide behind Show resolved.
 */
export function DiffComments({
  groups,
  total,
  dimmed,
  showResolved,
  setShowResolved,
  inView,
  local,
  me,
  onShow,
}: {
  /** What's shown (`shownGroups`). */
  groups: NoteGroup[];
  /** Every entry, and how many of them are resolved or outdated. */
  total: number;
  dimmed: number;
  showResolved: boolean;
  setShowResolved: (on: boolean) => void;
  inView?: string;
  local: boolean;
  me?: Person;
  onShow: (e: NoteEntry) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // The entry in view follows the diff.
  useEffect(() => {
    if (!inView) return;
    list.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(inView)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [inView]);
  const open = total - dimmed;
  return (
    <div className="gd-notes" ref={list}>
      <p className="gd-list-head">
        <span>{total === 0 ? "No comments" : dimmed && !showResolved ? `${open} open` : total === 1 ? "1 comment" : `${total} comments`}</span>
        {dimmed > 0 && (
          <button className="gd-notes-toggle" aria-pressed={showResolved} onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? "Hide resolved" : `Show resolved (${dimmed})`}
          </button>
        )}
      </p>
      {total === 0 ? (
        <div className="gd-notes-empty">
          <MessageSquare size={20} strokeWidth={1.5} aria-hidden="true" />
          <p>
            <b>No comments yet</b>
          </p>
          <p>
            Hover a line and click the <Plus size={11} aria-label="plus" className="gd-notes-plus" /> in its gutter to{" "}
            {local ? "leave a pending comment" : "comment"}; drag across lines for a range.
          </p>
        </div>
      ) : (
        !groups.length && <p className="gd-list-none">Every comment is resolved or outdated.</p>
      )}
      {groups.map((g) => {
        const { dir, name } = splitPath(g.path);
        return (
          <div key={g.path} className="gd-notes-group">
            <p className="gd-notes-file" title={g.path}>
              <span className="gd-notes-name">
                {dir && <span className="gd-dir">{dir}/</span>}
                <b>{name}</b>
              </span>
              <span className="gd-notes-count">{g.entries.length}</span>
            </p>
            {g.entries.map((e) => (
              <Entry key={`${e.kind}:${e.id}`} entry={e} current={inView === e.id} local={local} me={me} onShow={onShow} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** The diff sidebar's Files or Comments, kept per diff kind (a PR's, a workspace's Changes). */
export function useDiffSidebar(kind: DiffKind) {
  const [sidebar, setState] = useState<DiffSidebar>(() => readDiffSidebar(kind));
  const setSidebar = useCallback(
    (s: DiffSidebar) => {
      setState(s);
      writeDiffSidebar(kind, s);
    },
    [kind],
  );
  return [sidebar, setSidebar] as const;
}
