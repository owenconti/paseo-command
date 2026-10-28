import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Folder,
  FolderPlus,
  Github,
  Home,
  Loader2,
} from "lucide-react";
import { api, errorMessage } from "./api";
import { hostOptions } from "./Dispatch";
import { rovingKeyDown } from "./focus";
import { soundEvent } from "./soundCues";
import type { Host, Project } from "./types";
import { plainText } from "./ui";

type Mode = "existing" | "create" | "clone";
const MODES: [Mode, string, string][] = [
  ["existing", "Existing folder", "Register a folder already on the host"],
  ["create", "New folder", "Make a new folder in the chosen folder"],
  ["clone", "Clone from GitHub", "Clone a GitHub repository into the chosen folder"],
];
/** The local daemon's key in the Host field (as Dispatch's). */
const LOCAL = "local";

type Listing = {
  path: string;
  parent: string | null;
  home: string;
  folders: { name: string; path: string }[];
};

/** `owner/repo` or a GitHub URL's repository name, for the clone's folder. */
export function repoFolder(repo: string) {
  const name = repo
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .pop();
  return name && name.length > 0 ? name : "";
}
const join = (parent: string, name: string) =>
  `${parent === "/" ? "" : parent}/${name}`;

/**
 * Add a project to a host's Paseo, as the Paseo app does: register an
 * existing folder, make a new one, or clone a GitHub repository. The folder
 * is chosen by browsing the host's folders; the one open is the one used.
 */
export function AddProject({
  hosts,
  projects,
  initialHost,
  online,
  onClose,
  onAdded,
  onNotice,
}: {
  hosts: Host[];
  projects: Project[];
  /** The host the lists are narrowed to ("" local), if any. */
  initialHost?: string | null;
  online: boolean;
  onClose: () => void;
  onAdded: (projectId: string, host: string | undefined) => void;
  onNotice: (message: string) => void;
}) {
  const choices = hostOptions(hosts);
  const [hostKey, setHostKey] = useState(() => {
    const wanted = initialHost ? initialHost : LOCAL;
    return choices.some((h) => h.key === wanted && !h.unavailable)
      ? wanted
      : LOCAL;
  });
  const host = hostKey === LOCAL ? undefined : hostKey;
  const chosenHost = choices.find((h) => h.key === hostKey);
  const [mode, setMode] = useState<Mode>("existing");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [path, setPath] = useState<string | undefined>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The host's home folder first; a new host starts over.
  useEffect(() => {
    setPath(undefined);
  }, [hostKey]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (path) query.set("path", path);
    if (host) query.set("host", host);
    setLoading(true);
    setBrowseError("");
    api<Listing>(`folders?${query}`, undefined, controller.signal)
      .then((r) => {
        setListing(r);
        setLoading(false);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setBrowseError(errorMessage(e) || "Couldn't list this folder.");
      });
    return () => controller.abort();
  }, [path, host]);

  const here = listing?.path ?? "";
  const onHere = (p: Project) => (p.host || LOCAL) === hostKey;
  const registered = new Set(projects.filter(onHere).map((p) => p.path));
  const folderName = name.trim();
  const repoName = repoFolder(repo);
  const destination =
    mode === "existing"
      ? here
      : mode === "create"
        ? folderName && join(here, folderName)
        : repoName && join(here, repoName);
  const blocked = !online
    ? "Paseo is offline."
    : chosenHost?.unavailable
      ? `${chosenHost.name} is ${chosenHost.reason}. Choose another host.`
      : !here || browseError
        ? "Choose a folder first."
        : mode === "existing" && registered.has(here)
          ? "This folder is already a project."
          : mode === "create" && !folderName
            ? "Name the new folder."
            : mode === "create" && /[/\\]/.test(folderName)
              ? "A folder name can't contain slashes."
              : mode === "clone" && !repoName
                ? "Paste a GitHub owner/repo or URL."
                : "";

  const submit = async () => {
    if (blocked || busy) return;
    setBusy(true);
    setError("");
    const body =
      mode === "existing"
        ? { path: here }
        : mode === "create"
          ? { parent: here, name: folderName }
          : { parent: here, repo: repo.trim() };
    try {
      const r = await api<{ projectId: string }>(
        `projects/${mode === "existing" ? "add" : mode === "create" ? "create-folder" : "clone"}`,
        host ? { ...body, host } : body,
      );
      onNotice("Project added");
      onAdded(r.projectId, host);
    } catch (e) {
      soundEvent("actionFailed");
      setError(errorMessage(e) || "Couldn't add the project.");
      setBusy(false);
    }
  };

  const crumbs = here
    ? here
        .split("/")
        .filter(Boolean)
        .map((part, i, all) => ({
          name: part,
          path: `/${all.slice(0, i + 1).join("/")}`,
        }))
    : [];
  const action =
    mode === "existing"
      ? busy
        ? "Adding…"
        : "Add project"
      : mode === "create"
        ? busy
          ? "Creating…"
          : "Create & add"
        : busy
          ? "Cloning…"
          : "Clone & add";

  return (
    <div
      className="session new-agent add-project"
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget) onClose();
      }}
    >
      <header className="session-header">
        <div className="session-nav">
          <button
            className="ghost-btn"
            onClick={onClose}
            aria-description="Back to fleet without adding a project (Esc)"
          >
            <ArrowLeft size={15} />
            Fleet
          </button>
        </div>
        <div className="session-title">
          <div>
            <h2>Add project</h2>
          </div>
        </div>
        <div className="new-agent-form">
          <label>
            <span>Host</span>
            <select
              name="host"
              aria-description="The machine whose Paseo daemon gets the project"
              value={hostKey}
              disabled={busy}
              onChange={(e) => setHostKey(e.target.value)}
            >
              {choices.map((h) => (
                <option key={h.key} value={h.key} disabled={h.unavailable}>
                  {h.text}
                </option>
              ))}
            </select>
          </label>
          <div
            className="filter-chips add-project-modes"
            role="radiogroup"
            aria-label="How to add it"
            onKeyDown={(e) => rovingKeyDown(e, (i) => setMode(MODES[i][0]))}
          >
            {MODES.map(([m, label, hint]) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                tabIndex={mode === m ? 0 : -1}
                aria-description={hint}
                disabled={busy}
                onClick={() => setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "create" && (
            <label className="add-project-wide">
              <span>Folder name</span>
              <input
                {...plainText}
                name="folder-name"
                aria-description="The new folder, made inside the folder open below"
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder="my-project"
                maxLength={255}
                autoFocus
              />
            </label>
          )}
          {mode === "clone" && (
            <label className="add-project-wide">
              <span>GitHub repository</span>
              <input
                {...plainText}
                name="repo"
                aria-description="owner/repo or a GitHub URL; it is cloned into a new folder inside the folder open below"
                value={repo}
                disabled={busy}
                onChange={(e) => setRepo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
                placeholder="owner/repo or https://github.com/owner/repo"
                maxLength={300}
                autoFocus
              />
            </label>
          )}
        </div>
      </header>
      <div className="add-project-browser" aria-busy={loading}>
        <nav className="folder-crumbs" aria-label="Folder path">
          <button
            className="icon-btn"
            data-tip="Home folder"
            aria-label="Home folder"
            disabled={busy || !listing}
            onClick={() => setPath(listing?.home)}
          >
            <Home size={14} />
          </button>
          <button
            className="icon-btn"
            data-tip="Up one folder"
            aria-label="Up one folder"
            disabled={busy || !listing?.parent}
            onClick={() => listing?.parent && setPath(listing.parent)}
          >
            <ArrowUp size={14} />
          </button>
          <ol>
            <li>
              <button disabled={busy} onClick={() => setPath("/")}>
                /
              </button>
            </li>
            {crumbs.map((c, i) => (
              <li key={c.path}>
                {i > 0 && <ChevronRight size={11} aria-hidden="true" />}
                <button
                  disabled={busy}
                  aria-current={c.path === here ? "location" : undefined}
                  onClick={() => setPath(c.path)}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="folder-list" role="list" aria-label="Folders">
          {browseError ? (
            <p className="archive-error" role="alert">
              {browseError}
            </p>
          ) : listing && !listing.folders.length && !loading ? (
            <p className="folder-empty">No folders in here.</p>
          ) : (
            listing?.folders.map((f) => (
              <div role="listitem" key={f.path}>
                <button
                  className="registry-row folder-row"
                  disabled={busy}
                  aria-description={`Open ${f.path}`}
                  onClick={() => setPath(f.path)}
                >
                  <Folder size={15} aria-hidden="true" />
                  <span className="row-name">{f.name}</span>
                  {registered.has(f.path) && (
                    <span className="badge slate">project</span>
                  )}
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      <footer className="add-project-footer">
        {error && (
          <p className="archive-error" role="alert">
            {error}
          </p>
        )}
        <p className="form-hint" aria-live="polite">
          {mode === "clone" ? (
            <Github size={13} />
          ) : mode === "create" ? (
            <FolderPlus size={13} />
          ) : (
            <Folder size={13} />
          )}
          <span>
            {blocked && !(mode === "existing" && registered.has(here)) ? (
              blocked
            ) : (
              <>
                {mode === "existing"
                  ? "Adds"
                  : mode === "create"
                    ? "Creates and adds"
                    : "Clones into"}{" "}
                <code>{destination}</code>
                {blocked && ` · ${blocked}`}
              </>
            )}
          </span>
        </p>
        <button
          className="primary"
          disabled={!!blocked || busy}
          onClick={() => void submit()}
        >
          {busy && <Loader2 size={14} className="spinning" />}
          {action}
        </button>
      </footer>
    </div>
  );
}
