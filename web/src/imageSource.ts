/**
 * Where an image referenced from agent Markdown can be loaded from. Markdown
 * is author-controlled, so only two kinds of source are accepted:
 *
 * - Local files (absolute paths, file:// URLs), loaded only through the API's
 *   image route, which serves nothing but images the local daemon stored. A
 *   remote host's files aren't on this disk, so they degrade to a label.
 * - http(s) URLs without userinfo, loaded automatically but through the
 *   bounded, credential-free loader in imageLoad.ts.
 *
 * Everything else (data:, javascript:, relative or protocol-relative URLs,
 * other schemes, another machine's file share) is refused.
 */
export type ImageSource =
  | { kind: "local"; url: string; path: string; name: string }
  | { kind: "remote"; url: string; site: string; name: string }
  | { kind: "elsewhere"; name: string; reason: string }
  | { kind: "invalid"; name: string };

export function decodeSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function baseName(path: string) {
  return (
    path
      .replace(/[?#].*$/, "")
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() || ""
  );
}

export function resolveImage(raw: string, host?: string): ImageSource {
  const src = raw
    .trim()
    .replace(/^<(.*)>$/, "$1")
    .trim();
  let path: string;
  if (/^file:/i.test(src)) {
    // file:///p, file://localhost/p; never another machine's share.
    const m = /^file:\/\/(localhost)?(\/[^?#]*)/i.exec(src);
    if (!m) return { kind: "invalid", name: decodeSafe(baseName(src)) };
    path = decodeSafe(m[2]);
  } else if (src.startsWith("/") && !src.startsWith("//")) {
    // Plain paths are usually literal; decode only when that yields a file name
    // the daemon could have written (escaped spaces etc.).
    path = /%[0-9a-f]{2}/i.test(src) ? decodeSafe(src) : src;
  } else if (/^https?:\/\//i.test(src)) {
    let url: URL;
    try {
      url = new URL(src);
    } catch {
      return { kind: "invalid", name: src };
    }
    if (url.username || url.password)
      return { kind: "invalid", name: decodeSafe(baseName(url.pathname)) };
    return {
      kind: "remote",
      url: url.href,
      site: url.host,
      name: decodeSafe(baseName(url.pathname)) || url.host,
    };
  } else {
    return { kind: "invalid", name: decodeSafe(baseName(src)) || src };
  }
  const name = baseName(path) || path;
  if (path.includes("\0")) return { kind: "invalid", name };
  if (host)
    return {
      kind: "elsewhere",
      name,
      reason: "Stored on the agent's host, not readable from this machine",
    };
  return {
    kind: "local",
    url: `/api/attachments/image?path=${encodeURIComponent(path)}`,
    path,
    name,
  };
}

/** `![alt](src "title")`, with `<…>` sources allowing spaces and parentheses. */
const IMAGE_SYNTAX =
  /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|(?:[^\s()]|\([^\s()]*\))+)(?:\s+"[^"\n]*")?\s*\)/;
/** The same syntax without captures, for embedding in a larger pattern. */
export const MD_IMAGE = IMAGE_SYNTAX.source
  .replace("([^\\]\\n]*)", "[^\\]\\n]*")
  .replace("(<[^>\\n]+>|", "(?:<[^>\\n]+>|");

export function parseImage(markdown: string) {
  const m = IMAGE_SYNTAX.exec(markdown);
  return m ? { alt: m[1], src: m[2] } : null;
}

/** Splits images out of a prompt's text (the daemon appends stored images). */
export function extractImages(text: string) {
  const all = new RegExp(MD_IMAGE, "g");
  const images = [...text.matchAll(all)].map((m) => parseImage(m[0])!);
  return { images, text: text.replace(all, "") };
}
