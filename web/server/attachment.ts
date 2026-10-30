import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { ATTACHMENT_IMAGE } from "./daemon";
import { extractImages, resolveImage } from "../src/imageSource";
import { sniffImage } from "../src/imageLoad";
import { fromTimeline, type TimelineItem } from "../src/transcript";

// Generated previews live outside the daemon's prompt-attachment directory.
// Admit only paths actually supplied by a local daemon transcript, never a
// browser's arbitrary path or a remote daemon's same-named local file.
const referenced = new Set<string>();
const RASTER_PATH = /\.(png|jpe?g|gif|webp)$/i;
export function rememberTimelineImages(items: TimelineItem[], local: boolean) {
  if (!local) return;
  for (const item of fromTimeline(items)) {
    if (item.kind !== "assistant" && item.kind !== "user") continue;
    for (const image of extractImages(item.text).images) {
      const source = resolveImage(image.src);
      if (source.kind !== "local" || !RASTER_PATH.test(source.path)) continue;
      referenced.delete(source.path);
      referenced.add(source.path);
      if (referenced.size > 10000)
        referenced.delete(referenced.values().next().value!);
    }
  }
}

/**
 * Reads a prompt attachment or a raster image referenced in a local timeline.
 *
 * Path checks alone race with a concurrent swap (a symlink or directory put
 * in place between validation and read), so validation is tied to one open
 * descriptor:
 * - the path must be an attachment or an observed image reference, and every
 *   directory on it must be a real directory (never a symlink);
 * - the file is opened once with O_NOFOLLOW (and O_NONBLOCK, so a FIFO can't
 *   stall the server), then fstat'ed and read through that same descriptor;
 * - after opening, the path must still name exactly that inode, with every
 *   directory unchanged (same device, inode and change time, which a rename
 *   away and back alters), checked before and after the directory walk; on
 *   Linux the kernel's own path for the descriptor must be the canonical
 *   path too;
 * - hard links are refused (a link count above one), as is anything that
 *   isn't a regular file or exceeds the size limit, including growth while
 *   being read.
 */
export async function readAttachmentImage(
  path: string,
  maxBytes: number,
): Promise<Buffer | null> {
  if (
    (!ATTACHMENT_IMAGE.test(path) && !referenced.has(path)) ||
    path.split("/").includes("..") ||
    path.includes("\0")
  )
    return null;
  // A directory that changed mid-read is usually the daemon saving another
  // attachment beside this one; a few retries tell that from a swap attack.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await readOnce(path, maxBytes);
    if (result !== CHANGED) return result;
  }
  return null;
}

const CHANGED = Symbol("changed");

async function readOnce(
  path: string,
  maxBytes: number,
): Promise<Buffer | null | typeof CHANGED> {
  const real = await realpath(path).catch(() => "");
  if (!real || !RASTER_PATH.test(real)) return null;
  if (!referenced.has(path) && !ATTACHMENT_IMAGE.test(real)) return null;
  const dirs = ancestors(real);
  const before = await directories(dirs);
  if (!before) return null;
  const handle = await open(
    real,
    constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0),
  ).catch(() => null);
  if (!handle) return null;
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.size > BigInt(maxBytes))
      return null;
    const same = async () => {
      const now = await lstat(real, { bigint: true }).catch(() => null);
      return !!now?.isFile() && now.dev === info.dev && now.ino === info.ino;
    };
    if (!(await same())) return CHANGED;
    // Renaming a directory away and back keeps its inode but not its ctime:
    // identical identities before and after mean nothing on the path moved
    // while the file was opened, so the descriptor is the file at `real`.
    const after = await directories(dirs);
    if (!after || after.some((id, i) => id !== before[i])) return CHANGED;
    if (!(await same())) return CHANGED;
    if (process.platform === "linux") {
      const kernel = await readlink(`/proc/self/fd/${handle.fd}`).catch(
        () => "",
      );
      if (kernel !== real) return null;
    }
    const bytes = await handle.readFile();
    return bytes.length <= maxBytes && sniffImage(bytes) ? bytes : null;
  } finally {
    await handle.close().catch(() => {});
  }
}

/** "/a/b/c.png" → ["/", "/a", "/a/b"]. */
function ancestors(path: string) {
  const parts = path.split("/").slice(1, -1);
  return ["/", ...parts.map((_, i) => `/${parts.slice(0, i + 1).join("/")}`)];
}

/**
 * Device, inode and change time (ns) of each directory, or null if any is
 * missing or a symlink.
 */
async function directories(dirs: string[]) {
  const ids: string[] = [];
  for (const dir of dirs) {
    const s = await lstat(dir, { bigint: true }).catch(() => null);
    if (!s?.isDirectory()) return null;
    ids.push(`${s.dev}:${s.ino}:${s.ctimeNs}`);
  }
  return ids;
}
