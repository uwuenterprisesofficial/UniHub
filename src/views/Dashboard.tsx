import { useNavigate, Link } from 'react-router-dom';
import { type ReactNode } from 'react';
import { eventColor, getData, isDone, modColor, progressOf, useStore } from '../lib/store';
import { conflictSet, occurrences } from '../lib/schedule';
import { DOW, addDays, fmtDate, parseD, relDay, today, weekStart } from '../lib/util';
import { Card, Empty, Modal, openDialog } from '../components/ui';
import { DocRow, EventRow, TaskRow } from '../components/rows';
import { EventDialog, ModuleDialog, TaskDialog } from '../components/editors';
import { loadSample } from '../lib/sample';
import type { Data } from '../lib/types';

export interface Notif { lvl: number; text: string; sub: string; go: () => void }
export function computeNotifications(d: Data): Notif[] {
  const t = today(), n: Notif[] = [], f = d.settings.dateFormat;
  const open = d.tasks.filter(x => !isDone(x, d.settings));
  open.filter(x => x.due && x.due < t).forEach(x => n.push({ lvl: 3, text: `Overdue: ${x.title}`, sub: `due ${fmtDate(x.due, f)}`, go: () => openDialog(<TaskDialog id={x.id} />) }));
  open.filter(x => x.due >= t && x.due <= addDays(t, 2)).forEach(x => n.push({ lvl: 2, text: `Due ${relDay(x.due)}: ${x.title}`, sub: d.modules.find(m => m.id === x.moduleId)?.name ?? '', go: () => openDialog(<TaskDialog id={x.id} />) }));
  const occ = occurrences(d.events, t, addDays(t, 14));
  occ.filter(o => o.ev.type === 'exam').forEach(o => n.push({ lvl: 2, text: `Exam ${relDay(o.date)}: ${o.ev.title}`, sub: fmtDate(o.date, f), go: () => openDialog(<EventDialog id={o.ev.id} date={o.date} />) }));
  const c = conflictSet(occ.filter(o => o.date <= addDays(t, 7)));
  if (c.size) n.push({ lvl: 1, text: `${Math.max(1, c.size >> 1)} scheduling conflict(s) this week`, sub: 'Open the calendar to resolve', go: () => { location.hash = '#/calendar'; } });
  return n.sort((a, b) => b.lvl - a.lvl);
}

const WIDGET_NAMES = { today: 'Today', deadlines: 'Upcoming deadlines', overdue: 'Overdue tasks', notifications: 'Notifications', progress: 'Academic progress', recent: 'Recent documents', week: 'Weekly overview' } as const;

function Customize() {
  const { settings, setSettings } = useStore();
  return <Modal title="Customize dashboard" buttons={[{ label: 'Done', cls: 'primary' }]}>
    {(Object.keys(WIDGET_NAMES) as (keyof typeof WIDGET_NAMES)[]).map(k =>
      <label key={k} style={{ display: 'block', padding: '4px 0' }}>
        <input type="checkbox" checked={settings.widgets[k]} onChange={e => setSettings({ widgets: { ...settings.widgets, [k]: e.target.checked } })} /> {WIDGET_NAMES[k]}</label>)}
  </Modal>;
}

export default function Dashboard() {
  const nav = useNavigate();
  const { modules, events, tasks, docs, notes, settings: S } = useStore();
  const data = getData(); const W = S.widgets, t = today(), hr = new Date().getHours();
  const todayEv = occurrences(events, t, t), todayTasks = tasks.filter(x => x.due === t && !isDone(x, S));
  const upcoming = tasks.filter(x => !isDone(x, S) && x.due > t && x.due <= addDays(t, 14)).sort((a, b) => a.due.localeCompare(b.due));
  const exams = occurrences(events, t, addDays(t, 60)).filter(o => o.ev.type === 'exam').slice(0, 3);
  const over = tasks.filter(x => !isDone(x, S) && x.due && x.due < t);
  const notifs = computeNotifications(data);
  const ws = weekStart(t, S.weekStart), days = [...Array(7)].map((_, i) => addDays(ws, i));
  const weekOcc = occurrences(events, ws, addDays(ws, 6)), conf = conflictSet(weekOcc);
  const ms = modules.filter(m => m.semester === S.currentSemester);
  const recent = [...docs].sort((a, b) => (b.opened || b.added) - (a.opened || a.added)).slice(0, 5);
  const widgets: ReactNode[] = [];

  if (W.today) widgets.push(<Card key="today" title="📅 Today"><div className="list">{todayEv.map(o => <EventRow key={o.ev.id} o={o} />)}{todayTasks.map(x => <TaskRow key={x.id} t={x} />)}</div>
    {!todayEv.length && !todayTasks.length && <Empty>Nothing scheduled today.</Empty>}</Card>);
  if (W.deadlines) widgets.push(<Card key="dl" title="⏰ Upcoming deadlines"><div className="list">{exams.map(o => <EventRow key={o.ev.id + o.date} o={o} />)}{upcoming.slice(0, 7).map(x => <TaskRow key={x.id} t={x} />)}</div>
    {!upcoming.length && !exams.length && <Empty>No deadlines in the next two weeks.</Empty>}</Card>);
  if (W.overdue) widgets.push(<Card key="od" title={`⚠️ Overdue${over.length ? ` (${over.length})` : ''}`}><div className="list">{over.map(x => <TaskRow key={x.id} t={x} />)}</div>{!over.length && <Empty>All caught up 🎉</Empty>}</Card>);
  if (W.notifications) widgets.push(<Card key="nt" title="🔔 Notifications"><div className="list">{notifs.slice(0, 6).map((n, i) =>
    <div key={i} className="itm" onClick={n.go}><span className={'pri pri' + n.lvl} /><div className="grow"><div className="t">{n.text}</div><div className="small muted">{n.sub}</div></div></div>)}</div>
    {!notifs.length && <Empty>No notifications.</Empty>}</Card>);
  if (W.progress) widgets.push(<Card key="pg" title="📚 Academic progress">{ms.length ? ms.map(m => {
    const p = progressOf(data, m.id), ts = tasks.filter(x => x.moduleId === m.id);
    return <div key={m.id} style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => nav('/modules/' + m.id)}>
      <div className="row small" style={{ justifyContent: 'space-between', gap: 4 }}><span>{m.icon || '📘'} {m.name}</span><span className="muted">{ts.filter(x => isDone(x, S)).length}/{ts.length} tasks · {p}%</span></div>
      <div className="bar"><i style={{ width: p + '%', ['--c' as string]: m.color }} /></div></div>;
  }) : <Empty>No modules in this semester yet.</Empty>}</Card>);
  if (W.recent) widgets.push(<Card key="rc" title="🕘 Recent documents"><div className="list">{recent.map(d => <DocRow key={d.id} d={d} />)}</div>{!recent.length && <Empty>No documents yet.</Empty>}</Card>);
  if (W.week) widgets.push(<Card key="wk" wide title="🗓 This week" extra={<Link to="/calendar">Open calendar →</Link>}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8 }}>{days.map(day => {
      const dd = parseD(day);
      return <div key={day} style={{ background: day === t ? 'var(--accent-soft)' : 'var(--panel2)', borderRadius: 8, padding: 8, minHeight: 90 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{DOW[dd.getDay()]} {dd.getDate()}</div>
        {weekOcc.filter(o => o.date === day).map(o => <span key={o.ev.id} className={'pill' + (conf.has(o.ev.id + o.date) ? ' conf' : '')} style={{ ['--c' as string]: eventColor(o.ev, modules), marginBottom: 2 }}
          onClick={() => openDialog(<EventDialog id={o.ev.id} date={o.date} />)}>{o.ev.start} {o.ev.title}</span>)}
        {tasks.filter(x => x.due === day && !isDone(x, S)).map(x => <span key={x.id} className="pill task" style={{ ['--c' as string]: modColor(modules, x.moduleId), marginBottom: 2 }}
          onClick={() => openDialog(<TaskDialog id={x.id} />)}>☐ {x.title}</span>)}
      </div>;
    })}</div></Card>);

  return <>
    <div className="page-head">
      <div><h1>{hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'} 👋</h1><div className="muted">{fmtDate(t, S.dateFormat, true)} · {S.currentSemester}</div></div>
      <button className="btn" onClick={() => openDialog(<Customize />)}>⚙ Customize</button>
    </div>
    {!modules.length && !tasks.length && !notes.length && <div className="card" style={{ marginBottom: 16 }}>
      <h2>Welcome to UniHub</h2>
      <p>Start by adding your first module, or load some sample data to look around. Everything is saved to your account.</p>
      <div className="row"><button className="btn primary" onClick={() => openDialog(<ModuleDialog />)}>＋ Add module</button>
        <button className="btn" onClick={loadSample}>Load sample data</button><button className="btn" onClick={() => nav('/settings')}>Configure semesters</button></div></div>}
    <div className="dash">{widgets}</div>
  </>;
}
