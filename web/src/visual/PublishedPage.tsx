import { useEffect, useState } from "react";
import { api } from "../api";
import { VisualBlock } from "./VisualBlock";

/*
 * A visual reply an agent published with its `html_render` tool (the
 * visual-replies Paseo plugin on its host). The timeline carries only the
 * page's id and title; its HTML is read from the plugin here, once, when the
 * page is drawn, and shown as a fenced one is (VisualBlock).
 */
type Page = { id: string; title: string; html: string };
const pages = new Map<string, Promise<Page>>();
const KEPT = 12;

function readPage(id: string, host: string | undefined, signal?: AbortSignal) {
  const key = `${host ?? ""}|${id}`;
  let page = pages.get(key);
  if (!page) {
    const q = new URLSearchParams({ id, ...(host ? { host } : {}) });
    page = api<Page>(`visual?${q}`, undefined, signal);
    pages.set(key, page);
    // A failed read is asked again next time.
    page.catch(() => pages.delete(key));
    if (pages.size > KEPT) pages.delete(pages.keys().next().value!);
  }
  return page;
}
export function resetPublishedPages() {
  pages.clear();
}

export function PublishedPage({
  page,
  title,
  host,
}: {
  page: string;
  title: string;
  host?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    { html: string } | { error: string } | null
  >(null);
  useEffect(() => {
    let gone = false;
    setState(null);
    readPage(page, host).then(
      (p) => {
        if (!gone) setState({ html: p.html });
      },
      (e) => {
        if (!gone)
          setState({
            error: e instanceof Error && e.message ? e.message : "The page couldn’t be read.",
          });
      },
    );
    return () => {
      gone = true;
    };
  }, [page, host, attempt]);
  if (state && "html" in state)
    return (
      <VisualBlock
        source={state.html}
        title={title}
        pending={false}
        host={host}
        prepared
      />
    );
  return (
    <div className="mermaid-block visual-block" data-visual-page={page}>
      <div className="mermaid-toolbar">
        <span className="mermaid-label visual-title">{title}</span>
      </div>
      {state ? (
        <div className="visual-left" role="status">
          <p>This page couldn’t be shown: {state.error}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <p className="mermaid-status" role="status">
          Loading the page…
        </p>
      )}
    </div>
  );
}
