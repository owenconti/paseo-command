import { soundEvent } from "./soundCues";
import { useEffect, useState, type CSSProperties } from "react";
import {
  Archive,
  ArrowLeft,
  Box,
  GitBranch,
  LoaderCircle,
  Plus,
  Server,
  Tag,
  X,
} from "lucide-react";
import { api, errorMessage } from "./api";
import type { Agent, Project, Selection, Workspace } from "./types";
import { UNREAD, isWorking, providerName, shownStatus } from "./types";
import { Badge, CopyButton, ProviderIcon } from "./ui";
import { workspaceKey } from "./workspaces";
import { agentLabel } from "./display";
import { agentName, hostText, pathText, placeText } from "./names";
import { InlineName } from "./InlineName";
import { rename } from "./renames";

function AgentList({
  agents,
  select,
  permissionAgents,
  unread,
  branch,
}: {
  agents: Agent[];
  select: (s: Selection) => void;

  permissionAgents: Set<string>;
  unread: Set<string>;
  /** The workspace's branch, when they all share one. */
  branch?: string;
}) {
  if (!agents.length) return <p className="muted">No active agents here.</p>;
  return (
    <div className="place-agents">
      {agents.map((a) => (
        <button
          key={a.id}
          className="registry-row"
          aria-description={`${agentName(a, branch)}\n${permissionAgents.has(a.id) ? "Awaiting approval" : unread.has(a.id) ? "Unread reply" : shownStatus(a)}`}
          onClick={() => select({ type: "agent", id: a.id })}
        >
          <ProviderIcon provider={a.provider} />
          <span className="row-name">
            <b>{agentName(a, branch)}</b>
            {/* An issue key from the branch, never the agent's ID. */}
            <small>
              {[agentLabel(a, branch).key, providerName(a.provider), a.created]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </span>
          <Badge
            status={
              permissionAgents.has(a.id)
                ? "awaiting approval"
                : unread.has(a.id)
                  ? UNREAD
                  : a.status
            }
          />
        </button>
      ))}
    </div>
  );
}

/** Paseo's label colours. */
const LABEL_COLORS: Record<string, string> = {
  violet: "#8b5cf6",
  sky: "#0ea5e9",
  emerald: "#10b981",
  orange: "#f97316",
  pink: "#ec4899",
  indigo: "#6366f1",
  teal: "#14b8a6",
  red: "#ef4444",
  amber: "#f59e0b",
  blue: "#3b82f6",
};

/** The workspace's Paseo labels: add one (new or from the catalog) or remove one. */
function WorkspaceLabels({
  workspace,
  online,
}: {
  workspace: Workspace;
  online: boolean;
}) {
  const labels = workspace.labels ?? [];
  const [catalog, setCatalog] = useState<{ name: string; color: string }[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const host = workspace.host
    ? `?host=${encodeURIComponent(workspace.host)}`
    : "";
  // Refetch the catalog whenever the assigned labels change.
  const labelKey = labels.join("\n");
  useEffect(() => {
    api<{ name: string; color: string }[]>(`workspace-labels${host}`)
      .then(setCatalog)
      .catch(() => {});
  }, [host, labelKey]);
  const change = async (name: string, assigned: boolean) => {
    setPending(true);
    setError("");
    try {
      await api(`workspaces/${workspace.workspaceId}/labels`, {
        name,
        assigned,
        ...(workspace.host ? { host: workspace.host } : {}),
      });
      setDraft(null);
    } catch (e) {
      soundEvent("actionFailed");
      setError(errorMessage(e) || "Could not change the label. Try again.");
    } finally {
      setPending(false);
    }
  };
  const colorOf = (name: string) =>
    LABEL_COLORS[
      catalog.find((l) => l.name.toLowerCase() === name.toLowerCase())?.color ??
        ""
    ] ?? "var(--text-4)";
  return (
    <div className="workspace-labels">
      {labels.map((name) => (
        <span
          key={name}
          className="workspace-label"
          style={{ "--label": colorOf(name) } as CSSProperties}
        >
          <span className="dot" />
          {name}
          <button
            aria-label={`Remove label ${name}`}
            data-tip="Remove label"
            disabled={pending || !online}
            onClick={() => change(name, false)}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {draft === null ? (
        <button
          className="ghost-btn workspace-label-add"
          disabled={!online}
          onClick={() => setDraft("")}
        >
          <Tag size={12} />
          Add label
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() && !pending) change(draft, true);
          }}
        >
          <input
            autoFocus
            aria-label="Label name"
            placeholder="Label name"
            list="workspace-label-catalog"
            maxLength={40}
            value={draft}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(null);
                setError("");
              }
            }}
            onBlur={() => !draft.trim() && setDraft(null)}
          />
          <datalist id="workspace-label-catalog">
            {catalog
              .filter(
                (l) =>
                  !labels.some((n) => n.toLowerCase() === l.name.toLowerCase()),
              )
              .map((l) => (
                <option key={l.name} value={l.name} />
              ))}
          </datalist>
        </form>
      )}
      {error && <p className="workspace-label-error">{error}</p>}
    </div>
  );
}

export function WorkspaceView({
  workspace,
  agents,
  real,
  busy,
  online,
  onBack,
  onDispatch,
  onArchive,
  archiving = false,
  onNotice,
  select,
  permissionAgents,
  unread,
}: {
  workspace: Workspace;
  agents: Agent[];
  real: boolean;
  busy: boolean;
  online: boolean;
  onBack: () => void;
  onDispatch: () => void;
  onArchive: () => void;
  /** Being archived in the background. */
  archiving?: boolean;
  onNotice: (message: string) => void;
  select: (s: Selection) => void;

  permissionAgents: Set<string>;
  unread: Set<string>;
}) {
  return (
    <div className="place">
      <div className="session-nav">
        <button
          className="ghost-btn"
          onClick={onBack}
          aria-description="Back to fleet (Esc)"
        >
          <ArrowLeft size={15} />
          Fleet
        </button>
      </div>
      <div className="overview-title">
        <span className="base-icon">
          <GitBranch size={21} />
        </span>
        <div>
          {real ? (
            <InlineName
              kind="workspace"
              renameKey={workspaceKey(workspace)}
              shown={placeText(workspace.name, "Workspace")}
              value={workspace.name}
              disabled={!online}
              onSave={(name) =>
                void rename(
                  {
                    kind: "workspace",
                    key: workspaceKey(workspace),
                    id: workspace.workspaceId,
                    host: workspace.host,
                  },
                  name,
                  onNotice,
                )
              }
            />
          ) : (
            <h2>{placeText(workspace.name, "Workspace")}</h2>
          )}
          <p>
            {workspace.branch && workspace.branch !== workspace.name && (
              <span className="place-branch">
                <GitBranch size={11} />
                {placeText(workspace.branch)}
              </span>
            )}
            <span>
              {placeText(workspace.project, "Project")} · {workspace.isolation}
            </span>
            {workspace.hostLabel && (
              <span
                className={`host-chip ${workspace.stale ? "stale" : ""}`}
                aria-description={
                  workspace.stale
                    ? `${hostText(workspace)} isn't answering; this is its last-known state.`
                    : `On host ${hostText(workspace)}`
                }
              >
                <Server size={9} />
                <span>{hostText(workspace)}</span>
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="path-row">
        <code>{pathText(workspace.cwd, [workspace.workspaceId])}</code>
        <CopyButton value={workspace.cwd} label="Copy path" />
      </div>
      {real && <WorkspaceLabels workspace={workspace} online={online} />}
      <div className="place-actions">
        <button
          className="primary"
          aria-description={
            real
              ? "Start a new agent in this workspace (D)"
              : "Start a new agent in this project's checkout (D)"
          }
          onClick={onDispatch}
        >
          <Plus size={14} />
          {real ? "Dispatch into this workspace" : "Dispatch to this project"}
        </button>
        {real && (
          <button
            className="workspace-archive"
            aria-description={
              archiving
                ? "This workspace is being archived"
                : online
                  ? "Archive this workspace (asks to confirm first)"
                  : "Paseo is offline"
            }
            disabled={busy || !online || archiving}
            onClick={onArchive}
          >
            {archiving ? (
              <LoaderCircle size={14} className="spinning" />
            ) : (
              <Archive size={14} />
            )}
            {archiving ? "Archiving…" : "Archive"}
          </button>
        )}
      </div>
      <div className="section-label">
        Agents here <span>{agents.length}</span>
      </div>
      <AgentList
        agents={agents}
        select={select}

        permissionAgents={permissionAgents}
        unread={unread}
        branch={workspace.branch}
      />
    </div>
  );
}

export function ProjectView({
  project,
  workspaces,
  agentsAt,
  agents,
  onBack,
  onDispatch,
  select,
  permissionAgents,
  unread,
}: {
  project: Project;
  workspaces: Workspace[];
  /** By host-qualified workspace key. */
  agentsAt: (workspaceKey: string) => Agent[];
  agents: Agent[];
  onBack: () => void;
  onDispatch: () => void;
  select: (s: Selection) => void;

  permissionAgents: Set<string>;
  unread: Set<string>;
}) {
  return (
    <div className="place">
      <div className="session-nav">
        <button
          className="ghost-btn"
          onClick={onBack}
          aria-description="Back to fleet (Esc)"
        >
          <ArrowLeft size={15} />
          Fleet
        </button>
      </div>
      <div className="overview-title">
        <span className="base-icon">
          <Box size={21} />
        </span>
        <div>
          <h2>{placeText(project.name, "Project")}</h2>
          <p>
            {project.kind === "git" ? "Git repository" : "Local directory"}
            {project.hostLabel && (
              <span
                className={`host-chip ${project.stale ? "stale" : ""}`}
                aria-description={
                  project.stale
                    ? `${hostText(project)} isn't answering; this is its last-known state.`
                    : `On host ${hostText(project)}`
                }
              >
                <Server size={9} />
                <span>{hostText(project)}</span>
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="path-row">
        <code>{pathText(project.path, [project.projectId])}</code>
        <CopyButton value={project.path} label="Copy path" />
      </div>
      <div className="place-actions">
        <button
          className="primary"
          aria-description="Start a new agent in this project (D)"
          onClick={onDispatch}
        >
          <Plus size={14} />
          Dispatch to this project
        </button>
      </div>
      <div className="section-label">
        Workspaces <span>{workspaces.length}</span>
      </div>
      <div className="workspace-list">
        {workspaces.map((w) => {
          const key = workspaceKey(w);
          const fleet = agentsAt(key);
          const running = fleet.filter((a) => isWorking(a)).length;
          return (
            <button
              key={key}
              className="registry-row"
              aria-description={`Open workspace ${placeText(w.name, "Workspace")}${w.branch && w.branch !== w.name ? ` (${placeText(w.branch)})` : ""}`}
              onClick={() => select({ type: "workspace", id: key })}
            >
              <span className="registry-icon">
                <GitBranch size={15} />
              </span>
              <span className="row-name">
                <b>{placeText(w.name, "Workspace")}</b>
                <small>
                  {w.branch && w.branch !== w.name
                    ? `${placeText(w.branch)} · `
                    : ""}
                  {fleet.length} {fleet.length === 1 ? "agent" : "agents"} ·{" "}
                  {w.isolation}
                </small>
              </span>
              <span className={`badge ${running ? "green" : "slate"}`}>
                {running ? `${running} running` : "idle"}
              </span>
            </button>
          );
        })}
        {!workspaces.length && <p className="muted">No active workspaces.</p>}
      </div>
      <div className="section-label">
        Agents <span>{agents.length}</span>
      </div>
      <AgentList
        agents={agents}
        select={select}

        permissionAgents={permissionAgents}
        unread={unread}
      />
    </div>
  );
}
