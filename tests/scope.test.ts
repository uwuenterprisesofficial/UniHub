import { describe, expect, it } from 'vitest';
import { buildIndex, query, scopeFilter } from '../src/lib/kb';
import { buildGraph, neighborhood } from '../src/lib/graph';
import { retrieve } from '../src/lib/rag';
import type { Data, Session } from '../src/lib/types';
import { emptyData } from './fixtures';

const mod = (id: string, name: string) => ({ id, name, code: id.toUpperCase(), lecturer: '', email: '', semester: 's', ects: 5, room: '', link: '', exam: '', color: '#000', icon: '', objectives: '', grades: [] });
const doc = (id: string, moduleId: string) => ({ id, name: id + '.md', ext: 'md', mime: '', size: 1, moduleId, folder: '', tags: [], fav: false, added: 0, opened: 0, text: '', read: false, versions: [] });
const note = (id: string, moduleId: string, body: string, sessionId?: string) => ({ id, title: 'Note ' + id, body, moduleId, tags: [], pinned: false, updated: 0, sessionId });
const sess = (id: string, moduleId: string, docIds: string[], summary = ''): Session => ({ id, moduleId, date: '2026-10-1' + id.length, title: '', topic: '', eventId: '', status: 'done', docIds, summary, summarySource: '', summaryEdited: false, summaryAt: 0, created: 0 });

function world() {
  const d: Data = emptyData();
  d.modules.push(mod('m1', 'Algorithms'), mod('m2', 'Statistics'));
  d.docs.push(doc('slidesA', 'm1'), doc('slidesB', 'm1'), doc('library', 'm1'), doc('stats', 'm2'));
  d.sessions.push(sess('A', 'm1', ['slidesA'], '## Key points\n- Monday we proved that the heap property gives logarithmic operations quickly.'), sess('B', 'm1', ['slidesB']));
  d.notes.push(note('nA', 'm1', 'Monday notes: the heap property keeps the smallest element at the root of the tree.', 'A'), note('nB', 'm1', 'Tuesday notes: a heap sort first builds a heap and then removes the root repeatedly.', 'B'),
    note('nFree', 'm1', 'Loose thoughts about heap implementations in various programming languages and libraries.'), note('nStat', 'm2', 'Statistics heap of data: a heap of observations summarised by the mean value.'));
  d.annotations.push({ id: 'aA', docId: 'slidesA', start: 0, end: 10, quote: 'heap property highlighted on Monday', kind: 'important', color: '#f00', note: '', termId: '', tags: [], page: 1, created: 0 });
  d.quotes.push({ id: 'qA', text: 'The heap property is the invariant of the structure.', docId: 'slidesA', refId: '', page: '', annotationId: '', moduleId: 'm1', projectId: '', chapterId: '', tags: [], comment: '', status: 'saved', auto: false, score: 1, start: 0, created: 0 },
    { id: 'qLib', text: 'A heap is a specialised tree-based data structure from the library.', docId: 'library', refId: '', page: '', annotationId: '', moduleId: 'm1', projectId: '', chapterId: '', tags: [], comment: '', status: 'saved', auto: false, score: 1, start: 0, created: 0 });
  d.terms.push({ id: 'tHeap', term: 'Heap', aliases: [], definition: 'A tree structure where every parent is smaller than its children.', moduleId: 'm2', status: 'confirmed', auto: false, sourceDocId: '', created: 0 });
  const texts = {
    slidesA: 'Slides Monday. The heap property says every parent is smaller than its children in the tree structure.\n\nA second paragraph about the heap root and how insertion bubbles up.',
    slidesB: 'Slides Tuesday. Heap sort builds a max heap, then repeatedly swaps the root with the last element.',
    library: 'Library chapter. The heap data structure is used for priority queues and for scheduling algorithms.',
    stats: 'Statistics slides. A heap of numbers is not a structure we care about; we study distributions.',
  };
  return { d, idx: buildIndex(d, texts) };
}
const sources = (r: ReturnType<typeof query>) => new Set(r.hits.map(h => h.chunk.id.split(':')[0] + ':' + (h.chunk.id.startsWith('doc:') ? h.chunk.docId : h.chunk.id.split(':')[1])));

describe('scopes', () => {
  const { d, idx } = world();

  it('"everything" searches all material', () => {
    const s = sources(query(idx, d, 'heap', { limit: 100 }));
    for (const x of ['doc:slidesA', 'doc:slidesB', 'doc:library', 'doc:stats', 'note:nA', 'note:nB', 'note:nFree', 'note:nStat']) expect(s.has(x), x).toBe(true);
  });

  it('a lecture day only sees its own notes, summary, attached documents, highlights and quotes', () => {
    const s = sources(query(idx, d, 'heap', { scope: { sessionId: 'A' }, limit: 100 }));
    for (const x of ['note:nA', 'doc:slidesA', 'ann:aA', 'q:qA', 'sess:A']) expect(s.has(x), x).toBe(true);
    for (const x of ['note:nB', 'doc:slidesB', 'doc:library', 'doc:stats', 'note:nFree', 'note:nStat', 'q:qLib']) expect(s.has(x), x + ' must be excluded').toBe(false);
  });

  it('two lecture days are separate worlds', () => {
    const a = sources(query(idx, d, 'heap root', { scope: { sessionId: 'A' }, limit: 100 })), b = sources(query(idx, d, 'heap root', { scope: { sessionId: 'B' }, limit: 100 }));
    expect(a.has('note:nB')).toBe(false); expect(b.has('note:nA')).toBe(false); expect(b.has('doc:slidesB')).toBe(true); expect(b.has('doc:slidesA')).toBe(false);
  });

  it('the glossary is global: its definitions are available in every scope', () => {
    for (const scope of [{ sessionId: 'A' }, { moduleId: 'm1' }, { moduleId: 'm2' }]) {
      const r = query(idx, d, 'what is a heap', { scope, limit: 100 });
      expect(r.hits.some(h => h.chunk.kind === 'term' && h.chunk.id === 'term:tHeap'), JSON.stringify(scope)).toBe(true); expect(r.termIds).toContain('tHeap');
    }
  });

  it('a module sees all of its lectures, library documents and notes, but nothing of other modules', () => {
    const s = sources(query(idx, d, 'heap', { scope: { moduleId: 'm1' }, limit: 100 }));
    for (const x of ['doc:slidesA', 'doc:slidesB', 'doc:library', 'note:nA', 'note:nB', 'note:nFree']) expect(s.has(x), x).toBe(true);
    for (const x of ['doc:stats', 'note:nStat']) expect(s.has(x), x + ' must be excluded').toBe(false);
  });

  it('keeps the old moduleId option working and treats an empty or unknown scope sensibly', () => {
    expect(sources(query(idx, d, 'heap', { moduleId: 'm2', limit: 100 })).has('note:nA')).toBe(false);
    expect(scopeFilter(d, {})).toBeNull(); expect(scopeFilter(d, undefined)).toBeNull();
    const r = query(idx, d, 'heap', { scope: { sessionId: 'does-not-exist', moduleId: 'm1' }, limit: 100 }); // unknown lecture falls back to its module
    expect(sources(r).has('note:nA')).toBe(true);
  });

  it('retrieval for RAG obeys the same scope, including neighbouring paragraphs and graph expansion', async () => {
    const r = await retrieve(idx, d, 'heap property', { scope: { sessionId: 'A' } });
    expect(r.sources.length).toBeGreaterThan(0);
    for (const s of r.sources) { const c = s.chunk; expect(c.kind === 'term' || c.docId === 'slidesA' || c.id.startsWith('note:nA') || c.id.startsWith('sess:A') || c.id.startsWith('q:qA') || c.id.startsWith('mod:m1'), c.id).toBe(true); }
    for (const f of r.fused) expect(f.chunk.id.startsWith('note:nB') || f.chunk.docId === 'slidesB').toBe(false);
  });
});

describe('lecture scope in the knowledge graph', () => {
  const { d, idx } = world(); const g = buildGraph(d, idx);
  it('shows a lecture with its own material, without pulling in the rest of the course through the module or a shared concept', () => {
    const nb = neighborhood(g, 'sess:A', 2, n => n.type !== 'module' && n.type !== 'term');
    for (const id of ['sess:A', 'note:nA', 'doc:slidesA', 'mod:m1']) expect(nb.has(id), id).toBe(true);
    for (const id of ['sess:B', 'note:nB', 'doc:slidesB', 'doc:library', 'note:nFree', 'doc:stats']) expect(nb.has(id), id + ' must stay out').toBe(false);
  });
  it('would leak without the guard (the module and shared concepts touch everything), which is why the guard exists', () => {
    const leaky = neighborhood(g, 'sess:A', 2); expect(leaky.has('doc:library')).toBe(true);
  });
  it('still reaches the concepts connected to the lecture material', () => { expect(neighborhood(g, 'sess:A', 2, n => n.type !== 'module' && n.type !== 'term').has('term:tHeap')).toBe(true); });
});
