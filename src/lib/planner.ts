import { occurrences } from './schedule';
import type { Task } from './types';
import type { Data } from './types';
import { addDays, diffDays, fromMin, toMin, today } from './util';

/* Suggests study blocks for open tasks. Greedy and explainable: most urgent first, only into free time,
   never past the task's due date, never above the daily study capacity. Nothing is created without confirmation. */
export interface Block { taskId: string; title: string; moduleId: string; date: string; start: string; end: string }
export interface Plan { blocks: Block[]; short: { taskId: string; title: string; missing: number; due: string }[]; days: string[] }

const DAY_START = 8 * 60, DAY_END = 21 * 60, MIN_BLOCK = 30, MAX_BLOCK = 90;
export const PLAN_TAG = 'planned:';

export function planWeek(d: Data, horizon = 7): Plan {
  const t0 = today(), days = [...Array(horizon)].map((_, i) => addDays(t0, i)), cap = d.settings.dailyHours * 60;
  const last = days[days.length - 1];
  const occ = occurrences(d.events, t0, last).filter(o => o.ev.start);
  const busy = new Map<string, [number, number][]>(), used = new Map<string, number>();
  for (const day of days) {
    const list = occ.filter(o => o.date === day).map(o => [toMin(o.ev.start), Math.max(toMin(o.ev.end || o.ev.start), toMin(o.ev.start) + 15)] as [number, number]);
    busy.set(day, list);
    used.set(day, occ.filter(o => o.date === day && o.ev.type === 'study').reduce((a, o) => a + toMin(o.ev.end || o.ev.start) - toMin(o.ev.start), 0));
  }
  // time already planned for a task earlier counts as done
  const planned = new Map<string, number>();
  d.events.forEach(e => { const m = e.desc.match(new RegExp(PLAN_TAG + '(\\w+)')); if (m && e.date >= t0) planned.set(m[1], (planned.get(m[1]) ?? 0) + toMin(e.end || e.start) - toMin(e.start)); });

  const done = d.settings.stages[d.settings.stages.length - 1];
  const tasks = d.tasks.filter(t => t.status !== done && t.estimate > 0).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || smartScore(b) - smartScore(a)); // earliest deadline first keeps the most plans feasible
  const blocks: Block[] = [], short: Plan['short'] = [];
  for (const t of tasks) {
    let need = t.estimate - t.spent - (planned.get(t.id) ?? 0); if (need < MIN_BLOCK) continue;
    const lastDay = t.due ? (t.due < t0 ? t0 : t.due < last ? t.due : last) : last;
    const perDay = new Map<string, number>();
    for (const day of days) {
      if (day > lastDay || need < MIN_BLOCK) break;
      while (need >= MIN_BLOCK && (perDay.get(day) ?? 0) < 2) {
        const room = cap - (used.get(day) ?? 0); if (room < MIN_BLOCK) break;
        const iv = [...busy.get(day)!].sort((a, b) => a[0] - b[0]); let cursor = day === t0 ? Math.max(DAY_START, Math.ceil((new Date().getHours() * 60 + new Date().getMinutes() + 30) / 15) * 15) : DAY_START, slot: [number, number] | null = null;
        for (const [s, e] of [...iv, [DAY_END, DAY_END] as [number, number]]) { if (s - cursor >= MIN_BLOCK && Math.min(s, DAY_END) - cursor >= MIN_BLOCK) { slot = [cursor, Math.min(s, DAY_END)]; break; } cursor = Math.max(cursor, e); }
        if (!slot) break;
        const len = Math.min(need, MAX_BLOCK, slot[1] - slot[0], room);
        if (len < MIN_BLOCK) break;
        blocks.push({ taskId: t.id, title: t.title, moduleId: t.moduleId, date: day, start: fromMin(slot[0]), end: fromMin(slot[0] + len) });
        busy.get(day)!.push([slot[0], slot[0] + len + 10]); used.set(day, (used.get(day) ?? 0) + len); perDay.set(day, (perDay.get(day) ?? 0) + 1); need -= len;
      }
    }
    if (need >= MIN_BLOCK && t.due && diffDays(t.due, t0) <= horizon) short.push({ taskId: t.id, title: t.title, missing: need, due: t.due });
  }
  return { blocks: blocks.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)), short, days };
}

/** Higher = more urgent: close deadline, high priority, big effort. */
export const smartScore = (t: Task) => {
  const days = t.due ? Math.max(diffDays(t.due, today()), 0) : 30;
  return t.priority * 10 + (t.estimate / 60) * 2 + 40 / (days + 1);
};
