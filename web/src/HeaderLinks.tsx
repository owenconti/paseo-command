import { useEffect, useId, useRef, useState } from "react";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  ListOrdered,
} from "lucide-react";
import { placePopover } from "./popover";
import {
  linearKey,
  linearSlug,
  linearUrl,
  openExternal,
  prTip,
  setLinearWorkspace,
  useLinearIssue,
  useLinearWorkspace,
  useMergeQueue,
  usePullRequest,
} from "./links";
import type { Agent, PullRequest, Workspace } from "./types";
import { plainText } from "./ui";

const PR_STATE = {
  open: { label: "Open", Icon: GitPullRequest },
  draft: { label: "Draft", Icon: GitPullRequestDraft },
  merged: { label: "Merged", Icon: GitMerge },
  closed: { label: "Closed", Icon: GitPullRequestClosed },
} satisfies Record<PullRequest["state"], unknown>;

/** Linear's mark (Simple Icons, CC0). */
function LinearMark({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  );
}

/**
 * The session header's links, after the branch chip: the workspace's pull
 * request and its Linear issue. Each appears only when there is one; both
 * open in the system browser (the desktop app's external-link path).
 */
export function HeaderLinks({
  agent,
  workspace,
}: {
  agent: Agent;
  workspace?: Workspace;
}) {
  const pr = usePullRequest(workspace);
  const key = linearKey({
    branch: workspace?.branch || agent.branch,
    prTitle: pr?.title,
    prBody: pr?.body,
    agentTitle: agent.name,
  });
  return (
    <>
      {pr && <PrChip pr={pr} workspace={workspace} />}
      {key && <LinearChip issueKey={key} />}
    </>
  );
}

function PrChip({
  pr: reported,
  workspace,
}: {
  pr: PullRequest;
  workspace?: Workspace;
}) {
  const { queue, state } = useMergeQueue(workspace, reported);
  // GitHub's current state wins over Paseo's, which can lag a merge.
  const pr =
    state && state !== reported.state ? { ...reported, state } : reported;
  const { label, Icon } = PR_STATE[pr.state] ?? PR_STATE.open;
  const open = pr.state === "open" || pr.state === "draft";
  // CI and the merge queue only matter while the PR is open; a mark is drawn
  // only for what is known (an absent field is unknown, never "passing").
  const ci = open && pr.ci && pr.ci.state !== "none" ? pr.ci.state : null;
  const queued = pr.state === "open" && queue?.queued ? queue : null;
  return (
    <a
      className="link-chip pr-chip"
      data-state={pr.state}
      // Queued for merge reads as its own state, not as merely open.
      data-queued={queued ? "" : undefined}
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      // The number stands for the PR; its title, CI and queue are the tooltip.
      data-summary
      data-tip={`${prTip(pr, queue)} (G)`}
    >
      <Icon size={11} aria-hidden="true" />
      <span>#{pr.number}</span>
      <span className="link-chip-state">
        {queued ? "Queued for merge" : label}
      </span>
      {ci && <span className="pr-ci" data-ci={ci} aria-hidden="true" />}
      {queued && (
        <span className="pr-queue" data-queue={queued.state ?? "queued"}>
          <ListOrdered size={10} aria-hidden="true" />
          {queued.position ? <span>{queued.position}</span> : null}
        </span>
      )}
    </a>
  );
}

function LinearChip({ issueKey }: { issueKey: string }) {
  const slug = useLinearWorkspace();
  const issue = useLinearIssue(issueKey);
  const [asking, setAsking] = useState(false);
  const href = slug ? linearUrl(slug, issueKey) : issue?.url || null;
  const tip = issue
    ? [issue.title, issue.state].filter(Boolean).join(" · ") ||
      `${issueKey} in Linear`
    : `Open ${issueKey} in Linear`;
  if (href)
    return (
      <a
        className="link-chip linear-chip"
        href={href}
        target="_blank"
        rel="noreferrer"
        data-summary
        data-tip={`${tip} (L)`}
      >
        <LinearMark />
        <span>{issueKey}</span>
      </a>
    );
  return (
    <span className="menu-anchor linear-anchor">
      <button
        className="link-chip linear-chip"
        aria-haspopup="dialog"
        aria-expanded={asking}
        data-summary
        data-tip={`${tip} (set your Linear workspace first) (L)`}
        onClick={() => setAsking(!asking)}
      >
        <LinearMark />
        <span>{issueKey}</span>
      </button>
      {asking && (
        <SlugPrompt
          issueKey={issueKey}
          onClose={() => setAsking(false)}
          onSaved={(saved) => {
            setAsking(false);
            const url = linearUrl(saved, issueKey);
            if (url) openExternal(url);
          }}
        />
      )}
    </span>
  );
}

/** A pasted linear.app URL, as the slug the field shows after its prefix. */
const bare = (value: string) =>
  /linear\.app\//i.test(value) ? (linearSlug(value) ?? value) : value;

/** The one-time Linear workspace setting, asked on the first click. */
function SlugPrompt({
  issueKey,
  onClose,
  onSaved,
}: {
  issueKey: string;
  onClose: () => void;
  onSaved: (slug: string) => void;
}) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const slug = linearSlug(value);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!box.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  return (
    <div
      ref={(el) => {
        box.current = el;
        placePopover(el);
      }}
      role="dialog"
      aria-label="Linear workspace"
      className="popover-menu left linear-slug"
      onKeyDown={(e) => {
        if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!slug) return;
          setLinearWorkspace(slug);
          onSaved(slug);
        }}
      >
        <label htmlFor={id}>
          <b>Your Linear workspace</b>
          <small>
            Asked once, to link {issueKey}. It's kept in Settings (the gear),
            where you can change it.
          </small>
        </label>
        <div className="linear-slug-field">
          <span aria-hidden="true">linear.app/</span>
          <input
            id={id}
            autoFocus
            value={value}
            placeholder="your-team"
            spellCheck={false}
            {...plainText}
            aria-invalid={touched && !slug}
            onChange={(e) => setValue(bare(e.target.value))}
          />
        </div>
        {touched && !slug && (
          <small className="linear-slug-error" role="alert">
            Use the part after linear.app/ (letters, numbers and dashes).
          </small>
        )}
        <div className="linear-slug-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save and open
          </button>
        </div>
      </form>
    </div>
  );
}

/** The Linear workspace setting, beside the app's other settings. */
export function LinearWorkspaceSetting() {
  const slug = useLinearWorkspace();
  const [value, setValue] = useState(slug);
  const id = useId();
  useEffect(() => setValue(slug), [slug]);
  const save = () => {
    const next = linearSlug(value);
    if (next || !value.trim()) setLinearWorkspace(next ?? "");
    else setValue(slug);
  };
  return (
    <div className="linear-setting">
      <label htmlFor={id}>
        <b>Linear workspace</b>
        <small>For issue links in agent headers</small>
      </label>
      <div className="linear-slug-field">
        <span aria-hidden="true">linear.app/</span>
        <input
          id={id}
          value={value}
          placeholder="your-team"
          spellCheck={false}
          {...plainText}
          onChange={(e) => setValue(bare(e.target.value))}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </div>
    </div>
  );
}
