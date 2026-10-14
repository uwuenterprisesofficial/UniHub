import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CalEvent, Module, Task } from '../lib/types';
import { newTask, useStore } from '../lib/store';
import { addDays, fmtDate, uid } from '../lib/util';
import { Field, Modal, ModuleSelect, closeDialog, confirmBox, openDialog, toast } from './ui';
import { ensureSession } from '../lib/lecture';

function useDraft<T extends object>(init: T) {
  const [d, setD] = useState<T>(init);
  const set = <K extends keyof T>(k: K, v: T[K]) => setD(p => ({ ...p, [k]: v }));
  const bind = <K extends keyof T>(k: K) => ({ value: (d[k] ?? '') as string | number, onChange: (e: { target: { value: string } }) => set(k, e.target.value as T[K]) });
  return { d, set, bind };
}

/* ---------- module ---------- */
export function deleteModule(id: string) {
  const s = useStore.getState();
  s.tasks.filter(x => x.moduleId === id).forEach(x => s.update('tasks', x.id, { moduleId: '' }));
  s.notes.filter(x => x.moduleId === id).forEach(x => s.update('notes', x.id, { moduleId: '' }));
  s.docs.filter(x => x.moduleId === id).forEach(x => s.update('docs', x.id, { moduleId: '' }));
  s.events.filter(x => x.moduleId === id).forEach(x => s.update('events', x.id, { moduleId: '' }));
  s.remove('modules', id);
}
export function ModuleDialog({ id }: { id?: string }) {
  const { modules, settings, add, update } = useStore();
  const nav = useNavigate();
  const existing = modules.find(m => m.id === id);
  const { d, bind } = useDraft<Omit<Module, 'id'>>(existing ?? {
    name: '', code: '', lecturer: '', email: '', semester: settings.currentSemester, ects: '', room: '', link: '', exam: '',
    color: ['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#db2777', '#7c3aed'][modules.length % 6], icon: '📘', objectives: '', grades: [],
  });
  const save = () => {
    if (!d.name.trim()) { toast('Name is required'); return false; }
    const v = { ...d, name: d.name.trim(), ects: d.ects === '' ? '' as const : +d.ects };
    if (id) update('modules', id, v); else add('modules', v);
  };
  return <Modal title={id ? 'Edit module' : 'New module'} buttons={[
    ...(id ? [{ label: 'Delete', cls: 'danger left', keepOpen: true, onClick: () => confirmBox('Delete this module? Its tasks, notes and documents stay but lose the module link.', () => { deleteModule(id); nav('/modules'); }) }] : []),
    { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: save }]}>
    <div className="grid2"><Field label="Name *"><input type="text" {...bind('name')} /></Field><Field label="Module code"><input type="text" {...bind('code')} /></Field></div>
    <div className="grid2"><Field label="Lecturer"><input type="text" {...bind('lecturer')} /></Field><Field label="Contact email"><input type="email" {...bind('email')} /></Field></div>
    <div className="grid3">
      <Field label="Semester"><select {...bind('semester')}>{settings.semesters.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="Credits (ECTS)"><input type="number" {...bind('ects')} /></Field><Field label="Room / location"><input type="text" {...bind('room')} /></Field>
    </div>
    <div className="grid3"><Field label="Icon (emoji)"><input type="text" {...bind('icon')} /></Field><Field label="Color"><input type="color" {...bind('color')} /></Field><Field label="Course link"><input type="url" {...bind('link')} /></Field></div>
    <Field label="Exam format & grading"><input type="text" {...bind('exam')} /></Field>
    <Field label="Learning objectives & requirements"><textarea {...bind('objectives')} /></Field>
  </Modal>;
}

/* ---------- event ---------- */
export function lectureNote(e: CalEvent, date: string): string {
  const s = useStore.getState();
  const ex = s.notes.find(n => n.eventId === e.id && n.date === date); if (ex) return ex.id;
  const docs = s.docs.filter(d => e.moduleId && d.moduleId === e.moduleId).slice(0, 5).map(d => `- [${d.name}](#/documents/${d.id})`);
  return s.add('notes', {
    title: `${e.title} – ${fmtDate(date, s.settings.dateFormat)}`, moduleId: e.moduleId, eventId: e.id, date, tags: ['lecture'], pinned: false, updated: Date.now(),
    body: `# ${e.title}\n*${fmtDate(date, s.settings.dateFormat, true)}${e.start ? ', ' + e.start : ''}${e.location ? ' · ' + e.location : ''}*\n\n## Key points\n- \n\n## Questions\n- \n\n## Follow-up\n- [ ] \n\n## Materials\n${docs.join('\n') || '- '}\n`,
  }).id;
}
export function EventDialog({ id, date, preset }: { id?: string; date: string; preset?: Partial<CalEvent> }) {
  const { events, add, update, remove } = useStore();
  const nav = useNavigate();
  const existing = events.find(e => e.id === id);
  const { d, set, bind } = useDraft<Omit<CalEvent, 'id'>>(existing ?? {
    title: '', type: 'lecture', moduleId: '', date, start: '10:00', end: '11:30', location: '', desc: '', repeat: 'none', until: '', reminder: 15, exceptions: [], ...preset,
  });
  const recurring = !!existing && existing.repeat !== 'none';
  const del = () => {
    if (!recurring) { remove('events', id!); closeDialog(); return; }
    openDialog(<Modal title="Delete recurring event" buttons={[{ label: 'Cancel' },
      { label: 'This occurrence', cls: 'danger', onClick: () => update('events', id!, { exceptions: [...existing!.exceptions, date] }) },
      { label: 'Entire series', cls: 'danger', onClick: () => remove('events', id!) }]}><p>Delete only this occurrence or the whole series?</p></Modal>);
  };
  const save = () => {
    if (!d.title.trim()) { toast('Title is required'); return false; }
    const v = { ...d, title: d.title.trim(), end: d.start ? d.end : '', until: d.repeat !== 'none' && !d.until ? addDays(d.date, 7 * 16) : d.until };
    if (id) update('events', id, v); else add('events', v);
  };
  return <Modal title={id ? 'Edit event' : 'New event'} buttons={[
    ...(id ? [{ label: 'Delete', cls: 'danger left', keepOpen: true, onClick: del },
      ...(existing!.moduleId ? [{ label: '📓 Lecture workspace', onClick: () => { const s = ensureSession(existing!.moduleId, date, existing!.id, existing!.title); nav(`/modules/${existing!.moduleId}/workspace?s=${s.id}`); } }]
        : [{ label: '📝 Lecture note', onClick: () => { nav('/notes/' + lectureNote(existing!, date)); } }])] : []),
    { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: save }]}>
    {existing?.feed && <p className="small soon" style={{ marginTop: 0 }}>📡 From the calendar subscription “{useStore.getState().settings.icsFeeds.find(f => f.id === existing.feed)?.name ?? 'feed'}”. Title, time and place are replaced when it refreshes; your module link and reminder are kept.</p>}
    <Field label="Title *"><input type="text" {...bind('title')} autoFocus /></Field>
    <div className="grid2">
      <Field label="Type"><select {...bind('type')}>{['lecture', 'seminar', 'exam', 'study', 'office', 'other'].map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Module"><ModuleSelect value={d.moduleId} onChange={v => set('moduleId', v)} /></Field>
    </div>
    <div className="grid3"><Field label="Date"><input type="date" {...bind('date')} /></Field><Field label="Start (blank = all day)"><input type="time" {...bind('start')} /></Field><Field label="End"><input type="time" {...bind('end')} /></Field></div>
    <div className="grid3">
      <Field label="Repeats"><select {...bind('repeat')}><option value="none">No</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option></select></Field>
      <Field label="Repeat until"><input type="date" {...bind('until')} /></Field>
      <Field label="Reminder"><select value={String(d.reminder)} onChange={e => set('reminder', e.target.value === '' ? '' : +e.target.value)}>
        <option value="">None</option><option value="5">5 min before</option><option value="15">15 min before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></Field>
    </div>
    <Field label="Room / location / link"><input type="text" {...bind('location')} /></Field>
    <Field label="Description"><textarea {...bind('desc')} /></Field>
  </Modal>;
}

/* ---------- task ---------- */
export function TaskDialog({ id, preset }: { id?: string; preset?: Partial<Task> }) {
  const { tasks, docs, settings, add, update, remove } = useStore();
  const existing = tasks.find(t => t.id === id);
  const { d, set, bind } = useDraft<Omit<Task, 'id'>>(existing ?? newTask(preset));
  const save = () => {
    if (!d.title.trim()) { toast('Title is required'); return false; }
    const v = { ...d, title: d.title.trim(), priority: +d.priority as 1 | 2 | 3, estimate: +d.estimate || 0, spent: +d.spent || 0 };
    if (id) update('tasks', id, v); else add('tasks', v);
  };
  const setSub = (i: number, p: Partial<{ t: string; done: boolean }>) => set('subtasks', d.subtasks.map((s, j) => j === i ? { ...s, ...p } : s));
  const progress = d.subtasks.length ? Math.round(d.subtasks.filter(s => s.done).length / d.subtasks.length * 100) : null;
  return <Modal title={id ? 'Edit task' : 'New task'} buttons={[
    ...(id ? [{ label: 'Delete', cls: 'danger left', keepOpen: true, onClick: () => confirmBox('Delete this task?', () => remove('tasks', id)) }] : []),
    { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: save }]}>
    <Field label="Title *"><input type="text" {...bind('title')} autoFocus /></Field>
    <div className="grid3">
      <Field label="Module / project"><ModuleSelect value={d.moduleId} onChange={v => set('moduleId', v)} /></Field>
      <Field label="Type"><select {...bind('type')}>{['Homework', 'Assignment', 'Essay', 'Exam preparation', 'Reading', 'Group project', 'Administrative', 'Thesis', 'Study goal'].map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Priority"><select value={d.priority} onChange={e => set('priority', +e.target.value as 1 | 2 | 3)}><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option></select></Field>
    </div>
    <div className="grid3">
      <Field label="Due date"><input type="date" {...bind('due')} /></Field><Field label="Start date"><input type="date" {...bind('start')} /></Field>
      <Field label="Stage / status"><select {...bind('status')}>{settings.stages.map(s => <option key={s}>{s}</option>)}</select></Field>
    </div>
    <div className="grid3">
      <Field label="Estimated (min)"><input type="number" {...bind('estimate')} /></Field><Field label="Time spent (min)"><input type="number" {...bind('spent')} /></Field>
      <Field label="Submission link"><input type="url" {...bind('link')} /></Field>
    </div>
    <Field label="Description"><textarea {...bind('desc')} /></Field>
    <div className="sec-title">Subtasks / checklist {progress != null && `· ${progress}%`}</div>
    {d.subtasks.map((s, i) => <div className="sub" key={i}>
      <input type="checkbox" checked={s.done} onChange={e => setSub(i, { done: e.target.checked })} />
      <input type="text" value={s.t} onChange={e => setSub(i, { t: e.target.value })} />
      <button className="icon-btn" onClick={() => set('subtasks', d.subtasks.filter((_, j) => j !== i))}>✕</button></div>)}
    <button className="btn sm" onClick={() => set('subtasks', [...d.subtasks, { t: '', done: false }])}>＋ Add subtask</button>
    {docs.length > 0 && <Field label="Related documents (hold Ctrl to select several)">
      <select multiple value={d.docIds} onChange={e => set('docIds', [...e.target.selectedOptions].map(o => o.value))}>{docs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
  </Modal>;
}

export { uid };
