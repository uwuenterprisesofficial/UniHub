import type { Data } from './types';
import { paragraphs, sentences, stem, tokenize, STOP } from './nlp';

export type ChunkKind = 'document' | 'note' | 'annotation' | 'quote' | 'term' | 'flashcard' | 'task' | 'thesis' | 'source' | 'module' | 'event';
export interface Chunk {
  id: string; kind: ChunkKind; title: string; text: string; to: string; moduleId: string; docId?: string; start?: number; page?: number;
  stems: string[]; tf: Map<string, number>; norm: string; terms: Set<string>;
}
export const KIND_LABEL: Record<ChunkKind, string> = { document: 'Document', note: 'Note', annotation: 'Annotation', quote: 'Quote', term: 'Glossary', flashcard: 'Flashcard', task: 'Task', thesis: 'Thesis', source: 'Source', module: 'Module', event: 'Event' };
export const KIND_ICON: Record<ChunkKind, string> = { document: '📄', note: '📝', annotation: '🖍', quote: '❝', term: '📖', flashcard: '🧠', task: '☑', thesis: '🎓', source: '📚', module: '🗂', event: '📅' };
const KIND_BOOST: Record<ChunkKind, number> = { term: 1.35, quote: 1.2, annotation: 1.2, note: 1.1, thesis: 1.1, document: 1, source: 1, flashcard: 1, module: 1, task: 0.9, event: 0.8 };

const normalize = (s: string) => ' ' + s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
const strip = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>]+/g, '').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

export interface Index {
  chunks: Chunk[]; df: Map<string, number>; avgLen: number;
  termForms: Map<string, string[]>; // term id -> normalized surface forms
  termChunks: Map<string, number[]>; // term id -> chunk indexes
  related: (termId: string) => { id: string; weight: number }[];
}

export function buildIndex(d: Data, texts: Record<string, string>): Index {
  const chunks: Chunk[] = [];
  const add = (c: Omit<Chunk, 'stems' | 'tf' | 'norm' | 'terms'>) => {
    const toks = tokenize(c.text).filter(t => !t.stop).map(t => t.s);
    if (!toks.length) return;
    const tf = new Map<string, number>(); toks.forEach(t => tf.set(t, (tf.get(t) ?? 0) + 1));
    chunks.push({ ...c, stems: toks, tf, norm: normalize(c.title + ' ' + c.text), terms: new Set() });
  };
  const mName = (id: string) => d.modules.find(m => m.id === id)?.name ?? '';

  for (const doc of d.docs) {
    const t = texts[doc.id] ?? doc.text; if (!t) continue;
    paragraphs(t).forEach(p => { if (!p.heading && p.text.length >= 40) add({ id: `doc:${doc.id}:${p.start}`, kind: 'document', title: doc.name + (p.section ? ' › ' + p.section : ''), text: p.text, to: `/documents/${doc.id}?at=${p.start}`, moduleId: doc.moduleId, docId: doc.id, start: p.start, page: p.page }); });
  }
  for (const n of d.notes) {
    const body = strip(n.body);
    const ps = body.split(/\n\s*\n/).filter(x => x.trim().length > 20);
    (ps.length ? ps : [n.title]).forEach((p, i) => add({ id: `note:${n.id}:${i}`, kind: 'note', title: n.title, text: p, to: `/notes/${n.id}`, moduleId: n.moduleId }));
    add({ id: `note:${n.id}:t`, kind: 'note', title: n.title, text: n.title + ' ' + n.tags.join(' '), to: `/notes/${n.id}`, moduleId: n.moduleId });
  }
  for (const a of d.annotations) {
    const doc = d.docs.find(x => x.id === a.docId); if (!doc) continue;
    add({ id: 'ann:' + a.id, kind: 'annotation', title: `Annotation in ${doc.name}`, text: [a.quote, a.note, a.tags.join(' ')].filter(Boolean).join(' — '), to: `/documents/${doc.id}?at=${a.start}`, moduleId: doc.moduleId, docId: doc.id, start: a.start, page: a.page });
  }
  for (const q of d.quotes.filter(q => q.status === 'saved')) add({ id: 'q:' + q.id, kind: 'quote', title: 'Quote', text: [q.text, q.comment, q.tags.join(' ')].filter(Boolean).join(' — '), to: '/quotes', moduleId: q.moduleId });
  for (const t of d.terms.filter(t => t.status === 'confirmed')) add({ id: 'term:' + t.id, kind: 'term', title: t.term, text: [t.term, ...t.aliases, t.definition].join('. '), to: '/glossary/' + t.id, moduleId: t.moduleId });
  for (const f of d.flashcards) add({ id: 'fc:' + f.id, kind: 'flashcard', title: f.front, text: f.front + ' — ' + f.back, to: '/study', moduleId: f.moduleId });
  for (const t of d.tasks) add({ id: 'task:' + t.id, kind: 'task', title: t.title, text: [t.title, t.desc, t.type, ...t.subtasks.map(s => s.t)].join('. '), to: '/tasks', moduleId: t.moduleId });
  for (const p of d.projects) {
    add({ id: `pr:${p.id}:meta`, kind: 'thesis', title: p.title, text: [p.title, p.description, p.question, p.scope, p.openQuestions].filter(Boolean).join('. '), to: '/thesis/' + p.id, moduleId: '' });
    p.chapters.forEach(c => c.notes && add({ id: `pr:${p.id}:${c.id}`, kind: 'thesis', title: `${p.title} › ${c.title}`, text: c.title + '. ' + c.notes, to: '/thesis/' + p.id, moduleId: '' }));
    p.feedback.forEach(f => f.text && add({ id: `pr:${p.id}:${f.id}`, kind: 'thesis', title: p.title + ' › feedback', text: f.text, to: '/thesis/' + p.id, moduleId: '' }));
  }
  for (const r of d.refs) add({ id: 'ref:' + r.id, kind: 'source', title: r.title, text: [r.title, r.authors, r.year, r.journal, r.topic, r.quotes].filter(Boolean).join('. '), to: '/thesis/' + r.projectId, moduleId: '' });
  for (const m of d.modules) add({ id: 'mod:' + m.id, kind: 'module', title: m.name, text: [m.name, m.code, m.lecturer, m.objectives, m.exam].filter(Boolean).join('. '), to: '/modules/' + m.id, moduleId: m.id });
  for (const s of d.sessions ?? []) {
    if (!s.summary) continue;
    const to = `/modules/${s.moduleId}/workspace?s=${s.id}`, title = `Lecture ${s.date}${s.title ? ' – ' + s.title : ''}`;
    s.summary.split(/\n(?=## )/).forEach((sec, i) => { if (sec.trim().length > 40) add({ id: `sess:${s.id}:${i}`, kind: 'note', title, text: strip(sec), to, moduleId: s.moduleId }); });
  }
  for (const e of d.events) e.desc && add({ id: 'ev:' + e.id, kind: 'event', title: e.title, text: e.title + '. ' + e.desc, to: '/calendar', moduleId: e.moduleId });

  const df = new Map<string, number>(); let total = 0;
  chunks.forEach(c => { total += c.stems.length; new Set(c.stems).forEach(s => df.set(s, (df.get(s) ?? 0) + 1)); });

  // connect confirmed glossary terms to every chunk that mentions them
  const termForms = new Map<string, string[]>(), termChunks = new Map<string, number[]>();
  for (const t of d.terms.filter(t => t.status === 'confirmed')) {
    const forms = new Set<string>();
    [t.term, ...t.aliases].forEach(f => { const n = normalize(f).trim(); if (n) { forms.add(n); if (!n.endsWith('s')) { forms.add(n + 's'); forms.add(n + 'es'); } } });
    termForms.set(t.id, [...forms]); termChunks.set(t.id, []);
  }
  chunks.forEach((c, ci) => {
    for (const [id, forms] of termForms) if (forms.some(f => c.norm.includes(' ' + f + ' '))) { c.terms.add(id); termChunks.get(id)!.push(ci); }
  });
  const relCache = new Map<string, { id: string; weight: number }[]>();
  const related = (termId: string) => {
    if (relCache.has(termId)) return relCache.get(termId)!;
    const mine = new Set(termChunks.get(termId) ?? []), counts = new Map<string, number>();
    mine.forEach(ci => chunks[ci].terms.forEach(o => { if (o !== termId) counts.set(o, (counts.get(o) ?? 0) + 1); }));
    const res = [...counts].map(([id, n]) => ({ id, weight: n / Math.sqrt(mine.size * (termChunks.get(id)?.length || 1)) })).sort((a, b) => b.weight - a.weight);
    relCache.set(termId, res); return res;
  };
  return { chunks, df, avgLen: total / (chunks.length || 1), termForms, termChunks, related };
}

/* ---------- querying ---------- */
export interface Hit { chunk: Chunk; score: number; snippet: { text: string; marks: [number, number][] }; sourceBoost: boolean }
export interface QueryResult {
  hits: Hit[]; qStems: string[]; termIds: string[]; answer: { text: string; chunk: Chunk }[]; definition?: { termId: string };
}
const Q_FILLER = new Set('what is are was were does do did how why when where who which tell me about explain define meaning mean of the a an in on for to and between difference was wer was wie warum erkläre erklaere bedeutet'.split(' '));

/** What a question is asked against: everything, one module, or a single lecture day of a module. */
export interface Scope { moduleId?: string; sessionId?: string }
export const scopeKey = (s?: Scope) => `${s?.moduleId ?? ''}|${s?.sessionId ?? ''}`;

/** Decides which passages belong to a scope. The glossary is global knowledge, so definitions are available in every scope. */
export function scopeFilter(d: Data, scope?: Scope): ((c: Chunk) => boolean) | null {
  if (!scope || (!scope.moduleId && !scope.sessionId)) return null;
  const sess = scope.sessionId ? (d.sessions ?? []).find(s => s.id === scope.sessionId) : undefined;
  if (scope.sessionId && sess) {
    const noteIds = new Set(d.notes.filter(n => n.sessionId === sess.id).map(n => n.id)), docIds = new Set(sess.docIds);
    const quoteIds = new Set(d.quotes.filter(q => docIds.has(q.docId)).map(q => q.id));
    return c => {
      if (c.kind === 'term') return true;
      const [kind, ref] = c.id.split(':');
      if (kind === 'note') return noteIds.has(ref);
      if (kind === 'sess') return ref === sess.id;
      if (kind === 'mod') return ref === sess.moduleId;
      if (kind === 'q') return quoteIds.has(ref);
      return !!c.docId && docIds.has(c.docId); // document passages and annotations of the attached documents
    };
  }
  const m = scope.moduleId;
  return c => c.kind === 'term' || c.moduleId === m;
}

export function query(idx: Index, d: Data, q: string, opts: { kinds?: Set<ChunkKind>; moduleId?: string; scope?: Scope; limit?: number } = {}): QueryResult {
  const inScope = scopeFilter(d, opts.scope ?? (opts.moduleId ? { moduleId: opts.moduleId } : undefined));
  const phrases = [...q.matchAll(/"([^"]+)"/g)].map(m => normalize(m[1]));
  const rawQ = q.replace(/["“”]/g, ' '); // quoted phrases are searched as words and additionally boosted as exact phrases
  const qt = tokenize(rawQ).filter(t => !t.stop && !Q_FILLER.has(t.low));
  const weights = new Map<string, number>(); qt.forEach(t => weights.set(t.s, 1));
  const qNorm = normalize(rawQ);

  // expand with glossary knowledge: aliases of mentioned terms (full weight) and strongly related terms (low weight)
  const termIds: string[] = [];
  for (const [id, forms] of idx.termForms) if (forms.some(f => qNorm.includes(' ' + f.trim() + ' ')) ) termIds.push(id);
  for (const id of termIds) {
    const t = d.terms.find(x => x.id === id)!;
    [t.term, ...t.aliases].forEach(a => tokenize(a).filter(x => !x.stop).forEach(x => weights.set(x.s, Math.max(weights.get(x.s) ?? 0, 0.9))));
    idx.related(id).slice(0, 3).forEach(r => { const rt = d.terms.find(x => x.id === r.id); rt && tokenize(rt.term).filter(x => !x.stop).forEach(x => { if (!weights.has(x.s)) weights.set(x.s, 0.3); }); });
  }
  const N = idx.chunks.length, k1 = 1.4, b = 0.75;
  const hits: Hit[] = [];
  const direct = new Set(qt.map(t => t.s));
  for (const c of idx.chunks) {
    if (opts.kinds && !opts.kinds.has(c.kind)) continue;
    if (inScope && !inScope(c)) continue;
    let score = 0, matched = 0;
    for (const [s, w] of weights) {
      const f = c.tf.get(s); if (!f) continue;
      const idf = Math.log(1 + (N - (idx.df.get(s) ?? 0) + 0.5) / ((idx.df.get(s) ?? 0) + 0.5));
      score += w * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * c.stems.length / idx.avgLen));
      if (direct.has(s)) matched++;
    }
    if (!score) continue;
    if (direct.size > 1) score *= 0.5 + 0.5 * (matched / direct.size); // reward covering all query words
    for (const ph of phrases) if (c.norm.includes(ph)) score *= 1.8;
    if (termIds.some(id => c.terms.has(id))) score *= 1.25;
    hits.push({ chunk: c, score: score * KIND_BOOST[c.kind], snippet: { text: '', marks: [] }, sourceBoost: false });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, opts.limit ?? 40);
  const allStems = new Set(weights.keys());
  for (const h of top) h.snippet = bestSnippet(h.chunk.text, allStems);

  // extractive answer: the best matching sentence of the best distinct chunks
  const answer: QueryResult['answer'] = []; const seen = new Set<string>();
  for (const h of top.slice(0, 8)) {
    if (h.chunk.kind === 'flashcard' && answer.length) continue;
    const sent = bestSentence(h.chunk.text, allStems); if (!sent || seen.has(sent.slice(0, 60))) continue;
    seen.add(sent.slice(0, 60)); answer.push({ text: sent, chunk: h.chunk });
    if (answer.length >= 5) break;
  }
  const defTerm = termIds.length && /^(what|was|define|erkl|wer)\b|\b(meaning|definition|bedeutet)\b/i.test(q.trim()) ? termIds[0] : undefined;
  return { hits: top, qStems: [...allStems], termIds, answer, definition: defTerm ? { termId: defTerm } : undefined };
}

function bestSentence(text: string, stems: Set<string>): string {
  let best = '', bs = 0;
  for (const s of sentences(text)) {
    const ts = new Set(tokenize(s.text).filter(t => !t.stop).map(t => t.s)); let n = 0; stems.forEach(x => ts.has(x) && n++);
    const sc = n / Math.sqrt(ts.size || 1);
    if (sc > bs && s.text.length >= 25) { bs = sc; best = s.text; }
  }
  return best;
}
export function bestSnippet(text: string, stems: Set<string>): Hit['snippet'] {
  const toks = tokenize(text), hitsAt = toks.filter(t => stems.has(t.s));
  let a = 0, b = Math.min(text.length, 260);
  if (hitsAt.length) { const c = hitsAt[0].start; a = Math.max(0, c - 80); b = Math.min(text.length, c + 200); }
  const marks = hitsAt.filter(t => t.start >= a && t.end <= b).map(t => [t.start - a, t.end - a] as [number, number]);
  return { text: (a > 0 ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : ''), marks: marks.map(([x, y]) => [x + (a > 0 ? 1 : 0), y + (a > 0 ? 1 : 0)]) };
}

/** Occurrences of one term (and aliases) inside a text, as [start, end] ranges. */
export function findOccurrences(text: string, forms: string[]): [number, number][] {
  const out: [number, number][] = [];
  const alts = forms.filter(Boolean).map(f => f.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).sort((a, b) => b.length - a.length);
  if (!alts.length) return out;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?:s|es)?(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of text.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}
export { stem, STOP };

/** A short excerpt around the first occurrence of any of the given forms, with highlight ranges. */
export function snippetFor(text: string, forms: string[]): { text: string; marks: [number, number][] } {
  const occ = findOccurrences(text, forms);
  if (!occ.length) return { text: text.slice(0, 220), marks: [] };
  const a = Math.max(0, occ[0][0] - 90), b = Math.min(text.length, occ[0][0] + 190), pre = a > 0 ? 1 : 0;
  return { text: (pre ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : ''), marks: occ.filter(([s, e]) => s >= a && e <= b).map(([s, e]) => [s - a + pre, e - a + pre] as [number, number]) };
}
