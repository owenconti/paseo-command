import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, CircleX, Ellipsis, GitMerge, GitPullRequestClosed, ListOrdered, Zap } from "lucide-react";
import { errorMessage } from "../api";
import { resetLinkCache } from "../links";
import { menuKeys } from "../menuKeys";
import { placeBelow } from "../Picker";
import { githubWrite, invalidate, load, patch } from "./api";
import { Avatar, CommentBox, Time } from "./bits";
import {
  actionKey,
  actionLabel,
  adminMerge,
  blockers,
  canAutoMerge,
  canMergeNow,
  deleteAfterMerge,
  mergeActions,
  mergeMethodFor,
  METHOD_BUTTON,
  METHOD_HINT,
  METHOD_WORDS,
  mergeableNow,
  offersDelete,
  rememberDeleteAfterMerge,
  rememberMergeMethod,
  type MergeAction,
} from "./merge";
import type { MergeMethod, PrDetail, PrMerge } from "./types";

/** The panel open beneath the header's merge buttons: confirming a merge or auto-merge, or closing. */
export type MergePanelState = { mode: "merge" | "auto"; method: MergeMethod } | { mode: "close" } | null;

const QUEUE_WORDS = { queued: "queued", awaiting_checks: "awaiting checks", mergeable: "ready to merge", unmergeable: "unable to merge", locked: "locked" } as const;

/** GitHub's default commit title and message for a merge or squash. */
function defaultMessage(pr: PrDetail, method: "merge" | "squash") {
  return pr.merge.messages[method] ?? (method === "merge" ? { title: `Merge pull request #${pr.number} from ${pr.headRef}`, body: pr.title } : { title: `${pr.title} (#${pr.number})`, body: "" });
}

/**
 * The merge box's state and writes for the open PR: the method chosen (the
 * last per repository), the panel open, and each action, shown at once where
 * safe (ready/draft, auto-merge off, the queue, reopen, close) and put back
 * with a notice if GitHub refuses; a merge waits for GitHub's answer. After
 * each, the PR, its lists and counts, and the map's lookups of it are asked again.
 */
export function useMergeBox({ pr, prPath, onNotice }: { pr: PrDetail | undefined; prPath: string; onNotice: (message: string) => void }) {
  const repo = pr?.repo ?? "";
  const methods = pr?.merge.methods ?? [];
  const [chosen, setMethodState] = useState<MergeMethod | null>(() => mergeMethodFor(repo, methods));
  useEffect(() => setMethodState(mergeMethodFor(repo, methods)), [repo, methods.join()]);
  // Only ever one the PR allows, even before the effect catches up with a new read.
  const method = chosen && methods.includes(chosen) ? chosen : mergeMethodFor(repo, methods);
  const setMethod = useCallback(
    (m: MergeMethod) => {
      setMethodState(m);
      if (repo) rememberMergeMethod(repo, m);
    },
    [repo],
  );
  const [panel, setPanel] = useState<MergePanelState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setPanel(null);
    setError(undefined);
  }, [pr?.repo, pr?.number]);

  const refreshAll = useCallback(() => {
    void load(prPath, true);
    invalidate("github/q/prs", "github/q/repos", "github/q/repoSearch");
    // The map's medallions and the header's chip ask the server again, which has forgotten its lookups.
    resetLinkCache();
  }, [prPath]);

  /** Shows `change` at once, writes, and puts back only what it touched if GitHub refuses. */
  const optimistic = useCallback(
    <K extends "state" | "merge">(field: K, to: (p: PrDetail) => PrDetail[K], write: () => Promise<unknown>, what: string, done?: string) => {
      if (!pr) return;
      let was: PrDetail[K] | undefined;
      patch<PrDetail>(prPath, (p) => {
        was = p[field];
        return { ...p, [field]: to(p) };
      });
      write().then(
        () => {
          if (done) onNotice(done);
          refreshAll();
        },
        (e) => {
          if (was !== undefined) patch<PrDetail>(prPath, (p) => ({ ...p, [field]: was }));
          onNotice(`Couldn’t ${what}: ${errorMessage(e)}`);
        },
      );
    },
    [pr, prPath, onNotice, refreshAll],
  );
  const withMerge = (p: PrDetail, m: Partial<PrMerge>): PrMerge => ({ ...p.merge, ...m });

  const run = useCallback(
    (a: MergeAction) => {
      if (!pr) return;
      const id = { repo: pr.repo, number: pr.number, prId: pr.id };
      setError(undefined);
      switch (a.kind) {
        case "merge":
        case "auto":
          setMethod(a.method);
          setPanel({ mode: a.kind, method: a.method });
          return;
        case "close":
          setPanel({ mode: "close" });
          return;
        case "auto-off":
          return optimistic("merge", (p) => withMerge(p, { autoMerge: null }), () => githubWrite("autoMerge", { ...id, enable: false }), "disable auto-merge", `Auto-merge is off for #${pr.number}.`);
        case "queue":
          return optimistic(
            "merge",
            (p) => withMerge(p, { queue: { state: "queued" } }),
            () => githubWrite("queue", { ...id, action: "add", headSha: pr.headSha }),
            "add it to the merge queue",
            `Added #${pr.number} to the merge queue.`,
          );
        case "dequeue":
          return optimistic("merge", (p) => withMerge(p, { queue: null }), () => githubWrite("queue", { ...id, action: "remove" }), "remove it from the merge queue", `Removed #${pr.number} from the merge queue.`);
        case "ready":
          return optimistic("state", () => "open", () => githubWrite("ready", { ...id, ready: true }), "mark it ready for review", `#${pr.number} is ready for review.`);
        case "draft":
          return optimistic("state", () => "draft", () => githubWrite("ready", { ...id, ready: false }), "convert it to a draft", `#${pr.number} is a draft again.`);
        case "reopen":
          return optimistic("state", () => "open", () => githubWrite("state", { ...id, state: "open" }), "reopen it", `Reopened #${pr.number}.`);
        case "update":
          setBusy("update");
          githubWrite("updateBranch", { ...id, method: a.method, headSha: pr.headSha })
            .then(
              () => {
                onNotice(a.method === "rebase" ? `Rebasing ${pr.headRef} onto ${pr.baseRef}…` : `Merging ${pr.baseRef} into ${pr.headRef}…`);
                refreshAll();
              },
              (e) => onNotice(`Couldn’t update the branch: ${errorMessage(e)}`),
            )
            .finally(() => setBusy(null));
          return;
        case "delete-branch":
          setBusy("delete-branch");
          githubWrite("deleteBranch", { repo: pr.repo, number: pr.number })
            .then(
              () => {
                patch<PrDetail>(prPath, (p) => ({ ...p, merge: withMerge(p, { headBranchExists: false, canDeleteBranch: false }) }));
                onNotice(`Deleted ${pr.headRef}.`);
                refreshAll();
              },
              (e) => onNotice(`Couldn’t delete ${pr.headRef}: ${errorMessage(e)}`),
            )
            .finally(() => setBusy(null));
          return;
      }
    },
    [pr, prPath, setMethod, optimistic, onNotice, refreshAll],
  );

  /** Confirms the panel's merge or auto-merge: a merge shows merged only once GitHub says so. */
  const confirm = useCallback(
    async (c: { method: MergeMethod; title?: string; message?: string; deleteBranch: boolean }) => {
      if (!pr || !panel || panel.mode === "close") return;
      const id = { repo: pr.repo, number: pr.number, prId: pr.id };
      const text = c.method === "rebase" ? {} : { ...(c.title !== undefined ? { title: c.title } : {}), ...(c.message !== undefined ? { message: c.message } : {}) };
      setBusy(panel.mode);
      setError(undefined);
      try {
        if (panel.mode === "auto") {
          await githubWrite("autoMerge", { ...id, enable: true, method: c.method, headSha: pr.headSha, ...text });
          patch<PrDetail>(prPath, (p) => ({ ...p, merge: withMerge(p, { autoMerge: { method: c.method } }) }));
          onNotice(`Auto-merge is on for #${pr.number} (${METHOD_WORDS[c.method]}): GitHub merges it once its requirements pass.`);
        } else {
          const r = await githubWrite("merge", { ...id, method: c.method, headSha: pr.headSha, ...text });
          if (r.merged !== false) patch<PrDetail>(prPath, (p) => ({ ...p, state: "merged" }));
          let note = r.merged === false ? `GitHub took #${pr.number}’s merge; it isn’t merged yet.` : `Merged #${pr.number}.`;
          if (c.deleteBranch && offersDelete(pr))
            try {
              await githubWrite("deleteBranch", { repo: pr.repo, number: pr.number });
              note = `Merged #${pr.number} and deleted ${pr.headRef}.`;
            } catch (e) {
              note = `Merged #${pr.number}; couldn’t delete ${pr.headRef}: ${errorMessage(e)}`;
            }
          onNotice(note);
        }
        setPanel(null);
        refreshAll();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [pr, panel, prPath, onNotice, refreshAll],
  );

  const close = useCallback(
    async (comment: string) => {
      if (!pr) return false;
      setBusy("close");
      setError(undefined);
      try {
        await githubWrite("state", { repo: pr.repo, number: pr.number, prId: pr.id, state: "closed", ...(comment.trim() ? { comment } : {}) });
        patch<PrDetail>(prPath, (p) => ({ ...p, state: "closed" }));
        onNotice(`Closed #${pr.number}.`);
        setPanel(null);
        refreshAll();
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [pr, prPath, onNotice, refreshAll],
  );

  return { method, setMethod, panel, setPanel, busy, error, run, confirm, close };
}
export type MergeBox = ReturnType<typeof useMergeBox>;

/** A small menu beneath a button, closing on a click outside or Esc. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [open]);
  const place = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  const keys = (e: React.KeyboardEvent<HTMLElement>) =>
    menuKeys(e, () => {
      setOpen(false);
      button.current?.focus({ preventScroll: true });
    });
  return { open, setOpen, anchor, button, place, keys };
}

/**
 * The header's merge buttons, beside Review: the main action as GitHub's
 * (a split Merge button choosing the method, Merge when ready, Enable
 * auto-merge, Ready for review, Reopen, Delete branch; a disabled Merge
 * saying what blocks it), then ⋯ with every action that applies. The panel
 * confirming a merge, auto-merge or close opens beneath them.
 */
export function MergeHeader({ pr, box }: { pr: PrDetail; box: MergeBox }) {
  const methodMenu = useMenu();
  const more = useMenu();
  const actions = mergeActions(pr, box.method);
  const has = (kind: MergeAction["kind"]) => actions.some((a) => a.kind === kind);
  const block = blockers(pr).find((b) => b.level === "block");
  const busy = !!box.busy;

  // The method the main button merges by: the one chosen, always one the PR allows.
  const method = actions.find((a): a is Extract<MergeAction, { kind: "merge" | "auto" }> => a.kind === "merge" || a.kind === "auto")?.method;
  const split = (label: string, kind: "merge" | "auto", tip: string, method: MergeMethod) => (
    <span className="menu-anchor gh-split" ref={methodMenu.anchor}>
      <button className="gh-merge-btn" onClick={() => box.run({ kind, method })} disabled={busy} data-tip={tip}>
        {kind === "merge" ? <GitMerge size={13} aria-hidden="true" /> : <Zap size={13} aria-hidden="true" />}
        {label}
      </button>
      {pr.merge.methods.length > 1 && (
        <button
          ref={methodMenu.button}
          className="gh-merge-btn gh-split-more"
          aria-label="Choose how it merges"
          aria-haspopup="menu"
          aria-expanded={methodMenu.open}
          data-tip="Choose how it merges"
          disabled={busy}
          onClick={() => methodMenu.setOpen(!methodMenu.open)}
        >
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      )}
      {methodMenu.open && (
        <div ref={methodMenu.place} role="menu" aria-label="Merge method" className="popover-menu gh-method-menu" onKeyDown={methodMenu.keys}>
          {pr.merge.methods.map((m) => (
            <button
              key={m}
              role="menuitemradio"
              aria-checked={m === method}
              tabIndex={-1}
              onClick={() => {
                methodMenu.setOpen(false);
                box.run({ kind, method: m });
              }}
            >
              <span className="gh-method-check">{m === method && <CircleCheck size={13} aria-hidden="true" />}</span>
              <span>
                <b>{kind === "merge" ? METHOD_BUTTON[m] : `Auto-merge: ${METHOD_WORDS[m]}`}</b>
                <small>{METHOD_HINT[m]}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </span>
  );

  let main: React.ReactNode = null;
  if (has("merge") && method)
    main = split(METHOD_BUTTON[method], "merge", adminMerge(pr) && !mergeableNow(pr) ? "Merge as an administrator, past unmet requirements" : "Merge it", method);
  else if (has("queue"))
    main = (
      <button className="gh-merge-btn" onClick={() => box.run({ kind: "queue" })} disabled={busy} data-tip="Add it to the base branch’s merge queue">
        <ListOrdered size={13} aria-hidden="true" />
        Merge when ready
      </button>
    );
  else if (has("auto") && method) main = split("Enable auto-merge", "auto", `GitHub merges it (${METHOD_WORDS[method]}) once its requirements pass`, method);
  else if (has("dequeue"))
    main = (
      <button className="secondary" onClick={() => box.run({ kind: "dequeue" })} disabled={busy}>
        Remove from queue
      </button>
    );
  else if (has("auto-off"))
    main = (
      <button className="secondary" onClick={() => box.run({ kind: "auto-off" })} disabled={busy}>
        Disable auto-merge
      </button>
    );
  else if (has("ready"))
    main = (
      <button className="secondary" onClick={() => box.run({ kind: "ready" })} disabled={busy}>
        Ready for review
      </button>
    );
  else if (pr.state === "open" && pr.merge.canMerge && !pr.merge.queueRequired && block)
    main = (
      <button className="gh-merge-btn" disabled aria-description={block.text} data-tip={block.text}>
        <GitMerge size={13} aria-hidden="true" />
        {box.method ? METHOD_BUTTON[box.method] : "Merge"}
      </button>
    );
  else if (has("reopen"))
    main = (
      <button className="secondary" onClick={() => box.run({ kind: "reopen" })} disabled={busy}>
        Reopen
      </button>
    );
  else if (has("delete-branch"))
    main = (
      <button className="secondary" onClick={() => box.run({ kind: "delete-branch" })} disabled={busy} data-tip={`Delete ${pr.headRef}`}>
        Delete branch
      </button>
    );

  return (
    <div className="gh-merge-anchor">
      {main}
      {actions.length > 0 && (
        <span className="menu-anchor" ref={more.anchor}>
          <button
            ref={more.button}
            className="icon-btn gh-more"
            aria-label="More actions for this pull request"
            aria-haspopup="menu"
            aria-expanded={more.open}
            data-tip="More actions"
            onClick={() => more.setOpen(!more.open)}
          >
            <Ellipsis size={15} aria-hidden="true" />
          </button>
          {more.open && (
            <div ref={more.place} role="menu" aria-label="Pull request actions" className="popover-menu linear-row-menu gh-more-menu" onKeyDown={more.keys}>
              {actions.map((a) => (
                <button
                  key={actionKey(a)}
                  role="menuitem"
                  tabIndex={-1}
                  className={a.kind === "close" || a.kind === "delete-branch" ? "danger-item" : undefined}
                  disabled={busy}
                  onClick={() => {
                    more.setOpen(false);
                    box.run(a);
                  }}
                >
                  {actionLabel(a, pr)}
                </button>
              ))}
            </div>
          )}
        </span>
      )}
      {box.panel?.mode === "close" && <ClosePanel pr={pr} box={box} />}
      {box.panel && box.panel.mode !== "close" && <MergePanel key={box.panel.mode} pr={pr} box={box} mode={box.panel.mode} method={box.method ?? box.panel.method} />}
    </div>
  );
}

const escapeCloses = (onClose: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }
};

/**
 * Confirming a merge (or turning auto-merge on): the method (the
 * repository's allowed ones), the commit's title and message for a merge or
 * squash (GitHub's defaults, editable), deleting the branch afterwards
 * (offered where the token may, remembered), and, for an administrator past
 * unmet requirements, what they are and a box to tick. ⌘↩ confirms; Esc closes.
 */
function MergePanel({ pr, box, mode, method }: { pr: PrDetail; box: MergeBox; mode: "merge" | "auto"; method: MergeMethod }) {
  const [text, setText] = useState(() => (method === "rebase" ? { title: "", body: "" } : defaultMessage(pr, method)));
  useEffect(() => setText(method === "rebase" ? { title: "", body: "" } : defaultMessage(pr, method)), [method]);
  const [del, setDel] = useState(deleteAfterMerge);
  const [bypass, setBypass] = useState(false);
  const admin = mode === "merge" && adminMerge(pr) && !mergeableNow(pr);
  const list = blockers(pr);
  const busy = box.busy === mode;
  const ready = !busy && (!admin || bypass) && (method === "rebase" || !!text.title.trim());
  const submit = () => {
    if (!ready) return;
    void box.confirm({ method, ...(method !== "rebase" ? { title: text.title.trim(), message: text.body } : {}), deleteBranch: mode === "merge" && del });
  };
  const label = mode === "auto" ? (busy ? "Enabling…" : "Confirm auto-merge") : busy ? "Merging…" : `Confirm ${METHOD_BUTTON[method].replace(" pull request", "").toLowerCase()}`;
  return (
    <div
      className="gh-review-panel gh-merge-panel"
      role="dialog"
      aria-label={mode === "auto" ? "Enable auto-merge" : METHOD_BUTTON[method]}
      onKeyDown={(e) => {
        escapeCloses(() => box.setPanel(null))(e);
        if (e.key === "Enter" && e.metaKey) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <h3>{mode === "auto" ? "Enable auto-merge" : METHOD_BUTTON[method]}</h3>
      {mode === "auto" && <p className="gh-hint">GitHub merges it once its requirements pass{list.length ? ":" : "."}</p>}
      {(admin || mode === "auto" || list.some((b) => b.level === "warn")) && list.length > 0 && (
        <ul className={`gh-merge-reasons${admin ? " admin" : ""}`}>
          {list.map((b) => (
            <li key={b.key} className={b.level}>
              {b.level === "block" ? <CircleX size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
              {b.text}
            </li>
          ))}
        </ul>
      )}
      {pr.merge.methods.length > 1 && (
        <div className="gh-verdicts" role="radiogroup" aria-label="Merge method">
          {pr.merge.methods.map((m) => (
            <label key={m} className={`gh-verdict${method === m ? " selected" : ""}`}>
              <input type="radio" name="merge-method" checked={method === m} onChange={() => box.setMethod(m)} />
              <span>
                <b>{METHOD_BUTTON[m]}</b>
                <small>{METHOD_HINT[m]}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {method !== "rebase" && (
        <div className="gh-merge-message">
          <label>
            <span>Commit title</span>
            <input autoFocus value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} maxLength={1000} />
          </label>
          <label>
            <span>Commit message</span>
            <textarea rows={4} value={text.body} onChange={(e) => setText({ ...text, body: e.target.value })} placeholder="Add an optional extended description" />
          </label>
        </div>
      )}
      {mode === "merge" && offersDelete(pr) && (
        <label className="gh-check">
          <input
            type="checkbox"
            checked={del}
            onChange={(e) => {
              setDel(e.target.checked);
              rememberDeleteAfterMerge(e.target.checked);
            }}
          />
          Delete <code>{pr.headRef}</code> after merging
        </label>
      )}
      {pr.merge.deleteBranchOnMerge && pr.merge.headBranchExists && (
        <p className="gh-hint">
          GitHub deletes <code>{pr.headRef}</code> after merging (the repository’s setting).
        </p>
      )}
      {admin && (
        <label className="gh-check gh-bypass">
          <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
          Merge without waiting for requirements to be met (bypass rules)
        </label>
      )}
      {box.error && (
        <p className="gh-error" role="alert">
          {box.error}
        </p>
      )}
      <div className="gh-merge-panel-foot">
        <button className="secondary" onClick={() => box.setPanel(null)} disabled={busy}>
          Cancel
        </button>
        <button className="gh-merge-btn" onClick={submit} disabled={!ready} {...(method !== "rebase" ? { "data-tip": "⌘↩" } : {})}>
          {label}
        </button>
      </div>
    </div>
  );
}

/** Closing it: an optional comment, posted first, then Close pull request. Esc closes the panel. */
function ClosePanel({ pr, box }: { pr: PrDetail; box: MergeBox }) {
  const busy = box.busy === "close";
  return (
    <div className="gh-review-panel gh-merge-panel" role="dialog" aria-label="Close pull request" onKeyDown={escapeCloses(() => box.setPanel(null))}>
      <h3>Close #{pr.number} without merging?</h3>
      <CommentBox
        autoFocus
        placeholder="Leave a comment (optional), posted before it closes"
        submitLabel={busy ? "Closing…" : "Close pull request"}
        busy={busy}
        error={box.error}
        allowEmpty
        onSubmit={box.close}
        extra={() => (
          <button className="secondary" onClick={() => box.setPanel(null)} disabled={busy}>
            Cancel
          </button>
        )}
      />
    </div>
  );
}

/**
 * The Conversation's Merge section, GitHub's merge box: its state (merged by
 * whom, closed, or each thing blocking it), auto-merge and the merge queue,
 * and every action that applies as a button.
 */
export function MergeSection({ pr, box }: { pr: PrDetail; box: MergeBox }) {
  const m = pr.merge;
  const list = blockers(pr);
  const actions = mergeActions(pr, box.method);
  const busy = !!box.busy;
  return (
    <div className="gh-merge-section">
      <ul className="gh-merge-reasons">
        {pr.state === "merged" ? (
          <li className="merged">
            <GitMerge size={13} aria-hidden="true" />
            <span>
              Merged{m.mergedBy ? <> by <b>{m.mergedBy.login}</b></> : null}
              {m.mergedAt && <> <Time at={m.mergedAt} /></>}.
            </span>
          </li>
        ) : pr.state === "closed" ? (
          <li className="closed">
            <GitPullRequestClosed size={13} aria-hidden="true" />
            <span>Closed without merging{m.closedAt && <> <Time at={m.closedAt} /></>}.</span>
          </li>
        ) : (
          <>
            {list.map((b) => (
              <li key={b.key} className={b.level}>
                {b.level === "block" ? <CircleX size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
                <span>{b.text}</span>
              </li>
            ))}
            {pr.mergeable === "mergeable" && !list.some((b) => b.key === "conflicts") && (
              <li className="ok">
                <CircleCheck size={13} aria-hidden="true" />
                <span>No conflicts with the base branch.</span>
              </li>
            )}
            {mergeableNow(pr) && !list.length && (
              <li className="ok">
                <CircleCheck size={13} aria-hidden="true" />
                <span>{m.queueRequired ? "Ready for the merge queue." : "Ready to merge."}</span>
              </li>
            )}
          </>
        )}
        {m.autoMerge && pr.state !== "merged" && (
          <li className="auto">
            <Zap size={13} aria-hidden="true" />
            <span>
              Auto-merge is on ({METHOD_WORDS[m.autoMerge.method]})
              {m.autoMerge.by && (
                <>
                  , turned on by <Avatar person={m.autoMerge.by} size={14} /> <b>{m.autoMerge.by.login}</b>
                </>
              )}
              {m.autoMerge.at && <> <Time at={m.autoMerge.at} /></>}.
            </span>
          </li>
        )}
        {m.queue && pr.state !== "merged" && (
          <li className="auto">
            <ListOrdered size={13} aria-hidden="true" />
            <span>
              In the merge queue{m.queue.position ? ` (position ${m.queue.position})` : ""}: {QUEUE_WORDS[m.queue.state]}.
            </span>
          </li>
        )}
        {m.queueRequired && !m.queue && pr.state === "open" && (
          <li className="info">
            <ListOrdered size={13} aria-hidden="true" />
            <span>{pr.baseRef} merges through a merge queue.</span>
          </li>
        )}
      </ul>
      {actions.length > 0 && (
        <div className="gh-merge-actions">
          {actions.map((a, i) => (
            <button
              key={actionKey(a)}
              className={i === 0 && (a.kind === "merge" || a.kind === "queue" || a.kind === "auto") ? "gh-merge-btn" : a.kind === "close" || a.kind === "delete-branch" ? "secondary gh-danger" : "secondary"}
              disabled={busy}
              onClick={() => box.run(a)}
            >
              {actionLabel(a, pr)}
            </button>
          ))}
        </div>
      )}
      {!actions.length && pr.state === "open" && !m.canMerge && !canMergeNow(pr) && !canAutoMerge(pr) && (
        <p className="gh-hint">The token can’t merge into {pr.repo}.</p>
      )}
    </div>
  );
}
