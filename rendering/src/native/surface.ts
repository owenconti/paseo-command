/**
 * The map surface's side of a native map (any style): it tells Swift where the
 * map lies in the page (so its view lies under it), forwards the pointer,
 * wheel, pinch and keys to Swift, which owns the camera, hover and picking, and
 * says when the map's shape changes (the layout follows it).
 */
export type Post = (message: Record<string, unknown> & { type: string }) => void;
export type Surface = { viewport(): void; aspect(): number; destroy(): void };

export function nativeSurface(
  parent: HTMLElement,
  post: Post,
  opts: {
    /** Whether input reaches the map now. */
    enabled: () => boolean;
    /** The map's shape changed (width over height). */
    reshaped: () => void;
    /** Escape: clear the choice. */
    escape: () => void;
  },
): Surface {
  let destroyed = false;
  const aspect = () => (parent.clientWidth && parent.clientHeight ? parent.clientWidth / parent.clientHeight : 1.6);
  // The map's rectangle in the page, so Swift can lay its view under it.
  let lastViewport = "";
  const viewport = () => {
    if (destroyed) return;
    const r = parent.getBoundingClientRect();
    lastViewport = `${r.x},${r.y},${r.width},${r.height}`;
    post({ type: "viewport", x: r.x, y: r.y, width: r.width, height: r.height });
  };
  // The map moves without resizing when the session panel changes sides: the root's
  // attributes say so (`data-panel-side`, `--unity-sidebar`). Only a real move is posted.
  const moved = new MutationObserver(() => {
    const r = parent.getBoundingClientRect();
    if (`${r.x},${r.y},${r.width},${r.height}` !== lastViewport) viewport();
  });
  moved.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-panel-side"] });
  let lastAspect = aspect();
  const resized = () => {
    viewport();
    // The layout follows the map's shape.
    if (Math.abs(aspect() - lastAspect) > 1e-3) {
      lastAspect = aspect();
      opts.reshaped();
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
    if (!opts.enabled() || e.pointerType === "touch") return;
    if (phase === "down") {
      if (e.button !== 0) return;
      parent.setPointerCapture(e.pointerId);
    }
    post({ type: "pointer", phase, ...local(e), buttons: e.buttons });
  };
  let pinch = 1;
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
        if (!opts.enabled()) return;
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
        if (!opts.enabled()) return;
        post({ type: "pinch", ...local(e), scale: e.scale / pinch });
        pinch = e.scale;
      }) as EventListener,
    ],
    [
      "keydown",
      ((e: KeyboardEvent) => {
        if (!opts.enabled() || e.metaKey || e.ctrlKey || e.altKey) return;
        // Left/Right select agents; they never enter the native map's pan loop.
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") return;
        if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          post({ type: "key", key: e.key, down: true });
        } else if (e.key === "Home" || e.key.toLowerCase() === "f") post({ type: "command", name: "home" });
        else if (e.key === "Escape") opts.escape();
      }) as EventListener,
    ],
    [
      "keyup",
      ((e: KeyboardEvent) => (e.key === "ArrowUp" || e.key === "ArrowDown") && post({ type: "key", key: e.key, down: false })) as EventListener,
    ],
    ["blur", (() => post({ type: "key", key: "all", down: false })) as EventListener],
  ];
  for (const [type, listener, options] of listeners) parent.addEventListener(type, listener, options);
  return {
    viewport,
    aspect,
    destroy: () => {
      destroyed = true;
      resize.disconnect();
      moved.disconnect();
      window.removeEventListener("resize", resized);
      for (const [type, listener, options] of listeners) parent.removeEventListener(type, listener, options);
    },
  };
}
