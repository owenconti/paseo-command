import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CornerLeftUp, ExternalLink, GitBranch, Play, X } from "lucide-react";
import { errorMessage } from "../api";
import { openExternal } from "../links";
import { Markdown } from "../Markdown";
import { Comments } from "./Comments";
import { IssueRow } from "./IssueList";
import { Properties } from "./Properties";
import { issueContext, linearImages, type IssueContext } from "./prompt";
import { linearStore, loadIssue, useLinear } from "./store";
import type { LinearIssue, LinearRelation } from "./types";

/** How a relation reads from the open issue's side. */
const RELATION_LABEL: Record<LinearRelation["type"], string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  related: "Related",
  duplicate: "Duplicate of",
  duplicate_of: "Duplicated by",
};
const RELATION_ORDER: LinearRelation["type"][] = ["blocked_by", "blocks", "related", "duplicate", "duplicate_of"];

/** Issues the page knows only by id (a parent, a related issue) asked for once each; a handful per issue. */
const askedById = new Set<string>();
/** Those Linear didn't give (failed, or no such issue): shown as unavailable, not loading. */
const missingById = new Set<string>();
const MAX_RELATED_LOADS = 10;

/**
 * One issue, from the store, loaded afresh (description, comments, children)
 * when it opens: its properties, labels, parent, children and relations,
 * description, links and comments, and Launch agent. Its properties are
 * edited in place (`Properties`), its comments read and written (`Comments`).
 */
export function IssueDetail({
  issueKey,
  onOpen,
  onClose,
  closeLabel,
  onLaunch,
  revision,
}: {
  issueKey: string;
  onOpen: (key: string) => void;
  onClose: () => void;
  /** "Back" where the issue took the list's place, else "Close". */
  closeLabel: "Back" | "Close";
  onLaunch: (issue: IssueContext) => void;
  /** Bumped by Refresh: the issue is asked for again. */
  revision: number;
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

  const close = (
    <button className="ghost-btn linear-close" onClick={onClose} aria-label={closeLabel}>
      {closeLabel === "Back" ? <ArrowLeft size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
      {closeLabel === "Back" ? "Back" : null}
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
  const relations = RELATION_ORDER.map((type) => ({
    type,
    issues: (issue.relations ?? [])
      .filter((r) => r.type === type)
      .map((r) => ({ id: r.issueId, issue: data.issues.get(r.issueId) })),
  })).filter((g) => g.issues.length > 0);
  const row = (other: LinearIssue) => (
    <IssueRow key={other.id} issue={other} ws={ws} open={false} focusable onOpen={onOpen} showState />
  );

  return (
    <div className="linear-detail" aria-live="polite">
      <div className="linear-detail-bar">{close}</div>
      <article className="linear-issue" aria-label={`${issue.key}: ${issue.title}`}>
        <header>
          <div className="linear-issue-line">
            <span className="linear-key">{issue.key}</span>
          </div>
          <h1>{issue.title}</h1>
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
        <div className="linear-description">
          {issue.description?.trim() ? (
            <Markdown text={linearImages(issue.description, location.origin)} />
          ) : issue.description === undefined && !loaded ? (
            <p className="linear-note">Loading the description…</p>
          ) : (
            <p className="linear-note">No description.</p>
          )}
        </div>
        {load.error && (
          <p className="archive-error" role="alert">
            {load.error}
          </p>
        )}
        {children.length > 0 && (
          <section className="linear-section linear-children">
            <h3>
              Sub-issues <span className="linear-count">{children.length}</span>
            </h3>
            <div className="linear-related-rows">{children.map(row)}</div>
          </section>
        )}
        {relations.length > 0 && (
          <section className="linear-section linear-relations">
            <h3>Relations</h3>
            {relations.map((g) => (
              <div key={g.type} className="linear-relation-group">
                <h4>{RELATION_LABEL[g.type]}</h4>
                <div className="linear-related-rows">
                  {g.issues.map(({ id: otherId, issue: other }) =>
                    other ? (
                      row(other)
                    ) : (
                      <p key={otherId} className="linear-note">
                        {unavailable(otherId) ? "Unavailable" : "Loading…"}
                      </p>
                    ),
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
        {(issue.links?.length ?? 0) > 0 && (
          <section className="linear-section">
            <h3>Links</h3>
            <ul className="linear-links">
              {issue.links!.map((l) => (
                <li key={l.url}>
                  <button className="link-btn" onClick={() => openExternal(l.url)}>
                    <ExternalLink size={12} aria-hidden="true" />
                    {l.title || l.url}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Comments issueId={issue.id} />
      </article>
    </div>
  );
}
