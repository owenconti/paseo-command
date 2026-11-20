/**
 * A buffer's diff side by side (the Files tab's Split layout): the base, read only, on the left, and the buffer's own
 * editor (vim, its language server, its history) on the right, rather than `@codemirror/merge`'s `MergeView`, which
 * would make editors of its own. Both sides are drawn from the same chunks (`Chunk.build`, again as the buffer changes):
 * changed lines and words marked, spacers keeping each chunk's lines level (the editors share one font and don't wrap,
 * so a chunk's height is its line count), scrolling shared, and each change revertible.
 */
import { Chunk } from "@codemirror/merge";
import { Compartment, EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, WidgetType, drawSelection, gutter, highlightSpecialChars, lineNumbers, type DecorationSet } from "@codemirror/view";

type Side = "a" | "b";
type Shown = { chunks: readonly Chunk[]; lineHeight: number; revert?: (c: Chunk) => void };
type Item = { from: number; to: number; deco: Decoration };
const setShown = StateEffect.define<Shown>();

/** How many lines a chunk covers on one side (0 when it has none there). */
export function linesOf(doc: Text, from: number, to: number): number {
  if (from >= to) return 0;
  return doc.lineAt(Math.min(to - 1, doc.length)).number - doc.lineAt(Math.min(from, doc.length)).number + 1;
}

class Spacer extends WidgetType {
  constructor(readonly height: number) {
    super();
  }
  eq(other: Spacer) {
    return other.height === this.height;
  }
  get estimatedHeight() {
    return this.height;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-splitSpacer";
    el.style.height = `${this.height}px`;
    return el;
  }
}
/** A change's Revert, in the file side's gutter at the change's first line (or the line after what it removed). */
class RevertMarker extends GutterMarker {
  constructor(
    readonly chunk: Chunk,
    readonly run: (c: Chunk) => void,
  ) {
    super();
  }
  eq(other: RevertMarker) {
    return other.chunk.fromA === this.chunk.fromA && other.chunk.toA === this.chunk.toA && other.chunk.fromB === this.chunk.fromB && other.chunk.toB === this.chunk.toB;
  }
  toDOM() {
    const button = document.createElement("button");
    button.className = "cm-splitRevert";
    button.textContent = "↶";
    button.title = "Revert this change: put it back as it was in the base";
    button.setAttribute("aria-label", "Revert this change");
    button.onmousedown = (e) => {
      e.preventDefault();
      this.run(this.chunk);
    };
    return button;
  }
}

/** One side's marks: changed lines and words, spacers keeping it level with the other side, and (the buffer's side)
 *  each change's Revert. Block widgets must come from a field. */
function decorate(side: Side, doc: Text, other: Text, shown: Shown): { decos: DecorationSet; reverts: RangeSet<GutterMarker> } {
  const items: Item[] = [];
  const reverts: { at: number; marker: RevertMarker }[] = [];
  const lineClass = side === "a" ? "cm-splitDeletedLine" : "cm-changedLine";
  const textClass = side === "a" ? "cm-splitDeletedText" : "cm-changedText";
  for (const c of shown.chunks) {
    const from = side === "a" ? c.fromA : c.fromB;
    const to = side === "a" ? c.toA : c.toB;
    const mine = linesOf(doc, from, to);
    const theirs = side === "a" ? linesOf(other, c.fromB, c.toB) : linesOf(other, c.fromA, c.toA);
    if (mine) {
      const first = doc.lineAt(Math.min(from, doc.length)).number;
      for (let n = first; n < first + mine; n++) items.push({ from: doc.line(n).from, to: doc.line(n).from, deco: Decoration.line({ class: lineClass }) });
    }
    for (const ch of c.changes) {
      const f = Math.min(from + (side === "a" ? ch.fromA : ch.fromB), doc.length);
      const t = Math.min(from + (side === "a" ? ch.toA : ch.toB), doc.length);
      if (t > f) items.push({ from: f, to: t, deco: Decoration.mark({ class: textClass }) });
    }
    if (side === "b" && shown.revert) reverts.push({ at: doc.lineAt(Math.min(from, doc.length)).from, marker: new RevertMarker(c, shown.revert) });
    // The shorter side gets a spacer the height of the lines it lacks.
    if (theirs > mine && shown.lineHeight) {
      const widget = new Spacer((theirs - mine) * shown.lineHeight);
      if (mine) {
        const end = doc.lineAt(Math.min(to - 1, doc.length)).to;
        items.push({ from: end, to: end, deco: Decoration.widget({ widget, block: true, side: 1 }) });
      } else if (from >= doc.length) items.push({ from: doc.length, to: doc.length, deco: Decoration.widget({ widget, block: true, side: 1 }) });
      else {
        const at = doc.lineAt(from).from;
        items.push({ from: at, to: at, deco: Decoration.widget({ widget, block: true, side: -1 }) });
      }
    }
  }
  items.sort((x, y) => x.from - y.from || x.deco.startSide - y.deco.startSide);
  const b = new RangeSetBuilder<Decoration>();
  for (const i of items) b.add(i.from, i.to, i.deco);
  const seen = new Set<number>();
  const marks = reverts.filter((r) => !seen.has(r.at) && (seen.add(r.at), true)).map((r) => r.marker.range(r.at));
  return { decos: b.finish(), reverts: RangeSet.of(marks, true) };
}

type SideState = { shown: Shown; decos: DecorationSet; reverts: RangeSet<GutterMarker> };
function sideField(side: Side, other: () => Text) {
  return StateField.define<SideState>({
    create: () => ({ shown: { chunks: [], lineHeight: 0 }, decos: Decoration.none, reverts: RangeSet.empty }),
    update(value, tr) {
      let shown = value.shown;
      for (const e of tr.effects) if (e.is(setShown)) shown = e.value;
      if (shown !== value.shown) return { shown, ...decorate(side, tr.state.doc, other(), shown) };
      // Edits until the next refresh: the marks move with the text.
      return tr.docChanged ? { shown, decos: value.decos.map(tr.changes), reverts: value.reverts.map(tr.changes) } : value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  });
}

const sameChunks = (x: readonly Chunk[], y: readonly Chunk[]) =>
  x.length === y.length && x.every((c, i) => c.fromA === y[i].fromA && c.toA === y[i].toA && c.fromB === y[i].fromB && c.toB === y[i].toB);

/** A buffer's split diff: its base's editor, and the extension the buffer's own editor gets while it shows. */
export class SplitDiff {
  readonly dom: HTMLElement;
  readonly base: EditorView;
  /** The buffer editor's part (its `diff` compartment's content while split). */
  readonly bufferExtension: Extension;
  private readonly bufferField: StateField<SideState>;
  private readonly mine: HTMLElement;
  private buffer: EditorView | null = null;
  private syncing = false;
  private pending = 0;
  private readonly language = new Compartment();
  private readonly theme = new Compartment();

  constructor(
    baseText: string,
    private readonly options: { theme: () => Extension; onRevert: (from: number, to: number, insert: string) => void },
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "files-split";
    const left = this.dom.appendChild(document.createElement("div"));
    left.className = "files-split-side base";
    this.mine = this.dom.appendChild(document.createElement("div"));
    this.mine.className = "files-split-side mine";
    this.base = new EditorView({
      parent: left,
      state: EditorState.create({
        doc: baseText,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          drawSelection(),
          EditorState.readOnly.of(true),
          this.theme.of(options.theme()),
          this.language.of([]),
          sideField("a", () => this.buffer?.state.doc ?? this.base.state.doc),
          EditorView.contentAttributes.of({ "aria-label": "The base, read only" }),
        ],
      }),
    });
    this.base.dom.classList.add("files-split-base");
    this.bufferField = sideField("b", () => this.base.state.doc);
    const field = this.bufferField;
    this.bufferExtension = [
      field,
      gutter({ class: "cm-splitRevertGutter", markers: (v) => v.state.field(field, false)?.reverts ?? RangeSet.empty }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.geometryChanged) this.refreshSoon();
      }),
    ];
    this.base.scrollDOM.addEventListener("scroll", this.onBaseScroll);
  }

  private onBaseScroll = () => this.follow(this.base, this.buffer);
  private onBufferScroll = () => this.follow(this.buffer, this.base);
  private follow(from: EditorView | null, to: EditorView | null) {
    if (!from || !to || this.syncing) return;
    this.syncing = true;
    to.scrollDOM.scrollTop = from.scrollDOM.scrollTop;
    requestAnimationFrame(() => (this.syncing = false));
  }

  /** Puts the buffer's editor on the right; the split is then what the pane shows. */
  mount(buffer: EditorView): HTMLElement {
    if (this.buffer !== buffer) {
      this.buffer?.scrollDOM.removeEventListener("scroll", this.onBufferScroll);
      this.buffer = buffer;
      buffer.scrollDOM.addEventListener("scroll", this.onBufferScroll);
    }
    if (buffer.dom.parentElement !== this.mine) this.mine.replaceChildren(buffer.dom);
    this.refreshSoon();
    return this.dom;
  }
  setBase(text: string) {
    if (this.base.state.doc.toString() !== text) this.base.dispatch({ changes: { from: 0, to: this.base.state.doc.length, insert: text } });
    this.refreshSoon();
  }
  setLanguage(support: Extension) {
    this.base.dispatch({ effects: this.language.reconfigure(support) });
  }
  retheme() {
    this.base.dispatch({ effects: this.theme.reconfigure(this.options.theme()) });
  }

  private refreshSoon() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.refresh();
    });
  }
  /** The chunks again: both sides marked and levelled. */
  refresh() {
    const buffer = this.buffer;
    if (!buffer) return;
    const a = this.base.state.doc;
    const b = buffer.state.doc;
    const chunks = Chunk.build(a, b);
    const lineHeight = buffer.defaultLineHeight || this.base.defaultLineHeight || 20;
    const was = buffer.state.field(this.bufferField, false)?.shown;
    if (was && was.lineHeight === lineHeight && sameChunks(was.chunks, chunks)) return;
    const revert = (c: Chunk) => {
      const now = buffer.state.doc;
      const from = Math.min(c.fromB, now.length);
      const to = Math.min(c.toB, now.length);
      let insert = a.sliceString(Math.min(c.fromA, a.length), Math.min(c.toA, a.length));
      // A chunk reaching past the end has no newline to give back on the side that ends there.
      if (c.toA > a.length && c.toB <= now.length && insert && !insert.endsWith("\n")) insert += "\n";
      this.options.onRevert(from, to, insert);
    };
    buffer.dispatch({ effects: setShown.of({ chunks, lineHeight, revert }) });
    this.base.dispatch({ effects: setShown.of({ chunks, lineHeight }) });
  }

  destroy() {
    if (this.pending) cancelAnimationFrame(this.pending);
    this.base.scrollDOM.removeEventListener("scroll", this.onBaseScroll);
    this.buffer?.scrollDOM.removeEventListener("scroll", this.onBufferScroll);
    if (this.buffer && this.buffer.dom.parentElement === this.mine) this.buffer.dom.remove();
    this.buffer = null;
    this.base.destroy();
    this.dom.remove();
  }
}
