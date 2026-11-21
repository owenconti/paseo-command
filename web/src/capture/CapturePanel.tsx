/**
 * The macOS app's screen capture send panel (`native/.../CaptureSend.swift` shows it over the app you were in, as
 * `capture.html?id=`): the capture's contact sheet, your message, and who gets it: an agent (sent from here,
 * `POST /api/captures/:id/send`, joining its current turn while it works) or a project, for a new agent, which the
 * app's window opens in New agent with the capture as its first message (`paseo:capture` in main).
 * Keys: ⌘↩ sends, ↑/↓ choose (from the search, or the message box's last line), Esc closes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { read } from "../live";
import { qualifyAgent } from "../agentIdentity";
import type { Agent, Project, Workspace } from "../types";
import { captureTargets, filterTargets, type CaptureTarget } from "./targets";

type Manifest = {
  id: string;
  duration: number;
  app?: string;
  frames: { n: number }[];
  strokes: number;
  clicks: number;
};

type Post = { type: string; [key: string]: unknown };
type Handlers = { webkit?: { messageHandlers?: { paseoCapture?: { postMessage(message: unknown): void } } } };
const post = (message: Post) => (window as unknown as Handlers).webkit?.messageHandlers?.paseoCapture?.postMessage(message);

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const list = async <T,>(resource: string): Promise<T[]> => {
  const { value } = await read(resource);
  return Array.isArray(value) ? (value as T[]) : [];
};

export function CapturePanel({ id }: { id: string }) {
  const [manifest, setManifest] = useState<Manifest>();
  const [failure, setFailure] = useState("");
  const [targets, setTargets] = useState<CaptureTarget[]>();
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(0);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ title: string; agent: string }>();
  const root = useRef<HTMLDivElement>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);
  const listBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Manifest>(`captures/${encodeURIComponent(id)}`).then(setManifest, (e) => setFailure(errorMessage(e) || "Couldn't read the capture."));
    Promise.all([list<Agent>("agents"), list<Project>("projects"), list<Workspace>("workspaces")]).then(
      ([agents, projects, workspaces]) => setTargets(captureTargets(agents.map(qualifyAgent), projects, workspaces)),
      (e) => setFailure(errorMessage(e) || "Couldn't read your agents."),
    );
    messageBox.current?.focus();
  }, [id]);

  // The panel is as tall as the page.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => post({ type: "size", height: Math.ceil(el.getBoundingClientRect().height) }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const shown = useMemo(() => filterTargets(targets ?? [], query), [targets, query]);
  const target = shown[Math.min(chosen, shown.length - 1)];
  useEffect(() => setChosen(0), [query]);
  useEffect(() => {
    listBox.current?.querySelector(`[data-index="${chosen}"]`)?.scrollIntoView({ block: "nearest" });
  }, [chosen]);

  // Sent: it says so a moment, then goes.
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => post({ type: "close" }), 2500);
    return () => clearTimeout(t);
  }, [sent]);

  async function send(to = target) {
    if (!to || sending || sent || !manifest) return;
    if (to.kind === "project") {
      const p = to.project;
      return post({ type: "app", newAgent: { projectId: p.projectId, ...(p.host ? { host: p.host } : {}) }, message });
    }
    setSending(true);
    setFailure("");
    try {
      await api(`captures/${encodeURIComponent(id)}/send`, {
        agent: to.agent.id,
        message,
        // A working agent gets it in its current turn rather than being stopped.
        ...(to.running ? { behavior: "steer" } : {}),
      });
      setSent({ title: to.title, agent: to.agent.id });
    } catch (e) {
      setFailure(errorMessage(e) || "Couldn't send it.");
    } finally {
      setSending(false);
    }
  }

  function step(by: number) {
    if (!shown.length) return;
    setChosen((c) => (Math.min(c, shown.length - 1) + by + shown.length) % shown.length);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      post({ type: "close" });
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  const label =
    !target ? "Send" : target.kind === "project" ? `Start an agent in ${target.project.name}` : `Send to ${target.title}`;

  return (
    <div className="cap" ref={root} onKeyDown={onKey}>
      <header className="cap-head">
        <div className="cap-title">
          <strong>Send this capture</strong>
          {manifest && (
            <span className="cap-meta">
              {clock(manifest.duration)}
              {manifest.app ? ` · ${manifest.app}` : ""} · {manifest.frames.length} {manifest.frames.length === 1 ? "frame" : "frames"}
              {manifest.strokes ? ` · ${manifest.strokes} ${manifest.strokes === 1 ? "mark" : "marks"}` : ""}
            </span>
          )}
        </div>
        <button type="button" className="cap-quiet" onClick={() => post({ type: "reveal" })} title="Show the capture's files in Finder">
          Show in Finder
        </button>
        <button type="button" className="cap-close" onClick={() => post({ type: "close" })} aria-label="Close" title="Close (Esc)">
          ×
        </button>
      </header>
      {sent ? (
        <div className="cap-sent" role="status">
          <span>Sent to {sent.title}.</span>
          <button type="button" className="cap-quiet" onClick={() => post({ type: "app", open: sent.agent })}>
            Open the conversation
          </button>
        </div>
      ) : (
        <>
          <img className="cap-sheet" src={`/api/captures/${encodeURIComponent(id)}/sheet`} alt="The capture's keyframes" />
          <textarea
            ref={messageBox}
            className="cap-message"
            rows={3}
            placeholder="What should the agent do? (optional)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-label="Message"
          />
          <input
            className="cap-search"
            placeholder="Send to… (search agents and projects)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                step(e.key === "ArrowDown" ? 1 : -1);
              } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                void send();
              }
            }}
            aria-label="Search agents and projects"
            aria-controls="cap-targets"
          />
          <div className="cap-targets" id="cap-targets" role="listbox" ref={listBox} aria-label="Who gets it">
            {!targets && !failure && <div className="cap-empty">Reading your agents…</div>}
            {targets && !shown.length && <div className="cap-empty">Nothing matches “{query}”.</div>}
            {shown.map((t, i) => (
              <div
                key={t.key}
                role="option"
                data-index={i}
                aria-selected={t === target}
                className={`cap-target${t === target ? " chosen" : ""}${t.kind === "project" ? " new" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setChosen(i)}
                onDoubleClick={() => void send(t)}
              >
                <span className={`cap-dot${t.kind === "agent" && t.running ? " running" : ""}${t.kind === "project" ? " plus" : ""}`} aria-hidden>
                  {t.kind === "project" ? "+" : ""}
                </span>
                <span className="cap-target-title">{t.title}</span>
                <span className="cap-target-place">
                  {t.kind === "agent" && t.running ? "Working" : ""}
                  {t.kind === "agent" && t.running && t.place ? " · " : ""}
                  {t.place}
                </span>
              </div>
            ))}
          </div>
          {failure && (
            <div className="cap-failure" role="alert">
              {failure}
            </div>
          )}
          <footer className="cap-foot">
            <span className="cap-hint">
              {target?.kind === "agent" && target.running
                ? "It's working: your message joins its current turn."
                : target?.kind === "project"
                  ? "Opens New agent in Paseo Command with this as its first message."
                  : "The contact sheet goes as an image; agents on this Mac also get the video and frames."}
            </span>
            <button type="button" className="cap-send" disabled={!target || sending || !manifest} onClick={() => void send()}>
              {sending ? "Sending…" : label} <kbd>⌘↩</kbd>
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
