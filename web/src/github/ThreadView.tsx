import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CircleCheck, ExternalLink, FileText, Undo2 } from "lucide-react";
import { getSingularPatch, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useTheme } from "../theme";
import { Avatar, Body, CommentBox, Time } from "./bits";
import { threadHunk, threadLines } from "./conversation";
import { DIFF_THEMES } from "./diffWorkers";
import { hashText } from "./rows";
import type { ReviewThread } from "./types";

/**
 * A review thread's comments and its Reply and Resolve, shared by the diff
 * (under its line) and the Conversation (under its review, or on its own).
 */
export function ThreadBody({
  thread,
  onReply,
  onResolve,
  onExternal,
}: {
  thread: ReviewThread;
  onReply: (thread: ReviewThread, body: string) => Promise<boolean>;
  onResolve: (thread: ReviewThread, resolved: boolean) => void;
  onExternal?: (url: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const more = (thread.totalComments ?? 0) - thread.comments.length;
  const last = thread.comments.at(-1);
  return (
    <>
      {thread.comments.map((c) => (
        <div key={c.id} className="gh-thread-comment" data-comment={c.id}>
          <div className="gh-thread-meta">
            <Avatar person={c.author} size={18} />
            <b>{c.author?.login ?? "ghost"}</b>
            <Time at={c.createdAt} />
          </div>
          <Body text={c.body} html={c.html} />
        </div>
      ))}
      {more > 0 && (
        <p className="gh-thread-more gh-hint">
          {more === 1 ? "1 more reply" : `${more} more replies`} on GitHub
          {onExternal && last?.url && (
            <button className="gh-link" onClick={() => onExternal(last.url)}>
              <ExternalLink size={11} aria-hidden="true" /> See them
            </button>
          )}
        </p>
      )}
      <div className="gh-thread-actions">
        {replying ? (
          <CommentBox
            autoFocus
            placeholder="Reply"
            submitLabel="Reply"
            busy={busy}
            onCancel={() => setReplying(false)}
            onSubmit={async (text) => {
              setBusy(true);
              const ok = await onReply(thread, text);
              setBusy(false);
              if (ok) setReplying(false);
              return ok;
            }}
          />
        ) : (
          <>
            {thread.canReply && (
              <button className="gh-reply-open" onClick={() => setReplying(true)}>
                Reply…
              </button>
            )}
            {thread.canResolve && (
              <button className="page-btn" onClick={() => onResolve(thread, !thread.isResolved)}>
                {thread.isResolved ? <Undo2 size={12} aria-hidden="true" /> : <CircleCheck size={12} aria-hidden="true" />}
                {thread.isResolved ? "Unresolve" : "Resolve conversation"}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** A thread's few lines of diff (its comment's hunk, cut to its last lines), drawn as the diff draws them, unified. */
function HunkPreview({ path, hunk }: { path: string; hunk: string }) {
  const { resolved } = useTheme();
  const fileDiff = useMemo<FileDiffMetadata | null>(() => {
    try {
      const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunk}\n`;
      return { ...getSingularPatch(patch), cacheKey: `gh-hunk:${path}:${hashText(patch)}` };
    } catch {
      return null;
    }
  }, [path, hunk]);
  const options = useMemo(
    () => ({
      diffStyle: "unified" as const,
      overflow: "wrap" as const,
      disableFileHeader: true,
      hunkSeparators: "simple" as const,
      themeType: resolved === "light" ? ("light" as const) : ("dark" as const),
      theme: DIFF_THEMES,
    }),
    [resolved],
  );
  if (!fileDiff) return null;
  return <FileDiff className="gd-diff gh-thread-hunk" fileDiff={fileDiff} options={options} />;
}

/**
 * A thread in the Conversation, as GitHub's: its file and line(s) (a click
 * opens it in Files changed), Outdated, a few lines of the diff around it,
 * then its comments, Reply and Resolve. A resolved one shows folded until
 * opened, or while resolved ones are shown.
 */
export function ConversationThread({
  thread,
  showResolved,
  onReply,
  onResolve,
  onJump,
  onExternal,
}: {
  thread: ReviewThread;
  showResolved: boolean;
  onReply: (thread: ReviewThread, body: string) => Promise<boolean>;
  onResolve: (thread: ReviewThread, resolved: boolean) => void;
  /** Opens Files changed at it. */
  onJump: (thread: ReviewThread) => void;
  onExternal?: (url: string) => void;
}) {
  const [open, setOpen] = useState(!thread.isResolved || showResolved);
  useEffect(() => setOpen(!thread.isResolved || showResolved), [thread.isResolved, showResolved]);
  const hunk = useMemo(() => threadHunk(thread), [thread]);
  const lines = threadLines(thread);
  const first = thread.comments[0];
  return (
    <div className={`gh-thread in-conversation${thread.isResolved ? " resolved" : ""}`} data-thread={thread.id}>
      <div className="gh-thread-head">
        {thread.isResolved && (
          <button className="icon-btn gh-thread-toggle" aria-expanded={open} aria-label={open ? "Fold the resolved conversation" : "Show the resolved conversation"} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          </button>
        )}
        <FileText size={13} aria-hidden="true" className="gh-thread-file-icon" />
        <button className="gh-thread-path" title={`Show ${thread.path} in Files changed`} onClick={() => onJump(thread)}>
          {thread.path}
        </button>
        <span className="gh-hint">{lines === "the file" ? "on the file" : lines}</span>
        {thread.isOutdated && <span className="gh-thread-badge outdated">Outdated</span>}
        {thread.isResolved && (
          <span className="gh-thread-badge resolved">
            <CircleCheck size={11} aria-hidden="true" /> Resolved
          </span>
        )}
        <span className="gh-spacer" />
        <button className="gh-link gh-thread-jump" onClick={() => onJump(thread)}>
          View in Files changed
        </button>
      </div>
      {!open ? (
        <button className="gh-thread-fold" onClick={() => setOpen(true)} aria-expanded={false}>
          Show resolved{first ? ` · ${first.author?.login ?? "ghost"}: ${first.body.slice(0, 80)}` : ""}
        </button>
      ) : (
        <>
          {hunk && <HunkPreview path={thread.path} hunk={hunk} />}
          <ThreadBody thread={thread} onReply={onReply} onResolve={onResolve} onExternal={onExternal} />
        </>
      )}
    </div>
  );
}
