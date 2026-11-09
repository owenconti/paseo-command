import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { CopyButton } from "../CodeCopyButton";
import { useFocusTrap } from "../focus";
import {
  activateDiagram,
  registerDiagram,
  removeDiagram,
  type MermaidAction,
} from "../mermaidCommands";
import {
  renderDiagram,
  type DiagramPalette,
  type RenderedDiagram,
} from "./render";

type Theme = { palette: DiagramPalette; style: CSSProperties };
const MIN_ZOOM = 0.25,
  MAX_ZOOM = 4;
function themeOf(el: HTMLElement): Theme {
  const style = getComputedStyle(el),
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const c = canvas.getContext("2d")!;
  const hex = (token: string) => {
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = style.getPropertyValue("--panel");
    c.fillRect(0, 0, 1, 1);
    c.fillStyle = style.getPropertyValue(token);
    c.fillRect(0, 0, 1, 1);
    return (
      "#" +
      [...c.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")
    );
  };
  const tokens = [
    "--panel",
    "--panel-2",
    "--surface",
    "--fill",
    "--fill-strong",
    "--line",
    "--line-mid",
    "--line-strong",
    "--text",
    "--text-2",
    "--text-3",
    "--accent",
    "--accent-text",
    "--focus",
    "--code-bg",
    "--code-text",
    "--scrollbar",
    "--selection",
  ];
  return {
    palette: {
      background: hex("--panel"),
      fill: hex("--fill-strong"),
      text: hex("--text"),
      line: hex("--text-2"),
      accent: hex("--accent-text"),
      note: hex("--amber-soft"),
      noteText: hex("--amber-text"),
      // System fonts remain available inside the isolated SVG image document too.
      font: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    },
    style: {
      ...Object.fromEntries(tokens.map((t) => [t, style.getPropertyValue(t)])),
      fontFamily: style.fontFamily,
      colorScheme: style.colorScheme,
    } as CSSProperties,
  };
}

export function MermaidBlock({
  source,
  pending,
}: {
  source: string;
  pending: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false),
    [visible, setVisible] = useState(false);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [result, setResult] = useState<{
    source: string;
    palette: DiagramPalette;
    diagram?: RenderedDiagram;
    error?: string;
  } | null>(null);
  const [showSource, setShowSource] = useState(false),
    [expanded, setExpanded] = useState(false),
    [zoom, setZoom] = useState(1);
  const run = useRef<(action: MermaidAction) => void>(() => {});
  const matching = result?.source === source ? result : null;
  const current = matching?.palette === theme?.palette ? matching : null;
  const diagram = current?.diagram ?? matching?.diagram;
  const sourceShown = showSource || !diagram;
  useEffect(() => {
    const el = root.current!;
    const observer = new IntersectionObserver(
      (entries) => {
        const inView = entries.some((e) => e.isIntersecting);
        setVisible(inView);
        if (inView) setNear(true);
      },
      { rootMargin: "0px" },
    );
    observer.observe(el);
    const refresh = () => {
      const next = themeOf(el);
      setTheme((old) =>
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
  useEffect(() => {
    if (!near || !theme || pending || !source.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      renderDiagram(source, theme.palette, controller.signal).then(
        (diagram) => {
          if (!controller.signal.aborted)
            setResult({ source, palette: theme.palette, diagram });
        },
        () => {
          if (!controller.signal.aborted)
            setResult({
              source,
              palette: theme.palette,
              error:
                "This diagram couldn't be rendered. You can read or copy its source below.",
            });
        },
      );
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, pending, near, theme]);
  useEffect(() => {
    setZoom(1);
  }, [source]);
  useEffect(() => {
    setExpanded(false);
  }, [source]);
  run.current = (action) => {
    switch (action) {
      case "source":
        if (diagram) setShowSource((v) => !v);
        break;
      case "copy":
        root.current?.querySelector<HTMLButtonElement>(".md-copy")?.click();
        break;
      case "expand":
        if (diagram) setExpanded(true);
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
        ready: !!diagram,
        source: sourceShown,
        expanded,
        zoom,
        run: (action) => run.current(action),
      });
  }, [id, visible, diagram, sourceShown, expanded, zoom]);
  return (
    <div
      ref={root}
      className="mermaid-block"
      data-mermaid={id}
      onFocusCapture={() => activateDiagram(id)}
      onMouseEnter={() => activateDiagram(id)}
    >
      <div className="mermaid-toolbar" aria-label="Mermaid diagram controls">
        <span className="mermaid-label">Mermaid</span>
        <button
          type="button"
          aria-pressed={!sourceShown}
          disabled={!diagram}
          onClick={() => setShowSource(false)}
        >
          Diagram
        </button>
        <button
          type="button"
          aria-pressed={sourceShown}
          onClick={() => setShowSource(true)}
        >
          Source
        </button>
        <span className="mermaid-spacer" />
        {diagram && !sourceShown && (
          <>
            <ZoomControls
              zoom={zoom}
              onAction={(action) => run.current(action)}
            />
            <button
              type="button"
              className="mermaid-icon"
              aria-label="Expand Mermaid diagram"
              data-tip="Expand diagram"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={14} />
            </button>
          </>
        )}
        <CopyButton text={source} label="Copy Mermaid source" />
      </div>
      {sourceShown ? (
        <>
          {!showSource && (
            <p className="mermaid-status" role="status">
              {pending
                ? "The diagram will appear when this code block finishes."
                : (current?.error ??
                  (source.trim()
                    ? "Rendering diagram…"
                    : "Waiting for diagram content…"))}
            </p>
          )}
          <pre className="mermaid-source">
            <code>{source}</code>
          </pre>
        </>
      ) : (
        diagram && <DiagramImage diagram={diagram} zoom={zoom} />
      )}
      {expanded && diagram && theme && (
        <ExpandedDiagram
          diagram={diagram}
          theme={theme}
          zoom={zoom}
          onAction={(action) => run.current(action)}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

function ZoomControls({
  zoom,
  onAction,
}: {
  zoom: number;
  onAction: (action: MermaidAction) => void;
}) {
  return (
    <div className="mermaid-zoom">
      <button
        type="button"
        className="mermaid-icon"
        aria-label="Zoom out of Mermaid diagram"
        data-tip="Zoom out"
        disabled={zoom <= MIN_ZOOM}
        onClick={() => onAction("out")}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="mermaid-icon"
        aria-label="Reset Mermaid diagram zoom"
        data-tip="Reset zoom"
        onClick={() => onAction("fit")}
      >
        <RotateCcw size={14} />
      </button>
      <button
        type="button"
        className="mermaid-icon"
        aria-label="Zoom in on Mermaid diagram"
        data-tip="Zoom in"
        disabled={zoom >= MAX_ZOOM}
        onClick={() => onAction("in")}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function DiagramImage({
  diagram,
  zoom,
}: {
  diagram: RenderedDiagram;
  zoom: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600),
    [url, setUrl] = useState("");
  useEffect(() => {
    const blob = URL.createObjectURL(
      new Blob([diagram.svg], { type: "image/svg+xml" }),
    );
    setUrl(blob);
    return () => URL.revokeObjectURL(blob);
  }, [diagram]);
  useEffect(() => {
    const el = viewport.current!,
      observer = new ResizeObserver(() => setWidth(el.clientWidth - 24));
    observer.observe(el);
    setWidth(el.clientWidth - 24);
    return () => observer.disconnect();
  }, []);
  // Shrink to fit, but retain a readable minimum; large charts scroll rather than becoming tiny text.
  const scale =
    Math.min(1, Math.max(0.65, Math.max(1, width) / diagram.width)) * zoom;
  return (
    <div
      ref={viewport}
      className="mermaid-viewport"
      tabIndex={0}
      role="region"
      aria-label="Mermaid diagram. Scroll to see more."
    >
      {url && (
        <img
          className="mermaid-image"
          src={url}
          alt={diagram.label}
          aria-description={diagram.description}
          draggable={false}
          style={{
            width: diagram.width * scale,
            height: diagram.height * scale,
          }}
        />
      )}
    </div>
  );
}

function ExpandedDiagram({
  diagram,
  theme,
  zoom,
  onAction,
  onClose,
}: {
  diagram: RenderedDiagram;
  theme: Theme;
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
      aria-label="Expanded Mermaid diagram"
      style={theme.style}
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
      <div className="mermaid-dialog">
        <div className="mermaid-toolbar">
          <strong>Mermaid diagram</strong>
          <span className="mermaid-spacer" />
          <ZoomControls zoom={zoom} onAction={onAction} />
          <button
            ref={close}
            type="button"
            className="mermaid-icon"
            aria-label="Close expanded diagram"
            data-tip="Close (Esc)"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <DiagramImage diagram={diagram} zoom={zoom} />
      </div>
    </div>,
    document.body,
  );
}
