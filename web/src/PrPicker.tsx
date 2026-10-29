import { useEffect, useState } from "react";
import { GitPullRequest, X } from "lucide-react";
import { api } from "./api";
import { plainText } from "./ui";
import { prNumberOf, type PullRequestChoice } from "./presets";

type Found = PullRequestChoice & { state: string };

/**
 * New agent's pull request field, in Worktree mode: paste a number or a PR
 * URL, or type to search the project's pull requests (the daemon's GitHub
 * search). The chosen one's worktree checks out its branch.
 */
export function PrPicker({
  cwd,
  host,
  value,
  onChange,
}: {
  cwd: string;
  host?: string;
  value: PullRequestChoice | null;
  onChange: (pr: PullRequestChoice | null) => void;
}) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const typed = prNumberOf(text);
  // A pasted URL is searched by its number.
  const query = typed ? String(typed) : text.trim();

  useEffect(() => {
    setFound([]);
    setError("");
    if (value || !query || !cwd) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ cwd, q: query, ...(host ? { host } : {}) });
      api<{ prs: Found[]; error: string | null }>(
        `drafts/prs?${params}`,
        undefined,
        controller.signal,
      )
        .then((r) => {
          setFound(Array.isArray(r.prs) ? r.prs : []);
          setError(r.error || "");
          setActive(0);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(String(e?.message || e));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, cwd, host, value]);

  const choose = (pr: PullRequestChoice) => {
    onChange(pr);
    setText("");
    setOpen(false);
  };
  /** The highlighted match, else the number typed (its branch found by the daemon). */
  const pick = () => {
    const match = found[active] ?? found.find((f) => f.number === typed);
    if (match) choose(match);
    else if (typed) choose({ number: typed });
  };

  if (value)
    return (
      <div className="pr-picker">
        <span className="field-label">Pull request</span>
        <div className="pr-chosen">
          <GitPullRequest size={13} aria-hidden="true" />
          <span>
            #{value.number}
            {value.title ? ` ${value.title}` : ""}
          </span>
          <button
            className="ghost-btn"
            aria-label={`Clear pull request #${value.number}`}
            onClick={() => onChange(null)}
          >
            <X size={13} />
          </button>
        </div>
      </div>
    );
  const listed = open && (found.length > 0 || !!error);
  return (
    <label className="pr-picker">
      <span>
        Pull request <em>optional</em>
      </span>
      <input
        {...plainText}
        role="combobox"
        aria-expanded={listed}
        aria-controls="pr-picker-list"
        aria-description="Paste a pull request number or URL, or search by title, to check out its branch in the new worktree"
        value={text}
        placeholder="#123, a PR URL, or search"
        maxLength={200}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + found.length) % Math.max(found.length, 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick();
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {listed && (
        <ul className="pr-picker-list" id="pr-picker-list" role="listbox">
          {error && <li className="pr-picker-error">{error}</li>}
          {found.map((pr, i) => (
            <li
              key={pr.number}
              role="option"
              aria-selected={i === active}
              // Before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(pr);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <b>#{pr.number}</b> <span>{pr.title}</span>
              {pr.state && pr.state.toLowerCase() !== "open" && <small>{pr.state}</small>}
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
