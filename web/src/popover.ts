/*
 * Placement for popovers anchored inside scrolling or clipped panels (the
 * composer's menus and autocomplete in the rail): open towards the side with
 * more room, inside every ancestor that clips them and the visual viewport,
 * and cap their height so every item can be scrolled to. Pure geometry is
 * exported for tests; `placePopover` is a React callback ref.
 */

export type Box = { top: number; bottom: number; left: number; right: number };
const GAP = 8;
const MARGIN = 6;

/**
 * Which way to open and how tall to be at most: up if it fits above (or
 * above has at least as much room), else down.
 */
export function placement(anchor: Box, bounds: Box, natural: number) {
  const above = Math.max(0, anchor.top - bounds.top - GAP - MARGIN);
  const below = Math.max(0, bounds.bottom - anchor.bottom - GAP - MARGIN);
  const up = natural <= above || above >= below;
  return {
    place: up ? ("up" as const) : ("down" as const),
    maxHeight: Math.floor(up ? above : below),
  };
}

/** The part of the screen `el` can show in: the viewport, cut by every clipping ancestor. */
export function visibleBounds(el: HTMLElement): Box {
  const vv = window.visualViewport;
  const b: Box = vv
    ? {
        top: vv.offsetTop,
        left: vv.offsetLeft,
        bottom: vv.offsetTop + vv.height,
        right: vv.offsetLeft + vv.width,
      }
    : { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  for (
    let p = el.parentElement;
    p && p !== document.body;
    p = p.parentElement
  ) {
    const s = getComputedStyle(p);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const r = p.getBoundingClientRect();
    b.top = Math.max(b.top, r.top);
    b.bottom = Math.min(b.bottom, r.bottom);
    b.left = Math.max(b.left, r.left);
    b.right = Math.min(b.right, r.right);
  }
  return b;
}

/** Below this much room on either side, a popover over a text field opens from its caret instead. */
const MIN_ROOM = 120;

/**
 * The caret's line box in a textarea, on screen. A hidden mirror lays out
 * the whole text as one text node exactly as the textarea does (content
 * width without its scrollbar, font, wrapping, direction and bidi), and a
 * collapsed DOM range at the caret gives its position as the browser lays
 * it out, through wrapping and bidi reordering. The box also covers the
 * character just before the caret (the one just typed): at a soft wrap or
 * a bidi boundary the caret can sit on either side, so neither is covered.
 */
export function caretLine(field: HTMLTextAreaElement): Box {
  const s = getComputedStyle(field);
  const text = field.value;
  const at = Math.min(field.selectionEnd ?? text.length, text.length);
  const mirror = document.createElement("div");
  const copy = [
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontStretch",
    "fontVariant",
    "fontFeatureSettings",
    "fontKerning",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "tabSize",
    "textIndent",
    "textAlign",
    "wordBreak",
    "lineBreak",
    "whiteSpace",
    "overflowWrap",
    "direction",
    "unicodeBidi",
    "writingMode",
  ] as const;
  for (const k of copy) mirror.style[k] = s[k];
  const dir = field.getAttribute("dir");
  if (dir) mirror.setAttribute("dir", dir);
  const lang = field.closest("[lang]")?.getAttribute("lang");
  if (lang) mirror.lang = lang;
  // The textarea's content width: its scrollbar, if any, narrows the text.
  const width =
    field.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "0",
    boxSizing: "content-box",
    width: `${width}px`,
    height: "auto",
    border: "0",
    margin: "0",
  });
  // A trailing newline (or none at all) needs something after it to make
  // its empty last line.
  const node = document.createTextNode(text + "\u200b");
  mirror.append(node);
  document.body.append(mirror);
  const origin = mirror.getBoundingClientRect();
  const range = document.createRange();
  const boxes: DOMRect[] = [];
  const add = (start: number, end: number) => {
    range.setStart(node, start);
    range.setEnd(node, end);
    for (const r of range.getClientRects()) if (r.height > 0) boxes.push(r);
  };
  add(at, at); // the caret itself
  if (at > 0 && text[at - 1] !== "\n") add(at - 1, at); // the character just typed
  if (!boxes.length) add(at, at + 1); // nothing laid out at the caret: the next one
  mirror.remove();
  const lineHeight = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
  // Each rect is a glyph box; its line box is lineHeight tall around it.
  let top = Infinity,
    bottom = -Infinity;
  for (const r of boxes) {
    const mid = (r.top + r.bottom) / 2 - origin.top;
    top = Math.min(top, mid - lineHeight / 2);
    bottom = Math.max(bottom, mid + lineHeight / 2);
  }
  if (!Number.isFinite(top)) {
    top = parseFloat(s.paddingTop);
    bottom = top + lineHeight;
  }
  const r = field.getBoundingClientRect();
  const y = r.top + field.clientTop - field.scrollTop;
  return { top: y + top, bottom: y + bottom, left: r.left, right: r.right };
}

function place(el: HTMLElement) {
  const anchor = el.parentElement;
  if (!anchor) return;
  // Its own height and its stylesheet's cap and position, without ours.
  const scrolled = el.scrollTop;
  el.style.maxHeight = el.style.top = el.style.bottom = "";
  const natural = el.scrollHeight;
  const cap = parseFloat(getComputedStyle(el).maxHeight);
  const want = Math.min(natural, Number.isFinite(cap) ? cap : Infinity);
  const bounds = visibleBounds(el);
  const a = anchor.getBoundingClientRect();
  let p = placement(a, bounds, want);
  let where: string = p.place;
  // An anchor that fills all the room (the expanded editor) leaves none on
  // either side: open from the caret's line instead, inside the anchor, if
  // that gives more room.
  const field = anchor.querySelector("textarea");
  if (p.maxHeight < Math.min(want, MIN_ROOM) && field) {
    const line = caretLine(field);
    const inside = {
      ...bounds,
      top: Math.max(bounds.top, a.top),
      bottom: Math.min(bounds.bottom, a.bottom),
    };
    const q = placement(line, inside, want);
    if (q.maxHeight > p.maxHeight) {
      p = q;
      // Offsets from the anchor's padding box, which positions it.
      if (q.place === "up") {
        el.style.top = "auto";
        el.style.bottom = `${a.bottom - anchor.clientTop - line.top + GAP}px`;
      } else {
        el.style.bottom = "auto";
        el.style.top = `${line.bottom - a.top - anchor.clientTop + GAP}px`;
      }
      where = `caret-${q.place}`;
    }
  }
  el.dataset.place = where;
  el.style.maxHeight = `${Math.min(want, p.maxHeight)}px`;
  el.style.overflowY = "auto";
  el.scrollTop = scrolled;
}

/**
 * Callback ref: places the popover when it mounts, and again when it or the
 * viewport changes size (results arriving, a keyboard opening).
 */
export function placePopover(el: HTMLElement | null) {
  if (!el) return;
  let frame = 0;
  const again = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => place(el));
  };
  place(el);
  const observer = new ResizeObserver(again);
  // Its content, not itself: capping its own height must not re-trigger.
  for (const child of el.children) observer.observe(child);
  const mutations = new MutationObserver(() => {
    observer.disconnect();
    for (const child of el.children) observer.observe(child);
    again();
  });
  mutations.observe(el, { childList: true });
  window.addEventListener("resize", again);
  window.visualViewport?.addEventListener("resize", again);
  // Opened from a caret, it follows the caret.
  const field = el.parentElement?.querySelector("textarea");
  const caretEvents = ["input", "scroll", "keyup", "click"] as const;
  for (const e of caretEvents) field?.addEventListener(e, again);
  return () => {
    for (const e of caretEvents) field?.removeEventListener(e, again);
    cancelAnimationFrame(frame);
    observer.disconnect();
    mutations.disconnect();
    window.removeEventListener("resize", again);
    window.visualViewport?.removeEventListener("resize", again);
  };
}
