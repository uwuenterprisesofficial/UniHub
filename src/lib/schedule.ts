import type { CalEvent, Occurrence } from './types';
import { addDays, diffDays, toMin } from './util';

const STEP: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14 };

export function occurrences(events: CalEvent[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    const step = STEP[ev.repeat];
    if (!step) { if (ev.date >= from && ev.date <= to) out.push({ ev, date: ev.date }); continue; }
    const end = ev.until && ev.until < to ? ev.until : to;
    let d = ev.date;
    if (d < from) d = addDays(d, Math.floor(diffDays(from, d) / step) * step);
    for (; d <= end; d = addDays(d, step))
      if (d >= from && !ev.exceptions.includes(d)) out.push({ ev, date: d });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ev.start.localeCompare(b.ev.start));
}

export function conflictSet(occs: Occurrence[]): Set<string> {
  const bad = new Set<string>();
  for (let i = 0; i < occs.length; i++) for (let j = i + 1; j < occs.length; j++) {
    const a = occs[i], b = occs[j];
    if (a.date !== b.date || !a.ev.start || !b.ev.start) continue;
    if (toMin(a.ev.start) < toMin(b.ev.end || a.ev.start) && toMin(b.ev.start) < toMin(a.ev.end || b.ev.start)) {
      bad.add(a.ev.id + a.date); bad.add(b.ev.id + b.date);
    }
  }
  return bad;
}

/* ---- ICS ---- */
const icsDate = (d: string, t?: string) => d.replace(/-/g, '') + (t ? 'T' + t.replace(':', '') + '00' : '');
const icsEsc = (s: string) => (s || '').replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');

export function exportICS(events: CalEvent[]): string {
  const L: (string | null)[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UniHub//EN'];
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.id}@unihub`, `DTSTAMP:${stamp}`,
      e.start ? `DTSTART:${icsDate(e.date, e.start)}` : `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      e.start ? `DTEND:${icsDate(e.date, e.end || e.start)}` : null,
      'SUMMARY:' + icsEsc(e.title), e.location ? 'LOCATION:' + icsEsc(e.location) : null,
      e.desc ? 'DESCRIPTION:' + icsEsc(e.desc) : null);
    const f = { daily: 'DAILY', weekly: 'WEEKLY', biweekly: 'WEEKLY;INTERVAL=2', none: '' }[e.repeat];
    if (f) L.push('RRULE:FREQ=' + f + (e.until ? ';UNTIL=' + icsDate(e.until) : ''));
    e.exceptions.forEach(x => L.push('EXDATE' + (e.start ? '' : ';VALUE=DATE') + ':' + icsDate(x, e.start)));
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.filter(Boolean).join('\r\n');
}

export { parseICS } from './ics';
