import type { ShortcutKey } from "./shortcutKey";

/** F fits the whole world: F alone, with no modifier (Shift+F, Cmd+F and the
 * rest stay with the page and the browser). */
export const isFitWorldKey = (event: ShortcutKey) =>
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "f";

type Focusable = {
  isContentEditable?: boolean;
  matches?(selector: string): boolean;
};
/** Whether keys pressed here type text: an input, a textarea, a select or
 * anything editable. World shortcuts stand down while typing. */
export const isTyping = (target: Focusable | null | undefined) =>
  !!target &&
  (target.isContentEditable === true ||
    !!target.matches?.(
      "input,textarea,select,[contenteditable]:not([contenteditable=false])",
    ));
