/** Mermaid is loaded only for diagrams near the viewport. All initialize/render pairs are serialized:
 * the session panel and the Dungeon conversation can render the same reply with different palettes. */
export type DiagramPalette = {
  background: string;
  fill: string;
  text: string;
  line: string;
  accent: string;
  note: string;
  noteText: string;
  font: string;
};
export type RenderedDiagram = {
  svg: string;
  width: number;
  height: number;
  label: string;
  description?: string;
};
let library: Promise<typeof import("mermaid")> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let serial = 0;
const cache = new Map<string, RenderedDiagram>();
export const MERMAID_LIMIT = 50_000;

export function renderDiagram(
  source: string,
  palette: DiagramPalette,
  signal: AbortSignal,
): Promise<RenderedDiagram> {
  if (source.length > MERMAID_LIMIT)
    return Promise.reject(
      new Error(
        "This diagram is too large to preview. Its source is still available below.",
      ),
    );
  const key = JSON.stringify([source, palette]);
  const task = queue.then(async () => {
    signal.throwIfAborted();
    const kept = cache.get(key);
    if (kept) return kept;
    library ??= import("mermaid");
    const { default: mermaid } = await library;
    signal.throwIfAborted();
    await document.fonts.ready;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: MERMAID_LIMIT,
      maxEdges: 500,
      htmlLabels: false,
      // Diagram directives may not weaken security or replace the app's palette/CSS.
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
        "htmlLabels",
        "theme",
        "themeVariables",
        "themeCSS",
        "fontFamily",
        "dompurifyConfig",
      ],
      theme: "base",
      themeCSS: "",
      fontFamily: palette.font,
      themeVariables: {
        fontFamily: palette.font,
        fontSize: "14px",
        background: palette.background,
        primaryColor: palette.fill,
        primaryTextColor: palette.text,
        primaryBorderColor: palette.line,
        secondaryColor: palette.background,
        secondaryTextColor: palette.text,
        secondaryBorderColor: palette.line,
        tertiaryColor: palette.fill,
        tertiaryTextColor: palette.text,
        tertiaryBorderColor: palette.line,
        lineColor: palette.line,
        textColor: palette.text,
        mainBkg: palette.fill,
        nodeTextColor: palette.text,
        edgeLabelBackground: palette.background,
        clusterBkg: palette.background,
        clusterBorder: palette.line,
        actorBkg: palette.fill,
        actorTextColor: palette.text,
        actorBorder: palette.line,
        actorLineColor: palette.line,
        signalColor: palette.line,
        signalTextColor: palette.text,
        labelBoxBkgColor: palette.fill,
        labelBoxBorderColor: palette.line,
        labelTextColor: palette.text,
        loopTextColor: palette.text,
        noteBkgColor: palette.note,
        noteTextColor: palette.noteText,
        noteBorderColor: palette.line,
        activationBkgColor: palette.fill,
        activationBorderColor: palette.line,
      },
      flowchart: { htmlLabels: false, useMaxWidth: false },
      sequence: { useMaxWidth: false },
    });
    // Measuring needs a laid-out DOM, not display:none. Strict mode sanitizes the generated SVG;
    // the final chart is displayed as an image document, never injected into the chat's DOM.
    const scratch = document.createElement("div");
    scratch.style.cssText =
      "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
    document.body.append(scratch);
    try {
      signal.throwIfAborted();
      const { svg } = await mermaid.render(
        `paseo-mermaid-${++serial}`,
        source,
        scratch,
      );
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const viewBox = parsed.documentElement
        .getAttribute("viewBox")
        ?.split(/[\s,]+/)
        .map(Number);
      if (
        !viewBox ||
        viewBox.length !== 4 ||
        !viewBox.every(Number.isFinite) ||
        viewBox[2]! <= 0 ||
        viewBox[3]! <= 0
      )
        throw new Error("This diagram has no visible content.");
      const result = {
        svg,
        width: viewBox[2]!,
        height: viewBox[3]!,
        label:
          parsed.querySelector("title")?.textContent?.trim() ||
          "Mermaid diagram",
        description: parsed.querySelector("desc")?.textContent?.trim(),
      };
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
      return result;
    } finally {
      scratch.remove();
    }
  });
  queue = task.catch(() => {});
  return task;
}
