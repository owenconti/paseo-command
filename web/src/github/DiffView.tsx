import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Copy,
  FileMinus,
  FilePlus,
  FileText,
  Folder,
  MessageSquare,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import { getSingularPatch, type DiffLineAnnotation, type FileDiffMetadata, type SelectedLineRange } from "@pierre/diffs";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { copyText } from "../nativePlatform";
import { useTheme } from "../theme";
import { Avatar, Body, CommentBox, Time } from "./bits";
import { DIFF_THEMES } from "./diffWorkers";
import type { ReviewDraft } from "./drafts";
import { anchorKey, byDirectory, lineCount, patchOf, placeThreads, splitPath, type Anchor, type Side } from "./rows";
import type { DiffFile, DraftComment, ReviewThread } from "./types";

export type DiffLayout = "unified" | "split";

/** What a PR's review adds to its diff: threads, your drafted comments, and viewed files. */
export type DiffReview = {
  threads: ReviewThread[];
  drafts: ReviewDraft["comments"];
  onAdd: (c: DraftComment) => void;
  onEdit: (id: string, body: string) => void;
  onRemove: (id: string) => void;
  /** Answers whether it went through. */
  onReply: (thread: ReviewThread, body: string) => Promise<boolean>;
  onResolve: (thread: ReviewThread, resolved: boolean) => void;
  /** Posts one comment at once, outside a review. */
  onSingle?: (c: DraftComment) => Promise<boolean>;
  viewed: ReadonlyMap<string, boolean>;
  onViewed: (path: string, viewed: boolean) => void;
};

export type DiffViewHandle = {
  /** Scrolls to the next (1) or previous (−1) file; answers its path. */
  step: (by: 1 | -1) => string | undefined;
  /** Scrolls to a file. */
  show: (path: string) => void;
  /** The file in view. */
  current: () => string | undefined;
};

/** Files with more lines than this show folded until asked. */
const BIG_FILE = 1500;

/** The comment being written: on one line, or a range of them on one side. */
type Composing = { path: string; side: Side; line: number; startLine?: number };

/** Our sides as @pierre/diffs names them, and back. */
const toSide = (s: Side) => (s === "LEFT" ? "deletions" : "additions");
const fromSide = (s: string | undefined): Side => (s === "deletions" ? "LEFT" : "RIGHT");

function Thread({ thread, review }: { thread: ReviewThread; review: DiffReview }) {
  const [open, setOpen] = useState(!thread.isResolved);
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOpen(!thread.isResolved), [thread.isResolved]);
  const first = thread.comments[0];
  return (
    <div className={`gh-thread${thread.isResolved ? " resolved" : ""}`}>
      {thread.isResolved && (
        <button className="gh-thread-fold" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          <CircleCheck size={12} aria-hidden="true" />
          Resolved{first ? ` · ${first.author?.login ?? "ghost"}: ${first.body.slice(0, 80)}` : ""}
        </button>
      )}
      {open && (
        <>
          {thread.isOutdated && <p className="gh-thread-outdated">Outdated</p>}
          {thread.comments.map((c) => (
            <div key={c.id} className="gh-thread-comment">
              <div className="gh-thread-meta">
                <Avatar person={c.author} size={18} />
                <b>{c.author?.login ?? "ghost"}</b>
                <Time at={c.createdAt} />
              </div>
              <Body text={c.body} />
            </div>
          ))}
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
                  const ok = await review.onReply(thread, text);
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
                  <button className="secondary" onClick={() => review.onResolve(thread, !thread.isResolved)}>
                    {thread.isResolved ? <Undo2 size={12} aria-hidden="true" /> : <CircleCheck size={12} aria-hidden="true" />}
                    {thread.isResolved ? "Unresolve" : "Resolve conversation"}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Draft({ draft, review }: { draft: ReviewDraft["comments"][number]; review: DiffReview }) {
  const [editing, setEditing] = useState(!draft.body);
  if (editing)
    return (
      <div className="gh-draft editing">
        <CommentBox
          autoFocus
          initial={draft.body}
          submitLabel="Save"
          onCancel={() => (draft.body ? setEditing(false) : review.onRemove(draft.id))}
          onSubmit={(text) => {
            review.onEdit(draft.id, text);
            setEditing(false);
            return true;
          }}
        />
      </div>
    );
  return (
    <div className="gh-draft">
      <div className="gh-thread-meta">
        <span className="gh-pending">Pending</span>
        {draft.startLine !== undefined && draft.startLine !== draft.line && (
          <span className="gh-hint">
            Lines {draft.startLine}–{draft.line}
          </span>
        )}
        <span className="gh-spacer" />
        <button className="icon-btn" aria-label="Edit comment" data-tip="Edit" onClick={() => setEditing(true)}>
          <Pencil size={12} aria-hidden="true" />
        </button>
        <button className="icon-btn" aria-label="Delete comment" data-tip="Delete" onClick={() => review.onRemove(draft.id)}>
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>
      <Body text={draft.body} />
    </div>
  );
}

/** What hangs under a line: its threads, your drafts on it, and the comment being written there. */
function Notes({
  path,
  anchors,
  threads,
  review,
  composing,
  setComposing,
}: {
  path: string;
  anchors: Anchor[];
  threads: Map<string, ReviewThread[]>;
  review?: DiffReview;
  composing: Composing | null;
  setComposing: (c: Composing | null) => void;
}) {
  if (!review) return null;
  const keys = anchors.map(anchorKey);
  const here = keys.flatMap((k) => threads.get(k) ?? []);
  const drafts = review.drafts.filter((d) => d.path === path && keys.includes(anchorKey({ side: d.side, line: d.line })));
  const writing = composing && composing.path === path && keys.includes(anchorKey({ side: composing.side, line: composing.line }));
  if (!here.length && !drafts.length && !writing) return null;
  const comment = (body: string): DraftComment => ({
    path,
    line: composing!.line,
    side: composing!.side,
    ...(composing!.startLine !== undefined ? { startLine: composing!.startLine, startSide: composing!.side } : {}),
    body,
  });
  return (
    <div className="gh-notes">
      {here.map((t) => (
        <Thread key={t.id} thread={t} review={review} />
      ))}
      {drafts.map((d) => (
        <Draft key={d.id} draft={d} review={review} />
      ))}
      {writing && (
        <div className="gh-draft editing">
          {composing.startLine !== undefined && (
            <p className="gh-hint">
              Commenting on lines {composing.startLine}–{composing.line}
            </p>
          )}
          <CommentBox
            autoFocus
            submitLabel="Add review comment"
            onCancel={() => setComposing(null)}
            extra={(text) =>
              review.onSingle && (
                <button
                  className="secondary"
                  disabled={!text.trim()}
                  onClick={async () => {
                    if (await review.onSingle!(comment(text))) setComposing(null);
                  }}
                >
                  Add single comment
                </button>
              )
            }
            onSubmit={(text) => {
              review.onAdd(comment(text));
              setComposing(null);
              return true;
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A file's changes, drawn by @pierre/diffs (unified or split, Shiki's
 * highlighting, wrapped lines). In a review, its gutter's + takes a comment
 * on a line, or on the lines dragged across; threads, your drafts and the
 * comment being written hang under their lines as its annotations.
 */
function FileBody({
  file,
  layout,
  review,
  composing,
  setComposing,
}: {
  file: DiffFile;
  layout: DiffLayout;
  review?: DiffReview;
  composing: Composing | null;
  setComposing: (c: Composing | null) => void;
}) {
  const { resolved } = useTheme();
  const fileDiff = useMemo<FileDiffMetadata | null>(() => {
    if (file.status === "binary" || file.status === "too_large" || !file.hunks.length) return null;
    try {
      return getSingularPatch(patchOf(file));
    } catch {
      return null;
    }
  }, [file]);
  const { placed, apart } = useMemo(() => placeThreads(file, review?.threads ?? []), [file, review?.threads]);
  // One annotation per line that has something under it.
  const annotations = useMemo<DiffLineAnnotation<string>[]>(() => {
    if (!review) return [];
    const keys = new Set<string>(placed.keys());
    for (const d of review.drafts) if (d.path === file.path) keys.add(anchorKey({ side: d.side, line: d.line }));
    if (composing) keys.add(anchorKey({ side: composing.side, line: composing.line }));
    return [...keys].map((key) => {
      const [side, line] = key.split(":");
      return { side: toSide(side as Side), lineNumber: Number(line), metadata: key };
    });
  }, [review, placed, file.path, composing]);
  const options = useMemo(
    () => ({
      diffStyle: layout,
      overflow: "wrap" as const,
      disableFileHeader: true,
      themeType: resolved === "light" ? ("light" as const) : ("dark" as const),
      theme: DIFF_THEMES,
      enableGutterUtility: !!review,
      onGutterUtilityClick: (range: SelectedLineRange) => {
        const side = fromSide(range.endSide ?? range.side);
        const lo = Math.min(range.start, range.end);
        const hi = Math.max(range.start, range.end);
        setComposing({ path: file.path, side, line: hi, ...(lo !== hi && fromSide(range.side) === side ? { startLine: lo } : {}) });
      },
    }),
    [layout, resolved, review, file.path, setComposing],
  );
  const selected = useMemo<SelectedLineRange | null>(
    () =>
      composing
        ? { start: composing.startLine ?? composing.line, end: composing.line, side: toSide(composing.side), endSide: toSide(composing.side) }
        : null,
    [composing],
  );
  if (file.status === "binary") return <p className="gd-note">Binary file not shown.</p>;
  if (file.status === "too_large") return <p className="gd-note">This file’s diff is too large to show.</p>;
  if (!file.hunks.length)
    return <p className="gd-note">{file.oldPath && file.oldPath !== file.path ? "Renamed without changes." : "No changes to show."}</p>;
  if (!fileDiff) return <p className="gd-note">This file’s diff couldn’t be drawn.</p>;
  return (
    <>
      {apart.length > 0 && (
        <div className="gh-notes apart">
          <p className="gh-hint">
            <MessageSquare size={12} aria-hidden="true" /> {apart.length === 1 ? "A conversation" : `${apart.length} conversations`} on
            lines this diff no longer shows
          </p>
          {review && apart.map((t) => <Thread key={t.id} thread={t} review={review} />)}
        </div>
      )}
      <FileDiff<string>
        className="gd-diff"
        fileDiff={fileDiff}
        options={options}
        lineAnnotations={annotations}
        selectedLines={selected}
        renderAnnotation={(a) => {
          const [side, line] = (a.metadata ?? "").split(":");
          return (
            <Notes
              path={file.path}
              anchors={[{ side: side as Side, line: Number(line) }]}
              threads={placed}
              review={review}
              composing={composing}
              setComposing={setComposing}
            />
          );
        }}
      />
    </>
  );
}

function FileIcon({ file }: { file: DiffFile }) {
  if (file.isNew) return <FilePlus size={13} aria-hidden="true" className="gd-file-icon add" />;
  if (file.isDeleted) return <FileMinus size={13} aria-hidden="true" className="gd-file-icon del" />;
  return <FileText size={13} aria-hidden="true" className="gd-file-icon" />;
}

/** The share of a file's lines added, as five squares, as GitHub shows it. */
function ChurnBar({ file }: { file: DiffFile }) {
  const total = file.additions + file.deletions;
  const adds = total ? Math.round((file.additions / total) * 5) : 0;
  const dels = total ? Math.min(5 - adds, Math.round((file.deletions / total) * 5)) : 0;
  return (
    <span className="gd-churn-bar" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < adds ? "add" : i < adds + dels ? "del" : ""} />
      ))}
    </span>
  );
}

const FileSection = memo(function FileSection({
  file,
  layout,
  review,
  folded,
  onFold,
  composing,
  setComposing,
  notes,
}: {
  file: DiffFile;
  layout: DiffLayout;
  review?: DiffReview;
  folded: boolean;
  onFold: (path: string, folded: boolean) => void;
  composing: Composing | null;
  setComposing: (c: Composing | null) => void;
  notes: number;
}) {
  const viewed = review?.viewed.get(file.path) ?? false;
  const { dir, name } = splitPath(file.path);
  return (
    <section className={`gd-file${folded ? " folded" : ""}`} data-path={file.path} aria-label={file.path}>
      <header className="gd-file-head">
        <button className="gd-fold" aria-expanded={!folded} aria-label={folded ? `Show ${file.path}` : `Fold ${file.path}`} onClick={() => onFold(file.path, !folded)}>
          {folded ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        <FileIcon file={file} />
        <span className="gd-file-path" title={file.path}>
          {file.oldPath && file.oldPath !== file.path && <span className="gd-old-path">{file.oldPath} → </span>}
          {dir && <span className="gd-dir">{dir}/</span>}
          <b>{name}</b>
        </span>
        <button className="icon-btn" aria-label="Copy path" data-tip="Copy path" onClick={() => void copyText(file.path).catch(() => {})}>
          <Copy size={12} aria-hidden="true" />
        </button>
        <span className="gh-spacer" />
        {notes > 0 && (
          <span className="gh-comment-count" aria-label={`${notes} comments`}>
            <MessageSquare size={12} aria-hidden="true" />
            {notes}
          </span>
        )}
        <span className="gh-churn">
          <span className="add">+{file.additions}</span>
          <span className="del">−{file.deletions}</span>
        </span>
        <ChurnBar file={file} />
        {review && (
          <label className={`gd-viewed${viewed ? " on" : ""}`} data-tip="Mark viewed (V)">
            <input type="checkbox" checked={viewed} onChange={(e) => review.onViewed(file.path, e.target.checked)} />
            Viewed
          </label>
        )}
      </header>
      {!folded && <FileBody file={file} layout={layout} review={review} composing={composing} setComposing={setComposing} />}
      {folded && lineCount(file) > BIG_FILE && !viewed && (
        <button className="gd-load" onClick={() => onFold(file.path, false)}>
          Large diff ({lineCount(file).toLocaleString()} lines) not shown. Show it
        </button>
      )}
    </section>
  );
});

/**
 * A diff: the changed files listed on the left (by directory, each with its
 * counts and, in a review, whether you've viewed it), their changes on the
 * right, unified or split. In a review, each line's gutter takes a comment
 * (⇧-click another line for a range): it goes in your pending review, or at
 * once as a single comment; threads sit under their lines, with Reply and
 * Resolve. Viewed and big files show folded.
 */
export function DiffView({
  files,
  layout,
  review,
  listShown = true,
  empty,
  head,
  handle,
}: {
  files: DiffFile[];
  layout: DiffLayout;
  review?: DiffReview;
  listShown?: boolean;
  empty: ReactNode;
  /** Over the diff, under its own scroll. */
  head?: ReactNode;
  handle?: Ref<DiffViewHandle>;
}) {
  // The virtualizer's own element scrolls (it draws only the lines in view); this finds it.
  const wrap = useRef<HTMLDivElement>(null);
  const scrollerOf = () => wrap.current?.querySelector<HTMLElement>(":scope > .gd-scroll") ?? null;
  const [composing, setComposing] = useState<Composing | null>(null);
  // Folding: what you chose, else viewed and big files fold.
  const [chosen, setChosen] = useState<Map<string, boolean>>(new Map());
  const isFolded = (f: DiffFile) => chosen.get(f.path) ?? (!!review?.viewed.get(f.path) || lineCount(f) > BIG_FILE);
  const onFold = useCallback((path: string, folded: boolean) => setChosen((m) => new Map(m).set(path, folded)), []);
  // Marking a file viewed folds it, as GitHub does; unmarking shows it.
  const onViewed = review?.onViewed;
  const reviewed = useMemo<DiffReview | undefined>(
    () =>
      review && {
        ...review,
        onViewed: (path, viewed) => {
          setChosen((m) => new Map(m).set(path, viewed));
          onViewed!(path, viewed);
        },
      },
    [review, onViewed],
  );

  const [current, setCurrent] = useState<string | undefined>(files[0]?.path);
  useEffect(() => {
    const el = scrollerOf();
    if (!el) return;
    // Which file is in view, once a frame at most.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const measure = () => {
      const top = el.getBoundingClientRect().top + 8;
      let at: string | undefined;
      for (const s of el.querySelectorAll<HTMLElement>(".gd-file")) {
        if (s.getBoundingClientRect().bottom > top) {
          at = s.dataset.path;
          break;
        }
      }
      setCurrent(at);
    };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [files]);

  const show = useCallback((path: string) => {
    const scroller = scrollerOf();
    const el = scroller?.querySelector<HTMLElement>(`.gd-file[data-path="${CSS.escape(path)}"]`);
    if (el && scroller) {
      scroller.scrollTo({ top: scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top });
      setCurrent(path);
    }
  }, []);
  useImperativeHandle(
    handle,
    () => ({
      step: (by) => {
        if (!files.length) return undefined;
        const at = files.findIndex((f) => f.path === current);
        const next = files[Math.min(files.length - 1, Math.max(0, at < 0 ? 0 : at + by))]!;
        show(next.path);
        return next.path;
      },
      show,
      current: () => current,
    }),
    [files, current, show],
  );

  const notesOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of review?.threads ?? []) counts.set(t.path, (counts.get(t.path) ?? 0) + t.comments.length);
    for (const d of review?.drafts ?? []) counts.set(d.path, (counts.get(d.path) ?? 0) + 1);
    return counts;
  }, [review?.threads, review?.drafts]);

  const viewedCount = review ? files.filter((f) => review.viewed.get(f.path)).length : 0;

  return (
    <div className={`gd-view${listShown && files.length ? " with-list" : ""}`}>
      {listShown && files.length > 0 && (
        <nav className="gd-list" aria-label="Changed files">
          <p className="gd-list-head">
            {files.length === 1 ? "1 file" : `${files.length} files`}
            {review && (
              <span className="gh-hint">
                {viewedCount} / {files.length} viewed
              </span>
            )}
          </p>
          {byDirectory(files).map((g) => (
            <div key={g.dir} className="gd-list-group">
              {g.dir && (
                <p className="gd-list-dir" title={g.dir}>
                  <Folder size={12} aria-hidden="true" />
                  {g.dir}
                </p>
              )}
              {g.files.map((f) => (
                <button
                  key={f.path}
                  className={`gd-list-file${current === f.path ? " current" : ""}${review?.viewed.get(f.path) ? " viewed" : ""}`}
                  onClick={() => show(f.path)}
                  title={f.path}
                >
                  <FileIcon file={f} />
                  <span className="gd-list-name">{splitPath(f.path).name}</span>
                  {(notesOf.get(f.path) ?? 0) > 0 && <MessageSquare size={11} aria-hidden="true" className="gd-list-notes" />}
                  <span className="gh-churn small">
                    {f.additions > 0 && <span className="add">+{f.additions}</span>}
                    {f.deletions > 0 && <span className="del">−{f.deletions}</span>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      )}
      <div className="gd-scroll-wrap" ref={wrap}>
        <Virtualizer className="gd-scroll">
          {head}
          {files.length ? (
            files.map((f) => (
              <FileSection
                key={f.path}
                file={f}
                layout={layout}
                review={reviewed}
                folded={isFolded(f)}
                onFold={onFold}
                composing={composing?.path === f.path ? composing : null}
                setComposing={setComposing}
                notes={notesOf.get(f.path) ?? 0}
              />
            ))
          ) : (
            <div className="gh-empty">{empty}</div>
          )}
        </Virtualizer>
      </div>
    </div>
  );
}
