/** The Linear tab's text size: pixels over the app's own sizes, 2 by default.
 * ⌘+ and ⌘− step it, ⌘0 puts it back; `--linear-text` carries it to `linear.css`. */
export const TEXT_STEP = { default: 2, min: -2, max: 12 };

export type TextChange = "bigger" | "smaller" | "actual";

/** ⌘+ (or ⌘=, as + needs ⇧ on most layouts), ⌘− and ⌘0; null for any other key. */
export function textSizeKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): TextChange | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "+" || e.key === "=") return "bigger";
  if (e.key === "-" || e.key === "_") return "smaller";
  if (e.key === "0") return "actual";
  return null;
}

/** How much larger than at the default size the text is (1 there): `--linear-scale`, by which
 * the view's columns, rows, controls and menus grow with their text. */
export const textScale = (step: number) => (14 + step) / (14 + TEXT_STEP.default);

/** The scale now in force, for sizes laid out in script. */
export const shownTextScale = () =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--linear-scale")) || 1;

export function changeTextStep(step: number, change: TextChange): number {
  if (change === "actual") return TEXT_STEP.default;
  return Math.max(TEXT_STEP.min, Math.min(TEXT_STEP.max, step + (change === "bigger" ? 1 : -1)));
}

/** A remembered step, or the default for anything that isn't one. */
export function checkTextStep(step: unknown): number {
  return typeof step === "number" && Number.isInteger(step) && step >= TEXT_STEP.min && step <= TEXT_STEP.max
    ? step
    : TEXT_STEP.default;
}
