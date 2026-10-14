import { useMemo } from 'react';
import { getData, modColor, useStore } from '../lib/store';
import { PLAN_TAG, planWeek } from '../lib/planner';
import { DOW, fmtDate, fmtDur, parseD, toMin } from '../lib/util';
import { Modal, toast } from './ui';

export function PlanDialog() {
  const { add, modules, settings: S } = useStore();
  const plan = useMemo(() => planWeek(getData(), 7), []);
  const total = plan.blocks.reduce((a, b) => a + toMin(b.end) - toMin(b.start), 0);
  const create = () => {
    plan.blocks.forEach(b => add('events', { title: `Study: ${b.title}`, type: 'study', moduleId: b.moduleId, date: b.date, start: b.start, end: b.end, location: '', desc: PLAN_TAG + b.taskId, repeat: 'none', until: '', exceptions: [], reminder: 15 }));
    toast(`${plan.blocks.length} study sessions added to your calendar`);
  };
  return <Modal title="Plan my week" wide buttons={[{ label: 'Close' }, ...(plan.blocks.length ? [{ label: `Add ${plan.blocks.length} sessions to calendar`, cls: 'primary', onClick: create }] : [])]}>
    <p className="small muted">Open tasks with a time estimate are placed into free slots, most urgent first, never after their due date and never above {S.dailyHours} h of study per day. Nothing is added until you confirm.</p>
    {plan.short.length > 0 && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
      <b>⚠ Not enough free time before the deadline</b>
      {plan.short.map(s => <div key={s.taskId} className="small">{s.title} — {fmtDur(s.missing)} still unscheduled, due {fmtDate(s.due, S.dateFormat)}</div>)}</div>}
    {plan.blocks.length === 0 && <div className="empty">Nothing to schedule. Give open tasks a time estimate (and a due date) so they can be planned.</div>}
    {plan.days.map(day => { const bs = plan.blocks.filter(b => b.date === day); if (!bs.length) return null; const dd = parseD(day);
      return <div key={day} style={{ marginBottom: 10 }}><div className="sec-title" style={{ marginTop: 6 }}>{DOW[dd.getDay()]} {fmtDate(day, S.dateFormat)} · {fmtDur(bs.reduce((a, b) => a + toMin(b.end) - toMin(b.start), 0))}</div>
        {bs.map((b, i) => <div key={i} className="row small" style={{ padding: '3px 0' }}><span className="chip dot" style={{ ['--c' as string]: modColor(modules, b.moduleId) }}>{b.start}–{b.end}</span>{b.title}</div>)}</div>; })}
    {plan.blocks.length > 0 && <p className="small muted">Total: {fmtDur(total)} across {new Set(plan.blocks.map(b => b.date)).size} days.</p>}
  </Modal>;
}
