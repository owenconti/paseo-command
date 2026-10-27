import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ExternalLink, ImageOff, LoaderCircle, Server, X } from "lucide-react";
import { useFocusTrap } from "./focus";
import { resolveImage } from "./imageSource";
import {
  FAIL_TEXT,
  ImageLoadError,
  LOCAL_BUDGET,
  REMOTE_BUDGET,
  loadImage,
  type Budget,
  type FailReason,
} from "./imageLoad";

type Shown = { url: string; alt: string; name: string; original?: string };

/**
 * An image referenced from agent Markdown: a thumbnail that opens a lightbox,
 * with loading and broken states. See resolveImage for what may load and
 * imageLoad for how.
 */
export function MarkdownImage({
  src,
  alt,
  host,
}: {
  src: string;
  alt: string;
  host?: string;
}) {
  const source = resolveImage(src, host);
  const label = alt.trim() || source.name || "image";
  if (source.kind === "elsewhere" || source.kind === "invalid")
    return (
      <span
        className="md-image notice"
        role="img"
        aria-label={`Image not available: ${label}`}
        aria-description={
          source.kind === "elsewhere"
            ? source.reason
            : "This image reference can't be displayed"
        }
      >
        {source.kind === "elsewhere" ? (
          <Server size={14} aria-hidden="true" />
        ) : (
          <ImageOff size={14} aria-hidden="true" />
        )}
        <span className="md-image-text">
          <span className="md-image-name">{label}</span>
          <small>
            {source.kind === "elsewhere"
              ? "Image on the agent's host"
              : "Image can't be shown"}
          </small>
        </span>
      </span>
    );
  return (
    // Keyed by source: a reply whose image URL changes starts afresh.
    <Thumbnail
      key={source.url}
      url={source.url}
      alt={alt.trim()}
      name={source.name}
      original={source.kind === "remote" ? source.url : undefined}
      budget={source.kind === "remote" ? REMOTE_BUDGET : LOCAL_BUDGET}
    />
  );
}

type Load =
  | { status: "waiting" | "loading" }
  | { status: "ready"; src: string }
  | { status: "broken"; reason: FailReason };

export function Thumbnail({
  url,
  alt,
  name,
  original,
  budget,
}: {
  url: string;
  alt: string;
  name: string;
  original?: string;
  budget: Budget;
}) {
  const [load, setLoad] = useState<Load>({ status: "waiting" });
  const [open, setOpen] = useState(false);
  const placeholder = useRef<HTMLElement>(null);
  const label = alt || name || "image";

  // Fetch only once the thumbnail is near the viewport.
  useEffect(() => {
    if (load.status !== "waiting") return;
    const el = placeholder.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setLoad({ status: "loading" });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setLoad({ status: "loading" });
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load.status]);

  const loading = load.status === "loading";
  useEffect(() => {
    if (!loading) return;
    const controller = new AbortController();
    loadImage(url, budget, controller.signal).then(
      ({ blob }) => {
        // A stale result (source changed, unmounted) is dropped unused.
        if (controller.signal.aborted) return;
        setLoad({ status: "ready", src: URL.createObjectURL(blob) });
      },
      (e) => {
        if (controller.signal.aborted) return;
        setLoad({
          status: "broken",
          reason: e instanceof ImageLoadError ? e.reason : "network",
        });
      },
    );
    return () => controller.abort();
  }, [loading, url, budget]);
  // The blob outlives the "loading" effect; revoke it when it's replaced.
  const ready = load.status === "ready" ? load.src : "";
  useEffect(
    () => () => {
      if (ready) URL.revokeObjectURL(ready);
    },
    [ready],
  );

  if (load.status === "broken")
    return (
      <span
        className="md-image notice broken"
        role="img"
        aria-label={`Image failed to load: ${label}. ${FAIL_TEXT[load.reason]}`}
        aria-description={original || name}
      >
        <ImageOff size={14} aria-hidden="true" />
        <span className="md-image-text">
          <span className="md-image-name">{label}</span>
          <small>{FAIL_TEXT[load.reason]}</small>
        </span>
      </span>
    );
  if (load.status !== "ready")
    return (
      <span
        ref={placeholder}
        className="md-image thumb loading"
        role="img"
        aria-label={`Loading image: ${label}`}
        aria-busy="true"
        aria-description={alt || name}
      >
        <LoaderCircle size={16} className="spinning" aria-hidden="true" />
      </span>
    );
  return (
    <>
      <button
        type="button"
        className="md-image thumb ready"
        onClick={() => setOpen(true)}
        aria-label={`View image: ${label}`}
        aria-haspopup="dialog"
        data-tip={alt || name}
      >
        <img
          src={load.src}
          alt={alt}
          decoding="async"
          // Header said raster, but the decoder may still refuse it.
          onError={(e) => {
            if (e.currentTarget.src === load.src)
              setLoad({ status: "broken", reason: "not-an-image" });
          }}
        />
      </button>
      {open && (
        <Lightbox
          shown={{ url: load.src, alt, name, original: original || url }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function Lightbox({
  shown,
  onClose,
}: {
  shown: Shown;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [broken, setBroken] = useState(false);
  useFocusTrap(ref, close);
  const label = shown.alt || shown.name || "Image";
  return createPortal(
    <motion.div
      ref={ref}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      // Portalled, but React events still bubble to the thumbnail's ancestors.
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== "Escape") return;
        e.nativeEvent.stopImmediatePropagation();
        onClose();
      }}
    >
      <figure onClick={(e) => e.stopPropagation()}>
        {broken ? (
          <span className="lightbox-broken">
            <ImageOff size={22} aria-hidden="true" />
            Couldn't load image
          </span>
        ) : (
          <img
            src={shown.url}
            alt={shown.alt}
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        )}
        {(shown.alt || shown.name) && (
          <figcaption>{shown.alt || shown.name}</figcaption>
        )}
      </figure>
      <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
        {/* Browsers refuse to open data: URLs as pages. */}
        {!(shown.original || shown.url).startsWith("data:") && (
          <a
            href={shown.original || shown.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open image in a new tab"
            data-tip="Open in a new tab"
          >
            <ExternalLink size={16} />
          </a>
        )}
        <button
          ref={close}
          type="button"
          aria-label="Close image"
          data-tip="Close (Esc)"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
    </motion.div>,
    document.body,
  );
}
