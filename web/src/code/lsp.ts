/**
 * The Files tab's language servers: one connection per workspace and server group (`/api/lsp`, `server/lsp.ts`,
 * which relays to the `language-servers` plugin on the workspace's host), each an `LSPClient` of
 * `@codemirror/lsp-client` whose workspace is the Files tab's: a definition in another file opens it there
 * (`displayFile`), and every open buffer of the group is one of its documents.
 */
import { LSPClient, LSPPlugin, Workspace, type LSPClientExtension, type Transport, type WorkspaceFile } from "@codemirror/lsp-client";
import type { Extension, Text, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { fileUri, placeOf, uriPath, type ServerGroup } from "./paths";

export type LspWorkspace = { id: string; host?: string };
export type LspState =
  | { phase: "connecting" }
  | { phase: "ready"; server: string; busy?: string }
  | { phase: "ended"; reason: string };

/** What the Files tab does for a language server: open a file it names (in the workspace, or outside it read only). */
export type LspHooks = {
  display: (place: { path: string } | { outside: string; uri: string }) => Promise<EditorView | null>;
  changed: () => void;
  /** What every file of the server gets (completion, hover, diagnostics…). */
  extensions: () => readonly (Extension | LSPClientExtension)[];
};

/** Server requests the client doesn't answer, answered here as an editor without settings would. */
function answerLocally(msg: { id?: unknown; method?: unknown; params?: any }, root: string): unknown | undefined {
  switch (msg.method) {
    case "workspace/configuration":
      return Array.isArray(msg.params?.items) ? msg.params.items.map(() => null) : [];
    case "client/registerCapability":
    case "client/unregisterCapability":
    case "window/workDoneProgress/create":
      return null;
    case "workspace/workspaceFolders":
      return [{ uri: fileUri(root), name: root.slice(root.lastIndexOf("/") + 1) }];
    default:
      return undefined;
  }
}

class PaneFile implements WorkspaceFile {
  constructor(
    public uri: string,
    public languageId: string,
    public version: number,
    public doc: Text,
    public view: EditorView,
  ) {}
  getView() {
    return this.view;
  }
}

/** The Files tab as the client's workspace: one view per file, files looked up by path (servers encode URIs their own way). */
class PaneWorkspace extends Workspace {
  files: PaneFile[] = [];
  private versions: Record<string, number> = Object.create(null);
  constructor(
    client: LSPClient,
    private hooks: LspHooks,
    private root: string,
  ) {
    super(client);
  }
  private next(uri: string) {
    return (this.versions[uri] = (this.versions[uri] ?? -1) + 1);
  }
  getFile(uri: string): PaneFile | null {
    const path = uriPath(uri);
    return this.files.find((f) => f.uri === uri || (path !== null && uriPath(f.uri) === path)) ?? null;
  }
  syncFiles() {
    const out = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        out.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view.state.doc;
        file.version = this.next(file.uri);
        plugin.clear();
      }
    }
    return out;
  }
  openFile(uri: string, languageId: string, view: EditorView) {
    const had = this.getFile(uri);
    if (had) {
      // The same file in a new view (its buffer reopened): the server keeps its document, the view is the new one.
      had.view = view;
      return;
    }
    const file = new PaneFile(uri, languageId, this.next(uri), view.state.doc, view);
    this.files.push(file);
    this.client.didOpen(file);
  }
  closeFile(uri: string, view: EditorView) {
    const file = this.getFile(uri);
    if (!file || file.view !== view) return;
    this.files = this.files.filter((f) => f !== file);
    this.client.didClose(file.uri);
  }
  updateFile(uri: string, update: TransactionSpec) {
    this.getFile(uri)?.view.dispatch(update);
  }
  async displayFile(uri: string): Promise<EditorView | null> {
    const place = placeOf(this.root, uri);
    if (!place) return null;
    return this.hooks.display("path" in place ? place : { outside: place.outside, uri });
  }
}

class SocketTransport implements Transport {
  private handlers = new Set<(value: string) => void>();
  constructor(
    private socket: WebSocket,
    private root: string,
  ) {}
  send(message: string) {
    // Closed: dropped (a closing editor's didClose; its requests time out, and the tab says the server ended).
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "send", data: message }));
  }
  subscribe(handler: (value: string) => void) {
    this.handlers.add(handler);
  }
  unsubscribe(handler: (value: string) => void) {
    this.handlers.delete(handler);
  }
  /** A message from the server: a request answered here, or passed to the client. */
  receive(text: string) {
    let msg: { id?: unknown; method?: unknown; params?: unknown };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id !== undefined && typeof msg.method === "string") {
      const result = answerLocally(msg, this.root);
      if (result !== undefined) {
        this.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        return;
      }
    }
    this.handlers.forEach((h) => h(text));
  }
}

/** One language server for one workspace's files of one group. */
export class LspConnection {
  state: LspState = { phase: "connecting" };
  client: LSPClient | null = null;
  /** The workspace's folder on its host, once the server is up. */
  root: string | null = null;
  private socket: WebSocket;
  private transport: SocketTransport | null = null;
  private reads = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
  private nextRead = 1;
  private progress = new Map<string, string>();
  private onReady: (() => void)[] = [];

  constructor(
    ws: LspWorkspace,
    readonly group: ServerGroup,
    private hooks: LspHooks,
  ) {
    const query = new URLSearchParams({ workspace: ws.id, ...(ws.host ? { host: ws.host } : {}), group });
    this.socket = new WebSocket(new URL(`/api/lsp?${query}`, location.href).href.replace(/^http/, "ws"));
    this.socket.onmessage = (event) => this.take(String(event.data));
    this.socket.onclose = () => this.end("The language server's connection closed.");
    this.socket.onerror = () => this.end("The language server's connection failed.");
  }

  private set(state: LspState) {
    this.state = state;
    this.hooks.changed();
  }
  private end(reason: string) {
    if (this.state.phase === "ended") return;
    for (const r of this.reads.values()) r.reject(new Error(reason));
    this.reads.clear();
    this.client?.disconnect();
    this.set({ phase: "ended", reason });
  }

  private take(raw: string) {
    let frame: { type?: string; data?: string; root?: string; server?: string; reason?: string; id?: number; text?: string; error?: string };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.type === "ready" && typeof frame.root === "string") {
      const root = frame.root;
      this.root = root;
      this.transport = new SocketTransport(this.socket, root);
      this.client = new LSPClient({
        rootUri: fileUri(root),
        workspace: (client) => new PaneWorkspace(client, this.hooks, root),
        timeout: 15_000,
        sanitizeHTML: sanitize,
        extensions: this.hooks.extensions(),
        notificationHandlers: {
          "$/progress": (_client, params) => this.onProgress(params),
          // Shown as the tab's status, not as a dialog.
          "window/showMessage": () => true,
          "window/logMessage": () => true,
        },
      }).connect(this.transport);
      this.set({ phase: "ready", server: frame.server ?? this.group });
      this.client.initializing.then(
        () => this.onReady.splice(0).forEach((f) => f()),
        () => {},
      );
    } else if (frame.type === "recv" && typeof frame.data === "string") this.transport?.receive(frame.data);
    else if (frame.type === "read" && typeof frame.id === "number") {
      const waiting = this.reads.get(frame.id);
      this.reads.delete(frame.id);
      if (frame.error !== undefined) waiting?.reject(new Error(frame.error));
      else waiting?.resolve(frame.text ?? "");
    } else if (frame.type === "ended") this.end(frame.reason || "The language server stopped.");
  }

  /** Work the server reports (indexing), as the tab's status. */
  private onProgress(params: { token?: string | number; value?: { kind?: string; title?: string; message?: string } }) {
    const token = String(params?.token ?? "");
    const v = params?.value;
    if (v?.kind === "begin") this.progress.set(token, v.title || v.message || "Working");
    else if (v?.kind === "end") this.progress.delete(token);
    if (this.state.phase === "ready") {
      const busy = [...this.progress.values()][0];
      this.set({ phase: "ready", server: this.state.server, ...(busy ? { busy } : {}) });
    }
    return true;
  }

  /** Runs once the server has answered `initialize`. */
  whenReady(f: () => void) {
    if (this.client?.serverCapabilities) f();
    else this.onReady.push(f);
  }

  /** A file outside the workspace that the server named, read through its host's plugin. */
  read(uri: string): Promise<string> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("The language server's connection is closed."));
    const id = this.nextRead++;
    return new Promise((resolve, reject) => {
      this.reads.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ type: "read", id, uri }));
    });
  }

  close() {
    this.state = { phase: "ended", reason: "Closed." };
    this.client?.disconnect();
    if (this.socket.readyState <= WebSocket.OPEN) this.socket.close();
  }
}

/** A language server's Markdown, made HTML by the client: kept to text, code and links (no scripts, styles, frames or handlers). */
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const allowed = new Set(["P", "PRE", "CODE", "SPAN", "DIV", "EM", "STRONG", "B", "I", "UL", "OL", "LI", "A", "BR", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "DEL", "S", "SUB", "SUP", "KBD"]);
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!allowed.has(child.tagName)) {
        child.replaceWith(...(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE"].includes(child.tagName) ? [] : [doc.createTextNode(child.textContent ?? "")]));
        continue;
      }
      for (const attr of [...child.attributes]) {
        const keep = attr.name === "class" || (attr.name === "href" && /^https?:/i.test(attr.value));
        if (!keep) child.removeAttribute(attr.name);
      }
      walk(child);
    }
  };
  const root = doc.body.firstElementChild!;
  walk(root);
  return root.innerHTML;
}
