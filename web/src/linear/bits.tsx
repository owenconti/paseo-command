import { useState, type ReactNode } from "react";
import { Minus, OctagonAlert, SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { initials } from "./group";
import { PRIORITY_LABEL } from "./names";
import type { LinearUser } from "./types";

/** The small pieces the Linear screens share: priority, dots, people, dates, health. */

export { cycleName, PRIORITY_LABEL } from "./names";
const PRIORITY_ICON = [Minus, OctagonAlert, SignalHigh, SignalMedium, SignalLow];

export function Priority({ priority }: { priority: number }) {
  const Icon = PRIORITY_ICON[priority] ?? Minus;
  const label = PRIORITY_LABEL[priority] ?? PRIORITY_LABEL[0];
  return (
    <span className={`linear-priority p${priority}`} aria-label={label} data-tip={label}>
      <Icon size={13} aria-hidden="true" />
    </span>
  );
}

export function Dot({ color, className = "linear-state-dot" }: { color: string; className?: string }) {
  return <span className={className} style={{ background: color }} aria-hidden="true" />;
}

/** Avatars that didn't load, by user: their initials show from then on, without asking again. */
const noAvatar = new Set<string>();

/**
 * A person in a round chip: their avatar, through the app server (which
 * loads only the address Linear gives for them), else their initials.
 */
export function Person({ user, size = "sm" }: { user?: LinearUser; size?: "sm" | "md" }) {
  const [broken, setBroken] = useState(false);
  if (!user) return null;
  const avatar = !!user.avatarUrl && !broken && !noAvatar.has(user.id);
  return (
    <span className={`linear-person ${size}${avatar ? " has-avatar" : ""}`} data-tip={user.name} aria-label={user.name}>
      {avatar ? (
        <img
          src={`/api/linear/avatar?user=${encodeURIComponent(user.id)}`}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => {
            noAvatar.add(user.id);
            setBroken(true);
          }}
        />
      ) : (
        initials(user)
      )}
    </span>
  );
}

/**
 * Whoever acted on a notification when they aren't a workspace member (an
 * app, a bot, someone outside): their avatar through the app server (only an
 * address Linear named), else their initials on their colour.
 */
export function Actor({
  name,
  avatarUrl,
  initials: letters,
  color,
}: {
  name?: string;
  avatarUrl?: string;
  initials?: string;
  color?: string;
}) {
  const [broken, setBroken] = useState(false);
  const label = name || "Someone";
  const avatar = !!avatarUrl && !broken && !noAvatar.has(avatarUrl);
  return (
    <span
      className={`linear-person sm${avatar ? " has-avatar" : ""}`}
      data-tip={label}
      aria-label={label}
      style={!avatar && color ? { background: color, color: "#fff" } : undefined}
    >
      {avatar ? (
        <img
          src={`/api/linear/avatar?url=${encodeURIComponent(avatarUrl!)}`}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => {
            noAvatar.add(avatarUrl!);
            setBroken(true);
          }}
        />
      ) : (
        (letters || label.slice(0, 1)).toUpperCase()
      )}
    </span>
  );
}

const HEALTH: Record<string, { label: string; tone: string }> = {
  onTrack: { label: "On track", tone: "green" },
  atRisk: { label: "At risk", tone: "amber" },
  offTrack: { label: "Off track", tone: "red" },
};

/** A project's or initiative's health as a coloured dot and its words. */
export function Health({ health, compact = false }: { health?: string; compact?: boolean }) {
  const h = health ? HEALTH[health] : undefined;
  if (!h) return compact ? <span className="linear-health" aria-label="No health"><span className="dot" aria-hidden="true" /></span> : null;
  return (
    <span className="linear-health" data-tip={h.label}>
      <span className={`dot ${h.tone}`} aria-hidden="true" />
      {compact ? <span className="sr-only">{h.label}</span> : h.label}
    </span>
  );
}

/** A Linear day ("2026-11-30") as "Nov 30", with the year when it isn't this one. */
export function shortDate(day?: string): string {
  if (!day) return "";
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

/** A moment as its local day, "Nov 30" (with the year when it isn't this one). */
function localDay(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

/** A cycle's days, "Oct 28 – Nov 11". */
export const dayRange = (start: string, end: string) => `${localDay(start)} – ${localDay(end)}`;

/** A screen's title bar: its heading, then its actions at the right. */
export function ScreenHead({ title, count, children }: { title: ReactNode; count?: number; children?: ReactNode }) {
  return (
    <header className="linear-list-head">
      <h2>
        {title}
        {count !== undefined && <span className="linear-count">{count}</span>}
      </h2>
      {children}
    </header>
  );
}
