import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { visibleBounds } from "./popover";

/*
 * The app's one tooltip, for icon-only buttons and links: they declare it as
 * `data-tip` (a control with a visible label has none; src/controls.test.ts).
 * A read-only summary marked `data-summary` may also have one, spelling out
 * what its text shortens, as may a link whose label only references what it
 * opens (a PR's number, an issue's key).
 * The layer shows hints on hover (after a short delay, at once when moving
 * between controls), when the keyboard moves focus onto a control (Tab,
 * arrows; not a dialog's own initial focus) and on a long press with touch. It
 * stays while the pointer is over the control or the tip itself, and Escape
 * dismisses it (that press does nothing else). It is kept inside the window,
 * and hidden once its control is scrolled out of view of any container; long
 * hints are cut short (the control, or what it opens, has them in full). A
 * trailing shortcut in parentheses, "Dispatch agent (D)", shows as a key.
 *
 * Only the app writes `data-tip`; the layer just reads it, so a hint is
 * always the current one. For assistive tech it becomes the control's
 * description, unless it only repeats the control's name, and its name when
 * it has none; both follow every change, and what the author set is left
 * alone.
 */

const SHOW_DELAY = 450;
/** Moving to another control within this long shows its tip at once. */
const WARM = 400;
/** Time to cross from the control onto its tooltip. */
const LINGER = 250;
const LONG_PRESS = 500;
const GAP = 8;
const MARGIN = 8;
/** Longer hints are cut short (the full text stays the description). */
export const MAX_TIP = 280;

/** "Close (Esc)" → text "Close", key "Esc". */
export function splitShortcut(tip: string): { text: string; key?: string } {
  const m =
    /^([\s\S]*\S)\s+\(((?:⌘|⌥|⇧|⌃|Ctrl\+|Alt\+|Shift\+)*(?:[A-Z0-9/\\.,;'[\]=\-`↵⌫↑↓←→]|Esc|Enter|Tab|Space)(?:\s*\/\s*(?:⌘|⌥|⇧)*(?:[A-Z0-9/\\↵↑↓←→]|Esc|Enter))*)\)$/.exec(
      tip,
    );
  return m ? { text: m[1], key: m[2] } : { text: tip };
}
/** What the tooltip shows: one short paragraph at most. */
export function brief(text: string) {
  const lines = text.split("\n");
  let out = lines.slice(0, 4).join("\n");
  if (out.length > MAX_TIP)
    out = out.slice(0, MAX_TIP - 1).replace(/\s+\S*$/, "");
  return out.length < text.length ? `${out.trimEnd()}…` : out;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
/** The control's name as assistive tech would read it (close enough to
 *  tell whether a description would only repeat it). */
function nameOf(el: HTMLElement) {
  const labelled = el.getAttribute("aria-labelledby");
  return norm(
    el.getAttribute("aria-label") ||
      (labelled
        ? labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
        : el.textContent),
  );
}

/** Ours to undo: names and descriptions this layer set. */
const OWN_LABEL = "tipLabel";
const OWN_DESC = "tipDescribed";

/**
 * Brings a control's accessible name and description in line with its
 * hint. Idempotent, and it reads only the current attributes, so it can run
 * any number of times, in any order.
 */
export function sync(el: HTMLElement) {
  const tip = (el.dataset.tip ?? "").trim();
  const ownLabel = el.dataset[OWN_LABEL] === "1";
  const authoredName =
    !ownLabel &&
    (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby"));
  const text = !!el.textContent?.trim();
  // A control with no name of its own is named by its hint.
  if (tip && !authoredName && !text) {
    if (el.getAttribute("aria-label") !== tip)
      el.setAttribute("aria-label", tip);
    el.dataset[OWN_LABEL] = "1";
  } else if (ownLabel) {
    el.removeAttribute("aria-label");
    delete el.dataset[OWN_LABEL];
  }
  // Its description, unless that only repeats the name; never over the author's.
  const ownDesc = el.dataset[OWN_DESC] === "1";
  if (el.hasAttribute("aria-description") && !ownDesc) return;
  const name = nameOf(el);
  const hint = norm(splitShortcut(tip).text);
  if (!tip || !hint || hint === name || name.includes(hint)) {
    if (ownDesc) {
      el.removeAttribute("aria-description");
      delete el.dataset[OWN_DESC];
    }
  } else {
    if (el.getAttribute("aria-description") !== tip)
      el.setAttribute("aria-description", tip);
    el.dataset[OWN_DESC] = "1";
  }
}

/** A visible icon without a visible text label needs a tooltip. */
export function isIconOnlyButton(el: HTMLElement) {
  if (
    !el.matches("button, [role=button], a[href]") ||
    !el.querySelector("svg, img, [role=img]")
  )
    return false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    const parent = walker.currentNode.parentElement;
    if (!parent || parent.closest("svg, [hidden], .sr-only, .visually-hidden"))
      continue;
    const style = getComputedStyle(parent);
    if (
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      !parent.getClientRects().length
    )
      continue;
    return false;
  }
  return true;
}

/** The icon-only button whose tip applies at `node`, if any. */
const hasTip = (el: HTMLElement) =>
  isIconOnlyButton(el) || el.hasAttribute("data-summary");
function tipped(node: EventTarget | null): HTMLElement | null {
  const el =
    node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null;
  return el && hasTip(el) ? el : null;
}

/** Whether any of `el` can be seen: not scrolled out of a container, nor
 *  out of the window. */
function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const b = visibleBounds(el);
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.bottom > b.top &&
    r.top < b.bottom &&
    r.right > b.left &&
    r.left < b.right
  );
}

type Shown = { el: HTMLElement; text: string };

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [place, setPlace] = useState<{
    shown: Shown;
    x: number;
    y: number;
    below: boolean;
  } | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const linger = useRef(0);
  const lastHidden = useRef(0);
  const current = useRef<HTMLElement | null>(null);
  /** Dismissed with Escape: stays away until the pointer or focus moves on. */
  const dismissed = useRef<HTMLElement | null>(null);
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;

  // Names and descriptions follow every hint as it appears or changes. The
  // records of one batch are coalesced: each control is brought up to date
  // once, from its attributes as they are now.
  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-tip]").forEach(sync);
    const watch = new MutationObserver((records) => {
      const touched = new Set<HTMLElement>();
      for (const r of records) {
        if (r.type === "attributes") touched.add(r.target as HTMLElement);
        else {
          const owner =
            r.target instanceof Element
              ? r.target.closest<HTMLElement>("[data-tip]")
              : null;
          if (owner) touched.add(owner);
          r.addedNodes.forEach((n) => {
            if (!(n instanceof HTMLElement)) return;
            if (n.dataset.tip !== undefined) touched.add(n);
            n.querySelectorAll<HTMLElement>("[data-tip]").forEach((e) =>
              touched.add(e),
            );
          });
        }
      }
      touched.forEach(sync);
      // The tip on show follows its control's hint.
      const s = shownRef.current;
      if (s && touched.has(s.el)) {
        const text = s.el.dataset.tip ?? "";
        if (!text || !hasTip(s.el)) setShown(null);
        else if (text !== s.text) setShown({ el: s.el, text });
      }
    });
    watch.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-tip", "aria-label", "aria-labelledby"],
    });
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current);
      clearTimeout(linger.current);
      if (shownRef.current) lastHidden.current = Date.now();
      current.current = null;
      setShown(null);
    };
    const show = (el: HTMLElement, immediate: boolean) => {
      clearTimeout(linger.current);
      if (current.current === el) return;
      // Never leave another control's tip showing under this one.
      if (dismissed.current === el) return hide();
      clearTimeout(timer.current);
      const text = el.dataset.tip ?? "";
      if (!text) return hide();
      const warm = Date.now() - lastHidden.current < WARM || !!shownRef.current;
      current.current = el;
      const go = () => {
        if (current.current !== el) return;
        // Gone or out of view by now: let a later hover try again.
        if (!el.isConnected || !visible(el) || !hasTip(el)) return hide();
        setShown({ el, text: el.dataset.tip ?? text });
      };
      if (immediate || warm) go();
      else {
        setShown(null);
        timer.current = window.setTimeout(go, SHOW_DELAY);
      }
    };
    /** Leaves after a moment, so the pointer can reach the tooltip. */
    const leave = () => {
      clearTimeout(linger.current);
      linger.current = window.setTimeout(hide, LINGER);
    };
    const onTip = (n: EventTarget | null) =>
      n instanceof Node && !!tip.current?.contains(n);
    /**
     * Hoverable without blocking: the tip takes no pointer events (whatever
     * it covers stays clickable), but while the pointer is anywhere in the
     * box spanning the control and the tip, it stays. Hovering another
     * button always takes priority over this travel area.
     */
    const inZone = (x: number, y: number) => {
      const el = current.current;
      const t = tip.current?.getBoundingClientRect();
      if (!el || !t || shownRef.current?.el !== el) return false;
      const r = el.getBoundingClientRect();
      const left = Math.min(r.left, t.left),
        right = Math.max(r.right, t.right),
        top = Math.min(r.top, t.top),
        bottom = Math.max(r.bottom, t.bottom);
      // Allow a diagonal path onto a wide or shifted tip.
      return x >= left && x <= right && y >= top && y <= bottom;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !shownRef.current) return;
      if (inZone(e.clientX, e.clientY)) clearTimeout(linger.current);
      else if (!current.current?.contains(e.target as Node)) leave();
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      // The tooltip is transparent to clicks, so pointer events name whatever
      // sits underneath it. Keep the hint while its actual box is hovered;
      // neighboring buttons outside that box still take priority immediately.
      const box = tip.current?.getBoundingClientRect();
      if (
        box &&
        shownRef.current?.el === current.current &&
        e.clientX >= box.left &&
        e.clientX <= box.right &&
        e.clientY >= box.top &&
        e.clientY <= box.bottom
      )
        return void clearTimeout(linger.current);
      const el = tipped(e.target);
      if (dismissed.current && dismissed.current !== el)
        dismissed.current = null;
      if (el) return show(el, false);
      // A labeled button has no visual tooltip and must not inherit its
      // neighbor's hint, even when it lies inside that hint's travel area.
      if (
        e.target instanceof Element &&
        e.target.closest("button, [role=button], [data-tip]")
      )
        return hide();
      if (onTip(e.target) || (shownRef.current && inZone(e.clientX, e.clientY)))
        return void clearTimeout(linger.current);
      if (current.current) leave();
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = current.current;
      if (!el) return;
      const to = e.relatedTarget;
      if (to instanceof Node && (el.contains(to) || onTip(to))) return;
      if (shownRef.current && inZone(e.clientX, e.clientY)) return;
      leave();
    };
    // Touch: a long press shows the tip (and the press doesn't also click).
    let press = 0;
    let pressing = false;
    let pressed: HTMLElement | null = null;
    const down = (e: PointerEvent) => {
      if (onTip(e.target)) return;
      if (e.pointerType !== "touch") {
        // Pressing a control dismisses its tip until the pointer leaves it.
        const el = tipped(e.target);
        if (el && current.current?.contains(e.target as Node))
          dismissed.current = el;
        hide();
        return;
      }
      hide();
      pressed = null;
      const el = tipped(e.target);
      if (!el) return;
      clearTimeout(press);
      pressing = true;
      tapped = el;
      press = window.setTimeout(() => {
        pressed = el;
        tapped = null;
        show(el, true);
      }, LONG_PRESS);
    };
    // Controls marked data-tip-tap also show their tip for a moment after a
    // quick tap (as well as acting): touch has no hover.
    let tapped: HTMLElement | null = null;
    let tapTimer = 0;
    const up = (e: PointerEvent) => {
      clearTimeout(press);
      pressing = false;
      const el = tapped;
      tapped = null;
      if (
        e.type !== "pointerup" ||
        !el ||
        !el.hasAttribute("data-tip-tap") ||
        pressed
      )
        return;
      show(el, true);
      clearTimeout(tapTimer);
      tapTimer = window.setTimeout(
        () => current.current === el && hide(),
        2500,
      );
    };
    const click = (e: MouseEvent) => {
      if (!pressed) return;
      // The press was for help, not to act.
      if (pressed.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
      }
      pressed = null;
    };
    // Only the long press's own gesture: mouse and keyboard context menus
    // (an image's Copy and Save) are left alone.
    const menu = (e: Event) => {
      if (pressing || pressed) e.preventDefault();
    };
    // Focus moved by the keyboard (Tab, arrows): not a dialog's own initial
    // focus or focus coming back, where Escape must close the dialog.
    let navigatedAt = -Infinity;
    const NAV = new Set([
      "Tab",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ]);
    const navigate = (e: KeyboardEvent) => {
      if (NAV.has(e.key)) navigatedAt = performance.now();
    };
    const focus = (e: FocusEvent) => {
      const el = tipped(e.target);
      const target = e.target as Element;
      if (performance.now() - navigatedAt > 400) return;
      if (dismissed.current && dismissed.current !== el)
        dismissed.current = null;
      // Keyboard focus only (a click already shows or hides by hover), and
      // not on text fields, where it would sit over what's being typed.
      if (
        el &&
        target.matches?.(":focus-visible") &&
        !target.matches("input, textarea, select, [contenteditable]") &&
        // Menu items and options are named on screen; Escape there closes the menu.
        !target.closest("[role=menu], [role=listbox]")
      )
        show(el, true);
    };
    const blur = (e: FocusEvent) => {
      if (current.current && !current.current.contains(e.relatedTarget as Node))
        hide();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !current.current || !shownRef.current) return;
      // Dismissed, and that's all the press does: a later Escape closes
      // whatever the tip was over (a menu, a dialog).
      dismissed.current = current.current;
      hide();
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("click", click, true);
    document.addEventListener("contextmenu", menu, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", blur, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keydown", navigate, true);
    // Scrolling (anywhere: lists keep themselves pinned) moves the tip with
    // its control, and hides it once the control is out of view.
    const scroll = () => {
      const s = shownRef.current;
      if (!s) return;
      if (!s.el.isConnected || !visible(s.el)) hide();
      else setShown({ ...s });
    };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", hide);
    return () => {
      clearTimeout(timer.current);
      clearTimeout(linger.current);
      clearTimeout(press);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("contextmenu", menu, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", blur, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keydown", navigate, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // Above the control, or below if there's no room; kept inside the window
  // on every side (its size is capped in CSS).
  useLayoutEffect(() => {
    if (!shown || !tip.current) return setPlace(null);
    const r = shown.el.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const fitsAbove = r.top - GAP - t.height >= MARGIN;
    const fitsBelow = r.bottom + GAP + t.height <= window.innerHeight - MARGIN;
    const below =
      !fitsAbove && (fitsBelow || r.top < window.innerHeight - r.bottom);
    const clamp = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(v, hi));
    const x = clamp(
      r.left + r.width / 2 - t.width / 2,
      MARGIN,
      window.innerWidth - MARGIN - t.width,
    );
    const y = clamp(
      below ? r.bottom + GAP : r.top - GAP - t.height,
      MARGIN,
      window.innerHeight - MARGIN - t.height,
    );
    setPlace({ shown, x, y, below });
  }, [shown]);

  if (!shown) return null;
  const positioned = place?.shown === shown ? place : null;
  const { text, key } = splitShortcut(shown.text);
  return createPortal(
    <div
      ref={tip}
      className={`tooltip ${positioned ? "shown" : ""} ${positioned?.below ? "below" : ""}`}
      role="tooltip"
      // The control's description carries it for assistive tech.
      aria-hidden="true"
      style={
        positioned
          ? { left: positioned.x, top: positioned.y }
          : { left: -9999, top: -9999 }
      }
    >
      <span>{brief(text)}</span>
      {key && <kbd>{key}</kbd>}
    </div>,
    document.body,
  );
}
