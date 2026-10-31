import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useIsPresent } from "framer-motion";
import { CircleDashed, CornerLeftUp, Users, X } from "lucide-react";
import { readStore, removeStore, writeStore } from "../api";
import { useFocusTrap } from "../focus";
import { plainText } from "../ui";
import { Picker, type PickerOption } from "./Picker";
import { propertySpec, type PropertyField } from "./Properties";
import { linearStore, loadIssue, useLinear } from "./store";
import type { LinearIssue, LinearWorkspace } from "./types";

/** What the dialog starts with: the place's team or project, or the parent of a sub-issue. */
export type CreateInitial = { teamId?: string; parentId?: string; projectId?: string; stateId?: string };

/** What's typed and chosen, kept as a draft until Linear has the issue. */
type Draft = {
  teamId?: string;
  title: string;
  description: string;
  stateId?: string;
  priority: LinearIssue["priority"];
  assigneeId?: string;
  labelIds: string[];
  projectId?: string;
};

const DRAFT_KEY = "linear:draft:new";
const LAST_TEAM_KEY = "linear:lastTeam";
const FIELDS: PropertyField[] = ["status", "priority", "assignee", "labels", "project"];

/** A team's starting status, as Linear's own new issues start: its first backlog state, else its first to-do. */
function defaultState(ws: LinearWorkspace | undefined, teamId: string): string | undefined {
  const states = (ws?.states ?? []).filter((s) => s.teamId === teamId).sort((a, b) => a.position - b.position);
  return (states.find((s) => s.type === "backlog") ?? states.find((s) => s.type === "unstarted") ?? states[0])?.id;
}

function readDraft(): Draft {
  const was = readStore<Partial<Draft> | null>(DRAFT_KEY, null);
  const ok = was && typeof was === "object";
  return {
    teamId: ok && typeof was.teamId === "string" ? was.teamId : undefined,
    title: ok && typeof was.title === "string" ? was.title : "",
    description: ok && typeof was.description === "string" ? was.description : "",
    stateId: ok && typeof was.stateId === "string" ? was.stateId : undefined,
    priority: ok && [0, 1, 2, 3, 4].includes(was.priority as number) ? (was.priority as Draft["priority"]) : 0,
    assigneeId: ok && typeof was.assigneeId === "string" ? was.assigneeId : undefined,
    labelIds: ok && Array.isArray(was.labelIds) ? was.labelIds.filter((x) => typeof x === "string") : [],
    projectId: ok && typeof was.projectId === "string" ? was.projectId : undefined,
  };
}

/**
 * The draft made to fit the workspace: a team it has (the draft's, else the
 * one last used, else the first), a status of that team, and only the labels
 * and project that team can have.
 */
function fit(draft: Draft, ws: LinearWorkspace | undefined): Draft {
  const teams = ws?.teams ?? [];
  const lastTeam = readStore<string | null>(LAST_TEAM_KEY, null);
  const teamId = [draft.teamId, lastTeam, teams[0]?.id].find((t) => t && teams.some((x) => x.id === t));
  if (!ws || !teamId) return draft;
  const stateOk = ws.states.some((s) => s.id === draft.stateId && s.teamId === teamId);
  const project = ws.projects.find((p) => p.id === draft.projectId);
  return {
    ...draft,
    teamId,
    stateId: stateOk ? draft.stateId : defaultState(ws, teamId),
    labelIds: draft.labelIds.filter((id) => {
      const label = ws.labels.find((l) => l.id === id);
      return label && (!label.teamId || label.teamId === teamId);
    }),
    projectId: project?.teamIds.includes(teamId) ? draft.projectId : undefined,
  };
}

/** The draft as an issue, so the detail's pickers (`propertySpec`) choose its properties. */
function asIssue(draft: Draft): LinearIssue {
  return {
    id: "draft",
    key: "",
    title: draft.title,
    url: "",
    teamId: draft.teamId ?? "",
    stateId: draft.stateId ?? "",
    priority: draft.priority,
    assigneeId: draft.assigneeId,
    labelIds: draft.labelIds,
    projectId: draft.projectId,
    branchName: "",
    subscriberIds: [],
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * Linear's Create issue dialog (its C): the team (the place's, else the one
 * last used, else the first), title, description, status, priority, assignee,
 * labels and project, then Create (⌘↩). With Create more on it stays open for
 * the next one, emptied of title and description. What's typed is kept as a
 * draft (`linear:draft:new`) until Linear has the issue, through closing and
 * reopening, and stays when Linear refuses. Closing after a create passes the
 * new issue (which then opens).
 */
export function CreateIssue({
  initial = {},
  onClose,
}: {
  initial?: CreateInitial;
  onClose: (created?: LinearIssue) => void;
}) {
  const data = useLinear((d) => d);
  const ws = data.workspace;
  const parent = useLinear((d) => (initial.parentId ? d.issues.get(initial.parentId) : undefined));
  const [draft, setDraft] = useState<Draft>(() => {
    // Where it opened (a team, a project, a parent) wins over the draft's choices; what's typed stays.
    const was = readDraft();
    return fit(
      {
        ...was,
        teamId: initial.teamId ?? was.teamId,
        projectId: initial.projectId ?? was.projectId,
        stateId: initial.stateId ?? was.stateId,
      },
      ws,
    );
  });
  const [open, setOpen] = useState<"team" | PropertyField | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string>();

  const dialog = useRef<HTMLElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const present = useIsPresent();
  useFocusTrap(dialog, title, present);
  useLayoutEffect(() => {
    if (!present && dialog.current?.contains(document.activeElement))
      (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  // The workspace may come in after it opened: a team then.
  useEffect(() => {
    if (ws && !draft.teamId) setDraft((d) => fit(d, ws));
  }, [ws, draft.teamId]);
  // Kept while anything is typed; an empty one isn't a draft.
  useEffect(() => {
    if (draft.title.trim() || draft.description.trim()) writeStore(DRAFT_KEY, draft);
    else removeStore(DRAFT_KEY);
  }, [draft]);

  const change = (next: Partial<Draft>) => {
    setError("");
    setDraft((d) => ({ ...d, ...next }));
  };
  // Another team: its own starting status; labels and a project it can't have don't come along.
  const chooseTeam = (teamId: string) =>
    setDraft((d) => (teamId === d.teamId ? d : fit({ ...d, teamId, stateId: undefined }, ws)));

  const submit = async () => {
    const name = draft.title.trim();
    if (!name || !draft.teamId || saving) return;
    setSaving(true);
    setError("");
    const answer = await linearStore.createIssue({
      teamId: draft.teamId,
      title: name,
      ...(draft.description.trim() ? { description: draft.description } : {}),
      ...(draft.stateId ? { stateId: draft.stateId } : {}),
      ...(draft.priority ? { priority: draft.priority } : {}),
      ...(draft.assigneeId ? { assigneeId: draft.assigneeId } : {}),
      ...(draft.labelIds.length ? { labelIds: draft.labelIds } : {}),
      ...(draft.projectId ? { projectId: draft.projectId } : {}),
      ...(initial.parentId ? { parentId: initial.parentId } : {}),
    });
    setSaving(false);
    if ("error" in answer) {
      setError(`Linear didn't save that: ${answer.error}`);
      return;
    }
    writeStore(LAST_TEAM_KEY, draft.teamId);
    // The parent's sub-issues come with its details: asked for again.
    if (parent) loadIssue(parent.key).catch(() => {});
    if (createMore) {
      setDraft((d) => ({ ...d, title: "", description: "" }));
      setCreated(answer.issue.key);
      title.current?.focus();
    } else {
      removeStore(DRAFT_KEY);
      onClose(answer.issue);
    }
  };

  const team = ws?.teams.find((t) => t.id === draft.teamId);
  const issue = asIssue(draft);
  const chip = (
    field: "team" | PropertyField,
    label: string,
    text: string,
    empty: boolean,
    icon: ReactNode,
    picker: ReactNode,
  ) => (
    <span key={field} className="menu-anchor linear-prop-anchor">
      <button
        type="button"
        className={`linear-prop-btn linear-create-chip${empty ? " empty" : ""}`}
        aria-label={`${label}: ${text}`}
        aria-haspopup="listbox"
        aria-expanded={open === field}
        onClick={(e) => {
          e.currentTarget.focus({ preventScroll: true });
          setOpen(open === field ? null : field);
        }}
      >
        {icon ?? <CircleDashed size={13} aria-hidden="true" />}
        <span className="linear-prop-text">{text}</span>
      </button>
      {open === field && picker}
    </span>
  );
  const teamOptions: PickerOption<unknown>[] = (ws?.teams ?? []).map((t) => ({ value: t.id, text: t.name, hint: t.key }));

  return (
    <motion.div
      className="modal-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={() => onClose()}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="linear-create-title"
        className="command-dialog linear-create panel"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 15, scale: 0.97, transition: { duration: 0.12 } }}
        onClick={(e) => e.stopPropagation()}
        // Keys typed here are the dialog's (not the app's shortcuts); a picker's own keys stop at it.
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter" && e.metaKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key !== "Tab") e.stopPropagation();
        }}
      >
        <div className="dialog-heading">
          <span className="linear-create-team">{team?.key ?? "…"}</span>
          <h2 id="linear-create-title">New issue</h2>
          <button className="icon-btn" aria-label="Close" data-tip="Close; the draft stays (Esc)" onClick={() => onClose()}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {initial.parentId && (
          <p className="linear-create-parent">
            <CornerLeftUp size={12} aria-hidden="true" />
            <span>Sub-issue of {parent ? <b>{parent.key}</b> : "another issue"}</span>
            {parent && <span className="linear-create-parent-title">{parent.title}</span>}
          </p>
        )}
        <input
          {...plainText}
          ref={title}
          className="linear-create-name"
          aria-label="Issue title"
          placeholder="Issue title"
          maxLength={255}
          value={draft.title}
          onChange={(e) => change({ title: e.target.value })}
        />
        <textarea
          className="linear-create-description"
          aria-label="Description"
          placeholder="Add a description… (Markdown)"
          value={draft.description}
          onChange={(e) => change({ description: e.target.value })}
        />
        <div className="linear-create-props" role="group" aria-label="Properties">
          {chip(
            "team",
            "Team",
            team?.name ?? "No team",
            !team,
            <Users size={13} aria-hidden="true" />,
            <Picker
              label="Team"
              options={teamOptions}
              value={draft.teamId ?? null}
              onPick={(v) => chooseTeam(v as string)}
              onClose={() => setOpen(null)}
            />,
          )}
          {draft.teamId &&
            FIELDS.map((field) => {
              const spec = propertySpec(field, issue, data);
              if (!spec) return null;
              return chip(
                field,
                spec.label,
                spec.text,
                spec.empty,
                spec.icon,
                <Picker
                  label={spec.label}
                  options={spec.options}
                  value={spec.value}
                  multiple={spec.multiple}
                  onPick={(value) => {
                    const { patch } = spec.change(value);
                    const { milestoneId: _, ...rest } = patch;
                    change(rest as Partial<Draft>);
                  }}
                  onClose={() => setOpen(null)}
                />,
              );
            })}
        </div>
        {error && (
          <p className="archive-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <span role="status">
            {created ? (
              <>Created {created}</>
            ) : (
              <>
                <kbd>⌘</kbd>
                <kbd>↩</kbd> to create
              </>
            )}
          </span>
          <label className="linear-create-more">
            <input type="checkbox" checked={createMore} onChange={(e) => setCreateMore(e.target.checked)} />
            Create more
          </label>
          <button
            className="primary"
            disabled={!draft.title.trim() || !draft.teamId || saving}
            onClick={() => void submit()}
          >
            Create issue
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
