import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fromTimeline, type TimelineItem } from "../transcript";
import { exchangeOf } from "../worldChat/script";
import type { AgentTray } from "./model";
const previews = new Map<string, string>();
/** Read-only snippets, requested only as a row enters the open tray. Reading a timeline never marks the agent read. */
export function AgentPreview({
  id,
  host,
  version,
  tray,
  fallback,
}: {
  id: string;
  host?: string;
  version: string;
  tray: AgentTray;
  fallback: string;
}) {
  const key = `${host ?? "local"}:${id}:${version}:${tray}`;
  const [text, setText] = useState(() => previews.get(key));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    setText(previews.get(key));
    if (previews.has(key)) return;
    const controller = new AbortController();
    const read = () => {
      const q = new URLSearchParams({ limit: "40", ...(host ? { host } : {}) });
      void api<{ items?: TimelineItem[] }>(
        `agents/${encodeURIComponent(id)}/timeline?${q}`,
        undefined,
        controller.signal,
      ).then(
        (t) => {
          if (controller.signal.aborted || !Array.isArray(t.items)) return;
          const x = exchangeOf(fromTimeline(t.items));
          const value =
            tray === "failures"
              ? x.failure
              : tray === "running"
                ? x.doing
                : x.reply?.text;
          if (!value) return;
          const snippet = value.replace(/\s+/g, " ").trim().slice(0, 240);
          previews.set(key, snippet);
          if (previews.size > 256)
            previews.delete(previews.keys().next().value!);
          setText(snippet);
        },
        () => {},
      );
    };
    if (typeof IntersectionObserver === "undefined") {
      read();
      return () => controller.abort();
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        read();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [key, id, host, tray]);
  return (
    <span className="dh-preview" ref={ref}>
      {text || fallback}
    </span>
  );
}
