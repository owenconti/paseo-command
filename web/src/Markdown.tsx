import { copyText } from "./nativePlatform";
import { memo, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { MarkdownImage } from "./Images";
import { highlight, languageOf, type Token } from "./highlight";

/*
 * Agent prose as CommonMark + GFM (tables, task lists, strikethrough,
 * autolinks). Raw HTML is never rendered: react-markdown shows it as text.
 * Links go only to http(s) and mailto (anything else stays plain text), and
 * images only through MarkdownImage, which decides what may load.
 */

const SAFE_LINK = /^(?:https?:|mailto:)/i;

/** Reply headings sit under the session's own; h1 → h3 … h6. */
const heading =
  (level: number) =>
  ({ children }: { children?: ReactNode }) => {
    const Tag = `h${Math.min(level + 2, 6)}` as "h3";
    return <Tag className={`md-h${level}`}>{children}</Tag>;
  };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="md-copy"
      aria-label={copied ? "Copied" : "Copy code"}
      data-tip={copied ? "Copied" : "Copy code"}
      onClick={() =>
        copyText(text).then(
          () => setCopied(true),
          () => {},
        )
      }
    >
      {copied ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
    </button>
  );
}

type Hast = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: Hast[];
};
const textOf = (n: Hast): string =>
  n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join("");

/** Highlighting is decoration: if it ever fails, show the code plain. */
function safeHighlight(text: string, lang: string): Token[] {
  try {
    return highlight(text, lang);
  } catch {
    return [{ text }];
  }
}

function CodeBlock({ node }: ExtraProps) {
  const code = (node?.children[0] ?? { type: "root" }) as Hast;
  const classes = code.properties?.className;
  const lang = languageOf(
    (Array.isArray(classes) ? classes : [])
      .map(String)
      .find((c) => c.startsWith("language-"))
      ?.slice(9),
  );
  const text = textOf(code).replace(/\n$/, "");
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="md-code-lang">{lang || "text"}</span>
        <CopyButton text={text} />
      </div>
      <pre>
        <code>
          {safeHighlight(text, lang).map((t, i) =>
            t.kind ? (
              <span key={i} className={`tok-${t.kind}`}>
                {t.text}
              </span>
            ) : (
              t.text
            ),
          )}
        </code>
      </pre>
    </div>
  );
}

function components(imageHost?: string): Components {
  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    pre: CodeBlock,
    a: ({ href, children }) =>
      href && SAFE_LINK.test(href) ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ) : (
        <span className="md-link-text">{children}</span>
      ),
    img: ({ src, alt }) => (
      <MarkdownImage
        src={typeof src === "string" ? src : ""}
        alt={alt ?? ""}
        host={imageHost}
      />
    ),
    table: ({ children }) => (
      // Wide tables scroll sideways inside the reply, not the whole rail.
      <div className="md-table" tabIndex={0} role="region" aria-label="Table">
        <table>{children}</table>
      </div>
    ),
    input: ({ checked }) => (
      <input
        type="checkbox"
        className="md-task"
        checked={!!checked}
        disabled
        aria-label={checked ? "Done" : "Not done"}
      />
    ),
  };
}
const LOCAL = components();
const byHost = new Map<string, Components>();
const componentsFor = (host?: string) => {
  if (!host) return LOCAL;
  let c = byHost.get(host);
  if (!c) byHost.set(host, (c = components(host)));
  return c;
};

const PLUGINS = [remarkGfm];
// Images keep their raw source: resolveImage refuses data:, javascript: and
// the rest, and shows a labelled placeholder instead. Links are filtered by
// the `a` component above as well.
const urlTransform = (url: string, key: string) =>
  key === "src" ? url : defaultUrlTransform(url);

const ROW = /^\s*\|/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * What of a reply still streaming in to show now. Holds back the trailing
 * part that would render as something else once complete: a table's header
 * row before its delimiter arrives (it would flash as a paragraph of pipes),
 * and a half-typed line that opens a code fence. An unclosed fence itself is
 * fine: CommonMark renders it as code up to the end.
 */
export function settle(text: string) {
  const lines = text.split("\n");
  const last = lines[lines.length - 1];
  if (/^\s*`{1,2}$|^\s*```[^`\n]*$/.test(last) && !inFence(lines.slice(0, -1)))
    lines.pop();
  // A run of pipe rows at the end that isn't yet a table.
  let start = lines.length;
  while (start > 0 && ROW.test(lines[start - 1])) start--;
  const run = lines.slice(start);
  if (run.length > 0 && !inFence(lines.slice(0, start))) {
    const isTable = run.length >= 2 && DELIMITER.test(run[1]);
    const partialDelimiter = run.length === 2 && /^[\s|:-]*$/.test(run[1]);
    if (!isTable || partialDelimiter) lines.length = start;
  }
  return lines.join("\n");
}
function inFence(lines: string[]) {
  let open = false;
  for (const l of lines) if (/^\s{0,3}(```|~~~)/.test(l)) open = !open;
  return open;
}

export const Markdown = memo(function Markdown({
  text,
  imageHost,
  streaming,
}: {
  text: string;
  /** Set for agents on another host: their local image files aren't readable here. */
  imageHost?: string;
  /** The reply is still arriving; hide trailing syntax that isn't complete yet. */
  streaming?: boolean;
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={PLUGINS}
        components={componentsFor(imageHost)}
        urlTransform={urlTransform}
      >
        {streaming ? settle(text) : text}
      </ReactMarkdown>
    </div>
  );
});
