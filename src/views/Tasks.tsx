import { useState } from 'react';
import { isDone, modName, useStore } from '../lib/store';
import type { Task } from '../lib/types';
import { addDays, diffDays, fmtDur, parseD, DOW, today } from '../lib/util';
import { Empty, ModuleSelect, openDialog } from '../components/ui';
import { TaskRow } from '../components/rows';
import { TaskDialog } from '../components/editors';
import { useUrlState } from '../lib/nav';
import { smartScore } from '../lib/planner';
import { PlanDialog } from '../components/Plan';

type Mode = 'list' | 'kanban';
type Group = 'none' | 'module' | 'deadline' | 'priority';


function Workload() {
  const { tasks, settings: S } = useStore();
  const t = today(), cap = S.dailyHours * 60;
  const days = [...Array(14)].map((_, i) => addDays(t, i));
  const load = days.map((d, i) => tasks.filter(x => !isDone(x, S) && x.estimate && (i === 0 ? x.due && x.due <= d : x.due === d)).reduce((a, x) => a + x.estimate - x.spent, 0));
  const max = Math.max(cap, ...load, 1);
  return <div className="card" style={{ marginBottom: 16 }}>
    <h2>Workload · next 14 days <span className="sp small muted">estimated effort by due date (capacity {S.dailyHours}h/day)</span></h2>
    <div className="wl">{days.map((d, i) => <div key={d} title={fmtDur(load[i])}>
      <i className={load[i] > cap ? 'over' : ''} style={{ height: (load[i] / max) * 70 }} />{DOW[parseD(d).getDay()][0]}{parseD(d).getDate()}</div>)}</div>
  </div>;
}

export default function Tasks() {
  const { tasks, modules, settings: S, update } = useStore();
  const [mode, setMode] = useUrlState<Mode>('view', 'kanban', ['kanban', 'list']);
  const [group, setGroup] = useState<Group>('none');
  const [mf, setMf] = useState('all');
  const [showDone, setShowDone] = useState(false);
  const [smart, setSmart] = useState(false);
  const [q, setQ] = useState('');
  const t = today();

  let list = tasks.filter(x => (mf === 'all' || (mf === 'none' ? !x.moduleId : x.moduleId === mf)) && (!q || x.title.toLowerCase().includes(q.toLowerCase())));
  if (!showDone && mode === 'list') list = list.filter(x => !isDone(x, S));
  list = [...list].sort(smart ? (a, b) => smartScore(b) - smartScore(a) : (a, b) => +isDone(a, S) - +isDone(b, S) || (a.due || '9').localeCompare(b.due || '9'));

  const groups = (): [string, Task[]][] => {
    if (group === 'none') return [['', list]];
    const key = (x: Task) => group === 'module' ? modName(modules, x.moduleId) : group === 'priority' ? ['', 'Low', 'Medium', 'High'][x.priority] + ' priority'
      : !x.due ? 'No date' : x.due < t ? 'Overdue' : x.due === t ? 'Today' : diffDays(x.due, t) <= 7 ? 'This week' : 'Later';
    const m = new Map<string, Task[]>(); list.forEach(x => m.set(key(x), [...(m.get(key(x)) ?? []), x]));
    const order = ['Overdue', 'Today', 'This week', 'Later', 'No date', 'High priority', 'Medium priority', 'Low priority'];
    return [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) || a[0].localeCompare(b[0]));
  };

  return <>
    <div className="page-head"><h1>Tasks</h1>
      <div className="seg">{(['kanban', 'list'] as Mode[]).map(v => <button key={v} className={mode === v ? 'on' : ''} onClick={() => setMode(v)}>{v === 'kanban' ? 'Board' : 'List'}</button>)}</div>
      <button className="btn" onClick={() => openDialog(<PlanDialog />)}>🗓 Plan my week</button>
      <button className="btn primary" onClick={() => openDialog(<TaskDialog />)}>＋ New task</button></div>
    <div className="row" style={{ marginBottom: 16 }}>
      <input type="search" placeholder="Filter tasks…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }} />
      <div style={{ width: 220 }}><ModuleSelect value={mf === 'all' ? '' : mf} onChange={v => setMf(v || 'all')} none="All modules" /></div>
      <button className={'btn sm' + (mf === 'none' ? ' primary' : '')} onClick={() => setMf(mf === 'none' ? 'all' : 'none')}>No module</button>
      {mode === 'list' && <>
        <select style={{ width: 170 }} value={group} onChange={e => setGroup(e.target.value as Group)}><option value="none">No grouping</option><option value="module">Group by module</option><option value="deadline">Group by deadline</option><option value="priority">Group by priority</option></select>
        <label><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show completed</label></>}
      <label title="Order by deadline, priority and estimated effort"><input type="checkbox" checked={smart} onChange={e => setSmart(e.target.checked)} /> Suggest priorities</label>
    </div>
    <Workload />
    {mode === 'list' ? (list.length ? groups().map(([g, items]) => <div key={g} className="card" style={{ marginBottom: 12 }}>
      {g && <h2>{g} <span className="badge neutral">{items.length}</span></h2>}<div className="list">{items.map(x => <TaskRow key={x.id} t={x} />)}</div></div>)
      : <div className="card"><Empty>No tasks match.</Empty></div>)
      : <div className="kanban">{S.stages.map(stage => {
        const items = list.filter(x => x.status === stage || (!S.stages.includes(x.status) && stage === S.stages[0]));
        return <div key={stage} className="col"
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
          onDragLeave={e => e.currentTarget.classList.remove('dragover')}
          onDrop={e => {
            e.preventDefault(); e.currentTarget.classList.remove('dragover');
            const id = e.dataTransfer.getData('text/plain'); if (id) update('tasks', id, { status: stage, doneAt: stage === S.stages[S.stages.length - 1] ? Date.now() : null });
          }}>
          <h3>{stage}<span>{items.length}</span></h3>
          {items.map(x => {
            const sub = x.subtasks.length ? `${x.subtasks.filter(s => s.done).length}/${x.subtasks.length}` : '';
            return <div key={x.id} className="tcard" draggable onDragStart={e => e.dataTransfer.setData('text/plain', x.id)} onClick={() => openDialog(<TaskDialog id={x.id} />)}>
              <div className="row" style={{ gap: 6 }}><span className={'pri pri' + x.priority} /><strong style={{ fontSize: 13 }}>{x.title}</strong></div>
              <div className="row small muted" style={{ gap: 8, marginTop: 4 }}>
                {x.moduleId && <span>{modName(modules, x.moduleId)}</span>}
                {x.due && <span className={x.due < t && !isDone(x, S) ? 'overdue' : ''}>📅 {x.due}</span>}
                {sub && <span>☑ {sub}</span>}{x.estimate > 0 && <span>⏱ {fmtDur(x.spent)}/{fmtDur(x.estimate)}</span>}</div>
            </div>;
          })}
        </div>;
      })}</div>}
  </>;
}
