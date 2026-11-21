/**
 * The macOS app's screen capture send panel (`native/.../CaptureSend.swift` shows it over the app you were in, as
 * `capture.html?id=`): the capture's contact sheet, your message in the app's own composer (its /skills and @files are the
 * chosen target's folder's, as New agent's are; images pasted or dropped go too), and who gets it: an agent (sent from
 * here, `POST /api/captures/:id/send`, joining its current turn while it works) or a project, for a new agent, which the
 * app's window opens in New agent with the capture as its first message (`paseo:capture` in main).
 * Keys: Enter in the composer sends (as everywhere), ⌘↩ or Send from elsewhere in the panel (an empty message too: the
 * capture is the message), ↑/↓ choose in the search, Esc closes. What you said while recording (the app heard it on this
 * Mac) shows under the sheet; the host's metadata model tidies it (`POST /api/captures/:id/tidy`, in the chosen agent's
 * workspace, else the first agent's) into the message you meant, which goes into the composer once (`capture-tidied:<id>`),
 * and the timed transcript then goes along only when "Send the timed transcript too" is on.
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
  /** Whether the timed transcript goes with it (on until the tidied one is in the message). */
  const [withSpeech, setWithSpeech] = useState(() => !readStore(`capture-tidied:${id}`, false));
  /** The tidied transcript's progress, and the text put into the composer. */
  const [tidy, setTidy] = useState<{ state: "working" | "done" | "failed" | "empty"; error?: string }>();
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

  // Sent: it says so a moment, then goes.
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => post({ type: "close" }), 2500);
    return () => clearTimeout(t);
  }, [sent]);

  /** The composer's message (its Enter), else what its draft holds now (Send, ⌘↩: an empty one too). */
  const speech = manifest?.transcript ?? [];
  const speaks = speech.length > 0;

  // What you said, tidied once into the message you meant, in the chosen agent's workspace (else the first agent's).
  const tidySource = target?.kind === "agent" ? target.agent.id : targets?.find((t) => t.kind === "agent")?.agent.id;
  function tidyUp(agent = tidySource) {
    if (!agent) return;
    tidyAsked.current = true;
    setTidy({ state: "working" });
    api<{ text: string }>(`captures/${encodeURIComponent(id)}/tidy`, { agent }).then(
      ({ text }) => {
        writeStore(`capture-tidied:${id}`, true);
        if (!text.trim()) return setTidy({ state: "empty" });
        setInsert({ text, at: Date.now() });
        setWithSpeech(false);
        setTidy({ state: "done" });
      },
      (e) => setTidy({ state: "failed", error: errorMessage(e) || "the model didn't answer" }),
    );
  }
  useEffect(() => {
    if (!speaks || tidyAsked.current || !tidySource || readStore(`capture-tidied:${id}`, false)) return;
    tidyUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaks, tidySource]);

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
        ...(speaks && !withSpeech ? { transcript: false } : {}),
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
        ...(speaks && !withSpeech ? { transcript: false } : {}),
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
              {manifest.voice ? " · with your voice" : ""}
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
          {speaks ? (
            <section className={`cap-speech${withSpeech ? "" : " left-out"}`} aria-label="What you said">
              <div className="cap-speech-head">
                <span>What you said</span>
                <span className="cap-speech-tidy" role="status">
                  {tidy?.state === "working"
                    ? "Tidying it into your message…"
                    : tidy?.state === "done"
                      ? "Tidied into your message"
                      : tidy?.state === "empty"
                        ? "Nothing in it was for the agent"
                        : null}
                  {tidy?.state === "failed" && (
                    <>
                      Couldn’t tidy it: {tidy.error}.{" "}
                      <button type="button" className="cap-link" onClick={() => tidyUp()}>
                        Try again
                      </button>
                    </>
                  )}
                </span>
                <label className="cap-speech-toggle" title="Whether the agent also reads what you said word for word, with the time of each sentence">
                  <input type="checkbox" checked={withSpeech} onChange={(e) => setWithSpeech(e.target.checked)} />
                  Send the timed transcript too
                </label>
              </div>
              <ol className="cap-speech-lines">
                {speech.map((s, i) => (
                  <li key={i}>
                    <span className="cap-speech-time">{clock(s.t)}</span>
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : manifest?.voice && manifest.transcriptNote ? (
            <div className="cap-speech-note">Your voice is in the video, without a transcript: {manifest.transcriptNote}.</div>
          ) : null}
          <div className="cap-composer">
            <Composer
              draft={{ ...(source ? { source } : {}), ...(host ? { host } : {}), controls: null }}
              draftOwner={owner}
              inputId={INPUT}
              label="Message for the agent"
              placeholder="What should the agent do? (optional: / for skills, @ for files)"
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
                onDoubleClick={() => void send(undefined, t)}
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
