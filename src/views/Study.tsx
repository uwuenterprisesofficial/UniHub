import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isDone, newTask, useStore } from '../lib/store';
import { newCard, review } from '../lib/srs';
import { occurrences } from '../lib/schedule';
import type { Flashcard } from '../lib/types';
import { addDays, diffDays, fmtDate, today } from '../lib/util';
import { Card, Empty, Field, Modal, ModuleSelect, ModChip, openDialog, toast, confirmBox } from '../components/ui';
import { useUrlState } from '../lib/nav';

const TABS = { review: 'Review', cards: 'Cards', quiz: 'Quiz', exams: 'Exam prep' } as const;
type Tab = keyof typeof TABS;

function CardDialog({ id, moduleId }: { id?: string; moduleId?: string }) {
  const { flashcards, add, update, remove } = useStore();
  const ex = flashcards.find(c => c.id === id);
  const [d, setD] = useState(ex ?? newCard({ moduleId: moduleId ?? '' }));
  return <Modal title={id ? 'Edit card' : 'New flashcard'} buttons={[
    ...(id ? [{ label: 'Delete', cls: 'danger left', keepOpen: true, onClick: () => confirmBox('Delete this card?', () => remove('flashcards', id)) }] : []),
    { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: () => { if (!d.front.trim() || !d.back.trim()) { toast('Both sides are required'); return false; } id ? update('flashcards', id, d) : add('flashcards', d); } }]}>
    <Field label="Front (question / term)"><textarea value={d.front} onChange={e => setD({ ...d, front: e.target.value })} autoFocus /></Field>
    <Field label="Back (answer / definition)"><textarea value={d.back} onChange={e => setD({ ...d, back: e.target.value })} /></Field>
    <Field label="Module"><ModuleSelect value={d.moduleId} onChange={v => setD({ ...d, moduleId: v })} /></Field>
  </Modal>;
}

function ReviewTab({ cards }: { cards: Flashcard[] }) {
  const update = useStore(s => s.update);
  const due = useMemo(() => cards.filter(c => c.due <= today()), [cards.length]);
  const [i, setI] = useState(0); const [show, setShow] = useState(false); const [done, setDone] = useState(0);
  const c = due[i];
  if (!cards.length) return <Card><Empty>No flashcards yet. Add cards, or convert notes using “term :: definition” lines.</Empty></Card>;
  if (!c) return <Card><Empty>🎉 Nothing due. {done > 0 ? `You reviewed ${done} card(s) this session.` : ''} Next review: {fmtDate(cards.map(x => x.due).sort()[0])}</Empty></Card>;
  const grade = (g: 0 | 1 | 2 | 3) => { update('flashcards', c.id, review(c, g)); setDone(done + 1); setShow(false); setI(i + 1); };
  return <Card title={`Card ${i + 1} of ${due.length}`} extra={<ModChip id={c.moduleId} />}>
    <div style={{ minHeight: 140, display: 'grid', placeItems: 'center', textAlign: 'center', fontSize: 18, whiteSpace: 'pre-wrap' }}>
      <div>{c.front}{show && <><hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} /><div style={{ color: 'var(--accent)' }}>{c.back}</div></>}</div></div>
    <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
      {!show ? <button className="btn primary" onClick={() => setShow(true)}>Show answer</button> :
        (['Again', 'Hard', 'Good', 'Easy'] as const).map((l, g) => <button key={l} className={'btn' + (g === 2 ? ' primary' : '')} onClick={() => grade(g as 0 | 1 | 2 | 3)}>{l}</button>)}</div>
  </Card>;
}

function Quiz({ cards }: { cards: Flashcard[] }) {
  const [round, setRound] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [score, setScore] = useState({ ok: 0, n: 0 });
  const update = useStore(s => s.update);
  const q = useMemo(() => {
    if (cards.length < 4) return null;
    const c = cards[Math.floor(Math.random() * cards.length)];
    const wrong = cards.filter(x => x.id !== c.id).sort(() => Math.random() - .5).slice(0, 3).map(x => x.back);
    return { c, opts: [...wrong, c.back].sort(() => Math.random() - .5) };
  }, [round, cards.length]);
  if (!q) return <Card><Empty>Create at least 4 flashcards to generate multiple-choice quizzes.</Empty></Card>;
  const answer = (o: string) => {
    if (pick) return; setPick(o); const ok = o === q.c.back;
    setScore(s => ({ ok: s.ok + +ok, n: s.n + 1 }));
    update('flashcards', q.c.id, { confidence: Math.max(0, Math.min(100, q.c.confidence + (ok ? 10 : -15))) });
  };
  return <Card title={`Quiz · ${score.ok}/${score.n} correct`}>
    <p style={{ fontSize: 17, whiteSpace: 'pre-wrap' }}>{q.c.front}</p>
    <div style={{ display: 'grid', gap: 8 }}>{q.opts.map(o => <button key={o} className="btn" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left',
      ...(pick && o === q.c.back ? { background: 'var(--ok)', color: '#fff' } : pick === o ? { background: 'var(--danger)', color: '#fff' } : {}) }} onClick={() => answer(o)}>{o}</button>)}</div>
    {pick && <div className="row" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { setPick(null); setRound(round + 1); }}>Next question</button></div>}
  </Card>;
}

function ExamTab() {
  const { events, tasks, notes, docs, flashcards, settings: S, add } = useStore();
  const t = today(), exams = occurrences(events, t, addDays(t, 180)).filter(o => o.ev.type === 'exam');
  if (!exams.length) return <Card><Empty>No upcoming exams. Add an event of type “exam” in the calendar.</Empty></Card>;
  const plan = (moduleId: string, examDate: string, title: string) => {
    const days = Math.min(diffDays(examDate, t), 14); if (days < 2) return toast('Exam is too close to plan');
    const per = Math.max(1, Math.round(S.dailyHours / 2));
    for (let i = 1; i <= Math.min(days - 1, 7); i++) {
      const d = addDays(examDate, -i);
      add('events', { title: `Revise: ${title}`, type: 'study', moduleId, date: d, start: '17:00', end: `${17 + per}:00`, location: '', desc: 'Generated revision session', repeat: 'none', until: '', exceptions: [], reminder: 15 });
    }
    add('tasks', newTask({ title: `Exam preparation: ${title}`, moduleId, type: 'Exam preparation', due: addDays(examDate, -1), priority: 3, estimate: per * 60 * 5 }));
    toast('Revision plan created: study sessions and a preparation task');
  };
  return <div className="dash">{exams.map(o => {
    const m = o.ev.moduleId; const cs = flashcards.filter(c => c.moduleId === m);
    const conf = cs.length ? Math.round(cs.reduce((a, c) => a + c.confidence, 0) / cs.length) : 0;
    const open = tasks.filter(x => x.moduleId === m && !isDone(x, S));
    return <Card key={o.ev.id + o.date} title={`🎓 ${o.ev.title}`} extra={<b>{diffDays(o.date, t)} days</b>}>
      <p className="small muted">{fmtDate(o.date, S.dateFormat, true)} {o.ev.start} {o.ev.location && '· ' + o.ev.location} <ModChip id={m} /></p>
      <div className="small">Confidence ({cs.length} cards)</div><div className="bar" style={{ margin: '4px 0 10px' }}><i style={{ width: conf + '%' }} /></div>
      <div className="small muted">{cs.filter(c => c.due <= t).length} cards due · {open.length} open tasks · {notes.filter(n => n.moduleId === m).length} notes · {docs.filter(d => d.moduleId === m).length} documents</div>
      <div className="row" style={{ marginTop: 10 }}>{m && <Link className="btn sm" to={'/modules/' + m}>Open module</Link>}
        <button className="btn sm primary" onClick={() => plan(m, o.date, o.ev.title)}>Create revision plan</button></div>
    </Card>;
  })}</div>;
}

export default function Study() {
  const { flashcards, notes, add } = useStore();
  const [tab, setTab] = useUrlState<Tab>('tab', 'review', ['review', 'cards', 'quiz', 'exams']); const [mf, setMf] = useState('');
  const cards = flashcards.filter(c => !mf || c.moduleId === mf);
  const t = today(), dueN = flashcards.filter(c => c.due <= t).length;
  const fromNotes = () => {
    let n = 0;
    notes.forEach(nt => nt.body.split('\n').forEach(l => {
      const m = l.match(/^\s*(?:[-*]\s+)?\*{0,2}(.+?)\*{0,2}\s*::\s*(.+)$/);
      if (m && !flashcards.some(c => c.front === m[1].trim() && c.noteId === nt.id)) { add('flashcards', newCard({ front: m[1].trim(), back: m[2].trim(), moduleId: nt.moduleId, noteId: nt.id })); n++; }
    }));
    toast(n ? `Created ${n} flashcard(s) from notes` : 'No “term :: definition” lines found in notes');
  };
  return <>
    <div className="page-head"><h1>Study</h1><div style={{ width: 220 }}><ModuleSelect value={mf} onChange={setMf} none="All modules" /></div>
      <button className="btn" onClick={fromNotes}>📝 Cards from notes</button>
      <button className="btn primary" onClick={() => openDialog(<CardDialog moduleId={mf} />)}>＋ Card</button></div>
    <div className="tabs">{(Object.keys(TABS) as Tab[]).map(k => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{TABS[k]}{k === 'review' && dueN > 0 && <span className="badge" style={{ marginLeft: 6 }}>{dueN}</span>}</button>)}</div>
    {tab === 'review' && <ReviewTab key={mf + flashcards.length} cards={cards} />}
    {tab === 'cards' && <Card><div className="list">{cards.map(c => <div key={c.id} className="itm" onClick={() => openDialog(<CardDialog id={c.id} />)}>
      <div className="grow"><div className="t">{c.front}</div><div className="small muted">{c.back}</div></div><ModChip id={c.moduleId} />
      <span className="small muted" title="Confidence">{c.confidence}%</span><span className="small muted">due {c.due}</span></div>)}</div>{!cards.length && <Empty>No cards.</Empty>}</Card>}
    {tab === 'quiz' && <Quiz cards={cards} />}
    {tab === 'exams' && <ExamTab />}
  </>;
}
