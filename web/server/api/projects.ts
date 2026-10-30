/**
 * Adding projects, as the Paseo app's Add project flow does:
 *
 * - `GET /api/folders?[path=…][&host=…]`: the folders in a folder on the host
 *   (its home folder when no path is given), to browse to a project's place.
 *   Folder names only: files are never listed.
 * - `POST /api/projects/add` `{ path, host? }`: register an existing folder.
 * - `POST /api/projects/create-folder` `{ parent, name, host? }`: make a new
 *   folder in `parent` and register it.
 * - `POST /api/projects/clone` `{ repo, parent, host? }`: clone a GitHub repo
 *   (owner/repo or URL) into a new folder in `parent` and register it.
 *
 * Each answers with the registered project, `{ projectId, name, path }`.
 *
 * And managing them, as the Paseo app's project menu does:
 *
 * - `POST /api/projects/:id/rename` `{ name, host? }`: set its title (the
 *   folder is unchanged). Answers `{ projectId, name }`.
 * - `POST /api/projects/:id/remove` `{ confirm: true, host? }`: archive its
 *   active workspaces (their agents and terminals) and unregister it. Its
 *   folder stays on disk. Answers `{ projectId, removedWorkspaceIds }`.
 */
import { posix } from "node:path";
import { TUNING, remember, scopeOf } from "../fleet";
import { redactText } from "../redact";
import type { Mark } from "./commands";
import { affectedKeys } from "./commands";
import { resolveHost, sdk, timed, type Remote } from "./hosts";
import { id, newName, type Body } from "./validate";

/** Clones can take a while; the Paseo app allows five minutes. */
const CLONE_MS = 300000;
/** Removing archives each of the project's workspaces in turn. */
const REMOVE_MS = 120000;

/** An absolute folder path on the host, normalized. */
export function folderPath(value: unknown, what = "folder") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 4096 ||
    value.includes("\0")
  )
    throw new Error(`Choose a ${what}`);
  const path = posix.normalize(value);
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

/** A new folder's name: one path segment. */
export function folderName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error("Name the new folder");
  if (
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    /[/\\\0]/.test(name)
  )
    throw new Error("A folder name can't contain slashes");
  return name;
}

/** A GitHub repository: `owner/repo`, or its URL. */
export function repoText(value: unknown) {
  const repo = typeof value === "string" ? value.trim() : "";
  if (repo.length < 3 || repo.length > 300 || /\s|\0/.test(repo))
    throw new Error("Paste a GitHub owner/repo or URL");
  return repo;
}

/** The host's home folder: the parent of its home's own suggestions. */
function homeOf(host?: Remote) {
  return remember(`${scopeOf(host?.target)}|home`, 600000, async () => {
    const client = await sdk(host);
    const r = await timed(
      client.getDirectorySuggestions({
        query: "~/",
        includeDirectories: true,
        includeFiles: false,
        limit: 1,
      }),
      undefined,
      client,
    );
    const first = r?.entries?.[0]?.path ?? r?.directories?.[0];
    return typeof first === "string" && first.startsWith("/")
      ? posix.dirname(first)
      : "/";
  });
}

/** `GET /api/folders`: one folder's subfolders, hidden ones last. */
export async function foldersGet(url: URL) {
  for (const key of url.searchParams.keys())
    if (key !== "path" && key !== "host")
      throw new Error("Unexpected parameters");
  const host = await resolveHost(url.searchParams.get("host"));
  const home = await homeOf(host);
  const raw = url.searchParams.get("path");
  const path = raw ? folderPath(raw) : home;
  const client = await sdk(host);
  const r = await timed(client.listDirectory("/", path), undefined, client);
  const folders = (Array.isArray(r?.entries) ? r.entries : [])
    .filter((e) => e?.kind === "directory" && typeof e.name === "string")
    .map((e) => ({ name: e.name, path: posix.join(path, e.name) }))
    .sort(
      (a, b) =>
        Number(a.name.startsWith(".")) - Number(b.name.startsWith(".")) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  return {
    path,
    parent: path === "/" ? null : posix.dirname(path),
    home,
    folders,
  };
}

type Registered = {
  projectId: string;
  projectDisplayName?: string;
  projectRootPath?: string;
} | null;

function registered(
  r: { project?: Registered; error?: string | null } | undefined,
  fallback: string,
) {
  if (!r?.project?.projectId)
    throw new Error(redactText(String(r?.error || fallback)));
  return {
    projectId: r.project.projectId,
    name: r.project.projectDisplayName ?? "",
    path: r.project.projectRootPath ?? "",
  };
}

/** `POST /api/projects/add`: register an existing folder. */
export async function addProject(body: Body, mark: Mark) {
  const host = await resolveHost(body.host, "write");
  const path = folderPath(body.path);
  mark({ host, keys: ["projects"] });
  const client = await sdk(host);
  const r = await timed(client.addProject(path), TUNING.writeMs);
  return registered(r, "Couldn't add the project.");
}

/** `POST /api/projects/create-folder`: a new folder, registered. */
export async function createProjectFolder(body: Body, mark: Mark) {
  const host = await resolveHost(body.host, "write");
  const parentPath = folderPath(body.parent, "parent folder");
  const name = folderName(body.name);
  mark({ host, keys: ["projects"] });
  const client = await sdk(host);
  const r = await timed(
    client.createProjectDirectory({ parentPath, name }),
    TUNING.writeMs,
  );
  return registered(r, "Couldn't create the folder.");
}

/** `POST /api/projects/clone`: a GitHub repo cloned into `parent`, registered. */
export async function cloneProject(body: Body, mark: Mark) {
  const host = await resolveHost(body.host, "write");
  const repo = repoText(body.repo);
  const targetDirectory = folderPath(body.parent, "destination folder");
  mark({ host, keys: ["projects"] });
  const client = await sdk(host);
  const r = await timed(
    client.cloneGithubProject({ repo, targetDirectory }),
    CLONE_MS,
  );
  return registered(r, "Couldn't clone the repository.");
}

/** A project the host has now (not a cached list), by its ID. */
async function knownProject(rawId: string, host?: Remote) {
  const projectId = id(rawId);
  const client = await sdk(host);
  const r = await timed(client.listProjects(), undefined, client);
  const project = (Array.isArray(r?.projects) ? r.projects : []).find(
    (p) => p?.projectId === projectId,
  );
  if (!project)
    throw new Error("This project is no longer registered. Refresh and try again.");
  return { client, projectId };
}

/** `POST /api/projects/:id/rename`: set its title. */
export async function renameProject(rawId: string, body: Body, mark: Mark) {
  const host = await resolveHost(body.host, "write");
  const name = newName(body.name);
  const { client, projectId } = await knownProject(rawId, host);
  // Its workspaces' rows carry its name too.
  mark({ host, keys: ["projects", "workspaces"] });
  const r = await timed(client.renameProject(projectId, name), TUNING.writeMs);
  return { projectId, name: r?.customName || name };
}

/** `POST /api/projects/:id/remove`: archive its workspaces, unregister it. */
export async function removeProject(rawId: string, body: Body, mark: Mark) {
  if (body.confirm !== true)
    throw new Error("Removing a project requires confirmation");
  const host = await resolveHost(body.host, "write");
  const { client, projectId } = await knownProject(rawId, host);
  mark({ host, keys: ["projects", ...affectedKeys("workspace-archive")] });
  const r = await timed(client.removeProject(projectId), REMOVE_MS);
  return { projectId, removedWorkspaceIds: r?.removedWorkspaceIds ?? [] };
}
