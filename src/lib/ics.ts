import type { CalEvent, Repeat } from './types';
import { addDays, diffDays, fmt, parseD, pad, uid } from './util';

/* iCalendar reader for real-world feeds (Google, Outlook, university timetables).
   Supported: UTC and floating times, all-day events, RRULE DAILY/WEEKLY (INTERVAL 1-2, BYDAY lists, UNTIL, COUNT), EXDATE,
   single changed occurrences (RECURRENCE-ID) and cancelled events. Times with a TZID are read as the wall-clock time in the
   user's own time zone. MONTHLY/YEARLY rules are imported as their first occurrence. */
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
interface Prop { name: string; params: Record<string, string>; value: string }

const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
function parseProp(line: string): Prop | null {
  const i = line.indexOf(':'); if (i < 0) return null;
  const [name, ...ps] = line.slice(0, i).split(';');
  const params: Record<string, string> = {}; ps.forEach(p => { const [k, v] = p.split('='); if (k) params[k.toUpperCase()] = (v ?? '').replace(/"/g, ''); });
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

/** "20260301T090000Z" → local {d:'2026-03-01', t:'10:00'}; date-only and floating values are taken as they are. */
export function parseICSDate(value: string, params: Record<string, string> = {}): { d: string; t: string } | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/); if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h == null || params.VALUE === 'DATE') return { d: `${y}-${mo}-${d}`, t: '' };
  if (z) { const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)); return { d: fmt(dt), t: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` }; }
  return { d: `${y}-${mo}-${d}`, t: `${h}:${mi}` };
}

interface Raw { props: Prop[]; get: (n: string) => Prop | undefined; all: (n: string) => Prop[] }
function readEvents(text: string): Raw[] {
  const out: Raw[] = []; let cur: Prop[] | null = null; let nested = 0;
  for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') { cur = []; nested = 0; continue; }
    if (cur && /^BEGIN:/.test(line)) { nested++; continue; }          // VALARM etc. inside an event
    if (cur && /^END:/.test(line) && line !== 'END:VEVENT') { nested--; continue; }
    if (line === 'END:VEVENT') { if (cur) { const props = cur; out.push({ props, get: n => props.find(p => p.name === n), all: n => props.filter(p => p.name === n) }); } cur = null; continue; }
    if (cur && nested === 0) { const p = parseProp(line); if (p) cur.push(p); }
  }
  return out;
}

function guessType(title: string, desc: string): CalEvent['type'] {
  const l = (title + ' ' + desc).toLowerCase();
  return /exam|klausur|prüfung|midterm|final/.test(l) ? 'exam' : /seminar|übung|tutorial|lab\b/.test(l) ? 'seminar' : /lecture|vorlesung/.test(l) ? 'lecture' : 'other';
}
const firstOnOrAfter = (start: string, weekday: number) => { const d = parseD(start); return addDays(start, (weekday - d.getDay() + 7) % 7); };

export interface ParsedEvent extends CalEvent { uid: string }

export function parseICS(text: string): ParsedEvent[] {
  const raws = readEvents(text), out: ParsedEvent[] = [];
  const overrides: { uid: string; date: string; ev: ParsedEvent }[] = [];

  for (const r of raws) {
    if (r.get('STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
    const title = unesc(r.get('SUMMARY')?.value ?? '').trim(); const ds = r.get('DTSTART'); if (!title || !ds) continue;
    const s = parseICSDate(ds.value, ds.params); if (!s) continue;
    const de = r.get('DTEND'), e = de ? parseICSDate(de.value, de.params) : null;
    const desc = unesc(r.get('DESCRIPTION')?.value ?? ''), id0 = r.get('UID')?.value.trim() || `${title}|${s.d}|${s.t}`;
    const base: ParsedEvent = {
      id: uid(), uid: id0, title, type: guessType(title, desc), moduleId: '', date: s.d, start: s.t,
      end: s.t && e && e.t ? (e.d === s.d ? e.t : '23:59') : '', // an event running past midnight is cut at the end of its first day
      location: unesc(r.get('LOCATION')?.value ?? ''), desc, repeat: 'none', until: '', exceptions: [], reminder: '',
    };

    const rid = r.get('RECURRENCE-ID');
    if (rid) { const d = parseICSDate(rid.value, rid.params); if (d) overrides.push({ uid: id0, date: d.d, ev: { ...base, uid: `${id0}@${d.d}` } }); continue; }

    for (const x of r.all('EXDATE')) for (const v of x.value.split(',')) { const d = parseICSDate(v, x.params); if (d) base.exceptions.push(d.d); }

    const rule = r.get('RRULE');
    if (!rule) { out.push(base); continue; }
    const p = Object.fromEntries(rule.value.split(';').map(kv => kv.split('='))) as Record<string, string>;
    const interval = Math.max(1, +(p.INTERVAL ?? 1));
    let repeat: Repeat = 'none', step = 0;
    if (p.FREQ === 'DAILY' && interval === 1) { repeat = 'daily'; step = 1; }
    else if (p.FREQ === 'WEEKLY' && (interval === 1 || interval === 2)) { repeat = interval === 2 ? 'biweekly' : 'weekly'; step = 7 * interval; }
    if (!step) { out.push(base); continue; } // unsupported rule: keep the first occurrence only

    let until = '';
    if (p.UNTIL) {
      const u = parseICSDate(p.UNTIL);
      // UNTIL is an instant: an occurrence later that same day than UNTIL's time is already outside the series
      if (u) until = u.t && s.t && u.t < s.t ? addDays(u.d, -1) : u.d;
    }
    const days = p.FREQ === 'WEEKLY' && p.BYDAY ? p.BYDAY.split(',').map(x => DAYS.indexOf(x.slice(-2))).filter(i => i >= 0) : [];
    const starts = days.length > 1 || (days.length === 1 && days[0] !== parseD(s.d).getDay()) ? days.map(w => firstOnOrAfter(s.d, w)).sort() : [s.d];
    const count = p.COUNT ? Math.ceil(+p.COUNT / starts.length) : 0; // COUNT is shared by all weekdays of the rule
    starts.forEach((date, i) => {
      const ev: ParsedEvent = { ...base, id: uid(), uid: starts.length > 1 ? `${id0}#${i}` : id0, date, repeat, exceptions: [...base.exceptions] };
      ev.until = until || (count ? addDays(date, step * (count - 1)) : '');
      if (ev.until && ev.until < ev.date) return;
      out.push(ev);
    });
  }

  // a changed single occurrence replaces the matching date of its series
  for (const o of overrides) {
    for (const m of out) if (m.uid === o.uid || m.uid.startsWith(o.uid + '#')) {
      const off = diffDays(o.date, m.date), step = m.repeat === 'daily' ? 1 : m.repeat === 'biweekly' ? 14 : 7;
      if (m.repeat !== 'none' && off >= 0 && off % step === 0) m.exceptions.push(o.date);
    }
    out.push(o.ev);
  }
  return out;
}
