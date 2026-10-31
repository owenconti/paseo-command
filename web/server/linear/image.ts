/** Images and other files uploaded to Linear, fetched with the API key (they load nowhere else). */
import { linearApiKey, linearUnavailable } from "./client";
import { LINEAR } from "../links";

/** Where Linear keeps uploaded files; they load only with the API key. */
const UPLOADS = "uploads.linear.app";
export const LINEAR_IMAGE = { maxBytes: 20 * 1024 * 1024, maxFileBytes: 100 * 1024 * 1024 };

/** Whether `raw` is a Linear upload (https, on its uploads host, no userinfo). */
export function linearUpload(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === UPLOADS && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

type Fetched = { status: number; type?: string; bytes?: Buffer; name?: string; error?: string };

/** A file uploaded to Linear, fetched with the API key, at most `maxBytes`; `accept` says which content types may come. */
async function fetchUpload(raw: string, maxBytes: number, accept: (type: string) => boolean): Promise<Fetched> {
  const url = linearUpload(raw);
  if (!url) return { status: 400, error: "Only Linear uploads load here" };
  const token = linearApiKey();
  if (!token) return { status: 404, error: linearUnavailable() };
  try {
    const res = await LINEAR.fetch(url.href, {
      headers: { Authorization: token },
      redirect: "follow",
      signal: AbortSignal.timeout(LINEAR.timeoutMs * 2),
    });
    const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!res.ok) return { status: 502, error: `Linear answered ${res.status}.` };
    if (!accept(type)) return { status: 415, error: "Not an image" };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return { status: 413, error: "File too large" };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) return { status: 413, error: "File too large" };
    const name = decodeURIComponent(url.pathname.split("/").pop() ?? "") || "file";
    return { status: 200, type, bytes, name };
  } catch {
    return { status: 504, error: "Linear didn't answer" };
  }
}

/** An image uploaded to Linear, fetched with the API key: only images, at most `LINEAR_IMAGE.maxBytes`. */
export function linearImage(raw: string): Promise<Fetched> {
  return fetchUpload(raw, LINEAR_IMAGE.maxBytes, (type) => /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(type));
}

/** Any file uploaded to Linear, fetched with the API key, at most `LINEAR_IMAGE.maxFileBytes`; the page downloads it. */
export function linearFile(raw: string): Promise<Fetched> {
  return fetchUpload(raw, LINEAR_IMAGE.maxFileBytes, () => true);
}
