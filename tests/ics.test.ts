import { describe, expect, it } from 'vitest';
import { parseICS, parseICSDate } from '../src/lib/ics';
import { occurrences } from '../src/lib/schedule';

const cal = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map(e => `BEGIN:VEVENT\r\n${e.trim().split('\n').map(l => l.trim()).join('\r\n')}\r\nEND:VEVENT`).join('\r\n')}\r\nEND:VCALENDAR`;
const pad = (n: number) => String(n).padStart(2, '0');

describe('ICS dates', () => {
  it('converts UTC times to the local time zone', () => {
    const d = new Date(Date.UTC(2026, 2, 1, 9, 0)); // 2026-03-01 09:00 UTC
    expect(parseICSDate('20260301T090000Z')).toEqual({ d: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, t: `${pad(d.getHours())}:${pad(d.getMinutes())}` });
  });
  it('reads floating and TZID times as wall-clock time, and date-only values as all-day', () => {
    expect(parseICSDate('20260301T093000')).toEqual({ d: '2026-03-01', t: '09:30' });
    expect(parseICSDate('20260301T093000', { TZID: 'Europe/Berlin' })).toEqual({ d: '2026-03-01', t: '09:30' });
    expect(parseICSDate('20260301', { VALUE: 'DATE' })).toEqual({ d: '2026-03-01', t: '' });
    expect(parseICSDate('garbage')).toBeNull();
  });
});

describe('ICS events', () => {
  it('imports a timetable lecture with several weekdays as one weekly series per day', () => {
    const evs = parseICS(cal(`UID:alg-1\nSUMMARY:Algorithms lecture\nDTSTART;TZID=Europe/Berlin:20260302T100000\nDTEND;TZID=Europe/Berlin:20260302T113000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260318T000000Z\nLOCATION:Hall A`));
    expect(evs).toHaveLength(2);
    expect(evs.map(e => e.date).sort()).toEqual(['2026-03-02', '2026-03-04']);
    expect(evs.every(e => e.repeat === 'weekly' && e.start === '10:00' && e.end === '11:30' && e.type === 'lecture' && e.location === 'Hall A')).toBe(true);
    expect(new Set(evs.map(e => e.uid)).size).toBe(2); // stable, distinct ids so a refresh can update them
    expect(occurrences(evs, '2026-03-01', '2026-03-31').map(o => o.date).sort()).toEqual(['2026-03-02', '2026-03-04', '2026-03-09', '2026-03-11', '2026-03-16']);
  });
  it('moves the first occurrence to the BYDAY weekday when DTSTART falls on another day', () => {
    const [e] = parseICS(cal('UID:x\nSUMMARY:Lab\nDTSTART:20260303T140000\nDTEND:20260303T160000\nRRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=3')); // 2026-03-03 is a Tuesday
    expect(e.date).toBe('2026-03-06'); expect(e.until).toBe('2026-03-20');
  });
  it('turns COUNT into an end date, shared between the weekdays of the rule', () => {
    const evs = parseICS(cal('UID:c\nSUMMARY:Tutorial\nDTSTART:20260302T080000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=6'));
    expect(evs.map(e => e.until).sort()).toEqual(['2026-03-16', '2026-03-19']); // 3 Mondays + 3 Thursdays
    const [d] = parseICS(cal('UID:d\nSUMMARY:Daily\nDTSTART:20260302T080000\nRRULE:FREQ=DAILY;COUNT=3')); expect(d.until).toBe('2026-03-04');
  });
  it('handles every-other-week series and keeps unsupported rules as a single event', () => {
    expect(parseICS(cal('UID:b\nSUMMARY:Bi\nDTSTART:20260302T080000\nRRULE:FREQ=WEEKLY;INTERVAL=2'))[0].repeat).toBe('biweekly');
    const [m] = parseICS(cal('UID:m\nSUMMARY:Monthly\nDTSTART:20260302T080000\nRRULE:FREQ=MONTHLY')); expect(m.repeat).toBe('none');
  });
  it('replaces a single changed occurrence of a series (RECURRENCE-ID) and skips the original date', () => {
    const evs = parseICS(cal(
      'UID:s\nSUMMARY:Seminar\nDTSTART:20260302T100000\nDTEND:20260302T113000\nRRULE:FREQ=WEEKLY;UNTIL=20260323T235959',
      'UID:s\nRECURRENCE-ID:20260309T100000\nSUMMARY:Seminar (moved)\nDTSTART:20260310T150000\nDTEND:20260310T163000'));
    const master = evs.find(e => e.repeat === 'weekly')!; expect(master.exceptions).toEqual(['2026-03-09']);
    const all = occurrences(evs, '2026-03-01', '2026-03-31').map(o => `${o.date} ${o.ev.start} ${o.ev.title}`).sort();
    expect(all).toEqual(['2026-03-02 10:00 Seminar', '2026-03-10 15:00 Seminar (moved)', '2026-03-16 10:00 Seminar', '2026-03-23 10:00 Seminar']);
  });
  it('skips cancelled events and ignores properties of nested alarms', () => {
    const evs = parseICS(cal('UID:1\nSUMMARY:Cancelled\nSTATUS:CANCELLED\nDTSTART:20260302T100000',
      'UID:2\nSUMMARY:Real\nDESCRIPTION:Bring a laptop\nDTSTART:20260302T100000\nBEGIN:VALARM\nTRIGGER:-PT15M\nDESCRIPTION:Reminder text\nACTION:DISPLAY\nEND:VALARM'));
    expect(evs).toHaveLength(1); expect(evs[0].desc).toBe('Bring a laptop');
  });
  it('treats events crossing midnight and all-day events sensibly', () => {
    const [night] = parseICS(cal('UID:n\nSUMMARY:Hackathon\nDTSTART:20260302T220000\nDTEND:20260303T060000')); expect(night.end).toBe('23:59');
    const [day] = parseICS(cal('UID:a\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20260501\nDTEND;VALUE=DATE:20260502')); expect(day.start).toBe(''); expect(day.end).toBe(''); expect(day.date).toBe('2026-05-01');
  });
  it('unescapes text, unfolds long lines and classifies exams', () => {
    const [e] = parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Klausur Analysis\\, Teil 1\r\nDESCRIPTION:Line one\\nLine\r\n  two\r\nDTSTART:20260702T090000\r\nEND:VEVENT\r\nEND:VCALENDAR');
    expect(e.title).toBe('Klausur Analysis, Teil 1'); expect(e.desc).toBe('Line one\nLine two'); expect(e.type).toBe('exam');
  });
  it('survives junk', () => { expect(parseICS('')).toEqual([]); expect(parseICS('BEGIN:VEVENT\nSUMMARY:No date\nEND:VEVENT')).toEqual([]); expect(parseICS('not a calendar at all')).toEqual([]); });
});
