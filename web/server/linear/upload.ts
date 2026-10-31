/**
 * Files to Linear: the page sends a file's bytes here, the server asks Linear
 * for an upload (`fileUpload`, with the API key) and puts the bytes where
 * Linear says. The answer is the file's address on uploads.linear.app, for an
 * attachment or a link in Markdown. The key never reaches the page.
 */
import { LinearError, linearRequest } from "./client";
import { linearUpload } from "./image";
import { recOf, strOf } from "./normalize";
import { LINEAR } from "../links";

export const LINEAR_UPLOAD = { maxBytes: 25 * 1024 * 1024, timeoutMs: 120_000 };

const FILE_UPLOAD = `mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) {
    success uploadFile { uploadUrl assetUrl headers { key value } }
  }
}`;

/** A file's name as Linear keeps it: no folders or control characters, at most 200 characters ("file" when nothing's left). */
export function uploadName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return clean && clean !== "." && clean !== ".." ? clean : "file";
}

/** A content type as sent ("image/png"), or application/octet-stream for anything malformed. */
export function uploadType(raw: string): string {
  const type = raw.trim().toLowerCase();
  return /^[a-z0-9][\w.+-]{0,40}\/[\w.+-]{1,60}$/.test(type) ? type : "application/octet-stream";
}

export type Uploaded = { url: string; name: string; contentType: string; size: number };

/** Uploads `bytes` to Linear as `name`; throws a LinearError when Linear refuses or the upload fails. */
export async function uploadToLinear(bytes: Buffer, rawName: string, rawType: string): Promise<Uploaded> {
  if (!bytes.length) throw new LinearError("invalid", "The file is empty.");
  if (bytes.length > LINEAR_UPLOAD.maxBytes) throw new LinearError("invalid", "Files up to 25 MB can be uploaded.");
  const name = uploadName(rawName);
  const contentType = uploadType(rawType);
  const data = await linearRequest<Record<string, unknown>>(
    "FileUpload",
    FILE_UPLOAD,
    { contentType, filename: name, size: bytes.length },
    { essential: true },
  );
  const payload = recOf(data.fileUpload);
  const file = recOf(payload.uploadFile);
  const asset = linearUpload(strOf(file.assetUrl));
  let target: URL | undefined;
  try {
    target = new URL(strOf(file.uploadUrl));
  } catch {
    target = undefined;
  }
  if (payload.success !== true || !asset || target?.protocol !== "https:")
    throw new LinearError("failed", "Linear didn't offer a place for the file.");
  // Linear's own headers for the upload (it signs them), and ours.
  const headers: Record<string, string> = { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000" };
  for (const h of Array.isArray(file.headers) ? file.headers.map(recOf) : []) {
    const key = strOf(h.key);
    if (/^[\w-]{1,100}$/.test(key) && !/^(host|content-length|connection|transfer-encoding)$/i.test(key))
      headers[key] = strOf(h.value).slice(0, 2000);
  }
  let res: Response;
  try {
    res = await LINEAR.fetch(target.href, {
      method: "PUT",
      headers,
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(LINEAR_UPLOAD.timeoutMs),
    });
  } catch {
    throw new LinearError("failed", "The file couldn't be sent to Linear.");
  }
  if (!res.ok) throw new LinearError("failed", `Linear's storage refused the file (${res.status}).`);
  return { url: asset.href, name, contentType, size: bytes.length };
}
