import Foundation

/// What an agent's browser tools ask of the board's browser (`BoardBrowser.swift`), as Paseo's daemon sends
/// them (`browser_new_tab`, `browser_snapshot`, `browser_click`…; `web/server/browserHost.ts` relays them):
/// the request and its answers, which addresses a tab may open, and the script that reads and drives a page.
/// Nothing here needs a web view, so the native checks run it.
struct BrowserRequest {
    /// Every command the app runs; the daemon refuses the others itself.
    static let commands = ["list_tabs", "new_tab", "snapshot", "click", "fill", "wait", "type", "keypress", "navigate", "back",
                           "forward", "reload", "screenshot", "upload", "select", "hover", "drag", "logs", "evaluate", "scroll",
                           "resize", "close_tab"]

    let id: String
    /// The daemon it came from: "local", or a remote host's server id.
    let host: String
    let agent: String?
    let cwd: String?
    let workspace: String?
    let command: String
    let args: [String: Any]

    /// From the relay's `{type: "request", host, request}`.
    init?(_ message: [String: Any]) {
        guard let host = message["host"] as? String, !host.isEmpty, host.count <= 200,
              let request = message["request"] as? [String: Any],
              let id = request["requestId"] as? String, !id.isEmpty,
              let command = request["command"] as? [String: Any],
              let name = command["command"] as? String, Self.commands.contains(name) else { return nil }
        let text = { (key: String) in (request[key] as? String).flatMap { $0.isEmpty || $0.count > 4096 ? nil : $0 } }
        self.id = id
        self.host = host
        agent = text("agentId")
        cwd = text("cwd")
        workspace = text("workspaceId")
        self.command = name
        args = command["args"] as? [String: Any] ?? [:]
    }

    var tab: String? { args["browserId"] as? String }
    func string(_ key: String) -> String? { args[key] as? String }
    func number(_ key: String) -> Double? { (args[key] as? NSNumber)?.doubleValue }
    func flag(_ key: String) -> Bool { args[key] as? Bool ?? false }

    /// The relay's `{type: "response", payload}` for a result (the command's name is added).
    func done(_ result: [String: Any], dialogs: [[String: Any]] = []) -> [String: Any] {
        var payload: [String: Any] = ["requestId": id, "ok": true, "result": result.merging(["command": command]) { a, _ in a }]
        if !dialogs.isEmpty { payload["dialogs"] = dialogs }
        return ["type": "response", "payload": payload]
    }

    func failed(_ failure: BrowserFailure, dialogs: [[String: Any]] = []) -> [String: Any] {
        var payload: [String: Any] = ["requestId": id, "ok": false,
                                      "error": ["code": failure.code, "message": failure.message, "retryable": failure.retryable]]
        if !dialogs.isEmpty { payload["dialogs"] = dialogs }
        return ["type": "response", "payload": payload]
    }
}

/// Why a command couldn't run, in the protocol's codes.
struct BrowserFailure: Error, Equatable {
    static let codes: Set<String> = ["browser_disabled", "browser_no_host", "browser_tab_not_found", "browser_tab_closed", "browser_timeout",
                                     "screenshot_no_frame", "browser_denied", "browser_unsupported", "browser_stale_ref", "browser_unknown_error"]
    let code: String
    let message: String
    var retryable = false

    init(_ code: String, _ message: String, retryable: Bool = false) {
        self.code = Self.codes.contains(code) ? code : "browser_unknown_error"
        self.message = message.isEmpty ? "The browser couldn't do that." : String(message.prefix(2000))
        self.retryable = retryable
    }

    static func noTab(_ id: String?) -> BrowserFailure {
        BrowserFailure("browser_tab_not_found", "No open browser tab \(id ?? "") in this workspace. Call browser_list_tabs, or open one with browser_new_tab.")
    }
    static func unknown(_ message: String) -> BrowserFailure { BrowserFailure("browser_unknown_error", message) }
    static func denied(_ message: String) -> BrowserFailure { BrowserFailure("browser_denied", message) }
}

/// Which addresses a tab opens. Only web pages; and a tab of an agent on another host never opens this
/// Mac's own addresses: to that agent "localhost" is its own machine, and this Mac's local services
/// (this app's among them) aren't its to read.
enum BrowserPolicy {
    /// This machine by name or loopback address (`localhost`, `*.localhost`, 127.0.0.0/8, ::1, 0.0.0.0, and
    /// 127.0.0.1 written as one number, in hex or octal).
    static func isLoopback(_ url: URL) -> Bool {
        guard var host = url.host?.lowercased(), !host.isEmpty else { return false }
        if host.hasSuffix(".") { host.removeLast() }
        if host == "localhost" || host.hasSuffix(".localhost") { return true }
        if host.hasPrefix("[") && host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if host.contains(":") {
            let compact = host.split(separator: "%").first.map(String.init) ?? host
            if ["::1", "::", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0"].contains(compact) { return true }
            // An IPv4 address mapped into IPv6.
            if let v4 = compact.components(separatedBy: "::ffff:").last, v4 != compact { return loopback(v4: v4) }
            return false
        }
        return loopback(v4: host)
    }

    /// An IPv4 address as browsers read it: one to four parts, each decimal, hex (0x) or octal (leading 0).
    private static func loopback(v4 text: String) -> Bool {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard (1...4).contains(parts.count) else { return false }
        var values: [UInt64] = []
        for part in parts {
            let value: UInt64?
            if part.hasPrefix("0x") { value = UInt64(part.dropFirst(2), radix: 16) }
            else if part.count > 1, part.hasPrefix("0") { value = UInt64(part.dropFirst(), radix: 8) }
            else { value = UInt64(part, radix: 10) }
            guard let value else { return false }
            values.append(value)
        }
        // The last part fills whatever bytes the others leave.
        var address: UInt64 = 0
        for (i, value) in values.enumerated() {
            if i == values.count - 1 {
                guard value < (1 << UInt64(8 * (5 - values.count))) else { return false }
                address |= value
            } else {
                guard value <= 255 else { return false }
                address |= value << UInt64(8 * (3 - i))
            }
        }
        let first = (address >> 24) & 0xff
        return first == 127 || address == 0
    }

    /// Why `url` may not open in a tab of an agent on `host` (nil: it may).
    static func refusal(_ url: URL, host: String) -> String? {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return "Only http and https addresses open in the browser." }
        if host != "local", isLoopback(url) {
            return "\(url.host ?? "That address") is the user's Mac, not the machine this agent runs on, and a browser tab of an agent on another host doesn't open the Mac's own addresses. Use an address of this machine that the user's Mac can reach."
        }
        return nil
    }

    /// Content rules that keep a remote agent's tab from loading anything from this Mac's own addresses
    /// (pages, frames, images, scripts, requests), as a `WKContentRuleList` source.
    static let loopbackRules: String = {
        let hosts = ["localhost", "[^/:]*\\\\.localhost", "127\\\\.[0-9]+\\\\.[0-9]+\\\\.[0-9]+", "\\\\[::1\\\\]", "0\\\\.0\\\\.0\\\\.0", "\\\\[::\\\\]"]
        let rules = hosts.map { "{\"trigger\":{\"url-filter\":\"^https?://\($0)[:/]\"},\"action\":{\"type\":\"block\"}}" }
        return "[\(rules.joined(separator: ","))]"
    }()

    /// What the address field's text opens: an address as typed, one without its scheme (a local one over http),
    /// else nothing (the page shows no search).
    static func destination(_ typed: String) -> URL? {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 4096, !text.contains(" ") else { return nil }
        if let url = URL(string: text), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.host != nil { return url }
        guard !text.contains("://"), let bare = URL(string: "http://\(text)"), let host = bare.host, !host.isEmpty else { return nil }
        // A machine's own name or address is a development server: plain http.
        let local = isLoopback(bare) || !host.contains(".") || host.range(of: "^[0-9.]+$", options: .regularExpression) != nil
        return local ? bare : URL(string: "https://\(text)")
    }
}

/// A key as `browser_keypress` names it: "Enter", "a", "Control+Shift+K", "Meta+A", "Shift+Tab".
struct BrowserKey: Equatable {
    var key: String
    var modifiers: [String] = []

    private static let names: [String: String] = [
        "esc": "Escape", "escape": "Escape", "return": "Enter", "enter": "Enter", "space": " ", "spacebar": " ", "tab": "Tab",
        "backspace": "Backspace", "delete": "Delete", "del": "Delete", "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft",
        "right": "ArrowRight", "arrowup": "ArrowUp", "arrowdown": "ArrowDown", "arrowleft": "ArrowLeft", "arrowright": "ArrowRight",
        "home": "Home", "end": "End", "pageup": "PageUp", "pagedown": "PageDown", "insert": "Insert",
    ]
    private static let modifierNames: [String: String] = [
        "control": "Control", "ctrl": "Control", "meta": "Meta", "cmd": "Meta", "command": "Meta", "super": "Meta",
        "alt": "Alt", "option": "Alt", "shift": "Shift",
    ]

    init?(_ spec: String) {
        guard !spec.isEmpty, spec.count <= 64 else { return nil }
        // "+" itself is a key: "+", "Shift++".
        var parts = spec == "+" ? ["+"] : spec.components(separatedBy: "+")
        if spec.count > 1, spec.hasSuffix("++") { parts = Array(parts.dropLast(2)) + ["+"] }
        guard let last = parts.popLast(), !last.isEmpty else { return nil }
        var mods: [String] = []
        for part in parts {
            guard let mod = Self.modifierNames[part.lowercased()] else { return nil }
            if !mods.contains(mod) { mods.append(mod) }
        }
        if let named = Self.names[last.lowercased()] { key = named }
        else if last.count == 1 { key = mods.contains("Shift") ? last.uppercased() : last }
        else if last.range(of: "^F([1-9]|1[0-2])$", options: .regularExpression) != nil { key = last }
        else { return nil }
        modifiers = mods
    }
}

/// The script that reads and drives a page for the tools: installed in the page on first use (its element
/// refs live there, so they end with the page, as the tools say they do), and called as
/// `__paseoBrowser.run(name, args)`, which answers `{ok, value}` or `{ok: false, code, message}`.
/// A page's snapshot is its accessibility outline, one line a node, as Paseo's own browser writes it:
/// `- role "name" [attributes ref=@e12]`, text as `- text: "…"`.
enum BrowserScript {
    static func call(_ name: String) -> String {
        "\(source)\nreturn await globalThis.__paseoBrowser.run(\(literal(name)), args);"
    }

    static func literal(_ text: String) -> String {
        (try? JSONSerialization.data(withJSONObject: [text])).flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }

    /// Runs the tool's function in the page, with the ref's element if one is named; its result as JSON.
    static let evaluate = """
    \(source)
    const el = ref ? globalThis.__paseoBrowser.element(ref) : undefined;
    let made;
    try { made = (0, eval)('(' + fn + '\\n)'); } catch (error) { made = (0, eval)(fn); }
    const value = typeof made === 'function' ? await made(el) : await made;
    let json;
    try { json = JSON.stringify(value === undefined ? null : value); } catch (error) { json = JSON.stringify(String(value)); }
    return json === undefined ? 'null' : json;
    """

    /// Console messages and uncaught errors, kept for `browser_logs` (a user script at document start).
    static let console = #"""
    (() => {
      if (window.__paseoConsole) return;
      window.__paseoConsole = true;
      const post = (level, parts, source, line) => {
        try {
          const message = parts.map((p) => {
            if (typeof p === 'string') return p;
            if (p instanceof Error) return p.stack || String(p);
            try { return JSON.stringify(p); } catch (e) { return String(p); }
          }).join(' ').slice(0, 4000);
          window.webkit.messageHandlers.paseoBrowserLog.postMessage({ level, message, source: source || '', line: line || 0, at: Date.now() });
        } catch (e) {}
      };
      for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const original = console[level];
        console[level] = function (...args) { post(level, args); return original.apply(this, args); };
      }
      window.addEventListener('error', (e) => post('error', [e.message || 'Uncaught error'], e.filename, e.lineno));
      window.addEventListener('unhandledrejection', (e) => post('error', ['Unhandled rejection:', e.reason]));
    })();
    """#

    static let source = #"""
    if (!globalThis.__paseoBrowser) {
      const LIMIT = { nodes: 1500, refs: 500, text: 80000, name: 200, options: 60 };
      let refs = new Map();
      const fail = (code, message) => Object.assign(new Error(message), { code });
      const clean = (text) => text.replace(/\s+/g, ' ').trim();
      const cut = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE', 'WBR', 'SOURCE', 'TRACK', 'PARAM', 'COL', 'COLGROUP', 'DATALIST']);
      const TAG_ROLE = {
        BUTTON: 'button', SUMMARY: 'button', TEXTAREA: 'textbox', NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', FORM: 'form',
        HEADER: 'banner', FOOTER: 'contentinfo', UL: 'list', OL: 'list', MENU: 'list', LI: 'listitem', TABLE: 'table', THEAD: 'rowgroup',
        TBODY: 'rowgroup', TFOOT: 'rowgroup', TR: 'row', TD: 'cell', TH: 'columnheader', DIALOG: 'dialog', ARTICLE: 'article', P: 'paragraph',
        OPTION: 'option', OPTGROUP: 'group', FIELDSET: 'group', DETAILS: 'group', HR: 'separator', BLOCKQUOTE: 'blockquote',
        PROGRESS: 'progressbar', METER: 'meter', IFRAME: 'iframe', FIGURE: 'figure', DL: 'list', DT: 'term', DD: 'definition',
        H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', VIDEO: 'video', AUDIO: 'audio', CANVAS: 'canvas',
      };
      const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'slider', 'spinbutton',
        'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'option']);
      const NAMED_BY_CONTENT = new Set(['link', 'button', 'heading', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'switch']);
      const EMPTY = new Set(['paragraph', 'generic', 'group', 'list', 'listitem', 'region', 'article', 'form', 'banner', 'contentinfo', 'navigation', 'main',
        'complementary', 'figure', 'blockquote', 'rowgroup', 'row', 'cell', 'term', 'definition', 'table', 'heading']);
      const BLOCK = /^(block|flex|grid|list-item|table|flow-root|table-row|table-cell|table-caption)/;
      const TEXT_INPUT = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time', '']);
      const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]';

      const inputRole = (el) => {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'hidden') return null;
        if (type === 'checkbox' || type === 'radio') return type;
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (type === 'search') return 'searchbox';
        if (['button', 'submit', 'reset', 'image', 'file'].includes(type)) return 'button';
        return el.hasAttribute('list') ? 'combobox' : 'textbox';
      };
      const roleOf = (el) => {
        const given = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
        if (given) return given === 'presentation' || given === 'none' ? null : given;
        const tag = el.tagName;
        if (tag === 'A' || tag === 'AREA') return el.hasAttribute('href') ? 'link' : null;
        if (tag === 'INPUT') return inputRole(el);
        if (tag === 'SELECT') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
        if (tag === 'IMG') return el.getAttribute('alt') === '' ? null : 'img';
        if (tag === 'svg' || tag === 'SVG') return 'img';
        if (tag === 'SECTION') return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null;
        return TAG_ROLE[tag] || null;
      };
      const hidden = (el, style) => {
        if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert') || el.hidden) return true;
        if (typeof el.checkVisibility === 'function') return !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
        return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
      };
      const childrenOf = (el) => {
        if (el.shadowRoot) return el.shadowRoot.childNodes;
        if (el.tagName === 'SLOT') { const assigned = el.assignedNodes({ flatten: true }); if (assigned.length) return assigned; }
        return el.childNodes;
      };
      // An element's text as read out: its own labels first, then its content, images by their alt.
      const textOf = (node, depth = 0) => {
        if (node.nodeType === 3) return node.data;
        if (node.nodeType !== 1 || depth > 40) return '';
        const el = node, tag = el.tagName;
        if (SKIP.has(tag)) return '';
        const label = el.getAttribute('aria-label');
        if (label && depth) return ' ' + label + ' ';
        if (tag === 'IMG') return ' ' + (el.getAttribute('alt') || '') + ' ';
        if (tag === 'svg' || tag === 'SVG') return ' ' + (el.querySelector('title')?.textContent || '') + ' ';
        if (tag === 'BR') return ' ';
        if (depth) { const style = getComputedStyle(el); if (hidden(el, style)) return ''; }
        let out = '';
        for (const child of childrenOf(el)) out += textOf(child, depth + 1);
        return BLOCK.test(depth ? getComputedStyle(el).display : '') ? ' ' + out + ' ' : out;
      };
      const labelled = (el) => {
        const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const root = el.getRootNode();
        const text = ids.map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id))).filter(Boolean).map((n) => textOf(n)).join(' ');
        return clean(text);
      };
      const nameOf = (el, role) => {
        const tag = el.tagName;
        let name = labelled(el) || clean(el.getAttribute('aria-label') || '');
        if (!name && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'METER' || tag === 'PROGRESS')) {
          name = clean([...(el.labels || [])].map((l) => textOf(l)).join(' '));
          if (!name && tag === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) name = el.value || (el.type === 'submit' ? 'Submit' : el.type === 'reset' ? 'Reset' : '');
          if (!name && tag === 'INPUT' && el.type === 'image') name = el.alt || 'Submit';
          if (!name && tag === 'INPUT' && el.type === 'file') name = 'Choose file';
          if (!name) name = clean(el.getAttribute('placeholder') || '');
        }
        if (!name && tag === 'IMG') name = clean(el.getAttribute('alt') || '');
        if (!name && (tag === 'svg' || tag === 'SVG')) name = clean(el.querySelector('title')?.textContent || '');
        if (!name && tag === 'FIELDSET') name = clean(textOf(el.querySelector('legend') || document.createTextNode('')));
        if (!name && tag === 'TABLE') name = clean(textOf(el.querySelector('caption') || document.createTextNode('')));
        if (!name && tag === 'IFRAME') name = clean(el.getAttribute('title') || '');
        if (!name && NAMED_BY_CONTENT.has(role)) name = clean(textOf(el));
        if (!name) name = clean(el.getAttribute('title') || '');
        return cut(name, LIMIT.name);
      };
      const attributesOf = (el, role) => {
        const out = [];
        const tag = el.tagName;
        if (role === 'heading') out.push('level=' + (/^H[1-6]$/.test(tag) ? tag[1] : el.getAttribute('aria-level') || '2'));
        const aria = (name) => el.getAttribute('aria-' + name);
        if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) { if (el.indeterminate) out.push('checked=mixed'); else if (el.checked) out.push('checked'); }
        else if (aria('checked') === 'true') out.push('checked');
        else if (aria('checked') === 'mixed') out.push('checked=mixed');
        if (el.disabled || aria('disabled') === 'true') out.push('disabled');
        if (aria('expanded')) out.push('expanded=' + aria('expanded'));
        else if (tag === 'DETAILS') out.push('expanded=' + el.open);
        if (aria('selected') === 'true' || (tag === 'OPTION' && el.selected)) out.push('selected');
        if (aria('pressed')) out.push('pressed=' + aria('pressed'));
        if (aria('current') && aria('current') !== 'false') out.push('current=' + aria('current'));
        if (el.readOnly && (tag === 'INPUT' || tag === 'TEXTAREA')) out.push('readonly');
        if (el.required) out.push('required');
        if (tag === 'INPUT' && el.type === 'file') out.push('type=file');
        if (tag === 'INPUT' && el.type === 'password') { if (el.value) out.push('value="••••"'); }
        else if ((tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(el.type)) || tag === 'TEXTAREA') {
          if (el.value) out.push('value=' + JSON.stringify(cut(el.value, LIMIT.name)));
        } else if (tag === 'SELECT' && !el.multiple) {
          const chosen = el.selectedOptions[0];
          if (chosen) out.push('value=' + JSON.stringify(cut(clean(chosen.text), LIMIT.name)));
        } else if (tag === 'PROGRESS' || tag === 'METER') out.push('value=' + el.value);
        if (document.activeElement === el && el !== document.body) out.push('active');
        return out;
      };

      const snapshot = () => {
        refs = new Map();
        const state = { nodes: 0, refs: 0, frames: 0, depth: 0, stop: false };
        const root = { kind: 'node', role: 'document', name: '', attrs: [], children: [], pending: '' };
        const flush = (parent) => {
          const text = clean(parent.pending);
          parent.pending = '';
          if (!text) return;
          const last = parent.children[parent.children.length - 1];
          if (last && last.kind === 'text') last.text += ' ' + text;
          else { parent.children.push({ kind: 'text', text }); state.nodes += 1; }
        };
        const give = (el) => {
          if (state.refs >= LIMIT.refs) { state.stop = true; return undefined; }
          const ref = '@e' + (state.refs += 1);
          refs.set(ref, new WeakRef(el));
          return ref;
        };
        const walk = (node, parent, depth, inside, cursor) => {
          if (state.stop) return;
          if (node.nodeType === 3) { parent.pending += node.data; return; }
          if (node.nodeType !== 1) return;
          const el = node, tag = el.tagName;
          if (SKIP.has(tag)) return;
          if (tag === 'BR') { parent.pending += ' '; return; }
          const style = getComputedStyle(el);
          if (hidden(el, style)) return;
          if (state.nodes >= LIMIT.nodes) { state.stop = true; return; }
          let role = roleOf(el);
          const editable = el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable);
          if (editable && !role) role = 'textbox';
          const pointer = style.cursor === 'pointer';
          const clickable = !inside && !INTERACTIVE.has(role) && (el.hasAttribute('onclick') || (el.hasAttribute('tabindex') && el.tabIndex >= 0) || (pointer && cursor !== 'pointer'));
          const block = BLOCK.test(style.display);
          if (tag === 'LABEL' && el.control && !clickable) {
            // Its text is its field's name: only what stands inside it is listed.
            flush(parent);
            const inner = { kind: 'node', role: '', name: '', attrs: [], children: [], pending: '' };
            for (const child of childrenOf(el)) walk(child, inner, depth, inside, cursor);
            for (const child of inner.children) if (child.kind === 'node') parent.children.push(child);
            return;
          }
          if (!role && !clickable) {
            // A plain container: its children are its parent's, its text in a line of its own when it is a block.
            if (block) flush(parent);
            for (const child of childrenOf(el)) walk(child, parent, depth, inside, pointer ? 'pointer' : cursor);
            if (block) flush(parent);
            return;
          }
          flush(parent);
          role = role || 'generic';
          const item = { kind: 'node', role, name: nameOf(el, role), attrs: attributesOf(el, role), children: [], pending: '' };
          state.nodes += 1;
          state.depth = Math.max(state.depth, depth + 1);
          const interactive = INTERACTIVE.has(role) || clickable || editable;
          if (interactive) item.ref = give(el);
          if (role === 'link') { const href = el.getAttribute('href'); if (href) item.url = cut(el.href || href, 500); }
          if (role === 'iframe') { state.frames += 1; const src = el.getAttribute('src'); if (src) item.url = cut(el.src || src, 500); }
          parent.children.push(item);
          if (role === 'img' || role === 'iframe' || role === 'canvas') return;
          if (editable) { const text = clean(textOf(el)); if (text) item.attrs.unshift('value=' + JSON.stringify(cut(text, LIMIT.name))); return; }
          if (tag === 'SELECT') {
            for (const option of [...el.options].slice(0, LIMIT.options)) {
              item.children.push({ kind: 'node', role: 'option', name: cut(clean(option.text), LIMIT.name), attrs: attributesOf(option, 'option'), children: [], pending: '' });
              state.nodes += 1;
            }
            return;
          }
          if (NAMED_BY_CONTENT.has(role) && role !== 'heading' && tag !== 'SUMMARY' && item.name) {
            // Its content is its name; what can be used inside it (a button in a link) is still listed.
            const inner = { kind: 'node', role: '', name: '', attrs: [], children: [], pending: '' };
            for (const child of childrenOf(el)) walk(child, inner, depth + 1, true, 'pointer');
            item.children = inner.children.filter((c) => c.kind === 'node' && (c.ref || c.role === 'img' && c.name && c.name !== item.name));
            return;
          }
          if (tag === 'SUMMARY' && item.name) return;
          for (const child of childrenOf(el)) walk(child, item, depth + 1, inside || interactive, pointer ? 'pointer' : cursor);
          flush(item);
          // A node that says only what its name says keeps the name.
          if (item.children.length === 1 && item.children[0].kind === 'text' && item.children[0].text === item.name) item.children = [];
        };
        if (document.body) for (const child of childrenOf(document.body)) walk(child, root, 0, false, '');
        flush(root);
        const lines = [];
        const render = (node, depth) => {
          const indent = '  '.repeat(depth);
          if (node.kind === 'text') { lines.push(indent + '- text: ' + JSON.stringify(node.text)); return; }
          // An empty container (a paragraph nothing is in yet) says nothing.
          if (!node.name && !node.ref && !node.url && !node.children.length && !node.attrs.length && EMPTY.has(node.role)) return;
          const attrs = node.attrs.slice();
          if (node.ref) attrs.push('ref=' + node.ref);
          const line = indent + '- ' + node.role + (node.name ? ' ' + JSON.stringify(node.name) : '') + (attrs.length ? ' [' + attrs.join(' ') + ']' : '');
          if (!node.name && !node.url && node.children.length === 1 && node.children[0].kind === 'text') { lines.push(line + ': ' + JSON.stringify(node.children[0].text)); return; }
          lines.push(line);
          if (node.url) lines.push(indent + '  - /url: ' + JSON.stringify(node.url));
          for (const child of node.children) render(child, depth + 1);
        };
        for (const child of root.children) render(child, 0);
        let text = lines.length ? lines.join('\n') : '- document';
        let truncated = state.stop;
        if (text.length > LIMIT.text) { text = text.slice(0, text.lastIndexOf('\n', LIMIT.text)); truncated = true; }
        if (truncated) text += '\n- text: "The page continues: this snapshot was cut short."';
        return {
          url: location.href, title: document.title, snapshot: text, truncated,
          stats: { nodeCount: state.nodes, refCount: state.refs, textLength: text.length, iframeCount: state.frames, maxDepth: state.depth },
        };
      };

      const element = (ref) => {
        const el = refs.get(ref) && refs.get(ref).deref();
        if (!el || !el.isConnected) throw fail('browser_stale_ref', 'Ref ' + ref + ' is not in the latest snapshot of this page. Take a new browser_snapshot and use its refs.');
        return el;
      };
      const describe = (el) => {
        const role = roleOf(el) || el.tagName.toLowerCase();
        const name = nameOf(el, role);
        return name ? role + ' "' + cut(name, 60) + '"' : role;
      };
      const point = (el) => {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + r.width / 2, 0), Math.max(0, innerWidth - 1));
        const y = Math.min(Math.max(r.top + r.height / 2, 0), Math.max(0, innerHeight - 1));
        return { x, y };
      };
      const where = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
      const modifiersOf = (list) => ({ altKey: list.includes('Alt'), ctrlKey: list.includes('Control'), metaKey: list.includes('Meta'), shiftKey: list.includes('Shift') });
      const mouse = (target, type, p, init) => {
        const pointer = type.startsWith('pointer');
        const enter = type.endsWith('enter') || type.endsWith('leave');
        const Kind = pointer && window.PointerEvent ? PointerEvent : MouseEvent;
        return target.dispatchEvent(new Kind(type, {
          bubbles: !enter, cancelable: !enter, composed: true, view: window, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
          ...(pointer ? { pointerId: 1, pointerType: 'mouse', isPrimary: true } : {}), ...init,
        }));
      };
      const focusFor = (el) => (el.closest ? el.closest(FOCUSABLE) : null);
      const fire = (el, type, init) =>
        el.dispatchEvent(type === 'input' ? new InputEvent('input', { bubbles: true, composed: true, ...init }) : new Event(type, { bubbles: true, composed: true }));
      const setValue = (el, value) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (setter) setter.call(el, value); else el.value = value;
      };
      const isField = (el) => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUT.has((el.getAttribute('type') || '').toLowerCase()));
      const editableOf = (el) => isField(el) || el.isContentEditable;
      const usable = (el) => {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw fail('browser_unknown_error', 'The ' + describe(el) + ' is disabled.');
      };

      const choose = (select, value) => {
        const options = [...select.options];
        const want = clean(value);
        const option = options.find((o) => o.value === value) || options.find((o) => clean(o.text) === want || clean(o.label) === want) ||
          options.find((o) => clean(o.text).toLowerCase() === want.toLowerCase());
        if (!option) throw fail('browser_unknown_error', 'No option "' + value + '" in the ' + describe(select) + '. It has: ' + options.slice(0, 30).map((o) => JSON.stringify(clean(o.text))).join(', ') + '.');
        if (option.disabled) throw fail('browser_unknown_error', 'The option "' + clean(option.text) + '" is disabled.');
        if (select.multiple) option.selected = true; else select.selectedIndex = option.index;
        fire(select, 'input');
        fire(select, 'change');
        return option.value;
      };

      const click = ({ ref, button = 'left', doubleClick = false, modifiers = [] }) => {
        const el = element(ref);
        usable(el);
        if (el.tagName === 'OPTION' && el.closest('select')) { choose(el.closest('select'), el.value); return {}; }
        const p = point(el);
        const hit = document.elementFromPoint(p.x, p.y);
        const target = hit && (hit === el || el.contains(hit)) ? hit : el;
        const b = { left: 0, middle: 1, right: 2 }[button] || 0;
        const mods = modifiersOf(modifiers);
        const press = (detail) => {
          const held = { button: b, buttons: [1, 4, 2][b], detail, ...mods };
          mouse(target, 'pointerover', p, mods); mouse(target, 'mouseover', p, mods);
          mouse(target, 'pointermove', p, mods); mouse(target, 'mousemove', p, mods);
          mouse(target, 'pointerdown', p, held);
          if (mouse(target, 'mousedown', p, held)) {
            const focus = focusFor(target);
            if (focus && document.activeElement !== focus) focus.focus({ preventScroll: true });
            else if (!focus && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
          }
          const released = { button: b, buttons: 0, detail, ...mods };
          mouse(target, 'pointerup', p, released); mouse(target, 'mouseup', p, released);
          const live = target.isConnected ? target : el;
          if (b === 0) mouse(live, 'click', p, released);
          else if (b === 1) mouse(live, 'auxclick', p, released);
          else mouse(live, 'contextmenu', p, released);
        };
        press(1);
        if (doubleClick) { press(2); if (b === 0) mouse(target.isConnected ? target : el, 'dblclick', p, { button: 0, detail: 2, ...mods }); }
        return where(p);
      };

      const fill = ({ ref, value }) => {
        const el = element(ref);
        usable(el);
        if (el instanceof HTMLSelectElement) { choose(el, value); return {}; }
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
          if (el.checked !== /^(true|1|on|yes|checked)$/i.test(value.trim())) el.click();
          return {};
        }
        if (el instanceof HTMLInputElement && el.type === 'file') throw fail('browser_unknown_error', 'A file input takes files: use browser_upload.');
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.readOnly) throw fail('browser_unknown_error', 'The ' + describe(el) + ' is read-only.');
          point(el);
          el.focus({ preventScroll: true });
          setValue(el, value);
          fire(el, 'input', { inputType: 'insertText', data: value });
          fire(el, 'change');
          return {};
        }
        if (el.isContentEditable) {
          el.focus({ preventScroll: true });
          getSelection().selectAllChildren(el);
          if (!document.execCommand('insertText', false, value) || clean(el.textContent) !== clean(value)) {
            el.textContent = value;
            fire(el, 'input', { inputType: 'insertText', data: value });
          }
          return {};
        }
        throw fail('browser_unknown_error', 'The ' + describe(el) + " isn't a field: it can't be filled.");
      };

      const insert = (el, text) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.disabled || el.readOnly) return;
          const before = el.value;
          if (document.activeElement === el && document.execCommand('insertText', false, text) && el.value !== before) return;
          let start = before.length, end = before.length;
          try { if (el.selectionStart !== null) { start = el.selectionStart; end = el.selectionEnd; } } catch (e) {}
          setValue(el, before.slice(0, start) + text + before.slice(end));
          try { el.setSelectionRange(start + text.length, start + text.length); } catch (e) {}
          fire(el, 'input', { inputType: 'insertText', data: text });
        } else if (el.isContentEditable) {
          const before = el.textContent;
          if (!document.execCommand('insertText', false, text) || el.textContent === before) {
            el.append(document.createTextNode(text));
            fire(el, 'input', { inputType: 'insertText', data: text });
          }
        }
      };
      const erase = (el, forward) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.disabled || el.readOnly) return;
          const before = el.value;
          if (document.activeElement === el && document.execCommand(forward ? 'forwardDelete' : 'delete') && el.value !== before) return;
          let start = before.length, end = before.length;
          try { if (el.selectionStart !== null) { start = el.selectionStart; end = el.selectionEnd; } } catch (e) {}
          if (start === end) { if (forward) end = Math.min(before.length, end + 1); else start = Math.max(0, start - 1); }
          if (start === end) return;
          setValue(el, before.slice(0, start) + before.slice(end));
          try { el.setSelectionRange(start, start); } catch (e) {}
          fire(el, 'input', { inputType: forward ? 'deleteContentForward' : 'deleteContentBackward' });
        } else if (el.isContentEditable) document.execCommand(forward ? 'forwardDelete' : 'delete');
      };

      const KEY_CODES = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
        Home: 36, End: 35, PageUp: 33, PageDown: 34, Insert: 45, ' ': 32 };
      const keyEvent = (type, key, mods) => {
        const letter = key.length === 1;
        const code = letter ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : key === ' ' ? 'Space' : '') : key;
        const value = type === 'keypress' && letter ? key.charCodeAt(0) : KEY_CODES[key] || (letter ? key.toUpperCase().charCodeAt(0) : /^F\d+$/.test(key) ? 111 + Number(key.slice(1)) : 0);
        const event = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true, view: window, ...mods });
        for (const name of ['keyCode', 'which', 'charCode']) {
          try { Object.defineProperty(event, name, { get: () => (name === 'charCode' ? (type === 'keypress' ? value : 0) : value) }); } catch (e) {}
        }
        return event;
      };
      const tabbable = () => [...document.querySelectorAll(FOCUSABLE + ',iframe')].filter((el) =>
        !el.disabled && el.tabIndex >= 0 && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })));
      const defaults = (el, key, mods) => {
        const command = mods.metaKey || mods.ctrlKey;
        const editable = editableOf(el);
        if (command && key.toLowerCase() === 'a') {
          if (isField(el)) el.select(); else getSelection().selectAllChildren(el.isContentEditable ? el : document.body);
          return;
        }
        if (key.length === 1 && !command && !mods.altKey) {
          if (!el.dispatchEvent(keyEvent('keypress', key, mods))) return;
          if (editable) insert(el, key);
          else if (key === ' ') {
            if (el.matches('button,summary,[role=button],[role=checkbox],[role=switch],[role=tab],input[type=checkbox],input[type=radio],input[type=button],input[type=submit]')) el.click();
            else scrollBy({ top: innerHeight * (mods.shiftKey ? -0.9 : 0.9), behavior: 'instant' });
          }
          return;
        }
        if (command || mods.altKey) return;
        switch (key) {
          case 'Enter': {
            if (!el.dispatchEvent(keyEvent('keypress', key, mods))) return;
            if (el instanceof HTMLTextAreaElement) return insert(el, '\n');
            if (el.isContentEditable) { document.execCommand(mods.shiftKey ? 'insertLineBreak' : 'insertParagraph'); return; }
            if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(el.type)) {
              fire(el, 'change');
              const form = el.form;
              if (!form) return;
              const submit = [...form.elements].find((c) => (c.tagName === 'BUTTON' && (c.type || 'submit') === 'submit') || (c.tagName === 'INPUT' && (c.type === 'submit' || c.type === 'image')));
              if (submit) { if (!submit.disabled) submit.click(); }
              else if (form.requestSubmit) form.requestSubmit(); else form.submit();
              return;
            }
            if (el.matches('a[href],button,summary,input[type=button],input[type=submit],input[type=reset],[role=button],[role=link],[role=menuitem],[role=option],[role=tab],[role=switch],[role=checkbox]')) el.click();
            return;
          }
          case 'Tab': {
            const list = tabbable();
            if (!list.length) return;
            const at = list.indexOf(document.activeElement);
            const next = list[(at + (mods.shiftKey ? -1 : 1) + list.length) % list.length];
            if (isField(el)) fire(el, 'change');
            next.focus();
            if (isField(next)) try { next.select(); } catch (e) {}
            return;
          }
          case 'Backspace': if (editable) erase(el, false); return;
          case 'Delete': if (editable) erase(el, true); return;
          case 'ArrowDown': case 'ArrowUp': {
            if (el instanceof HTMLSelectElement) {
              const next = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + (key === 'ArrowDown' ? 1 : -1)));
              if (next !== el.selectedIndex) { el.selectedIndex = next; fire(el, 'input'); fire(el, 'change'); }
            } else if (!editable) scrollBy({ top: key === 'ArrowDown' ? 40 : -40, behavior: 'instant' });
            return;
          }
          case 'PageDown': case 'PageUp': if (!editable) scrollBy({ top: innerHeight * (key === 'PageDown' ? 0.9 : -0.9), behavior: 'instant' }); return;
          case 'Home': case 'End': {
            // In a field the caret goes to its start or end (a field that keeps no caret, an email's, is left).
            if (isField(el)) { try { const at = key === 'Home' ? 0 : el.value.length; el.setSelectionRange(at, at); } catch (e) {} }
            else if (!editable) scrollTo({ top: key === 'Home' ? 0 : document.documentElement.scrollHeight, behavior: 'instant' });
            return;
          }
          case 'ArrowLeft': case 'ArrowRight': {
            if (!isField(el)) return;
            try {
              const from = el.selectionStart, to = el.selectionEnd, left = key === 'ArrowLeft';
              const at = from !== to ? (left ? from : to) : Math.max(0, Math.min(el.value.length, from + (left ? -1 : 1)));
              el.setSelectionRange(at, at);
            } catch (e) {}
            return;
          }
        }
      };
      const press = (el, key, mods) => {
        if (el.dispatchEvent(keyEvent('keydown', key, mods))) defaults(el, key, mods);
        const after = el.isConnected ? el : document.activeElement || document.body;
        after.dispatchEvent(keyEvent('keyup', key, mods));
      };
      const aim = (ref) => {
        if (!ref) return document.activeElement || document.body;
        const el = element(ref);
        usable(el);
        point(el);
        const focus = el.matches(FOCUSABLE) ? el : focusFor(el) || el;
        if (document.activeElement !== focus && typeof focus.focus === 'function') {
          focus.focus({ preventScroll: true });
          // Newly aimed at, what's typed goes after what it holds.
          if (isField(focus)) { try { focus.setSelectionRange(focus.value.length, focus.value.length); } catch (e) {} }
          else if (focus.isContentEditable) { const range = document.createRange(); range.selectNodeContents(focus); range.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(range); }
        }
        return document.activeElement && document.activeElement !== document.body && (focus === document.activeElement || focus.contains(document.activeElement)) ? document.activeElement : focus;
      };
      const type = ({ ref, text }) => {
        let el = aim(ref);
        for (const ch of text) {
          if (ch === '\r') continue;
          press(el, ch === '\n' ? 'Enter' : ch === '\t' ? 'Tab' : ch, modifiersOf([]));
          if (document.activeElement && document.activeElement !== document.body && document.activeElement !== el) el = document.activeElement;
        }
        const typed = ref && refs.get(ref) && refs.get(ref).deref();
        return typed && typed.isConnected ? where(point(typed)) : {};
      };
      const keypress = ({ ref, key, modifiers = [] }) => {
        const el = aim(ref);
        press(el, key, modifiersOf(modifiers));
        return ref && el.isConnected ? where(point(el)) : {};
      };
      const select = ({ ref, value }) => {
        let el = element(ref);
        if (el.tagName === 'OPTION') el = el.closest('select') || el;
        usable(el);
        if (!(el instanceof HTMLSelectElement)) throw fail('browser_unknown_error', 'The ' + describe(el) + " isn't a select: click it, then click the option you want.");
        return { value: choose(el, value) };
      };
      const hover = ({ ref }) => {
        const el = element(ref);
        const p = point(el);
        const hit = document.elementFromPoint(p.x, p.y);
        const target = hit && (hit === el || el.contains(hit)) ? hit : el;
        for (const name of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) mouse(target, name, p, {});
        return where(p);
      };
      const drag = ({ sourceRef, targetRef }) => {
        const from = element(sourceRef), to = element(targetRef);
        const a = point(from);
        const held = { button: 0, buttons: 1 };
        mouse(from, 'pointerdown', a, held); mouse(from, 'mousedown', a, held);
        let data = null;
        try { data = new DataTransfer(); } catch (e) {}
        const dragEvent = (target, name, p) => {
          let event;
          try { event = new DragEvent(name, { bubbles: true, cancelable: true, composed: true, view: window, clientX: p.x, clientY: p.y, dataTransfer: data }); }
          catch (e) { event = new MouseEvent(name, { bubbles: true, cancelable: true, composed: true, view: window, clientX: p.x, clientY: p.y }); }
          return target.dispatchEvent(event);
        };
        dragEvent(from, 'dragstart', a);
        const b = point(to);
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        mouse(from, 'pointermove', middle, held); mouse(from, 'mousemove', middle, held);
        mouse(to, 'pointermove', b, held); mouse(to, 'mousemove', b, held);
        dragEvent(to, 'dragenter', b); dragEvent(to, 'dragover', b); dragEvent(to, 'drop', b);
        dragEvent(from.isConnected ? from : to, 'dragend', b);
        const released = { button: 0, buttons: 0 };
        mouse(to, 'pointerup', b, released); mouse(to, 'mouseup', b, released);
        return { sourceX: Math.round(a.x), sourceY: Math.round(a.y), targetX: Math.round(b.x), targetY: Math.round(b.y) };
      };
      const scroller = (el) => {
        for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          const y = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
          const x = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
          if (x || y) return node;
        }
        return null;
      };
      const scroll = ({ ref, deltaX = 0, deltaY = 0 }) => {
        const el = ref ? element(ref) : null;
        const p = el ? point(el) : { x: innerWidth / 2, y: innerHeight / 2 };
        const target = el || document.elementFromPoint(p.x, p.y) || document.body;
        const kept = target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, view: window, clientX: p.x, clientY: p.y, deltaX, deltaY }));
        if (kept) {
          const box = el ? scroller(el) : null;
          if (box) box.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' }); else scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' });
        }
        return el ? where(p) : {};
      };
      const upload = ({ ref, files }) => {
        let el = element(ref);
        if (!(el instanceof HTMLInputElement && el.type === 'file')) {
          // A dressed-up control: the file input it stands for.
          const inside = el.querySelector ? el.querySelector('input[type=file]') : null;
          const labelled = el.tagName === 'LABEL' && el.control && el.control.type === 'file' ? el.control : null;
          el = inside || labelled || el;
        }
        if (!(el instanceof HTMLInputElement && el.type === 'file')) throw fail('browser_unknown_error', 'The ' + describe(el) + " isn't a file input.");
        if (!el.multiple && files.length > 1) throw fail('browser_unknown_error', 'This file input takes one file.');
        const data = new DataTransfer();
        for (const file of files) {
          const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
          data.items.add(new File([bytes], file.name, { type: file.type || '' }));
        }
        el.files = data.files;
        fire(el, 'input');
        fire(el, 'change');
        return {};
      };
      const network = ({ max = 50 }) => {
        const origin = performance.timeOrigin;
        return performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')).slice(-max).map((entry) => {
          const out = { url: String(entry.name).slice(0, 2000), type: entry.initiatorType || entry.entryType, startTime: Math.round(origin + entry.startTime), duration: Math.round(entry.duration) };
          if (typeof entry.responseStatus === 'number' && entry.responseStatus > 0) out.status = entry.responseStatus;
          if (typeof entry.transferSize === 'number') out.transferSize = entry.transferSize;
          return out;
        });
      };
      const size = () => ({ width: Math.ceil(Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0)),
        height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)) });
      const has = ({ text }) => ((document.body && document.body.innerText) || '').includes(text);

      const api = { snapshot, click, fill, type, keypress, select, hover, drag, scroll, upload, network, size, has };
      Object.defineProperty(globalThis, '__paseoBrowser', {
        enumerable: false,
        value: {
          element,
          async run(name, args) {
            try {
              if (!api[name]) throw fail('browser_unsupported', 'Unknown browser action ' + name);
              const value = await api[name](args || {});
              return { ok: true, value: value === undefined ? {} : value };
            } catch (error) {
              return { ok: false, code: (error && error.code) || 'browser_unknown_error', message: String((error && error.message) || error) };
            }
          },
        },
      });
    }
    """#
}
