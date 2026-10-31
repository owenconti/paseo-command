/**
 * Markdown to Slack's mrkdwn, for the places Slack takes no `markdown_text`
 * (an edit Slack refuses it on, a shared file's comment): bold, italic,
 * strike, links, inline code and code blocks, headings, bullet and numbered
 * lists. `&`, `<` and `>` are escaped as Slack asks; code is left as written.
 */

const B = "\u0001";
const CODE = "\u0002";

/** `markdown` as Slack mrkdwn. */
export function toMrkdwn(markdown: string): string {
  const kept: string[] = [];
  const keep = (s: string) => `${CODE}${kept.push(s) - 1}${CODE}`;
  let s = markdown.replace(/\r\n?/g, "\n");
  // Code blocks and inline code: kept as written (Slack shows them the same), only escaped.
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, body: string) => keep("```\n" + escape(body.replace(/\n$/, "")) + "\n```"));
  s = s.replace(/`([^`\n]+)`/g, (_m, body: string) => keep("`" + escape(body) + "`"));
  s = escape(s);
  // Quotes stay quotes.
  s = s.replace(/^(\s*)&gt;/gm, "$1>");
  // Links and images: <url|text>.
  s = s.replace(/!?\[([^\]\n]*)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, text: string, url: string) =>
    keep(text ? `<${unescape(url)}|${text}>` : `<${unescape(url)}>`),
  );
  // Headings: bold lines.
  s = s.replace(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/gm, (_m, text: string) => `${B}${text}${B}`);
  // Lists: "- x" / "* x" / "+ x" → "• x", keeping the indent; numbered lists stay as they are.
  s = s.replace(/^(\s*)[-*+]\s+(?!\[)/gm, (_m, indent: string) => `${indent}• `);
  s = s.replace(/^(\s*)[-*+]\s+\[( |x)\]\s+/gim, (_m, indent: string, done: string) => `${indent}${done.trim() ? "☑" : "☐"} `);
  // Bold (** or __), then italic (* or _), then strike (~~).
  s = s.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, `${B}$1${B}`);
  s = s.replace(/__(?=\S)([^\n]*?\S)__/g, `${B}$1${B}`);
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1_$2_");
  s = s.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1_$2_");
  s = s.replace(/~~(?=\S)([^\n]*?\S)~~/g, "~$1~");
  // Horizontal rules have no mrkdwn: a line of dashes reads the same.
  s = s.replaceAll(B, "*");
  return s.replace(new RegExp(`${CODE}(\\d+)${CODE}`, "g"), (_m, i: string) => kept[Number(i)]);
}

const unescape = (s: string) => s.replace(/&amp;/g, "&");

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
