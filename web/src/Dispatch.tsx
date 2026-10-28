import { soundEvent } from "./soundCues";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, GitBranch, MessageSquare } from "lucide-react";
import { api, errorMessage, readStore, writeStore } from "./api";
import { Composer } from "./Composer";
import type { Outgoing } from "./composer/types";
import type { Host, Mode, Model, Project, Provider, Workspace } from "./types";
import { hostQuery } from "./types";
import { projectKey, workspaceKey } from "./workspaces";
import { hostText, placeText } from "./names";
import { plainText } from "./ui";

/** As many images as the daemon takes with a prompt. */
const MAX_IMAGES = 10;

/** A draft's agent settings, carried over from an agent being cleared. */
export type DraftSettings = {
  provider: string;
  model?: string;
  thinking?: string;
  mode?: string;
};
/** Host-qualified keys (`projectKey`, `workspaceKey`): IDs repeat across hosts. */
export type DispatchTarget = {
  projectId?: string;
  workspaceId?: string;
  settings?: DraftSettings;
};
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

/** A compact picker in the composer's row, as the agent's own controls are. */
function Pick({
  label,
  shown,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  shown: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`control ${disabled ? "disabled" : ""}`}
      aria-description={label}
    >
      <span>{shown}</span>
      <ChevronDown size={11} />
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

/**
 * A new agent, before it exists: where it runs (a small form) above an empty
 * conversation, and the conversation's own composer, whose first message
 * creates the agent. Its provider, model, thinking and mode are the
 * composer's pickers; /skills and @files come from the chosen folder.
 */
export function NewAgent({
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
  const [hostProviders, setHostProviders] = useState<{
    host?: string;
    rows: Provider[];
  }>({ rows: providers });
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
    ].find((t) => t && targetOn(t, key)) || "";
  const targetOn = (t: string, key: string) =>
    t.startsWith("p:")
      ? projects.some((p) => onHost(key)(p) && `p:${projectKey(p)}` === t)
      : workspaces.some((w) => onHost(key)(w) && `w:${workspaceKey(w)}` === t);
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
  const settings = initial.settings;
  const [provider, setProvider] = useState(
    providers.find(
      (p) =>
        p.status === "available" &&
        p.provider === (settings?.provider || prefs.provider),
    )?.provider ||
      providers.find((p) => p.status === "available")?.provider ||
      "",
  );
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [mode, setMode] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [error, setError] = useState("");
  // Files dropped anywhere on the view join the first message.
  const [drop, setDrop] = useState<{ files: File[]; at: number } | null>(null);
  const hasFiles = (e: React.DragEvent) =>
    [...e.dataTransfer.types].includes("Files");

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
  // Remote hosts can have different providers; the list follows the host.
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
    const r =
      settings?.provider === provider
        ? settings
        : readStore<Prefs>("dispatch", {}).byProvider?.[provider] || {};
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

  const folder = workspace?.cwd || project?.path || "";
  const blocked = !online
    ? "Paseo is offline."
    : chosenHost?.unavailable
      ? `${chosenHost.name} is ${chosenHost.reason}. Choose another host.`
      : !folder
        ? "Choose where the agent runs first."
        : "";

  /** The first message: creates the agent with it. */
  const send = async (message: Outgoing) => {
    if (blocked || !message.text.trim()) return false;
    setError("");
    const body: Record<string, unknown> = {
      prompt: message.text.trim(),
      provider: provider || undefined,
      ...(project
        ? { projectId: project.projectId }
        : { workspaceId: workspace?.workspaceId }),
    };
    if (model) body.model = model;
    if (thinking && thinkingOptions.includes(thinking)) body.thinking = thinking;
    if (mode && (!modes.length || modes.some((m) => m.id === mode)))
      body.mode = mode;
    if (message.images.length)
      body.images = message.images
        .slice(0, MAX_IMAGES)
        .map(({ data, mimeType }) => ({ data, mimeType }));
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
      onNotice("Agent dispatched");
      onDispatched(
        result?.id || result?.Id || result?.agentId || result?.agent?.id,
        host,
      );
      return true;
    } catch (e) {
      soundEvent("actionFailed");
      setError(errorMessage(e));
      return false;
    }
  };

  const hereProjects = projects.filter(onHost(hostKey));
  const hereWorkspaces = workspaces.filter(onHost(hostKey));
  const providerLabel =
    available.find((p) => p.provider === provider)?.label || provider || "Provider";
  const controls = (
    <div className="agent-controls">
      <Pick
        label="Provider"
        shown={providerLabel}
        value={provider}
        onChange={setProvider}
      >
        {available.map((p) => (
          <option key={p.provider} value={p.provider}>
            {p.label}
          </option>
        ))}
      </Pick>
      <Pick
        label="Model"
        shown={chosenModel?.model || "Default model"}
        value={model}
        onChange={setModel}
      >
        <option value="">Default model</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.model}
          </option>
        ))}
      </Pick>
      {thinkingOptions.length > 0 && (
        <Pick
          label="Thinking"
          shown={
            thinkingOptions.includes(thinking)
              ? thinking
              : chosenModel?.defaultThinkingOptionId || "Default thinking"
          }
          value={thinkingOptions.includes(thinking) ? thinking : ""}
          onChange={setThinking}
        >
          <option value="">
            {chosenModel?.defaultThinkingOptionId
              ? `Default (${chosenModel.defaultThinkingOptionId})`
              : "Default thinking"}
          </option>
          {thinkingOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Pick>
      )}
      {modes.length > 0 && (
        <Pick
          label="Mode"
          shown={modes.find((m) => m.id === mode)?.label || "Default mode"}
          value={mode}
          onChange={setMode}
        >
          <option value="">Default mode</option>
          {modes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Pick>
      )}
    </div>
  );
  // The daemon lists a draft's skills only for a model: "Default" asks for
  // the provider's first.
  const source =
    folder && provider && (model || models[0]?.id)
      ? { cwd: folder, provider, model: model || models[0]!.id, mode, thinking }
      : undefined;

  return (
    <div
      className="session new-agent"
      onDragOver={(e) => {
        // Always claim file drags, or the browser navigates to the file.
        if (hasFiles(e)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDrop({ files: [...e.dataTransfer.files], at: Date.now() });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget) onClose();
      }}
    >
      <header className="session-header">
        <div className="session-nav">
          <button
            className="ghost-btn"
            onClick={onClose}
            aria-description="Back to fleet without starting an agent (Esc)"
          >
            <ArrowLeft size={15} />
            Fleet
          </button>
        </div>
        <div className="session-title">
          <div>
            <h2>New agent</h2>
          </div>
        </div>
        <div className="new-agent-form">
          <label>
            <span>Host</span>
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
            <span>Where</span>
            <select
              name="target"
              aria-description="The project checkout, or an existing workspace, the agent works in"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
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
                    <option key={workspaceKey(w)} value={`w:${workspaceKey(w)}`}>
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
            <>
              <label>
                <span>
                  New branch <em>optional</em>
                </span>
                <input
                  {...plainText}
                  aria-description="Optional: a new branch, so it works in its own worktree"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="feature/my-task"
                  maxLength={150}
                />
              </label>
              <label>
                <span>
                  Base <em>optional</em>
                </span>
                <input
                  {...plainText}
                  aria-description="Optional: the ref the new branch starts from (default: the project's base)"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="origin/main"
                  maxLength={150}
                  disabled={!branch.trim()}
                />
              </label>
            </>
          )}
          <p className="form-hint">
            <GitBranch size={13} />
            {workspace
              ? `Runs inside “${placeText(workspace.name, "this workspace")}” alongside its existing agents.`
              : branch.trim()
                ? "Creates an isolated worktree on a new branch."
                : "Runs in the project checkout. Add a branch to isolate it in a worktree."}
          </p>
        </div>
      </header>
      <div className="timeline new-agent-empty">
        <div className="chat-empty">
          <MessageSquare size={28} strokeWidth={1.5} aria-hidden="true" />
          <h2>No messages yet</h2>
          <p>
            Write the first message below to start the agent. Use /skills and
            @files as in any conversation.
          </p>
        </div>
      </div>
      <footer className="session-footer">
        {error && (
          <p className="archive-error" role="alert">
            {error}
          </p>
        )}
        <Composer
          draft={{ source, host, controls }}
          running={false}
          disabled={!!blocked}
          disabledReason={blocked}
          started={false}
          modes={[]}
          onSetMode={() => {}}
          onSend={send}
          onCancel={async () => {}}
          onNotice={onNotice}
          onArchive={() => {}}
          onFreshDraft={() => {}}
          promptHistory={[]}
          dropFiles={drop}
        />
      </footer>
    </div>
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
