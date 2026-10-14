import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import type { Chapter, Project, Ref } from '../lib/types';
import { blankRef, formatCitation, missingFields, parseBibtex, parseRis, toBibtex, toRis, type RefDraft } from '../lib/bib';
import { diffDays, download, fmtDate, today, uid } from '../lib/util';
import { Card, Empty, Field, Modal, confirmBox, openDialog, toast } from '../components/ui';
import { BackLink } from '../components/BackLink';
import { useUrlState } from '../lib/nav';

const CH_STATUS: Chapter['status'][] = ['todo', 'research', 'drafting', 'review', 'done'];
const chProgress = (c: Chapter) => ({ todo: 0, research: .2, drafting: .5, review: .8, done: 1 })[c.status];
const progressOf = (p: Project) => p.chapters.length ? Math.round(p.chapters.reduce((a, c) => a + chProgress(c), 0) / p.chapters.length * 100) : 0;
/** Planned progress = share of the time span between the first milestone (or today-90d) and the deadline that has elapsed. */
function planned(p: Project) {
  if (!p.deadline) return 0;
  const start = p.milestones.map(m => m.date).filter(Boolean).sort()[0] ?? '';
  const span = start ? diffDays(p.deadline, start) : 0; if (span <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(diffDays(today(), start) / span * 100)));
}

export function ThesisList() {
  const nav = useNavigate(); const { projects, add } = useStore();
  return <>
    <div className="page-head"><h1>Thesis & projects</h1>
      <button className="btn primary" onClick={() => {
        const p = add('projects', { title: 'My thesis', description: '', question: '', scope: '', supervisor: '', supervisorEmail: '', deadline: '', requirements: '', style: 'APA', openQuestions: '', feedback: [], milestones: [],
          chapters: ['Introduction', 'Literature review', 'Methodology', 'Results', 'Discussion', 'Conclusion'].map(title => ({ id: uid(), title, status: 'todo' as const, words: 0, target: 0, notes: '' })) });
        nav('/thesis/' + p.id);
      }}>＋ New project</button></div>
    {!projects.length ? <div className="card empty">Create a project to organise chapters, sources and milestones for a thesis or research paper.</div>
      : <div className="cards">{projects.map(p => <div key={p.id} className="card mcard" style={{ ['--c' as string]: 'var(--accent)' }} onClick={() => nav('/thesis/' + p.id)}>
        <h2>🎓 {p.title}</h2><div className="muted small">{p.deadline ? `Due ${fmtDate(p.deadline)} (${diffDays(p.deadline, today())} days)` : 'No deadline set'}</div>
        <div className="bar" style={{ margin: '10px 0 4px' }}><i style={{ width: progressOf(p) + '%' }} /></div><div className="small muted">{progressOf(p)}% written · planned {planned(p)}%</div></div>)}</div>}
  </>;
}

function RefDialog({ projectId, id }: { projectId: string; id?: string }) {
  const { refs, projects, add, update, remove, docs } = useStore();
  const ex = refs.find(r => r.id === id);
  const proj = projects.find(p => p.id === projectId)!;
  const [d, setD] = useState<RefDraft>(ex ?? blankRef());
  const f = (k: keyof RefDraft, label: string, type = 'text') => <Field label={label}><input type={type} value={String(d[k])} onChange={e => setD({ ...d, [k]: e.target.value })} /></Field>;
  const miss = missingFields(d);
  return <Modal title={id ? 'Edit source' : 'New source'} wide buttons={[
    ...(id ? [{ label: 'Delete', cls: 'danger left', keepOpen: true, onClick: () => confirmBox('Delete this source?', () => remove('refs', id)) }] : []),
    { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: () => { if (!d.title.trim()) { toast('Title is required'); return false; } id ? update('refs', id, d) : add('refs', { ...d, projectId }); } }]}>
    <div className="grid3"><Field label="Type"><select value={d.type} onChange={e => setD({ ...d, type: e.target.value as Ref['type'] })}><option value="article">Article</option><option value="book">Book</option><option value="inproceedings">Conference paper</option><option value="misc">Other</option></select></Field>
      {f('key', 'Citation key')}{f('year', 'Year')}</div>
    {f('authors', 'Authors (Last, First and Last, First)')}{f('title', 'Title *')}
    <div className="grid3">{f('journal', 'Journal / booktitle')}{f('volume', 'Volume')}{f('pages', 'Pages')}</div>
    <div className="grid3">{f('publisher', 'Publisher')}{f('doi', 'DOI')}{f('url', 'URL', 'url')}</div>
    <div className="grid3">
      <Field label="Topic / theme"><input type="text" value={d.topic} onChange={e => setD({ ...d, topic: e.target.value })} /></Field>
      <Field label="Reading status"><select value={d.status} onChange={e => setD({ ...d, status: e.target.value as Ref['status'] })}><option value="to-read">To read</option><option value="reading">Reading</option><option value="read">Read</option></select></Field>
      <Field label="Linked chapter"><select value={d.chapterId} onChange={e => setD({ ...d, chapterId: e.target.value })}><option value="">—</option>{proj.chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field></div>
    <Field label="Source document"><select value={d.docId} onChange={e => setD({ ...d, docId: e.target.value })}><option value="">—</option>{docs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    <Field label="Findings & quotations (include page numbers)"><textarea value={d.quotes} onChange={e => setD({ ...d, quotes: e.target.value })} /></Field>
    {miss.length > 0 && <p className="small soon">⚠ Incomplete metadata: {miss.join(', ')}</p>}
  </Modal>;
}

function Literature({ p }: { p: Project }) {
  const { refs, docs, add, update } = useStore(); const nav = useNavigate(); const fileRef = useRef<HTMLInputElement>(null);
  const mine = refs.filter(r => r.projectId === p.id);
  const [topic, setTopic] = useState(''), [style, setStyle] = useState(p.style);
  const topics = [...new Set(mine.map(r => r.topic).filter(Boolean))];
  const list = mine.filter(r => !topic || r.topic === topic).sort((a, b) => a.authors.localeCompare(b.authors));
  const imp = async (f?: File) => {
    if (!f) return; const txt = await f.text();
    const items = /^\s*TY\s+-/m.test(txt) ? parseRis(txt) : parseBibtex(txt);
    items.forEach(r => add('refs', { ...r, projectId: p.id })); toast(`Imported ${items.length} reference(s)`);
  };
  const read = mine.filter(r => r.status === 'read').length;
  return <>
    <div className="row" style={{ marginBottom: 12 }}>
      <button className="btn primary" onClick={() => openDialog(<RefDialog projectId={p.id} />)}>＋ Source</button>
      <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import BibTeX / RIS</button>
      <input ref={fileRef} type="file" accept=".bib,.ris,.txt" hidden onChange={e => { imp(e.target.files?.[0]); e.target.value = ''; }} />
      <button className="btn" onClick={() => download('references.bib', toBibtex(mine))}>⬇ BibTeX</button>
      <button className="btn" onClick={() => download('references.ris', toRis(mine))}>⬇ RIS</button>
      <select style={{ width: 160 }} value={topic} onChange={e => setTopic(e.target.value)}><option value="">All topics</option>{topics.map(t => <option key={t}>{t}</option>)}</select>
      <span className="muted small">Literature review: {read}/{mine.length} read</span></div>
    <Card>{list.length ? <div className="list">{list.map(r => {
      const miss = missingFields(r), doc = docs.find(x => x.id === r.docId);
      return <div key={r.id}><div className="grow itm" onClick={() => openDialog(<RefDialog projectId={p.id} id={r.id} />)}>
        <div className="t" style={{ whiteSpace: 'normal' }}>{r.title}</div>
        <div className="small muted">{r.authors || 'Unknown author'} · {r.year || 'n.d.'}{r.topic && ` · ${r.topic}`}{miss.length > 0 && <span className="soon"> · ⚠ missing {miss.join(', ')}</span>}</div></div>
        {doc && <button className="btn sm" onClick={() => nav('/documents/' + doc.id)}>📄 PDF</button>}
        <select style={{ width: 100 }} value={r.status} onChange={e => update('refs', r.id, { status: e.target.value as Ref['status'] })}><option value="to-read">To read</option><option value="reading">Reading</option><option value="read">Read</option></select></div>;
    })}</div> : <Empty>No sources yet.</Empty>}</Card>
    {mine.length > 0 && <Card title="Bibliography" extra={<select value={style} onChange={e => setStyle(e.target.value as Project['style'])}><option>APA</option><option>IEEE</option><option>Chicago</option></select>}>
      <div style={{ marginTop: 12 }}>{[...mine].sort((a, b) => style === 'IEEE' ? 0 : a.authors.localeCompare(b.authors)).map((r, i) => <p key={r.id} style={{ margin: '0 0 8px', paddingLeft: 24, textIndent: -24 }}>{formatCitation(r, style, i + 1)}</p>)}</div>
      <button className="btn sm" onClick={() => navigator.clipboard.writeText([...mine].sort((a, b) => style === 'IEEE' ? 0 : a.authors.localeCompare(b.authors)).map((r, i) => formatCitation(r, style, i + 1)).join('\n\n')).then(() => toast('Copied'))}>Copy bibliography</button></Card>}
  </>;
}

export function ThesisDetail() {
  const { id = '' } = useParams(); const nav = useNavigate();
  const { projects, refs, update, remove, add } = useStore();
  const p = projects.find(x => x.id === id); const [tab, setTab] = useUrlState<'overview' | 'chapters' | 'plan' | 'lit' | 'feedback'>('tab', 'overview', ['overview', 'chapters', 'plan', 'lit', 'feedback']);
  if (!p) return <div className="card empty">Project not found. <Link to="/thesis">Back</Link></div>;
  const up = (patch: Partial<Project>) => update('projects', id, patch);
  const inp = (k: keyof Project, label: string, type = 'text') => <Field label={label}><input type={type} value={String(p[k] ?? '')} onChange={e => up({ [k]: e.target.value } as Partial<Project>)} /></Field>;
  const setCh = (cid: string, patch: Partial<Chapter>) => up({ chapters: p.chapters.map(c => c.id === cid ? { ...c, ...patch } : c) });
  const words = p.chapters.reduce((a, c) => a + c.words, 0), target = p.chapters.reduce((a, c) => a + c.target, 0);
  const prog = progressOf(p), plan = planned(p);
  const TABS = { overview: 'Setup', chapters: 'Chapters', plan: 'Milestones', lit: `Literature (${refs.filter(r => r.projectId === id).length})`, feedback: 'Feedback & questions' };
  return <>
    <div className="page-head"><div><BackLink fallback="/thesis" label="Projects" /><h1>🎓 {p.title}</h1>
      <div className="muted">{p.deadline ? `Due ${fmtDate(p.deadline)} · ${diffDays(p.deadline, today())} days left` : 'No deadline'} · {words.toLocaleString()}{target ? ` / ${target.toLocaleString()}` : ''} words</div></div>
      <button className="btn danger" onClick={() => confirmBox('Delete this project and its sources?', () => { refs.filter(r => r.projectId === id).forEach(r => remove('refs', r.id)); remove('projects', id); nav('/thesis'); })}>Delete</button></div>
    <Card><div className="row small" style={{ justifyContent: 'space-between' }}><span>Actual progress {prog}%</span><span className={prog < plan - 10 ? 'overdue' : 'muted'}>Planned {plan}% {prog < plan - 10 && '· behind schedule'}</span></div>
      <div className="bar" style={{ marginTop: 4, position: 'relative' }}><i style={{ width: prog + '%' }} /></div>
      <div className="bar" style={{ marginTop: 4, height: 3 }}><i style={{ width: plan + '%', background: 'var(--muted)' }} /></div></Card>
    <div className="tabs" style={{ marginTop: 16 }}>{(Object.entries(TABS) as [keyof typeof TABS, string][]).map(([k, v]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{v}</button>)}</div>

    {tab === 'overview' && <div className="dash">
      <Card title="Project">{inp('title', 'Title')}<Field label="Description"><textarea value={p.description} onChange={e => up({ description: e.target.value })} /></Field>
        <Field label="Research question"><textarea value={p.question} onChange={e => up({ question: e.target.value })} /></Field>
        <Field label="Objectives & scope"><textarea value={p.scope} onChange={e => up({ scope: e.target.value })} /></Field></Card>
      <Card title="Supervision & submission">{inp('supervisor', 'Supervisor')}{inp('supervisorEmail', 'Supervisor email', 'email')}{inp('deadline', 'Submission deadline', 'date')}
        <Field label="Citation style"><select value={p.style} onChange={e => up({ style: e.target.value as Project['style'] })}><option>APA</option><option>IEEE</option><option>Chicago</option></select></Field>
        <Field label="Formatting & submission requirements"><textarea value={p.requirements} onChange={e => up({ requirements: e.target.value })} /></Field>
        <button className="btn sm" onClick={() => { add('events', { title: `Supervisor meeting: ${p.title}`, type: 'office', moduleId: '', date: today(), start: '10:00', end: '11:00', location: '', desc: '', repeat: 'none', until: '', exceptions: [], reminder: 60 }); toast('Appointment added to calendar for today; edit it there'); }}>＋ Supervisor meeting</button></Card>
    </div>}

    {tab === 'chapters' && <Card title="Outline & writing status" extra={<button className="btn sm" onClick={() => up({ chapters: [...p.chapters, { id: uid(), title: 'New chapter', status: 'todo', words: 0, target: 0, notes: '' }] })}>＋ Chapter</button>}>
      <div className="list">{p.chapters.map((c, i) => <div key={c.id} style={{ flexWrap: 'wrap' }}>
        <span className="muted" style={{ width: 20 }}>{i + 1}</span>
        <input type="text" className="grow" value={c.title} onChange={e => setCh(c.id, { title: e.target.value })} />
        <select style={{ width: 120 }} value={c.status} onChange={e => setCh(c.id, { status: e.target.value as Chapter['status'] })}>{CH_STATUS.map(s => <option key={s}>{s}</option>)}</select>
        <input type="number" style={{ width: 90 }} title="Words written" value={c.words} onChange={e => setCh(c.id, { words: +e.target.value })} />/
        <input type="number" style={{ width: 90 }} title="Target words" value={c.target} onChange={e => setCh(c.id, { target: +e.target.value })} />
        <button className="icon-btn" disabled={i === 0} onClick={() => { const a = [...p.chapters]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; up({ chapters: a }); }}>↑</button>
        <button className="icon-btn" onClick={() => up({ chapters: p.chapters.filter(x => x.id !== c.id) })}>✕</button>
        <input type="text" style={{ flexBasis: '100%' }} placeholder="Notes, evidence needed, linked sources…" value={c.notes} onChange={e => setCh(c.id, { notes: e.target.value })} />
        <div className="small muted" style={{ flexBasis: '100%' }}>{refs.filter(r => r.chapterId === c.id).length} linked source(s)</div>
      </div>)}</div></Card>}

    {tab === 'plan' && <Card title="Milestones" extra={<button className="btn sm" onClick={() => up({ milestones: [...p.milestones, { id: uid(), title: 'Milestone', date: today(), done: false }] })}>＋ Milestone</button>}>
      <div className="list">{[...p.milestones].sort((a, b) => a.date.localeCompare(b.date)).map(m => <div key={m.id}>
        <div className={'check' + (m.done ? ' on' : '')} onClick={() => up({ milestones: p.milestones.map(x => x.id === m.id ? { ...x, done: !x.done } : x) })}>{m.done ? '✓' : ''}</div>
        <input type="text" className="grow" value={m.title} onChange={e => up({ milestones: p.milestones.map(x => x.id === m.id ? { ...x, title: e.target.value } : x) })} />
        <input type="date" style={{ width: 150 }} value={m.date} onChange={e => up({ milestones: p.milestones.map(x => x.id === m.id ? { ...x, date: e.target.value } : x) })} />
        <button className="icon-btn" onClick={() => up({ milestones: p.milestones.filter(x => x.id !== m.id) })}>✕</button></div>)}</div>
      {!p.milestones.length && <Empty>Add milestones such as “Literature review done” or “First full draft”. The earliest one defines the start of your planned-progress line.</Empty>}</Card>}

    {tab === 'lit' && <Literature p={p} />}

    {tab === 'feedback' && <div className="dash">
      <Card title="Supervisor feedback & follow-ups" extra={<button className="btn sm" onClick={() => up({ feedback: [...p.feedback, { id: uid(), text: '', date: today(), done: false }] })}>＋ Feedback</button>}>
        <div className="list">{p.feedback.map(f => <div key={f.id}>
          <div className={'check' + (f.done ? ' on' : '')} onClick={() => up({ feedback: p.feedback.map(x => x.id === f.id ? { ...x, done: !x.done } : x) })}>{f.done ? '✓' : ''}</div>
          <input type="text" className="grow" value={f.text} placeholder="Feedback or follow-up…" onChange={e => up({ feedback: p.feedback.map(x => x.id === f.id ? { ...x, text: e.target.value } : x) })} />
          <span className="small muted">{f.date}</span><button className="icon-btn" onClick={() => up({ feedback: p.feedback.filter(x => x.id !== f.id) })}>✕</button></div>)}</div>
        {!p.feedback.length && <Empty>No feedback recorded.</Empty>}</Card>
      <Card title="Open questions & missing evidence"><textarea style={{ minHeight: 200 }} value={p.openQuestions} onChange={e => up({ openQuestions: e.target.value })} placeholder="One per line…" /></Card>
    </div>}
  </>;
}
