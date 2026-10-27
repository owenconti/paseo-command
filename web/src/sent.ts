import { readStore, writeStore } from "./api";
import type { Outgoing } from "./Composer";
import type { UploadedFile } from "./composer/types";

/** A GitHub item as toOutgoing (queue.ts) sends it. */
type GitHubWire = {
  type: "github_pr" | "github_issue";
  number: number;
  title: string;
  url: string;
};

/**
 * The daemon's timeline keeps only the text of a prompt, so — like the Paseo app —
 * attachments are remembered locally, keyed by the message ID sent with the prompt.
 */
export type SentAttachments = {
  images: string[];
  files: { name: string; size: number }[];
  github: {
    kind: "pr" | "issue";
    number: number;
    title: string;
    url: string;
  }[];
};
const KEEP = 300;

export function saveSent(messageId: string, value: SentAttachments) {
  const index = readStore<string[]>("sent-index", []).filter(
    (id) => id !== messageId,
  );
  index.push(messageId);
  for (const old of index.splice(0, Math.max(0, index.length - KEEP)))
    localStorage.removeItem(`paseo-command:sent:${old}`);
  writeStore(`sent:${messageId}`, value);
  writeStore("sent-index", index);
}

export function loadSent(messageId?: string): SentAttachments | null {
  return messageId
    ? readStore<SentAttachments | null>(`sent:${messageId}`, null)
    : null;
}

/** A small JPEG preview, so remembered screenshots don't exhaust local storage. */
export function thumbnail(dataUrl: string, max = 360): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas
        .getContext("2d")!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

/**
 * The body of a send: a prompt with attachments gets a message ID, and its
 * attachments are remembered locally under it for the timeline to show.
 */
export async function sendBody(message: Outgoing) {
  const rich = message.images.length > 0 || message.attachments.length > 0;
  // A queued message brings its own ID (the daemon dedupes repeats on it).
  const messageId =
    message.messageId ?? (rich ? crypto.randomUUID() : undefined);
  if (messageId && rich) {
    const files = message.attachments as (UploadedFile | GitHubWire)[];
    saveSent(messageId, {
      images: (
        await Promise.all(message.images.map((i) => thumbnail(i.dataUrl)))
      ).filter(Boolean),
      files: files
        .filter((a): a is UploadedFile => a.type === "uploaded_file")
        .map((a) => ({ name: a.fileName, size: a.size })),
      github: files
        .filter(
          (a): a is GitHubWire =>
            a.type === "github_pr" || a.type === "github_issue",
        )
        .map((a) => ({
          kind: a.type === "github_pr" ? "pr" : "issue",
          number: a.number,
          title: a.title,
          url: a.url,
        })),
    });
  }
  return {
    ...(messageId ? { messageId } : {}),
    prompt: message.text,
    ...(message.images.length
      ? {
          images: message.images.map(({ data, mimeType }) => ({
            data,
            mimeType,
          })),
        }
      : {}),
    ...(message.attachments.length ? { attachments: message.attachments } : {}),
    ...(message.behavior ? { behavior: message.behavior } : {}),
  };
}
