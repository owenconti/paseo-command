import { api } from "../api";
import type { SlackEvent, SlackUnavailable, SlackUploaded, SlackWriteInputs, SlackWriteName, SlackWriteResult } from "./types";

type Transport = (path: string, body?: unknown) => Promise<unknown>;
let transport: Transport = (path, body) => api(path, body);

/** Tests send the page's requests to a fake instead of the server (null restores the real one). */
export function setSlackTransport(next: Transport | null): void {
  transport = next ?? ((path, body) => api(path, body));
}

export type SlackReadName = "workspace" | "history" | "replies" | "conversation" | "unreads" | "search";

/** One of the server's named Slack reads; `SlackUnavailable` when Slack can't be asked right now. */
export function slackRead<T>(name: SlackReadName, params: Record<string, string> = {}): Promise<T | SlackUnavailable> {
  const query = new URLSearchParams(params).toString();
  return transport(`slack/q/${name}${query ? `?${query}` : ""}`) as Promise<T | SlackUnavailable>;
}

/** One of the server's whitelisted Slack writes; rejects with Slack's message. */
export function slackWrite<N extends SlackWriteName>(name: N, input: SlackWriteInputs[N]): Promise<SlackWriteResult> {
  return transport(`slack/m/${name}`, input) as Promise<SlackWriteResult>;
}

/** Whether a read answered "not now" (off, no token, refused, rate limited) instead of with data. */
export function isUnavailable(value: unknown): value is SlackUnavailable {
  return typeof value === "object" && value !== null && (value as { available?: unknown }).available === false;
}

/** Uploads one file; `progress` hears the share sent so far (0 to 1). */
type Uploader = (file: Blob, name: string, progress?: (sent: number) => void) => Promise<SlackUploaded>;
const serverUploader: Uploader = (file, name, progress) =>
  new Promise((resolve, reject) => {
    const params = new URLSearchParams({ name, type: file.type || "application/octet-stream" });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/slack/upload?${params}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let result: { error?: string } & Partial<SlackUploaded> = {};
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON: the status says enough.
      }
      if (xhr.status >= 200 && xhr.status < 300 && result.id) resolve(result as SlackUploaded);
      else reject(new Error(result.error || "The upload didn't go through."));
    };
    xhr.onerror = () => reject(new Error("The upload didn't go through."));
    xhr.send(file);
  });
let uploader = serverUploader;

/** Tests upload to a fake instead of the server (null restores the real one). */
export function setSlackUploader(next: Uploader | null): void {
  uploader = next ?? serverUploader;
}

/** Uploads a file to Slack through the app server (which holds the token); rejects with why it didn't go. */
export function uploadToSlack(file: Blob, name: string, progress?: (sent: number) => void): Promise<SlackUploaded> {
  return uploader(file, name, progress);
}

/** What the store needs of an event stream: `EventSource`'s shape. */
export type EventStream = {
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  close(): void;
};
type StreamFactory = (url: string) => EventStream;
const browserStream: StreamFactory = (url) => new EventSource(url) as unknown as EventStream;
let streamFactory: StreamFactory = browserStream;

/** Tests hand the store a fake event stream (null restores `EventSource`). */
export function setSlackStream(next: StreamFactory | null): void {
  streamFactory = next ?? browserStream;
}

/** Opens the server's live Slack events (`GET /api/slack/events`). */
export function openSlackEvents(): EventStream {
  return streamFactory("/api/slack/events");
}

/** An event's JSON, or null for anything that isn't one. */
export function parseEvent(data: unknown): SlackEvent | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data) as SlackEvent;
    return value && typeof value === "object" && typeof value.type === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Where the page loads Slack's private things: files (downloads), images, avatars and custom emoji, through the app server. */
export const slackFileHref = (url: string) => `/api/slack/file?url=${encodeURIComponent(url)}`;
export const slackImageHref = (url: string) => `/api/slack/image?url=${encodeURIComponent(url)}`;
export const slackAvatarHref = (userId: string) => `/api/slack/avatar?user=${encodeURIComponent(userId)}`;
export const slackEmojiHref = (name: string) => `/api/slack/emoji?name=${encodeURIComponent(name)}`;
