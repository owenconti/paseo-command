/**
 * Files to Slack: the page sends a file's bytes here, the server asks Slack
 * for an upload address (`files.getUploadURLExternal`, with the user token)
 * and posts the bytes there. The answer is the file's id; it shows in a
 * conversation only once shared with the `share` write
 * (`files.completeUploadExternal`). The token never reaches the page.
 */
import type { SlackUploaded } from "../../src/slack/types";
import { SLACK, SlackError, slackCall } from "./client";
import { strOf } from "./normalize";

export const SLACK_UPLOAD = { maxBytes: 50 * 1024 * 1024, timeoutMs: 120_000 };

/** A file's name as Slack keeps it: no folders or control characters, at most 200 characters ("file" when nothing's left). */
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

/** Slack's upload address: https on files.slack.com only. */
export function uploadAddress(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "files.slack.com" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** Uploads `bytes` to Slack as `name` (not yet shared); throws a SlackError when Slack refuses or the upload fails. */
export async function uploadToSlack(bytes: Buffer, rawName: string, rawType: string): Promise<SlackUploaded> {
  if (!bytes.length) throw new SlackError("invalid", "The file is empty.");
  if (bytes.length > SLACK_UPLOAD.maxBytes) throw new SlackError("invalid", "Files up to 50 MB can be uploaded.");
  const name = uploadName(rawName);
  const type = uploadType(rawType);
  const r = await slackCall("files.getUploadURLExternal", { filename: name, length: bytes.length }, { essential: true });
  const target = uploadAddress(strOf(r.upload_url));
  const id = strOf(r.file_id);
  if (!target || !/^F[A-Z0-9]{2,20}$/.test(id)) throw new SlackError("failed", "Slack didn't offer a place for the file.");
  let res: Response;
  try {
    // The address is Slack's signed one: the token isn't sent with the bytes.
    res = await SLACK.fetch(target.href, {
      method: "POST",
      headers: { "Content-Type": type },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(SLACK_UPLOAD.timeoutMs),
    });
  } catch {
    throw new SlackError("failed", "The file couldn't be sent to Slack.");
  }
  if (!res.ok) throw new SlackError("failed", `Slack's storage refused the file (${res.status}).`);
  return { id, name };
}
