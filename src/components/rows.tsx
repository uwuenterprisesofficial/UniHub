import { useNavigate } from 'react-router-dom';
import type { DocMeta, Occurrence, Task } from '../lib/types';
import { doneStage, eventColor, isDone, useStore } from '../lib/store';
import { diffDays, fmtDate, relDay, today } from '../lib/util';
import { ModChip, openDialog } from './ui';
import { EventDialog, TaskDialog } from './editors';
import { ensureSession } from '../lib/lecture';

export function toggleTask(t: Task) {
  const { settings, update } = useStore.getState();
  const done = isDone(t, settings);
  update('tasks', t.id, { status: done ? settings.stages[0] : doneStage(settings), doneAt: done ? null : Date.now() });
}

export function DueLabel({ due }: { due: string }) {
  const f = useStore(s => s.settings.dateFormat);
  if (!due) return null;
  const n = diffDays(due, today());
  return <span className={'small ' + (n < 0 ? 'overdue' : n <= 2 ? 'soon' : 'muted')}>{fmtDate(due, f)} · {relDay(due)}</span>;
}

export function TaskRow({ t }: { t: Task }) {
  const settings = useStore(s => s.settings);
  const done = isDone(t, settings);
  return <div>
    <div className={'check' + (done ? ' on' : '')} onClick={() => toggleTask(t)}>{done ? '✓' : ''}</div>
    <span className={'pri pri' + t.priority} title="Priority" />
    <div className="grow itm" onClick={() => openDialog(<TaskDialog id={t.id} />)}>
      <div className="t" style={done ? { textDecoration: 'line-through', opacity: .6 } : {}}>{t.title}</div>
      <div className="row small" style={{ gap: 8 }}><ModChip id={t.moduleId} />{t.type && <span className="muted">{t.type}</span>}<DueLabel due={t.due} /></div>
    </div>
  </div>;
}

export function EventRow({ o }: { o: Occurrence }) {
  const nav = useNavigate(); const mods = useStore(s => s.modules); const f = useStore(s => s.settings.dateFormat);
  const e = o.ev;
  return <div>
    <span className="chip dot" style={{ ['--c' as string]: eventColor(e, mods) }}>{e.start ? `${e.start}${e.end ? '–' + e.end : ''}` : 'all day'}</span>
    <div className="grow itm" onClick={() => openDialog(<EventDialog id={e.id} date={o.date} />)}>
      <div className="t">{e.title}</div>
      <div className="small muted">{[e.type, e.location, o.date !== today() && fmtDate(o.date, f)].filter(Boolean).join(' · ')}</div>
    </div>
    {e.moduleId && (e.type === 'lecture' || e.type === 'seminar') && <button className="btn sm" title="Open the lecture workspace" onClick={() => { const s = ensureSession(e.moduleId, o.date, e.id, e.title); nav(`/modules/${e.moduleId}/workspace?s=${s.id}`); }}>📓</button>}
  </div>;
}

export function DocRow({ d }: { d: DocMeta }) {
  const nav = useNavigate(); const mods = useStore(s => s.modules);
  return <div>
    <div className="dicon" style={{ width: 32, height: 36 }}>{d.ext.toUpperCase().slice(0, 4)}</div>
    <div className="grow itm" onClick={() => nav('/documents/' + d.id)}><div className="t">{d.name}</div>
      <div className="small muted">{mods.find(m => m.id === d.moduleId)?.name ?? 'No module'}</div></div>
  </div>;
}
