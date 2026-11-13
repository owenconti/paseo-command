/**
 * The browser attached to an agent on the Dungeon Board: its own tabs, over the board above its dialogue box
 * (B, the box's Browser button, ⌘K). The page draws the frame, the tab strip and the address bar; the macOS
 * app draws the web page itself over the box left for it (`BoardBrowser.swift`), which this reports as it
 * moves, with the page's own things lying over it (the dialogue's choices, a hint, a menu) so they show through.
 * A tab is opened here by you, or by the agent with Paseo's `browser_*` tools while Settings → Map has them on.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Maximize2, Minimize2, Plus, RotateCw, X } from "lucide-react";
import { daemonAgentId } from "../agentIdentity";
import { MODAL_EVENT, modalOpen } from "../focus";
import { openSettings } from "../settingsStore";
import type { Agent } from "../types";
import { postAppLink } from "../worldBridge";
import { onAppCommand } from "../appCommands";
import { parseAppLink } from "../appLinks";
import { setBoardLinkOpener } from "../chatLinks";
import {
  browserDo,
  browserKey,
  hideBrowser,
  onBrowserEvent,
  postBrowserPlacement,
  shortAddress,
  tabLabel,
  useBoardBrowsers,
  type BrowserHosting,
  type Rect,
} from "./browserBridge";
import { uiFrame } from "./frame";
import "./board-browser.css";

export const BROWSER_ADDRESS = "board-browser-address";
/** A Linear issue or project: the app opens it in Linear's desktop app (`LinearLink.swift`). */
const LINEAR_LINK = /^https:\/\/linear\.app\/[^/]+\/(issue|project)\//i;
/** The page's own layers that can lie over the web page: cut out of it, so they show and take their clicks. */
const OVER = ".wc-choices, .board-menu, .tooltip.shown, .atlas-world-tip, .world-chat .popover-menu";
/** Filling the board, the browser is over the dialogue box: its choices are behind it. */
const OVER_FILLED = ".board-menu, .tooltip.shown";

/** How agents' own browser tools stand, in a sentence for the empty browser. */
export function hostingNote(hosting: BrowserHosting, host: string, name: string): { text: string; settings?: boolean } {
  if (!hosting.enabled)
    return { text: `${name} can open pages here itself once “Agents’ browser tools open tabs here” is on in Settings.`, settings: true };
  if (!hosting.connected) return { text: "Connecting this app to its daemons as their browser…" };
  const own = hosting.hosts.find((h) => h.host === host);
  if (own?.state === "registered") return { text: `${name} can open pages here itself with its browser tools.` };
  if (own?.state === "refused") return { text: `${name}’s daemon didn’t take this app as its browser${own.error ? `: ${own.error}` : "."}` };
  return { text: `Waiting for ${name}’s daemon to take this app as its browser…` };
}

export function BoardBrowser(props: {
  agent: Agent;
  name: string;
  /** How much of the map's foot the dialogue box covers (CSS px): the browser ends above it. */
  inset: number;
  /** The whole conversation shows too: it has the board's left, the browser its right, down to the belt. */
  beside: boolean;
  /** A confirming dialog is open: the web page steps aside. */
  blocked: boolean;
  /** The GitHub tab is on: a pull request's link clicked in the conversation still opens there. */
  github: boolean;
  /** On the Crew map: beside its conversation, in the app's own plain look rather than the board's gold frame. */
  crew?: boolean;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const { agent, name, blocked, onNotice } = props;
  const all = useBoardBrowsers();
  const host = agent.host || "local";
  const id = daemonAgentId(agent);
  const workspace = agent.workspaceId;
  const browser = all.browsers[browserKey(agent.host, id)];
  const tabs = browser?.tabs ?? [];
  const current = tabs.find((t) => t.id === browser?.current) ?? tabs[0];
  const [filled, setFilled] = useState(false);
  /** The address as it is being typed (null: the page's own). */
  const [typed, setTyped] = useState<string | null>(null);
  const slot = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const [frame, setFrame] = useState<string>();
  useEffect(() => {
    if (props.crew) return;
    let live = true;
    uiFrame("panel").then((url) => live && setFrame(url), () => {});
    return () => {
      live = false;
    };
  }, []);

  // Tell the app where the web page goes, as the box moves or something of the page's comes over it.
  useLayoutEffect(() => {
    const node = slot.current;
    if (!node) return;
    let frameRequest = 0;
    const measure = () => {
      frameRequest = 0;
      const r = node.getBoundingClientRect();
      const holes: Rect[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(filled ? OVER_FILLED : OVER)) {
        const o = el.getBoundingClientRect();
        if (o.width < 1 || o.height < 1 || o.right <= r.left || o.left >= r.right || o.bottom <= r.top || o.top >= r.bottom) continue;
        // A little wider than the thing, for its shadow's nearest edge.
        holes.push({ x: Math.floor(o.left) - 2, y: Math.floor(o.top) - 2, width: Math.ceil(o.width) + 4, height: Math.ceil(o.height) + 4 });
      }
      postBrowserPlacement({
        host,
        agent: id,
        ...(workspace ? { workspace } : {}),
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        covered: blocked || modalOpen(),
        holes,
      });
    };
    const soon = () => {
      if (!frameRequest) frameRequest = requestAnimationFrame(measure);
    };
    measure();
    const resized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(soon);
    resized?.observe(node);
    const changed = new MutationObserver(soon);
    changed.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", soon);
    window.addEventListener(MODAL_EVENT, soon);
    // A move nothing announced (a panel's animation).
    const poll = window.setInterval(measure, 250);
    return () => {
      cancelAnimationFrame(frameRequest);
      resized?.disconnect();
      changed.disconnect();
      window.removeEventListener("resize", soon);
      window.removeEventListener(MODAL_EVENT, soon);
      window.clearInterval(poll);
    };
  }, [host, id, workspace, blocked, filled]);
  useEffect(() => () => hideBrowser(), []);

  // The address follows the page, until it is being typed.
  useEffect(() => setTyped(null), [current?.id, current?.url]);

  const focusAddress = () => {
    const field = address.current;
    if (!field) return;
    field.focus();
    field.select();
  };
  const newTab = () => {
    browserDo("open", { host, agent: id, workspace });
    setTyped("");
    requestAnimationFrame(() => address.current?.focus());
  };
  const live = useRef({ focusAddress, newTab, current, close: props.onClose });
  live.current = { focusAddress, newTab, current, close: props.onClose };
  useEffect(
    () =>
      onBrowserEvent((event) => {
        if (event.type === "refused") onNotice(event.message);
        else if (event.type === "key") (event.action === "address" ? live.current.focusAddress : event.action === "new" ? live.current.newTab : live.current.close)();
      }),
    [onNotice],
  );
  // While it shows, web links clicked in the board's conversation open here, in the browser you are looking at
  // (the user's call), not in Conquer: in a tab already at that address, else a blank tab on show, else a new tab.
  // A pull request (the GitHub tab) and a Linear issue or project (Linear's app) keep the app's own places.
  const linkState = useRef({ tabs, current, github: props.github, host, id, workspace });
  linkState.current = { tabs, current, github: props.github, host, id, workspace };
  useEffect(
    () =>
      setBoardLinkOpener((url) => {
        const now = linkState.current;
        if (!/^https?:\/\//i.test(url) || (now.github && parseAppLink(url)) || LINEAR_LINK.test(url)) return false;
        const open = now.tabs.find((t) => t.url === url || t.url === `${url}/`);
        if (open) browserDo("select", { tab: open.id });
        else if (now.current && !now.current.url && !now.current.loading) browserDo("navigate", { tab: now.current.id, url });
        else browserDo("open", { host: now.host, agent: now.id, workspace: now.workspace, url });
        return true;
      }),
    [],
  );
  // ⇧⌘W hides the browser from anywhere in the page, a field included (the app sends it as `key` while a web
  // page has the keyboard; B does it too, outside fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.shiftKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "w" || e.defaultPrevented || modalOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      live.current.close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // ⌘K's entries for the browser on show (main's `paletteCommands`).
  useEffect(() => {
    const tab = (run: (id: string, url: string) => void) => () => {
      const shown = live.current.current;
      if (shown) run(shown.id, shown.url);
    };
    const offs = [
      onAppCommand("board-browser-address", () => live.current.focusAddress()),
      onAppCommand("board-browser-new", () => live.current.newTab()),
      onAppCommand("board-browser-fill", () => setFilled((f) => !f)),
      onAppCommand("board-browser-reload", tab((id) => browserDo("reload", { tab: id }))),
      onAppCommand("board-browser-back", tab((id) => browserDo("back", { tab: id }))),
      onAppCommand("board-browser-forward", tab((id) => browserDo("forward", { tab: id }))),
      onAppCommand("board-browser-close-tab", tab((id) => browserDo("close", { tab: id }))),
      onAppCommand("board-browser-conquer", tab((_, url) => url && postAppLink(url))),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const go = (e: FormEvent) => {
    e.preventDefault();
    const url = (typed ?? current?.url ?? "").trim();
    if (!url) return;
    if (current) browserDo("navigate", { tab: current.id, url });
    else browserDo("open", { host, agent: id, workspace, url });
    setTyped(null);
    address.current?.blur();
  };

  const note = hostingNote(all.hosting, host, name);
  const shownAddress = typed ?? (current ? shortAddress(current.url) : "");
  return (
    <section
      className={`board-browser${props.crew ? " crew" : ""}${filled ? " filled" : props.beside ? " beside" : ""}`}
      aria-label={`${name}’s browser`}
      style={{ ...(frame && !props.crew ? { "--bb-frame": `url(${frame})` } : {}), "--bb-inset": `${Math.max(0, Math.round(props.inset))}px` } as CSSProperties}
      data-tabs={tabs.length}
    >
      <header className="bb-head">
        <div className="bb-tabs" role="tablist" aria-label={`${name}’s browser tabs`}>
          {tabs.map((tab) => {
            const selected = tab.id === current?.id;
            const label = tabLabel(tab);
            return (
              <div key={tab.id} className={`bb-tab${selected ? " selected" : ""}${tab.loading ? " loading" : ""}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="bb-tab-name"
                  data-tip={tab.url && label !== shortAddress(tab.url) ? `${label} · ${shortAddress(tab.url)}` : undefined}
                  onClick={() => browserDo("select", { tab: tab.id })}
                >
                  {tab.loading && <span className="bb-spinner" aria-hidden />}
                  <span className="bb-tab-text">{label}</span>
                </button>
                <button type="button" className="bb-tab-close" aria-label={`Close ${label}`} onClick={() => browserDo("close", { tab: tab.id })}>
                  <X size={12} aria-hidden />
                </button>
              </div>
            );
          })}
          <button type="button" className="bb-tool bb-new" aria-label="New tab" data-tip="New tab" onClick={newTab}>
            <Plus size={14} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="bb-tool"
          aria-label={filled ? (props.beside ? "Show the conversation again" : "Show the dialogue box again") : props.crew ? "Fill the view with the browser" : "Fill the board with the browser"}
          data-tip={filled ? (props.beside ? "Show the conversation again" : "Show the dialogue box again") : props.crew ? "Fill the view" : "Fill the board"}
          aria-pressed={filled}
          onClick={() => setFilled(!filled)}
        >
          {filled ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
        </button>
        <button type="button" className="bb-tool bb-hide" aria-label="Hide the browser (B, ⇧⌘W)" data-tip="Hide the browser" onClick={props.onClose}>
          <X size={15} aria-hidden />
        </button>
      </header>
      <form className="bb-bar" onSubmit={go}>
        <button type="button" className="bb-tool" aria-label="Back" data-tip="Back" disabled={!current?.back} onClick={() => current && browserDo("back", { tab: current.id })}>
          <ArrowLeft size={15} aria-hidden />
        </button>
        <button type="button" className="bb-tool" aria-label="Forward" data-tip="Forward" disabled={!current?.forward} onClick={() => current && browserDo("forward", { tab: current.id })}>
          <ArrowRight size={15} aria-hidden />
        </button>
        <button
          type="button"
          className="bb-tool"
          aria-label={current?.loading ? "Stop loading" : "Reload"}
          data-tip={current?.loading ? "Stop loading" : "Reload"}
          disabled={!current || (!current.url && !current.loading)}
          onClick={() => current && browserDo(current.loading ? "stop" : "reload", { tab: current.id })}
        >
          {current?.loading ? <X size={15} aria-hidden /> : <RotateCw size={14} aria-hidden />}
        </button>
        <input
          ref={address}
          id={BROWSER_ADDRESS}
          className="bb-address"
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Address"
          placeholder="An address: localhost:5173, example.com…"
          value={shownAddress}
          onFocus={(e) => {
            // The whole address, to edit or replace.
            if (typed === null && current?.url) setTyped(current.url);
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => setTyped(null)}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key !== "Escape") return;
            e.preventDefault();
            setTyped(null);
            e.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className="bb-tool"
          aria-label="Open this page in Conquer"
          data-tip="Open in Conquer"
          disabled={!current?.url}
          onClick={() => current?.url && postAppLink(current.url)}
        >
          <ExternalLink size={14} aria-hidden />
        </button>
      </form>
      <div ref={slot} className="bb-view" data-tab={current?.id ?? ""} onMouseDown={() => current && !current.error && browserDo("focus")}>
        {!current ? (
          <div className="bb-empty">
            <b>No pages yet</b>
            <span>Type an address above to open one in {name}’s browser.</span>
            <span className="bb-note">{note.text}</span>
            {note.settings && (
              <button type="button" className="bb-button" onClick={() => openSettings("map")}>
                Open Settings
              </button>
            )}
          </div>
        ) : current.error ? (
          <div className="bb-empty" role="alert">
            <b>This page didn’t open</b>
            <span>{current.error}</span>
            {current.url && <span className="bb-note">{shortAddress(current.url)}</span>}
            <button type="button" className="bb-button" onClick={() => browserDo("reload", { tab: current.id })}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
