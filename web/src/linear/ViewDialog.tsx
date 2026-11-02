import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useIsPresent } from "framer-motion";
import {
  Bookmark,
  Box,
  Briefcase,
  Bug,
  Calendar,
  Flag,
  Inbox,
  Layers,
  Rocket,
  Star,
  Target,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useFocusTrap } from "../focus";
import { plainText } from "../ui";
import { COMPLETED_LABEL, GROUPING_LABEL, ORDERING_LABEL, type Display, type Filters } from "./display";
import { chosenText, issueFilterSpec, type FilterSpec } from "./ListControls";
import { placeBelow } from "./Picker";
import { projectFilterSpec } from "./ProjectList";
import { linearStore, useLinear } from "./store";
import type { LinearCustomView, LinearWorkspace, ViewInput, ViewSharing } from "./types";
import type { ProjectDisplay, ProjectFilters, ViewBase } from "./viewFilter";

/** Linear's icon names the app draws, as Linear's own icon picker names them. */
const ICONS: [string, LucideIcon][] = [
  ["Layers", Layers],
  ["Star", Star],
  ["Flag", Flag],
  ["Bug", Bug],
  ["Rocket", Rocket],
  ["Target", Target],
  ["Zap", Zap],
  ["Bookmark", Bookmark],
  ["Inbox", Inbox],
  ["Users", Users],
  ["Calendar", Calendar],
  ["Briefcase", Briefcase],
];
/** Linear's view colours. */
const COLORS = ["#5e6ad2", "#26b5ce", "#4cb782", "#f2c94c", "#f2994a", "#eb5757", "#bb87fc", "#95a2b3"];

/**
 * A view's icon in its colour: one of the icons the app knows by Linear's
 * name, an emoji as it is, else Layers (a project view, a box).
 */
export function ViewIcon({ view, size = 14 }: { view: Pick<LinearCustomView, "icon" | "color" | "model">; size?: number }) {
  const known = ICONS.find(([name]) => name.toLowerCase() === view.icon?.toLowerCase())?.[1];
  if (!known && view.icon && /\p{Extended_Pictographic}/u.test(view.icon))
    return (
      <span className="linear-view-emoji" aria-hidden="true" style={{ fontSize: size }}>
        {view.icon}
      </span>
    );
  const Icon = known ?? (view.model === "project" ? Box : Layers);
  return <Icon size={size} aria-hidden="true" className="linear-view-icon" style={{ color: view.color }} />;
}

/** What a new or changed view is made of: what a list shows (its filters, its place's base, its display). */
export type ViewSource =
  | { model: "issue"; filter: { base: ViewBase; filters: Filters }; display: Display }
  | { model: "project"; projectFilter: ProjectFilters; projectDisplay: ProjectDisplay };

const STATE_WORDS: Record<string, string> = {
  triage: "Triage",
  backlog: "Backlog",
  "unstarted,started": "Active",
};
const ME_WORDS = { assignee: "Assigned to you", creator: "Created by you", subscriber: "You're subscribed" };

/** What a filter lets through, in words ("ENG · Active · Priority is Urgent"); "Every issue" (or project) when nothing. */
export function describeSource(source: ViewSource, ws: LinearWorkspace | undefined, projects = ws?.projects ?? []): string {
  const parts: string[] = [];
  const fields = <F extends string>(spec: FilterSpec<F>, filters: Partial<Record<F, string[]>>) => {
    for (const field of spec.fields) {
      const values = filters[field];
      if (values?.length)
        parts.push(`${spec.label[field]} ${values.length > 1 ? "is any of" : "is"} ${chosenText(spec.label[field], values, spec.options(field))}`);
    }
  };
  if (source.model === "issue") {
    const { base, filters } = source.filter;
    if (base.teamId) parts.push(ws?.teams.find((t) => t.id === base.teamId)?.name ?? "A team");
    if (base.stateTypes?.length) parts.push(STATE_WORDS[base.stateTypes.join(",")] ?? base.stateTypes.join(", "));
    if (base.me) parts.push(ME_WORDS[base.me]);
    fields(issueFilterSpec(ws), filters);
    return parts.join(" · ") || "Every issue";
  }
  fields(projectFilterSpec(ws, projects), source.projectFilter);
  return parts.join(" · ") || "Every project";
}

/** A display in words ("Board · Grouped by assignee · Ordered by priority"). */
export function describeDisplay(source: ViewSource): string {
  if (source.model === "issue") {
    const d = source.display;
    return [
      d.layout === "board" ? "Board" : "List",
      d.grouping === "none" ? "No grouping" : `Grouped by ${GROUPING_LABEL[d.grouping].toLowerCase()}`,
      d.subGrouping !== "none" ? `Sub-grouped by ${GROUPING_LABEL[d.subGrouping].toLowerCase()}` : "",
      d.ordering !== "relevance" ? `Ordered by ${ORDERING_LABEL[d.ordering].toLowerCase()}` : "",
      `Completed: ${COMPLETED_LABEL[d.completed].toLowerCase()}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const d = source.projectDisplay;
  return [
    d.grouping === "none" ? "No grouping" : `Grouped by ${d.grouping}`,
    `Ordered by ${{ status: "status", name: "name", target: "target date", progress: "progress", updated: "last updated" }[d.ordering]}`,
    d.completed === "none" ? "Without completed projects" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A source's filter and display, as a view write takes them. */
const sourceInput = (s: ViewSource): ViewInput =>
  s.model === "issue" ? { filter: s.filter, display: s.display } : { projectFilter: s.projectFilter, projectDisplay: s.projectDisplay };
/** A source's filter and display, as the store keeps a view's (a search's Relevance isn't a view's ordering). */
const sourceView = (s: ViewSource): Partial<LinearCustomView> => {
  if (s.model === "project") return { projectFilter: s.projectFilter, projectDisplay: s.projectDisplay };
  const { ordering, ...rest } = s.display;
  return { filter: s.filter, display: { ...rest, ...(ordering !== "relevance" ? { ordering } : {}) } };
};

/** Who sees a view now. */
const sharingOf = (view: Pick<LinearCustomView, "shared" | "teamId">): ViewSharing =>
  !view.shared ? "personal" : view.teamId ? "team" : "workspace";

/** What opens the dialog: a new view from what a list shows, or one to change (with what its list shows now, if it's open). */
export type ViewDialogMode =
  | { kind: "create"; source: ViewSource; teamId?: string; projectId?: string }
  | { kind: "edit"; viewId: string; shown?: ViewSource; useShown?: boolean };

function Modal({
  label,
  className,
  onClose,
  onSubmit,
  initial,
  children,
}: {
  label: string;
  className: string;
  onClose: () => void;
  onSubmit?: () => void;
  initial?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  const present = useIsPresent();
  useFocusTrap(dialog, initial, present);
  useLayoutEffect(() => {
    if (!present && dialog.current?.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  return (
    <motion.div
      className="modal-backdrop"
      inert={!present}
      aria-hidden={!present || undefined}
      style={!present ? { pointerEvents: "none" } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onClick={onClose}
    >
      <motion.section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={label}
        className={`command-dialog panel ${className}`}
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 15, scale: 0.97, transition: { duration: 0.12 } }}
        onClick={(e) => e.stopPropagation()}
        // Keys typed here are the dialog's, not the app's shortcuts.
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter" && e.metaKey && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
          if (e.key !== "Tab") e.stopPropagation();
        }}
      >
        {children}
      </motion.section>
    </motion.div>
  );
}

/**
 * Save as view, and Edit view: its name, icon and colour, description, and
 * who sees it (you, a team, the workspace); a new one is made of what the list
 * shows (its filters and display), and one being changed can take what its
 * list shows now. A view whose filter the app can't say keeps it: only its
 * name, icon, description and sharing change here, and the dialog says why.
 * Saving shows at once; Linear refusing puts it back, with the notice.
 */
export function ViewDialog({
  mode,
  onClose,
}: {
  mode: ViewDialogMode;
  /** Closed: the view as saved (`tookShown` when it took what its list shows), or nothing. */
  onClose: (saved?: LinearCustomView, tookShown?: boolean) => void;
}) {
  const ws = useLinear((d) => d.workspace);
  const existing = useLinear((d) => (mode.kind === "edit" ? d.views?.find((v) => v.id === mode.viewId) : undefined));
  const projectId = mode.kind === "create" ? mode.projectId : existing?.projectId;
  const project = ws?.projects.find((p) => p.id === projectId);
  const model = mode.kind === "create" ? mode.source.model : (existing?.model ?? "issue");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [icon, setIcon] = useState<string | undefined>(existing?.icon);
  const [color, setColor] = useState(existing?.color && existing.color !== "#8a8f98" ? existing.color : COLORS[0]);
  const [sharing, setSharing] = useState<ViewSharing>(existing ? sharingOf(existing) : "personal");
  const firstTeam = (mode.kind === "create" && mode.teamId) || existing?.teamId || ws?.teams[0]?.id;
  const [teamId, setTeamId] = useState(firstTeam);
  const [inProject, setInProject] = useState(!!projectId);
  const editable = !existing || (existing.model === "project" ? !!existing.projectFilter : !!existing.filter);
  const [useShown, setUseShown] = useState(mode.kind === "edit" && !!mode.useShown && !!mode.shown && editable);
  const [picking, setPicking] = useState(false);
  const lookAnchor = useRef<HTMLSpanElement>(null);
  const placeLook = useCallback((el: HTMLDivElement | null) => {
    if (el) placeBelow(el);
  }, []);
  // The icon and colour picker closes on a click elsewhere.
  useEffect(() => {
    if (!picking) return;
    const down = (e: MouseEvent) => {
      if (!lookAnchor.current?.contains(e.target as Node)) setPicking(false);
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [picking]);
  const [saving, setSaving] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  const source = mode.kind === "create" ? mode.source : useShown ? mode.shown : undefined;
  const viewProjects = useLinear((d) => (existing ? d.viewProjects.get(existing.id) : undefined));
  const summary = useMemo(() => (source ? describeSource(source, ws, viewProjects ?? ws?.projects) : undefined), [source, ws, viewProjects]);
  const teams = ws?.teams ?? [];

  const submit = async () => {
    if (!name.trim() || saving || (sharing === "team" && !teamId)) return;
    setSaving(true);
    const common: ViewInput = {
      name: name.trim(),
      description: description.trim(),
      icon: icon ?? null,
      color,
      sharing,
      ...(sharing === "team" ? { teamId } : {}),
    };
    const looks = {
      name: name.trim(),
      description: description.trim() || undefined,
      icon,
      color,
      shared: sharing !== "personal",
      teamId: sharing === "team" ? teamId : undefined,
    };
    if (mode.kind === "create") {
      const s = mode.source;
      const own = inProject && projectId && s.model === "issue" ? projectId : undefined;
      const saved = await linearStore.createView(
        { ...common, model: s.model, ...sourceInput(s), ...(own ? { projectId: own } : {}) },
        { ...looks, model: s.model, ownerId: ws?.viewerId, projectId: own, display: {}, ...sourceView(s) },
      );
      setSaving(false);
      if (saved) onClose(saved);
      return;
    }
    if (!existing) return onClose();
    const done = await linearStore.updateView(
      existing.id,
      { ...common, ...(source ? sourceInput(source) : {}) },
      { ...looks, ...(source ? sourceView(source) : {}) },
    );
    setSaving(false);
    if (done) onClose(linearStore.getState().views?.find((v) => v.id === existing.id), !!source);
  };

  const heading = mode.kind === "create" ? (model === "project" ? "New project view" : "New view") : "Edit view";
  return (
    <Modal label={heading} className="linear-view-dialog" onClose={() => onClose()} onSubmit={() => void submit()} initial={title}>
      <div className="dialog-heading">
        <h2>{heading}</h2>
        <button className="icon-btn" aria-label="Close" data-tip="Close (Esc)" onClick={() => onClose()}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="linear-view-name">
        <span className="menu-anchor" ref={lookAnchor}>
          <button
            type="button"
            className="linear-view-icon-btn"
            aria-label="Icon and colour"
            aria-expanded={picking}
            data-tip="Icon and colour"
            onClick={() => setPicking(!picking)}
          >
            <ViewIcon view={{ icon, color, model }} size={16} />
          </button>
          {picking && (
            <div
              ref={placeLook}
              className="popover-menu left linear-view-look"
              role="group"
              aria-label="Icon and colour"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setPicking(false);
                }
              }}
            >
              <div className="linear-view-icons" role="radiogroup" aria-label="Icon">
                {ICONS.map(([iconName]) => (
                  <button
                    key={iconName}
                    type="button"
                    role="radio"
                    aria-checked={icon === iconName || (!icon && iconName === "Layers" && model === "issue")}
                    aria-label={iconName}
                    data-tip={iconName}
                    onClick={() => setIcon(iconName)}
                  >
                    <ViewIcon view={{ icon: iconName, color, model }} />
                  </button>
                ))}
              </div>
              <div className="linear-view-colors" role="radiogroup" aria-label="Colour">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={c}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          )}
        </span>
        <input
          {...plainText}
          ref={title}
          aria-label="View name"
          placeholder="View name"
          maxLength={255}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <textarea
        className="linear-view-description"
        aria-label="Description"
        placeholder="Description (optional)"
        maxLength={500}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <fieldset className="linear-view-sharing">
        <legend>Who sees it</legend>
        <label>
          <input type="radio" name="sharing" checked={sharing === "personal"} onChange={() => setSharing("personal")} />
          Only you
        </label>
        <label>
          <input type="radio" name="sharing" checked={sharing === "team"} onChange={() => setSharing("team")} disabled={!teams.length} />
          A team
        </label>
        {sharing === "team" && (
          <select aria-label="Team" value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <label>
          <input type="radio" name="sharing" checked={sharing === "workspace"} onChange={() => setSharing("workspace")} />
          Everyone in the workspace
        </label>
      </fieldset>
      {mode.kind === "create" && project && model === "issue" && (
        <label className="linear-view-check">
          <input type="checkbox" checked={inProject} onChange={(e) => setInProject(e.target.checked)} />
          One of {project.name}’s views
        </label>
      )}
      {mode.kind === "edit" && existing && !editable && (
        <p className="linear-view-note" role="note">
          This view’s filter has conditions this app can’t show, so its filter and display are changed in Linear. Its name,
          icon, description and who sees it can change here.
        </p>
      )}
      {mode.kind === "edit" && editable && mode.shown && (
        <label className="linear-view-check">
          <input type="checkbox" checked={useShown} onChange={(e) => setUseShown(e.target.checked)} />
          Save what the list shows now as its filters and display
        </label>
      )}
      {source && (
        <dl className="linear-view-summary">
          <dt>Shows</dt>
          <dd>{summary}</dd>
          <dt>Display</dt>
          <dd>{describeDisplay(source)}</dd>
        </dl>
      )}
      <div className="dialog-actions">
        <span>
          <kbd>⌘</kbd>
          <kbd>↩</kbd> to save
        </span>
        <button className="secondary" onClick={() => onClose()}>
          Cancel
        </button>
        <button className="primary" disabled={!name.trim() || saving || (sharing === "team" && !teamId)} onClick={() => void submit()}>
          {mode.kind === "create" ? "Save view" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

/** Delete a view, after confirming: it goes from Linear, for everyone it's shared with. */
export function DeleteViewDialog({
  viewId,
  onConfirm,
  onClose,
}: {
  viewId: string;
  onConfirm: (view: LinearCustomView) => void;
  onClose: () => void;
}) {
  const view = useLinear((d) => d.views?.find((v) => v.id === viewId));
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Modal label="Delete view" className="linear-view-dialog linear-view-delete" onClose={onClose} initial={cancel}>
      <div className="dialog-heading">
        <h2>Delete view</h2>
      </div>
      <p>
        Delete <b>{view?.name ?? "this view"}</b>? It’s deleted in Linear
        {view?.shared ? ", for everyone it’s shared with" : ""}. Its issues stay as they are.
      </p>
      <div className="dialog-actions">
        <button ref={cancel} className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="danger" disabled={!view} onClick={() => view && onConfirm(view)}>
          Delete view
        </button>
      </div>
    </Modal>
  );
}
