import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/lib/graph';
import { buildIndex } from '../src/lib/kb';
import { nodeInfo } from '../src/lib/nodeinfo';
import { D, emptyData } from './fixtures';

const d = emptyData();
d.modules.push({ id: 'm1', name: 'Algorithms', code: 'CS201', lecturer: 'Prof. Weber', email: '', semester: 'WS', ects: 6, room: 'Hall A', link: '', exam: 'Written, 90 min', color: '#000', icon: '🧮', objectives: 'Understand graph algorithms.', grades: [] });
d.docs.push({ id: 'doc1', name: 'Slides.pdf', ext: 'pdf', mime: '', size: 2048, moduleId: 'm1', folder: 'Lectures', tags: ['graphs'], fav: false, added: 0, opened: 0, text: '', read: true, versions: [] });
d.sessions.push({ id: 's1', moduleId: 'm1', date: '2026-10-12', title: 'Shortest paths', topic: 'Dijkstra', eventId: '', status: 'done', docIds: ['doc1'], summary: '# Lecture summary\n\n## Key points\n- Dijkstra needs non-negative weights', summarySource: 'extract', summaryEdited: false, summaryAt: 0, created: 0 });
d.notes.push({ id: 'n1', title: 'My notes', body: '## Heaps\n- a heap keeps the minimum at the root', moduleId: 'm1', tags: ['lecture'], pinned: true, updated: 0, sessionId: 's1' });
d.terms.push({ id: 't1', term: 'Priority queue', aliases: ['PQ'], definition: 'Supports insert and extract-min.', moduleId: 'm1', status: 'confirmed', auto: false, sourceDocId: '', created: 0 });
d.projects.push({ id: 'p1', title: 'Bachelor thesis', description: '', question: 'Do heaps matter?', scope: 'Scope text', supervisor: 'Dr. Okafor', supervisorEmail: '', deadline: D(60), requirements: '', style: 'APA', chapters: [{ id: 'c1', title: 'Methods', status: 'drafting', words: 800, target: 2000, notes: 'Describe the benchmark' }], milestones: [{ id: 'ms', title: 'Draft', date: D(10), done: true }], feedback: [], openQuestions: '' });
d.refs.push({ id: 'r1', projectId: 'p1', type: 'article', key: 'k', authors: 'Smith, John', title: 'On heaps', year: '2020', journal: 'J. Learning', volume: '', pages: '', publisher: '', doi: '', url: '', docId: '', topic: 'data structures', status: 'read', quotes: 'p. 4: key insight', chapterId: 'c1' });
d.quotes.push({ id: 'q1', text: 'A heap is a tree.', docId: 'doc1', refId: 'r1', page: '7', annotationId: '', moduleId: 'm1', projectId: 'p1', chapterId: '', tags: ['def'], comment: 'good definition', status: 'saved', auto: false, score: 1, start: 5, created: 0 });
d.annotations.push({ id: 'a1', docId: 'doc1', start: 0, end: 5, quote: 'non-negative weights', kind: 'important', color: '#f00', note: 'exam!', termId: 't1', tags: [], page: 3, created: 0 });
d.tasks.push({ id: 'k1', title: 'Redo exercise 3', desc: 'On negative cycles', moduleId: 'm1', type: 'Homework', due: D(2), start: '', priority: 3, status: 'Not started', estimate: 90, spent: 30, subtasks: [{ t: 'Read hint', done: true }], docIds: [], noteIds: [], link: '' });
d.flashcards.push({ id: 'f1', front: 'What is a heap?', back: 'A tree with the heap property', moduleId: 'm1', ease: 2.5, interval: 1, due: D(1), reps: 1, lapses: 0, confidence: 40 });
const DOC_TEXT = 'First page of the slides explains shortest paths on weighted graphs in detail with examples and proofs.\n\nDijkstra requires non-negative edge weights because otherwise the greedy choice is no longer correct.\fSecond page.';
const texts = { doc1: DOC_TEXT };
const idx = buildIndex(d, texts);

describe('nodeInfo: what the graph shows for a selected item', () => {
  it('describes a module with its facts and entry points', () => {
    const i = nodeInfo(d, texts, 'mod:m1')!; expect(i).toMatchObject({ kind: 'Module', title: 'Algorithms', subtitle: 'CS201 · WS', body: 'Understand graph algorithms.' });
    expect(Object.fromEntries(i.facts)).toMatchObject({ Lecturer: 'Prof. Weber', Room: 'Hall A', ECTS: '6', Lectures: '1', Documents: '1', 'Open tasks': '1', 'Glossary terms': '1' });
    expect(i.links.map(l => l.to)).toEqual(['/modules/m1', '/modules/m1/workspace']);
  });
  it('shows a lecture with its summary, counts and a link into the workspace', () => {
    const i = nodeInfo(d, texts, 'sess:s1')!; expect(i.kind).toBe('Lecture'); expect(i.title).toBe('Shortest paths'); expect(i.body).toContain('Dijkstra needs non-negative weights'); expect(i.body).not.toContain('# Lecture summary');
    expect(Object.fromEntries(i.facts)).toMatchObject({ Status: 'done', Notes: '1', Documents: '1', Summary: 'extracted' }); expect(i.links[0].to).toBe('/modules/m1/workspace?s=s1');
    const none = { ...d, sessions: [{ ...d.sessions[0], summary: '' }] }; expect(nodeInfo(none, texts, 'sess:s1')!.body).toMatch(/No summary yet/);
  });
  it('shows what is in a document: an excerpt, key sentences, size, pages and highlights', () => {
    const i = nodeInfo(d, texts, 'doc:doc1')!; expect(i.body).toContain('shortest paths on weighted graphs'); expect(i.points!.length).toBeGreaterThan(0);
    expect(Object.fromEntries(i.facts)).toMatchObject({ Type: 'PDF', Size: '2 KB', Pages: '2', Highlights: '1', Tags: 'graphs', Lectures: '1', Read: 'yes' }); expect(i.links[0]).toEqual({ label: 'Open in reader', to: '/documents/doc1' });
    expect(nodeInfo(d, {}, 'doc:doc1')!.body).toMatch(/No readable text/);
  });
  it('shows a note’s text, a term’s definition (with mention count) and a highlight with the student’s own note', () => {
    expect(nodeInfo(d, texts, 'note:n1')!).toMatchObject({ title: 'My notes', subtitle: 'Algorithms · lecture 2026-10-12' }); expect(nodeInfo(d, texts, 'note:n1')!.body).toContain('minimum at the root');
    const t = nodeInfo(d, texts, 'term:t1', idx)!; expect(t.body).toBe('Supports insert and extract-min.'); expect(t.subtitle).toBe('also: PQ'); expect(t.facts.find(f => f[0] === 'Mentioned in')).toBeTruthy(); expect(t.links.map(l => l.to)).toContain('/knowledge?q=Priority%20queue');
    const a = nodeInfo(d, texts, 'ann:a1')!; expect(a.body).toContain('**Your note:** exam!'); expect(Object.fromEntries(a.facts)).toMatchObject({ Document: 'Slides.pdf', Page: '3', Glossary: 'Priority queue' }); expect(a.links[0].to).toBe('/documents/doc1?at=0');
  });
  it('shows a quote with its formatted source, and a source with its citation', () => {
    const q = nodeInfo(d, texts, 'quote:q1')!; expect(q.body).toContain('“A heap is a tree.”'); expect(q.body).toContain('good definition'); expect(Object.fromEntries(q.facts).Source).toContain('Smith, J. (2020). On heaps.');
    const r = nodeInfo(d, texts, 'ref:r1')!; expect(r.body).toContain('Smith, J. (2020). On heaps.'); expect(r.body).toContain('key insight'); expect(Object.fromEntries(r.facts)).toMatchObject({ Topic: 'data structures', Reading: 'read' });
  });
  it('shows tasks, thesis projects, chapters and flashcards', () => {
    const t = nodeInfo(d, texts, 'task:k1')!; expect(t.body).toContain('On negative cycles'); expect(t.body).toContain('- [x] Read hint'); expect(Object.fromEntries(t.facts)).toMatchObject({ Priority: 'high', Estimate: '90 min', Spent: '30 min' });
    const p = nodeInfo(d, texts, 'proj:p1')!; expect(p.body).toContain('Do heaps matter?'); expect(Object.fromEntries(p.facts)).toMatchObject({ Chapters: '1', Sources: '1', Milestones: '1/1 done' });
    const c = nodeInfo(d, texts, 'chap:p1:c1')!; expect(c).toMatchObject({ title: 'Methods', subtitle: 'Bachelor thesis' }); expect(Object.fromEntries(c.facts)).toMatchObject({ Words: '800 / 2000', Sources: '1' });
    expect(nodeInfo(d, texts, 'card:f1')!.body).toContain('**A:** A tree with the heap property');
  });
  it('returns null for anything unknown, and has an answer for every item the graph can contain', () => {
    expect(nodeInfo(d, texts, 'doc:missing')).toBeNull(); expect(nodeInfo(d, texts, 'nonsense')).toBeNull(); expect(nodeInfo(d, texts, '')).toBeNull();
    const g = buildGraph(d, idx); for (const n of g.nodes) expect(nodeInfo(d, texts, n.id, idx), `${n.id} (${n.type})`).not.toBeNull();
  });
});
