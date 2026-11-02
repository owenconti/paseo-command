/** Workspace members' avatars, for Activity's Linear rows: Linear's own uploads load only with the API key. */
import { linearApiKey } from "./client";
import { LINEAR } from "../links";

/** Where Linear keeps uploaded files; they load only with the API key. */
const UPLOADS = "uploads.linear.app";

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

type Fetched = { status: number; type?: string; bytes?: Buffer; error?: string };

/** Avatars kept for an hour, by address (a new avatar has a new address). */
const avatars = new Map<string, { at: number; type: string; bytes: Buffer }>();
const AVATAR = { maxBytes: 2 * 1024 * 1024, keepMs: 60 * 60_000 };
const isImage = (type: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(type);

/** Forgets the avatars kept (tests). */
export function resetAvatars(): void {
  avatars.clear();
}

/**
 * A workspace member's avatar, as an image: only the address Linear gives
 * for them (never one the page names). Linear's own uploads load with the
 * key; any other host (Google, Gravatar) without it. Kept an hour.
 */
export async function linearAvatar(avatarUrl: string | undefined): Promise<Fetched> {
  if (!avatarUrl) return { status: 404, error: "No avatar" };
  const kept = avatars.get(avatarUrl);
  if (kept && Date.now() - kept.at < AVATAR.keepMs) return { status: 200, type: kept.type, bytes: kept.bytes };
  const upload = linearUpload(avatarUrl);
  const token = upload ? linearApiKey() : undefined;
  if (upload && !token) return { status: 404, error: "No avatar" };
  let got: Fetched;
  try {
    const res = await LINEAR.fetch(avatarUrl, {
      ...(token ? { headers: { Authorization: token } } : {}),
      redirect: "follow",
      signal: AbortSignal.timeout(LINEAR.timeoutMs),
    });
    const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    const bytes = res.ok && isImage(type) ? Buffer.from(await res.arrayBuffer()) : undefined;
    got =
      bytes && bytes.length <= AVATAR.maxBytes
        ? { status: 200, type, bytes }
        : { status: res.ok ? 415 : 502, error: "No avatar there" };
  } catch {
    got = { status: 504, error: "The avatar didn't load" };
  }
  if (got.bytes && got.type) avatars.set(avatarUrl, { at: Date.now(), type: got.type, bytes: got.bytes });
  return got;
}
