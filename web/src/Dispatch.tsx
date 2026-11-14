import { soundEvent } from "./soundCues";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, GitBranch, LoaderCircle, MessageSquare, Pencil, Play, Server } from "lucide-react";
import { api, errorMessage, readStore, removeStore, writeStore } from "./api";
import { Composer } from "./Composer";
import type { Outgoing } from "./composer/types";
import type {
  Host,
  Mode,
  Model,
  Profile,
  Project,
  Provider,
  Workspace,
} from "./types";
import { hostQuery } from "./types";
import { projectKey, workspaceKey } from "./workspaces";
import { hostText, placeText } from "./names";
import { plainText } from "./ui";
import { rovingKeyDown } from "./focus";
import { randomBranchName } from "./branchName";
import { PrPicker } from "./PrPicker";
import {
  fillPreset,
  presetNeedsPr,
  prNumberOf,
  type Preset,
  type PullRequestChoice,
} from "./presets";
import { openPresetEditor, usePresets } from "./presetsStore";
import { openProfileEditor, useProfilesRevision } from "./profilesStore";
import { sendBody } from "./sent";
import { DISPATCH_FORM, claimPoolBox, draftRestored, formPoolJob, usePool } from "./poolStore";
import { boxOfLabel, claimable, idleBoxes, jobRunning, jobText, unclaimableWhy, type PoolStatus } from "./pool";

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
  /** A host to start on (`POOL`: a new pool box), when no place is given. */
  host?: string;
  settings?: DraftSettings;
};
/** Where a project agent runs: its checkout, or a new worktree and branch. */
type Isolation = "local" | "worktree";
const ISOLATIONS: [Isolation, string, string][] = [
  ["local", "Local", "Run directly in the project checkout, on its current branch"],
  ["worktree", "Worktree", "Create a new worktree on a new, randomly named branch"],
];

/**
 * New agent's unsent form, kept as it changes so leaving New agent loses nothing (its first message is the
 * composer's own `draft:dispatch`): brought back when New agent next opens without a place of its own, and
 * cleared once it starts an agent (a pool box's once the agent is started on the box: poolStore.ts).
 */
type FormDraft = {
  host: string;
  target: string;
  isolation: Isolation;
  branch: string;
  base: string;
  pr: PullRequestChoice | null;
  prText: string;
  provider: string;
  model: string;
  thinking: string;
  mode: string;
  /** The profile chosen, brought back once the host's profiles are read. */
  profile?: string;
};
function keptForm(): FormDraft | null {
  const f = readStore<Partial<FormDraft> | null>(DISPATCH_FORM, null);
  if (!f || typeof f !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const pr =
    f.pr && typeof f.pr === "object" && Number.isSafeInteger(f.pr.number) && f.pr.number > 0
      ? f.pr
      : null;
  return {
    host: str(f.host),
    target: str(f.target),
    isolation: f.isolation === "worktree" ? "worktree" : "local",
    branch: str(f.branch),
    base: str(f.base),
    pr,
    prText: str(f.prText),
    provider: str(f.provider),
    model: str(f.model),
    thinking: str(f.thinking),
    mode: str(f.mode),
    ...(typeof f.profile === "string" && f.profile ? { profile: f.profile } : {}),
  };
}

type Prefs = {
  target?: string;
  provider?: string;
  /** The profile last launched with, chosen again while it still applies. */
  profile?: string;
  isolation?: Isolation;
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
export const providerModes = (provider: string) => {
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
  // Opened somewhere of its own (a workspace's or project's Dispatch, a pool box) it starts there; otherwise the
  // form as it was left comes back, and a pool box claim still under way shows again.
  const placed = !!(initial.workspaceId || initial.projectId || initial.host || initial.settings);
  const [claim] = useState(() => (placed ? null : formPoolJob()));
  const [kept] = useState(() => (placed || claim ? null : keptForm()));
  const [hostProviders, setHostProviders] = useState<{
    host?: string;
    rows: Provider[];
  }>({ rows: providers });
  const pool = usePool();
  const hostChoices = useMemo(
    () => [...hostOptions(hosts, wakeable(pool)), ...poolOption(pool)],
    [hosts, pool],
  );
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
          : initial.host) ||
      (claim
        ? POOL
        : kept && (kept.host === POOL || hostOptions(hosts).some((h) => h.key === kept.host))
          ? kept.host
          : LOCAL),
  );
  const [target, setTarget] = useState(() =>
    initial.workspaceId
      ? `w:${initial.workspaceId}`
      : initial.projectId
        ? `p:${initial.projectId}`
        : kept && targetOn(kept.target, hostKey)
          ? kept.target
          : firstTarget(hostKey),
  );
  const chosenHost = hostChoices.find((h) => h.key === hostKey);
  const chooseHost = (key: string) => {
    setHostKey(key);
    // A place on another host can't be kept.
    if (!targetOn(target, key)) setTarget(firstTarget(key));
  };
  // A cleared agent's settings, else the left form's own (its profile, if it had one, comes back by itself).
  const settings =
    initial.settings ??
    (kept?.provider && !kept.profile
      ? { provider: kept.provider, model: kept.model, thinking: kept.thinking, mode: kept.mode }
      : undefined);
  const profileWanted = kept?.profile ?? prefs.profile;
  const [provider, setProvider] = useState(
    providers.find(
      (p) =>
        p.status === "available" &&
        p.provider === (settings?.provider || prefs.provider),
    )?.provider ||
      providers.find((p) => p.status === "available")?.provider ||
      "",
  );
  // The Paseo agent profile chosen in the provider picker, if any.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<{ host?: string; rows: Profile[] }>({
    rows: [],
  });
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [mode, setMode] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [isolation, setIsolation] = useState<Isolation>(
    kept?.isolation ?? (prefs.isolation === "worktree" ? "worktree" : "local"),
  );
  // Worktree mode needs no typing: an empty branch takes this name.
  const [suggested] = useState(randomBranchName);
  const [branch, setBranch] = useState(kept?.branch ?? "");
  const [base, setBase] = useState(kept?.base ?? "");
  // A pull request whose branch the new worktree checks out, instead.
  const [pr, setPr] = useState<PullRequestChoice | null>(kept?.pr ?? null);
  const [prText, setPrText] = useState(kept?.prText ?? "");
  const [launching, setLaunching] = useState(false);
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
  // A new pool box: claimed when the first message is sent, then dispatched to.
  // A pool box: a new one (any idle box), or one whose host is asleep (released and paused), woken by name.
  const wakeBox = chosenHost?.wake ? boxOfLabel(pool?.boxes ?? [], chosenHost.label) : undefined;
  const isPool = hostKey === POOL || !!wakeBox;
  const host = hostKey === LOCAL || isPool ? undefined : hostKey;
  // The pool job this form started, until it ends.
  const [poolJob, setPoolJob] = useState(claim?.id ?? "");
  // The claim was seen running here: only then does its end open the agent or say why it failed.
  const sawClaim = useRef(false);
  // Remounted to show a failed claim's message put back into the draft.
  const [composerKey, setComposerKey] = useState(0);
  const job = pool?.job && pool.job.id === poolJob ? pool.job : null;
  const claiming = jobRunning(job);
  const modes = providerModes(provider);
  const available = useMemo(
    () =>
      isPool
        ? // Pool boxes run Claude only (paseo-boxes' provision.sh).
          [
            providers.find((p) => p.provider === "claude") ?? {
              provider: "claude",
              label: "Claude",
              status: "available",
            },
          ].map((p) => ({ ...p, status: "available" }))
        : (hostProviders.host === host
            ? hostProviders.rows
            : host
              ? []
              : providers
          ).filter((p) => p.status === "available"),
    [hostProviders, host, providers, isPool],
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
  // The host's agent profiles, from its daemon config, read again once the
  // profiles' editor saves.
  const profilesRevision = useProfilesRevision();
  useEffect(() => {
    const controller = new AbortController();
    api<Profile[]>(`profiles${hostQuery(host)}`, undefined, controller.signal)
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setProfiles({ host, rows: list });
        // The chosen profile, edited, applies as it now is.
        const edited = applied && list.find((p) => p.id === applied.id);
        if (edited) applyProfile(edited);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [host, profilesRevision]);
  const hostProfiles = useMemo(
    () =>
      !isPool && profiles.host === host
        ? profiles.rows.filter((p) =>
            available.some((a) => a.provider === p.provider),
          )
        : [],
    [profiles, host, available, isPool],
  );
  const applyProfile = (p: Profile) => {
    setProfile(p);
    setProvider(p.provider);
    setModel(p.model);
    setThinking(p.thinking);
    setMode(p.mode || bypassMode(p.provider));
  };
  // The last launch's profile comes back, unless a cleared agent's settings
  // were carried over; one on another host or since removed is dropped.
  const restored = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (settings || !profileWanted || profiles.host !== host) return;
    if (restored.current === (host || LOCAL)) return;
    const p = hostProfiles.find((p) => p.id === profileWanted);
    if (!p) return;
    restored.current = host || LOCAL;
    applyProfile(p);
  }, [hostProfiles]);
  useEffect(() => {
    if (profile && !hostProfiles.some((p) => p.id === profile.id))
      setProfile(null);
  }, [hostProfiles, profile]);
  useEffect(() => {
    const r =
      profile?.provider === provider
        ? profile
        : settings?.provider === provider
          ? settings
          : readStore<Prefs>("dispatch", {}).byProvider?.[provider] || {};
    setModel(r.model || "");
    setThinking(r.thinking || "");
    setMode(r.mode || bypassMode(provider));
    if (profile && profile.provider !== provider) setProfile(null);
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
  // The profile names the picker while its settings are the ones chosen;
  // changing any of them makes it the provider's plain settings again.
  const applied =
    profile &&
    profile.provider === provider &&
    profile.model === model &&
    profile.thinking === thinking &&
    (profile.mode || bypassMode(provider)) === mode
      ? profile
      : null;

  // A pull request belongs to its project's new worktree: changing where drops it (not the kept one, on opening).
  const placeChanged = useRef(false);
  useEffect(() => {
    if (!placeChanged.current) {
      placeChanged.current = true;
      return;
    }
    setPr(null);
    setPrText("");
  }, [target, isolation, hostKey]);
  // The form as it is now, kept for when New agent opens again (not while a claim carries it, nor once it has
  // started an agent: it may render again before it closes).
  const finished = useRef(false);
  useEffect(() => {
    if (poolJob || finished.current) return;
    const form: FormDraft = {
      host: hostKey,
      target,
      isolation,
      branch,
      base,
      pr,
      prText,
      provider,
      model,
      thinking,
      mode,
      ...(applied ? { profile: applied.id } : {}),
    };
    writeStore(DISPATCH_FORM, form);
  }, [hostKey, target, isolation, branch, base, pr, prText, provider, model, thinking, mode, applied?.id, poolJob]);
  // Preset prompts from settings.json, read when the form opens.
  const { presets, loaded: presetsLoaded } = usePresets();
  // A typed number or URL is already an unambiguous choice. Suggestions
  // enrich it, but dispatch must not depend on Enter or a search response.
  const typedPr = prNumberOf(prText);
  const prChosen = project && isolation === "worktree"
    ? pr ?? (typedPr ? { number: typedPr } : null)
    : null;

  useEffect(() => {
    if (claiming) sawClaim.current = true;
    if (!job || claiming) return;
    setPoolJob("");
    if (!sawClaim.current) return;
    if (job.phase === "done") onDispatched(job.agentId, job.host);
    else {
      const back = draftRestored(job.id);
      setError(`${jobText(job)}${back ? " Your message is back below." : ""}`);
      if (back) setComposerKey((k) => k + 1);
    }
  }, [job, claiming]);
  // A remembered claim the server no longer has (or that ended while New agent was closed) isn't shown.
  useEffect(() => {
    if (poolJob && pool && pool.job?.id !== poolJob) setPoolJob("");
  }, [pool, poolJob]);
  const poolCheckout = pool?.checkout || "";
  const folder = isPool ? poolCheckout : workspace?.cwd || project?.path || "";
  const blocked = !online
    ? "Paseo is offline."
    : claiming && job
      ? jobText(job)
      : isPool && jobRunning(pool?.job)
        ? jobText(pool!.job!)
        : chosenHost?.unavailable
          ? isPool
            ? `${chosenHost.reason} Choose another host.`
            : `${chosenHost.name} is ${chosenHost.reason}. Choose another host.`
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
      ...(isPool
        ? {}
        : project
          ? { projectId: project.projectId }
          : { workspaceId: workspace?.workspaceId }),
    };
    if (model) body.model = model;
    if (thinking && thinkingOptions.includes(thinking)) body.thinking = thinking;
    if (mode && (!modes.length || modes.some((m) => m.id === mode)))
      body.mode = mode;
    if (applied && Object.keys(applied.features).length)
      body.features = applied.features;
    if (message.images.length) {
      // As a later send does: the images are remembered under a message ID.
      const sent = await sendBody({
        ...message,
        images: message.images.slice(0, MAX_IMAGES),
        attachments: [],
      });
      body.messageId = sent.messageId;
      body.images = sent.images;
    }
    if (prChosen) {
      body.pr = prChosen.number;
      if (prChosen.head) body.prHead = prChosen.head;
    } else if ((project || isPool) && isolation === "worktree") {
      body.branch = branch.trim() || suggested;
      if (base.trim()) body.base = base.trim();
    }
    if (host) body.host = host;
    if (isPool)
      try {
        // Answers at once; the claim, the wait for the box and the dispatch go on.
        const started = await claimPoolBox(wakeBox ? { ...body, pool: wakeBox.id } : body);
        setPoolJob(started.id);
        writeStore("dispatch", {
          ...prefs,
          provider,
          isolation,
          byProvider: { ...prefs.byProvider, [provider]: { model, thinking, mode } },
        });
        return true;
      } catch (e) {
        soundEvent("actionFailed");
        setError(errorMessage(e));
        return false;
      }
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
        profile: applied?.id,
        isolation,
        byProvider: {
          ...prefs.byProvider,
          [provider]: { model, thinking, mode },
        },
      });
      finished.current = true;
      removeStore(DISPATCH_FORM);
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

  /** A preset launches at once, with the form as it is. */
  const launch = async (preset: Preset) => {
    if (launching) return;
    setLaunching(true);
    try {
      await send({
        text: fillPreset(preset.prompt, prChosen ?? undefined),
        images: [],
        attachments: [],
      });
    } finally {
      setLaunching(false);
    }
  };
  const hereProjects = projects.filter(onHost(hostKey));
  const hereWorkspaces = workspaces.filter(onHost(hostKey));
  const providerLabel =
    available.find((p) => p.provider === provider)?.label || provider || "Provider";
  const controls = (
    <div className="agent-controls">
      <Pick
        label={hostProfiles.length ? "Provider or profile" : "Provider"}
        shown={applied?.name || providerLabel}
        value={applied ? `profile:${applied.id}` : provider}
        onChange={(v) => {
          const p = v.startsWith("profile:")
            ? hostProfiles.find((p) => `profile:${p.id}` === v)
            : undefined;
          if (p) return applyProfile(p);
          if (v === EDIT_PROFILES) return openProfileEditor(host);
          setProfile(null);
          setProvider(v);
        }}
      >
        <optgroup label="Providers">
          {available.map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Profiles">
          {hostProfiles.map((p) => (
            <option key={p.id} value={`profile:${p.id}`} title={p.notes || undefined}>
              {p.name}
            </option>
          ))}
          <option value={EDIT_PROFILES}>
            {hostProfiles.length ? "Edit profiles…" : "New profile…"}
          </option>
        </optgroup>
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
    !isPool && folder && provider && (model || models[0]?.id)
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
              aria-description={
                isPool
                  ? "A pool box's agent works in its checkout"
                  : "The project checkout, or an existing workspace, the agent works in"
              }
              value={isPool ? POOL : target}
              disabled={isPool}
              onChange={(e) => setTarget(e.target.value)}
            >
              {isPool && (
                <option value={POOL}>
                  Checkout · {poolCheckout.split("/").filter(Boolean).pop() || "on the box"}
                </option>
              )}
              {!isPool && !target && <option value="">Nothing on this host</option>}
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
          {(project || isPool) && (
            <div
              className="filter-chips new-agent-isolation"
              role="radiogroup"
              aria-label="Where in the project it runs"
              onKeyDown={(e) =>
                rovingKeyDown(e, (i) => setIsolation(ISOLATIONS[i][0]))
              }
            >
              {ISOLATIONS.map(([m, label, hint]) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={isolation === m}
                  tabIndex={isolation === m ? 0 : -1}
                  aria-description={hint}
                  onClick={() => setIsolation(m)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {project && isolation === "worktree" && (
            <PrPicker
              cwd={project.path}
              host={host}
              value={pr}
              onChange={setPr}
              text={prText}
              onTextChange={setPrText}
            />
          )}
          {((project && !prChosen) || isPool) && isolation === "worktree" && (
            <>
              <label>
                <span>
                  Branch <em>optional</em>
                </span>
                <input
                  {...plainText}
                  aria-description="The new branch and worktree name; left empty, it takes the suggested random name"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder={suggested}
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
                />
              </label>
            </>
          )}
          <p className="form-hint">
            {isPool ? <Server size={13} /> : <GitBranch size={13} />}
            {wakeBox
              ? `${wakeBox.label} is asleep: sending wakes it (claim.sh ${wakeBox.id}), waits for it to come online, then ${isolation === "worktree" ? `creates a new worktree on branch “${branch.trim() || suggested}” of` : "runs directly in"} its checkout, ${poolCheckout}.`
              : isPool
              ? `Claims an idle pool box, waits for it to come online, then ${isolation === "worktree" ? `creates a new worktree on branch “${branch.trim() || suggested}” of` : "runs directly in"} its checkout, ${poolCheckout}.`
              : workspace
              ? `Runs inside “${placeText(workspace.name, "this workspace")}” alongside its existing agents.`
              : prChosen
                ? `Creates a worktree on pull request #${prChosen.number}’s branch${prChosen.head ? ` “${prChosen.head}”` : ""}.`
                : isolation === "worktree"
                ? `Creates a new worktree on branch “${branch.trim() || suggested}”.`
                : "Runs directly in the project checkout, on its current branch."}
          </p>
        </div>
      </header>
      <div className="timeline new-agent-empty">
        <div className="chat-empty">
          <MessageSquare size={28} strokeWidth={1.5} aria-hidden="true" />
          <h2>No messages yet</h2>
          <p>
            Write the first message below to start the agent. Use /skills and @files as in any conversation.
          </p>
          {job && claiming && (
            <div className="new-agent-pool" role="status" aria-live="polite">
              <b>
                <LoaderCircle size={13} className="spinning" aria-hidden="true" />
                {jobText(job)}
              </b>
              {job.steps.length > 0 && (
                <ol>
                  {job.steps.slice(-6).map((step, i) => (
                    <li key={`${i}:${step}`}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {presetsLoaded && !claiming && (
            <div className="new-agent-presets" role="group" aria-label="Preset prompts">
              {presets.map((p) => {
                const waiting = presetNeedsPr(p) && !prChosen;
                return (
                  <button
                    key={p.name}
                    className="ghost-btn"
                    disabled={!!blocked || launching || waiting}
                    aria-description={
                      waiting
                        ? "Choose a pull request in Worktree mode first: this prompt names it"
                        : `Starts the agent now with this prompt: ${p.prompt.slice(0, 200)}`
                    }
                    onClick={() => launch(p)}
                  >
                    <Play size={12} aria-hidden="true" />
                    {p.name}
                  </button>
                );
              })}
              <button
                className="ghost-btn new-agent-presets-edit"
                aria-description="Add, change or reorder the preset prompts"
                onClick={openPresetEditor}
              >
                <Pencil size={12} aria-hidden="true" />
                {presets.length ? "Edit presets" : "Add a preset prompt"}
              </button>
            </div>
          )}
        </div>
      </div>
      <footer className="session-footer">
        {error && (
          <p className="archive-error" role="alert">
            {error}
          </p>
        )}
        <Composer
          key={composerKey}
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
/** The Host field's "New pool box" (Settings → Pool boxes). */
export const POOL = "pool:new";

/** The Host field's pool box choice, while Pool boxes is on. */
export function poolOption(pool: PoolStatus | null) {
  if (!pool?.enabled) return [];
  const idle = idleBoxes(pool.boxes).length;
  const why = pool.problem
    ? pool.problem
    : !idle
      ? "Every pool box is claimed: release one from the Hosts tab."
      : "";
  return [
    {
      key: POOL,
      name: "New pool box",
      label: "",
      wake: false,
      unavailable: !!why,
      reason: why,
      text: `New pool box · ${pool.problem ? "unavailable" : idle ? `${idle} idle` : "none idle"}`,
    },
  ];
}
/** The provider picker's entry opening the profiles' editor. */
const EDIT_PROFILES = "edit-profiles";
const STATE_TEXT = {
  online: "online",
  loading: "loading",
  slow: "slow to answer",
  stale: "not answering",
  offline: "offline",
};

/**
 * Which hosts are pool boxes (src/pool.ts), by label: while asleep they can still be picked, if claim.sh would take
 * them (`true`); a box being provisioned or failed says why it can't (a string).
 */
export function wakeable(pool: PoolStatus | null) {
  if (!pool?.enabled || pool.problem) return undefined;
  return (label: string): boolean | string => {
    const box = pool.boxes.find((b) => b.label === label);
    if (!box) return false;
    return claimable(box) || unclaimableWhy(box);
  };
}

/**
 * The Host field's choices: every host the daemon knows, local first, with
 * its connection state. A remote host the registry doesn't report online
 * can't be dispatched to (the server refuses it), so it is disabled, and
 * says why; except a pool box's (`wake`), which is asleep while released and
 * is woken by dispatching to it.
 */
export function hostOptions(hosts: Host[], wake?: (label: string) => boolean | string) {
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
      const pooled = unavailable && !h.local ? wake?.(h.label) : false;
      if (typeof pooled === "string")
        return {
          key: h.serverId,
          name,
          label: h.label,
          unavailable: true,
          wake: false,
          reason: "asleep",
          text: `${name} · asleep (${pooled})`,
        };
      if (pooled)
        return {
          key: h.serverId,
          name,
          label: h.label,
          unavailable: false,
          wake: true,
          reason: "asleep, will wake",
          text: `${name} · asleep, will wake`,
        };
      const reason = unavailable ? "offline" : STATE_TEXT[state];
      return {
        key: h.local ? LOCAL : h.serverId,
        name,
        label: h.label,
        unavailable,
        wake: false,
        reason,
        text: `${name} · ${reason}${unavailable && why ? ` (${why})` : ""}`,
      };
    });
}
