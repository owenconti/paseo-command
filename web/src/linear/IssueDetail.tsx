import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  CornerLeftUp,
  ExternalLink,
  GitBranch,
  Link2,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { errorMessage } from "../api";
import { onAppCommand } from "../appCommands";
import { openExternal } from "../links";
import { copyText } from "../nativePlatform";
import { Comments } from "./Comments";
import { Attachments } from "./Attachments";
import { IssueRow } from "./IssueList";
import { Properties } from "./Properties";
import { issueContext, type IssueContext } from "./prompt";
import { IssueDescription, IssueTitle } from "./IssueText";
import { Relations } from "./Relations";
import { linearStore, loadIssue, useLinear } from "./store";
import type { LinearIssue } from "./types";

/** Issues the page knows only by id (a parent, a related issue) asked for once each; a handful per issue. */
const askedById = new Set<string>();
/** Those Linear didn't give (failed, or no such issue): shown as unavailable, not loading. */
const missingById = new Set<string>();
const MAX_RELATED_LOADS = 10;

/**
 * One issue, from the store, loaded afresh (description, comments, children)
 * when it opens: its properties, labels, parent, children and relations,
 * description, attachments and comments, and Launch agent. Its properties are
 * edited in place (`Properties`), its relations (`Relations`) and comments
 * (`Comments`) read and written. Its bar subscribes, copies its link and
 * branch name, archives and (after asking) deletes it; Add sub-issue opens
 * Create issue under it. ⌘K runs the same.
 */
export function IssueDetail({
  issueKey,
  onOpen,
  onClose,
  closeLabel,
  onLaunch,
  revision,
  onNotice,
  onSubIssue,
  onArchive,
  onDelete,
  leaving = false,
}: {
  issueKey: string;
  onOpen: (key: string) => void;
  onClose: () => void;
  /** "Back" where the issue took the list's place, else "Close". */
  closeLabel: "Back" | "Close";
  onLaunch: (issue: IssueContext) => void;
  /** Bumped by Refresh: the issue is asked for again. */
  revision: number;
  /** The app's short notice (copied, couldn't copy). */
  onNotice: (message: string) => void;
  /** Create issue, under this one. */
  onSubIssue: (issue: LinearIssue) => void;
  /** Archives it (the view closes it and offers Undo). */
  onArchive: (issue: LinearIssue) => void;
  /** Moves it to Linear's trash; whether Linear did. */
  onDelete: (issue: LinearIssue) => Promise<boolean>;
  /** Being archived: when it leaves the store, it's on its way out, not unknown. */
  leaving?: boolean;
}) {
  const data = useLinear((d) => d);
  const ws = data.workspace;
  const id = data.byKey.get(issueKey);
  const issue = id ? data.issues.get(id) : undefined;
  const [load, setLoad] = useState<{ key: string; done: boolean; error?: string }>({ key: issueKey, done: false });
  useEffect(() => {
    let live = true;
    setLoad({ key: issueKey, done: false });
    loadIssue(issueKey).then(
      () => live && setLoad({ key: issueKey, done: true }),
      (e) => live && setLoad({ key: issueKey, done: true, error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [issueKey, revision]);
  const loaded = load.key === issueKey && load.done;

  // A parent or related issue not in the store yet: asked for by id, so it can be named.
  const unknownIds = useMemo(
    () =>
      [issue?.parentId, ...(issue?.relations ?? []).map((r) => r.issueId)].filter(
        (x): x is string => !!x && !data.issues.has(x),
      ),
    [issue, data.issues],
  );
  const [, setMissing] = useState(0);
  useEffect(() => {
    for (const other of unknownIds.slice(0, MAX_RELATED_LOADS)) {
      if (askedById.has(other)) continue;
      askedById.add(other);
      const miss = () => {
        if (linearStore.getState().issues.has(other)) return;
        missingById.add(other);
        setMissing((n) => n + 1);
      };
      loadIssue(other).then(miss, miss);
    }
  }, [unknownIds]);
  /** Not loading any more: Linear didn't give it, or it's past the handful asked for. */
  const unavailable = (other: string) =>
    missingById.has(other) || unknownIds.indexOf(other) >= MAX_RELATED_LOADS;

  const viewerId = ws?.viewerId;
  const subscribed = !!issue && !!viewerId && issue.subscriberIds.includes(viewerId);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const actions = {
    subscribe() {
      if (!issue || !viewerId) return;
      void linearStore.write(subscribed ? "issueUnsubscribe" : "issueSubscribe", { id: issue.id }, {
        issueId: issue.id,
        patch: {
          subscriberIds: subscribed
            ? issue.subscriberIds.filter((u) => u !== viewerId)
            : [...issue.subscriberIds, viewerId],
        },
      });
    },
    copy(what: "branch name" | "link") {
      const value = what === "link" ? issue?.url : issue?.branchName;
      if (!issue || !value) return;
      copyText(value).then(
        () => onNotice(`Copied ${issue.key}'s ${what}`),
        (e) => onNotice(`Couldn't copy ${issue.key}'s ${what}: ${errorMessage(e)}`),
      );
    },
    archive() {
      if (issue) onArchive(issue);
    },
    askDelete() {
      if (issue) setConfirming(true);
    },
    subIssue() {
      if (issue) onSubIssue(issue);
    },
  };
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const offs = [
      onAppCommand("linear-subscribe", () => latest.current.subscribe()),
      onAppCommand("linear-copy-branch", () => latest.current.copy("branch name")),
      onAppCommand("linear-copy-link", () => latest.current.copy("link")),
      onAppCommand("linear-archive", () => latest.current.archive()),
      onAppCommand("linear-delete", () => latest.current.askDelete()),
      onAppCommand("linear-sub-issue", () => latest.current.subIssue()),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  // The question takes the keyboard, on Keep.
  useEffect(() => {
    if (confirming) keep.current?.focus({ preventScroll: true });
  }, [confirming]);
  const remove = async () => {
    if (!issue) return;
    setDeleting(true);
    const done = await onDelete(issue);
    setDeleting(false);
    if (!done) setConfirming(false);
  };

  const close = (
    <button className="ghost-btn linear-close" onClick={onClose} aria-label={closeLabel}>
      {closeLabel === "Back" ? <ArrowLeft size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
      {closeLabel === "Back" ? "Back" : null}
    </button>
  );
  const tool = (label: string, tip: string, icon: ReactNode, run: () => void, extra = "") => (
    <button className={`icon-btn${extra}`} aria-label={label} data-tip={tip} onClick={run}>
      {icon}
    </button>
  );

  if (!issue)
    return (
      <div className="linear-detail" aria-live="polite">
        <div className="linear-detail-bar">{close}</div>
        {load.error && load.key === issueKey ? (
          <p className="archive-error" role="alert">
            {load.error}
          </p>
        ) : leaving ? (
          <p className="linear-note">Archiving {issueKey}…</p>
        ) : loaded ? (
          <p className="linear-note">Linear doesn’t know {issueKey}.</p>
        ) : (
          <p className="linear-note">Loading {issueKey}…</p>
        )}
      </div>
    );

  const user = (userId?: string) => ws?.users.find((u) => u.id === userId);
  const parent = issue.parentId ? data.issues.get(issue.parentId) : undefined;
  const children = (issue.childIds ?? [])
    .map((c) => data.issues.get(c))
    .filter((c): c is LinearIssue => c !== undefined);
  const row = (other: LinearIssue) => (
    <IssueRow key={other.id} issue={other} ws={ws} open={false} focusable onOpen={onOpen} showState />
  );

  const tools = (
    <div className="linear-detail-tools" role="toolbar" aria-label={`${issue.key}'s actions`}>
      {tool(
        subscribed ? "Unsubscribe" : "Subscribe",
        subscribed ? "Unsubscribe: no more notifications about it" : "Subscribe: be notified of its changes",
        subscribed ? <BellOff size={14} aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />,
        actions.subscribe,
        subscribed ? " on" : "",
      )}
      {issue.url && tool("Copy link", "Copy its Linear link", <Link2 size={14} aria-hidden="true" />, () => actions.copy("link"))}
      {issue.branchName &&
        tool("Copy branch name", "Copy its branch name", <GitBranch size={14} aria-hidden="true" />, () =>
          actions.copy("branch name"),
        )}
      {tool("Archive", "Archive it (you can undo)", <Archive size={14} aria-hidden="true" />, actions.archive)}
      {tool("Delete", "Move it to Linear's trash", <Trash2 size={14} aria-hidden="true" />, actions.askDelete, " danger-hover")}
    </div>
  );

  return (
    <div className="linear-detail" aria-live="polite">
      <div className="linear-detail-bar">
        {closeLabel === "Back" ? (
          <>
            {close}
            {tools}
          </>
        ) : (
          <>
            {tools}
            {close}
          </>
        )}
      </div>
      {confirming && (
        <div
          className="linear-detail-confirm inline-confirm"
          role="group"
          aria-label={`Move ${issue.key} to Linear's trash?`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setConfirming(false);
            }
          }}
        >
          <span>
            Move <b>{issue.key}</b> to Linear's trash?
          </span>
          <button type="button" className="danger" disabled={deleting} onClick={() => void remove()}>
            Delete
          </button>
          <button type="button" className="secondary" ref={keep} disabled={deleting} onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      )}
      <article className="linear-issue" aria-label={`${issue.key}: ${issue.title}`}>
        <header>
          <div className="linear-issue-line">
            <span className="linear-key">{issue.key}</span>
          </div>
          <IssueTitle issue={issue} />
          <Properties issue={issue} />
          {issue.parentId && (
            <button className="link-btn linear-parent" disabled={!parent} onClick={() => parent && onOpen(parent.key)}>
              <CornerLeftUp size={12} aria-hidden="true" />
              {parent
                ? `Part of ${parent.key}: ${parent.title}`
                : unavailable(issue.parentId)
                  ? "Part of an issue that’s unavailable"
                  : "Part of another issue"}
            </button>
          )}
          <div className="linear-actions">
            <button
              className="primary"
              aria-description="Opens New agent in the panel: choose the host and project, then the prompt"
              onClick={() => onLaunch(issueContext(issue))}
            >
              <Play size={13} aria-hidden="true" />
              Launch agent
            </button>
            {issue.url && (
              <button className="secondary" onClick={() => openExternal(issue.url)}>
                <ExternalLink size={13} aria-hidden="true" />
                Open in Linear
              </button>
            )}
            {issue.branchName && (
              <span className="linear-branch" data-tip="Linear’s branch for it; a new agent’s worktree takes it">
                <GitBranch size={12} aria-hidden="true" />
                {issue.branchName}
              </span>
            )}
          </div>
        </header>
        <IssueDescription issue={issue} loaded={loaded} />
        {load.error && (
          <p className="archive-error" role="alert">
            {load.error}
          </p>
        )}
        <section className="linear-section linear-children">
          <div className="linear-section-head">
            <h3>
              Sub-issues {children.length > 0 && <span className="linear-count">{children.length}</span>}
            </h3>
            <button type="button" className="ghost-btn" onClick={() => onSubIssue(issue)}>
              <Plus size={12} aria-hidden="true" />
              Add sub-issue
            </button>
          </div>
          {children.length > 0 && <div className="linear-related-rows">{children.map(row)}</div>}
        </section>
        <Relations issue={issue} onOpen={onOpen} unavailable={unavailable} />
        <Attachments issue={issue} />
        <Comments issueId={issue.id} />
      </article>
    </div>
  );
}
