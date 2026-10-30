import { useLayoutEffect, useRef } from "react";
import { motion, useIsPresent } from "framer-motion";
import { Box, Trash2, X } from "lucide-react";
import type { Agent, Project, Workspace } from "./types";
import { isRunning } from "./types";
import { useFocusTrap } from "./focus";
import { agentName, hostText, pathText, placeText } from "./names";

/** Confirms removing a project: what is archived with it, and what stays. */
export function RemoveProjectDialog({
  project,
  workspaces,
  agents,
  onCancel,
  onConfirm,
}: {
  project: Project;
  /** Its active workspaces, archived with it. */
  workspaces: Workspace[];
  /** Their agents. */
  agents: Agent[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const present = useIsPresent();
  useFocusTrap(dialog, cancel, present);
  useLayoutEffect(() => {
    if (!present && dialog.current?.contains(document.activeElement))
      (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  const running = agents.filter((a) => isRunning(a.status)).length;
  const name = placeText(project.name, "Project");
  return (
    <motion.div
      className="modal-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={onCancel}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="remove-project-title"
        aria-describedby="remove-project-description"
        className="command-dialog archive-dialog panel"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
          opacity: 0,
          y: 15,
          scale: 0.97,
          transition: { duration: 0.12 },
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <span className="archive-symbol">
            <Trash2 size={22} />
          </span>
          <h2 id="remove-project-title">Remove this project?</h2>
          <button
            data-tip="Close without removing (Esc)"
            className="icon-btn"
            aria-label="Close remove dialog"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="archive-content">
          <div className="archive-target">
            <b>{name}</b>
            <span>
              <Box size={13} />
              {project.kind === "git" ? "Git repository" : "Local directory"}
              {project.hostLabel ? ` · ${hostText(project)}` : ""}
            </span>
            <code>{pathText(project.path, [project.projectId])}</code>
          </div>
          <p id="remove-project-description">
            Paseo will stop listing this project.
            {workspaces.length > 0
              ? " It archives the project's workspaces first, with their agents and terminals. Any running agents are interrupted."
              : " It has no active workspaces."}
          </p>
          <div className="archive-impact">
            <b>Project folder preserved</b>
            <p>
              The folder and its files stay on disk; add it again from Add
              project at any time. Worktrees Paseo owns may be removed with
              their workspaces, so commit any work you want to keep first.
            </p>
          </div>
          {workspaces.length > 0 && (
            <div className="archive-activity">
              <span className="section-label">Archived with it</span>
              <p>
                {workspaces.length}{" "}
                {workspaces.length === 1 ? "workspace" : "workspaces"} ·{" "}
                {agents.length} active {agents.length === 1 ? "agent" : "agents"}
                {running > 0 ? ` · ${running} running` : ""}
              </p>
              <ul>
                {workspaces.slice(0, 4).map((w) => (
                  <li key={w.workspaceId}>
                    <span>{placeText(w.name, "Workspace")}</span>
                    <small>{w.isolation}</small>
                  </li>
                ))}
              </ul>
              {workspaces.length > 4 && (
                <small>And {workspaces.length - 4} more.</small>
              )}
              {agents.length > 0 && (
                <small>
                  Agents: {agents.slice(0, 3).map((a) => agentName(a)).join(", ")}
                  {agents.length > 3 ? ` and ${agents.length - 3} more` : ""}
                </small>
              )}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button
            aria-description="Close without removing (Esc)"
            ref={cancel}
            className="secondary"
            onClick={onCancel}
          >
            Keep project
          </button>
          <button
            aria-description="Archive this project's workspaces and stop listing it; its folder stays on disk"
            className="danger"
            onClick={onConfirm}
          >
            <Trash2 size={15} />
            Remove project
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
