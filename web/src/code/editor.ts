/**
 * The Files tab's editor: CodeMirror 6 with the app's look, vim keys (`@replit/codemirror-vim`, Settings → Files),
 * the file's language (`@codemirror/language-data`, loaded as needed), its language server's features once connected
 * (`lspExtensions`), and a diff against the file's base (`@codemirror/merge`'s unified view: deletions shown inline,
 * each change revertible).
 *
 * What a buffer does (save, go to definition, usages…) is the store's (`store.ts`), reached from keys and Ex commands
 * through `actionsOf(view)`.
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { languages } from "@codemirror/language-data";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintGutter, lintKeymap, nextDiagnostic, previousDiagnostic } from "@codemirror/lint";
import {
  formatKeymap,
  hoverTooltips,
  jumpToDefinition,
  jumpToTypeDefinition,
  languageServerSupport,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
  signatureKeymap,
  type LSPClient,
} from "@codemirror/lsp-client";
import { unifiedMergeView } from "@codemirror/merge";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";

/** What a buffer's keys and Ex commands ask of the Files tab. */
export type BufferActions = {
  save: () => void;
  saveAll: () => void;
  close: () => void;
  open: (path: string) => void;
  usages: () => void;
  rename: () => void;
  hover: () => void;
  back: () => void;
  forward: () => void;
  quickOpen: () => void;
  toggleDiff: () => void;
};
const actions = new WeakMap<EditorView, BufferActions>();
export const setActions = (view: EditorView, a: BufferActions) => actions.set(view, a);
export const actionsOf = (view: EditorView) => actions.get(view);

/** The parts of a buffer's configuration that change while it's open. */
export type Parts = {
  language: Compartment;
  vim: Compartment;
  theme: Compartment;
  lsp: Compartment;
  diff: Compartment;
  readOnly: Compartment;
};
export const newParts = (): Parts => ({
  language: new Compartment(),
  vim: new Compartment(),
  theme: new Compartment(),
  lsp: new Compartment(),
  diff: new Compartment(),
  readOnly: new Compartment(),
});

const dark = () => document.documentElement.dataset.theme !== "light";

/** The app's look: its surfaces, text, lines and accent, a monospace at the pages' text size. */
const look = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--surface, var(--panel))", fontSize: "calc(var(--fs-sm) + var(--page-text, 0px) * 0.5)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "var(--surface, var(--panel))", color: "var(--text-4)", borderRight: "1px solid var(--line-soft, var(--line))" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fill) 55%, transparent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent) !important" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  ".cm-fat-cursor": { background: "color-mix(in srgb, var(--accent) 70%, transparent) !important", color: "var(--on-accent, #000) !important" },
  "&:not(.cm-focused) .cm-fat-cursor": { background: "none !important", outline: "1px solid color-mix(in srgb, var(--accent) 70%, transparent) !important" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--text)", borderColor: "var(--line)" },
  ".cm-panels input, .cm-panels button": { font: "inherit" },
  ".cm-vim-panel": { fontFamily: "var(--font-mono)", padding: "2px 8px" },
  ".cm-vim-panel input": { color: "var(--text)", background: "transparent", border: "0", outline: "0", fontFamily: "var(--font-mono)" },
  ".cm-tooltip": { backgroundColor: "var(--panel-raised)", color: "var(--text)", border: "1px solid var(--line-mid)", borderRadius: "var(--radius-md)", maxWidth: "min(640px, 90vw)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft, var(--fill-strong))", color: "var(--text-strong)" },
  ".cm-lsp-documentation": { fontFamily: "var(--font-sans, inherit)", fontSize: "var(--fs-sm)", maxHeight: "40vh", overflow: "auto" },
  ".cm-lsp-documentation pre, .cm-lsp-documentation code": { fontFamily: "var(--font-mono)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--amber, #d9a23a) 30%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--amber, #d9a23a) 55%, transparent)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--fill)", border: "0", color: "var(--text-3)" },
  // The diff: inserted lines and words green, deleted ones red, as the GitHub tab's.
  ".cm-changedLine": { backgroundColor: "color-mix(in srgb, var(--green, #25ae7e) 10%, transparent) !important" },
  ".cm-changedText": { background: "color-mix(in srgb, var(--green, #25ae7e) 28%, transparent) !important" },
  ".cm-deletedChunk": { backgroundColor: "color-mix(in srgb, var(--red, #e5484d) 10%, transparent)" },
  ".cm-deletedChunk .cm-deletedText, .cm-deletedChunk del": { background: "color-mix(in srgb, var(--red, #e5484d) 30%, transparent)", textDecoration: "none" },
  ".cm-changeGutter": { width: "3px", paddingLeft: "1px" },
  ".cm-changedLineGutter": { background: "var(--green, #25ae7e)" },
  ".cm-deletedLineGutter": { background: "var(--red, #e5484d)" },
  ".cm-collapsedLines": { color: "var(--text-3)", background: "var(--fill-soft, var(--fill))", fontFamily: "var(--font-sans, inherit)", fontSize: "var(--fs-xs)" },
  ".cm-chunkButtons button": { font: "inherit", fontSize: "var(--fs-2xs, 11px)", cursor: "pointer", border: "1px solid var(--line-mid)", background: "var(--panel)", color: "var(--text-2)", borderRadius: "var(--radius-sm)", padding: "0 6px" },
});
const themeOf = () => [look, syntaxHighlighting(dark() ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true })];

/** Vim: once, its own commands for the Files tab (each finds its buffer by view). */
let vimReady = false;
function setUpVim() {
  if (vimReady) return;
  vimReady = true;
  const on = (name: Exclude<keyof BufferActions, "open">) => (cm: { cm6: EditorView }) => actionsOf(cm.cm6)?.[name]();
  Vim.defineEx("write", "w", (cm) => on("save")(cm as never));
  Vim.defineEx("wall", "wa", (cm) => on("saveAll")(cm as never));
  Vim.defineEx("update", "up", (cm) => on("save")(cm as never));
  Vim.defineEx("xit", "x", (cm) => {
    on("save")(cm as never);
    on("close")(cm as never);
  });
  Vim.defineEx("wq", "wq", (cm) => {
    on("save")(cm as never);
    on("close")(cm as never);
  });
  Vim.defineEx("quit", "q", (cm) => on("close")(cm as never));
  Vim.defineEx("bdelete", "bd", (cm) => on("close")(cm as never));
  Vim.defineEx("edit", "e", (cm, params) => {
    const path = params.argString?.trim();
    const a = actionsOf((cm as unknown as { cm6: EditorView }).cm6);
    if (!a) return;
    if (path) a.open(path);
    else a.quickOpen();
  });
  Vim.defineEx("diff", "diff", (cm) => on("toggleDiff")(cm as never));
  const act = (name: string, run: (view: EditorView) => void) => Vim.defineAction(name, (cm) => run((cm as unknown as { cm6: EditorView }).cm6));
  act("paseoDefinition", (view) => void jumpToDefinition(view));
  act("paseoTypeDefinition", (view) => void jumpToTypeDefinition(view));
  act("paseoUsages", (view) => actionsOf(view)?.usages());
  act("paseoHover", (view) => actionsOf(view)?.hover());
  act("paseoRename", (view) => actionsOf(view)?.rename());
  act("paseoBack", (view) => actionsOf(view)?.back());
  act("paseoForward", (view) => actionsOf(view)?.forward());
  act("paseoNextDiagnostic", (view) => void nextDiagnostic(view));
  act("paseoPrevDiagnostic", (view) => void previousDiagnostic(view));
  act("paseoQuickOpen", (view) => actionsOf(view)?.quickOpen());
  const map = (keys: string, action: string) => Vim.mapCommand(keys, "action", action, {}, { context: "normal" });
  map("gd", "paseoDefinition");
  map("gy", "paseoTypeDefinition");
  map("gr", "paseoUsages");
  map("K", "paseoHover");
  map("<C-o>", "paseoBack");
  map("<C-i>", "paseoForward");
  map("<Tab>", "paseoForward");
  map("]d", "paseoNextDiagnostic");
  map("[d", "paseoPrevDiagnostic");
  map("<C-p>", "paseoQuickOpen");
  map("<Space>rn", "paseoRename");
}

/** The keys every buffer has, vim or not. */
const paneKeys = keymap.of([
  { key: "Mod-s", run: (v) => (actionsOf(v)?.save(), true), preventDefault: true },
  { key: "Mod-p", run: (v) => (actionsOf(v)?.quickOpen(), true), preventDefault: true },
  { key: "F12", run: jumpToDefinition, preventDefault: true },
  { key: "Shift-F12", run: (v) => (actionsOf(v)?.usages(), true), preventDefault: true },
  { key: "F2", run: (v) => (actionsOf(v)?.rename(), true), preventDefault: true },
  { key: "Alt-ArrowLeft", run: (v) => (actionsOf(v)?.back(), true) },
  { key: "Alt-ArrowRight", run: (v) => (actionsOf(v)?.forward(), true) },
  { key: "Ctrl--", run: (v) => (actionsOf(v)?.back(), true) },
  { key: "Ctrl-Shift--", run: (v) => (actionsOf(v)?.forward(), true) },
]);

/** ⌘-click (or Ctrl-click) goes to the definition of what's under the pointer. */
const clickToDefinition = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    view.dispatch({ selection: { anchor: pos } });
    jumpToDefinition(view);
    event.preventDefault();
    return true;
  },
});

/** The language server's features for a buffer (completion, hover, signatures, diagnostics, format, definition). */
export function lspExtensions(client: LSPClient, uri: string, languageId: string): Extension {
  return [languageServerSupport(client, uri, languageId), clickToDefinition];
}
/** The features the client brings in for every file of a server (its `extensions`), without its own usages and rename. */
export const clientExtensions = () => [serverCompletion(), hoverTooltips({ hoverTime: 450 }), keymap.of([...formatKeymap, ...signatureKeymap]), signatureHelp(), serverDiagnostics()];

/** A diff against `base`: deletions inline, unchanged stretches folded, each change revertible. */
export function diffExtension(base: string): Extension {
  return unifiedMergeView({
    original: base,
    highlightChanges: true,
    gutter: true,
    syntaxHighlightDeletions: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
    mergeControls: (type, action) => {
      const button = document.createElement("button");
      if (type === "accept") {
        // Accepting a change only hides it (the base is the commit's): no button.
        button.hidden = true;
        return button;
      }
      button.textContent = "Revert";
      button.title = "Put this change back as it was in the base";
      button.onmousedown = action;
      return button;
    },
  });
}

/** K: the language server's hover for what's under the cursor, until the cursor or text moves. */
export const setHover = StateEffect.define<Tooltip | null>();
const cursorHover = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHover)) return e.value;
    return tr.docChanged || tr.selection ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

/** A buffer's starting state. */
export function bufferState(text: string, parts: Parts, options: { vim: boolean; readOnly: boolean }): EditorState {
  setUpVim();
  return EditorState.create({
    doc: text,
    extensions: [
      // Vim first: its keys go ahead of every other keymap.
      parts.vim.of(options.vim ? vim({ status: true }) : []),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      lintGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      paneKeys,
      cursorHover,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
      parts.theme.of(themeOf()),
      parts.language.of([]),
      parts.lsp.of([]),
      parts.diff.of([]),
      parts.readOnly.of(options.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(true)] : []),
      EditorView.contentAttributes.of({ "aria-label": "File", spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
    ],
  });
}

/** Loads the file's language (highlighting, indentation, folding) and puts it in. */
export async function loadLanguage(view: EditorView, parts: Parts, path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const desc = LanguageDescription.matchFilename(languages, name) ?? (/\.blade\.php$/.test(name) ? LanguageDescription.matchLanguageName(languages, "PHP") : null);
  if (!desc) return;
  const support = await desc.load().catch(() => null);
  if (support) view.dispatch({ effects: parts.language.reconfigure(support) });
}

/** Every buffer follows the app's light or dark theme, and the vim setting. */
export const reconfigureTheme = (view: EditorView, parts: Parts) => view.dispatch({ effects: parts.theme.reconfigure(themeOf()) });
export const reconfigureVim = (view: EditorView, parts: Parts, on: boolean) => view.dispatch({ effects: parts.vim.reconfigure(on ? vim({ status: true }) : []) });

/** Whether the buffer's vim is in insert or visual mode (Esc is then vim's, never the page's). */
export function vimMode(view: EditorView): "normal" | "insert" | "visual" | null {
  const cm = getCM(view) as unknown as { state?: { vim?: { insertMode?: boolean; visualMode?: boolean } } } | null;
  const state = cm?.state?.vim;
  if (!state) return null;
  return state.insertMode ? "insert" : state.visualMode ? "visual" : "normal";
}
