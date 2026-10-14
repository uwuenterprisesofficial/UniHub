import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { getData, useStore } from '../lib/store';
import { EDGE_LABEL, TYPE_META, buildGraph, insights, neighborhood, other, shortestPath, type GEdge, type GNode, type NodeType } from '../lib/graph';
import { useVecStatus } from '../lib/embed';
import { useIndex, useVectorSync } from '../lib/useIndex';
import { download } from '../lib/util';
import { Card, Empty } from '../components/ui';
import { ScopePicker } from '../components/ScopePicker';
import { useUrlParams } from '../lib/nav';
import { nodeInfo } from '../lib/nodeinfo';
import { linkTerms, md } from '../lib/markdown';
import { useTexts } from '../lib/blobs';
import type { Scope } from '../lib/kb';
import { SemanticStatus } from '../components/Semantic';

const DEFAULT_TYPES: NodeType[] = ['module', 'session', 'doc', 'note', 'term', 'quote', 'source', 'project', 'chapter'];
const MAX_NODES = 350;
interface Pos extends SimulationNodeDatum { id: string }
const radius = (n: GNode) => (n.type === 'module' ? 11 : 5) + Math.min(10, Math.sqrt(n.degree) * 1.8);

/** `moduleId` / `sessionId` pin the graph to a module or a lecture day (used inside the module page and the lecture workspace). */
export default function Graph({ moduleId, sessionId, embedded }: { moduleId?: string; sessionId?: string; embedded?: boolean }) {
  const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const idx = useIndex(); useVectorSync(idx);
  const count = useVecStatus(s => s.count); const { modules } = useStore();
  const g = useMemo(() => buildGraph(getData(), idx), [idx, count]); // eslint-disable-line react-hooks/exhaustive-deps
  const insight = useMemo(() => insights(g), [g]);

  const [types, setTypes] = useState<Set<NodeType>>(new Set(DEFAULT_TYPES));
  const [scope, setScope] = useState<Scope>({ moduleId: moduleId ?? (sp.get('module') || undefined), sessionId: sessionId ?? (sp.get('session') || undefined) });
  const mf = scope.moduleId ?? ''; const texts = useTexts(x => x.map);
  const [minW, setMinW] = useState(0); const [depth, setDepthState] = useState(Number(sp.get('hop')) || 0);
  const setDepth = (d: number) => { setDepthState(d); setUrl({ hop: d ? String(d) : undefined }); };
  const setUrl = useUrlParams(); const [sel, setSel] = useState<string>(sp.get('focus') ?? ''); const [hover, setHover] = useState('');
  const [find, setFind] = useState(''); const [pathQ, setPathQ] = useState(''); const [target, setTarget] = useState('');
  useEffect(() => { const f = sp.get('focus'); if (f && g.byId.has(f)) setSel(f); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [g]);

  const path = useMemo(() => sel && target ? shortestPath(g, sel, target) : null, [g, sel, target]);
  const pathNodes = new Set(path?.nodes ?? []), pathEdges = new Set((path?.edges ?? []).map(e => e.s + '|' + e.t + '|' + e.type));

  /* which nodes and edges are shown */
  const view = useMemo(() => {
    let ids = new Set(g.nodes.filter(n => types.has(n.type)).map(n => n.id));
    const sessNode = scope.sessionId ? 'sess:' + scope.sessionId : '';
    if (sessNode && g.byId.has(sessNode)) {
      // a lecture day: the lecture, its notes and documents, and the concepts, highlights and quotes connected to them
      const nb = neighborhood(g, sessNode, 2, n => n.type !== 'module' && n.type !== 'term'); nb.add(sessNode); // modules and concepts are shown but are not expanded: they touch material from the whole course
      ids = new Set([...ids, sessNode].filter(i => nb.has(i)));
    } else if (mf) {
      const base = new Set(g.nodes.filter(n => n.moduleId === mf).map(n => n.id));
      const keep = new Set(base); base.forEach(b => (g.adj.get(b) ?? []).forEach(e => keep.add(other(e, b))));
      ids = new Set([...ids].filter(i => keep.has(i)));
    }
    if (sel && depth > 0) { const nb = neighborhood(g, sel, depth); ids = new Set([...ids].filter(i => nb.has(i))); }
    pathNodes.forEach(i => ids.add(i)); if (sel) ids.add(sel);
    const edges = g.edges.filter(e => ids.has(e.s) && ids.has(e.t) && (e.w >= minW || pathEdges.has(e.s + '|' + e.t + '|' + e.type)));
    const deg = new Map<string, number>(); edges.forEach(e => { deg.set(e.s, (deg.get(e.s) ?? 0) + 1); deg.set(e.t, (deg.get(e.t) ?? 0) + 1); });
    let nodes = g.nodes.filter(n => ids.has(n.id) && (deg.get(n.id) || n.id === sel));
    let capped = false; if (nodes.length > MAX_NODES) { nodes = [...nodes].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0)).slice(0, MAX_NODES); capped = true; }
    const keep = new Set(nodes.map(n => n.id));
    return { nodes, edges: edges.filter(e => keep.has(e.s) && keep.has(e.t)), capped };
  }, [g, types, mf, scope.sessionId, minW, depth, sel, path]); // eslint-disable-line react-hooks/exhaustive-deps

  /* force layout, computed once per node/edge set */
  const pos = useMemo(() => {
    const ns: Pos[] = view.nodes.map(n => ({ id: n.id }));
    const links: SimulationLinkDatum<Pos>[] = view.edges.map(e => ({ source: e.s, target: e.t, w: e.w } as SimulationLinkDatum<Pos>));
    const sim = forceSimulation<Pos>(ns).force('link', forceLink<Pos, SimulationLinkDatum<Pos>>(links).id(d => d.id).distance(l => 80 - Math.min(3, (l as unknown as { w: number }).w) * 8).strength(0.5))
      .force('charge', forceManyBody<Pos>().strength(d => g.byId.get(d.id)?.type === 'module' ? -320 : -130)).force('center', forceCenter(0, 0))
      .force('collide', forceCollide<Pos>(d => radius(g.byId.get(d.id)!) + 4)).force('x', forceX(0).strength(0.05)).force('y', forceY(0).strength(0.05)).stop();
    for (let i = 0; i < 320; i++) sim.tick();
    return new Map(ns.map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
  }, [view, g]);

  /* pan & zoom */
  const svgRef = useRef<SVGSVGElement>(null); const [tf, setTf] = useState({ x: 0, y: 0, k: 1 }); const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => { // fit the drawing into the view whenever the layout changes
    const xs = [...pos.values()].map(p => p.x), ys = [...pos.values()].map(p => p.y); const el = svgRef.current; if (!xs.length || !el) return;
    const w = el.clientWidth, h = el.clientHeight, bw = Math.max(...xs) - Math.min(...xs) + 120, bh = Math.max(...ys) - Math.min(...ys) + 120;
    const k = Math.min(1.6, w / bw, h / bh); setTf({ k, x: w / 2 - k * (Math.max(...xs) + Math.min(...xs)) / 2, y: h / 2 - k * (Math.max(...ys) + Math.min(...ys)) / 2 });
  }, [pos]);
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      setTf(t => { const k = Math.min(4, Math.max(0.15, t.k * f)); return { k, x: mx - (mx - t.x) * (k / t.k), y: my - (my - t.y) * (k / t.k) }; }); };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, []);

  const focusSet = useMemo(() => { if (!sel) return null; const s = new Set([sel]); (g.adj.get(sel) ?? []).forEach(e => s.add(other(e, sel))); return s; }, [g, sel]);
  const node = sel ? g.byId.get(sel) : undefined;
  const conns = useMemo(() => { if (!sel) return []; const m = new Map<string, { e: GEdge; n: GNode }[]>(); (g.adj.get(sel) ?? []).forEach(e => { const n = g.byId.get(other(e, sel))!; const k = EDGE_LABEL[e.type]; m.set(k, [...(m.get(k) ?? []), { e, n }]); }); return [...m]; }, [g, sel]);
  const matches = (q: string) => q.trim() ? g.nodes.filter(n => n.label.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.degree - a.degree).slice(0, 7) : [];
  const select = (id: string) => { setSel(id); setTarget(''); setPathQ(''); setUrl({ focus: id || undefined }); };
  const changeScope = (s: Scope) => { setScope(s); if (s.sessionId) setTypes(t => new Set([...t, 'annotation', 'quote'])); if (!embedded) setUrl({ module: s.moduleId, session: s.sessionId, focus: undefined }); };
  const notes = useStore(s => s.notes), confirmedTerms = useStore(s => s.terms).filter(t => t.status === 'confirmed');
  const info = useMemo(() => sel ? nodeInfo(getData(), texts, sel, idx) : null, [sel, texts, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const typeCounts = useMemo(() => { const m = new Map<NodeType, number>(); g.nodes.forEach(n => m.set(n.type, (m.get(n.type) ?? 0) + 1)); return m; }, [g]);
  const showLabel = (n: GNode) => view.nodes.length <= 60 || n.degree >= 4 || n.id === sel || n.id === hover || !!focusSet?.has(n.id) || pathNodes.has(n.id) || n.type === 'module';

  return <>
    {!embedded && <div className="page-head"><div><h1>Knowledge graph</h1><div className="muted">{g.nodes.length.toLocaleString()} items and {g.edges.length.toLocaleString()} connections across your modules, documents, notes, concepts, quotes and thesis.</div></div>
      <Link className="btn" to="/knowledge">🔎 Knowledge base</Link>
      <button className="btn" onClick={() => download('unihub-graph.json', JSON.stringify({ nodes: g.nodes, edges: g.edges }, null, 2), 'application/json')}>⬇ Export</button></div>}
    <div className="row" style={{ marginBottom: 10 }}><SemanticStatus /></div>
    <div className="row" style={{ marginBottom: 12, gap: 6 }}>
      {(Object.keys(TYPE_META) as NodeType[]).filter(t => typeCounts.get(t)).map(t => <button key={t} className={'btn sm' + (types.has(t) ? ' primary' : '')} style={types.has(t) ? { background: TYPE_META[t].color, borderColor: TYPE_META[t].color } : {}}
        onClick={() => { const n = new Set(types); n.has(t) ? n.delete(t) : n.add(t); setTypes(n); }}>{TYPE_META[t].icon} {TYPE_META[t].label} {typeCounts.get(t)}</button>)}
      <ScopePicker scope={scope} onChange={changeScope} context={moduleId ? { moduleId, sessionId } : undefined} />
      <label className="small" title="Hide weak connections">min. strength <input type="range" min={0} max={4} step={0.5} value={minW} onChange={e => setMinW(+e.target.value)} style={{ width: 80, verticalAlign: 'middle' }} /></label>
      {sel && <div className="seg">{[0, 1, 2].map(d => <button key={d} className={depth === d ? 'on' : ''} onClick={() => setDepth(d)}>{d === 0 ? 'All' : d + ' hop' + (d > 1 ? 's' : '')}</button>)}</div>}
    </div>

    <div className="graph-wrap">
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} className="graph-svg" role="img" aria-label="Knowledge graph"
          onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
          onPointerMove={e => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; if (d.moved) { setTf(t => ({ ...t, x: t.x + dx, y: t.y + dy })); d.x = e.clientX; d.y = e.clientY; } }}
          onPointerUp={() => { if (drag.current && !drag.current.moved) select(''); drag.current = null; }}>
          <g transform={`translate(${tf.x},${tf.y}) scale(${tf.k})`}>
            {view.edges.map(e => {
              const a = pos.get(e.s), b = pos.get(e.t); if (!a || !b) return null;
              const onPath = pathEdges.has(e.s + '|' + e.t + '|' + e.type), near = !focusSet || (focusSet.has(e.s) && focusSet.has(e.t) && (e.s === sel || e.t === sel));
              return <line key={e.s + e.t + e.type} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={onPath ? 'var(--accent)' : e.type === 'related_to' ? '#a855f7' : e.type === 'similar' || e.type === 'shares_concepts' ? '#0891b2' : 'var(--muted)'}
                strokeWidth={onPath ? 3.5 : Math.min(3, 0.8 + e.w * 0.25)} strokeDasharray={e.type === 'similar' || e.type === 'shares_concepts' ? '4 3' : undefined} opacity={onPath ? 1 : near ? 0.5 : 0.07}><title>{EDGE_LABEL[e.type]}</title></line>;
            })}
            {view.nodes.map(n => {
              const p = pos.get(n.id); if (!p) return null; const r = radius(n), dim = focusSet && !focusSet.has(n.id) && !pathNodes.has(n.id);
              return <g key={n.id} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.12 : 1} style={{ cursor: 'pointer' }}
                onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); select(n.id); }} onDoubleClick={() => nav(n.to)}
                onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover('')}>
                <circle r={r} fill={TYPE_META[n.type].color} stroke={n.id === sel ? 'var(--text)' : pathNodes.has(n.id) ? 'var(--accent)' : 'var(--panel)'} strokeWidth={n.id === sel || pathNodes.has(n.id) ? 3 : 1.5} />
                {showLabel(n) && <text y={r + 12} textAnchor="middle">{n.label}</text>}
                <title>{TYPE_META[n.type].label.replace(/s$/, '')}: {n.label}</title>
              </g>;
            })}
          </g>
        </svg>
        {!view.nodes.length && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><Empty>Nothing to show. Add documents, notes and glossary terms — or enable more item types above.</Empty></div>}
        <div className="small muted" style={{ marginTop: 6 }}>Scroll to zoom · drag to pan · click an item to inspect · double-click to open{view.capped && ` · showing the ${MAX_NODES} best-connected items (filter to see more)`}</div>
      </div>

      <aside className="graph-side">
        <Card title="Find an item">
          <input type="search" placeholder="Search items…" value={find} onChange={e => setFind(e.target.value)} />
          {matches(find).map(n => <div key={n.id} className="itm" style={{ padding: '4px 0' }} onClick={() => { select(n.id); setFind(''); }}><span style={{ color: TYPE_META[n.type].color }}>{TYPE_META[n.type].icon}</span> {n.label}</div>)}
        </Card>
        <div style={{ height: 12 }} />
        {node ? <Card title={<span style={{ overflowWrap: 'anywhere' }}>{TYPE_META[node.type].icon} {node.label}</span>}>
          <div className="small muted">{TYPE_META[node.type].label.replace(/s$/, '')}{node.moduleId && <> · {modules.find(m => m.id === node.moduleId)?.name}</>} · {node.degree} connections</div>
          {info?.subtitle && <div className="small" style={{ marginTop: 4 }}>{info.subtitle}</div>}
          {info?.body && <div className="md ginfo" dangerouslySetInnerHTML={{ __html: linkTerms(md(info.body, notes), confirmedTerms) }} />}
          {info?.points && info.points.length > 0 && <><div className="sec-title">Key points</div><ul className="sumlist">{info.points.map((p, i) => <li key={i} style={{ cursor: 'default' }}>{p}</li>)}</ul></>}
          {info && info.facts.length > 0 && <table className="facts"><tbody>{info.facts.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>}
          <div className="row" style={{ margin: '8px 0' }}>
            {(info?.links ?? [{ label: 'Open', to: node.to }]).map((l, i) => <button key={l.to} className={'btn sm' + (i === 0 ? ' primary' : '')} onClick={() => nav(l.to)}>{l.label}</button>)}
            {!info?.links.some(l => l.to.startsWith('/knowledge')) && <button className="btn sm" onClick={() => nav('/knowledge?q=' + encodeURIComponent(node.label.replace(/^“/, '')) + (scope.moduleId ? '&module=' + scope.moduleId : '') + (scope.sessionId ? '&session=' + scope.sessionId : ''))}>Ask about this</button>}
            <button className="btn sm" onClick={() => setDepth(depth === 1 ? 0 : 1)}>{depth === 1 ? 'Show all' : 'Focus'}</button></div>
          <div className="sec-title" style={{ marginTop: 8 }}>How is it connected to…</div>
          <input type="search" placeholder="Another item…" value={pathQ} onChange={e => setPathQ(e.target.value)} />
          {matches(pathQ).filter(n => n.id !== sel).map(n => <div key={n.id} className="itm" style={{ padding: '4px 0' }} onClick={() => { setTarget(n.id); setPathQ(''); }}>{TYPE_META[n.type].icon} {n.label}</div>)}
          {target && <div className="small" style={{ marginTop: 6 }}>
            {path ? <><b>{path.edges.length} step{path.edges.length === 1 ? '' : 's'}:</b>
              {path.nodes.map((id, i) => <div key={id}>{i > 0 && <span className="muted">↳ {EDGE_LABEL[path.edges[i - 1].type]}</span>}<div className="itm" onClick={() => select(id)}>{TYPE_META[g.byId.get(id)!.type].icon} {g.byId.get(id)!.label}</div></div>)}</>
              : <span className="soon">No connection found between these items.</span>}
            <button className="btn sm ghost" onClick={() => setTarget('')}>clear path</button></div>}
          {conns.map(([label, items]) => <div key={label}><div className="sec-title">{label} · {items.length}</div>
            {items.slice(0, 8).map(({ n }) => <div key={n.id} className="itm small" style={{ padding: '2px 0' }} onClick={() => select(n.id)}><span style={{ color: TYPE_META[n.type].color }}>{TYPE_META[n.type].icon}</span> {n.label}</div>)}
            {items.length > 8 && <div className="small muted">+{items.length - 8} more</div>}</div>)}
        </Card> : <Card title="Insights">
          {g.nodes.length === 0 ? <Empty>The graph builds itself from your material.</Empty> : <>
            <div className="sec-title" style={{ marginTop: 0 }}>Central concepts</div>
            {insight.hubs.map(n => <div key={n.id} className="itm small" onClick={() => select(n.id)}>📖 {n.label} <span className="muted">· {n.degree}</span></div>)}
            {!insight.hubs.length && <div className="small muted">Confirm glossary terms to see central concepts.</div>}
            {insight.bridges.length > 0 && <><div className="sec-title">Concepts spanning modules</div>
              {insight.bridges.map(({ t, mods }) => <div key={t.id} className="itm small" onClick={() => select(t.id)}>🔗 {t.label} <span className="muted">· {[...mods].map(m => modules.find(x => x.id === m)?.code || modules.find(x => x.id === m)?.name).join(', ')}</span></div>)}</>}
            {insight.orphans.length > 0 && <><div className="sec-title">Not yet connected to any concept ({insight.orphans.length})</div>
              {insight.orphans.slice(0, 6).map(n => <div key={n.id} className="itm small" onClick={() => nav(n.to)}>{TYPE_META[n.type].icon} {n.label}</div>)}
              <div className="small muted">Scan them for terms in the Glossary to link them in.</div></>}
          </>}
        </Card>}
      </aside>
    </div>
  </>;
}
