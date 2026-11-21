/**
 * The macOS app's screen capture send panel (`native/.../CaptureSend.swift` shows it over the app you were in, as
 * `capture.html?id=`): the capture's contact sheet, your message in the app's own composer (its /skills and @files are the
 * chosen target's folder's, as New agent's are; images pasted or dropped go too), and who gets it: an agent (sent from
 * here, `POST /api/captures/:id/send`, joining its current turn while it works) or a project, for a new agent, which the
 * app's window opens in New agent with the capture as its first message (`paseo:capture` in main).
 * Laid out in two columns: who gets it on the left, in two levels (the user's ask): your workspaces, the most recently
 * active first, then a new workspace (a worktree) in each project; a workspace opens to its agents and a new agent there,
 * ← (or Backspace in an empty search) going back. It opens on what is open in the app's window (`openPlace`: its agent,
 * or a workspace's latest agent), else the most recently active workspace's latest agent, so a capture can go at once; the capture and your message on the right. Copy (⇧⌘C) puts the whole message on the
 * clipboard instead (the draft's `copy=1`: the sheet and video named by their files, for any tool on this Mac).
 * Keys: Enter in the composer sends (as everywhere), ⌘↩ or Send from elsewhere in the panel (an empty message too: the
 * What you said while recording (the app heard it on this Mac) goes into the composer, once (`capture-tidied:<id>`): first
 * tidied, by the Mac's on-device model as the capture is made (the manifest's `tidied`), else by the host's metadata model (`POST /api/captures/:id/tidy`, in the chosen agent's workspace, else the first
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
import { workspaceKey } from "../workspaces";
import { openPlace } from "./appCapture";
import { captureTargets, filterGroups, filterTargets, groupTargets, type CaptureGroup, type CaptureTarget } from "./targets";

/** A row of the left column: a workspace to open (the first list), or someone to send to. */
type Item = { kind: "group"; key: string; group: CaptureGroup } | { kind: "target"; key: string; target: CaptureTarget };

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
  /** Tidied on the Mac by its on-device model (Apple Intelligence): used as it is, no helper asked. */
  tidied?: string;
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
  /** Sent: the panel goes at once (the user's ask); until it's gone nothing sends again. */
  const [sent, setSent] = useState(false);
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

  const grouped = useMemo(() => groupTargets(targets ?? []), [targets]);
  /** The workspace open in the left column (its agents), else the list of workspaces. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const group = openGroup ? grouped.groups.find((g) => g.key === openGroup) : undefined;
  const shown: Item[] = useMemo(() => {
    const asTarget = (t: CaptureTarget): Item => ({ kind: "target", key: t.key, target: t });
    if (group) return [...filterTargets(group.agents, query), ...(group.newAgent ? [group.newAgent] : [])].map(asTarget);
    return [
      ...filterGroups(grouped.groups, query).map((g): Item => ({ kind: "group", key: g.key, group: g })),
      ...filterTargets(grouped.projects, query).map(asTarget),
    ];
  }, [grouped, group, query]);
  const item = shown[Math.min(chosen, shown.length - 1)];
  const target = item?.kind === "target" ? item.target : undefined;
  // First, what is open in the app's window (its agent, chosen in its workspace; a workspace, its latest agent), else
  // the most recently active workspace's latest agent: a capture can go at once.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !targets) return;
    placed.current = true;
    const open = openPlace();
    if (open?.type === "agent") {
      const g = grouped.groups.find((x) => x.agents.some((a) => a.agent.id === open.id));
      if (g) {
        setOpenGroup(g.key);
        return setChosen(g.agents.findIndex((a) => a.agent.id === open.id));
      }
    }
    if (open?.type === "workspace") {
      const g = grouped.groups.find((x) => x.newAgent && workspaceKey(x.newAgent.workspace) === open.id);
      if (g) {
        setOpenGroup(g.key);
        return setChosen(0);
      }
    }
    const first = grouped.groups.find((g) => g.agents.length);
    if (first) setOpenGroup(first.key);
    setChosen(0);
  }, [targets, grouped]);
  const search = (value: string) => {
    setQuery(value);
    setChosen(0);
  };
  const openWorkspace = (g: CaptureGroup) => {
    setOpenGroup(g.key);
    setQuery("");
    setChosen(0);
  };
  const back = () => {
    const from = openGroup;
    setOpenGroup(null);
    setQuery("");
    setChosen(Math.max(0, grouped.groups.findIndex((g) => g.key === from)));
  };
  const pick = (it: Item | undefined) => (it?.kind === "group" ? openWorkspace(it.group) : void send());
  useEffect(() => {
    listBox.current?.querySelector(`[data-index="${chosen}"]`)?.scrollIntoView({ block: "nearest" });
  }, [chosen]);

  // Sent or copied: it says so a moment, then goes.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => post({ type: "close" }), 1200);
    return () => clearTimeout(t);
  }, [copied]);

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
    // The Mac tidied it already (its on-device model, about half a second): that, without asking a helper.
    if (manifest?.tidied !== undefined) return put(manifest.tidied);
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
    if (to.kind !== "agent") {
      // A new agent: in a workspace as it is, or in a new workspace (a worktree) of a project, opened in the app's window.
      const newAgent =
        to.kind === "workspace"
          ? { workspaceId: to.workspace.workspaceId, ...(to.workspace.host ? { host: to.workspace.host } : {}) }
          : { projectId: to.project.projectId, ...(to.project.host ? { host: to.project.host } : {}), isolation: "worktree" };
      post({
        type: "app",
        newAgent,
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
      setSent(true);
      post({ type: "close" });
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
  const host = target?.kind === "agent" ? target.agent.host : target?.kind === "workspace" ? target.workspace.host : target?.project.host;
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
  const cwd = target?.kind === "agent" ? target.agent.cwd : target?.kind === "workspace" ? target.workspace.cwd : target?.project.path;
  const source = target && model && cwd ? { cwd, provider, model } : undefined;

  // The message box says who gets it (Enter sends; ⌘↩ from elsewhere in the panel).
  const placeholder = !target
    ? item?.kind === "group"
      ? `Open ${item.group.title} on the left to choose its agent`
      : "Choose who gets it on the left"
    : target.kind === "project"
      ? `Message a new agent in a new workspace of ${target.project.name}… (/ for skills, @ for files)`
      : target.kind === "workspace"
        ? `Message a new agent in ${target.title}… (/ for skills, @ for files)`
        : `Message ${target.title}${target.running ? " (it's working: this joins its turn)" : ""}… (/ for skills, @ for files)`;

  const row = (it: Item, i: number) => {
    const chosenRow = it === item;
    if (it.kind === "group") {
      const g = it.group;
      const count = `${g.agents.length} ${g.agents.length === 1 ? "agent" : "agents"}${g.running ? ` · ${g.running} working` : ""}`;
      return (
        <div
          key={it.key}
          role="option"
          data-index={i}
          aria-selected={chosenRow}
          className={`cap-target cap-workspace${chosenRow ? " chosen" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openWorkspace(g)}
          title={g.title}
        >
          <span className={`cap-dot${g.running ? " running" : ""}`} aria-hidden />
          <span className="cap-target-text">
            <span className="cap-target-title">{g.title}</span>
            <span className="cap-target-place">{[g.place, count].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="cap-chevron" aria-hidden>
            ›
          </span>
        </div>
      );
    }
    const t = it.target;
    const title = t.kind === "workspace" ? "New agent in this workspace" : t.title;
    const sub = t.kind === "agent" ? [t.running ? "Working" : "", t.agent.provider.split("/").pop()].filter(Boolean).join(" · ") : t.kind === "workspace" ? "" : t.place;
    return (
      <div
        key={it.key}
        role="option"
        data-index={i}
        aria-selected={chosenRow}
        className={`cap-target${chosenRow ? " chosen" : ""}${t.kind !== "agent" ? " new" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setChosen(i)}
        onDoubleClick={() => void send(undefined, t)}
        title={t.title}
      >
        <span className={`cap-dot${t.kind === "agent" && t.running ? " running" : ""}${t.kind !== "agent" ? " plus" : ""}`} aria-hidden>
          {t.kind !== "agent" ? "+" : ""}
        </span>
        <span className="cap-target-text">
          <span className="cap-target-title">{title}</span>
          {sub && <span className="cap-target-place">{sub}</span>}
        </span>
      </div>
    );
  };
  const firstProject = shown.findIndex((it) => it.kind === "target");

  return (
    <div className="cap" ref={root} onKeyDown={onKey}>
      <aside className="cap-side" aria-label="Who gets it">
        <div className="cap-side-inner">
          {group && (
            <div className="cap-crumb">
              <button type="button" className="cap-back" onClick={back} title="All workspaces (Backspace in an empty search)" aria-label="All workspaces">
                ‹ Workspaces
              </button>
              <div className="cap-crumb-text" title={group.title}>
                <strong>{group.title}</strong>
                {group.place && <span>{group.place}</span>}
              </div>
            </div>
          )}
          <input
            className="cap-search"
            placeholder={group ? `Search ${group.title}` : "Search workspaces and agents"}
            value={query}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                step(e.key === "ArrowDown" ? 1 : -1);
              } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                pick(item);
              } else if (e.key === "Backspace" && !query && group) {
                e.preventDefault();
                back();
              }
            }}
            aria-label="Search agents and projects"
            aria-controls="cap-targets"
          />
          <div className="cap-targets" id="cap-targets" role="listbox" ref={listBox} aria-label="Sessions and projects">
            {!targets && !failure && <div className="cap-empty">Reading your agents…</div>}
            {targets && !shown.length && <div className="cap-empty">Nothing matches “{query}”.</div>}
            {!group && shown[0]?.kind === "group" && <div className="cap-group">Workspaces</div>}
            {shown.map((it, i) => [
              !group && i === firstProject && <div key="new-head" className="cap-group">New workspace in</div>,
              row(it, i),
            ])}
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
        {copied ? (
          <div className="cap-sent" role="status">
            <span>Copied to the clipboard.</span>
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
            {!speaks && manifest?.transcriptNote && <div className="cap-status">No transcript: {manifest.transcriptNote}.</div>}
            <div className="cap-composer">
              <Composer
                draft={{ ...(source ? { source } : {}), ...(host ? { host } : {}), controls: null }}
                draftOwner={owner}
                inputId={INPUT}
                label="Message for the agent"
                placeholder={placeholder}
                running={false}
                disabled={!manifest || sending || sent}
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
