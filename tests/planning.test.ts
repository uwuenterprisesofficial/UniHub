import { describe, expect, it } from 'vitest';
import { findDates, findDeadlines } from '../src/lib/deadlines';
import { planWeek, smartScore } from '../src/lib/planner';
import { toMin } from '../src/lib/util';
import { D, emptyData, event, task } from './fixtures';

describe('findDates', () => {
  it('parses ISO, German dotted, slash and long dates', () => {
    const t = '2026-03-02 and 12.11.2026 and 3/4/2026 and 2 November 2026 and March 2, 2026 and 5. Mai 2027';
    expect(findDates(t, 'DMY').map(d => d.date)).toEqual(['2026-03-02', '2026-11-12', '2026-04-03', '2026-11-02', '2026-03-02', '2027-05-05']);
  });
  it('reads slash dates as month/day for the US format', () => { expect(findDates('3/4/2026', 'MDY')[0].date).toBe('2026-03-04'); });
  it('rejects impossible dates', () => { expect(findDates('31.02.2026 and 2026-13-40 and 12/31/1999')).toEqual([]); });
});

describe('findDeadlines', () => {
  const sheet = `Problem set 5 must be submitted by ${D(6)} via the portal.\n\nThe midterm exam takes place on ${D(20)}.\n\nThe old deadline was ${D(-4)}.\n\nA lecture on ${D(3)} covers graphs.`;
  const found = findDeadlines(sheet, []);
  it('keeps upcoming sentences that contain a cue word and a date', () => {
    expect(found.map(f => f.due)).toEqual([D(6), D(20)]);
    expect(found[1].exam).toBe(true); expect(found[1].type).toBe('Exam preparation');
  });
  it('skips dates in the past and dates without a deadline cue', () => { expect(found.some(f => f.due === D(-4) || f.due === D(3))).toBe(false); });
  it('does not propose what is already a task', () => {
    const again = findDeadlines(sheet, [task({ title: 'Problem set 5 must be submitted', due: D(6) })]);
    expect(again.map(f => f.due)).toEqual([D(20)]);
  });
});

describe('planWeek', () => {
  const planned = (d: ReturnType<typeof emptyData>) => planWeek(d, 7);
  it('plans nothing without estimates', () => { const d = emptyData(); d.tasks.push(task()); expect(planned(d).blocks).toEqual([]); });

  it('never schedules a task after its due date and never overlaps events', () => {
    const d = emptyData();
    const t = task({ title: 'Essay', estimate: 240, due: D(4) });
    d.tasks.push(t);
    for (let i = 1; i <= 4; i++) d.events.push(event({ date: D(i), start: '09:00', end: '12:00' }));
    const p = planned(d);
    expect(p.blocks.length).toBeGreaterThan(0);
    for (const b of p.blocks) {
      expect(b.date <= D(4)).toBe(true);
      for (const e of d.events.filter(e => e.date === b.date)) expect(toMin(b.end) <= toMin(e.start) || toMin(b.start) >= toMin(e.end)).toBe(true);
    }
    expect(p.blocks.reduce((a, b) => a + toMin(b.end) - toMin(b.start), 0)).toBe(240);
  });

  it('respects the daily study capacity', () => {
    const d = emptyData(); d.settings.dailyHours = 2;
    d.tasks.push(task({ estimate: 600, due: D(6) }));
    const perDay = new Map<string, number>();
    for (const b of planned(d).blocks) perDay.set(b.date, (perDay.get(b.date) ?? 0) + toMin(b.end) - toMin(b.start));
    for (const v of perDay.values()) expect(v).toBeLessThanOrEqual(120);
  });

  it('plans the earliest deadline first so a small urgent task is not starved by a big later one', () => {
    const d = emptyData(); d.settings.dailyHours = 2;
    const small = task({ title: 'small urgent', estimate: 90, due: D(2) }), big = task({ title: 'big later', estimate: 600, priority: 3, due: D(6) });
    d.tasks.push(big, small);
    const p = planned(d);
    expect(p.short.find(s => s.taskId === small.id)).toBeUndefined();
    expect(p.blocks.filter(b => b.taskId === small.id).reduce((a, b) => a + toMin(b.end) - toMin(b.start), 0)).toBe(90);
  });

  it('reports a shortfall when the deadline cannot be met', () => {
    const d = emptyData(); d.settings.dailyHours = 1;
    d.tasks.push(task({ title: 'impossible', estimate: 900, due: D(2) }));
    expect(planned(d).short.map(s => s.title)).toContain('impossible');
  });

  it('counts already planned sessions so planning twice does not duplicate', () => {
    const d = emptyData(); const t = task({ estimate: 120, due: D(5) }); d.tasks.push(t);
    const first = planned(d);
    first.blocks.forEach(b => d.events.push(event({ date: b.date, start: b.start, end: b.end, type: 'study', desc: 'planned:' + t.id })));
    expect(planned(d).blocks).toEqual([]);
  });

  it('skips finished tasks', () => {
    const d = emptyData(); d.tasks.push(task({ estimate: 120, due: D(5), status: d.settings.stages.at(-1)! }));
    expect(planned(d).blocks).toEqual([]);
  });
});

describe('smartScore', () => {
  it('ranks closer deadlines and higher priorities first', () => {
    expect(smartScore(task({ due: D(1), priority: 2 }))).toBeGreaterThan(smartScore(task({ due: D(20), priority: 2 })));
    expect(smartScore(task({ due: D(5), priority: 3 }))).toBeGreaterThan(smartScore(task({ due: D(5), priority: 1 })));
  });
});
