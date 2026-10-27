export const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);
export const RASTER = /^image\/(png|jpe?g|gif|webp)$/;
export const MAX_IMAGE = 20 * 1024 * 1024;
export const MAX_UPLOAD = 50 * 1024 * 1024;
const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl+";
export const prettySize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

export function readDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Insert text as if typed: keeps native undo and fires React's onChange. */
export function insertAtCaret(area: HTMLTextAreaElement, value: string) {
  area.focus();
  if (document.execCommand?.("insertText", false, value)) return;
  const { selectionStart: start, selectionEnd: end } = area;
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(
    area,
    area.value.slice(0, start) + value + area.value.slice(end),
  );
  area.setSelectionRange(start + value.length, start + value.length);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}
