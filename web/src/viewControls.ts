/** Renderer-independent camera commands and panel geometry shared by web and native. */
export const DRAG_PX = 3;

export type Inset = { right: number; bottom: number };
export const NO_INSET: Inset = { right: 0, bottom: 0 };

/** The part of the canvas no panel covers (never smaller than 1px). */
export function visibleCanvas(
  canvas: { width: number; height: number },
  inset: Inset,
) {
  return {
    width: Math.max(1, canvas.width - inset.right),
    height: Math.max(1, canvas.height - inset.bottom),
  };
}

/**
 * The view offset that centres the camera's target in the visible part:
 * moving the view window right by half the covered width moves the scene
 * left by as much.
 */
export function viewShift(
  canvas: { width: number; height: number },
  inset: Inset,
) {
  const v = visibleCanvas(canvas, inset);
  return { x: (canvas.width - v.width) / 2, y: (canvas.height - v.height) / 2 };
}

export const mapInset = (() => {
  let value = NO_INSET,
    duration = 0,
    slide: () => SlideTiming | null = () => null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    /** Milliseconds the latest change takes on screen. */
    duration: () => duration,
    /** The rail's slide as it actually runs, so the camera can keep step. */
    slide: () => slide(),
    follow(source: () => SlideTiming | null) {
      slide = source;
    },
    set(next: Inset, ms = 0) {
      const right = Math.max(0, Math.round(next.right)),
        bottom = Math.max(0, Math.round(next.bottom));
      if (right === value.right && bottom === value.bottom) return;
      value = { right, bottom };
      duration = ms;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();

/**
 * The world frame moved without changing size (the session panel switched
 * sides), which a ResizeObserver does not report: the native world re-sends
 * its viewport when this fires.
 */
export const worldFrame = (() => {
  const listeners = new Set<() => void>();
  return {
    moved: () => listeners.forEach((l) => l()),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();

/**
 * A running slide on the document timeline: `start` is null until the
 * browser has actually started it (it can take a frame or two).
 */
export type SlideTiming = { start: number | null; duration: number };

// ── One timing for the rail and the camera ───────────────────────────────────
// The rail's CSS slide and the camera's view offset and refit share these, so
// the map moves out of the panel's way in the same motion as the panel.

/** Slide durations (ms) and easing; Rail.tsx hands them to the CSS. */
export const SLIDE = {
  open: 340,
  close: 260,
  ease: [0.23, 1, 0.32, 1] as const,
};

/** A CSS cubic-bezier timing function. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Find t for x by bisection (x(t) is monotonic for 0 <= x1, x2 <= 1).
    let lo = 0,
      hi = 1,
      t = x;
    for (let i = 0; i < 40; i++) {
      t = (lo + hi) / 2;
      if (at(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return at(y1, y2, t);
  };
}
export const slideEase = cubicBezier(...SLIDE.ease);

/**
 * A move between number tuples over `duration` ms from `start`, eased like
 * the slide. `p0` is the slide's eased progress when the move began, for a
 * move that takes over partway through a slide (its remaining progress maps
 * to the whole move). `synced` once it has followed a running slide.
 */
export type Tween = {
  from: number[];
  to: number[];
  start: number;
  duration: number;
  p0?: number;
  synced?: boolean;
};
/**
 * Keeps a tween on the rail's actual slide: held at its start until the slide
 * has started, then on the slide's start time and duration.
 */
export function follow(
  t: Tween,
  slide: SlideTiming | null,
  now: number,
): Tween {
  if (t.duration <= 0) return t;
  // The slide it was following has gone before the move finished: it was
  // cancelled (reduced motion switched on, say) and the panel is already at
  // rest, so the move finishes now too.
  if (!slide) return t.synced ? { ...t, duration: 0 } : t;
  if (slide.start === null) return { ...t, start: now, synced: true };
  return { ...t, start: slide.start, duration: slide.duration, synced: true };
}
export function tweenAt(t: Tween, now: number) {
  const linear =
    t.duration > 0 ? Math.min(1, Math.max(0, (now - t.start) / t.duration)) : 1;
  const p = slideEase(linear);
  const p0 = t.p0 ?? 0;
  const k =
    linear >= 1 || p0 >= 1 ? 1 : Math.min(1, Math.max(0, (p - p0) / (1 - p0)));
  return {
    value: t.from.map((f, i) => f + (t.to[i] - f) * k),
    progress: p,
    done: linear >= 1,
  };
}
/**
 * A new destination partway through `t` (the window or the panel resized
 * mid-slide): from `current`, over what is left of the same slide.
 */
export function redirect(
  t: Tween,
  current: number[],
  to: number[],
  now: number,
): Tween {
  return {
    ...t,
    from: [...current],
    to: [...to],
    p0: tweenAt(t, now).progress,
  };
}
/**
 * A tween to `to`, starting from wherever `previous` has got to. Turning back
 * to where `previous` started takes only as long as the way it had come, as
 * CSS does when a transition is reversed.
 */
export function retarget(
  previous: Tween | null,
  current: number[],
  to: number[],
  duration: number,
  now: number,
): Tween {
  let ms = duration;
  if (
    previous &&
    !tweenAt(previous, now).done &&
    previous.from.every((f, i) => Math.abs(f - to[i]) < 1e-6)
  )
    ms = duration * tweenAt(previous, now).progress;
  return { from: [...current], to: [...to], start: now, duration: ms };
}

export const TILT = { top: 0.001, iso: 0.92, low: 1.2 } as const;
export type TiltPreset = keyof typeof TILT;
export const TILT_ORDER: TiltPreset[] = ["top", "iso", "low"];
/**
 * How far the camera may tilt: never past straight down (the ground would
 * flip over) and never so low that it nears the horizon or the ground.
 */
export const TILT_LIMITS = { min: TILT.top, max: 1.3 } as const;
/** The default heading: the map's original corner-on view. */
export const HEADING = Math.atan2(170, 200);
export type Angle = { azimuth: number; polar: number };
export const DEFAULT_ANGLE: Angle = { azimuth: HEADING, polar: TILT.iso };
/** Turn steps: a quarter turn (Q/E), and a fine step (Shift, or the dial's arrows). */
export const QUARTER = Math.PI / 2;
export const FINE_TURN = Math.PI / 12;
export const FINE_TILT = (5 * Math.PI) / 180;
/**
 * How far behind its target the camera sits. It is orthographic, so distance
 * doesn't change the view; it only has to keep every visible piece of ground
 * in front of the near plane, which at the lowest tilt and widest zoom
 * reaches far towards the camera: (canvas height / 2 / FIT_FLOOR) × tan(tilt)
 * is 1,800 units for a 1,000px-tall canvas.
 */
export const CAMERA_DISTANCE = 2400;
/** The camera's starting position (relative to its target) at the default angle. */
export function cameraOffset(
  a: Angle = DEFAULT_ANGLE,
  distance = CAMERA_DISTANCE,
): [number, number, number] {
  const s = Math.sin(a.polar) * distance;
  return [
    s * Math.sin(a.azimuth),
    Math.cos(a.polar) * distance,
    s * Math.cos(a.azimuth),
  ];
}

export const clampTilt = (polar: number) =>
  Math.min(
    TILT_LIMITS.max,
    Math.max(TILT_LIMITS.min, Number.isFinite(polar) ? polar : TILT.iso),
  );
/** `a` in (-π, π]. */
export function wrapAngle(a: number) {
  const r = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return r === -Math.PI ? Math.PI : r;
}
/** The heading `to`, as the equivalent angle nearest `from` (so a turn takes the short way). */
export const nearestTurn = (from: number, to: number) =>
  from + wrapAngle(to - from);

/**
 * The next quarter-turn heading from `azimuth` in direction `dir`: headings
 * snap to the default one's quarters, so after a free turn the first press
 * squares the view up and every later one turns exactly 90°.
 */
export function quarterTurn(azimuth: number, dir: 1 | -1) {
  const k = (azimuth - HEADING) / QUARTER;
  const step = dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1;
  return HEADING + step * QUARTER;
}
/** The preset nearest a tilt. */
export function nearestTilt(polar: number): TiltPreset {
  return TILT_ORDER.reduce((best, p) =>
    Math.abs(TILT[p] - polar) < Math.abs(TILT[best] - polar) ? p : best,
  );
}
/** The next preset after the one nearest `polar`, wrapping round. */
export function nextTilt(polar: number, dir: 1 | -1 = 1): TiltPreset {
  const i = TILT_ORDER.indexOf(nearestTilt(polar));
  return TILT_ORDER[(i + dir + TILT_ORDER.length) % TILT_ORDER.length];
}

/** The zoom a window opens at (and Reset view returns to): legible, and wider in larger windows. */
export const defaultZoom = (size: { width: number; height: number }) =>
  Math.max(7, Math.min(36, size.width / 36, size.height / 28));

// ── Remembering the angle ────────────────────────────────────────────────────
export const ANGLE_STORE = "paseo-command:camera";
type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
/** The remembered angle, clamped and checked; the default if there is none or it is unreadable. */
export function readAngle(store: Store | null = browserStore()): Angle {
  try {
    const raw = store?.getItem(ANGLE_STORE);
    if (!raw) return DEFAULT_ANGLE;
    const v = JSON.parse(raw) as Partial<Angle>;
    if (
      typeof v?.azimuth !== "number" ||
      typeof v.polar !== "number" ||
      !Number.isFinite(v.azimuth) ||
      !Number.isFinite(v.polar)
    )
      return DEFAULT_ANGLE;
    return { azimuth: wrapAngle(v.azimuth), polar: clampTilt(v.polar) };
  } catch {
    return DEFAULT_ANGLE;
  }
}
export function writeAngle(a: Angle, store: Store | null = browserStore()) {
  try {
    store?.setItem(
      ANGLE_STORE,
      JSON.stringify({
        azimuth: +wrapAngle(a.azimuth).toFixed(4),
        polar: +clampTilt(a.polar).toFixed(4),
      }),
    );
  } catch {
    // Remembering the angle is a convenience; private windows may refuse it.
  }
}

/**
 * What the camera controls (keys, the on-map control) ask the camera to do.
 * `instant` moves follow a drag directly instead of easing.
 */
export type ViewCommand =
  /** Stop where the camera is now (a press on the dial: the drag takes over). */
  | { type: "hold" }
  | { type: "quarter"; dir: 1 | -1 }
  | { type: "turn"; by: number; instant?: boolean }
  | { type: "heading"; to: number }
  | { type: "tilt"; to: number; instant?: boolean }
  | { type: "tiltBy"; by: number; instant?: boolean }
  | { type: "preset"; preset: TiltPreset }
  | { type: "cycleTilt"; dir: 1 | -1 }
  | { type: "reset" };

/** The angle a command ends at, from the angle the camera is heading for. */
export function commandAngle(end: Angle, c: ViewCommand): Angle {
  switch (c.type) {
    case "hold":
      return end;
    case "quarter":
      return { ...end, azimuth: quarterTurn(end.azimuth, c.dir) };
    case "turn":
      return { ...end, azimuth: end.azimuth + c.by };
    case "heading":
      return { ...end, azimuth: nearestTurn(end.azimuth, c.to) };
    case "tilt":
      return { ...end, polar: clampTilt(c.to) };
    case "tiltBy":
      return { ...end, polar: clampTilt(end.polar + c.by) };
    case "preset":
      return { ...end, polar: TILT[c.preset] };
    case "cycleTilt":
      return { ...end, polar: TILT[nextTilt(end.polar, c.dir)] };
    case "reset":
      return {
        azimuth: nearestTurn(end.azimuth, DEFAULT_ANGLE.azimuth),
        polar: DEFAULT_ANGLE.polar,
      };
  }
}

export const cameraView = (() => {
  let run: ((c: ViewCommand) => void) | null = null;
  let angle: Angle = DEFAULT_ANGLE;
  const listeners = new Set<(a: Angle) => void>();
  return {
    /** Ask the camera to turn, tilt or reset (ignored until the map is up). */
    command(c: ViewCommand) {
      run?.(c);
    },
    /** The rig takes commands. */
    handle(fn: ((c: ViewCommand) => void) | null) {
      run = fn;
    },
    /** The angle on screen now. */
    get: () => angle,
    report(next: Angle) {
      if (
        Math.abs(next.azimuth - angle.azimuth) < 1e-4 &&
        Math.abs(next.polar - angle.polar) < 1e-4
      )
        return;
      angle = next;
      listeners.forEach((l) => l(angle));
    },
    subscribe(listener: (a: Angle) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();
