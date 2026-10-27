/**
 * What a paste carrying files should do with the text that came along.
 *
 * Copying files in Finder (or Explorer) also puts their names, paths or
 * file:// URLs on the clipboard as text; inserting that next to the
 * attachment just duplicates it. Anything else is kept: native paste has
 * already been cancelled, so dropped text would be lost.
 *
 * Text is dropped only when every line is exact evidence of the pasted files:
 * - a bare file name equal to a pasted file's name (or to the last segment of
 *   a file in the clipboard's uri-list), or
 * - a path or file:// URL identical, after normalisation, to an entry of the
 *   clipboard's uri-list.
 * A path is never dropped for merely ending in the same name: without the
 * uri-list naming that exact file, it may be a different file the user means.
 * Returns the text to insert, or "" when it only names the files.
 */
export function pastedText(
  fileNames: string[],
  text: string,
  uriList = "",
): string {
  if (!text.trim()) return "";
  if (!fileNames.length) return text;
  const names = new Set(fileNames.map((n) => n.toLowerCase()));
  const listed = new Set<string>();
  for (const raw of uriList.split(/\r?\n/)) {
    const uri = raw.trim();
    if (!uri || uri.startsWith("#")) continue;
    const path = fileUrlPath(uri);
    if (!path) continue;
    listed.add(key(path));
    names.add(baseName(path).toLowerCase());
  }
  const lines = text
    .split(/[\r\n]+/)
    .map((l) => unquote(l.trim()))
    .filter(Boolean);
  const refersToFile = (line: string) => {
    if (!/[/\\]/.test(line) && !/^file:/i.test(line))
      return names.has(line.toLowerCase());
    const path = /^file:/i.test(line) ? fileUrlPath(line) : textPath(line);
    return !!path && listed.has(key(path));
  };
  return lines.every(refersToFile) ? "" : text;
}

/** file:///p → /p; file://host/share/p → //host/share/p; file:///C:/p → C:/p. */
function fileUrlPath(uri: string) {
  const m = /^file:\/\/([^/?#]*)(\/[^?#]*)$/i.exec(uri);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  const host = m[1].toLowerCase();
  if (host && host !== "localhost") return `//${m[1]}${path}`;
  return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
}

/** Absolute POSIX, drive-letter or UNC paths typed as text; nothing else. */
function textPath(line: string) {
  if (line.startsWith("/")) return line;
  if (/^[a-z]:\\/i.test(line) || line.startsWith("\\\\"))
    return line.replace(/\\/g, "/");
  return null;
}

/** Windows paths compare case-insensitively; POSIX paths exactly. */
function key(path: string) {
  return /^([a-z]:\/|\/\/)/i.test(path) ? path.toLowerCase() : path;
}

function baseName(path: string) {
  return (
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() || ""
  );
}

function unquote(line: string) {
  return /^(["']).*\1$/.test(line) && line.length > 1
    ? line.slice(1, -1)
    : line;
}
