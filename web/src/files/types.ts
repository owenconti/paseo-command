/**
 * The Files page's reads (`web/server/api/files.ts`), for the page and the
 * server alike. Paths are the workspace's own, from its root, `/`-separated
 * (`""` is the root).
 */

/** One entry of a directory. `ignored`: `.gitignore`d (or `.git` itself). */
export type FileEntry = { name: string; path: string; kind: "file" | "directory"; size: number; ignored?: true };

/** `GET /api/files/tree`: a directory's entries, directories first, then by name. */
export type FileTree = { dir: string; entries: FileEntry[] };

/** Why a file isn't shown: not text, an image, or past the size limit. */
export type FileRefusal = "binary" | "image" | "large";

/** `GET /api/files/read`: a text file's contents, or why it isn't shown. */
export type FileRead =
  | { path: string; size: number; text: string }
  | { path: string; size: number; refused: FileRefusal; mime?: string };

/** `GET /api/files/all`: every path not ignored (for quick-open and the filter), up to a cap. */
export type FileList = { files: string[]; capped: boolean };

/** How a changed file differs from the base (the Changes view's). */
export type FileChange = "added" | "deleted" | "modified" | "renamed";

/** `GET /api/files/changed`: the workspace's changed files (all changes, committed or not). */
export type FileChanges = { files: { path: string; change: FileChange }[] };

/** The server's limits, which the page states. */
export const FILE_LIMITS = {
  /** Larger files aren't shown. */
  maxBytes: 1024 * 1024,
  /** Quick-open lists at most this many files. */
  maxListed: 25_000,
};
