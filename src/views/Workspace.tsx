import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getData, newNote, newTask, useStore } from '../lib/store';
import { useTexts } from '../lib/blobs';
import { getCorpus } from '../lib/analysis';
import { buildLectureSummary, ensureSession, lectureMaterial, liveNote, sessionDocs, sessionNotes } from '../lib/lecture';
import { aiCourseSummary, aiLectureSummary, useAI, useActiveProvider } from '../lib/ai';
import { occurrences } from '../lib/schedule';
import { newCard } from '../lib/srs';
import { md, linkTerms } from '../lib/markdown';
import type { Session } from '../lib/types';
import { DOW, addDays, download, fmtDate, parseD, today } from '../lib/util';
import { Card, Empty, Field, Modal, closeDialog, confirmBox, openDialog, toast } from '../components/ui';
import { aiGate } from '../components/AI';
import { importFiles } from './Documents';
import { BackLink } from '../components/BackLink';
import { useUrlParams, useUrlState } from '../lib/nav';
import Knowledge from './Knowledge';
import Graph from './Graph';
import { TermDialog } from '../components/TermDialog';
import { findOccurrences } from '../lib/kb';
import { ModChip } from '../components/ui';

const STATUS = { planned: '🗓 planned', open: '✏️ in progress', done: '✅ done' } as const;

/** Asks before throwing away a summary the student edited. Resolves false if declined or dismissed. */
function confirmReplace(): Promise<boolean> {
  return new Promise(res => openDialog(<Modal title="Replace your edited summary?" buttons={[{ label: 'Keep mine', onClick: () => res(false) }, { label: 'Replace', cls: 'danger', onClick: () => res(true) }]}>
    <p>You changed this summary by hand. Creating a new one throws those changes away.</p></Modal>));
}

/* ------------------------------------------------------------------ attach documents */
function AttachDialog({ sessionId }: { sessionId: string }) {
  const { docs, sessions, update } = useStore();
  const s = sessions.find(x => x.id === sessionId)!; const [q, setQ] = useState(''); const [pick, setPick] = useState<Set<string>>(new Set());
  const list = docs.filter(d => !s.docIds.includes(d.id) && (!q || d.name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => +(b.moduleId === s.moduleId) - +(a.moduleId === s.moduleId) || (b.added - a.added));
  return <Modal title="Attach documents" buttons={[{ label: 'Cancel' }, { label: `Attach ${pick.size || ''}`.trim(), cls: 'primary', onClick: () => { update('sessions', s.id, { docIds: [...s.docIds, ...pick] }); } }]}>
    <input type="search" placeholder="Search your documents…" value={q} onChange={e => setQ(e.target.value)} autoFocus style={{ marginBottom: 8 }} />
    <div className="list" style={{ maxHeight: 340, overflow: 'auto' }}>{list.map(d => <label key={d.id} style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={pick.has(d.id)} onChange={e => { const n = new Set(pick); e.target.checked ? n.add(d.id) : n.delete(d.id); setPick(n); }} />
      <div className="grow"><div className="t">{d.name}</div><div className="small muted">{d.moduleId === s.moduleId ? 'this module' : ''}</div></div></label>)}</div>
    {!list.length && <Empty>No other documents. Upload files with the button next to “Attach”.</Empty>}
  </Modal>;
}

/* ------------------------------------------------------------------ notes tab */
function NotesTab({ s, onTerm }: { s: Session; onTerm: (id: string) => void }) {
  const { notes, tasks, settings: S, update, add } = useStore(); const nav = useNavigate();
  const live = useMemo(() => liveNote(s), [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const note = notes.find(n => n.id === live.id) ?? live;
  const others = notes.filter(n => n.sessionId === s.id && n.id !== live.id);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [task, setTask] = useState(''); const [due, setDue] = useState('');
  const insert = (text: string) => {
    const el = ta.current, pos = el?.selectionStart ?? note.body.length, body = note.body.slice(0, pos) + text + note.body.slice(el?.selectionEnd ?? pos);
    update('notes', note.id, { body, updated: Date.now() });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos + text.length, pos + text.length); });
  };
  const knownTerms = useStore(x => x.terms).filter(t => t.status === 'confirmed');
  const inNotes = useMemo(() => knownTerms.filter(t => findOccurrences(note.body, [t.term, ...t.aliases]).length).slice(0, 12), [note.body, knownTerms.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessionNoteIds = new Set(notes.filter(n => n.sessionId === s.id).map(n => n.id));
  const mine = tasks.filter(t => t.noteIds.some(id => sessionNoteIds.has(id)));
  return <div className="ws-grid">
    <div>
      <div className="row" style={{ marginBottom: 6, gap: 6 }}>
        {([['• Point', '\n- '], ['## Topic', '\n\n## '], ['Term ::', '\n- Term :: '], ['? Question', '\n- ? '], ['☐ To do', '\n- [ ] '], ['⏱ Time', ` ⏱${new Date().toTimeString().slice(0, 5)} `]] as const).map(([l, t]) =>
          <button key={l} className="btn sm" onMouseDown={e => e.preventDefault()} onClick={() => insert(t)}>{l}</button>)}
        <span className="small muted" style={{ marginLeft: 'auto' }}>saved automatically</span></div>
      <textarea ref={ta} className="ws-editor" value={note.body} onChange={e => update('notes', note.id, { body: e.target.value, updated: Date.now() })}
        placeholder="Take notes here during the lecture…  Markdown works. Lines like “Term :: definition” and “- ? question” end up in the summary." />
      {inNotes.length > 0 && <div className="row small" style={{ gap: 4, margin: '6px 0 2px' }}><span className="muted">📖 Glossary terms in your notes:</span>{inNotes.map(t => <button key={t.id} className="chip" style={{ cursor: 'pointer' }} title={t.definition} onClick={() => onTerm(t.id)}>{t.term}</button>)}</div>}
      <div className="small muted" style={{ marginTop: 4 }}>{note.body.split(/\s+/).filter(Boolean).length} words · <a href={'#/notes/' + note.id} onClick={e => { e.preventDefault(); nav('/notes/' + note.id); }}>open in the notes editor</a></div>
    </div>
    <div>
      <Card title="More notes">
        {others.map(n => <div key={n.id} className="itm small" style={{ padding: '4px 0' }} onClick={() => nav('/notes/' + n.id)}>📝 {n.title}</div>)}
        {!others.length && <div className="small muted">Extra notes for this lecture (a worked example, a sketch…) are collected here and used in the summary.</div>}
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => { const n = add('notes', newNote({ title: `${s.title || 'Lecture'} – extra note`, moduleId: s.moduleId, sessionId: s.id, date: s.date, tags: ['lecture'] })); nav('/notes/' + n.id); }}>＋ Add a note</button>
      </Card>
      <div style={{ height: 12 }} />
      <Card title="Tasks from this lecture">
        <form className="row" style={{ marginBottom: 6 }} onSubmit={e => { e.preventDefault(); if (!task.trim()) return; add('tasks', newTask({ title: task.trim(), due, moduleId: s.moduleId, type: 'Homework', noteIds: [live.id], desc: `From the lecture on ${fmtDate(s.date, S.dateFormat)}` })); setTask(''); setDue(''); }}>
          <input type="text" className="grow" placeholder="Task…" value={task} onChange={e => setTask(e.target.value)} /><input type="date" style={{ width: 140 }} value={due} onChange={e => setDue(e.target.value)} /><button className="btn sm primary">Add</button></form>
        {mine.map(t => <div key={t.id} className="small" style={{ padding: '2px 0' }}>{t.status === S.stages.at(-1) ? '✅' : '☐'} {t.title}{t.due && <span className="muted"> · {t.due}</span>}</div>)}
      </Card>
    </div>
  </div>;
}

/* ------------------------------------------------------------------ glossary tab */
/** The whole glossary (it is global), with the terms that occur in this lecture first. */
function termsHere(s: Session, texts: Record<string, string>) {
  const d = getData(); const material = [...sessionNotes(d, s).map(n => n.body), s.summary, ...sessionDocs(d, s).map(x => (texts[x.id] ?? x.text ?? '').slice(0, 150_000))].join('\n\n');
  const out = new Map<string, number>();
  for (const t of d.terms.filter(t => t.status === 'confirmed')) { const n = findOccurrences(material, [t.term, ...t.aliases]).length; if (n) out.set(t.id, n); }
  return out;
}
function GlossaryTab({ s, focus }: { s: Session; focus?: string }) {
  const { terms, notes, update, sessions } = useStore(); const nav = useNavigate(); const texts = useTexts(x => x.map);
  const [q, setQ] = useState(''), [open, setOpen] = useState(focus ?? '');
  const here = useMemo(() => termsHere(s, texts), [s, texts, notes, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = terms.filter(t => t.status === 'confirmed');
  const match = (t: (typeof all)[number]) => !q || (t.term + ' ' + t.aliases.join(' ') + ' ' + t.definition).toLowerCase().includes(q.toLowerCase());
  const inHere = all.filter(t => here.has(t.id) && match(t)).sort((a, b) => here.get(b.id)! - here.get(a.id)!);
  const rest = all.filter(t => !here.has(t.id) && match(t)).sort((a, b) => a.term.localeCompare(b.term));
  const live = () => liveNote(s);
  const insert = (t: (typeof all)[number]) => { const n = live(), cur = useStore.getState().notes.find(x => x.id === n.id)!; update('notes', n.id, { body: cur.body.replace(/\s*$/, '') + `\n- ${t.term} :: ${t.definition || '…'}\n`, updated: Date.now() }); toast(`“${t.term}” added to your lecture notes`); };
  const row = (t: (typeof all)[number]) => <div key={t.id} className="annitem" style={{ borderLeftColor: '#a78bfa' }}>
    <div className="row" style={{ cursor: 'pointer', gap: 8 }} onClick={() => setOpen(open === t.id ? '' : t.id)}>
      <b className="grow">{t.term}{t.aliases.length > 0 && <span className="muted small" style={{ fontWeight: 400 }}> · {t.aliases.join(', ')}</span>}</b>
      {here.has(t.id) && <span className="chip" title="Times it appears in this lecture's notes, summary and documents">×{here.get(t.id)} here</span>}<ModChip id={t.moduleId} /><span className="muted">{open === t.id ? '▾' : '▸'}</span></div>
    {open === t.id && <div style={{ marginTop: 6 }}>
      <div style={{ whiteSpace: 'pre-wrap' }}>{t.definition || <span className="muted">No definition yet.</span>}</div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn sm" onClick={() => insert(t)}>＋ Into my notes</button>
        <button className="btn sm" onClick={() => nav('/glossary/' + t.id)}>Open entry</button>
        <button className="btn sm" onClick={() => openDialog(<TermDialog id={t.id} />)}>Edit</button></div></div>}
  </div>;
  return <>
    <div className="row" style={{ marginBottom: 10 }}>
      <input type="search" className="grow" placeholder={`Search the whole glossary (${all.length} terms)…`} value={q} onChange={e => setQ(e.target.value)} />
      <button className="btn primary" onClick={() => openDialog(<TermDialog preset={{ moduleId: s.moduleId }} onSaved={id => setOpen(id)} />)}>＋ New term</button></div>
    {inHere.length > 0 && <><div className="sec-title" style={{ marginTop: 0 }}>In this lecture · {inHere.length}</div>{inHere.map(row)}</>}
    <div className="sec-title">{inHere.length ? 'Rest of your glossary' : 'Your glossary'} · {rest.length}</div>
    {(q ? rest : rest.slice(0, 60)).map(row)}
    {!q && rest.length > 60 && <div className="small muted">…and {rest.length - 60} more — use the search.</div>}
    {!all.length && <Empty>Your glossary is empty. Add terms here, or select words while reading a document. <Link to="/glossary">Open the glossary</Link></Empty>}
  </>;
}

/* ------------------------------------------------------------------ documents tab */
function DocsTab({ s }: { s: Session }) {
  const { annotations, update } = useStore(); const nav = useNavigate(); const texts = useTexts(x => x.map);
  const docs = sessionDocs(getData(), s); const fileRef = useRef<HTMLInputElement>(null); const [over, setOver] = useState(false); const [busy, setBusy] = useState(false);
  const addFiles = async (files: File[]) => {
    if (!files.length) return; setBusy(true);
    const got = await importFiles(files, { moduleId: s.moduleId }); const cur = useStore.getState().sessions.find(x => x.id === s.id)!;
    update('sessions', s.id, { docIds: [...new Set([...cur.docIds, ...got.map(d => d.id)])] }); setBusy(false);
  };
  return <>
    <div className={'dropzone' + (over ? ' dragover' : '')} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void addFiles([...e.dataTransfer.files]); }}>
      {busy ? 'Reading your files…' : 'Drop the lecture slides, scripts or photos of the board here — or '}
      {!busy && <><button className="btn sm" onClick={() => fileRef.current?.click()}>⬆ Upload</button> <button className="btn sm" onClick={() => openDialog(<AttachDialog sessionId={s.id} />)}>📎 Attach from library</button></>}
      <input ref={fileRef} type="file" multiple hidden onChange={e => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} /></div>
    <Card>{docs.map(d => { const today_ = annotations.filter(a => a.docId === d.id && new Date(a.created).toISOString().slice(0, 10) === s.date).length;
      return <div key={d.id} className="list"><div><div className="dicon" style={{ width: 32, height: 36 }}>{d.ext.toUpperCase().slice(0, 4)}</div>
        <div className="grow itm" onClick={() => nav('/documents/' + d.id)}><div className="t">{d.name}</div><div className="small muted">{texts[d.id] ? `${Math.round(texts[d.id].length / 5).toLocaleString()} words` : 'no text extracted'}{today_ > 0 && ` · ${today_} highlight${today_ > 1 ? 's' : ''} this day`}</div></div>
        <button className="btn sm" onClick={() => update('sessions', s.id, { docIds: s.docIds.filter(x => x !== d.id) })} title="Remove from this lecture (the document stays in your library)">Detach</button></div></div>; })}
      {!docs.length && <Empty>No documents yet. Open one in the reader to highlight passages — highlights made on the lecture day go into the summary.</Empty>}</Card>
  </>;
}

/* ------------------------------------------------------------------ summary tab */
function SummaryTab({ s, generate, busy }: { s: Session; generate: (kind: 'extract' | 'ai') => void; busy: boolean }) {
  const { terms, update, add, notes, settings: S } = useStore(); const nav = useNavigate(); const provider = useActiveProvider(); const texts = useTexts(x => x.map);
  const [edit, setEdit] = useState(false);
  const live = useMemo(() => buildLectureSummary(getData(), s, texts, getCorpus()), [s, texts, notes]); // what could be turned into tasks / terms / cards
  const confirmed = terms.filter(t => t.status === 'confirmed');
  const [pickT, setPickT] = useState<Set<string>>(new Set(live.todos.map(x => 't:' + x).concat(live.deadlines.map(x => 'd:' + x.start))));
  const toggle = (k: string) => { const n = new Set(pickT); n.has(k) ? n.delete(k) : n.add(k); setPickT(n); };
  const newTerms = live.terms.filter(t => !t.known);
  const makeTasks = () => {
    let n = 0;
    live.todos.filter(t => pickT.has('t:' + t)).forEach(t => { add('tasks', newTask({ title: t, moduleId: s.moduleId, desc: `From the lecture on ${fmtDate(s.date, S.dateFormat)}` })); n++; });
    live.deadlines.filter(x => pickT.has('d:' + x.start)).forEach(x => { add('tasks', newTask({ title: x.title, due: x.due, moduleId: s.moduleId, type: x.type, desc: x.sentence })); n++; });
    toast(n ? `${n} task${n > 1 ? 's' : ''} created` : 'Nothing selected');
  };
  return <div className="ws-grid">
    <div>
      {!s.summary ? <Card><Empty>No summary yet. When the lecture is over, create one from your notes, highlights and documents.</Empty>
        <div className="row" style={{ justifyContent: 'center' }}><button className="btn primary" disabled={busy} onClick={() => generate('extract')}>Create summary</button>
          {provider && <button className="btn" disabled={busy} onClick={() => generate('ai')}>✨ Write it with AI</button>}</div></Card>
        : <Card title="Lecture summary" extra={<span className="muted">{s.summarySource === 'ai' ? '✨ AI-generated' : '⚙ extracted from your material'}{s.summaryEdited && ' · edited by you'}</span>}>
          {edit ? <textarea className="ws-editor" value={s.summary} onChange={e => update('sessions', s.id, { summary: e.target.value, summaryEdited: true })} />
            : <div className="md" dangerouslySetInnerHTML={{ __html: linkTerms(md(s.summary, notes), confirmed) }} />}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => setEdit(!edit)}>{edit ? '✓ Done editing' : '✎ Edit'}</button>
            <button className="btn sm" disabled={busy} onClick={() => generate('extract')}>↻ Rebuild</button>
            {provider && <button className="btn sm" disabled={busy} onClick={() => generate('ai')}>✨ Write with AI</button>}
            <button className="btn sm" onClick={() => { const n = add('notes', newNote({ title: `Summary ${s.date}${s.title ? ' – ' + s.title : ''}`, body: s.summary, moduleId: s.moduleId, tags: ['summary', 'lecture'], date: s.date })); nav('/notes/' + n.id); }}>Save as note</button>
            <button className="btn sm" onClick={() => navigator.clipboard.writeText(s.summary).then(() => toast('Copied'))}>Copy</button></div>
          {s.summarySource === 'ai' && <p className="small muted">Written by an AI model from your material — check it against your notes.</p>}</Card>}
    </div>
    <div>
      <Card title="What was found">
        <div className="small">📝 {live.points.length} points · 🖍 {live.highlights} highlights today · 📄 {live.docsUsed} documents read · ❓ {live.questions.length} questions</div>
        <div className="sec-title">Turn it into…</div>
        {(live.todos.length > 0 || live.deadlines.length > 0) ? <>
          <div className="small"><b>Tasks</b></div>
          {live.todos.map(t => <label key={t} className="small" style={{ display: 'block' }}><input type="checkbox" checked={pickT.has('t:' + t)} onChange={() => toggle('t:' + t)} /> {t}</label>)}
          {live.deadlines.map(x => <label key={x.start} className="small" style={{ display: 'block' }}><input type="checkbox" checked={pickT.has('d:' + x.start)} onChange={() => toggle('d:' + x.start)} /> 📅 {x.due} — {x.title.slice(0, 60)}</label>)}
          <button className="btn sm primary" style={{ margin: '6px 0' }} onClick={makeTasks}>＋ Create selected tasks</button></> : <div className="small muted">No to-dos or deadlines found. Write “- [ ] …” lines in your notes.</div>}
        {newTerms.length > 0 && <><div className="small" style={{ marginTop: 8 }}><b>New terms</b></div>
          {newTerms.map(t => <div key={t.term} className="row small" style={{ gap: 6, padding: '2px 0' }}><span className="grow" title={t.definition}>{t.term}</span>
            <button className="btn sm" onClick={() => { add('terms', { term: t.term, aliases: [], definition: t.definition, moduleId: s.moduleId, status: 'confirmed', auto: true, sourceDocId: '', created: Date.now() }); toast(`“${t.term}” added to the glossary`); }}>＋ Glossary</button></div>)}</>}
        {live.terms.some(t => t.definition) && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { const c = live.terms.filter(t => t.definition); c.forEach(t => add('flashcards', newCard({ front: `What is: ${t.term}?`, back: t.definition, moduleId: s.moduleId }))); toast(`${c.length} flashcards created`); }}>🧠 Flashcards from definitions</button>}
      </Card>
    </div>
  </div>;
}

/* ------------------------------------------------------------------ course overview */
function Overview({ moduleId }: { moduleId: string }) {
  const { sessions, notes, docs, modules, update } = useStore(); const nav = useNavigate(); const provider = useActiveProvider(); const texts = useTexts(x => x.map);
  const mod = modules.find(m => m.id === moduleId)!; const [ai, setAi] = useState(''); const [busy, setBusy] = useState(false);
  const list = sessions.filter(x => x.moduleId === moduleId).sort((a, b) => a.date.localeCompare(b.date));
  const withSummary = list.filter(x => x.summary);
  const agg = useMemo(() => { const d = getData(); const qs: string[] = [], todos: string[] = []; list.forEach(x => { const r = buildLectureSummary(d, x, texts, getCorpus()); r.questions.forEach(q => qs.push(`${x.date}: ${q}`)); r.todos.forEach(t => todos.push(`${x.date}: ${t}`)); }); return { qs, todos }; }, [list.length, notes, texts]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = () => `# ${mod.name} – lecture summaries\n\n` + withSummary.map(x => `${x.summary.replace(/^# /, '## ')}`).join('\n---\n\n');
  const course = async () => {
    const chars = withSummary.reduce((a, x) => a + x.summary.length, 0);
    if (!(await aiGate(`Summarise the course “${mod.name}” from ${withSummary.length} lecture summaries`, chars))) return;
    setBusy(true); try { setAi(await aiCourseSummary(mod.name, withSummary.map(x => ({ date: x.date, text: x.summary })))); } catch (e) { toast((e as Error).message); } setBusy(false);
  };
  return <div className="dash">
    <Card title="Course so far">
      <div className="row small" style={{ gap: 14 }}><span>🎓 {list.length} lectures</span><span>✅ {list.filter(x => x.status === 'done').length} finished</span><span>📝 {notes.filter(n => n.sessionId && list.some(x => x.id === n.sessionId)).length} notes</span><span>📄 {new Set(list.flatMap(x => x.docIds)).size} documents</span></div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm" disabled={!withSummary.length} onClick={() => download(`${mod.code || mod.name}-lecture-summaries.md`, all())}>⬇ Export all summaries (Markdown)</button>
        {provider && <button className="btn sm" disabled={busy || !withSummary.length} onClick={course}>{busy ? 'Writing…' : '✨ Summarise the whole course'}</button>}</div>
      {ai && <div className="answer" style={{ marginTop: 10 }}><div className="small muted">✨ AI-generated from your lecture summaries</div><div className="md" dangerouslySetInnerHTML={{ __html: md(ai, notes) }} /></div>}
    </Card>
    <Card title={`Open questions (${agg.qs.length})`}>{agg.qs.slice(0, 12).map((q, i) => <div key={i} className="small" style={{ padding: '3px 0' }}>❓ {q}</div>)}{!agg.qs.length && <Empty>No open questions. Lines with “?” in your notes collect here.</Empty>}</Card>
    <Card title={`Open to-dos (${agg.todos.length})`}>{agg.todos.slice(0, 12).map((q, i) => <div key={i} className="small" style={{ padding: '3px 0' }}>☐ {q}</div>)}{!agg.todos.length && <Empty>Nothing open.</Empty>}</Card>
    <Card title="Lecture summaries" wide>
      {list.map(x => <details key={x.id} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
        <summary style={{ cursor: 'pointer' }}><b>{fmtDate(x.date)}</b> {x.title || x.topic} <span className="muted small">{STATUS[x.status]}{x.summary ? '' : ' · no summary'}</span></summary>
        {x.summary ? <div className="md" dangerouslySetInnerHTML={{ __html: md(x.summary, notes) }} /> : <div className="small muted">No summary yet.</div>}
        <button className="btn sm" onClick={() => nav(`/modules/${moduleId}/workspace?s=${x.id}`)}>Open this lecture</button></details>)}
      {!list.length && <Empty>No lectures yet.</Empty>}
    </Card>

  </div>;
}

/* ------------------------------------------------------------------ page */
export default function Workspace() {
  const { id = '' } = useParams(); const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const { modules, sessions, events, notes, update, remove, add, settings: S } = useStore(); const texts = useTexts(x => x.map); const provider = useActiveProvider();
  const mod = modules.find(m => m.id === id);
  const TABS_ = ['notes', 'docs', 'summary', 'gloss', 'ask', 'graph', 'overview'] as const;
  const [tab, setTab] = useUrlState<(typeof TABS_)[number]>('tab', 'notes', TABS_); const setUrl = useUrlParams(); const [glossFocus, setGlossFocus] = useUrlState<string>('term', ''); const [busy, setBusy] = useState(false);
  const list = sessions.filter(x => x.moduleId === id).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  const sel = list.find(x => x.id === sp.get('s')) ?? list.find(x => x.date === today()) ?? list[0];

  // lectures that happened (or happen today) according to the calendar and have no session yet
  const missing = useMemo(() => {
    const t = today(); return occurrences(events.filter(e => e.moduleId === id && (e.type === 'lecture' || e.type === 'seminar')), addDays(t, -21), t)
      .filter(o => !sessions.some(x => x.moduleId === id && x.date === o.date)).reverse().slice(0, 6);
  }, [events, sessions, id]);
  if (!mod) return <div className="card empty">Module not found.</div>;

  // switching lecture starts clean: a question, graph selection or glossary term of another lecture would mean nothing here
  const open = (sid: string, t?: typeof tab) => setUrl({ s: sid, ...(t ? { tab: t === 'notes' ? undefined : t } : {}), ...(sid !== sel?.id ? { q: undefined, focus: undefined, hop: undefined, sc: undefined, sl: undefined, mode: undefined, term: undefined } : {}) });
  const create = (date: string, eventId = '', title = '') => { const s = ensureSession(id, date, eventId, title); open(s.id, 'notes'); };
  const newSession = () => openDialog(<NewSession moduleId={id} onCreate={(d, t) => create(d, '', t)} />);

  const generate = async (kind: 'extract' | 'ai') => {
    if (!sel) return;
    if (sel.summary && sel.summaryEdited && !(await confirmReplace())) return;
    setBusy(true);
    try {
      const d = getData();
      if (kind === 'extract') {
        const r = buildLectureSummary(d, sel, texts, getCorpus());
        if (r.empty) { toast('Nothing to summarise yet — write some notes or attach a document first.'); setBusy(false); return; }
        update('sessions', sel.id, { summary: r.markdown, summarySource: 'extract', summaryEdited: false, summaryAt: Date.now() });
      } else {
        const m = lectureMaterial(d, sel, texts, useAI.getState().maxChars);
        if (!m.text.trim()) { toast('Nothing to summarise yet.'); setBusy(false); return; }
        if (!(await aiGate(`Write the lecture summary for ${fmtDate(sel.date, S.dateFormat)} with AI`, m.chars))) { setBusy(false); return; }
        const text = await aiLectureSummary(mod.name, sel.date, m.text);
        update('sessions', sel.id, { summary: `# Lecture summary – ${mod.name}, ${fmtDate(sel.date, S.dateFormat)}\n\n${text.replace(/^#\s.*\n+/, '')}\n\n*Written by AI from your notes, highlights and documents.*\n`, summarySource: 'ai', summaryEdited: false, summaryAt: Date.now() });
      }
      setTab('summary');
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const finish = async () => { if (!sel) return; update('sessions', sel.id, { status: 'done' }); if (!sel.summary) await generate('extract'); else setTab('summary'); };

  const dd = (d: string) => parseD(d);
  return <>
    <div className="page-head"><div><BackLink fallback={'/modules/' + id} label={mod.name} /><h1 style={{ color: mod.color }}>{mod.icon || '📘'} Lecture workspace</h1>
      <div className="muted">Notes, documents and a summary for every lecture day.</div></div>
      <button className="btn" onClick={() => setTab(tab === 'overview' ? 'notes' : 'overview')}>{tab === 'overview' ? '← Back to lecture' : '📚 Course overview'}</button>
      <button className="btn" onClick={newSession}>＋ Other day…</button>
      <button className="btn primary" onClick={() => { const t = today(), ev = events.find(e => e.moduleId === id && occurrences([e], t, t).length); create(t, ev?.id ?? '', ev?.title ?? ''); }}>▶ Start today’s lecture</button></div>

    <div className="split ws-split">
      <div>
        {missing.length > 0 && <Card title="From your calendar">
          {missing.map(o => <div key={o.ev.id + o.date} className="itm small" style={{ padding: '4px 0' }} onClick={() => create(o.date, o.ev.id, o.ev.title)}>＋ {DOW[dd(o.date).getDay()]} {fmtDate(o.date, S.dateFormat)} · {o.ev.title}</div>)}</Card>}
        {missing.length > 0 && <div style={{ height: 10 }} />}
        <div className="nlist">{list.map(x => <div key={x.id} className={'it' + (x.id === sel?.id && tab !== 'overview' ? ' on' : '')} onClick={() => open(x.id, tab === 'overview' ? 'notes' : undefined)}>
          <strong>{DOW[dd(x.date).getDay()]} {fmtDate(x.date, S.dateFormat)}</strong>
          <div className="small muted">{x.title || x.topic || 'Lecture'}</div>
          <div className="small">{STATUS[x.status]} · 📝{notes.filter(n => n.sessionId === x.id).length} 📄{x.docIds.length}{x.summary && ' · ✓ summary'}</div></div>)}
          {!list.length && <div className="empty">No lectures yet. Start today’s lecture or pick one from your calendar.</div>}</div>
      </div>

      <div>
        {tab === 'overview' ? <Overview moduleId={id} /> : !sel ? <Card><Empty>Choose or start a lecture on the left.</Empty></Card> : <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row">
              <input type="text" className="grow" style={{ fontSize: 17, fontWeight: 600 }} placeholder="Lecture title (e.g. Dijkstra & shortest paths)" value={sel.title} onChange={e => update('sessions', sel.id, { title: e.target.value })} />
              <input type="date" style={{ width: 150 }} value={sel.date} onChange={e => e.target.value && update('sessions', sel.id, { date: e.target.value })} />
              <span className="chip">{STATUS[sel.status]}</span>
              {sel.status === 'done' ? <button className="btn" onClick={() => update('sessions', sel.id, { status: 'open' })}>Reopen</button> : <button className="btn primary" disabled={busy} onClick={finish}>✔ Finish & summarise</button>}
              <button className="icon-btn" title="Delete lecture" onClick={() => confirmBox('Delete this lecture? Its notes stay in your notes (unlinked) and documents stay in your library.', () => { notes.filter(n => n.sessionId === sel.id).forEach(n => update('notes', n.id, { sessionId: undefined })); remove('sessions', sel.id); setUrl({ s: undefined, tab: undefined }); })}>🗑</button></div>
            <input type="text" style={{ marginTop: 6 }} placeholder="Topic / chapter (optional)" value={sel.topic} onChange={e => update('sessions', sel.id, { topic: e.target.value })} />
          </div>
          <div className="tabs">{([['notes', '📝 Notes'], ['docs', `📄 Documents (${sel.docIds.length})`], ['summary', `✨ Summary${sel.summary ? ' ✓' : ''}`], ['gloss', '📖 Glossary'], ['ask', '🔎 Ask'], ['graph', '🕸 Graph']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
          {tab === 'notes' && <NotesTab key={sel.id} s={sel} onTerm={id => { setGlossFocus(id); setTab('gloss'); }} />}
          {tab === 'docs' && <DocsTab key={sel.id} s={sel} />}
          {tab === 'summary' && <SummaryTab key={sel.id} s={sel} generate={generate} busy={busy} />}
          {tab === 'gloss' && <GlossaryTab key={sel.id + glossFocus} s={sel} focus={glossFocus} />}
          {tab === 'ask' && <Knowledge key={sel.id} embedded context={{ moduleId: sel.moduleId, sessionId: sel.id }} />}
          {tab === 'graph' && <Graph key={sel.id} embedded moduleId={sel.moduleId} sessionId={sel.id} />}
        </>}
      </div>
    </div>

  </>;
}

function NewSession({ moduleId, onCreate }: { moduleId: string; onCreate: (date: string, title: string) => void }) {
  const [date, setDate] = useState(today()), [title, setTitle] = useState('');
  return <Modal title="Lecture on another day" buttons={[{ label: 'Cancel' }, { label: 'Create', cls: 'primary', onClick: () => { onCreate(date, title.trim()); } }]}>
    <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
    <Field label="Title (optional)"><input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Guest lecture, catch-up, self-study day" /></Field>
    <p className="small muted">For {moduleId ? 'this module' : ''}. If a session already exists for that day, it is opened instead.</p>
  </Modal>;
}
export { closeDialog };
