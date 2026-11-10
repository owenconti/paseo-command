/**
 * The Dungeon Board's right-click menu: what you can do with the robot or alcove under the pointer (talk to it,
 * open its chat, dispatch an agent there, archive it), in the dialogue box's painted frame. It opens at the pointer,
 * kept inside the window; ↑/↓ move, Enter picks, Esc, a click elsewhere or the window changing closes it.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import "./board-menu.css";

export type BoardMenuItem = {
  id: string;
  label: string;
  hint?: string;
  tone?: "deny";
  disabled?: boolean;
  run: () => void;
};

const MARGIN = 8;

export function BoardMenu({ x, y, title, items, frame, onClose }: {
  /** Where it opens, in the window's coordinates. */
  x: number;
  y: number;
  title: string;
  items: BoardMenuItem[];
  frame?: CSSProperties;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // At the pointer, flipped or nudged to stay wholly in the window.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const root = document.documentElement;
    const left = x + width + MARGIN > root.clientWidth ? Math.max(MARGIN, x - width) : x;
    const top = y + height + MARGIN > root.clientHeight ? Math.max(MARGIN, y - height) : y;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }, [x, y]);
  useEffect(() => {
    const menu = ref.current;
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      if (!menu?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Ahead of the dialogue box's and the map's own Escape.
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    const gone = () => close.current();
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", gone);
    window.addEventListener("blur", gone);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", gone);
      window.removeEventListener("blur", gone);
      // The keyboard goes back to the map it was opened from, unless something else took it.
      const active = document.activeElement;
      if (!active || active === document.body || menu?.contains(active))
        document.querySelector<HTMLElement>(".native-map-surface")?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      ref={ref}
      className="board-menu dungeon-tooltip"
      style={{ ...frame, left: x, top: y }}
      role="menu"
      aria-label={title}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key as "Home"];
        if (to === undefined || !all.length) return;
        e.preventDefault();
        e.stopPropagation();
        all[(to + all.length) % all.length]!.focus();
      }}
    >
      <b className="board-menu-title">{title}</b>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`board-menu-item${item.tone ? ` ${item.tone}` : ""}`}
          data-item={item.id}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span>{item.label}</span>
          {item.hint && <small>{item.hint}</small>}
        </button>
      ))}
    </div>
  );
}
