import { useEffect, useState } from "react";
import { CircleDot, GitPullRequest, LoaderCircle, Search } from "lucide-react";
import { api, errorMessage } from "../api";
import { hostQuery } from "../types";
import { Menu } from "./Menu";
import type { GitHubItem } from "./types";
import { plainText } from "../ui";

/** Searches the repository's GitHub issues and pull requests to attach one. */
export function GitHubPicker({
  agentId,
  host,
  onPick,
  onClose,
}: {
  agentId: string;
  host?: string;
  onPick: (item: GitHubItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<GitHubItem[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    const t = setTimeout(() => {
      api<{ items: GitHubItem[]; error: string | null }>(
        `agents/${agentId}/github${hostQuery(host)}${host ? "&" : "?"}q=${encodeURIComponent(q)}`,
        undefined,
        controller.signal,
      )
        .then((r) => {
          setItems(Array.isArray(r.items) ? r.items : []);
          setError(r.error || "");
          setState(r.error ? "error" : "idle");
          setActive(0);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setError(errorMessage(e));
          setState("error");
        });
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, agentId, host]);
  return (
    <Menu onClose={onClose} role="dialog" label="Attach issue or PR">
      <div className="github-picker">
        <p className="menu-label">Attach issue or PR</p>
        <label className="picker-search">
          <Search size={13} />
          <input
            {...plainText}
            autoFocus
            value={q}
            placeholder="Search issues and PRs..."
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) =>
                  Math.max(
                    0,
                    Math.min(
                      items.length - 1,
                      i + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              } else if (e.key === "Enter" && items[active]) {
                e.preventDefault();
                onPick(items[active]);
              }
            }}
          />
          {state === "loading" && (
            <LoaderCircle size={12} className="spinning" />
          )}
        </label>
        <div className="picker-list">
          {items.map((item, i) => (
            <button
              aria-description={`Attach ${item.kind === "pr" ? "pull request" : "issue"} #${item.number}: ${item.title}`}
              key={item.url}
              className={i === active ? "active" : ""}
              onMouseMove={() => setActive(i)}
              onClick={() => onPick(item)}
            >
              {item.kind === "pr" ? (
                <GitPullRequest size={13} />
              ) : (
                <CircleDot size={13} />
              )}
              <span>
                <b>
                  #{item.number} {item.title}
                </b>
                <small>
                  {item.kind === "pr" ? "Pull request" : "Issue"}
                  {item.state ? ` · ${item.state.toLowerCase()}` : ""}
                </small>
              </span>
            </button>
          ))}
          {state !== "loading" && !items.length && (
            <p className="autocomplete-note">{error || "No results found."}</p>
          )}
        </div>
      </div>
    </Menu>
  );
}
