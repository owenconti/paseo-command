import { useEffect, useRef, useState } from "react";
import { BookMarked, Lock, Plus, Star } from "lucide-react";
import { githubWrite, invalidate, patch, readPath } from "./api";
import { OWNER, REPO, type GithubStars, type RepoList, type RepoRow } from "./types";

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
    invalidate(REPOS_PATH);
  }
}

/** What's typed to star: `owner/name` (or its github.com address) a repository, a login an organization; else null. */
export function starTarget(text: string): { kind: "repo" | "org"; name: string } | null {
  const t = text
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const parts = t.split("/");
  if (parts.length === 2 && REPO.test(t) && !t.includes("..")) return { kind: "repo", name: t };
  if (parts.length === 1 && OWNER.test(t)) return { kind: "org", name: t };
  return null;
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

/** The sidebar's repositories as ⌘K lists them: favourites first. */
export function repoOrder(list: RepoList | undefined): { repo: string; favourite: boolean }[] {
  return (list?.repos ?? []).map((r) => ({ repo: r.repo, favourite: r.starred || r.ownerStarred }));
}

export type RepoNavControl = { add(): void };

/**
 * The GitHub sidebar's Repositories: Favourites (starred repositories, and
 * those of starred organizations, with the organizations' heads even when
 * none has open pull requests), then the other repositories with open
 * pull requests, grouped by owner, each counting its open ones. A star on a
 * repository's row or an owner's head stars it; + stars one by name.
 */
export function RepoNav({
  list,
  unavailable,
  current,
  onOpen,
  onNotice,
  control,
}: {
  list: RepoList | undefined;
  unavailable?: string;
  /** The repository whose pull requests show. */
  current?: string;
  onOpen: (repo: string) => void;
  onNotice: (message: string) => void;
  control?: React.MutableRefObject<RepoNavControl | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);
  if (control) control.current = { add: () => (adding ? input.current?.focus() : setAdding(true)) };

  const star = (kind: "repo" | "org", name: string, starred: boolean) =>
    setStar(kind, name, starred).catch((e: unknown) => onNotice(`Couldn’t ${starred ? "star" : "unstar"} ${name}: ${e instanceof Error ? e.message : String(e)}`));
  const add = () => {
    const target = starTarget(text);
    if (!target) return setError("Name a repository as owner/name, or an organization by its login.");
    setError(undefined);
    setText("");
    setAdding(false);
    void star(target.kind, target.name, true);
  };

  const rows = list?.repos ?? [];
  const favourites = groups(
    rows.filter((r) => r.starred || r.ownerStarred),
    list?.stars.orgs,
  );
  const others = groups(rows.filter((r) => !r.starred && !r.ownerStarred));

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
  const group = (g: Group, section: string) => (
    <div key={`${section}:${g.owner}`} className="gh-repo-group" role="group" aria-label={g.owner}>
      <div className="gh-org-head">
        <span className="gh-org-name">{g.owner}</span>
        {starButton("org", g.owner, g.ownerStarred)}
      </div>
      {g.repos.map((r) => {
        const name = r.repo.slice(r.owner.length + 1) || r.repo;
        const selected = !!current && same(current, r.repo);
        return (
          <div key={r.repo} className="gh-repo-row">
            <button
              className={`gh-nav-item${selected ? " selected" : ""}`}
              aria-current={selected ? "page" : undefined}
              data-tip={r.missing ? `GitHub has no ${r.repo} the token can see` : `${r.repo}'s pull requests`}
              onClick={() => onOpen(r.repo)}
            >
              {r.private ? <Lock size={14} aria-hidden="true" /> : <BookMarked size={14} aria-hidden="true" />}
              <span className="gh-nav-label">{name}</span>
              {r.open > 0 && <span className="gh-count">{r.open}</span>}
            </button>
            {starButton("repo", r.repo, r.starred)}
          </div>
        );
      })}
      {!g.repos.length && <p className="gh-repo-none">No open pull requests</p>}
    </div>
  );

  return (
    <>
      <h3 className="gh-nav-head">
        <span>Repositories</span>
        <button
          className="icon-btn"
          aria-label="Star a repository or organization"
          aria-expanded={adding}
          data-tip="Star a repository or organization"
          onClick={() => (adding ? (setAdding(false), setError(undefined)) : setAdding(true))}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </h3>
      {adding && (
        <form
          className="gh-star-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            ref={input}
            value={text}
            aria-label="Repository (owner/name) or organization to star"
            placeholder="owner/name or organization"
            spellCheck={false}
            autoCapitalize="off"
            onChange={(e) => {
              setText(e.target.value);
              setError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setAdding(false);
                setError(undefined);
              }
            }}
          />
          {error && <p className="gh-error">{error}</p>}
        </form>
      )}
      {unavailable && !list ? (
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
          {favourites.length > 0 && others.length > 0 && <h4 className="gh-nav-sub">Others</h4>}
          {others.map((g) => group(g, "other"))}
          {!favourites.length && !others.length && <p className="gh-repo-none">No repositories with open pull requests. Star one with +.</p>}
        </>
      )}
    </>
  );
}
