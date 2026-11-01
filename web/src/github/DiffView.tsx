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
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { copyText } from "../nativePlatform";
import { highlight } from "../highlight";
import { Avatar, Body, CommentBox, Time } from "./bits";
import type { ReviewDraft } from "./drafts";
import {
  anchorKey,
  byDirectory,
  lineCount,
  placeThreads,
  splitPath,
  splitRows,
  unifiedRows,
  type Anchor,
  type Cell,
  type Side,
} from "./rows";
import type { DiffFile, DiffLine, DraftComment, ReviewThread } from "./types";

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

const EXT_LANG: Record<string, string> = { mts: "ts", cts: "ts", yml: "yaml", md: "markdown", h: "c", hpp: "cpp", cc: "cpp" };
const langOf = (path: string) => {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  if (path.endsWith("Dockerfile")) return "sh";
  return EXT_LANG[ext] ?? ext;
};

/** A line's text with its highlight: the daemon's tokens, else the page's own highlighter. */
const Code = memo(function Code({ line, lang }: { line: DiffLine; lang: string }) {
  if (line.tokens?.length)
    return (
      <>
        {line.tokens.map((t, i) =>
          t.style ? (
            <span key={i} className={t.style.split(/\s+/).map((s) => `tk-${s}`).join(" ")}>
              {t.text}
            </span>
          ) : (
            t.text
          ),
        )}
      </>
    );
  if (!lang) return <>{line.content}</>;
  return (
    <>
      {highlight(line.content, lang).map((t, i) =>
        t.kind ? (
          <span key={i} className={`tk-${t.kind}`}>
            {t.text}
          </span>
        ) : (
          t.text
        ),
      )}
    </>
  );
});

const SIGN = { add: "+", remove: "−", context: " " } as const;

/** The comment being written: on one line, or a range of them on one side. */
type Composing = { path: string; side: Side; line: number; startLine?: number };
const inRange = (c: Composing | null, path: string, a: Anchor) =>
  !!c && c.path === path && c.side === a.side && a.line <= c.line && a.line >= (c.startLine ?? c.line);

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

function Gutter({
  cell,
  path,
  review,
  composing,
  onComment,
  both,
}: {
  cell: Cell;
  path: string;
  review?: DiffReview;
  composing: Composing | null;
  onComment: (path: string, a: Anchor, extend: boolean) => void;
  /** Unified: both numbers; split: the side's own. */
  both: boolean;
}) {
  const num = (n: number | null) => <span className="gd-num">{n ?? ""}</span>;
  return (
    <>
      {both ? (
        <>
          {num(cell.old)}
          {num(cell.new)}
        </>
      ) : (
        num(cell.anchor.side === "LEFT" ? cell.old : cell.new)
      )}
      {review && (
        <button
          className="gd-add"
          tabIndex={-1}
          aria-label={`Comment on line ${cell.anchor.line}`}
          data-tip={composing ? "Comment (⇧-click to take in lines)" : "Comment on this line (⇧-click another to take in a range)"}
          onClick={(e) => onComment(path, cell.anchor, e.shiftKey)}
        >
          <Plus size={11} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

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
  const lang = useMemo(() => langOf(file.path), [file.path]);
  const { placed, apart } = useMemo(() => placeThreads(file, review?.threads ?? []), [file, review?.threads]);
  const onComment = useCallback(
    (path: string, a: Anchor, extend: boolean) => {
      if (extend && composing && composing.path === path && composing.side === a.side && composing.line !== a.line) {
        const lo = Math.min(composing.startLine ?? composing.line, composing.line, a.line);
        const hi = Math.max(composing.line, a.line);
        setComposing({ path, side: a.side, line: hi, startLine: lo });
      } else setComposing({ path, side: a.side, line: a.line });
    },
    [composing, setComposing],
  );
  if (file.status === "binary") return <p className="gd-note">Binary file not shown.</p>;
  if (file.status === "too_large") return <p className="gd-note">This file’s diff is too large to show.</p>;
  if (!file.hunks.length)
    return <p className="gd-note">{file.oldPath && file.oldPath !== file.path ? "Renamed without changes." : "No changes to show."}</p>;
  const notes = (anchors: Anchor[]) => (
    <Notes path={file.path} anchors={anchors} threads={placed} review={review} composing={composing} setComposing={setComposing} />
  );
  const code = (cell: Cell) => (
    <>
      <span className="gd-sign" aria-hidden="true">
        {SIGN[cell.type]}
      </span>
      <code className="gd-code">
        <Code line={cell.line} lang={lang} />
      </code>
    </>
  );
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
      {layout === "unified" ? (
        <div className="gd-lines unified">
          {unifiedRows(file).map((row) =>
            row.kind === "hunk" ? (
              <div key={row.key} className="gd-hunk">
                {row.header}
              </div>
            ) : (
              <div key={row.key}>
                <div className={`gd-row ${row.type}${inRange(composing, file.path, row.anchor) ? " picked" : ""}`}>
                  <Gutter cell={row} path={file.path} review={review} composing={composing} onComment={onComment} both />
                  {code(row)}
                </div>
                {notes([row.anchor, ...(row.type === "context" && row.old !== null ? [{ side: "LEFT" as const, line: row.old }] : [])])}
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="gd-lines split">
          {splitRows(file).map((row) =>
            row.kind === "hunk" ? (
              <div key={row.key} className="gd-hunk">
                {row.header}
              </div>
            ) : (
              <div key={row.key}>
                <div className="gd-pair">
                  {[row.left, row.right].map((cell, i) =>
                    cell ? (
                      <div
                        key={i}
                        className={`gd-row ${cell.type}${inRange(composing, file.path, cell.anchor) ? " picked" : ""}`}
                      >
                        <Gutter cell={cell} path={file.path} review={review} composing={composing} onComment={onComment} both={false} />
                        {code(cell)}
                      </div>
                    ) : (
                      <div key={i} className="gd-row empty" />
                    ),
                  )}
                </div>
                {notes([row.left?.anchor, row.right?.anchor].filter((a): a is Anchor => !!a))}
              </div>
            ),
          )}
        </div>
      )}
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
  const scroller = useRef<HTMLDivElement>(null);
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
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
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
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [files]);

  const show = useCallback((path: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`.gd-file[data-path="${CSS.escape(path)}"]`);
    if (el && scroller.current) {
      // The scroller is the sections' offset parent.
      scroller.current.scrollTo({ top: el.offsetTop });
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
      <div className="gd-scroll" ref={scroller}>
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
      </div>
    </div>
  );
}
