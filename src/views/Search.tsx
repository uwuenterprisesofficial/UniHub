import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { fmtDate } from '../lib/util';
import { Empty, ModuleSelect, openDialog } from '../components/ui';
import { EventDialog, TaskDialog } from '../components/editors';

interface Hit { kind: string; icon: string; title: string; sub: string; moduleId: string; score: number; go: () => void }

function score(q: string[], title: string, body: string) {
  const t = title.toLowerCase(), b = body.toLowerCase(); let s = 0;
  for (const w of q) {
    const inT = t.includes(w), inB = b.includes(w);
    if (!inT && !inB) return 0;
    s += inT ? (t.startsWith(w) ? 6 : 4) : 1;
  }
  return s;
}

export default function Search() {
  const [sp] = useSearchParams(); const nav = useNavigate();
  const { modules, events, tasks, notes, docs, settings: S } = useStore();
  const q = (sp.get('q') ?? '').trim().toLowerCase();
  const [kind, setKind] = useState('all'); const [mf, setMf] = useState('');
  const words = q.split(/\s+/).filter(Boolean);

  const hits = useMemo<Hit[]>(() => {
    if (!words.length) return [];
    const out: Hit[] = [];
    modules.forEach(m => { const s = score(words, m.name, [m.code, m.lecturer, m.objectives, m.exam].join(' ')); s && out.push({ kind: 'Module', icon: m.icon || '📘', title: m.name, sub: [m.code, m.semester].filter(Boolean).join(' · '), moduleId: m.id, score: s + 2, go: () => nav('/modules/' + m.id) }); });
    events.forEach(e => { const s = score(words, e.title, e.location + ' ' + e.desc); s && out.push({ kind: 'Event', icon: '📅', title: e.title, sub: `${fmtDate(e.date, S.dateFormat)} ${e.start}`, moduleId: e.moduleId, score: s, go: () => openDialog(<EventDialog id={e.id} date={e.date} />) }); });
    tasks.forEach(t => { const s = score(words, t.title, t.desc + ' ' + t.type + ' ' + t.subtasks.map(x => x.t).join(' ')); s && out.push({ kind: 'Task', icon: '☑', title: t.title, sub: t.due ? 'due ' + fmtDate(t.due, S.dateFormat) : t.status, moduleId: t.moduleId, score: s, go: () => openDialog(<TaskDialog id={t.id} />) }); });
    notes.forEach(n => { const s = score(words, n.title, n.body + ' ' + n.tags.join(' ')); s && out.push({ kind: 'Note', icon: '📝', title: n.title, sub: n.tags.map(t => '#' + t).join(' '), moduleId: n.moduleId, score: s, go: () => nav('/notes/' + n.id) }); });
    docs.forEach(d => { const s = score(words, d.name, d.tags.join(' ') + ' ' + d.text); s && out.push({ kind: 'Document', icon: '📄', title: d.name, sub: d.tags.map(t => '#' + t).join(' '), moduleId: d.moduleId, score: s, go: () => nav('/documents/' + d.id) }); });
    return out.sort((a, b) => b.score - a.score);
  }, [q, modules, events, tasks, notes, docs]);

  const shown = hits.filter(h => (kind === 'all' || h.kind === kind) && (!mf || h.moduleId === mf));
  const kinds = ['all', 'Module', 'Event', 'Task', 'Note', 'Document'];
  return <>
    <div className="page-head"><h1>Search{q && <span className="muted"> “{sp.get('q')}”</span>}</h1></div>
    <div className="row" style={{ marginBottom: 16 }}>
      <div className="seg">{kinds.map(k => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'all' ? `All (${hits.length})` : `${k}s (${hits.filter(h => h.kind === k).length})`}</button>)}</div>
      <div style={{ width: 220 }}><ModuleSelect value={mf} onChange={setMf} none="Any module" /></div></div>
    <div className="card">
      {!q ? <Empty>Type in the search box above to find modules, events, tasks, notes and documents (including file contents).</Empty>
        : !shown.length ? <Empty>No results.</Empty>
          : <div className="list">{shown.map((h, i) => <div key={i} className="itm" onClick={h.go}>
            <span style={{ width: 24 }}>{h.icon}</span><div className="grow"><div className="t">{h.title}</div><div className="small muted">{h.kind}{h.sub && ' · ' + h.sub}</div></div>
            {h.moduleId && <span className="chip dot" style={{ ['--c' as string]: modules.find(m => m.id === h.moduleId)?.color }}>{modules.find(m => m.id === h.moduleId)?.code || modules.find(m => m.id === h.moduleId)?.name}</span>}</div>)}</div>}
    </div>
    <p className="small muted">Related items are found through the module chip — click it via <Link to="/modules">Modules</Link> to see everything for that course.</p>
  </>;
}
