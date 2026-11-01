/**
 * Slack's images and files for the page, fetched by the server: private
 * files (`files.slack.com`) with the user token, people's avatars and custom
 * emoji (Slack's public CDNs) without it. Only addresses Slack gave are
 * fetched (a file's on files.slack.com; a person's avatar and an emoji by
 * name, from the workspace), never any other the page names.
 */
import { SLACK, slackUnavailable, slackUserToken } from "./client";
import { keptWorkspace, readWorkspace, slackStranger } from "./reads";

export const SLACK_FILES = {
  maxImageBytes: 20 * 1024 * 1024,
  maxFileBytes: 100 * 1024 * 1024,
  maxAvatarBytes: 2 * 1024 * 1024,
  maxEmojiBytes: 2 * 1024 * 1024,
  avatarKeepMs: 60 * 60_000,
  emojiKeepMs: 24 * 60 * 60_000,
};

export type Fetched = { status: number; type?: string; bytes?: Buffer; name?: string; error?: string };

const IMAGE = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;

/** `raw` if it's https on one of `hosts` (exact, or `*.` for any subdomain), with no credentials. */
function onHost(raw: string, hosts: string[]): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const ok = hosts.some((h) => (h.startsWith("*.") ? url.hostname.endsWith(h.slice(1)) : url.hostname === h));
    return ok ? url : null;
  } catch {
    return null;
  }
}

/** Whether `raw` is a private Slack file (https on files.slack.com). */
export const slackFileAddress = (raw: string) => onHost(raw, ["files.slack.com"]);

const AVATAR_HOSTS = ["avatars.slack-edge.com", "secure.gravatar.com", "*.slack-edge.com"];
const EMOJI_HOSTS = ["emoji.slack-edge.com"];

/** Fetches `url` (with the token when `token` is given), at most `maxBytes`, of a type `accept` takes; redirects must stay on `hosts`. */
async function fetchFrom(
  url: URL,
  maxBytes: number,
  accept: (type: string) => boolean,
  hosts: string[],
  token?: string,
): Promise<Fetched> {
  try {
    const res = await SLACK.fetch(url.href, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: "follow",
      signal: AbortSignal.timeout(SLACK.timeoutMs * 3),
    });
    if (res.url && !onHost(res.url, hosts)) return { status: 502, error: "Slack sent the file somewhere else" };
    if (!res.ok) return { status: 502, error: `Slack answered ${res.status}.` };
    const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!accept(type)) return { status: 415, error: "Not an image" };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return { status: 413, error: "File too large" };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) return { status: 413, error: "File too large" };
    let name = "file";
    try {
      name = decodeURIComponent(url.pathname.split("/").pop() ?? "") || "file";
    } catch {
      // A malformed name downloads as "file".
    }
    return { status: 200, type, bytes, name };
  } catch {
    return { status: 504, error: "Slack didn't answer" };
  }
}

/** A private Slack file's bytes, with the token. */
async function privateFile(raw: string, maxBytes: number, accept: (type: string) => boolean): Promise<Fetched> {
  const url = slackFileAddress(raw);
  if (!url) return { status: 400, error: "Only Slack files load here" };
  const token = slackUserToken();
  if (!token) return { status: 404, error: slackUnavailable() };
  // Slack serves its files from files.slack.com, sometimes through its own CDNs.
  return fetchFrom(url, maxBytes, accept, ["files.slack.com", "*.slack-edge.com", "*.slack-files.com"], token);
}

/** An image shared in Slack: only images, at most 20 MB. */
export const slackImage = (raw: string) => privateFile(raw, SLACK_FILES.maxImageBytes, (t) => IMAGE.test(t));

/** Any file shared in Slack, at most 100 MB; the page downloads it. */
export const slackFile = (raw: string) => privateFile(raw, SLACK_FILES.maxFileBytes, () => true);

const avatars = new Map<string, { at: number; type: string; bytes: Buffer }>();
const emojis = new Map<string, { at: number; type: string; bytes: Buffer }>();

/** Forgets the avatars and emoji kept (tests). */
export function resetSlackFiles(): void {
  avatars.clear();
  emojis.clear();
}

async function kept(
  cache: typeof avatars,
  address: string,
  keepMs: number,
  load: () => Promise<Fetched>,
): Promise<Fetched> {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < keepMs) return { status: 200, type: hit.type, bytes: hit.bytes };
  const got = await load();
  if (got.bytes && got.type) cache.set(address, { at: Date.now(), type: got.type, bytes: got.bytes });
  return got;
}

/** The workspace kept, else read now; null when Slack can't say. */
async function workspace() {
  if (!slackUserToken()) return null;
  return keptWorkspace() ?? (await readWorkspace().catch(() => null));
}

/** A person's avatar by their id: only the address Slack gives for them, fetched without the token, kept an hour. */
export async function slackAvatar(userId: string): Promise<Fetched> {
  if (!/^[UWB][A-Z0-9]{2,20}$/.test(userId)) return { status: 400, error: "Unknown person" };
  const ws = await workspace();
  if (!ws) return { status: 404, error: slackUnavailable() };
  // A member's, else someone from elsewhere a read named (a shared channel's).
  const address = ws.users.find((u) => u.id === userId)?.avatarUrl ?? slackStranger(userId)?.avatarUrl;
  const url = address ? onHost(address, AVATAR_HOSTS) : null;
  if (!url) return { status: 404, error: "No avatar" };
  return kept(avatars, url.href, SLACK_FILES.avatarKeepMs, () =>
    fetchFrom(url, SLACK_FILES.maxAvatarBytes, (t) => IMAGE.test(t), AVATAR_HOSTS),
  );
}

/** A custom emoji's image by name (following `alias:`), only from Slack's emoji CDN, kept a day. */
export async function slackEmoji(name: string): Promise<Fetched> {
  if (!/^[a-z0-9_+'-]{1,100}$/.test(name)) return { status: 400, error: "Unknown emoji" };
  const ws = await workspace();
  if (!ws) return { status: 404, error: slackUnavailable() };
  let value: string | undefined = Object.hasOwn(ws.emoji, name) ? ws.emoji[name] : undefined;
  for (let hops = 0; value?.startsWith("alias:") && hops < 5; hops++) {
    const next = value.slice(6);
    value = Object.hasOwn(ws.emoji, next) ? ws.emoji[next] : undefined;
  }
  const url = value ? onHost(value, EMOJI_HOSTS) : null;
  if (!url) return { status: 404, error: "No such emoji" };
  return kept(emojis, url.href, SLACK_FILES.emojiKeepMs, () =>
    fetchFrom(url, SLACK_FILES.maxEmojiBytes, (t) => IMAGE.test(t), EMOJI_HOSTS),
  );
}
