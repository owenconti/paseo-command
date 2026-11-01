import { useRef } from "react";

/**
 * A panel's vertical edge that resizes it: dragged, or ←/→ from the keyboard
 * (⇧ for bigger steps); double-click puts the default back. It sits on its
 * parent's right edge (the parent is `position: relative`). `grows` says which
 * way dragging makes the panel wider: "right" for a panel on the left of the
 * edge, "left" for one on its right. `value` is the panel's width now.
 */
export function ResizeEdge({
  label,
  controls,
  value,
  min,
  max,
  grows,
  onResize,
  onReset,
}: {
  label: string;
  controls?: string;
  value: number;
  min: number;
  max?: number;
  grows: "right" | "left";
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const sign = grows === "right" ? 1 : -1;
  const end = () => (drag.current = null);
  return (
    <div
      className="resize-edge"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-description="Drag, or use the arrow keys, to change the width. Shift resizes faster; double-click restores the default."
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width: value };
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(drag.current.width + sign * (e.clientX - drag.current.x));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        const right = e.key === "ArrowRight" ? 1 : -1;
        onResize(value + sign * right * (e.shiftKey ? 64 : 16));
      }}
    />
  );
}
