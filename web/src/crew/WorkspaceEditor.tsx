/**
 * The workspace's own editor, the focus view's Editor tab (the user's ask: their nvim manages every file view, edit and
 * diff): one per workspace, Settings → Files' editor command run on the workspace's folder (`nvim .`) in a daemon
 * terminal (`POST /api/terminals/workspace-editor`), which the macOS app lays over this pane (`EditorOverlay.swift`,
 * placed for the Command tab). It keeps running while you step away, and its terminal is kept per workspace across
 * launches (`editor:workspaces`), found again on the daemon or started anew. A chat's file link opens the file in it at
 * its line and Show changes (⇧⌘G, ⌘K) runs Settings → Files' changes command in it (`POST /api/terminals/editor-send`,
 * `workspaceEditorAsks.ts`). If the editor quits, Start again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { GitCompare, Play, SquareTerminal } from "lucide-react";
import { api, errorMessage, readStore, writeStore } from "../api";
import { focusEditor, hideEditor, onEditorEvent, postEditorPlacement } from "../files/editorBridge";
import { MODAL_EVENT, modalOpen } from "../focus";
import { overlayHoles } from "../overlays";
import { ASK_EVENT, takeEditorAsk, type EditorAsk } from "./workspaceEditorAsks";
import "./crew-files.css";

export type EditorWorkspace = { id: string; host?: string; name: string; branch?: string };
type Kept = Record<string, { terminal: string }>;
const KEY = "editor:workspaces";
const keyOf = (w: EditorWorkspace) => `${w.host ?? ""}|${w.id}`;
const hostQuery = (w: EditorWorkspace) => (w.host ? `&host=${encodeURIComponent(w.host)}` : "");

/** A start under way, by workspace: a second mount (React's checks run effects twice) waits for it instead of starting another. */
const starting = new Map<string, Promise<string>>();
async function editorFor(w: EditorWorkspace): Promise<string> {
  const key = keyOf(w);
  const running = starting.get(key);
  if (running) return running;
  const start = (async () => {
    const kept = readStore<Kept>(KEY, {})[key]?.terminal;
    if (kept) {
      const listed = await api<{ terminals: { id: string }[] }>(`terminals?workspace=${encodeURIComponent(w.id)}${hostQuery(w)}`).catch(() => null);
      if (listed?.terminals.some((t) => t.id === kept)) return kept;
    }
    const made = await api<{ terminal: { id: string } }>("terminals/workspace-editor", { workspace: w.id, ...(w.host ? { host: w.host } : {}) });
    writeStore(KEY, { ...readStore<Kept>(KEY, {}), [key]: { terminal: made.terminal.id } });
    return made.terminal.id;
  })().finally(() => starting.delete(key));
  starting.set(key, start);
  return start;
}

type State = { phase: "starting" } | { phase: "running"; terminal: string } | { phase: "quit" } | { phase: "failed"; error: string };

/** Where its terminal shows: this box, reported to the app as it moves (the conversation resizing, the window), stepping
 *  aside while a dialog of the page's is open. */
function Slot({ terminal, host }: { terminal: string; host?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const send = (force = false) => {
      const r = el.getBoundingClientRect();
      postEditorPlacement(
        { terminal, ...(host ? { host } : {}), x: r.left, y: r.top, width: r.width, height: r.height, covered: modalOpen(), holes: overlayHoles(r) },
        force,
      );
    };
    send(true);
    focusEditor();
    const sizes = new ResizeObserver(() => send());
    sizes.observe(el);
    const timer = setInterval(() => send(), 250);
    const changed = () => send();
    window.addEventListener(MODAL_EVENT, changed);
    window.addEventListener("resize", changed);
    return () => {
      sizes.disconnect();
      clearInterval(timer);
      window.removeEventListener(MODAL_EVENT, changed);
      window.removeEventListener("resize", changed);
      hideEditor();
    };
  }, [terminal, host]);
  return <div ref={box} className="crew-editor-slot" role="region" aria-label="Your editor" data-terminal={terminal} onMouseDown={() => focusEditor()} />;
}

export function WorkspaceEditor({ workspace, onNotice }: { workspace: EditorWorkspace; onNotice: (message: string) => void }) {
  const [state, setState] = useState<State>({ phase: "starting" });
  const [attempt, setAttempt] = useState(0);
  const wsKey = keyOf(workspace);
  const live = useRef({ workspace, state });
  live.current = { workspace, state };

  // Its terminal: the kept one while the daemon still lists it, else a new one.
  useEffect(() => {
    let cancelled = false;
    setState({ phase: "starting" });
    editorFor(workspace).then(
      (terminal) => !cancelled && setState({ phase: "running", terminal }),
      (e) => !cancelled && setState({ phase: "failed", error: errorMessage(e) || "The editor didn't start." }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsKey, attempt]);

  // It quit (:qa), or its relay went and the daemon no longer has it.
  useEffect(
    () =>
      onEditorEvent((e) => {
        const now = live.current.state;
        if (now.phase !== "running" || e.terminal !== now.terminal) return;
        if (e.type === "exited") setState({ phase: "quit" });
        else if (e.type === "lost") setAttempt((n) => n + 1);
      }),
    [],
  );

  const send = useCallback(
    async (ask: Omit<EditorAsk, "workspace" | "host">) => {
      const now = live.current.state;
      if (now.phase !== "running") return;
      const w = live.current.workspace;
      try {
        await api("terminals/editor-send", { workspace: w.id, ...(w.host ? { host: w.host } : {}), id: now.terminal, ...ask });
        focusEditor();
      } catch (e) {
        onNotice(errorMessage(e) || "The editor didn't take it.");
      }
    },
    [onNotice],
  );
  // Asks from elsewhere (a file link, Show changes): taken once its editor runs.
  useEffect(() => {
    if (state.phase !== "running") return;
    const take = () => {
      const ask = takeEditorAsk(workspace.id, workspace.host);
      if (ask) void send(ask.changes ? { changes: true } : { open: ask.open! });
    };
    take();
    window.addEventListener(ASK_EVENT, take);
    return () => window.removeEventListener(ASK_EVENT, take);
  }, [state.phase, workspace.id, workspace.host, send]);

  const where = workspace.branch && workspace.branch !== workspace.name ? `${workspace.name} · ${workspace.branch}` : workspace.name;
  return (
    <section className="crew-files crew-editor beside" aria-label={`${workspace.name}: your editor`}>
      <header className="crew-editor-head">
        <SquareTerminal size={14} aria-hidden="true" />
        <span className="crew-files-where">{where}</span>
        <span className="crew-files-tools">
          <button className="page-btn" disabled={state.phase !== "running"} onClick={() => void send({ changes: true })} data-tip="Run Settings → Files’ changes command in the editor (⇧⌘G)">
            <GitCompare size={13} aria-hidden="true" />
            Show changes
          </button>
        </span>
      </header>
      <div className="crew-files-body">
        {state.phase === "running" && <Slot terminal={state.terminal} {...(workspace.host ? { host: workspace.host } : {})} />}
        {state.phase === "starting" && <p className="crew-editor-note">Starting your editor in {workspace.name}…</p>}
        {(state.phase === "quit" || state.phase === "failed") && (
          <div className="crew-editor-note">
            <p>{state.phase === "quit" ? "The editor quit." : state.error}</p>
            <button className="page-btn solid" onClick={() => setAttempt((n) => n + 1)}>
              <Play size={13} aria-hidden="true" />
              Start again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
