/**
 * The macOS app's screen capture send panel (`native/.../CaptureSend.swift` shows it over the app you were in, as
 * `capture.html?id=`): the capture's contact sheet, your message in the app's own composer (its /skills and @files are the
 * chosen target's folder's, as New agent's are; images pasted or dropped go too), and who gets it: an agent (sent from
 * here, `POST /api/captures/:id/send`, joining its current turn while it works) or a project, for a new agent, which the
 * app's window opens in New agent with the capture as its first message (`paseo:capture` in main).
 * Laid out in two columns: who gets it on the left (the search over your sessions, most recently active first, then a
 * new agent in each project), the capture and your message on the right. Copy (⇧⌘C) puts the whole message on the
 * clipboard instead (the draft's `copy=1`: the sheet and video named by their files, for any tool on this Mac).
 * Keys: Enter in the composer sends (as everywhere), ⌘↩ or Send from elsewhere in the panel (an empty message too: the
 * What you said while recording (the app heard it on this Mac) goes into the composer, once (`capture-tidied:<id>`): first
 * tidied by the host's metadata model (`POST /api/captures/:id/tidy`, in the chosen agent's workspace, else the first
 * agent's; "Generating transcript…" meanwhile), else as heard when that fails. The message then carries it, so the
 * capture's timed transcript stays out of what's sent (`transcript: false`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, readStore, removeStore, writeStore } from "../api";
import { Composer, type Outgoing } from "../Composer";
import { setAttachmentDraft, useAttachmentDraft } from "../composer/useAttachments";
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
  voice?: boolean;
  transcript?: { t: number; end: number; text: string }[];
  transcriptNote?: string;
};

type Post = { type: string; [key: string]: unknown };
type Handlers = { webkit?: { messageHandlers?: { paseoCapture?: { postMessage(message: unknown): void } } } };
const post = (message: Post) => (window as unknown as Handlers).webkit?.messageHandlers?.paseoCapture?.postMessage(message);

const INPUT = "capture-composer";

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
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(0);
  const [sending, setSending] = useState(false);
  /** A provider's first model on a host, for a project's skills (`host|provider`; "" when it has none). */
  const [firstModels, setFirstModels] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<{ title: string; agent: string }>();
  const [copied, setCopied] = useState(false);
  /** The transcript is being tidied; the text put into the composer. */
  const [generating, setGenerating] = useState(false);
  const [insert, setInsert] = useState<{ text: string; at: number } | null>(null);
  const tidyAsked = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  // The composer's draft, the panel's own (never an agent's), so it stays as the target changes.
  const owner = `capture:${id}`;
  const [attachments] = useAttachmentDraft(owner);
  const listBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Manifest>(`captures/${encodeURIComponent(id)}`).then(setManifest, (e) => setFailure(errorMessage(e) || "Couldn't read the capture."));
    Promise.all([list<Agent>("agents"), list<Project>("projects"), list<Workspace>("workspaces")]).then(
      ([agents, projects, workspaces]) => setTargets(captureTargets(agents.map(qualifyAgent), projects, workspaces)),
      (e) => setFailure(errorMessage(e) || "Couldn't read your agents."),
    );
  }, [id]);
  // The composer has the keyboard once it's usable (it waits for the capture's manifest).
  useEffect(() => {
    if (manifest) requestAnimationFrame(() => document.getElementById(INPUT)?.focus());
  }, [manifest]);

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

  // Sent or copied: it says so a moment, then goes.
  useEffect(() => {
    if (!sent && !copied) return;
    const t = setTimeout(() => post({ type: "close" }), sent ? 2500 : 1200);
    return () => clearTimeout(t);
  }, [sent, copied]);

  /** The whole message, as an agent on this Mac would read it, to the clipboard (the app's, else the browser's). */
  async function copy() {
    if (!manifest || sending) return;
    setFailure("");
    try {
      const query = new URLSearchParams({ message: readStore<string>(`draft:${owner}`, ""), copy: "1", ...(speaks ? { transcript: "0" } : {}) });
      const { prompt } = await api<{ prompt: string }>(`captures/${encodeURIComponent(id)}/draft?${query}`);
      if ((window as unknown as Handlers).webkit?.messageHandlers?.paseoCapture) post({ type: "copy", text: prompt });
      else await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch (e) {
      setFailure(errorMessage(e) || "Couldn't copy it.");
    }
  }

  /** The composer's message (its Enter), else what its draft holds now (Send, ⌘↩: an empty one too). */
  const speech = manifest?.transcript ?? [];
  const speaks = speech.length > 0;

  // What you said, into the composer once: tidied into the message you meant, in the chosen agent's workspace (else the
  // first agent's); as heard when it can't be.
  const tidySource = target?.kind === "agent" ? target.agent.id : targets?.find((t) => t.kind === "agent")?.agent.id;
  useEffect(() => {
    if (!speaks || !targets || tidyAsked.current || readStore(`capture-tidied:${id}`, false)) return;
    tidyAsked.current = true;
    const heard = speech.map((s) => s.text).join(" ");
    const put = (text: string) => {
      writeStore(`capture-tidied:${id}`, true);
      if (text.trim()) setInsert({ text, at: Date.now() });
    };
    if (!tidySource) return put(heard);
    setGenerating(true);
    api<{ text: string }>(`captures/${encodeURIComponent(id)}/tidy`, { agent: tidySource })
      .then(
        ({ text }) => put(text),
        (e) => {
          put(heard);
          setFailure(`Couldn’t tidy what you said (${errorMessage(e) || "the model didn't answer"}), so it’s in your message as heard.`);
        },
      )
      .finally(() => setGenerating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaks, !!targets, tidySource]);

  async function send(message?: Outgoing, to = target): Promise<boolean> {
    if (sending || sent || !manifest) return false;
    if (!to) {
      setFailure("Choose who gets it.");
      return false;
    }
    const text = message?.text ?? readStore<string>(`draft:${owner}`, "");
    const images = message?.images ?? attachments.flatMap((a) => (a.kind === "image" ? [{ data: a.dataUrl.split(",")[1], mimeType: a.mimeType, dataUrl: a.dataUrl }] : []));
    const files = message?.attachments ?? [];
    const done = () => {
      removeStore(`draft:${owner}`);
      setAttachmentDraft(owner, []);
    };
    if (to.kind === "project") {
      const p = to.project;
      post({
        type: "app",
        newAgent: { projectId: p.projectId, ...(p.host ? { host: p.host } : {}) },
        message: text,
        ...(images.length ? { images: images.map((i) => i.dataUrl) } : {}),
        ...(speaks ? { transcript: false } : {}),
      });
      done();
      return true;
    }
    setSending(true);
    setFailure("");
    try {
      await api(`captures/${encodeURIComponent(id)}/send`, {
        agent: to.agent.id,
        message: text,
        ...(images.length ? { images: images.map(({ data, mimeType }) => ({ data, mimeType })) } : {}),
        ...(files.length ? { attachments: files } : {}),
        ...(speaks ? { transcript: false } : {}),
        // A working agent gets it in its current turn rather than being stopped.
        ...(to.running ? { behavior: "steer" } : {}),
      });
      done();
      setSent({ title: to.title, agent: to.agent.id });
      return true;
    } catch (e) {
      setFailure(errorMessage(e) || "Couldn't send it.");
      return false;
    } finally {
      setSending(false);
    }
  }

  function step(by: number) {
    if (!shown.length) return;
    setChosen((c) => (Math.min(c, shown.length - 1) + by + shown.length) % shown.length);
  }

  function onKey(e: React.KeyboardEvent) {
    // What the composer took (its menus' Esc, its own Enter) stays its.
    if (e.defaultPrevented) return;
    const inComposer = !!(e.target as HTMLElement | null)?.closest?.(".composer-shell");
    if (e.key === "Escape") {
      e.preventDefault();
      post({ type: "close" });
    } else if (e.key.toLowerCase() === "c" && e.metaKey && e.shiftKey) {
      e.preventDefault();
      void copy();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !inComposer) {
      e.preventDefault();
      void send();
    }
  }
  // The chosen target's folder, for the composer's /skills and @files (as New agent's are, before an agent exists). The
  // daemon lists a folder's skills only for a model: an agent's own (its provider reads "claude/claude-opus-5-5"), else,
  // for a project, the provider's first, as New agent's Default does.
  const host = target?.kind === "agent" ? target.agent.host : target?.project.host;
  const [agentProvider, ...agentModel] = target?.kind === "agent" ? target.agent.provider.split("/") : [];
  const provider = agentProvider || "claude";
  const firstKey = `${host ?? ""}|${provider}`;
  const model = agentModel.join("/") || firstModels[firstKey];
  useEffect(() => {
    if (!target || agentModel.length || firstModels[firstKey] !== undefined) return;
    const controller = new AbortController();
    api<{ id: string }[]>(`providers/${encodeURIComponent(provider)}/models${host ? `?host=${encodeURIComponent(host)}` : ""}`, undefined, controller.signal)
      .then((rows) => setFirstModels((m) => ({ ...m, [firstKey]: (Array.isArray(rows) && rows[0]?.id) || "" })))
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, !!target, agentModel.length]);
  const source = target && model ? { cwd: target.kind === "agent" ? target.agent.cwd : target.project.path, provider, model } : undefined;

  // The message box says who gets it (Enter sends; ⌘↩ from elsewhere in the panel).
  const placeholder = !target
    ? "Choose who gets it on the left"
    : target.kind === "project"
      ? `Message a new agent in ${target.project.name}… (/ for skills, @ for files)`
      : `Message ${target.title}${target.running ? " (it's working: this joins its turn)" : ""}… (/ for skills, @ for files)`;

  const agents = shown.filter((t) => t.kind === "agent");
  const projects = shown.filter((t) => t.kind === "project");
  const row = (t: CaptureTarget) => {
    const i = shown.indexOf(t);
    const sub = t.kind === "agent" ? [t.running ? "Working" : "", t.place].filter(Boolean).join(" · ") : t.place;
    return (
      <div
        key={t.key}
        role="option"
        data-index={i}
        aria-selected={t === target}
        className={`cap-target${t === target ? " chosen" : ""}${t.kind === "project" ? " new" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setChosen(i)}
        onDoubleClick={() => void send(undefined, t)}
        title={t.title}
      >
        <span className={`cap-dot${t.kind === "agent" && t.running ? " running" : ""}${t.kind === "project" ? " plus" : ""}`} aria-hidden>
          {t.kind === "project" ? "+" : ""}
        </span>
        <span className="cap-target-text">
          <span className="cap-target-title">{t.kind === "project" ? t.project.name : t.title}</span>
          {sub && <span className="cap-target-place">{sub}</span>}
        </span>
      </div>
    );
  };

  return (
    <div className="cap" ref={root} onKeyDown={onKey}>
      <aside className="cap-side" aria-label="Who gets it">
        <div className="cap-side-inner">
          <input
            className="cap-search"
            placeholder="Search sessions and projects"
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
          <div className="cap-targets" id="cap-targets" role="listbox" ref={listBox} aria-label="Sessions and projects">
            {!targets && !failure && <div className="cap-empty">Reading your agents…</div>}
            {targets && !shown.length && <div className="cap-empty">Nothing matches “{query}”.</div>}
            {agents.length > 0 && <div className="cap-group">Sessions</div>}
            {agents.map(row)}
            {projects.length > 0 && <div className="cap-group">New agent in</div>}
            {projects.map(row)}
          </div>
        </div>
      </aside>
      <main className="cap-main">
        <header className="cap-head">
          <div className="cap-title">
            <strong>Send this capture</strong>
            {manifest && (
              <span className="cap-meta">
                {clock(manifest.duration)}
                {manifest.app ? ` · ${manifest.app}` : ""} · {manifest.frames.length} {manifest.frames.length === 1 ? "frame" : "frames"}
                {manifest.strokes ? ` · ${manifest.strokes} ${manifest.strokes === 1 ? "mark" : "marks"}` : ""}
                {manifest.voice ? " · voice" : ""}
              </span>
            )}
          </div>
          <button type="button" className="cap-quiet" onClick={() => post({ type: "reveal" })} title="Show the capture's files in Finder">
            Show in Finder
          </button>
          <button type="button" className="cap-quiet" disabled={!manifest || sending} onClick={() => void copy()} title="Copy the whole message, the capture's files named by path, to paste anywhere (⇧⌘C)">
            Copy
          </button>
          <button type="button" className="cap-close" onClick={() => post({ type: "close" })} aria-label="Close" title="Close (Esc)">
            ×
          </button>
        </header>
        {sent || copied ? (
          <div className="cap-sent" role="status">
            {copied ? (
              <span>Copied to the clipboard.</span>
            ) : (
              <>
                <span>Sent to {sent!.title}.</span>
                <button type="button" className="cap-quiet" onClick={() => post({ type: "app", open: sent!.agent })}>
                  Open the conversation
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <img className="cap-sheet" src={`/api/captures/${encodeURIComponent(id)}/sheet`} alt="The capture's keyframes" />
            {generating && (
              <div className="cap-status" role="status">
                <span className="cap-spinner" aria-hidden />
                Generating transcript…
              </div>
            )}
            {!speaks && manifest?.voice && manifest.transcriptNote && (
              <div className="cap-status">Your voice is in the video, without a transcript: {manifest.transcriptNote}.</div>
            )}
            <div className="cap-composer">
              <Composer
                draft={{ ...(source ? { source } : {}), ...(host ? { host } : {}), controls: null }}
                draftOwner={owner}
                inputId={INPUT}
                label="Message for the agent"
                placeholder={placeholder}
                running={false}
                disabled={!manifest || sending || !!sent}
                started={false}
                modes={[]}
                onSetMode={() => {}}
                onSend={(m) => send(m)}
                onCancel={async () => {}}
                onNotice={setFailure}
                onArchive={() => {}}
                onFreshDraft={() => {}}
                promptHistory={[]}
                dropFiles={null}
                insertText={insert}
              />
            </div>
            {failure && (
              <div className="cap-failure" role="alert">
                {failure}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
