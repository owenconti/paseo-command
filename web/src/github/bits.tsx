import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
} from "lucide-react";
import { ago } from "../api";
import { Markdown } from "../Markdown";
import type { ChecksState, Person, PrState, ReviewDecision, YourReview } from "./types";

/** The small pieces the GitHub screens share: people, times, states, the comment box. */

/** Avatars that didn't load: their initials show from then on. */
const noAvatar = new Set<string>();
const AVATAR = /^https:\/\/avatars\.githubusercontent\.com\//;

export function Avatar({ person, size = 18 }: { person: Person | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  const login = person?.login ?? "ghost";
  const src = person?.avatarUrl && AVATAR.test(person.avatarUrl) ? person.avatarUrl : undefined;
  const shown = src && !broken && !noAvatar.has(src);
  return (
    <span
      className="gh-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      data-tip={person?.name ? `${person.name} (${login})` : login}
      aria-label={login}
    >
      {shown ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => {
            noAvatar.add(src);
            setBroken(true);
          }}
        />
      ) : (
        login.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

/** "3h ago", with the full date on hover, kept current by the view's minute tick. */
export function Time({ at }: { at: string }) {
  return (
    <time className="gh-time" dateTime={at} title={new Date(at).toLocaleString()}>
      {ago(at)}
    </time>
  );
}

export const STATE_LABEL: Record<PrState, string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

export function PrStateIcon({ state, size = 15 }: { state: PrState; size?: number }) {
  const Icon =
    state === "merged" ? GitMerge : state === "closed" ? GitPullRequestClosed : state === "draft" ? GitPullRequestDraft : GitPullRequest;
  return (
    <span className={`gh-pr-state ${state}`} aria-label={STATE_LABEL[state]} data-tip={STATE_LABEL[state]}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}

export const CHECKS_LABEL: Record<ChecksState | "skipped", string> = {
  passing: "Checks passing",
  failing: "Checks failing",
  pending: "Checks running",
  skipped: "Skipped",
};

export function ChecksIcon({ state, size = 13 }: { state: ChecksState | "skipped" | null; size?: number }) {
  if (!state) return null;
  const Icon = state === "passing" ? CircleCheck : state === "failing" ? CircleX : CircleDashed;
  return (
    <span className={`gh-checks ${state}`} aria-label={CHECKS_LABEL[state]} data-tip={CHECKS_LABEL[state]}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}

export const DECISION_LABEL: Record<ReviewDecision, string> = {
  approved: "Approved",
  changes: "Changes requested",
  review: "Review required",
};
export const YOUR_REVIEW_LABEL: Record<YourReview, string> = {
  approved: "You approved",
  changes: "You requested changes",
  commented: "You commented",
  pending: "Your review is pending",
};

export function Decision({ decision }: { decision: ReviewDecision | null }) {
  if (!decision) return null;
  return <span className={`gh-decision ${decision}`}>{DECISION_LABEL[decision]}</span>;
}

export function CommentCount({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="gh-comment-count" aria-label={`${count} comments`} data-tip={`${count} comments`}>
      <MessageSquare size={12} aria-hidden="true" />
      {count}
    </span>
  );
}

/** + and − counts, as GitHub shows them. */
export function Churn({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="gh-churn" aria-label={`${additions} added, ${deletions} removed`}>
      <span className="add">+{additions.toLocaleString()}</span>
      <span className="del">−{deletions.toLocaleString()}</span>
    </span>
  );
}

/** GitHub-flavoured Markdown from GitHub, drawn as the chat draws it (no raw HTML; images only as Markdown allows). */
export function Body({ text, empty }: { text: string; empty?: string }) {
  if (!text.trim()) return empty ? <p className="gh-body-empty">{empty}</p> : null;
  return (
    <div className="gh-body">
      <Markdown text={text} />
    </div>
  );
}

/**
 * A Markdown comment box: Write and Preview, ⌘↩ submits, Esc cancels. Its
 * text stays in `initial`'s owner when it's a draft; the box keeps its own
 * while open.
 */
export function CommentBox({
  initial = "",
  placeholder = "Leave a comment",
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  error,
  autoFocus,
  extra,
  onChange,
  allowEmpty,
}: {
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  /** Answers whether it went through (the box empties then). */
  onSubmit: (text: string) => Promise<boolean> | boolean;
  onCancel?: () => void;
  busy?: boolean;
  error?: string;
  autoFocus?: boolean;
  /** More buttons beside Submit, given the text. */
  extra?: (text: string) => ReactNode;
  onChange?: (text: string) => void;
  /** Submit with nothing written (an approval without a summary). */
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [preview, setPreview] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);
  // Grows with its text, up to a third of the window.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight / 3))}px`;
  }, [text, preview]);
  const submit = async () => {
    if (busy || (!allowEmpty && !text.trim())) return;
    if (await onSubmit(text)) {
      setText("");
      onChange?.("");
      setPreview(false);
    }
  };
  return (
    <div className="gh-comment-box">
      <div className="gh-comment-box-tabs" role="tablist">
        <button role="tab" aria-selected={!preview} className={!preview ? "selected" : ""} onClick={() => setPreview(false)}>
          Write
        </button>
        <button role="tab" aria-selected={preview} className={preview ? "selected" : ""} onClick={() => setPreview(true)}>
          Preview
        </button>
      </div>
      {preview ? (
        <div className="gh-comment-preview">
          <Body text={text} empty="Nothing to preview." />
        </div>
      ) : (
        <textarea
          ref={area}
          value={text}
          placeholder={placeholder}
          rows={3}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            onChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape" && onCancel) {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
        />
      )}
      {error && (
        <p className="gh-error" role="alert">
          {error}
        </p>
      )}
      <div className="gh-comment-box-actions">
        <span className="gh-hint">Markdown · ⌘↩</span>
        {onCancel && (
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        {extra?.(text)}
        <button className="primary" onClick={() => void submit()} disabled={busy || (!allowEmpty && !text.trim())}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
