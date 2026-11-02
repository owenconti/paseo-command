import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BookMarked, Building2, Lock, Search, Star, X } from "lucide-react";
import { plainText } from "../ui";
import { githubWrite, invalidate, patch, readPath, useGithubRead } from "./api";
import type { GithubStars, RepoList, RepoRow, RepoSearch } from "./types";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const REPOS_PATH = readPath("repos");

/** Whether a repository, or an owner, is starred. */
export const repoStarred = (stars: GithubStars | undefined, repo: string) => !!stars?.repos.some((r) => same(r, repo));
export const orgStarred = (stars: GithubStars | undefined, owner: string) => !!stars?.orgs.some((o) => same(o, owner));

/**
 * Stars or unstars a repository or an organization: shown at once in the
 * sidebar, saved in settings.json, and the list asked again (a repository
 * starred by name joins it then). Rejects with the server's words.
 */
export async function setStar(kind: "repo" | "org", name: string, starred: boolean): Promise<void> {
  patch<RepoList>(REPOS_PATH, (d) => {
    const key = kind === "repo" ? "repos" : "orgs";
    const rest = d.stars[key].filter((v) => !same(v, name));
    return {
      stars: { ...d.stars, [key]: starred ? [...rest, name] : rest },
      repos: d.repos.map((r) =>
        kind === "repo" ? (same(r.repo, name) ? { ...r, starred } : r) : same(r.owner, name) ? { ...r, ownerStarred: starred } : r,
      ),
    };
  });
  try {
    await githubWrite("star", { kind, name, starred });
  } finally {
    invalidate(REPOS_PATH, readPath("repoSearch"));
  }
}

/** What's typed, as the search asks it (the server reads addresses and `@owner` too). */
const searchQuery = (text: string) => text.trim().replace(/\s+/g, " ");
/** The repositories the sidebar knows that match at once, while GitHub is asked. */
function knownMatches(list: RepoList | undefined, text: string): RepoRow[] {
  const t = searchQuery(text)
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//, "")
    .replace(/^@/, "");
  const words = t.split(/[\s]+/).filter(Boolean);
  return (list?.repos ?? []).filter((r) => words.every((w) => r.repo.toLowerCase().includes(w)));
}

type Group = { owner: string; ownerStarred: boolean; repos: RepoRow[] };

/** Repositories by owner: owners in order of first appearance, then (`extra`) starred owners with none listed. */
function groups(rows: RepoRow[], extra: string[] = []): Group[] {
  const out: Group[] = [];
  for (const r of rows) {
    let g = out.find((x) => same(x.owner, r.owner));
    if (!g) out.push((g = { owner: r.owner, ownerStarred: r.ownerStarred, repos: [] }));
    g.repos.push(r);
  }
  for (const owner of extra) if (!out.some((g) => same(g.owner, owner))) out.push({ owner, ownerStarred: true, repos: [] });
  return out;
}

/** The repositories ⌘K lists (those the sidebar knows), favourites first. */
export function repoOrder(list: RepoList | undefined): { repo: string; favourite: boolean }[] {
  return (list?.repos ?? []).map((r) => ({ repo: r.repo, favourite: r.starred || r.ownerStarred }));
}

export type RepoNavControl = { find(): void };

/**
 * The GitHub sidebar's Repositories: a search field, then Favourites (starred
 * repositories, and those of starred organizations, with the organizations'
 * heads even when none has open pull requests), each counting its open pull
 * requests, and the repository open now when it isn't one of them. Typing
 * finds any repository you can see by name, `owner/name` or owner (`q/repoSearch`:
 * those you know of first, then GitHub's search, asked once typing pauses);
 * ↓/↑ move through what's found, Enter opens it, Esc clears the field. A star on a
 * row or an owner's head stars it.
 */
export function RepoNav({
  list,
  unavailable,
  current,
  selected,
  onOpen,
  onNotice,
  control,
}: {
  list: RepoList | undefined;
  unavailable?: string;
  /** The repository open now (its pull requests, or one of them). */
  current?: string;
  /** Its pull requests show (not one of them). */
  selected?: boolean;
  onOpen: (repo: string) => void;
  onNotice: (message: string) => void;
  control?: React.MutableRefObject<RepoNavControl | null>;
}) {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  if (control) control.current = { find: () => input.current?.focus() };
  const query = searchQuery(text);
  // GitHub is asked once typing pauses (300 ms); what the sidebar knows shows at once.
  useEffect(() => {
    const t = setTimeout(() => setAsked(query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query]);
  const search = useGithubRead<RepoSearch>(asked ? readPath("repoSearch", { q: asked }) : null);

  const star = (kind: "repo" | "org", name: string, starred: boolean) =>
    setStar(kind, name, starred).catch((e: unknown) => onNotice(`Couldn’t ${starred ? "star" : "unstar"} ${name}: ${e instanceof Error ? e.message : String(e)}`));
  const open = (repo: string) => {
    setText("");
    onOpen(repo);
  };

  const starButton = (kind: "repo" | "org", name: string, on: boolean) => (
    <button
      className={`icon-btn gh-star${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={`${on ? "Unstar" : "Star"} ${name}`}
      data-tip={on ? "Unstar" : kind === "repo" ? "Star this repository" : "Star this organization"}
      onClick={() => void star(kind, name, !on)}
    >
      <Star size={12} aria-hidden="true" fill={on ? "currentColor" : "none"} />
    </button>
  );
  const repoRow = (r: RepoRow, label: string, found = false) => {
    const isSelected = !!current && selected && same(current, r.repo);
    // Starred shows as the sidebar knows it (a star just set shows at once).
    const starred = repoStarred(list?.stars, r.repo) || (!list && r.starred);
    return (
      <div key={r.repo} className="gh-repo-row">
        <button
          className={`gh-nav-item${isSelected ? " selected" : ""}`}
          aria-current={isSelected ? "page" : undefined}
          data-tip={r.missing ? `GitHub has no ${r.repo} the token can see` : `${r.repo}'s pull requests`}
          data-found={found || undefined}
          onClick={() => open(r.repo)}
        >
          {r.private ? <Lock size={14} aria-hidden="true" /> : <BookMarked size={14} aria-hidden="true" />}
          <span className="gh-nav-label">{label}</span>
          {r.open > 0 && <span className="gh-count">{r.open}</span>}
        </button>
        {starButton("repo", r.repo, starred)}
      </div>
    );
  };
  const group = (g: Group, section: string) => (
    <div key={`${section}:${g.owner}`} className="gh-repo-group" role="group" aria-label={g.owner}>
      <div className="gh-org-head">
        <span className="gh-org-name">{g.owner}</span>
        {starButton("org", g.owner, g.ownerStarred)}
      </div>
      {g.repos.map((r) => repoRow(r, r.repo.slice(r.owner.length + 1) || r.repo))}
      {!g.repos.length && <p className="gh-repo-none">No open pull requests</p>}
    </div>
  );

  // ↓ from the field goes to what's found, ↑/↓ through it, ↑ from the first back; Enter in the field opens the first.
  const moveKeys = (e: ReactKeyboardEvent<HTMLElement>) => {
    const items = [...(results.current?.querySelectorAll<HTMLButtonElement>("[data-found]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const next = at + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) input.current?.focus();
      else items[Math.min(next, items.length - 1)]?.focus();
    } else if (e.key === "Escape" && at >= 0) {
      e.preventDefault();
      e.stopPropagation();
      input.current?.focus();
    }
  };

  const rows = list?.repos ?? [];
  const favourites = groups(
    rows.filter((r) => r.starred || r.ownerStarred),
    list?.stars.orgs,
  );
  const openRepo =
    current && !favourites.some((g) => g.repos.some((r) => same(r.repo, current)))
      ? (rows.find((r) => same(r.repo, current)) ?? { repo: current, owner: current.split("/")[0]!, open: 0, starred: false, ownerStarred: false, private: false })
      : undefined;
  const answered = search.data && same(search.data.query, asked) && same(asked, query) ? search.data : undefined;
  const found = answered?.repos ?? knownMatches(list, query);
  const owner = answered?.owner;
  const ownerStarred = owner ? orgStarred(list?.stars, owner.login) || (!list && owner.starred) : false;

  return (
    <>
      <h3 className="gh-nav-head">Repositories</h3>
      <div className="gh-repo-search" onKeyDown={moveKeys}>
        <label className="gh-repo-search-field">
          <Search size={13} aria-hidden="true" />
          <input
            {...plainText}
            ref={input}
            type="search"
            value={text}
            aria-label="Find a repository"
            aria-controls="gh-repo-found"
            placeholder="Find a repository…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const first = found[0];
                if (first) open(first.repo);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                if (text) setText("");
                else input.current?.blur();
              }
            }}
          />
          {text && (
            <button className="icon-btn" aria-label="Clear the search" data-tip="Clear (Esc)" onClick={() => (setText(""), input.current?.focus())}>
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </label>
      </div>
      {query ? (
        <div className="gh-repo-found" id="gh-repo-found" ref={results} role="group" aria-label={`Repositories matching ${query}`} onKeyDown={moveKeys}>
          {owner && (
            <div className="gh-org-head gh-found-owner">
              <Building2 size={13} aria-hidden="true" />
              <span className="gh-org-name">{owner.login}</span>
              {starButton("org", owner.login, ownerStarred)}
            </div>
          )}
          {found.map((r) => repoRow(r, r.repo, true))}
          {answered?.note && <p className="gh-repo-none">{answered.note}</p>}
          {!found.length && (
            <p className="gh-repo-none" role="status">
              {search.unavailable ?? (answered || query.length < 2 ? `No repository matches “${query}”.` : "Searching GitHub…")}
            </p>
          )}
          {found.length > 0 && !answered && query.length >= 2 && !search.unavailable && <p className="gh-repo-none">Searching GitHub…</p>}
        </div>
      ) : unavailable && !list ? (
        <p className="gh-repo-none">{unavailable}</p>
      ) : !list ? (
        <p className="gh-repo-none">Loading repositories…</p>
      ) : (
        <>
          {favourites.length > 0 && (
            <>
              <h4 className="gh-nav-sub">Favourites</h4>
              {favourites.map((g) => group(g, "fav"))}
            </>
          )}
          {openRepo && (
            <>
              <h4 className="gh-nav-sub">Open</h4>
              {repoRow(openRepo, openRepo.repo)}
            </>
          )}
          {!favourites.length && <p className="gh-repo-none">Find a repository above and star it to keep it here.</p>}
        </>
      )}
    </>
  );
}
