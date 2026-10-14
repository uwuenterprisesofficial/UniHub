import { blobs, texts, useTexts } from './blobs';
import { canExtract, extractText } from './extract';
import { buildCorpus, candidateTerms, findDefinitions, paragraphs, quoteCandidates, sentences, tokenize, type Corpus } from './nlp';
import { useStore } from './store';
import type { DocMeta } from './types';

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

let corpusCache: { key: unknown; corpus: Corpus } | null = null;
export function getCorpus(): Corpus {
  const map = useTexts.getState().map;
  if (corpusCache?.key === map) return corpusCache.corpus;
  const c = buildCorpus(Object.values(map)); corpusCache = { key: map, corpus: c }; return c;
}

/** Returns the full text of a document, extracting (and caching) it from the stored file when needed. */
export async function ensureText(doc: DocMeta): Promise<string> {
  const have = useTexts.getState().map[doc.id]; if (have !== undefined) return have;
  if (!canExtract(doc.ext)) return '';
  const v = doc.versions[doc.versions.length - 1]; const blob = v && await blobs.get(v.blobKey);
  if (!blob) return '';
  const t = await extractText(blob, doc.ext, { label: doc.name }); await texts.set(doc.id, t);
  useStore.getState().update('docs', doc.id, { text: t.slice(0, 20_000) });
  return t;
}

/** Add glossary suggestions for a document (never overwrites what the user already has). Returns how many were added. */
export function suggestTerms(doc: DocMeta, text: string, limit = 25): number {
  const st = useStore.getState(), corpus = getCorpus();
  const known = new Set(st.terms.flatMap(t => [t.term, ...t.aliases].map(norm)));
  const defs = findDefinitions(text), byTerm = new Map(defs.map(d => [norm(d.term), d]));
  const sents = sentences(text);
  // headings are not terms: blank them out (keeping offsets) before looking for candidates
  const body = paragraphs(text).reduce((t, p) => p.heading ? t.slice(0, p.start) + ' '.repeat(p.end - p.start) + t.slice(p.end) : t, text);
  // words that already belong to a multi-word glossary term ("queue" in "priority queue") are not proposed again
  const partOfKnown = new Set(st.terms.flatMap(t => [t.term, ...t.aliases]).filter(t => t.trim().includes(' ')).flatMap(t => norm(t).split(' ')));
  let added = 0;
  const propose = (term: string, definition: string, alias?: string) => {
    const k = norm(term); if (!k || known.has(k) || (alias && known.has(norm(alias)))) return;
    known.add(k); added++;
    st.add('terms', { term, aliases: alias ? [alias] : [], definition, moduleId: doc.moduleId, status: 'suggested', auto: true, sourceDocId: doc.id, created: Date.now() });
  };
  for (const d of defs.slice(0, limit)) propose(d.term, d.definition, d.alias);
  for (const c of candidateTerms(body, corpus, limit * 2)) {
    if (added >= limit) break;
    if (c.n === 1 && partOfKnown.has(norm(c.surface))) continue;
    const d = byTerm.get(norm(c.surface));
    const stems = c.key.split(' ');
    const sent = d?.definition ?? sents.find(s => { const ts = tokenize(s.text).map(t => t.s).join(' '); return ts.includes(c.key) && s.text.length > 40 && s.text.length < 320; })?.text ?? '';
    void stems; propose(c.surface, sent);
  }
  return added;
}

export function suggestQuotes(doc: DocMeta, text: string, limit = 8): number {
  const st = useStore.getState(); let added = 0;
  const have = new Set(st.quotes.filter(q => q.docId === doc.id).map(q => norm(q.text).slice(0, 80)));
  for (const q of quoteCandidates(text, getCorpus(), limit)) {
    if (have.has(norm(q.text).slice(0, 80))) continue;
    const ref = st.refs.find(r => r.docId === doc.id);
    st.add('quotes', { text: q.text, docId: doc.id, refId: ref?.id ?? '', page: String(q.page), annotationId: '', moduleId: doc.moduleId, projectId: ref?.projectId ?? '', chapterId: '', tags: [], comment: '', status: 'suggested', auto: true, score: q.score, start: q.start, created: Date.now() });
    added++;
  }
  return added;
}

export async function analyzeDoc(doc: DocMeta, opts: { terms?: boolean; quotes?: boolean } = { terms: true, quotes: true }) {
  const text = await ensureText(doc); if (!text) return { terms: 0, quotes: 0 };
  return { terms: opts.terms ? suggestTerms(doc, text) : 0, quotes: opts.quotes ? suggestQuotes(doc, text) : 0 };
}

/** Scan every document and note for glossary candidates. Returns the number of new suggestions. */
export async function scanWorkspace(): Promise<number> {
  const st = useStore.getState(); let added = 0;
  for (const d of st.docs) { const t = await ensureText(d); if (t) added += suggestTerms(d, t, 20); }
  const known = new Set(useStore.getState().terms.flatMap(t => [t.term, ...t.aliases].map(norm)));
  for (const n of st.notes) {
    for (const def of findDefinitions(n.body.replace(/[#*_`]/g, ''))) {
      const k = norm(def.term); if (!k || known.has(k)) continue; known.add(k); added++;
      useStore.getState().add('terms', { term: def.term, aliases: def.alias ? [def.alias] : [], definition: def.definition, moduleId: n.moduleId, status: 'suggested', auto: true, sourceDocId: '', created: Date.now() });
    }
  }
  return added;
}

/** After a document's text changed, move annotations/quotes to where their text now is; detach those that vanished. */
export function reanchor(docId: string, text: string): { moved: number; detached: number } {
  const st = useStore.getState(); let moved = 0, detached = 0;
  const nearest = (needle: string, near: number) => {
    let best = -1, bd = Infinity;
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) { const d = Math.abs(i - near); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  for (const a of st.annotations.filter(x => x.docId === docId)) {
    if (a.start >= 0 && text.slice(a.start, a.end) === a.quote) continue;
    const i = nearest(a.quote, Math.max(a.start, 0));
    if (i >= 0) { st.update('annotations', a.id, { start: i, end: i + a.quote.length }); moved++; }
    else if (a.start >= 0) { st.update('annotations', a.id, { start: -1, end: -1 }); detached++; }
  }
  for (const q of st.quotes.filter(x => x.docId === docId)) {
    if (text.slice(q.start, q.start + q.text.length) === q.text) continue;
    const i = nearest(q.text, q.start); if (i >= 0) st.update('quotes', q.id, { start: i });
  }
  return { moved, detached };
}
