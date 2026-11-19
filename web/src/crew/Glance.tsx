/** At a glance, on the app's top bar left of the Settings gear (`src/glance.ts`, `GET /api/glance`): your Linear issues
 * by state (a dot in the state's colour and the count), the pull requests asking your review and assigned to you, and
 * Diagonal's health (a light for each database service: under 1 ms green, under 3 ms yellow, else red, and the slowest's
 * time). Each count opens a menu of what it counts; an issue opens in Linear (its desktop app in the macOS app), a pull
 * request in the GitHub tab. Asked every minute while the page shows (and as the window comes back); ⌘K opens each menu
 * (`crew-glance`) and checks again (`crew-glance-refresh`). */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AlertTriangle, CircleDot, GitPullRequest, RefreshCw, UserCheck } from "lucide-react";
import { api } from "../api";
import { onAppCommand } from "../appCommands";
import { menuKeys } from "../menuKeys";
import { placeBelow } from "../Picker";
import { macApp, postAppBarState, postAppGlanceClick, postAppLink, postAppMenu, type BarRect } from "../worldBridge";
import { useIntegrations } from "../integrationSettings";
import "./glance.css";
import { openGithubPlace } from "../github/place";
import { GLANCE, glanceItems, healthTone, msText, type Glance as GlanceData, type GlanceItem, type GlancePrList, type Health } from "../glance";

// ── The store: one poll for the page ─────────────────────────────────────────
let current: GlanceData | null = null;
let checking = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let asking: Promise<void> | undefined;

/** Asks for the glance (`fresh`: past the server's caches); a failed ask keeps what shows. */
export function refreshGlance(fresh = false): Promise<void> {
  if (asking && !fresh) return asking;
  checking = true;
  emit();
  const ask: Promise<void> = api<GlanceData>(fresh ? "glance?fresh=1" : "glance")
    .then(
      (g) => {
        if (g && typeof g === "object") current = g;
      },
      () => undefined,
    )
    .finally(() => {
      if (asking === ask) asking = undefined;
      checking = false;
      emit();
    });
  asking = ask;
  return ask;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;
const busy = () => checking;

/** What the glance last said (⌘K's entries), without asking. */
export const useGlanceData = () => useSyncExternalStore(subscribe, snapshot);

/** Polls every `GLANCE.pollMs` while mounted and the page shows, and again as it shows. */
function useGlance(on: boolean) {
  const glance = useSyncExternalStore(subscribe, snapshot);
  const loading = useSyncExternalStore(subscribe, busy);
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      clearTimeout(timer);
      if (!document.hidden) void refreshGlance();
      timer = setTimeout(poll, GLANCE.pollMs);
    };
    const shown = () => !document.hidden && poll();
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("focus", shown);
    poll();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("focus", shown);
    };
  }, [on]);
  return { glance, loading };
}

// ── Opening things ───────────────────────────────────────────────────────────
function openUrl(url: string) {
  if (macApp()) postAppLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
function showPrList(scope: "review" | "assigned") {
  if (macApp()) {
    openGithubPlace({ kind: "prs", scope });
    postAppMenu("github");
  } else window.open(`https://github.com/pulls/${scope === "review" ? "review-requested" : "assigned"}`, "_blank", "noopener,noreferrer");
}

// ── A count and its menu ──────────────────────────────────────────────────────
function Count(props: {
  id: string;
  open: string | null;
  setOpen: (id: string | null) => void;
  label: ReactNode;
  name: string;
  tone?: string;
  menu: ReactNode;
  menuLabel: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const shown = props.open === props.id;
  const close = useCallback(
    (focus = false) => {
      props.setOpen(null);
      if (focus) button.current?.focus({ preventScroll: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.setOpen],
  );
  useEffect(() => {
    if (!shown) return;
    const down = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [shown, close]);
  const place = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  return (
    <span className="menu-anchor crew-glance-anchor" ref={anchor}>
      <button
        ref={button}
        className="crew-glance-count"
        data-glance={props.id}
        data-tone={props.tone}
        aria-label={props.name}
        aria-haspopup="menu"
        aria-expanded={shown}
        onClick={() => props.setOpen(shown ? null : props.id)}
      >
        {props.label}
      </button>
      {shown && (
        <div
          ref={place}
          role="menu"
          aria-label={props.menuLabel}
          className="popover-menu linear-row-menu crew-glance-menu"
          onKeyDown={(e) => menuKeys(e, () => close(true))}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[role=menuitem]")) close();
          }}
        >
          {props.menu}
        </div>
      )}
    </span>
  );
}

function prMenu(list: GlancePrList, scope: "review" | "assigned", empty: string) {
  return (
    <>
      {!list.rows.length && <p className="crew-glance-empty">{empty}</p>}
      {list.rows.map((pr) => (
        <button key={pr.id} role="menuitem" tabIndex={-1} onClick={() => openUrl(pr.url)}>
          <GitPullRequest size={13} aria-hidden="true" data-state={pr.state} />
          <span>
            <b>{pr.title}</b>
            <small>
              {pr.repo}#{pr.number}
              {pr.author ? ` · ${pr.author}` : ""}
              {pr.state === "draft" ? " · draft" : ""}
              {pr.checks ? ` · checks ${pr.checks}` : ""}
            </small>
          </span>
        </button>
      ))}
      {list.total > list.rows.length && <p className="crew-glance-empty">{`${list.total - list.rows.length} more`}</p>}
      <hr />
      <button role="menuitem" tabIndex={-1} onClick={() => showPrList(scope)}>
        <GitPullRequest size={13} aria-hidden="true" />
        {macApp() ? "Show them in the GitHub tab" : "Show them on GitHub"}
      </button>
    </>
  );
}

function healthMenu(h: Health, loading: boolean) {
  const checked = new Date(h.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <>
      <p className="crew-glance-note">
        {h.up ? `Answered in ${msText(h.took ?? 0)} at ${checked}` : `Down at ${checked}: ${h.error ?? "no answer"}`}
      </p>
      {h.services.map((s) => (
        <div key={s.name} className="crew-glance-service" data-tone={healthTone(s.ms)}>
          <i aria-hidden="true" />
          <span>{s.name}</span>
          <b>{msText(s.ms)}</b>
        </div>
      ))}
      <hr />
      <button role="menuitem" tabIndex={-1} disabled={loading} onClick={() => void refreshGlance(true)}>
        <RefreshCw size={13} aria-hidden="true" />
        {loading ? "Checking…" : "Check again now"}
      </button>
      <button role="menuitem" tabIndex={-1} onClick={() => openUrl("https://app.go-diagonal.com/health/status")}>
        <CircleDot size={13} aria-hidden="true" />
        Open the status endpoint
      </button>
    </>
  );
}

type Groups = Extract<NonNullable<GlanceData["linear"]>, { groups: unknown }>["groups"];

/** What a count's menu lists, by its id; null for a count without one. */
function menuOf(id: string, g: GlanceData, loading: boolean): { label: string; content: ReactNode } | null {
  const groups: Groups = g.linear && "groups" in g.linear ? g.linear.groups : [];
  const state = id.startsWith("linear:") ? groups.find((x) => `linear:${x.state.toLowerCase()}` === id) : undefined;
  if (state)
    return {
      label: `Your issues ${state.state.toLowerCase()}`,
      content: (
        <>
          {!state.issues.length && <p className="crew-glance-empty">No issues.</p>}
          {state.issues.map((i) => (
            <button key={i.id} role="menuitem" tabIndex={-1} onClick={() => openUrl(i.url)}>
              <i className="crew-glance-dot" style={state.color ? { background: state.color } : undefined} aria-hidden="true" />
              <span>
                <b>{i.title}</b>
                <small>{i.key}</small>
              </span>
            </button>
          ))}
          {state.total > state.issues.length && <p className="crew-glance-empty">{`${state.total - state.issues.length} more`}</p>}
        </>
      ),
    };
  if ((id === "review" || id === "assigned") && g.github && "review" in g.github)
    return id === "review"
      ? { label: "Pull requests asking your review", content: prMenu(g.github.review, "review", "Nothing asks your review.") }
      : { label: "Pull requests assigned to you", content: prMenu(g.github.assigned, "assigned", "No pull requests are assigned to you.") };
  if (id === "health" && g.health) return { label: "Diagonal's health", content: healthMenu(g.health, loading) };
  return null;
}

/** A count as the page draws it (a browser's bar): its dots, icon and text. */
function ChipFace({ item }: { item: GlanceItem }) {
  const Icon = item.icon === "review" ? GitPullRequest : item.icon === "assigned" ? UserCheck : item.icon === "warning" ? AlertTriangle : null;
  return (
    <>
      {item.dots.map((color, i) => (
        <i key={i} className="crew-glance-dot" style={{ background: color }} aria-hidden="true" />
      ))}
      {Icon && <Icon size={12} aria-hidden="true" />}
      <b>{item.text}</b>
    </>
  );
}

/** The menu of a native bar count, beneath where the app says it is. */
function HostedMenu({ rect, label, onClose, children }: { rect: BarRect; label: string; onClose: () => void; children: ReactNode }) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const width = Math.min(380, innerWidth - 16);
  const left = Math.max(8, Math.min(rect.x, innerWidth - width - 8));
  const top = Math.max(0, rect.y + rect.height) + 6;
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="popover-menu linear-row-menu crew-glance-menu hosted"
      style={{ position: "fixed", left, top, bottom: "auto", width, maxHeight: `calc(100vh - ${top + 12}px)`, overflowY: "auto" }}
      onKeyDown={(e) => menuKeys(e, onClose)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[role=menuitem]")) onClose();
      }}
    >
      {children}
    </div>
  );
}

/**
 * The glance on the top bar, left of the Settings gear. In the macOS app the bar is native: this tells it the counts
 * (`postAppBarState({glance})`, drawn by `GlanceBar.swift`) and opens a count's menu beneath it when it's clicked
 * (`paseo:bar`, `glance:<id>`). In a browser it draws the counts itself in the page's bar.
 */
export function GlanceBar({ hosted }: { hosted: boolean }) {
  const { integrations } = useIntegrations();
  const on = integrations.linear || integrations.github || integrations.health;
  const { glance, loading } = useGlance(on);
  const items = useMemo(() => glanceItems(on ? glance : null, integrations), [glance, on, integrations]);
  const [open, setOpen] = useState<string | null>(null);
  const [rect, setRect] = useState<BarRect | null>(null);
  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    if (hosted) postAppBarState({ glance: items });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosted, itemsKey]);
  // A native count's click: its menu beneath it, or closed again.
  useEffect(() => {
    if (!hosted) return;
    const receive = (event: Event) => {
      const d = (event as CustomEvent).detail;
      const action = typeof d?.action === "string" ? d.action : "";
      if (!action.startsWith("glance:")) return;
      const id = action.slice("glance:".length);
      setRect({ x: d.x ?? 0, y: d.y ?? 0, width: d.width ?? 0, height: d.height ?? 0 });
      setOpen((now) => (now === id ? null : id));
    };
    window.addEventListener("paseo:bar", receive);
    return () => window.removeEventListener("paseo:bar", receive);
  }, [hosted]);
  useEffect(
    () =>
      onAppCommand("crew-glance", (arg) => {
        if (typeof arg !== "string") return;
        // In the app, as a click on the native count, so the page learns where it is.
        if (hosted) return postAppGlanceClick(arg);
        setOpen(null);
        requestAnimationFrame(() => setOpen(arg));
      }),
    [hosted],
  );
  useEffect(() => onAppCommand("crew-glance-refresh", () => void refreshGlance(true)), []);
  const close = useCallback(() => setOpen(null), []);
  if (!on || !glance) return null;
  if (hosted) {
    const menu = open ? menuOf(open, glance, loading) : null;
    return menu && rect ? (
      <HostedMenu rect={rect} label={menu.label} onClose={close}>
        {menu.content}
      </HostedMenu>
    ) : null;
  }
  if (!items.length) return null;
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <div className="crew-glance" role="group" aria-label="At a glance">
      {groups.map((group) => (
        <span key={group} className="crew-glance-group" role="group" aria-label={group}>
          <span className="crew-glance-source" aria-hidden="true">
            {group}
          </span>
          {items
            .filter((i) => i.group === group)
            .map((item) => {
              const menu = item.menu ? menuOf(item.id, glance, loading) : null;
              return menu ? (
                <Count key={item.id} id={item.id} open={open} setOpen={setOpen} tone={item.tone} name={item.tip} menuLabel={menu.label} label={<ChipFace item={item} />} menu={menu.content} />
              ) : (
                <span key={item.id} className="crew-glance-count" data-tone={item.tone} role="img" aria-label={item.tip} data-tip={item.tip} data-summary="">
                  <ChipFace item={item} />
                </span>
              );
            })}
        </span>
      ))}
    </div>
  );
}
