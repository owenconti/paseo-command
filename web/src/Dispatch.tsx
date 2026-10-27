import { soundEvent } from "./soundCues";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { motion, useIsPresent } from "framer-motion";
import { GitBranch, ImagePlus, LoaderCircle, Send, X } from "lucide-react";
import { api, errorMessage, readStore, writeStore } from "./api";
import { AttachmentTray } from "./composer/AttachmentTray";
import type { ImageAttachment } from "./composer/types";
import {
  MAX_IMAGE,
  RASTER,
  insertAtCaret,
  readDataUrl,
  uid,
} from "./composer/util";
import { Lightbox } from "./Images";
import { pastedText } from "./paste";
import type { Host, Mode, Model, Project, Provider, Workspace } from "./types";
import { hostQuery } from "./types";
import { projectKey, workspaceKey } from "./workspaces";
import { useFocusTrap } from "./focus";
import { hostText, placeText } from "./names";

/** As many images as the daemon takes with a prompt. */
const MAX_IMAGES = 10;

/** Host-qualified keys (`projectKey`, `workspaceKey`): IDs repeat across hosts. */
export type DispatchTarget = { projectId?: string; workspaceId?: string };
type Prefs = {
  target?: string;
  provider?: string;
  byProvider?: Record<
    string,
    { model?: string; thinking?: string; mode?: string }
  >;
};


/** Modes the daemon reports for providers this browser hasn't seen an agent of yet. */
const KNOWN_MODES: Record<string, Mode[]> = {
  claude: [
    { id: "plan", label: "Plan Mode" },
    { id: "default", label: "Always Ask" },
    { id: "acceptEdits", label: "Accept File Edits" },
    { id: "auto", label: "Auto mode" },
    { id: "bypassPermissions", label: "Bypass" },
  ],
  codex: [
    { id: "auto", label: "Default Permissions" },
    { id: "auto-review", label: "Auto-review" },
    { id: "full-access", label: "Full Access" },
  ],
};
const providerModes = (provider: string) => {
  const seen = readStore<Mode[]>(`modes:${provider}`, []);
  return seen.length ? seen : (KNOWN_MODES[provider] ?? []);
};
/** New dispatches run without permission prompts: the provider's bypass mode
 * (Claude "Bypass", Codex "Full Access"), or its default when it has none. */
export function bypassMode(provider: string) {
  const modes = providerModes(provider);
  return (
    modes.find((m) => /^(bypassPermissions|full-access|bypass)$/i.test(m.id))?.id ??
    modes.find((m) => /bypass|full access/i.test(m.label))?.id ??
    ""
  );
}

export function DispatchDialog({
  projects,
  workspaces,
  providers,
  hosts,
  initial,
  fallback,
  online,
  onClose,
  onDispatched,
  onNotice,
}: {
  projects: Project[];
  workspaces: Workspace[];
  providers: Provider[];
  hosts: Host[];
  initial: DispatchTarget;
  /** Project to preselect when nothing is in context: the busiest one. */
  fallback?: string;
  online: boolean;
  onClose: () => void;
  onDispatched: (agentId: string | undefined, host: string | undefined) => void;
  onNotice: (message: string) => void;
}) {
  const prefs = useMemo(() => readStore<Prefs>("dispatch", {}), []);
  // Remote hosts can have different providers; the list follows the target's host.
  const dialog = useRef<HTMLElement>(null);
  const present = useIsPresent();
  useFocusTrap(dialog, undefined, present);
  useLayoutEffect(() => {
    if (!present && dialog.current?.contains(document.activeElement))
      (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  const [hostProviders, setHostProviders] = useState<{
    host?: string;
    rows: Provider[];
  }>({ rows: providers });
  // The host comes first: "Where", providers and models follow it.
  const hostChoices = useMemo(() => hostOptions(hosts), [hosts]);
  const onHost = (key: string) => (p: { host?: string }) =>
    (p.host || LOCAL) === key;
  /** The remembered place, the busiest project, or the first, on `key`. */
  const firstTarget = (key: string) =>
    [
      prefs.target,
      fallback && `p:${fallback}`,
      ...projects.filter(onHost(key)).map((p) => `p:${projectKey(p)}`),
      ...workspaces.filter(onHost(key)).map((w) => `w:${workspaceKey(w)}`),
    ].find(
      (t) =>
        t &&
        (projects.some((p) => onHost(key)(p) && `p:${projectKey(p)}` === t) ||
          workspaces.some(
            (w) => onHost(key)(w) && `w:${workspaceKey(w)}` === t,
          )),
    ) || "";
  // The selection's host, or local.
  const [hostKey, setHostKey] = useState(
    () =>
      (initial.workspaceId
        ? workspaces.find((w) => workspaceKey(w) === initial.workspaceId)?.host
        : initial.projectId
          ? projects.find((p) => projectKey(p) === initial.projectId)?.host
          : undefined) || LOCAL,
  );
  const [target, setTarget] = useState(() =>
    initial.workspaceId
      ? `w:${initial.workspaceId}`
      : initial.projectId
        ? `p:${initial.projectId}`
        : firstTarget(hostKey),
  );
  const chosenHost = hostChoices.find((h) => h.key === hostKey);
  const chooseHost = (key: string) => {
    setHostKey(key);
    // A place on another host can't be kept.
    if (!targetOn(target, key)) setTarget(firstTarget(key));
  };
  const targetOn = (t: string, key: string) =>
    t.startsWith("p:")
      ? projects.some((p) => onHost(key)(p) && `p:${projectKey(p)}` === t)
      : workspaces.some((w) => onHost(key)(w) && `w:${workspaceKey(w)}` === t);
  const [provider, setProvider] = useState(
    providers.find(
      (p) => p.status === "available" && p.provider === prefs.provider,
    )?.provider ||
      providers.find((p) => p.status === "available")?.provider ||
      "",
  );
  const remembered = prefs.byProvider?.[provider] || {};
  const [model, setModel] = useState(remembered.model || "");
  const [thinking, setThinking] = useState(remembered.thinking || "");
  const [mode, setMode] = useState(remembered.mode || bypassMode(provider));
  const [models, setModels] = useState<Model[]>([]);
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState(() => readStore("draft:dispatch", ""));
  // Pasted, dropped or chosen screenshots, sent with the mission.
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const mission = useRef<HTMLTextAreaElement>(null);

  const project = target.startsWith("p:")
    ? projects.find((p) => projectKey(p) === target.slice(2))
    : undefined;
  const workspace = target.startsWith("w:")
    ? workspaces.find((w) => workspaceKey(w) === target.slice(2))
    : undefined;
  const host = hostKey === LOCAL ? undefined : hostKey;
  const modes = providerModes(provider);
  const available = useMemo(
    () =>
      (hostProviders.host === host
        ? hostProviders.rows
        : host
          ? []
          : providers
      ).filter((p) => p.status === "available"),
    [hostProviders, host, providers],
  );
  useEffect(() => {
    if (!host) return setHostProviders({ rows: providers });
    const controller = new AbortController();
    api<Provider[]>(`providers${hostQuery(host)}`, undefined, controller.signal)
      .then((rows) =>
        setHostProviders({ host, rows: Array.isArray(rows) ? rows : [] }),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [host, providers]);
  // Keep the chosen provider valid for the selected host.
  useEffect(() => {
    if (available.length && !available.some((p) => p.provider === provider))
      setProvider(
        available.find((p) => p.provider === prefs.provider)?.provider ||
          available[0].provider,
      );
  }, [available, provider, prefs.provider]);

  useEffect(() => {
    writeStore("draft:dispatch", prompt);
  }, [prompt]);
  useEffect(() => {
    const r = readStore<Prefs>("dispatch", {}).byProvider?.[provider] || {};
    setModel(r.model || "");
    setThinking(r.thinking || "");
    setMode(r.mode || bypassMode(provider));
    setModels([]);
    if (!provider) return;
    const controller = new AbortController();
    api<Model[]>(
      `providers/${provider}/models${hostQuery(host)}`,
      undefined,
      controller.signal,
    )
      .then((rows) => setModels(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    return () => controller.abort();
  }, [provider, host]);
  const chosenModel = models.find((m) => m.id === model);
  // A remembered model the provider no longer offers would show "Default" but
  // still be sent; drop it once the list is known.
  useEffect(() => {
    if (models.length && model && !models.some((m) => m.id === model))
      setModel("");
  }, [models, model]);
  const thinkingOptions = chosenModel?.thinkingOptionIds || [];

  const addImages = async (files: File[]) => {
    for (const [i, file] of files.entries()) {
      if (!RASTER.test(file.type)) {
        onNotice(`${file.name || "That file"} isn't an image (PNG, JPEG, GIF or WebP)`);
        continue;
      }
      if (file.size > MAX_IMAGE) {
        onNotice(`${file.name || "That image"} is too large (max 20 MB)`);
        continue;
      }
      let dataUrl: string;
      try {
        dataUrl = await readDataUrl(file);
      } catch {
        onNotice(`Couldn't read ${file.name || "that image"}`);
        continue;
      }
      setImages((all) =>
        all.length >= MAX_IMAGES
          ? (onNotice(`Attach at most ${MAX_IMAGES} images`), all)
          : [
              ...all,
              {
                kind: "image",
                id: uid(),
                name: file.name || `pasted-${i + 1}.png`,
                mimeType: file.type,
                dataUrl,
              },
            ],
      );
    }
  };
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  const submit = async () => {
    // ⌘↵ bypasses the disabled button, and the target may have vanished.
    if (
      busy ||
      !online ||
      !prompt.trim() ||
      !(project || workspace) ||
      chosenHost?.unavailable
    )
      return;
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = {
      prompt: prompt.trim(),
      provider: provider || undefined,
      ...(project
        ? { projectId: project.projectId }
        : { workspaceId: workspace?.workspaceId }),
    };
    if (model) body.model = model;
    if (thinking && thinkingOptions.includes(thinking))
      body.thinking = thinking;
    if (mode && (!modes.length || modes.some((m) => m.id === mode)))
      body.mode = mode;
    if (title.trim()) body.title = title.trim();
    if (images.length)
      body.images = images.map((a) => ({
        data: a.dataUrl.split(",")[1],
        mimeType: a.mimeType,
      }));
    if (project && branch.trim()) {
      body.branch = branch.trim();
      if (base.trim()) body.base = base.trim();
    }
    if (host) body.host = host;
    try {
      // Daemon versions name the new agent differently.
      const result = await api<{
        id?: string;
        Id?: string;
        agentId?: string;
        agent?: { id?: string };
      } | null>("dispatch", body);
      writeStore("dispatch", {
        target,
        provider,
        byProvider: {
          ...prefs.byProvider,
          [provider]: { model, thinking, mode },
        },
      });
      setPrompt("");
      setImages([]);
      writeStore("draft:dispatch", "");
      onNotice("Agent dispatched");
      onDispatched(
        result?.id || result?.Id || result?.agentId || result?.agent?.id,
        host,
      );
    } catch (e) {
      soundEvent("actionFailed");
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const hereProjects = projects.filter(onHost(hostKey));
  const hereWorkspaces = workspaces.filter(onHost(hostKey));
  return (
    <motion.div
      className="modal-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={() => !busy && onClose()}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="dispatch-title"
        className={`command-dialog dispatch-dialog panel${dragging ? " dropping" : ""}`}
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
          opacity: 0,
          y: 15,
          scale: 0.97,
          transition: { duration: 0.12 },
        }}
        onClick={(e) => e.stopPropagation()}
        // Images dropped anywhere on the dialog join the mission.
        onDragOver={(e) => {
          if (!hasFiles(e) || busy) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(e) => {
          setDragging(false);
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          if (!busy) void addImages([...e.dataTransfer.files]);
        }}
        onKeyDown={(e) => {
          // Own Escape entirely: while dispatching, the dialog must stay open.
          if (e.key === "Escape") {
            e.stopPropagation();
            if (!busy) onClose();
          }
          // ⌘L focuses the message being written: here, the mission.
          if (
            e.key.toLowerCase() === "l" &&
            (e.metaKey || e.ctrlKey) &&
            !e.altKey &&
            !e.shiftKey
          ) {
            e.preventDefault();
            mission.current?.focus();
          }
        }}
      >
        <div className="dialog-heading">
          <span className="brand-symbol">
            <Send size={18} />
          </span>
          <div>
            <h2 id="dispatch-title">Dispatch an agent</h2>
            <p>Start a new agent on a project or workspace.</p>
          </div>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            data-tip="Close (Esc)"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            Host
            <select
              name="host"
              aria-description="The machine whose Paseo daemon runs the agent"
              value={hostKey}
              onChange={(e) => chooseHost(e.target.value)}
            >
              {hostChoices.map((h) => (
                <option key={h.key} value={h.key} disabled={h.unavailable}>
                  {h.text}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mission
            <textarea
              aria-description="What the new agent should do (⌘↵ dispatches)"
              ref={mission}
              autoFocus
              name="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                if (!files.length) return;
                e.preventDefault();
                // Attach the images; keep any text unless it only names them.
                const extra = pastedText(
                  files.map((f) => f.name),
                  e.clipboardData.getData("text/plain"),
                  e.clipboardData.getData("text/uri-list"),
                );
                if (extra) insertAtCaret(e.currentTarget, extra);
                void addImages(files);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Describe the task for your new agent…"
              required
              rows={5}
              maxLength={12000}
            />
          </label>
          <div className="mission-images">
            {images.length > 0 && (
              <AttachmentTray
                attachments={images}
                onOpen={setPreview}
                onRemove={(id) => setImages((all) => all.filter((a) => a.id !== id))}
              />
            )}
            <button
              type="button"
              className="add-images"
              aria-description="Attach PNG, JPEG, GIF or WebP images (or paste or drop them)"
              disabled={busy || images.length >= MAX_IMAGES}
              onClick={() => imageInput.current?.click()}
            >
              <ImagePlus size={14} />
              {images.length ? "Add more images" : "Add images"}
              <span>or paste or drop them</span>
            </button>
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void addImages([...(e.target.files || [])]);
                e.target.value = "";
              }}
            />
          </div>
          <label>
            Where
            <select
              name="target"
              aria-description="The project checkout, or an existing workspace, the agent works in"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
            >
              {!target && <option value="">Nothing on this host</option>}
              {hereProjects.length > 0 && (
                <optgroup label="Projects">
                  {hereProjects.map((p) => (
                    <option key={projectKey(p)} value={`p:${projectKey(p)}`}>
                      {placeText(p.name, "Project")}
                    </option>
                  ))}
                </optgroup>
              )}
              {hereWorkspaces.length > 0 && (
                <optgroup label="Existing workspaces">
                  {hereWorkspaces.map((w) => (
                    <option
                      key={workspaceKey(w)}
                      value={`w:${workspaceKey(w)}`}
                    >
                      {placeText(w.project, "Project")} ›{" "}
                      {placeText(w.name, "Workspace")}
                      {w.branch && w.branch !== w.name
                        ? ` (${placeText(w.branch)})`
                        : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {project && (
            <div className="form-columns">
              <label>
                New worktree branch <span>optional</span>
                <input
                  aria-description="Optional: a new branch, so it works in its own worktree"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="feature/my-task"
                  maxLength={150}
                />
              </label>
              <label>
                Base <span>optional</span>
                <input
                  aria-description="Optional: the ref the new branch starts from (default: the project's base)"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="origin/main"
                  maxLength={150}
                  disabled={!branch.trim()}
                />
              </label>
            </div>
          )}
          <p className="form-hint">
            <GitBranch size={13} />
            {workspace
              ? `Runs inside “${placeText(workspace.name, "this workspace")}” alongside its existing agents.`
              : branch.trim()
                ? "Creates an isolated worktree on a new branch."
                : "Runs in the project checkout. Add a branch to isolate it in a worktree."}
          </p>
          <div className="form-columns">
            <label>
              Provider
              <select
                name="provider"
                aria-description="Which agent provider runs it"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {available.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <select
                name="model"
                aria-description="The provider's model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="">Default</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.model}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label>
              Thinking
              <select
                name="thinking"
                aria-description="How much the model thinks before answering"
                value={thinkingOptions.includes(thinking) ? thinking : ""}
                onChange={(e) => setThinking(e.target.value)}
                disabled={!thinkingOptions.length}
              >
                <option value="">
                  {chosenModel?.defaultThinkingOptionId
                    ? `Default (${chosenModel.defaultThinkingOptionId})`
                    : "Default"}
                </option>
                {thinkingOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mode
              <select
                name="mode"
                aria-description="The provider's permission mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="">Default</option>
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>
              Title <span className="optional">optional</span>
            </span>
            <input
              aria-description="Optional: a title (otherwise the start of the mission)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to the start of the mission"
              maxLength={200}
            />
          </label>
          {chosenHost?.unavailable && (
            <p className="archive-error" role="alert">
              {chosenHost.name} is {chosenHost.reason}. Choose another host.
            </p>
          )}
          {error && (
            <p className="archive-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <span>
              <kbd>⌘</kbd>
              <kbd>↵</kbd> to dispatch
            </span>
            <button
              aria-description={
                !online
                  ? "Paseo is offline"
                  : chosenHost?.unavailable
                    ? `${chosenHost.name} is ${chosenHost.reason}`
                    : !target
                      ? "Choose where it runs first"
                      : !prompt.trim()
                        ? "Describe the mission first"
                        : "Start the agent (⌘↵)"
              }
              className="primary"
              disabled={
                busy ||
                !online ||
                !!chosenHost?.unavailable ||
                !target ||
                !prompt.trim()
              }
              type="submit"
            >
              {busy ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <Send size={14} />
              )}
              {busy ? "Dispatching…" : "Dispatch agent"}
            </button>
          </div>
        </form>
        {preview && (
          <Lightbox
            shown={{ url: preview.dataUrl, alt: "", name: preview.name }}
            onClose={() => setPreview(null)}
          />
        )}
      </motion.section>
    </motion.div>
  );
}

/** The local daemon's key in the Host field. */
const LOCAL = "local";
const STATE_TEXT = {
  online: "online",
  loading: "loading",
  slow: "slow to answer",
  stale: "not answering",
  offline: "offline",
};

/**
 * The Host field's choices: every host the daemon knows, local first, with
 * its connection state. A remote host the registry doesn't report online
 * can't be dispatched to (the server refuses it), so it is disabled, and
 * says why.
 */
export function hostOptions(hosts: Host[]) {
  const rows = hosts.some((h) => h.local)
    ? hosts
    : [
        { serverId: LOCAL, label: LOCAL, local: true, status: "online" },
        ...hosts,
      ];
  return [...rows]
    .sort((a, b) => Number(b.local) - Number(a.local))
    .map((h) => {
      const state =
        h.state ?? (h.local || h.status === "online" ? "online" : "offline");
      const unavailable =
        !h.local && (h.status !== "online" || state === "offline");
      const name = h.local ? LOCAL : hostText(h);
      // Errors can quote IDs: they're shown only once cleaned.
      const why = h.error ? placeText(h.error, "", [h.serverId]) : "";
      const reason = unavailable ? "offline" : STATE_TEXT[state];
      return {
        key: h.local ? LOCAL : h.serverId,
        name,
        unavailable,
        reason,
        text: `${name} · ${reason}${unavailable && why ? ` (${why})` : ""}`,
      };
    });
}
