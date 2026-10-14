import { findDeadlines, type DeadlineProposal } from './deadlines';
import { findOccurrences } from './kb';
import { candidateTerms, contentStems, findDefinitions, summarize, type Corpus } from './nlp';
import { useStore } from './store';
import type { Data, Note, Session } from './types';
import { fmt, fmtDate } from './util';

/* A lecture workspace is one Session per module and day. Its summary is built only from what the student gathered:
   their own notes (highest priority), highlights made that day, and the key sentences of the attached documents. */
export const sessionNotes = (d: Data, s: Session): Note[] => d.notes.filter(n => n.sessionId === s.id).sort((a, b) => a.updated - b.updated);
export const sessionDocs = (d: Data, s: Session) => s.docIds.map(id => d.docs.find(x => x.id === id)).filter((x): x is Data['docs'][number] => !!x);

/** Finds or creates the session for a module on a day (optionally tied to a calendar event). */
export function ensureSession(moduleId: string, date: string, eventId = '', title = ''): Session {
  const st = useStore.getState();
  const hit = st.sessions.find(x => x.moduleId === moduleId && x.date === date && (!eventId || !x.eventId || x.eventId === eventId));
  if (hit) { if (eventId && !hit.eventId) st.update('sessions', hit.id, { eventId }); return hit; }
  return st.add('sessions', { moduleId, date, title, topic: '', eventId, status: 'open', docIds: [], summary: '', summarySource: '', summaryEdited: false, summaryAt: 0, created: Date.now() });
}

/** The note a student types into during the lecture; created on first use. */
export function liveNote(s: Session): Note {
  const st = useStore.getState();
  const have = st.notes.filter(n => n.sessionId === s.id).find(n => n.tags.includes('live'));
  if (have) return have;
  const mod = st.modules.find(m => m.id === s.moduleId);
  const ev = st.events.find(e => e.id === s.eventId);
  const head = `# ${s.title || ev?.title || mod?.name || 'Lecture'} – ${fmtDate(s.date, st.settings.dateFormat)}\n\n## Key points\n- \n\n## Definitions\n- \n\n## Questions\n- \n\n## To do\n- [ ] \n`;
  return st.add('notes', { title: `${mod?.code ? mod.code + ' · ' : ''}${s.title || 'Lecture'} ${s.date}`, body: head, moduleId: s.moduleId, tags: ['lecture', 'live'], pinned: false, updated: Date.now(), sessionId: s.id, date: s.date, eventId: s.eventId || undefined });
}

const strip = (t: string) => t.replace(/```[\s\S]*?```/g, ' ').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
const clean = (l: string) => strip(l).replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s*)?/, '').replace(/\s+/g, ' ').trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sameDay = (ms: number, date: string) => fmt(new Date(ms)) === date;

export interface LectureSummary {
  markdown: string;
  outline: string[]; points: string[]; terms: { term: string; definition: string; known: boolean }[]; questions: string[]; todos: string[]; deadlines: DeadlineProposal[];
  highlights: number; docsUsed: number; empty: boolean;
}

export function buildLectureSummary(d: Data, s: Session, texts: Record<string, string>, corpus?: Corpus): LectureSummary {
  const mod = d.modules.find(m => m.id === s.moduleId), notes = sessionNotes(d, s), docs = sessionDocs(d, s);
  const fmtD = (x: string) => fmtDate(x, d.settings.dateFormat);
  const noteLines = notes.flatMap(n => n.body.split('\n').map(l => ({ raw: l, text: clean(l) })));
  const body = notes.map(n => strip(n.body)).join('\n\n');

  // outline: headings the student wrote (the template's own section names are not content)
  const generic = new Set(['key points', 'definitions', 'questions', 'to do', 'todo', 'materials', 'notes', 'follow-up']);
  const outline = [...new Set([s.topic.trim(), ...notes.flatMap(n => n.body.split('\n').map(l => l.match(/^#{2,3}\s+(.+)/)?.[1]?.trim() ?? '')).filter(h => h && !generic.has(h.toLowerCase()))].filter(Boolean))].slice(0, 8);

  // the student's own points: bullet / sentence lines that say something (not headings, checklists, questions or empty bullets)
  const own = noteLines.filter(l => !/^\s*#/.test(l.raw) && !/^\s*[-*]\s+\[[ x]\]/i.test(l.raw) && !l.text.includes('?') && !l.text.includes('::') && words(l.text) >= 4 && l.text.length <= 240);
  const cue = /\b(because|therefore|so that|means|is defined|important|key|always|never|must|formula|=|\d)/i;
  const points = (own.length <= 12 ? own : [...own].sort((a, b) => +cue.test(b.text) - +cue.test(a.text) || b.text.length - a.text.length).slice(0, 12).sort((a, b) => own.indexOf(a) - own.indexOf(b))).map(l => l.text);

  // highlights made on this day in the attached documents
  const seenQuote = new Set<string>();
  const hl = d.annotations.filter(a => s.docIds.includes(a.docId) && a.start >= 0 && sameDay(a.created, s.date)).filter(a => { const k = norm(a.quote); if (seenQuote.has(k)) return false; seenQuote.add(k); return true; });
  const worthListing = (a: (typeof hl)[number]) => a.kind !== 'term' && a.kind !== 'unclear' && a.kind !== 'research' && (words(a.quote) >= 4 || !!a.note);
  const docName = (id: string) => d.docs.find(x => x.id === id)?.name ?? '';
  const highlightPts = hl.filter(worthListing).map(a => `“${a.quote.replace(/\s+/g, ' ').trim()}”${a.note ? ` — *${a.note}*` : ''} (${docName(a.docId)}${d.docs.find(x => x.id === a.docId)?.ext === 'pdf' ? `, p. ${a.page}` : ''})`);

  // key sentences of documents that were not already covered by the student's highlights
  const said = [...points, ...hl.map(a => a.quote)].map(p => new Set(contentStems(p)));
  const repeats = (t: string) => { const A = new Set(contentStems(t)); return said.some(B => { let i = 0; A.forEach(x => B.has(x) && i++); return i / (A.size + B.size - i || 1) > 0.55; }); };
  const docPts: string[] = []; let docsUsed = 0;
  for (const doc of docs) {
    const t = texts[doc.id] ?? doc.text; if (!t) continue; docsUsed++;
    const n = hl.some(a => a.docId === doc.id) ? 1 : docs.length > 3 ? 1 : 3;
    for (const x of summarize(t.slice(0, 120_000), corpus).overall.slice(0, n + 2)) { if (docPts.length < 8 && !repeats(x.text) && docPts.filter(p => p.endsWith(`(*${doc.name}*)`)).length < n) docPts.push(`${x.text} (*${doc.name}*)`); }
  }

  // terms: definitions found in the material, glossary terms that occur, and new candidate terms from the student's own words
  const known = d.terms.filter(t => t.status === 'confirmed');
  const material = [body, ...docs.map(x => (texts[x.id] ?? x.text ?? '').slice(0, 60_000))].join('\n\n');
  const termMap = new Map<string, { term: string; definition: string; known: boolean }>();
  for (const t of known) {
    const forms = [t.term, ...t.aliases], n = findOccurrences(body, forms).length * 3 + docs.reduce((a, x) => a + Math.min(findOccurrences(texts[x.id] ?? x.text ?? '', forms).length, 3), 0);
    if (n > 0) termMap.set(norm(t.term), { term: t.term, definition: t.definition, known: true });
  }
  for (const def of findDefinitions(material)) { const k = norm(def.term); if (k && !termMap.has(k) && termMap.size < 14) termMap.set(k, { term: def.term, definition: def.definition, known: false }); }
  const knownKeys = new Set(known.flatMap(t => [t.term, ...t.aliases].map(norm)));
  const prose = body.split('\n').filter(l => !/^\s*#/.test(l) && !l.includes('::')).join('\n');
  if (words(prose) >= 25) for (const c of candidateTerms(prose, corpus, 6)) { const k = norm(c.surface); if (!knownKeys.has(k) && !termMap.has(k) && termMap.size < 14 && c.count >= 2) termMap.set(k, { term: c.surface, definition: '', known: false }); }
  const terms = [...termMap.values()].slice(0, 12);

  const questions = [...new Set([...noteLines.filter(l => l.text.includes('?') && l.text.length > 5).map(l => l.text), ...hl.filter(a => a.kind === 'unclear' || a.kind === 'research').map(a => `${a.quote.replace(/\s+/g, ' ').trim().slice(0, 140)}${a.note ? ' — ' + a.note : ''} (${a.kind === 'unclear' ? 'unclear' : 'look into'})`)])].slice(0, 10);

  const todos = [...new Set(noteLines.filter(l => /^\s*[-*]\s+\[ \]\s+\S/.test(l.raw)).map(l => l.text))].slice(0, 10);
  const deadlines = findDeadlines(material, d.tasks, d.settings.dateFormat === 'MDY' ? 'MDY' : 'DMY').slice(0, 5);

  const keyPoints = [...points, ...highlightPts, ...docPts.slice(0, 8)];
  const sec = (title: string, lines: string[]) => lines.length ? `## ${title}\n${lines.join('\n')}\n\n` : '';
  const materials = [...docs.map(x => `- [${x.name}](#/documents/${x.id})`), ...notes.map(n => `- Notes: [[${n.title}]]`)];
  const markdown = `# Lecture summary – ${mod?.name ?? 'Lecture'}, ${fmtD(s.date)}\n${s.title || s.topic ? `*${[s.title, s.topic].filter(Boolean).join(' — ')}*\n` : ''}\n`
    + sec('Covered', outline.map(o => `- ${o}`)) + sec('Key points', keyPoints.map(p => `- ${p}`))
    + sec('Definitions & terms', terms.map(t => `- **${t.term}**${t.definition ? ' – ' + t.definition.replace(/\s+/g, ' ').slice(0, 220) : ''}${t.known ? '' : ' *(new)*'}`))
    + sec('Open questions', questions.map(q => `- ${q}`))
    + sec('To do', [...todos.map(t => `- [ ] ${t}`), ...deadlines.map(x => `- 📅 **${fmtD(x.due)}** — ${x.title}`)])
    + sec('Materials', materials)
    + `*Extract of your own notes, highlights and documents, generated on ${fmtD(fmt(new Date()))}. Edit freely.*\n`;

  return { markdown, outline, points: keyPoints, terms, questions, todos, deadlines, highlights: hl.length, docsUsed, empty: !keyPoints.length && !terms.length && !questions.length && !todos.length };
}

/** Material for the AI writer: the student's notes first, then highlights, then excerpts of attached documents. */
export function lectureMaterial(d: Data, s: Session, texts: Record<string, string>, maxChars: number): { text: string; chars: number } {
  const notes = sessionNotes(d, s).map(n => `### Student's notes: ${n.title}\n${n.body}`).join('\n\n');
  const hl = d.annotations.filter(a => s.docIds.includes(a.docId) && a.start >= 0 && sameDay(a.created, s.date)).map(a => `- (${a.kind}) “${a.quote.replace(/\s+/g, ' ')}”${a.note ? ' — note: ' + a.note : ''}`).join('\n');
  let out = `${notes}\n\n${hl ? '### Passages the student highlighted\n' + hl + '\n\n' : ''}`;
  const room = Math.max(0, maxChars - out.length), docs = sessionDocs(d, s);
  for (const doc of docs) { const t = (texts[doc.id] ?? doc.text ?? '').trim(); if (t) out += `### Document: ${doc.name}\n${t.slice(0, Math.floor(room / docs.length))}\n\n`; }
  return { text: out.slice(0, maxChars + 2000), chars: out.length };
}
