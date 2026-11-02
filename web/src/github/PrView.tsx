import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitCommitHorizontal,
  MessageSquare,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { errorMessage } from "../api";
import { githubWrite, invalidate, load, patch, readPath, useGithubRead } from "./api";
import { Avatar, Body, ChecksIcon, CHECKS_LABEL, Churn, CommentBox, Decision, PrStateIcon, STATE_LABEL, Time } from "./bits";
import { LayoutControls } from "./ChangesView";
import { DiffView, type DiffLayout, type DiffReview, type DiffViewHandle } from "./DiffView";
import { TAB_LABEL } from "./names";
import { addComment, editComment, removeComment, reviewComments, useReviewDraft } from "./drafts";
import type { PrTab } from "./place";
import { OpenPaseoButton } from "./OpenPaseo";
import type { PaseoMatch, PrHead } from "./paseo";
import { Assignees, ChecksSummary, Reviewers, type PeopleChange, type PickerControl } from "./PrSide";
import type { DraftComment, Person, PrDetail, PrDiff, PrReviewer, ReviewEvent, ReviewThread } from "./types";

const VERDICT_LABEL: Record<ReviewEvent, string> = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
};
const VERDICT_HINT: Record<ReviewEvent, string> = {
  COMMENT: "Submit general feedback without explicit approval.",
  APPROVE: "Give your approval to merge these changes.",
  REQUEST_CHANGES: "Submit feedback that must be addressed before merging.",
};
/** The open PR is asked again every minute while it shows. */
const PR_POLL_MS = 60_000;

const REVIEW_STATE_LABEL = { approved: "approved these changes", changes: "requested changes", commented: "reviewed", dismissed: "reviewed (dismissed)" } as const;

/** What ⌘K and the view's keys can do with the open PR. */
export type PrViewApi = {
  openReview: (verdict?: ReviewEvent) => void;
  focusComment: () => void;
  /** Opens the Reviewers or Assignees picker (on Conversation). */
  editPeople: (which: "reviewers" | "assignees") => void;
};

const personOf = (p: Person): Person => ({ login: p.login, ...(p.name ? { name: p.name } : {}), ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}) });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The PR with a reviewers change shown: asked ones requested (a reviewer keeps their verdict), removed ones no longer (dropped unless they reviewed). */
export function withReviewers(pr: PrDetail, c: PeopleChange): PrDetail {
  let reviewers = [...pr.reviewers];
  const items: Pick<PrReviewer, "kind" | "login" | "name" | "avatarUrl">[] = [
    ...c.users.map((u) => ({ kind: "user" as const, ...personOf(u) })),
    ...c.teams.map((t) => ({ kind: "team" as const, login: t.slug, ...(t.name !== t.slug ? { name: t.name } : {}) })),
  ];
  for (const item of items) {
    const at = reviewers.findIndex((r) => r.kind === item.kind && same(r.login, item.login));
    const was = reviewers[at];
    if (c.action === "add") {
      if (was) reviewers[at] = { ...was, requested: true };
      else reviewers.push({ ...item, requested: true, verdict: null });
    } else if (was) {
      if (was.verdict) reviewers[at] = { ...was, requested: false };
      else reviewers = reviewers.filter((_, i) => i !== at);
    }
  }
  return { ...pr, reviewers };
}

/** The PR with an assignees change shown. */
export function withAssignees(pr: PrDetail, c: PeopleChange): PrDetail {
  if (c.action === "remove") return { ...pr, assignees: pr.assignees.filter((a) => !c.users.some((u) => same(u.login, a.login))) };
  const added = c.users.filter((u) => !pr.assignees.some((a) => same(a.login, u.login))).map(personOf);
  return { ...pr, assignees: [...pr.assignees, ...added] };
}

/** Puts back what a refused change touched, from the PR as it was, leaving everything else as it is now. */
function undoPeople(field: "reviewers" | "assignees", before: PrDetail, c: PeopleChange) {
  return (now: PrDetail): PrDetail => {
    if (field === "assignees") {
      const touched = (login: string) => c.users.some((u) => same(u.login, login));
      const kept = now.assignees.filter((a) => !touched(a.login));
      return { ...now, assignees: [...kept, ...before.assignees.filter((a) => touched(a.login))] };
    }
    const touched = (r: Pick<PrReviewer, "kind" | "login">) =>
      r.kind === "team" ? c.teams.some((t) => same(t.slug, r.login)) : c.users.some((u) => same(u.login, r.login));
    const out = now.reviewers.filter((r) => !touched(r));
    for (const r of before.reviewers) if (touched(r)) out.push(r);
    return { ...now, reviewers: out };
  };
}

const names = (c: PeopleChange) => [...c.users.map((u) => u.login), ...c.teams.map((t) => t.name)].join(", ");

/**
 * Your review of it before it's sent: a summary and a verdict (comment,
 * approve, request changes; only Comment on your own PR), with the line
 * comments you've drafted on its files. ⌘↩ submits; Esc closes.
 */
function ReviewPanel({
  pr,
  pending,
  verdict,
  setVerdict,
  body,
  setBody,
  onSubmit,
  onDiscard,
  onClose,
  busy,
  error,
}: {
  pr: PrDetail;
  pending: number;
  verdict: ReviewEvent;
  setVerdict: (v: ReviewEvent) => void;
  body: string;
  setBody: (b: string) => void;
  onSubmit: (text: string) => Promise<boolean>;
  onDiscard: () => void;
  onClose: () => void;
  busy: boolean;
  error?: string;
}) {
  const own = pr.viewerIsAuthor;
  return (
    <div
      className="gh-review-panel"
      role="dialog"
      aria-label="Submit your review"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <h3>Finish your review</h3>
      <CommentBox
        autoFocus
        initial={body}
        onChange={setBody}
        placeholder="Leave a summary (optional)"
        submitLabel={busy ? "Submitting…" : "Submit review"}
        busy={busy}
        error={error}
        allowEmpty={verdict === "APPROVE" || pending > 0}
        onSubmit={onSubmit}
        extra={() =>
          pending > 0 && (
            <button className="secondary" onClick={onDiscard} disabled={busy} data-tip="Delete your pending comments and summary">
              <Trash2 size={12} aria-hidden="true" />
              Discard
            </button>
          )
        }
      />
      <div className="gh-verdicts" role="radiogroup" aria-label="Your verdict">
        {(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const).map((v) => {
          const disabled = own && v !== "COMMENT";
          return (
            <label key={v} className={`gh-verdict${verdict === v ? " selected" : ""}${disabled ? " disabled" : ""}`}>
              <input type="radio" name="verdict" checked={verdict === v} disabled={disabled} onChange={() => setVerdict(v)} />
              <span>
                <b>{VERDICT_LABEL[v]}</b>
                <small>{disabled ? "Pull request authors can’t approve or request changes on their own pull request." : VERDICT_HINT[v]}</small>
              </span>
            </label>
          );
        })}
      </div>
      {pending > 0 && (
        <p className="gh-hint">
          {pending === 1 ? "1 pending comment" : `${pending} pending comments`} will be sent with it.
        </p>
      )}
    </div>
  );
}

function Conversation({
  pr,
  onComment,
  onReviewers,
  onAssignees,
  onExternal,
  reviewersControl,
  assigneesControl,
}: {
  pr: PrDetail;
  onComment: (body: string) => Promise<boolean>;
  onReviewers: (change: PeopleChange) => void;
  onAssignees: (change: PeopleChange) => void;
  onExternal: (url: string) => void;
  reviewersControl: React.MutableRefObject<PickerControl | null>;
  assigneesControl: React.MutableRefObject<PickerControl | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="gh-conversation">
      <div className="gh-conversation-main">
        <article className="gh-entry">
          <div className="gh-entry-head">
            <Avatar person={pr.author} size={20} />
            <b>{pr.author?.login ?? "ghost"}</b>
            <span>opened this</span>
            <Time at={pr.createdAt} />
          </div>
          <Body text={pr.body} empty="No description provided." />
        </article>
        {pr.timeline.map((e) =>
          e.kind === "comment" ? (
            <article key={e.id} className="gh-entry">
              <div className="gh-entry-head">
                <Avatar person={e.author} size={20} />
                <b>{e.author?.login ?? "ghost"}</b>
                <span>commented</span>
                <Time at={e.createdAt} />
              </div>
              <Body text={e.body} />
            </article>
          ) : (
            <article key={e.id} className={`gh-entry review ${e.state}`}>
              <div className="gh-entry-head">
                <span className={`gh-review-mark ${e.state}`} aria-hidden="true">
                  {e.state === "approved" ? <CircleCheck size={14} /> : e.state === "changes" ? <CircleX size={14} /> : <MessageSquare size={14} />}
                </span>
                <Avatar person={e.author} size={20} />
                <b>{e.author?.login ?? "ghost"}</b>
                <span>{REVIEW_STATE_LABEL[e.state]}</span>
                {e.comments > 0 && <span className="gh-hint">{e.comments === 1 ? "1 comment" : `${e.comments} comments`}</span>}
                <Time at={e.createdAt} />
              </div>
              {e.body.trim() && <Body text={e.body} />}
            </article>
          ),
        )}
        <div className="gh-entry composer" id="gh-pr-comment">
          <CommentBox
            submitLabel="Comment"
            busy={busy}
            error={error}
            onSubmit={async (text) => {
              setBusy(true);
              setError(undefined);
              try {
                return await onComment(text);
              } catch (e) {
                setError(errorMessage(e));
                return false;
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      </div>
      <aside className="gh-conversation-side" aria-label="About this pull request">
        <Reviewers pr={pr} onChange={onReviewers} control={reviewersControl} />
        <Assignees pr={pr} onChange={onAssignees} control={assigneesControl} />
        {pr.labels.length > 0 && (
          <>
            <h4>Labels</h4>
            <p className="gh-labels">
              {pr.labels.map((l) => (
                <span key={l.name} className="gh-label" style={{ ["--label" as string]: `#${l.color}` }}>
                  {l.name}
                </span>
              ))}
            </p>
          </>
        )}
        <h4>Merge</h4>
        <p className="gh-hint">
          {pr.state === "merged"
            ? "Merged."
            : pr.state === "closed"
              ? "Closed without merging."
              : pr.mergeable === "conflicting"
                ? "This branch has conflicts to resolve."
                : pr.mergeable === "mergeable"
                  ? "No conflicts with the base branch."
                  : "Checking for conflicts…"}
        </p>
        {pr.checkRuns.length > 0 && (
          <>
            <h4>Checks</h4>
            <ChecksSummary checks={pr.checkRuns} onOpen={onExternal} />
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * One pull request: its title, state, branches, checks and review decision
 * over four tabs (Conversation, Files changed, Commits, Checks). Files changed
 * is the review: the diff with its threads (Reply, Resolve), your line
 * comments drafted into a pending review (kept until sent), Viewed per file,
 * and Review to send it with a summary and a verdict.
 */
export function PrView({
  repo,
  number,
  tab,
  setTab,
  layout,
  setLayout,
  listShown,
  setListShown,
  onBack,
  backLabel,
  onExternal,
  onNotice,
  diffHandle,
  api,
  onLoaded,
  paseoFor,
  onOpenPaseo,
}: {
  repo: string;
  number: number;
  tab: PrTab;
  setTab: (t: PrTab) => void;
  layout: DiffLayout;
  setLayout: (l: DiffLayout) => void;
  listShown: boolean;
  setListShown: (shown: boolean) => void;
  onBack: () => void;
  backLabel: string;
  onExternal: (url: string) => void;
  onNotice: (message: string) => void;
  diffHandle: React.RefObject<DiffViewHandle | null>;
  api: React.MutableRefObject<PrViewApi | null>;
  /** The PR as read, for ⌘K (undefined while it loads). */
  onLoaded: (pr: PrDetail | undefined, pending: number) => void;
  /** The Paseo workspaces with the PR's branch checked out (`paseo.ts`), and opening one's agent. */
  paseoFor?: (pr: PrHead) => PaseoMatch[];
  onOpenPaseo?: (m: PaseoMatch) => void;
}) {
  const prPath = readPath("pr", { repo, number });
  const detail = useGithubRead<PrDetail>(prPath, PR_POLL_MS);
  const pr = detail.data;
  // The diff only once Files changed is first shown.
  const [diffWanted, setDiffWanted] = useState(tab === "files");
  useEffect(() => {
    if (tab === "files") setDiffWanted(true);
  }, [tab]);
  const diffPath = readPath("diff", { repo, number });
  const diff = useGithubRead<PrDiff>(diffWanted ? diffPath : null);
  // A new head: the diff is asked again.
  const head = pr?.headSha;
  const seenHead = useRef(head);
  useEffect(() => {
    if (head && seenHead.current && head !== seenHead.current && diffWanted) void load(diffPath, true);
    seenHead.current = head;
  }, [head, diffWanted, diffPath]);

  const [draft, setDraft] = useReviewDraft(repo, number);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [verdict, setVerdict] = useState<ReviewEvent>("COMMENT");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  useEffect(() => {
    setReviewOpen(false);
    setSubmitError(undefined);
  }, [repo, number]);
  useEffect(() => {
    if (pr?.viewerIsAuthor && verdict !== "COMMENT") setVerdict("COMMENT");
  }, [pr?.viewerIsAuthor, verdict]);

  useEffect(() => onLoaded(pr, draft.comments.length), [pr, draft.comments.length, onLoaded]);
  useEffect(() => () => onLoaded(undefined, 0), [onLoaded]);

  const refresh = useCallback(() => {
    void load(prPath, true);
    if (diffWanted) void load(diffPath, true);
  }, [prPath, diffPath, diffWanted]);
  const afterWrite = useCallback(() => {
    void load(prPath, true);
    invalidate("github/q/prs");
  }, [prPath]);

  const viewed = useMemo(() => new Map((pr?.files ?? []).map((f) => [f.path, f.viewed === "viewed"])), [pr?.files]);
  const setViewed = useCallback(
    (path: string, on: boolean) => {
      if (!pr) return;
      const flip = (state: "viewed" | "unviewed") => (p: PrDetail) => ({
        ...p,
        files: p.files.map((f) => (f.path === path ? { ...f, viewed: state } : f)),
      });
      patch<PrDetail>(prPath, flip(on ? "viewed" : "unviewed"));
      githubWrite("viewed", { prId: pr.id, path, viewed: on }).catch((e) => {
        patch<PrDetail>(prPath, flip(on ? "unviewed" : "viewed"));
        onNotice(`Couldn’t mark ${path} ${on ? "viewed" : "not viewed"}: ${errorMessage(e)}`);
      });
    },
    [pr, prPath, onNotice],
  );
  const resolve = useCallback(
    (thread: ReviewThread, resolved: boolean) => {
      const flip = (to: boolean) => (p: PrDetail) => ({
        ...p,
        threads: p.threads.map((t) => (t.id === thread.id ? { ...t, isResolved: to } : t)),
      });
      patch<PrDetail>(prPath, flip(resolved));
      githubWrite("resolve", { threadId: thread.id, resolved }).catch((e) => {
        patch<PrDetail>(prPath, flip(!resolved));
        onNotice(`Couldn’t ${resolved ? "resolve" : "unresolve"} the conversation: ${errorMessage(e)}`);
      });
    },
    [prPath, onNotice],
  );
  const reply = useCallback(
    async (thread: ReviewThread, body: string) => {
      const first = thread.comments[0];
      if (!first) return false;
      try {
        await githubWrite("reply", { repo, number, commentId: first.databaseId, body });
        afterWrite();
        return true;
      } catch (e) {
        onNotice(`Couldn’t reply: ${errorMessage(e)}`);
        return false;
      }
    },
    [repo, number, afterWrite, onNotice],
  );
  const single = useCallback(
    async (c: DraftComment) => {
      if (!pr) return false;
      try {
        await githubWrite("review", { repo, number, event: "COMMENT", body: "", commitId: pr.headSha, comments: [c] });
        afterWrite();
        return true;
      } catch (e) {
        onNotice(`Couldn’t comment: ${errorMessage(e)}`);
        return false;
      }
    },
    [pr, repo, number, afterWrite, onNotice],
  );
  const review = useMemo<DiffReview | undefined>(
    () =>
      pr && {
        threads: pr.threads,
        drafts: draft.comments,
        onAdd: (c) => setDraft(addComment(draftRef.current, c).draft),
        onEdit: (id, body) => setDraft(editComment(draftRef.current, id, body)),
        onRemove: (id) => setDraft(removeComment(draftRef.current, id)),
        onReply: reply,
        onResolve: resolve,
        onSingle: single,
        viewed,
        onViewed: setViewed,
      },
    [pr, draft.comments, setDraft, reply, resolve, single, viewed, setViewed],
  );

  const reviewersControl = useRef<PickerControl | null>(null);
  const assigneesControl = useRef<PickerControl | null>(null);
  const changePeople = useCallback(
    (field: "reviewers" | "assignees", c: PeopleChange) => {
      if (!pr || (!c.users.length && !c.teams.length)) return;
      const before = pr;
      patch<PrDetail>(prPath, (p) => (field === "reviewers" ? withReviewers(p, c) : withAssignees(p, c)));
      const write =
        field === "reviewers"
          ? githubWrite("reviewers", { repo, number, action: c.action, users: c.users.map((u) => u.login), teams: c.teams.map((t) => t.slug) })
          : githubWrite("assignees", { repo, number, action: c.action, users: c.users.map((u) => u.login) });
      write.then(afterWrite, (e) => {
        patch<PrDetail>(prPath, undoPeople(field, before, c));
        const what =
          field === "reviewers"
            ? c.action === "add"
              ? `request a review from ${names(c)}`
              : `remove the review request for ${names(c)}`
            : c.action === "add"
              ? `assign ${names(c)}`
              : `unassign ${names(c)}`;
        onNotice(`Couldn’t ${what}: ${errorMessage(e)}`);
      });
    },
    [pr, prPath, repo, number, afterWrite, onNotice],
  );
  const onReviewers = useCallback((c: PeopleChange) => changePeople("reviewers", c), [changePeople]);
  const onAssignees = useCallback((c: PeopleChange) => changePeople("assignees", c), [changePeople]);

  const submit = async (text: string) => {
    if (!pr) return false;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await githubWrite("review", {
        repo,
        number,
        event: verdict,
        body: text,
        commitId: pr.headSha,
        comments: reviewComments({ ...draftRef.current, body: text }),
      });
      setDraft({ comments: [], body: "" });
      setReviewOpen(false);
      onNotice(verdict === "APPROVE" ? `Approved #${number}.` : verdict === "REQUEST_CHANGES" ? `Requested changes on #${number}.` : `Review sent on #${number}.`);
      afterWrite();
      return true;
    } catch (e) {
      setSubmitError(errorMessage(e));
      return false;
    } finally {
      setSubmitting(false);
    }
  };
  const comment = async (body: string) => {
    await githubWrite("comment", { repo, number, body });
    afterWrite();
    return true;
  };

  api.current = {
    openReview: (v) => {
      if (v && !(pr?.viewerIsAuthor && v !== "COMMENT")) setVerdict(v);
      setReviewOpen(true);
    },
    editPeople: (which) => {
      setTab("conversation");
      setTimeout(() => (which === "reviewers" ? reviewersControl : assigneesControl).current?.open(), 0);
    },
    focusComment: () => {
      setTab("conversation");
      setTimeout(() => {
        const box = document.querySelector<HTMLTextAreaElement>("#gh-pr-comment textarea");
        box?.scrollIntoView({ block: "center" });
        box?.focus();
      }, 0);
    },
  };

  const paseo = pr && paseoFor && onOpenPaseo ? paseoFor(pr) : [];

  const threadsOpen = pr ? pr.threads.filter((t) => !t.isResolved).length : 0;
  const counts: Record<PrTab, number | undefined> = {
    conversation: pr ? pr.timeline.length : undefined,
    files: pr?.changedFiles,
    commits: pr?.commits.length,
    checks: pr?.checkRuns.length,
  };

  return (
    <div className="gh-main-inner gh-pr">
      <header className="gh-head">
        <button className="ghost-btn" onClick={onBack} aria-description="Back (Esc)">
          <ArrowLeft size={14} aria-hidden="true" />
          {backLabel}
        </button>
        <span className="gh-spacer" />
        {pr && (
          <button className="icon-btn" aria-label="Open on GitHub" data-tip="Open on GitHub" onClick={() => onExternal(pr.url)}>
            <ExternalLink size={13} aria-hidden="true" />
          </button>
        )}
        <button className="icon-btn" aria-label="Refresh" data-tip="Refresh" onClick={refresh}>
          <RefreshCw size={13} aria-hidden="true" className={detail.loading || diff.loading ? "spinning" : undefined} />
        </button>
      </header>
      {detail.unavailable ? (
        <div className="gh-empty">
          <CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
          <p>{detail.unavailable}</p>
        </div>
      ) : !pr ? (
        detail.error ? (
          <div className="gh-empty">
            <CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
            <h3>GitHub didn’t answer</h3>
            <p>{detail.error}</p>
            <button className="secondary" onClick={refresh}>
              Try again
            </button>
          </div>
        ) : (
          <p className="gh-note">
            Loading {repo}#{number}…
          </p>
        )
      ) : (
        <>
          <div className="gh-pr-title">
            <h2>
              {pr.title} <span className="gh-pr-number">#{pr.number}</span>
            </h2>
            <div className="gh-pr-sub">
              <span className={`gh-state-pill ${pr.state}`}>
                <PrStateIcon state={pr.state} size={13} />
                {STATE_LABEL[pr.state]}
              </span>
              <Avatar person={pr.author} size={18} />
              <b>{pr.author?.login ?? "ghost"}</b>
              <span>
                wants to merge into <code>{pr.baseRef}</code> from <code>{pr.headRef}</code>
              </span>
              <span className="gh-repo">{pr.repo}</span>
              <ChecksIcon state={pr.checkRuns.some((c) => c.state === "failing") ? "failing" : pr.checkRuns.some((c) => c.state === "pending") ? "pending" : pr.checkRuns.length ? "passing" : null} />
              <Decision decision={pr.reviewDecision} />
              {paseo.length > 0 && <OpenPaseoButton matches={paseo} onOpen={onOpenPaseo!} />}
            </div>
          </div>
          {detail.error && (
            <p className="gh-banner" role="status">
              Couldn’t refresh: {detail.error}
            </p>
          )}
          <nav className="gh-tabs" role="tablist" aria-label="Pull request">
            {(["conversation", "files", "commits", "checks"] as const).map((t, i) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "selected" : ""}
                data-tip={`${TAB_LABEL[t]} (${i + 1})`}
                onClick={() => setTab(t)}
              >
                {TAB_LABEL[t]}
                {counts[t] !== undefined && <span className="gh-count">{counts[t]}</span>}
              </button>
            ))}
            <span className="gh-spacer" />
            <Churn additions={pr.additions} deletions={pr.deletions} />
            <div className="gh-review-anchor">
              <button
                className="primary"
                onClick={() => setReviewOpen(!reviewOpen)}
                aria-expanded={reviewOpen}
                data-tip="Finish your review (R)"
                disabled={pr.state === "merged" || pr.state === "closed"}
              >
                Review
                {draft.comments.length > 0 && <span className="gh-pending-count">{draft.comments.length}</span>}
              </button>
              {reviewOpen && (
                <ReviewPanel
                  pr={pr}
                  pending={draft.comments.length}
                  verdict={verdict}
                  setVerdict={setVerdict}
                  body={draft.body}
                  setBody={(body) => setDraft({ ...draftRef.current, body })}
                  onSubmit={submit}
                  onDiscard={() => {
                    setDraft({ comments: [], body: "" });
                    setReviewOpen(false);
                  }}
                  onClose={() => setReviewOpen(false)}
                  busy={submitting}
                  error={submitError}
                />
              )}
            </div>
          </nav>
          {tab === "conversation" && (
            <Conversation
              pr={pr}
              onComment={comment}
              onReviewers={onReviewers}
              onAssignees={onAssignees}
              onExternal={onExternal}
              reviewersControl={reviewersControl}
              assigneesControl={assigneesControl}
            />
          )}
          {tab === "files" && (
            <>
              <div className="gh-toolbar">
                <span className="gh-hint">
                  {threadsOpen > 0 ? `${threadsOpen} open ${threadsOpen === 1 ? "conversation" : "conversations"} · ` : ""}
                  {viewed.size ? `${[...viewed.values()].filter(Boolean).length} of ${pr.files.length} viewed` : ""}
                </span>
                <span className="gh-spacer" />
                <LayoutControls layout={layout} setLayout={setLayout} listShown={listShown} setListShown={setListShown} />
              </div>
              {diff.data?.tooLarge && (
                <p className="gh-banner" role="status">
                  This diff is too large to show whole: some files are left out.{" "}
                  <button className="gh-link" onClick={() => onExternal(`${pr.url}/files`)}>
                    See them on GitHub
                  </button>
                </p>
              )}
              {diff.unavailable || (!diff.data && diff.error) ? (
                <div className="gh-empty">
                  <CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
                  <p>{diff.unavailable ?? diff.error}</p>
                </div>
              ) : !diff.data ? (
                <p className="gh-note">Loading the diff…</p>
              ) : (
                <DiffView files={diff.data.files} layout={layout} listShown={listShown} review={review} handle={diffHandle} empty={<p>No changes.</p>} />
              )}
            </>
          )}
          {tab === "commits" && (
            <ul className="gh-commits">
              {pr.commits.map((c) => (
                <li key={c.sha}>
                  <GitCommitHorizontal size={14} aria-hidden="true" />
                  <Avatar person={c.author} size={18} />
                  <span className="gh-commit-title">{c.title}</span>
                  <code>{c.sha.slice(0, 7)}</code>
                  <Time at={c.at} />
                </li>
              ))}
              {!pr.commits.length && <p className="gh-note">No commits.</p>}
            </ul>
          )}
          {tab === "checks" && (
            <ul className="gh-check-list">
              {pr.checkRuns.map((c, i) => (
                <li key={`${c.name}${i}`}>
                  {c.state === "skipped" ? <CircleDashed size={14} aria-hidden="true" className="gh-checks skipped" /> : <ChecksIcon state={c.state} size={14} />}
                  <span className="gh-check-name">{c.name}</span>
                  {c.summary && <span className="gh-hint">{c.summary}</span>}
                  <span className="gh-spacer" />
                  <span className="gh-hint">{CHECKS_LABEL[c.state]}</span>
                  {c.url && (
                    <button className="icon-btn" aria-label={`Open ${c.name}`} data-tip="Open" onClick={() => onExternal(c.url!)}>
                      <ExternalLink size={12} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
              {!pr.checkRuns.length && <p className="gh-note">No checks reported.</p>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
