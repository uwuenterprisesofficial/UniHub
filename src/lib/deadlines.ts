import { paragraphs, sentences, tokenize } from './nlp';
import { pageOf } from './extract';
import { fmt, today } from './util';
import type { Task } from './types';

/* Finds deadlines and exam dates in a document. Pure pattern matching: every proposal shows the sentence it came from. */
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  januar: 1, februar: 2, märz: 3, maerz: 3, mai: 5, juni: 6, juli: 7, oktober: 10, dezember: 12, dez: 12, okt: 10, mär: 3,
};
const MON = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const CUE = /\b(due|deadline|submit(?:ted)?|submission|hand[- ]?in|turn in|no later than|until|by the end of|exam|midterm|final|test|quiz|presentation|colloquium|abgabe|abgeben|einreichen|frist|spätestens|klausur|prüfung|termin|referat|vortrag)\b/i;
const EXAM = /\b(exam|midterm|final exam|test|quiz|klausur|prüfung)\b/i;

export interface DateHit { date: string; start: number; end: number }
function valid(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000; const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d && y >= 2000 && y <= 2100 ? fmt(dt) : null;
}
export function findDates(text: string, order: 'DMY' | 'MDY' | 'ISO' = 'DMY'): DateHit[] {
  const out: DateHit[] = []; const push = (m: RegExpMatchArray, date: string | null) => { if (date) out.push({ date, start: m.index!, end: m.index! + m[0].length }); };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m, valid(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/g)) push(m, valid(+m[3], +m[2], +m[1]));
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) push(m, order === 'MDY' ? valid(+m[3], +m[1], +m[2]) : valid(+m[3], +m[2], +m[1]));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(?:of\\s+)?(${MON})\\.?,?\\s+(\\d{4})\\b`, 'gi'))) push(m, valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  for (const m of text.matchAll(new RegExp(`\\b(${MON})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) push(m, valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  return out.sort((a, b) => a.start - b.start).filter((h, i, a) => !i || h.start >= a[i - 1].end);
}

export interface DeadlineProposal { title: string; due: string; sentence: string; start: number; page: number; type: string; exam: boolean }
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[-*•\d.)\s]+/, '').trim();
const overlap = (a: string, b: string) => { const A = new Set(tokenize(a).filter(t => !t.stop).map(t => t.s)), B = new Set(tokenize(b).filter(t => !t.stop).map(t => t.s)); let i = 0; A.forEach(x => B.has(x) && i++); return i / (A.size + B.size - i || 1); };

export function findDeadlines(text: string, existing: Task[], order: 'DMY' | 'MDY' | 'ISO' = 'DMY'): DeadlineProposal[] {
  const t0 = today(), out: DeadlineProposal[] = [];
  for (const p of paragraphs(text)) {
    for (const s of sentences(p.text, p.start)) {
      if (!CUE.test(s.text)) continue;
      for (const h of findDates(s.text, order)) {
        if (h.date < t0) continue; // already past
        const sentence = clean(s.text), exam = EXAM.test(s.text);
        let title = sentence.length > 90 ? sentence.slice(0, 87).trimEnd() + '…' : sentence;
        if (exam) title = title.startsWith('Exam') ? title : `Exam: ${title}`;
        if (existing.some(e => e.due === h.date && overlap(e.title, sentence) > 0.4)) continue;
        if (out.some(o => o.due === h.date && overlap(o.sentence, sentence) > 0.6)) continue;
        out.push({ title, due: h.date, sentence, start: s.start, page: pageOf(text, s.start), type: exam ? 'Exam preparation' : 'Assignment', exam });
      }
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
