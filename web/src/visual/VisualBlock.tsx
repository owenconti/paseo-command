import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { CopyButton } from "../CodeCopyButton";
import { useFocusTrap } from "../focus";
import { resolveImage } from "../imageSource";
import { LOCAL_BUDGET, loadImage } from "../imageLoad";
import { ZoomControls } from "../mermaid/MermaidBlock";
import {
  activateDiagram,
  registerDiagram,
  removeDiagram,
  type MermaidAction,
} from "../mermaidCommands";
import { macApp, postAppLink } from "../worldBridge";
import {
  VISUAL_LIMITS,
  VISUAL_TOKENS,
  findLocalImages,
  frameHeight,
  inlineImages,
  readKey,
  readLink,
  readSize,
  themeMessage,
  titleOf,
  usesViewportHeight,
  visualDocument,
  visualTheme,
  type VisualTheme,
} from "./page";

/*
 * A visual reply: the page an agent wrote as a fenced `html-render` block,
 * drawn in the chat in a sandboxed frame (see page.ts for what the frame may
 * do). The block shares the Mermaid block's look, toolbar and ⌘K registry.
 */

const MIN_ZOOM = 0.25,
  MAX_ZOOM = 4,
  MAX_IMAGES = 40;

type Look = { theme: VisualTheme; style: CSSProperties };
function lookOf(el: HTMLElement): Look {
  const style = getComputedStyle(el);
  const read = (token: string) => style.getPropertyValue(token).trim();
  // The panel's own colour says whether this place is dark, whatever the app's theme
  // (the Dungeon dialogue is dark in a light app).
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const c = canvas.getContext("2d");
  let dark = /dark/.test(style.colorScheme);
  if (c && read("--panel")) {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 1, 1);
    c.fillStyle = read("--panel");
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    dark = 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128;
  }
  return {
    theme: visualTheme(dark ? "dark" : "light", read),
    style: {
      ...Object.fromEntries(
        [...VISUAL_TOKENS, "--panel-2", "--line", "--scrollbar"].map((t) => [
          t,
          read(t),
        ]),
      ),
      fontFamily: style.fontFamily,
      colorScheme: style.colorScheme,
    } as CSSProperties,
  };
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** The page with the local images it names embedded, and those that couldn't be. */
async function embedImages(
  html: string,
  host: string | undefined,
  signal: AbortSignal,
): Promise<{ html: string; missing: string[] }> {
  const found = findLocalImages(html);
  const paths = [...new Set(found.map((f) => f.path))];
  if (!paths.length) return { html, missing: [] };
  const urls = new Map<string, string>();
  let room = VISUAL_LIMITS.page - html.length;
  await Promise.all(
    paths.slice(0, MAX_IMAGES).map(async (path) => {
      const source = resolveImage(path, host);
      if (source.kind !== "local") return;
      try {
        const { blob } = await loadImage(source.url, LOCAL_BUDGET, signal);
        const url = await dataUrl(blob);
        if (url.length > room) return;
        room -= url.length;
        urls.set(path, url);
      } catch {
        // Listed as missing below.
      }
    }),
  );
  return {
    html: inlineImages(html, found, urls),
    missing: paths.filter((p) => !urls.has(p)),
  };
}

export function VisualBlock({
  source,
  pending,
  host,
}: {
  source: string;
  /** The reply is still arriving and this block's fence isn't closed. */
  pending: boolean;
  /** The agent's host when it isn't this machine. */
  host?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false),
    [visible, setVisible] = useState(false);
  const [look, setLook] = useState<Look | null>(null);
  const [built, setBuilt] = useState<{
    source: string;
    doc: string;
    missing: string[];
  } | null>(null);
  const [showSource, setShowSource] = useState(false),
    [expanded, setExpanded] = useState(false),
    [zoom, setZoom] = useState(1);
  const run = useRef<(action: MermaidAction) => void>(() => {});
  const lookNow = useRef<Look | null>(null);
  lookNow.current = look;
  const tooLarge = source.length > VISUAL_LIMITS.source;
  const page = built?.source === source && !pending ? built : null;
  const sourceShown = showSource || !page;
  const title = titleOf(source);
  const fixed = usesViewportHeight(source);

  useEffect(() => {
    const el = root.current!;
    const observer = new IntersectionObserver((entries) => {
      const inView = entries.some((e) => e.isIntersecting);
      setVisible(inView);
      if (inView) setNear(true);
    });
    observer.observe(el);
    const refresh = () => {
      const next = lookOf(el);
      setLook((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    };
    refresh();
    const changes = new MutationObserver(refresh);
    changes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
    return () => {
      observer.disconnect();
      changes.disconnect();
      removeDiagram(id);
    };
  }, [id]);

  // Built once per source: later theme changes are posted to the page, which keeps its state.
  const hasLook = !!look;
  useEffect(() => {
    if (!near || !hasLook || pending || tooLarge || !source.trim()) return;
    const controller = new AbortController();
    embedImages(source, host, controller.signal).then(({ html, missing }) => {
      if (controller.signal.aborted) return;
      setBuilt({
        source,
        doc: visualDocument(html, lookNow.current!.theme, {
          popups: !macApp(),
        }),
        missing,
      });
    });
    return () => controller.abort();
  }, [source, pending, near, hasLook, tooLarge, host]);
  useEffect(() => {
    setZoom(1);
    setExpanded(false);
  }, [source]);

  run.current = (action) => {
    switch (action) {
      case "source":
        if (page) setShowSource((v) => !v);
        break;
      case "copy":
        root.current?.querySelector<HTMLButtonElement>(".md-copy")?.click();
        break;
      case "expand":
        if (page) setExpanded(true);
        break;
      case "close":
        setExpanded(false);
        break;
      case "in":
        setZoom((v) => Math.min(MAX_ZOOM, Math.round((v + 0.25) * 100) / 100));
        break;
      case "out":
        setZoom((v) => Math.max(MIN_ZOOM, Math.round((v - 0.25) * 100) / 100));
        break;
      case "fit":
        setZoom(1);
        break;
    }
  };
  useEffect(() => {
    if (root.current)
      registerDiagram({
        id,
        root: root.current,
        visible,
        ready: !!page,
        source: sourceShown,
        expanded,
        zoom,
        page: true,
        run: (action) => run.current(action),
      });
  }, [id, visible, page, sourceShown, expanded, zoom]);

  const status = pending
    ? "The page will appear when this code block finishes."
    : tooLarge
      ? "This page is too large to show. Its HTML is below."
      : source.trim()
        ? "Preparing the page…"
        : "Waiting for the page’s HTML…";
  return (
    <div
      ref={root}
      className="mermaid-block visual-block"
      data-visual={id}
      onFocusCapture={() => activateDiagram(id)}
      onMouseEnter={() => activateDiagram(id)}
    >
      <div className="mermaid-toolbar" aria-label="Visual reply controls">
        <span className="mermaid-label visual-title" title={title || undefined}>
          {title || "Visual reply"}
        </span>
        <button
          type="button"
          aria-pressed={!sourceShown}
          disabled={!page}
          onClick={() => setShowSource(false)}
        >
          Page
        </button>
        <button
          type="button"
          aria-pressed={sourceShown}
          onClick={() => setShowSource(true)}
        >
          HTML
        </button>
        <span className="mermaid-spacer" />
        {page && !sourceShown && (
          <>
            <ZoomControls
              zoom={zoom}
              noun="visual reply"
              onAction={(action) => run.current(action)}
            />
            <button
              type="button"
              className="mermaid-icon"
              aria-label="Expand visual reply"
              data-tip="Open full screen"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={14} />
            </button>
          </>
        )}
        <CopyButton text={source} label="Copy page HTML" />
      </div>
      {sourceShown ? (
        <>
          {!showSource && (
            <p className="mermaid-status" role="status">
              {status}
            </p>
          )}
          <pre className="mermaid-source">
            <code>{source}</code>
          </pre>
        </>
      ) : (
        page &&
        look && (
          <>
            <PageFrame
              key={page.doc}
              doc={page.doc}
              title={title}
              theme={look.theme}
              zoom={zoom}
              fill={false}
              fixed={fixed}
            />
            {page.missing.length > 0 && (
              <p className="mermaid-status" role="status">
                {host
                  ? "Images on the agent’s host can’t be read from this machine: "
                  : "These local images couldn’t be embedded: "}
                {page.missing.slice(0, 6).join(", ")}
                {page.missing.length > 6
                  ? ` and ${page.missing.length - 6} more`
                  : ""}
              </p>
            )}
          </>
        )
      )}
      {expanded && page && look && (
        <ExpandedPage
          doc={page.doc}
          title={title}
          look={look}
          zoom={zoom}
          onAction={(action) => run.current(action)}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

/** One sandboxed frame of the page: fitted to its content, or (`fill`) filling its box and scrolling inside. */
function PageFrame({
  doc,
  title,
  theme,
  zoom,
  fill,
  fixed,
}: {
  doc: string;
  title: string;
  theme: VisualTheme;
  zoom: number;
  fill: boolean;
  fixed: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [content, setContent] = useState<number>();
  const [loads, setLoads] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // The frame loads its document once. A second load is the page navigating itself somewhere else.
  const left = loads > 1;
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const el = frame.current;
      if (!el || e.source !== el.contentWindow) return;
      const height = readSize(e.data);
      if (height !== undefined) return setContent(height);
      const url = readLink(e.data);
      if (url !== undefined) {
        if (macApp()) postAppLink(url);
        else window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      // A focused frame keeps the keyboard: it hands back the app's own keys (⌘K, ⌘B, Esc).
      const key = readKey(e.data);
      if (key)
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            ...key,
            bubbles: true,
            cancelable: true,
          }),
        );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (loads > 0)
      frame.current?.contentWindow?.postMessage(themeMessage(theme), "*");
  }, [theme, loads]);
  if (left)
    return (
      <div className="visual-left" role="status">
        <p>This page tried to go to another address, so it was stopped.</p>
        <button
          type="button"
          onClick={() => {
            setLoads(0);
            setContent(undefined);
            setAttempt((n) => n + 1);
          }}
        >
          Show it again
        </button>
      </div>
    );
  const height = frameHeight(content, fixed);
  const box: CSSProperties = fill
    ? { flex: 1, minHeight: 0 }
    : { height: height * zoom };
  return (
    <div className="visual-frame" style={box}>
      <iframe
        key={attempt}
        ref={frame}
        title={title || "Visual reply"}
        // No allow-same-origin: the page gets an opaque origin, apart from the app.
        sandbox={
          macApp()
            ? "allow-scripts"
            : "allow-scripts allow-popups allow-popups-to-escape-sandbox"
        }
        referrerPolicy="no-referrer"
        srcDoc={doc}
        onLoad={() => setLoads((n) => n + 1)}
        style={{
          width: `${100 / zoom}%`,
          height: fill ? `${100 / zoom}%` : height,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
        }}
      />
    </div>
  );
}

function ExpandedPage({
  doc,
  title,
  look,
  zoom,
  onAction,
  onClose,
}: {
  doc: string;
  title: string;
  look: Look;
  zoom: number;
  onAction: (action: MermaidAction) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useFocusTrap(root, close);
  return createPortal(
    <div
      className="mermaid-overlay"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Visual reply: ${title}` : "Expanded visual reply"}
      style={look.style}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.nativeEvent.stopImmediatePropagation();
          onClose();
        }
      }}
    >
      <div className="mermaid-dialog visual-dialog">
        <div className="mermaid-toolbar">
          <strong className="visual-title">{title || "Visual reply"}</strong>
          <span className="mermaid-spacer" />
          <ZoomControls zoom={zoom} noun="visual reply" onAction={onAction} />
          <button
            ref={close}
            type="button"
            className="mermaid-icon"
            aria-label="Close expanded visual reply"
            data-tip="Close (Esc)"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <PageFrame
          doc={doc}
          title={title}
          theme={look.theme}
          zoom={zoom}
          fill
          fixed={false}
        />
      </div>
    </div>,
    document.body,
  );
}
