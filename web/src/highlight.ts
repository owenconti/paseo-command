/**
 * Lightweight syntax highlighting for fenced code in agent replies: comments,
 * strings, numbers, keywords and (for diffs) added/removed lines. A single
 * pass over the text with one regex per language family; no grammar, no
 * dependencies. Output is plain tokens, rendered as text by React (never HTML).
 */
export type TokenKind =
  "comment" | "string" | "number" | "keyword" | "add" | "del" | "meta";
export type Token = { kind?: TokenKind; text: string };

const C_LIKE =
  "abstract as async await break case catch class const continue default defer delete do else enum export extends false final finally fn for from func function go if impl implements import in instanceof interface let match mod mut new nil null package private protected pub public readonly return self static struct super switch this throw throws trait true try type typeof undefined use var void while yield";
const PY =
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield";
const SHELL =
  "case do done elif else esac export fi for function if in local return then until while";
const SQL =
  "add all alter and as asc by case create delete desc distinct drop else end exists from group having in index inner insert into is join key left like limit not null on or order outer primary references right select set table then union update values when where with";
const RUBY =
  "begin class def do else elsif end ensure false if module next nil require rescue return self then true unless until when while yield";

type Family = { words: string; comment: RegExp; caseless?: boolean };
const SLASH = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/;
const HASH = /#[^\n]*/;
// In shell, `#` starts a comment only at a word boundary ($#, a#b aren't).
const SHELL_HASH = /(?<!\S)#[^\n]*/;
const FAMILIES = {
  c: { words: C_LIKE, comment: SLASH },
  py: { words: PY, comment: HASH },
  sh: { words: SHELL, comment: SHELL_HASH },
  sql: {
    words: SQL,
    comment: /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/,
    caseless: true,
  },
  rb: { words: RUBY, comment: HASH },
  yaml: { words: "true false null yes no on off", comment: HASH },
  json: { words: "true false null", comment: SLASH },
} satisfies Record<string, Family>;
// A Map, so fence labels like `constructor` or `__proto__` find nothing.
const ALIASES = new Map<string, keyof typeof FAMILIES>(
  Object.entries({
    js: "c",
    jsx: "c",
    mjs: "c",
    cjs: "c",
    ts: "c",
    tsx: "c",
    javascript: "c",
    typescript: "c",
    java: "c",
    kotlin: "c",
    kt: "c",
    swift: "c",
    go: "c",
    golang: "c",
    rust: "c",
    rs: "c",
    c: "c",
    h: "c",
    cpp: "c",
    "c++": "c",
    cs: "c",
    csharp: "c",
    php: "c",
    scala: "c",
    dart: "c",
    css: "c",
    scss: "c",
    py: "py",
    python: "py",
    sh: "sh",
    bash: "sh",
    zsh: "sh",
    shell: "sh",
    console: "sh",
    fish: "sh",
    sql: "sql",
    psql: "sql",
    postgres: "sql",
    mysql: "sql",
    sqlite: "sql",
    rb: "rb",
    ruby: "rb",
    yml: "yaml",
    yaml: "yaml",
    toml: "yaml",
    ini: "yaml",
    json: "json",
    jsonc: "json",
    json5: "json",
  } as const),
);

const cache = new Map<Family, RegExp>();
function pattern(family: Family) {
  let re = cache.get(family);
  if (re) return re;
  const words = family.words.split(" ").join("|");
  re = new RegExp(
    [
      `(${family.comment.source})`,
      // Strings: double, single, backtick; unterminated ones run to the line end.
      `("(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\[\\s\\S])*\`?)`,
      `(\\b(?:0x[\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b)`,
      `(\\b(?:${words})\\b)`,
    ].join("|"),
    family.caseless ? "gi" : "g",
  );
  cache.set(family, re);
  return re;
}

/** Display name for a fence's info string ("ts" → "ts", "" → ""). */
export function languageOf(info: string | undefined) {
  return (info ?? "").trim().split(/\s+/)[0].toLowerCase();
}

export function highlight(code: string, lang: string): Token[] {
  if (lang === "diff" || lang === "patch")
    return code.split(/(?<=\n)/).map((line) => ({
      text: line,
      kind: /^(\+\+\+|---|@@)/.test(line)
        ? "meta"
        : line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : undefined,
    }));
  const name = ALIASES.get(lang);
  if (!name) return [{ text: code }];
  const family: Family = FAMILIES[name];
  const re = pattern(family);
  const tokens: Token[] = [];
  let last = 0;
  for (const m of code.matchAll(re)) {
    const start = m.index!;
    if (start > last) tokens.push({ text: code.slice(last, start) });
    const kind: TokenKind = m[1]
      ? "comment"
      : m[2]
        ? "string"
        : m[3]
          ? "number"
          : "keyword";
    tokens.push({ kind, text: m[0] });
    last = start + m[0].length;
  }
  if (last < code.length) tokens.push({ text: code.slice(last) });
  return tokens;
}
