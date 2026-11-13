/**
 * An image on a remote host that its agent's transcript names by absolute path (a screenshot it took, a file it
 * read): read through that host's daemon, as the Files page reads a workspace's files (`readFile`, with the file's
 * folder as the root and its name as the path, so the daemon keeps the read inside that folder), never this Mac's
 * same-named file. Only paths the host's own transcript gave, or its prompt attachments, are admitted
 * (`remoteImageAdmitted`); the bytes must be a PNG, JPEG, GIF or WebP by their header, within the size limit.
 */
import { sniffImage } from "../src/imageLoad";
import { remoteImageAdmitted } from "./attachment";
import { sdk, timed, type Remote } from "./api/hosts";

const MIME = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as const;

export async function readRemoteImage(host: Remote, path: string, maxBytes: number): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!remoteImageAdmitted(host.serverId, path)) return null;
  const cut = path.lastIndexOf("/");
  const dir = path.slice(0, cut) || "/";
  const name = path.slice(cut + 1);
  if (!name) return null;
  const client = await sdk(host);
  let read: { bytes: Uint8Array };
  try {
    read = await timed(client.readFile(dir, name, undefined, maxBytes), undefined, client);
  } catch {
    return null;
  }
  if (read.bytes.byteLength > maxBytes) return null;
  const header = sniffImage(read.bytes);
  return header ? { bytes: read.bytes, mime: MIME[header.type] } : null;
}
