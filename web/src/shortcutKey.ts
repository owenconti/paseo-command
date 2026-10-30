/** The key and modifiers shared by app shortcut matchers. */
export type ShortcutKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;
