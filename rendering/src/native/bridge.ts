/**
 * The Atlas drawn by the native macOS app (`native/`, SpriteKit). Inside its
 * web view, this is the world the page mounts: it lays the fleet out and
 * paints the artwork with the shared Atlas modules, then posts the result to
 * Swift, which only draws. The map's pointer, wheel and keys
 * are forwarded to Swift, which owns the camera, hover and picking and
 * answers through `paseo:world` events. Nothing here sends daemon actions.
 */
import {
  footprint,
  insideFootprint,
  landBounds,
  point,
  layoutAtlas,
  seedOf,
  type AtlasData,
  type AtlasLayout,
  type Entity,
} from "../world";
import { buildFrames, flagFrames, frameName, propFrames, type Frame } from "../art";
import { PR_LABELS } from "../prStatus";
import { cloudsTile, glintsTile, terrainParts, waterTile, type Piece } from "../terrain";
import {
  DRONE_ORBIT,
  FLAG_FOOT,
  FLAG_SWAY,
  placeFlags,
  DRONE_SIZE,
  HOVER_COLOR,
  PROP_WIDTH,
  artMask,
  campFlags,
  labels,
  lights,
  locations,
  placeStructures,
  plaza,
  robots,
  tiles,
  type Label,
  type Placed,
  type Signal,
} from "../placement";
import {
  LABEL_FONT,
  RIBBON_BODY_RADIUS,
  RIBBON_HIGHLIGHT,
  RIBBON_SHADOW,
  RIBBON_STROKE,
  fitCaption,
  ribbonFont,
  ribbonShape,
} from "../ribbon";
import { MAX_ZOOM, OVERLAY_BOTTOM, OVERLAY_TOP } from "../camera";
import { WALK_SPEED, TURN_SPEED, WANDER_X, WANDER_Y } from "../wander";
import { HEX_RADIUS, ROBOT_SIZE } from "../world";
import PROPS from "../assets/props.json";
import buildingsUrl from "../assets/buildings.png";
import structuresUrl from "../assets/structures.png";
import robotsUrl from "../assets/robots.png";
import foliageUrl from "../assets/tree-v2.png";
import sandUrl from "../assets/sand.png";
import propsUrl from "../assets/props.png";
import flagsUrl from "../assets/flags.png";
import type { AtlasHandlers, AtlasWorld } from "../atlas";

type Channel = { postMessage(message: unknown): void };
const channel = (): Channel | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: Channel } } }).webkit
    ?.messageHandlers?.paseoWorld;
/** Whether this page runs inside the native app, which draws the Atlas itself. */
export const nativeWorldAvailable = () => typeof window !== "undefined" && !!channel();

/** Banners are painted at this many pixels per world pixel, so they stay
 * crisp at the closest zoom on a Retina display. */
const BANNER_SCALE = 5;
/** Sprite frames and the sea's tiles, sent once per page. */
type Art = { frames: Map<string, Frame>; sand: HTMLImageElement; masks: Map<string, ImageData> };

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}. Reload the world to retry.`));
    image.src = url;
  });

function crop(frame: Frame): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  canvas.getContext("2d")!.drawImage(frame.canvas, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
  return canvas;
}
const png = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png");
/** A copy with its colour multiplied by `tint` (a multiplicative tint, which
 * SpriteKit has no exact equivalent for, so tints are baked in). */
function tinted(canvas: HTMLCanvasElement, tint: number): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  const image = ctx.getImageData(0, 0, copy.width, copy.height);
  const [r, g, b] = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255];
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = (image.data[i]! * r) / 255;
    image.data[i + 1] = (image.data[i + 1]! * g) / 255;
    image.data[i + 2] = (image.data[i + 2]! * b) / 255;
  }
  ctx.putImageData(image, 0, 0);
  return copy;
}
/** An offline robot's grey (see AtlasScene's `agent`). */
const OFFLINE_TINT = 0x9c9a92;

/** A banner painted from `ribbonShape`, on a canvas
 * `BANNER_SCALE` times its world size; `caption` is the caption's world box,
 * which the plaza's props keep clear of. */
function paintBanner(label: Label) {
  const font = ribbonFont(label.kind);
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `${font.weight} ${font.size}px ${LABEL_FONT}`;
  const widthOf = (s: string) =>
    [...s].reduce((w, c) => w + measure.measureText(c).width, 0) + font.letterSpacing * Math.max(0, [...s].length - 1);
  const text = fitCaption(label.text, label.maxWidth, (s) => (font.letterSpacing ? widthOf(s) : measure.measureText(s).width));
  const captionWidth = font.letterSpacing ? widthOf(text) : measure.measureText(text).width;
  const probe = measure.measureText("|MÉqgy");
  const ascent = probe.actualBoundingBoxAscent,
    descent = probe.actualBoundingBoxDescent;
  const shape = ribbonShape(label.kind, captionWidth, label.faded);
  // World box around (0, 0): the tails reach 19 past the body, the shadow and tails' feet below.
  const left = -shape.width / 2 - 21,
    top = -shape.height / 2 - 2,
    width = shape.width + 42,
    height = shape.height + 14;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * BANNER_SCALE);
  canvas.height = Math.ceil(height * BANNER_SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(BANNER_SCALE, BANNER_SCALE);
  ctx.translate(-left, -top);
  const rgba = (color: number, alpha = 1) =>
    `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;
  const rounded = (b: { x: number; y: number; width: number; height: number }, r: number) => {
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.width, b.height, r);
  };
  rounded(shape.shadow, RIBBON_SHADOW.radius);
  ctx.fillStyle = rgba(RIBBON_SHADOW.color, RIBBON_SHADOW.alpha);
  ctx.fill();
  ctx.lineJoin = "round";
  for (const tail of shape.tails) {
    ctx.beginPath();
    tail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = rgba(shape.tailFill);
    ctx.fill();
    ctx.lineWidth = RIBBON_STROKE.tail;
    ctx.strokeStyle = rgba(shape.stroke);
    ctx.stroke();
  }
  rounded(shape.body, RIBBON_BODY_RADIUS);
  ctx.fillStyle = rgba(shape.fill);
  ctx.fill();
  ctx.lineWidth = RIBBON_STROKE.body;
  ctx.strokeStyle = rgba(shape.stroke);
  ctx.stroke();
  const inset = RIBBON_HIGHLIGHT.inset;
  ctx.beginPath();
  ctx.moveTo(shape.body.x + inset, shape.body.y + inset);
  ctx.lineTo(shape.body.x + shape.body.width - inset, shape.body.y + inset);
  ctx.lineWidth = RIBBON_HIGHLIGHT.width;
  ctx.strokeStyle = rgba(RIBBON_HIGHLIGHT.color, RIBBON_HIGHLIGHT.alpha);
  ctx.stroke();
  ctx.font = measure.font;
  ctx.fillStyle = shape.text;
  ctx.textBaseline = "alphabetic";
  const baseline = -(ascent + descent) / 2 + ascent;
  if (font.letterSpacing) {
    let x = -captionWidth / 2;
    for (const c of text) {
      ctx.fillText(c, x, baseline);
      x += measure.measureText(c).width + font.letterSpacing;
    }
  } else {
    ctx.textAlign = "center";
    ctx.fillText(text, 0, baseline);
  }
  return {
    canvas,
    x: label.x + left,
    y: label.y + top,
    width,
    height,
    caption: {
      x: label.x - captionWidth / 2,
      y: label.y - (ascent + descent) / 2,
      width: captionWidth,
      height: ascent + descent,
    },
  };
}

type Message = Record<string, unknown> & { type: string };
type NativeEvent =
  | { type: "ready" }
  | { type: "pick"; id: string | null }
  | { type: "hover"; id: string | null; x?: number; y?: number }
  | { type: "zoom"; zoom: number }
  | { type: "state"; state: Record<string, unknown> }
  | { type: "error"; message: string };

/** Mount the native Atlas for `parent`, the React map surface. */
export function mountNativeAtlas(parent: HTMLElement, handlers: AtlasHandlers = {}): AtlasWorld {
  const post = (message: Message) => channel()?.postMessage(message);
  let destroyed = false;
  let ready = false;
  let art: Art | null = null;
  let data: AtlasData | null = null;
  let layout: AtlasLayout | null = null;
  let selection: string | null = null;
  let hovered: string | null = null;
  /** Where the hover card points, as Swift last reported it. */
  let hoverAt: { x: number; y: number } | undefined;
  let enabled = true;
  let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let zoom = 1;
  /** What Swift last reported of itself, for `inspect`. */
  let nativeState: Record<string, unknown> = {};
  let builds = 0;
  /** Banner images Swift already holds, by content key. */
  const sent = new Set<string>();
  /** Terrain pieces Swift holds, by their `terrainParts` key. */
  const painted = new Map<string, Piece>();
  /** The PR flags and garden plants last sent, for `inspect`. */
  let planted: ReturnType<typeof placeFlags> = [];
  let plants: Placed[] = [];
  /** Each project's lamps and beacon, placed with its plaza. */
  let signals = new Map<string, Signal[]>();
  const entity = (id: string | null) => (id && layout?.entities.find((e) => e.id === id)) || null;

  const aspect = () =>
    parent.clientWidth && parent.clientHeight ? parent.clientWidth / parent.clientHeight : 1.6;
  const sizeOf = (name: string) => {
    const frame = art!.frames.get(frameName(name))!;
    return { width: frame.width, height: frame.height };
  };
  const maskOf = (name: string) => {
    let mask = art!.masks.get(name);
    if (!mask) {
      const canvas = crop(art!.frames.get(name)!);
      mask = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
      art!.masks.set(name, mask);
    }
    return mask;
  };

  /** Everything that only changes when cells change: terrain, buildings,
   * plaza props, camp flags, banners, and what each entity covers. */
  const sceneOf = (layout: AtlasLayout): Message => {
    // Terrain Swift already holds keeps its texture; only new pieces are painted.
    const pieces = terrainParts(layout, art!.sand).map(({ key, paint }) => {
      let piece = painted.get(key);
      const fresh = !piece;
      if (!piece) painted.set(key, (piece = paint()));
      const canvas = piece.tint === undefined ? piece.canvas : tinted(piece.canvas, piece.tint);
      return { key, piece, png: fresh ? png(canvas) : undefined };
    });
    for (const key of [...painted.keys()]) if (!pieces.some((p) => p.key === key)) painted.delete(key);
    // A PR flag takes the place of its cell's garden plant.
    const placed = placeStructures(layout, sizeOf, { flags: true });
    const banners = labels(layout).map((label) => ({ label, art: paintBanner(label) }));
    // Swift drops banners a scene leaves out, so one that returns is sent again.
    const shown = new Set(banners.map(({ label }) => `banner:${JSON.stringify(label)}`));
    for (const key of [...sent]) if (!shown.has(key)) sent.delete(key);
    const sprites: Placed[] = [...placed];
    plants = placed.filter((s) => !s.footprint);
    signals = new Map();
    layout.projects.forEach((p, i) => {
      const building = placed.find((s) => s.entity === p.id && s.footprint)!;
      const caption = banners[i]!.art.caption;
      const props = plaza(p, artMask(maskOf(building.frame), building), {
        // The ribbon's tails and shadow reach past its caption.
        x: caption.x - 34,
        y: caption.y - 8,
        width: caption.width + 68,
        height: caption.height + 20,
      }, sizeOf);
      sprites.push(...props.props);
      signals.set(p.id, props.signals);
    });
    const where = locations(layout);
    const landOf = (host: string) => layout.land.filter((m) => m.host === host).flatMap((m) => m.cells);
    const image = (key: string, canvas: HTMLCanvasElement) => {
      if (sent.has(key)) return undefined;
      sent.add(key);
      return png(canvas);
    };
    return {
      type: "scene",
      build: ++builds,
      bounds: landBounds(layout),
      pieces: pieces.map(({ piece, key, png }) => ({
        key,
        png,
        x: piece.x,
        y: piece.y,
        width: piece.width,
        height: piece.height,
        depth: piece.depth,
        alpha: piece.alpha ?? 1,
      })),
      sprites: sprites.map((s) => ({
        frame: frameName(s.frame),
        x: s.x,
        y: s.y,
        width: s.width,
        depth: s.depth,
        alpha: s.alpha,
        flipX: s.flipX,
      })),
      flags: campFlags(layout),
      // PR flags stand on their pole's foot, so the running CI one sways about it.
      prFlags: (planted = placeFlags(layout, sizeOf)).map((f) => ({
        frame: f.frame,
        flag: f.flag,
        workspace: f.entity,
        x: f.x,
        y: f.y,
        width: f.width,
        depth: f.depth,
        alpha: f.alpha,
        sway: f.flag === "ci-running",
      })),
      banners: banners.map(({ label, art }) => {
        const key = `banner:${JSON.stringify(label)}`;
        return { key, png: image(key, art.canvas), x: art.x, y: art.y, width: art.width, height: art.height };
      }),
      entities: layout.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        cells: (e.kind === "host" ? landOf(e.id) : footprint(e)).map((c) => [c.q, c.r]),
        at: where.get(e.id),
      })),
    };
  };
  /** What changes with the agents' states: tiles, lit signals, robots. */
  const agentsOf = (layout: AtlasLayout): Message => ({
    type: "agents",
    tiles: tiles(layout),
    lights: lights(layout, signals).map((l) => ({ ...l, width: PROP_WIDTH[l.kind] })),
    robots: robots(layout).map((r) => ({ ...r, seed: seedOf(r.id + "walk"), droneSeed: seedOf(r.id + "drones") })),
  });
  const relayout = () => {
    if (!data || !art || destroyed) return;
    const next = layoutAtlas(data, aspect());
    const structural = layout?.signature !== next.signature;
    layout = next;
    try {
      if (structural) post(sceneOf(next));
      post(agentsOf(next));
    } catch (error) {
      console.error(error);
      handlers.error?.("The native world could not be drawn. Reload to retry.");
      return;
    }
    if (selection && !entity(selection)) selection = null;
    // A hover outlives an update: its card shows the entity's new state.
    if (hovered) setHover(entity(hovered) ? hovered : null, hoverAt);
  };

  const setHover = (id: string | null, at?: { x: number; y: number }) => {
    hovered = id;
    hoverAt = id ? at : undefined;
    const e = entity(id);
    handlers.hover?.(e, e && at ? at : null);
  };
  const receive = (event: Event) => {
    const message = (event as CustomEvent<NativeEvent>).detail;
    if (destroyed || !message) return;
    if (message.type === "ready") {
      if (ready) return;
      ready = true;
      post({ type: "select", id: selection });
      handlers.ready?.();
    } else if (message.type === "pick") {
      if (!enabled) return;
      handlers.pick?.(entity(message.id));
    } else if (message.type === "hover") {
      parent.style.cursor = message.id ? "pointer" : "";
      setHover(message.id, message.x === undefined ? undefined : { x: message.x, y: message.y! });
    } else if (message.type === "zoom") {
      zoom = message.zoom;
      handlers.zoom?.(zoom);
    } else if (message.type === "state") {
      nativeState = message.state;
    } else if (message.type === "error") handlers.error?.(message.message);
  };
  window.addEventListener("paseo:world", receive);

  // The map's rectangle in the page, so Swift can lay its view under it.
  const viewport = () => {
    if (destroyed) return;
    const r = parent.getBoundingClientRect();
    post({ type: "viewport", x: r.x, y: r.y, width: r.width, height: r.height });
  };
  let lastAspect = aspect();
  const resized = () => {
    viewport();
    // The layout follows the map's shape: tall maps stack hosts vertically.
    if (Math.abs(aspect() - lastAspect) > 1e-3) {
      lastAspect = aspect();
      relayout();
    }
  };
  const resize = new ResizeObserver(resized);
  resize.observe(parent);
  window.addEventListener("resize", resized);

  // Input on the map surface goes to Swift; React's overlays sit above it in
  // the page and keep their own.
  const local = (e: { clientX: number; clientY: number }) => {
    const r = parent.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pointer = (phase: string) => (e: PointerEvent) => {
    if (!enabled || e.pointerType === "touch") return;
    if (phase === "down") {
      if (e.button !== 0) return;
      parent.setPointerCapture(e.pointerId);
    }
    post({ type: "pointer", phase, ...local(e), buttons: e.buttons });
  };
  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ["pointerdown", pointer("down") as EventListener],
    ["pointermove", pointer("move") as EventListener],
    ["pointerup", pointer("up") as EventListener],
    ["pointercancel", pointer("up") as EventListener],
    ["pointerleave", pointer("leave") as EventListener],
    ["contextmenu", ((e: Event) => e.preventDefault()) as EventListener],
    [
      "wheel",
      ((e: WheelEvent) => {
        e.preventDefault();
        if (!enabled) return;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? parent.clientHeight : 1;
        post({ type: "wheel", ...local(e), dy: e.deltaY * unit });
      }) as EventListener,
      { passive: false },
    ],
    // Safari's trackpad pinch.
    [
      "gesturestart",
      ((e: Event) => {
        e.preventDefault();
        pinch = 1;
      }) as EventListener,
    ],
    [
      "gesturechange",
      ((e: Event & { scale: number; clientX: number; clientY: number }) => {
        e.preventDefault();
        if (!enabled) return;
        post({ type: "pinch", ...local(e), scale: e.scale / pinch });
        pinch = e.scale;
      }) as EventListener,
    ],
    [
      "keydown",
      ((e: KeyboardEvent) => {
        if (!enabled || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          post({ type: "key", key: e.key, down: true });
        } else if (e.key === "Home" || e.key.toLowerCase() === "f") post({ type: "command", name: "home" });
        else if (e.key === "Escape") handlers.pick?.(null);
      }) as EventListener,
    ],
    [
      "keyup",
      ((e: KeyboardEvent) => e.key.startsWith("Arrow") && post({ type: "key", key: e.key, down: false })) as EventListener,
    ],
    ["blur", (() => post({ type: "key", key: "all", down: false })) as EventListener],
  ];
  let pinch = 1;
  for (const [type, listener, options] of listeners) parent.addEventListener(type, listener, options);

  // The art is painted once per page; Swift keeps it as textures.
  void (async () => {
    try {
      const [buildings, robotSheet, foliage, sand, props, structures, flags] = await Promise.all(
        [buildingsUrl, robotsUrl, foliageUrl, sandUrl, propsUrl, structuresUrl, flagsUrl].map(load),
      );
      const frames = buildFrames({ buildings: buildings!, robots: robotSheet!, foliage: foliage!, structures: structures! });
      for (const [name, frame] of propFrames(props!, PROPS)) frames.set(name, frame);
      for (const [name, frame] of flagFrames(flags!, PR_LABELS.map(({ flag }) => `flag-${flag}`))) frames.set(name, frame);
      const sent = [...frames].map(([name, frame]) => ({ name, png: png(crop(frame)) }));
      // Offline robots stand greyed; their parts are sent pre-tinted.
      for (const [name, frame] of frames)
        if (/^robot-\w+-(body|hand-l|hand-r)$/.test(name))
          sent.push({ name: `${name}~offline`, png: png(tinted(crop(frame), OFFLINE_TINT)) });
      if (destroyed) return;
      art = { frames, sand: sand!, masks: new Map() };
      post({
        type: "art",
        frames: sent,
        tiles: { water: png(waterTile()), glints: png(glintsTile()), clouds: png(cloudsTile()) },
        constants: {
          hexRadius: HEX_RADIUS,
          robotSize: ROBOT_SIZE,
          droneSize: DRONE_SIZE,
          droneOrbit: DRONE_ORBIT,
          maxZoom: MAX_ZOOM,
          overlayTop: OVERLAY_TOP,
          overlayBottom: OVERLAY_BOTTOM,
          wander: { x: WANDER_X, y: WANDER_Y, speed: WALK_SPEED, turn: TURN_SPEED },
          hover: HOVER_COLOR,
          flagFoot: FLAG_FOOT,
          flagSway: FLAG_SWAY,
        },
        reduced,
      });
      viewport();
      relayout();
    } catch (error) {
      handlers.error?.(error instanceof Error ? error.message : "Could not prepare the native world.");
    }
  })();

  return {
    kind: "atlas",
    native: true,
    update: (next) => {
      data = next;
      relayout();
    },
    select: (id) => {
      selection = id && (!layout || entity(id)) ? id : null;
      if (ready) post({ type: "select", id: selection });
      handlers.selection?.(entity(selection));
    },
    focus: (id, closer) => ready && post({ type: "focus", id, zoom: !!closer }),
    command: (name) => ready && post({ type: "command", name }),
    workspace: (info) => post({ type: "workspace", workspace: info }),
    input: (on) => {
      enabled = on;
      post({ type: "input", enabled: on });
      if (!on && hovered) setHover(null);
    },
    motion: (next = !reduced) => {
      reduced = next;
      post({ type: "motion", reduced });
      return reduced;
    },
    inspect: () =>
      ready && layout
        ? {
            scene: "atlas",
            renderer: "SpriteKit",
            selected: selection,
            hovered,
            motion: !reduced,
            zoom,
            builds,
            native: nativeState,
            islands: layout.islands.map((i) => ({ key: i.key, host: i.host, name: i.name, online: i.online, cells: i.cells.length })),
            agents: layout.agents.map((a) => ({ id: a.id, name: a.name, state: a.state, model: a.model, workspace: a.workspace, at: point(a.position) })),
            tiles: Object.fromEntries(tiles(layout).map((t) => [t.id, t.state])),
            flags: Object.fromEntries(layout.workspaces.filter((w) => w.flags && !w.camp).map((w) => [w.id, w.flags])),
            workspaces: layout.workspaces.map((w) => ({ id: w.id, name: w.name, camp: !!w.camp })),
            planted: planted.map((f) => {
              const size = sizeOf(f.frame),
                halfW = f.width / 2,
                halfH = (f.width * size.height) / size.width / 2;
              return {
                workspace: f.entity,
                flag: f.flag,
                sway: f.flag === "ci-running",
                inCell: [-1, 1].every((dx) => [-1, 1].every((dy) => insideFootprint(f.x + dx * halfW, f.y + dy * halfH, [f.cell]))),
                plantInCell: plants.some((p) => p.entity === f.entity && insideFootprint(p.x, p.y, [f.cell])),
              };
            }),
          }
        : undefined,
    destroy: () => {
      destroyed = true;
      ready = false;
      resize.disconnect();
      window.removeEventListener("resize", resized);
      window.removeEventListener("paseo:world", receive);
      for (const [type, listener, options] of listeners) parent.removeEventListener(type, listener, options);
      post({ type: "detach" });
    },
  };
}

export type { Entity };
