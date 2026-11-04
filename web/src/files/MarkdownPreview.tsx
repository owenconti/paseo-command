import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ImageOff, LoaderCircle } from "lucide-react";
import { openAppLink, parseAppLink } from "../appLinks";
import { CodeBlock } from "../Markdown";
import { FAIL_TEXT, ImageLoadError, LOCAL_BUDGET, REMOTE_BUDGET, loadImage, type FailReason } from "../imageLoad";
import { macApp, postAppLink } from "../worldBridge";
import { clearFindMarks, FindBar } from "../github/DiffFind";
import type { FindOptions } from "../github/diffSearch";
import { imageUrl, type FilesWorkspace } from "./api";
import { findInPieces, pieceAt, resolveImageSource, resolveLink, type MarkdownLink, type TextMatch } from "./markdown";
import { rehypeFilesMarkdown } from "./markdownHtml";

type Plugins = NonNullable<Options["remarkPlugins"]>;
const REMARK: Plugins = [remarkGfm];
const REHYPE = [rehypeFilesMarkdown] as unknown as NonNullable<Options["rehypePlugins"]>;
// Images keep their raw source (`resolveImageSource` decides what loads); links are checked again where clicked.
const urlTransform = (url: string, key: string) => (key === "src" ? url : defaultUrlTransform(url));

/** The preview's handle: ⌘F, and the source line at the top of the view (where an editor opens). */
export type PreviewHandle = { find: () => void; line: () => number };
/** A link to one of the workspace's files or folders, for the Files page to open. */
export type WorkspaceLink = Extract<MarkdownLink, { kind: "file" | "folder" }>;

const HIGHLIGHT = { all: "gd-find", current: "gd-find-current" };
type Registry = { set(name: string, h: unknown): void };
const registry = () => (CSS as unknown as { highlights?: Registry }).highlights;
const HighlightCtor = () => (window as unknown as { Highlight?: new (...r: Range[]) => { priority: number } }).Highlight;

/** The elements a find's match never crosses out of. */
const BLOCK = "p,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,dt,dd,summary,figcaption,caption,div,section,details,article";

/** The rendered text's pieces, in order, each with its block; the code blocks' bars (language, Copy) left out. */
function piecesOf(article: HTMLElement) {
  const nodes: Text[] = [];
  const pieces: { text: string; block: number }[] = [];
  const blocks = new Map<Element, number>();
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".md-code-bar") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.data) continue;
    const block = node.parentElement?.closest(BLOCK) ?? article;
    if (!blocks.has(block)) blocks.set(block, blocks.size);
    nodes.push(node);
    pieces.push({ text: node.data, block: blocks.get(block)! });
  }
  return { nodes, pieces };
}

type Found = { matches: TextMatch[]; ranges: Range[]; capped: boolean; error?: string };

/**
 * A Markdown file rendered (the Files viewer's Preview): CommonMark and GFM
 * (tables, task lists, footnotes), code blocks highlighted as the chat's,
 * HTML rebuilt from an allowlist (`markdownHtml.ts`). Links: the workspace's
 * files and folders open in Files (resolved against the file's folder), a
 * heading's anchor scrolls to it, the web opens as links do (a PR in the
 * GitHub tab, a Linear issue in Linear, others in Conquer; a browser tab
 * outside the app); anything else stays text. Images: the workspace's raster
 * images through the Files image route, https ones through the bounded
 * loader, nothing else. ⌘F finds in the rendered text, marked with the CSS
 * Custom Highlight API as the diff's finds are.
 */
export function MarkdownPreview({
  workspace,
  path,
  text,
  wrap,
  handle,
  onOpen,
  onUse,
  reveal,
}: {
  workspace: FilesWorkspace;
  path: string;
  text: string;
  /** Code blocks wrap their lines too. */
  wrap: boolean;
  handle: RefObject<PreviewHandle | null>;
  onOpen: (link: WorkspaceLink) => void;
  onUse: () => void;
  /** A heading to scroll to once drawn (a link from another file's `#anchor`); `token` tells asks apart. */
  reveal?: { anchor: string; token: number };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);

  const scrollTo = (el: { getBoundingClientRect(): DOMRect }, block: "start" | "center") => {
    const box = scroller.current;
    if (!box) return;
    const r = el.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (block === "center" && r.top >= view.top + 40 && r.bottom <= view.bottom - 40) return;
    const top = box.scrollTop + r.top - view.top;
    box.scrollTop = block === "start" ? top - 12 : top - box.clientHeight / 2 + r.height / 2;
  };
  const headingOf = (id: string) => {
    const root = article.current;
    if (!root) return null;
    const want = id.toLowerCase();
    return (
      root.querySelector(`[data-anchor="${CSS.escape(id)}"]`) ??
      root.querySelector(`[data-anchor="${CSS.escape(want)}"]`) ??
      // GitHub's own prefix, as in its rendered READMEs' links.
      root.querySelector(`[data-anchor="${CSS.escape(want.replace(/^user-content-/, ""))}"]`)
    );
  };
  useEffect(() => {
    if (!reveal) return;
    const raf = requestAnimationFrame(() => {
      const h = headingOf(reveal.anchor);
      if (h) scrollTo(h, "start");
    });
    return () => cancelAnimationFrame(raf);
  }, [reveal?.token]);

  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const a = (e.target as Element).closest?.("a[href]");
    if (!(a instanceof HTMLAnchorElement) || !article.current?.contains(a)) return;
    // As written in the file (the drawn `href` is for show: a fragment of the page's own for the workspace's files).
    const link = resolveLink(path, a.dataset.href ?? "");
    if (link.kind === "web") {
      if (link.url.startsWith("mailto:")) return;
      e.preventDefault();
      if (parseAppLink(link.url)) openAppLink(link.url);
      // The app routes it: a Linear issue to Linear's desktop app, others to Conquer.
      else if (macApp()) postAppLink(link.url);
      else window.open(link.url, "_blank", "noopener,noreferrer");
      return;
    }
    e.preventDefault();
    if (link.kind === "anchor") {
      const h = headingOf(link.id);
      if (h) scrollTo(h, "start");
    } else if (link.kind === "file" || link.kind === "folder") onOpen(link);
  };

  const components = useMemo<Components>(
    () => ({
      pre: CodeBlock,
      a: ({ href, children, title }) => {
        const link = resolveLink(path, href ?? "");
        if (link.kind === "none") return <span className="md-link-text">{children}</span>;
        if (link.kind === "web")
          return (
            <a href={link.url} data-href={href} title={title} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        if (link.kind === "anchor")
          return (
            <a href={`#${encodeURIComponent(link.id)}`} data-href={href} title={title}>
              {children}
            </a>
          );
        return (
          <a
            href={`#files:${link.path}`}
            data-href={href}
            className="file-link"
            title={title ?? `Open ${link.path || "the workspace’s root"} in Files`}
            data-file-path={link.path}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt, title, width, height }) => (
        <PreviewImage
          workspace={workspace}
          from={path}
          src={typeof src === "string" ? src : ""}
          alt={alt ?? ""}
          title={title}
          width={width}
          height={height}
        />
      ),
      table: ({ children }) => (
        // Wide tables scroll sideways in their own frame.
        <div className="md-table" tabIndex={0} role="region" aria-label="Table">
          <table>{children}</table>
        </div>
      ),
      input: ({ checked }) => <input type="checkbox" className="md-task" checked={!!checked} disabled aria-label={checked ? "Done" : "Not done"} />,
    }),
    [workspace.id, workspace.host, path],
  );

  // ── Find (⌘F) in the rendered text ──
  const findInput = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState(false);
  const [findText, setFindText] = useState("");
  const [findOpts, setFindOpts] = useState<FindOptions>({ caseSensitive: false, regex: false });
  const [asked, setAsked] = useState("");
  useEffect(() => {
    if (!findText) return setAsked("");
    const t = setTimeout(() => setAsked(findText), 100);
    return () => clearTimeout(t);
  }, [findText]);
  const [found, setFound] = useState<Found | null>(null);
  const [at, setAt] = useState(-1);
  // Found again as the query or the text changes (after it's drawn).
  useLayoutEffect(() => {
    const root = article.current;
    if (!finding || !asked || !root) return setFound(null);
    const { nodes, pieces } = piecesOf(root);
    const r = findInPieces(pieces, asked, findOpts);
    const ranges = r.matches.map((m) => {
      const a = pieceAt(r.starts, m.start);
      const b = pieceAt(r.starts, m.end, true);
      const range = document.createRange();
      range.setStart(nodes[a.piece]!, a.offset);
      range.setEnd(nodes[b.piece]!, b.offset);
      return range;
    });
    setFound({ matches: r.matches, ranges, capped: r.capped, ...(r.error ? { error: r.error } : {}) });
  }, [finding, asked, findOpts, text]);
  const lastAsk = useRef("");
  useEffect(() => {
    if (!found?.ranges.length) {
      setAt(-1);
      if (!found) lastAsk.current = "";
      return;
    }
    const ask = `${asked}\0${findOpts.caseSensitive}\0${findOpts.regex}`;
    if (ask !== lastAsk.current) {
      lastAsk.current = ask;
      // From what's in view.
      const top = scroller.current?.getBoundingClientRect().top ?? 0;
      const first = found.ranges.findIndex((r) => r.getBoundingClientRect().bottom > top);
      goTo(first < 0 ? 0 : first, found);
    } else setAt((i) => Math.min(Math.max(i, 0), found.ranges.length - 1));
  }, [found]);
  const goTo = (i: number, f = found) => {
    const range = f?.ranges[i];
    setAt(range ? i : -1);
    if (range) {
      // Inside a closed <details>: opened, so the match shows.
      range.startContainer.parentElement?.closest("details:not([open])")?.setAttribute("open", "");
      scrollTo(range, "center");
    }
  };
  // The marks: every match, the current one apart.
  useEffect(() => {
    const reg = registry();
    const Ctor = HighlightCtor();
    if (!found || !reg || !Ctor) return;
    reg.set(HIGHLIGHT.all, new Ctor(...found.ranges.filter((_, i) => i !== at)));
    const mark = new Ctor(...(at >= 0 && found.ranges[at] ? [found.ranges[at]!] : []));
    mark.priority = 1;
    reg.set(HIGHLIGHT.current, mark);
    return () => clearFindMarks();
  }, [found, at]);
  const step = (by: 1 | -1) => {
    const n = found?.ranges.length ?? 0;
    if (n) goTo(at < 0 ? (by > 0 ? 0 : n - 1) : (at + by + n) % n);
  };
  const openFind = useCallback(() => {
    onUse();
    setFinding(true);
    requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  }, [onUse]);
  const closeFind = () => {
    setFinding(false);
    clearFindMarks();
  };
  useEffect(() => () => clearFindMarks(), []);
  useLayoutEffect(() => {
    handle.current = {
      find: openFind,
      line: () => {
        const top = scroller.current?.getBoundingClientRect().top ?? 0;
        for (const el of article.current?.querySelectorAll<HTMLElement>("[data-line]") ?? []) {
          if (el.getBoundingClientRect().bottom > top) return Number(el.dataset.line) || 1;
        }
        return 1;
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, openFind]);

  return (
    <>
      {finding && (
        <FindBar
          input={findInput}
          query={findText}
          options={findOpts}
          count={found?.ranges.length ?? 0}
          at={at}
          capped={!!found?.capped}
          error={found?.error}
          onQuery={setFindText}
          onOptions={setFindOpts}
          onStep={step}
          onClose={closeFind}
          label="Find in the preview"
        />
      )}
      <div className="fv-md-scroll" ref={scroller} tabIndex={-1}>
        <article ref={article} className={`md fv-md${wrap ? " wrap" : ""}`} aria-label={`${path}, rendered`} onClick={onClick}>
          <Rendered text={text} components={components} />
        </article>
      </div>
    </>
  );
}

/** The rendering itself, again only when the text (or what draws it) changes. */
const Rendered = memo(function Rendered({ text, components }: { text: string; components: Components }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components} urlTransform={urlTransform}>
      {text}
    </ReactMarkdown>
  );
});

type Load = { status: "waiting" | "loading" } | { status: "ready"; src: string } | { status: "broken"; reason: FailReason };

/**
 * An image in the preview, at its own size (at most the column's width): the
 * workspace's through the Files image route, an https one through the bounded,
 * credential-free loader, each only once near the view; anything else, or one
 * that fails, a labelled placeholder.
 */
function PreviewImage({
  workspace,
  from,
  src,
  alt,
  title,
  width,
  height,
}: {
  workspace: FilesWorkspace;
  from: string;
  src: string;
  alt: string;
  title?: string;
  width?: string | number;
  height?: string | number;
}) {
  const source = resolveImageSource(from, src);
  const url = source.kind === "workspace" ? imageUrl(workspace, source.path) : source.kind === "remote" ? source.url : "";
  const [load, setLoad] = useState<Load>({ status: "waiting" });
  const placeholder = useRef<HTMLSpanElement>(null);
  useEffect(() => setLoad({ status: "waiting" }), [url]);
  useEffect(() => {
    if (load.status !== "waiting" || !url) return;
    const el = placeholder.current;
    if (!el || typeof IntersectionObserver === "undefined") return setLoad({ status: "loading" });
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setLoad({ status: "loading" });
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load.status, url]);
  const loading = load.status === "loading";
  useEffect(() => {
    if (!loading) return;
    const controller = new AbortController();
    loadImage(url, source.kind === "remote" ? REMOTE_BUDGET : LOCAL_BUDGET, controller.signal).then(
      ({ blob }) => {
        if (!controller.signal.aborted) setLoad({ status: "ready", src: URL.createObjectURL(blob) });
      },
      (e) => {
        if (!controller.signal.aborted) setLoad({ status: "broken", reason: e instanceof ImageLoadError ? e.reason : "network" });
      },
    );
    return () => controller.abort();
  }, [loading, url]);
  const ready = load.status === "ready" ? load.src : "";
  useEffect(
    () => () => {
      if (ready) URL.revokeObjectURL(ready);
    },
    [ready],
  );
  const label = alt.trim() || source.name;
  if (source.kind === "blocked" || load.status === "broken")
    return (
      <span className="md-image notice fv-md-image-off" role="img" aria-label={`Image not shown: ${label}`} title={source.kind === "blocked" ? source.reason : FAIL_TEXT[(load as { reason: FailReason }).reason]}>
        <ImageOff size={14} aria-hidden="true" />
        <span className="md-image-text">
          <span className="md-image-name">{label}</span>
          <small>{source.kind === "blocked" ? source.reason : FAIL_TEXT[(load as { reason: FailReason }).reason]}</small>
        </span>
      </span>
    );
  if (load.status !== "ready")
    return (
      <span ref={placeholder} className="fv-md-image-wait" role="img" aria-label={`Loading image: ${label}`} aria-busy="true">
        <LoaderCircle size={16} className="spinning" aria-hidden="true" />
      </span>
    );
  return (
    <img
      className="fv-md-image"
      src={load.src}
      alt={alt}
      title={title}
      decoding="async"
      {...(width ? { width } : {})}
      {...(height ? { height } : {})}
      onError={() => setLoad({ status: "broken", reason: "not-an-image" })}
    />
  );
}
