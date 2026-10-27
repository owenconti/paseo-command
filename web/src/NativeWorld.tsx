/** Phaser AE renderer adapter. The inherited React work surface owns all daemon actions. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Home, Minus, Plus } from 'lucide-react';
import { worldSnapshot, targetSelection, UNITY_WORLDS, type WorldSnapshot, type WorldTarget } from './worldBridge';
import { projectKey, workspaceKey } from './workspaces';
import { setUnityWorldTheme } from './theme';
import { readStore, writeStore } from './api';
import type { Agent, Host, Project, Selection, Workspace } from './types';
import './phaser-world.css';
type Props = {
  hosts: Host[]; projects: Project[]; workspaces: Workspace[]; agents: Agent[];
  permissions: Set<string>; unread: Set<string>; selection: Selection; focusRevision: number;
  select: (value: Selection) => void; hover: (id: string | null) => void;
  onNotice: (message: string) => void; blocked: boolean;
};
type Engine = {
  ready: Promise<void>; isReady: boolean;
  cheats: { run(name: string, ...args: string[]): unknown };
  inspect(): { state?: { clicked?: WorldTarget | null; clickSequence?: number } };
};
export function NativeWorld(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const engine = useRef<Engine | null>(null);
  const revision = useRef(0), clickedSequence = useRef(0);
  const latest = useRef(props); latest.current = props;
  const [ready, setReady] = useState(false), [failure, setFailure] = useState('');
  const [world, setWorld] = useState<keyof typeof UNITY_WORLDS>(() => {
    const saved = readStore<string>('phaser-world', 'galaxy');
    return saved in UNITY_WORLDS ? saved as keyof typeof UNITY_WORLDS : 'galaxy';
  });
  const currentWorld = useRef(world); currentWorld.current = world;
  const snapshot = useMemo(() => worldSnapshot({ ...props, revision: ++revision.current }),
    [props.hosts, props.projects, props.workspaces, props.agents, props.permissions, props.unread]);
  const currentSnapshot = useRef<WorldSnapshot>(snapshot); currentSnapshot.current = snapshot;
  const command = (name: string, ...args: string[]) => engine.current?.cheats.run(name, ...args);
  useEffect(() => {
    setUnityWorldTheme(world);
    writeStore('phaser-world', world);
    if (ready) command('world', world);
    return () => setUnityWorldTheme(null);
  }, [world, ready]);
  useEffect(() => { if (ready) command('snapshot', JSON.stringify(snapshot)); }, [snapshot, ready]);
  useEffect(() => {
    if (!ready) return;
    const s = props.selection;
    const rows = s?.type === 'agent' ? snapshot.agents : s?.type === 'project' ? snapshot.projects : snapshot.workspaces;
    const row = s && rows.find(r => s.type === 'agent' ? ('clientId' in r ? r.clientId : r.id) === s.id :
      (s.type === 'project' ? projectKey({ projectId: r.id, host: r.hostId === 'local' ? undefined : r.hostId }) : workspaceKey({ workspaceId: r.id, host: r.hostId === 'local' ? undefined : r.hostId })) === s.id);
    const target = row && s ? { kind: s.type, key: row.key } : null;
    command('select', JSON.stringify(target));
    if (target) command('focus', JSON.stringify(target));
  }, [props.selection, props.focusRevision, ready]);
  useEffect(() => {
    if (!ready) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => command('motion', media.matches ? 'reduce' : 'full');
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    // Page integration lives outside the simulation; only host-qualified identities cross this boundary.
    const timer = setInterval(() => {
      try {
        const state = engine.current?.inspect().state;
        if (!state?.clickSequence || state.clickSequence <= clickedSequence.current) return;
        clickedSequence.current = state.clickSequence;
        const selection = targetSelection(state.clicked, currentSnapshot.current);
        if (selection && !latest.current.blocked) latest.current.select(selection);
      } catch { setFailure('The world stopped responding. Reload the world to reconnect.'); }
    }, 150);
    return () => clearInterval(timer);
  }, [ready]);
  const connect = async () => {
    setReady(false); setFailure(''); engine.current = null;
    try {
      const candidate = (frame.current?.contentWindow as (Window & { game?: Engine }) | null)?.game;
      if (!candidate) throw new Error('The Phaser AE engine did not start. Reload the world to try again.');
      await candidate.ready;
      engine.current = candidate; clickedSequence.current = 0;
      candidate.cheats.run('world', currentWorld.current);
      candidate.cheats.run('snapshot', JSON.stringify(currentSnapshot.current));
      candidate.cheats.run('home'); setReady(true);
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not load the Phaser world.'); }
  };
  return <>
    <iframe ref={frame} className="phaser-world-frame" src="/world/index.html" title="Paseo Command Phaser AE world" onLoad={() => void connect()} />
    {props.blocked && <div className="phaser-input-cover" />}
    <div className="unity-world-toolbar" role="toolbar" aria-label="World controls">
      <label>World <select aria-label="Choose world" value={world} disabled={!ready || props.blocked} onChange={e => setWorld(e.target.value as keyof typeof UNITY_WORLDS)}>
        {Object.entries(UNITY_WORLDS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <button aria-label="Fit all hosts" title="Fit all hosts" disabled={!ready || props.blocked} onClick={() => command('home')}><Home size={17}/></button>
      <button aria-label="Zoom out" title="Zoom out" disabled={!ready || props.blocked} onClick={() => command('zoom', 'out')}><Minus size={17}/></button>
      <button aria-label="Zoom in" title="Zoom in" disabled={!ready || props.blocked} onClick={() => command('zoom', 'in')}><Plus size={17}/></button>
    </div>
    {!ready && !failure && <div className="phaser-world-notice" role="status">Loading Phaser AE world…</div>}
    {failure && <div className="phaser-world-notice" role="alert">{failure} <button onClick={() => { if (frame.current) frame.current.src = '/world/index.html'; }}>Reload world</button></div>}
    <div className="phaser-world-help">Drag to orbit · Scroll to zoom · Select an agent to open its conversation</div>
  </>;
}
