import { linearImages } from "./prompt";
import type { LinearAttachment, LinearUploaded } from "./types";

/** Files uploaded to Linear load only through the app server (it holds the key). */
const UPLOADS = /^https:\/\/uploads\.linear\.app\//;

export const isLinearUpload = (url: string) => UPLOADS.test(url);

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

/** Whether a name or address looks like an image the app can show. */
export function looksLikeImage(nameOrUrl: string): boolean {
  let path = nameOrUrl;
  try {
    path = decodeURIComponent(new URL(nameOrUrl).pathname);
  } catch {
    // A plain name.
  }
  return IMAGE.test(path);
}

/** "120 KB", "4.2 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** An upload's subtitle on its attachment: its kind and size ("PNG · 120 KB"). */
export function uploadSubtitle(file: Pick<LinearUploaded, "name" | "contentType" | "size">): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1];
  const kind = ext ? ext.toUpperCase() : file.contentType.split("/")[1]?.toUpperCase() || "File";
  return `${kind} · ${sizeText(file.size)}`;
}

/** An upload as Markdown: an image shows (`![name](url)`), anything else is a link. */
export function uploadMarkdown(file: Pick<LinearUploaded, "url" | "name" | "contentType">): string {
  const name = file.name.replace(/[[\]\\]/g, "\\$&");
  // Parentheses and spaces would end the Markdown link early.
  const url = file.url.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  return `${file.contentType.startsWith("image/") || looksLikeImage(file.name) ? "!" : ""}[${name}](${url})`;
}

/** Where the page loads an upload: an image through the image route, anything else as a download. */
export function uploadHref(url: string, origin: string, image: boolean): string {
  return `${origin}/api/linear/${image ? "image" : "file"}?url=${encodeURIComponent(url)}`;
}

/** What an attachment is, for its icon: an upload (image or file), a pull request, or a link. */
export function attachmentKind(a: Pick<LinearAttachment, "url" | "sourceType" | "title">): "image" | "file" | "github" | "link" {
  if (isLinearUpload(a.url)) return looksLikeImage(a.url) || looksLikeImage(a.title) ? "image" : "file";
  if (a.sourceType === "github" || /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\//.test(a.url)) return "github";
  return "link";
}

/**
 * Links in Markdown to files uploaded to Linear, pointed at the app server
 * (which holds the key): an image opens, anything else downloads. Embedded
 * images (`![…](…)`) are `linearImages`' to point.
 */
export function linearFileLinks(markdown: string, origin: string): string {
  return markdown.replace(
    /(^|[^!\\])\[([^\]]*)\]\(<?(https:\/\/uploads\.linear\.app\/[^)\s>]+)>?\)/g,
    (_, head: string, text: string, url: string) => `${head}[${text}](${uploadHref(url, origin, looksLikeImage(url))})`,
  );
}

/** Linear's Markdown as the page shows it: its uploads (images and files) through the app server. */
export const shownMarkdown = (markdown: string, origin: string) => linearImages(linearFileLinks(markdown, origin), origin);
