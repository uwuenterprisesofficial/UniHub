import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getData, isDone, progressOf, useStore } from '../lib/store';
import type { Module } from '../lib/types';
import { occurrences } from '../lib/schedule';
import { addDays, relDay, today, uid } from '../lib/util';
import { Card, Empty, openDialog } from '../components/ui';
import { DocRow, EventRow, TaskRow } from '../components/rows';
import { EventDialog, ModuleDialog, TaskDialog } from '../components/editors';
import { md } from '../lib/markdown';
import Knowledge from './Knowledge';
import Graph from './Graph';
import { BackLink } from '../components/BackLink';
import { useUrlState } from '../lib/nav';

export function Modules() {
  const nav = useNavigate();
  const { modules, tasks, settings: S } = useStore();
  const [sem, setSem] = useState(S.currentSemester);
  const ms = modules.filter(m => sem === 'all' || m.semester === sem);
  const ects = ms.reduce((a, m) => a + (+m.ects || 0), 0), data = getData();
  return <>
    <div className="page-head"><h1>Modules</h1>
      <div style={{ width: 200 }}><select value={sem} onChange={e => setSem(e.target.value)}><option value="all">All semesters</option>{S.semesters.map(s => <option key={s}>{s}</option>)}</select></div>
      <button className="btn primary" onClick={() => openDialog(<ModuleDialog />)}>＋ New module</button></div>
    {!ms.length ? <div className="card empty">No modules here yet.</div> : <>
      <p className="muted">{ms.length} modules · {ects} ECTS</p>
      <div className="cards">{ms.map(m => {
        const open = tasks.filter(t => t.moduleId === m.id && !isDone(t, S));
        const next = open.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due))[0];
        return <div key={m.id} className="card mcard" style={{ ['--c' as string]: m.color }} onClick={() => nav('/modules/' + m.id)}>
          <h2>{m.icon || '📘'} {m.name}</h2>
          <div className="muted small">{[m.code, m.lecturer, m.ects && m.ects + ' ECTS'].filter(Boolean).join(' · ')}</div>
          <div className="bar" style={{ margin: '12px 0 6px' }}><i style={{ width: progressOf(data, m.id) + '%' }} /></div>
          <div className="small muted">{open.length} open tasks{next && ` · next: ${next.title} (${relDay(next.due)})`}</div>
        </div>;
      })}</div></>}
  </>;
}

function Grades({ m }: { m: Module }) {
  const update = useStore(s => s.update);
  const gs = m.grades, wsum = gs.reduce((a, g) => a + (+g.weight || 0), 0);
  const avg = wsum ? gs.reduce((a, g) => a + (g.max ? g.score / g.max * 100 : 0) * g.weight, 0) / wsum : null;
  const upd = (i: number, p: Partial<Module['grades'][number]>) => update('modules', m.id, { grades: gs.map((g, j) => j === i ? { ...g, ...p } : g) });
  return <Card title="Assessments">
    <div className="list">{gs.map((g, i) => <div key={g.id}>
      <input type="text" style={{ width: 180 }} value={g.name} onChange={e => upd(i, { name: e.target.value })} />
      <span className="small muted">Weight %</span><input type="number" style={{ width: 70 }} value={g.weight} onChange={e => upd(i, { weight: +e.target.value })} />
      <span className="small muted">Score</span><input type="number" style={{ width: 70 }} value={g.score} onChange={e => upd(i, { score: +e.target.value })} />/
      <input type="number" style={{ width: 70 }} value={g.max} onChange={e => upd(i, { max: +e.target.value })} />
      <span className="muted">{g.max ? Math.round(g.score / g.max * 100) : 0}%</span>
      <button className="icon-btn" onClick={() => update('modules', m.id, { grades: gs.filter((_, j) => j !== i) })}>✕</button></div>)}</div>
    {!gs.length && <Empty>No assessment results recorded.</Empty>}
    <div className="row" style={{ marginTop: 8 }}>
      <button className="btn sm" onClick={() => update('modules', m.id, { grades: [...gs, { id: uid(), name: 'Assessment', weight: 0, score: 0, max: 100 }] })}>＋ Add assessment</button>
      {avg != null && <strong>Weighted result so far: {avg.toFixed(1)}%{wsum < 100 && ` (covers ${wsum}% of the grade)`}</strong>}</div>
  </Card>;
}

const TABS = { overview: 'Overview', tasks: 'Tasks', docs: 'Documents', notes: 'Notes', glossary: 'Glossary', quotes: 'Quotes', knowledge: 'Knowledge', graph: 'Graph', grades: 'Grades' } as const;
export function ModuleDetail() {
  const { id = '' } = useParams(); const nav = useNavigate();
  const { modules, tasks, docs, notes, events, terms, quotes, add, settings: S } = useStore();
  const [tab, setTab] = useUrlState<keyof typeof TABS>('tab', 'overview', Object.keys(TABS) as (keyof typeof TABS)[]);
  const m = modules.find(x => x.id === id); const data = getData();
  if (!m) return <div className="card empty">Module not found.</div>;
  const t = today(), mt = tasks.filter(x => x.moduleId === id), md_ = docs.filter(x => x.moduleId === id), mn = notes.filter(x => x.moduleId === id);
  const info: [string, React.ReactNode][] = [['Lecturer', m.lecturer], ['Contact', m.email && <a href={'mailto:' + m.email}>{m.email}</a>], ['Room', m.room], ['Course link', m.link && <a href={m.link} target="_blank" rel="noopener">{m.link}</a>], ['Exam & grading', m.exam]];
  const next = occurrences(events, t, addDays(t, 120)).filter(o => o.ev.moduleId === id).slice(0, 6);
  const p = progressOf(data, id);
  return <>
    <div className="page-head"><div><BackLink fallback="/modules" label="Modules" /><h1 style={{ color: m.color }}>{m.icon || '📘'} {m.name}</h1>
      <div className="muted">{[m.code, m.semester, m.ects && m.ects + ' ECTS'].filter(Boolean).join(' · ')}</div></div>
      <Link className="btn primary" to={'/modules/' + id + '/workspace'}>📓 Lecture workspace</Link>
      <button className="btn" onClick={() => openDialog(<ModuleDialog id={id} />)}>✎ Edit</button></div>
    <div className="tabs">{(Object.keys(TABS) as (keyof typeof TABS)[]).map(k => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{TABS[k]}</button>)}</div>
    {tab === 'overview' && <div className="dash">
      <Card title="Module information"><div className="list">{info.filter(i => i[1]).map(([k, v]) => <div key={k}><span className="muted" style={{ width: 110 }}>{k}</span><span className="grow">{v}</span></div>)}</div>
        {m.objectives && <><div className="sec-title">Objectives &amp; requirements</div><div className="md" dangerouslySetInnerHTML={{ __html: md(m.objectives, notes) }} /></>}</Card>
      <Card title="Schedule"><div className="list">{next.map(o => <EventRow key={o.ev.id + o.date} o={o} />)}</div>
        {!events.some(e => e.moduleId === id) && <Empty>No appointments linked yet.</Empty>}
        <button className="btn sm" onClick={() => openDialog(<EventDialog date={t} preset={{ moduleId: id }} />)}>＋ Add appointment</button></Card>
      <Card title={`Progress · ${p}%`}><div className="bar" style={{ ['--c' as string]: m.color }}><i style={{ width: p + '%' }} /></div>
        <p className="small muted">{mt.filter(x => isDone(x, S)).length} of {mt.length} tasks completed · {md_.length} documents · {mn.length} notes</p>
        <div className="list">{mt.filter(x => !isDone(x, S)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 5).map(x => <TaskRow key={x.id} t={x} />)}</div></Card>
    </div>}
    {tab === 'tasks' && <Card><div className="row" style={{ marginBottom: 8 }}><button className="btn primary sm" onClick={() => openDialog(<TaskDialog preset={{ moduleId: id }} />)}>＋ Task</button></div>
      <div className="list">{[...mt].sort((a, b) => +isDone(a, S) - +isDone(b, S) || (a.due || '9').localeCompare(b.due || '9')).map(x => <TaskRow key={x.id} t={x} />)}</div>{!mt.length && <Empty>No tasks.</Empty>}</Card>}
    {tab === 'docs' && <Card><div className="list">{md_.map(d => <DocRow key={d.id} d={d} />)}</div>{!md_.length && <Empty>No documents assigned. Upload files in the Documents library and assign them to this module.</Empty>}</Card>}
    {tab === 'notes' && <Card><div className="row" style={{ marginBottom: 8 }}><button className="btn sm primary" onClick={() => { const n = add('notes', { title: 'Untitled note', body: '', moduleId: id, tags: [], pinned: false, updated: Date.now() }); nav('/notes/' + n.id); }}>＋ Note</button></div>
      <div className="list">{mn.map(n => <div key={n.id} className="itm" onClick={() => nav('/notes/' + n.id)}><div className="grow t">{n.pinned ? '📌 ' : ''}{n.title}</div></div>)}</div>{!mn.length && <Empty>No notes.</Empty>}</Card>}
    {tab === 'glossary' && <Card extra={<Link to="/glossary">Open full glossary →</Link>} title="Glossary">
      <div className="list">{terms.filter(x => x.moduleId === id && x.status === 'confirmed').sort((a, b) => a.term.localeCompare(b.term)).map(x => <div key={x.id} className="itm" onClick={() => nav('/glossary/' + x.id)}><div className="grow"><div className="t"><b>{x.term}</b></div><div className="small muted">{x.definition.slice(0, 140)}</div></div></div>)}</div>
      {!terms.some(x => x.moduleId === id && x.status === 'confirmed') && <Empty>No glossary terms for this module yet. Annotate documents or scan them in the Glossary.</Empty>}</Card>}
    {tab === 'quotes' && <Card title="Quotes"><div className="list">{quotes.filter(x => x.moduleId === id && x.status === 'saved').map(x => <div key={x.id}><div className="grow">“{x.text}”</div></div>)}</div>
      {!quotes.some(x => x.moduleId === id && x.status === 'saved') && <Empty>No saved quotes for this module.</Empty>}</Card>}
    {tab === 'knowledge' && <Knowledge embedded context={{ moduleId: id }} />}
    {tab === 'graph' && <Graph embedded moduleId={id} />}
    {tab === 'grades' && <Grades m={m} />}
  </>;
}
