import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, CircleDashed, CornerLeftUp, Diamond, Gauge, Minus, RefreshCcw, Tag, UserX, X } from "lucide-react";
import { ago } from "../api";
import { onAppCommand, type AppCommand } from "../appCommands";
import { Dot, Person, Priority, PRIORITY_LABEL } from "./bits";
import { Picker, type PickerOption } from "./Picker";
import { linearStore, useLinear, type LinearData } from "./store";
import type { LinearCycle, LinearIssue, LinearState } from "./types";

/** The properties a picker edits. */
export type PropertyField =
  | "status"
  | "priority"
  | "assignee"
  | "labels"
  | "estimate"
  | "cycle"
  | "project"
  | "milestone"
  | "parent";

const STATE_ORDER: LinearState["type"][] = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
/** Linear's order: none, then urgent to low. */
const PRIORITIES = [0, 1, 2, 3, 4] as const;

const points = (n: number) => (n === 1 ? "1 point" : `${n} points`);
const cycleName = (c: LinearCycle) => (c.name ? `Cycle ${c.number} · ${c.name}` : `Cycle ${c.number}`);

type Spec = {
  label: string;
  /** What the property's button says. */
  text: string;
  /** No value: the button's text is dimmed. */
  empty: boolean;
  icon?: ReactNode;
  options: PickerOption<unknown>[];
  value: unknown;
  multiple?: boolean;
  /** The issueUpdate input and the matching change to the issue in the store. */
  change(value: unknown): { input: Record<string, unknown>; patch: Partial<LinearIssue> };
};

/** Saves an edit to Linear, shown at once and rolled back (with a notice) if Linear refuses. */
function save(issue: LinearIssue, spec: Spec, value: unknown): void {
  const { input, patch } = spec.change(value);
  void linearStore.write("issueUpdate", { id: issue.id, ...input }, { issueId: issue.id, patch });
}

/** The issue's ids under it (its sub-issues, theirs…), as far as the store knows: none can be its parent. */
function descendants(issue: LinearIssue, data: LinearData): Set<string> {
  const below = new Set<string>();
  const all = [...data.issues.values()];
  const visit = (id: string) => {
    for (const other of all)
      if (other.parentId === id && !below.has(other.id)) {
        below.add(other.id);
        visit(other.id);
      }
  };
  for (const child of issue.childIds ?? []) below.add(child);
  visit(issue.id);
  return below;
}

/** A property's picker: its options from the workspace, its value from the issue; null when it doesn't apply. */
export function propertySpec(field: PropertyField, issue: LinearIssue, data: LinearData): Spec | null {
  const ws = data.workspace;
  const team = ws?.teams.find((t) => t.id === issue.teamId);
  const project = ws?.projects.find((p) => p.id === issue.projectId);
  const none = (text: string, icon: ReactNode = <Minus size={13} />): PickerOption<unknown> => ({ value: null, text, icon });
  const set = (key: keyof LinearIssue, inputKey: string = key) => (value: unknown) => ({
    input: { [inputKey]: value },
    patch: { [key]: value ?? undefined } as Partial<LinearIssue>,
  });
  switch (field) {
    case "status": {
      const states = (ws?.states ?? [])
        .filter((s) => s.teamId === issue.teamId)
        .sort((a, b) => STATE_ORDER.indexOf(a.type) - STATE_ORDER.indexOf(b.type) || a.position - b.position);
      const state = states.find((s) => s.id === issue.stateId);
      return {
        label: "Status",
        text: state?.name ?? "Unknown",
        empty: !state,
        icon: state && <Dot color={state.color} />,
        options: states.map((s) => ({ value: s.id, text: s.name, icon: <Dot color={s.color} /> })),
        value: issue.stateId,
        change: set("stateId"),
      };
    }
    case "priority":
      return {
        label: "Priority",
        text: PRIORITY_LABEL[issue.priority],
        empty: issue.priority === 0,
        icon: <Priority priority={issue.priority} />,
        options: PRIORITIES.map((p) => ({ value: p, text: PRIORITY_LABEL[p], icon: <Priority priority={p} /> })),
        value: issue.priority,
        change: set("priority"),
      };
    case "assignee": {
      const users = [...(ws?.users ?? [])].sort(
        (a, b) => Number(b.id === ws?.viewerId) - Number(a.id === ws?.viewerId) || a.name.localeCompare(b.name),
      );
      const assignee = users.find((u) => u.id === issue.assigneeId);
      return {
        label: "Assignee",
        text: assignee?.name ?? "Unassigned",
        empty: !assignee,
        icon: assignee ? <Person user={assignee} /> : <UserX size={13} aria-hidden="true" />,
        options: [
          none("No assignee", <UserX size={13} />),
          ...users.map((u) => ({
            value: u.id,
            text: u.name,
            icon: <Person user={u} />,
            hint: u.id === ws?.viewerId ? "You" : undefined,
          })),
        ],
        value: issue.assigneeId ?? null,
        change: set("assigneeId"),
      };
    }
    case "labels": {
      const labels = (ws?.labels ?? []).filter((l) => !l.teamId || l.teamId === issue.teamId || issue.labelIds.includes(l.id));
      const on = issue.labelIds.map((id) => labels.find((l) => l.id === id)).filter((l) => l !== undefined);
      return {
        label: "Labels",
        text: on.length ? on.map((l) => l.name).join(", ") : "No labels",
        empty: !on.length,
        icon: on.length ? (
          <span className="linear-prop-dots">
            {on.map((l) => (
              <Dot key={l.id} color={l.color} />
            ))}
          </span>
        ) : (
          <Tag size={13} aria-hidden="true" />
        ),
        options: labels.map((l) => ({ value: l.id, text: l.name, icon: <Dot color={l.color} /> })),
        value: issue.labelIds,
        multiple: true,
        change: (value) => ({ input: { labelIds: value }, patch: { labelIds: value as string[] } }),
      };
    }
    case "estimate": {
      if (!team?.estimates.length) return null;
      return {
        label: "Estimate",
        text: issue.estimate != null ? points(issue.estimate) : "No estimate",
        empty: issue.estimate == null,
        icon: <Gauge size={13} aria-hidden="true" />,
        options: [none("No estimate"), ...team.estimates.map((n) => ({ value: n, text: points(n) }))],
        value: issue.estimate ?? null,
        change: set("estimate"),
      };
    }
    case "cycle": {
      if (!team?.cyclesEnabled) return null;
      const cycles = (ws?.cycles ?? [])
        .filter((c) => c.teamId === issue.teamId && (c.isActive || c.isNext || c.id === issue.cycleId))
        .sort((a, b) => a.number - b.number);
      const cycle = cycles.find((c) => c.id === issue.cycleId);
      return {
        label: "Cycle",
        text: cycle ? cycleName(cycle) : issue.cycleId ? "Another cycle" : "No cycle",
        empty: !issue.cycleId,
        icon: <RefreshCcw size={13} aria-hidden="true" />,
        options: [
          none("No cycle"),
          ...cycles.map((c) => ({
            value: c.id,
            text: cycleName(c),
            hint: c.isActive ? "Current" : c.isNext ? "Next" : undefined,
          })),
        ],
        value: issue.cycleId ?? null,
        change: set("cycleId"),
      };
    }
    case "project": {
      const projects = (ws?.projects ?? [])
        .filter((p) => p.teamIds.includes(issue.teamId) || p.id === issue.projectId)
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        label: "Project",
        text: project?.name ?? (issue.projectId ? "Another project" : "No project"),
        empty: !issue.projectId,
        icon: project ? <Dot color={project.color} /> : <Box size={13} aria-hidden="true" />,
        options: [
          none("No project"),
          ...projects.map((p) => ({ value: p.id, text: p.name, icon: <Dot color={p.color} /> })),
        ],
        value: issue.projectId ?? null,
        change: (value) => {
          const next = ws?.projects.find((p) => p.id === value);
          // A milestone belongs to its project: moving the issue elsewhere clears it.
          const keep = !issue.milestoneId || next?.milestones.some((m) => m.id === issue.milestoneId);
          return keep
            ? { input: { projectId: value }, patch: { projectId: (value as string | null) ?? undefined } }
            : {
                input: { projectId: value, projectMilestoneId: null },
                patch: { projectId: (value as string | null) ?? undefined, milestoneId: undefined },
              };
        },
      };
    }
    case "milestone": {
      if (!project?.milestones.length && !issue.milestoneId) return null;
      const milestone = project?.milestones.find((m) => m.id === issue.milestoneId);
      return {
        label: "Milestone",
        text: milestone?.name ?? (issue.milestoneId ? "Another milestone" : "No milestone"),
        empty: !issue.milestoneId,
        icon: <Diamond size={12} aria-hidden="true" />,
        options: [none("No milestone"), ...(project?.milestones ?? []).map((m) => ({ value: m.id, text: m.name }))],
        value: issue.milestoneId ?? null,
        change: set("milestoneId", "projectMilestoneId"),
      };
    }
    case "parent": {
      const below = descendants(issue, data);
      const candidates = [...data.issues.values()]
        .filter((i) => i.id !== issue.id && !i.archivedAt && !below.has(i.id))
        .sort((a, b) => Number(b.teamId === issue.teamId) - Number(a.teamId === issue.teamId) || b.updatedAt.localeCompare(a.updatedAt));
      const parent = issue.parentId ? data.issues.get(issue.parentId) : undefined;
      return {
        label: "Parent",
        text: parent ? `${parent.key} ${parent.title}` : issue.parentId ? "Another issue" : "No parent",
        empty: !issue.parentId,
        icon: <CornerLeftUp size={13} aria-hidden="true" />,
        options: [none("No parent"), ...candidates.map((i) => ({ value: i.id, text: `${i.key} ${i.title}` }))],
        value: issue.parentId ?? null,
        change: set("parentId"),
      };
    }
  }
}

/** One property's picker for an issue, saving what's picked; for the detail's buttons and a row's context menu. */
export function PropertyPicker({
  field,
  issue,
  onClose,
}: {
  field: PropertyField;
  issue: LinearIssue;
  onClose: () => void;
}) {
  const data = useLinear((d) => d);
  const spec = propertySpec(field, issue, data);
  if (!spec) return null;
  return (
    <Picker
      label={spec.label}
      options={spec.options}
      value={spec.value}
      multiple={spec.multiple}
      onPick={(value) => save(issue, spec, value)}
      onClose={onClose}
    />
  );
}

/** ⌘K's edits of the open issue (and the Linear tab's keys for them). */
const COMMANDS: [AppCommand, PropertyField][] = [
  ["linear-status", "status"],
  ["linear-priority", "priority"],
  ["linear-assignee", "assignee"],
  ["linear-labels", "labels"],
  ["linear-project", "project"],
  ["linear-cycle", "cycle"],
  ["linear-estimate", "estimate"],
  ["linear-milestone", "milestone"],
  ["linear-parent", "parent"],
];
const FIELDS: PropertyField[] = ["status", "priority", "assignee", "labels", "estimate", "cycle", "project", "milestone", "parent"];

function DueDate({ issue }: { issue: LinearIssue }) {
  const [draft, setDraft] = useState(issue.dueDate ?? "");
  const input = useRef<HTMLInputElement>(null);
  // ⌘K's "Set the due date": the field, with its calendar where the browser has one.
  useEffect(
    () =>
      onAppCommand("linear-due-date", () => {
        const el = input.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "nearest" });
        try {
          el.showPicker?.();
        } catch {
          // Not allowed here (no user gesture): the focused field is enough.
        }
      }),
    [],
  );
  useEffect(() => setDraft(issue.dueDate ?? ""), [issue.dueDate]);
  const commit = (day: string) => {
    if (day === (issue.dueDate ?? "")) return;
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return setDraft(issue.dueDate ?? "");
    void linearStore.write(
      "issueUpdate",
      { id: issue.id, dueDate: day || null },
      { issueId: issue.id, patch: { dueDate: day || undefined } },
    );
  };
  return (
    <span className="linear-prop-due">
      <input
        ref={input}
        type="date"
        className={`linear-prop-date${draft ? "" : " empty"}`}
        aria-label="Due date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Escape" && draft !== (issue.dueDate ?? "")) {
            e.stopPropagation();
            setDraft(issue.dueDate ?? "");
          }
        }}
      />
      {issue.dueDate && (
        <button
          className="icon-btn linear-prop-clear"
          aria-label="Clear the due date"
          data-tip="Clear the due date"
          onClick={() => {
            setDraft("");
            commit("");
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/**
 * The open issue's properties, each a button that opens its picker and saves
 * what's picked to Linear at once (status, priority, assignee, labels, the
 * team's estimate and cycles where it uses them, project, its milestone,
 * parent), the due date as a date field, then the facts that aren't edited here.
 */
export function Properties({ issue }: { issue: LinearIssue }) {
  const data = useLinear((d) => d);
  const ws = data.workspace;
  const [open, setOpen] = useState<PropertyField | null>(null);
  const buttons = useRef(new Map<PropertyField, HTMLButtonElement>());
  const latest = useRef({ issue, data });
  latest.current = { issue, data };
  useEffect(() => {
    const offs = COMMANDS.map(([command, field]) =>
      onAppCommand(command, () => {
        // A property the issue's team doesn't use (cycles) has no button, nor a picker.
        const button = buttons.current.get(field);
        if (!button) return;
        button.focus({ preventScroll: true });
        button.scrollIntoView({ block: "nearest" });
        setOpen(field);
      }),
    );
    // I: assigned to you, unless it already is.
    offs.push(
      onAppCommand("linear-assign-me", () => {
        const { issue, data } = latest.current;
        const me = data.workspace?.viewerId;
        const spec = propertySpec("assignee", issue, data);
        if (me && spec && issue.assigneeId !== me) save(issue, spec, me);
      }),
    );
    return () => offs.forEach((off) => off());
  }, []);

  const team = ws?.teams.find((t) => t.id === issue.teamId);
  const creator = ws?.users.find((u) => u.id === issue.creatorId);
  const specs = FIELDS.map((field) => ({ field, spec: propertySpec(field, issue, data) }));
  const prop = (field: PropertyField, spec: Spec) => (
    <div key={field} className="linear-prop">
      <dt>{spec.label}</dt>
      <dd>
        <span className="menu-anchor linear-prop-anchor">
          <button
            ref={(el) => {
              if (el) buttons.current.set(field, el);
              else buttons.current.delete(field);
            }}
            className={`linear-prop-btn${spec.empty ? " empty" : ""}`}
            aria-label={`${spec.label}: ${spec.text}`}
            aria-haspopup="listbox"
            aria-expanded={open === field}
            onClick={(e) => {
              // WebKit doesn't focus a clicked button; the picker gives focus back to it.
              e.currentTarget.focus({ preventScroll: true });
              setOpen(open === field ? null : field);
            }}
          >
            {spec.icon ?? <CircleDashed size={13} aria-hidden="true" />}
            <span className="linear-prop-text">{spec.text}</span>
          </button>
          {open === field && (
            <Picker
              label={spec.label}
              options={spec.options}
              value={spec.value}
              multiple={spec.multiple}
              onPick={(value) => save(issue, spec, value)}
              onClose={() => setOpen(null)}
            />
          )}
        </span>
      </dd>
    </div>
  );

  return (
    <dl className="linear-facts linear-props">
      {specs.map(({ field, spec }) => spec && prop(field, spec))}
      <div className="linear-prop">
        <dt>Due date</dt>
        <dd>
          <DueDate issue={issue} />
        </dd>
      </div>
      {team && (
        <div className="linear-prop">
          <dt>Team</dt>
          <dd className="linear-prop-fact">{team.name}</dd>
        </div>
      )}
      {creator && (
        <div className="linear-prop">
          <dt>Created by</dt>
          <dd className="linear-prop-fact">{creator.name}</dd>
        </div>
      )}
      <div className="linear-prop">
        <dt>Updated</dt>
        <dd className="linear-prop-fact">{ago(issue.updatedAt)}</dd>
      </div>
    </dl>
  );
}
