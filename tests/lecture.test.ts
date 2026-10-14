import { beforeEach, describe, expect, it } from 'vitest';
import { buildLectureSummary, ensureSession, lectureMaterial, liveNote, sessionDocs, sessionNotes } from '../src/lib/lecture';
import { getData, useStore, wipeLocal } from '../src/lib/store';
import { D } from './fixtures';

const NOTES = `# Graphs, lecture 4

## Shortest paths
- Dijkstra finds shortest paths from one source vertex in a weighted graph
- It only works with non-negative edge weights because the greedy choice must stay correct
- Runtime with a binary heap is O((V+E) log V)
- BFS solves the unweighted case

## Bellman-Ford
Bellman-Ford handles negative edge weights but is slower than Dijkstra.

## Questions
- Why does the greedy choice break with negative weights?
- What is the difference between a heap and a priority queue?

## To do
- [ ] Redo exercise 3 on negative cycles
- [ ] Read chapter 7
- [x] Hand in sheet 2

A priority queue is a data structure that supports insert and extract-min operations.`;

const DOC = `1. Shortest paths

Dijkstra's algorithm finds the shortest path from a source vertex to all other vertices in a weighted graph. It requires non-negative edge weights, otherwise the greedy choice is no longer correct. Problem set 5 must be submitted by ${D(6)} via the portal.

2. Heaps

A binary heap implements a priority queue efficiently. Binary heap operations take logarithmic time, which makes the algorithm practical for sparse graphs.`;

function setup() {
  const st = useStore.getState();
  const m = st.add('modules', { name: 'Algorithms', code: 'CS201', lecturer: '', email: '', semester: 's', ects: 6, room: '', link: '', exam: '', color: '#000', icon: '', objectives: '', grades: [] });
  const doc = st.add('docs', { name: 'Slides 4.pdf', ext: 'pdf', mime: '', size: 1, moduleId: m.id, folder: '', tags: [], fav: false, added: 0, opened: 0, text: '', read: false, versions: [] });
  const s = ensureSession(m.id, D(0)); st.update('sessions', s.id, { docIds: [doc.id], topic: 'Shortest paths' });
  return { m, doc, s: useStore.getState().sessions[0] };
}

describe('sessions', () => {
  beforeEach(() => wipeLocal());
  it('finds the existing session for a module and day instead of creating a second one', () => {
    const { m, s } = setup(); expect(ensureSession(m.id, D(0)).id).toBe(s.id); expect(useStore.getState().sessions).toHaveLength(1);
    expect(ensureSession(m.id, D(1)).id).not.toBe(s.id); expect(useStore.getState().sessions).toHaveLength(2);
  });
  it('ties a session to a calendar event when one is given later', () => {
    const { m, s } = setup(); ensureSession(m.id, D(0), 'ev1'); expect(useStore.getState().sessions.find(x => x.id === s.id)!.eventId).toBe('ev1');
  });
  it('creates the live note once, with a ready-to-fill outline', () => {
    const { s } = setup(); const a = liveNote(s), b = liveNote(useStore.getState().sessions[0]);
    expect(b.id).toBe(a.id); expect(useStore.getState().notes).toHaveLength(1); expect(a.sessionId).toBe(s.id); expect(a.tags).toContain('live'); expect(a.body).toMatch(/## Key points[\s\S]*## Questions[\s\S]*## To do/);
  });
});

describe('lecture summary', () => {
  beforeEach(() => wipeLocal());
  const build = () => {
    const { s, doc } = setup(); const st = useStore.getState();
    const note = liveNote(s); st.update('notes', note.id, { body: NOTES });
    const ann = st.add('annotations', { docId: doc.id, start: 0, end: 40, quote: 'It requires non-negative edge weights', kind: 'important', color: '#f00', note: 'exam relevant', termId: '', tags: [], page: 3, created: Date.now() });
    st.add('annotations', { docId: doc.id, start: 50, end: 90, quote: 'heap operations take logarithmic time', kind: 'unclear', color: '#f00', note: '', termId: '', tags: [], page: 4, created: Date.now() });
    st.add('annotations', { docId: doc.id, start: 100, end: 120, quote: 'highlight from last week', kind: 'highlight', color: '#f00', note: '', termId: '', tags: [], page: 1, created: Date.now() - 7 * 864e5 });
    st.add('terms', { term: 'Priority queue', aliases: ['PQ'], definition: 'Supports insert and extract-min.', moduleId: '', status: 'confirmed', auto: false, sourceDocId: '', created: 0 });
    const d = getData(); return { d, s: d.sessions[0], r: buildLectureSummary(d, d.sessions[0], { [doc.id]: DOC }), ann };
  };

  it('puts the student\'s own points first and keeps their words', () => {
    const { r } = build(); expect(r.points[0]).toBe('Dijkstra finds shortest paths from one source vertex in a weighted graph');
    expect(r.points).toContain('Runtime with a binary heap is O((V+E) log V)'); expect(r.points.every(p => !p.includes('?'))).toBe(true);
  });
  it('adds only highlights made on the lecture day, with the student\'s note', () => {
    const { r } = build(); expect(r.highlights).toBe(2);
    expect(r.markdown).toMatch(/“It requires non-negative edge weights” — \*exam relevant\* \(Slides 4\.pdf, p\. 3\)/); expect(r.markdown).not.toContain('highlight from last week');
  });
  it('draws key sentences from the attached documents', () => { const { r } = build(); expect(r.docsUsed).toBe(1); expect(r.points.some(p => p.includes('Slides 4.pdf'))).toBe(true); });
  it('lists the covered topics from headings but not the template\'s own section names', () => {
    const { r } = build(); expect(r.outline).toEqual(['Shortest paths', 'Bellman-Ford']); expect(r.outline).not.toContain('Questions');
  });
  it('collects questions from notes and from "unclear" highlights', () => {
    const { r } = build(); expect(r.questions).toEqual(expect.arrayContaining(['Why does the greedy choice break with negative weights?', 'What is the difference between a heap and a priority queue?']));
    expect(r.questions.some(q => q.includes('heap operations take logarithmic time') && q.includes('unclear'))).toBe(true);
  });
  it('collects open to-dos (not finished ones) and deadlines found in the material', () => {
    const { r } = build(); expect(r.todos).toEqual(['Redo exercise 3 on negative cycles', 'Read chapter 7']);
    expect(r.deadlines.map(x => x.due)).toContain(D(6)); expect(r.markdown).toMatch(/- \[ \] Read chapter 7/);
  });
  it('lists glossary terms that occurred and definitions found, marking unknown ones as new', () => {
    const { r } = build(); const pq = r.terms.find(t => t.term === 'Priority queue'); expect(pq).toMatchObject({ known: true, definition: 'Supports insert and extract-min.' });
    expect(r.terms.some(t => !t.known)).toBe(true); expect(r.markdown).toContain('**Priority queue** – Supports insert and extract-min.'); expect(r.markdown).toMatch(/\*\(new\)\*/);
  });
  it('links the materials and never invents text outside the student\'s material', () => {
    const { r, d } = build(); expect(r.markdown).toMatch(/\[Slides 4\.pdf\]\(#\/documents\/\w+\)/); expect(r.markdown).toMatch(/Notes: \[\[/);
    const material = (NOTES + DOC + ' exam relevant Slides 4.pdf').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
    for (const p of r.points) expect(material).toContain(p.replace(/\*|“|”|\s\((?:[^()]*\.pdf[^()]*)\)$|\s—.*$/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 40));
    expect(sessionNotes(d, d.sessions[0])).toHaveLength(1); expect(sessionDocs(d, d.sessions[0])).toHaveLength(1);
  });
  it('keeps the summary free of noise: no term markers, fragments or repeated highlights, and no headings as new terms', () => {
    const { s, doc } = setup(); const st = useStore.getState(); st.update('notes', liveNote(s).id, { body: NOTES });
    const mk = (quote: string, kind: 'highlight' | 'term' | 'important', note = '') => st.add('annotations', { docId: doc.id, start: 0, end: quote.length, quote, kind, color: '#f00', note, termId: '', tags: [], page: 1, created: Date.now() });
    mk('Bellman-Ford algorithm', 'term'); mk('Edsger Dijkstra', 'highlight'); mk('Negative edge weights require the Bellman-Ford algorithm', 'important'); mk('Negative edge weights require the Bellman-Ford algorithm', 'highlight'); mk('Edsger', 'highlight', 'who is this?');
    const r = buildLectureSummary(getData(), getData().sessions[0], { [doc.id]: DOC }); const md = r.markdown;
    expect(md).not.toContain('“Bellman-Ford algorithm”'); expect(md).not.toContain('“Edsger Dijkstra”');            // term marker / 2-word fragment
    expect((md.match(/Negative edge weights require the Bellman-Ford algorithm/g) ?? []).length).toBe(1);               // duplicate collapsed
    expect(md).toContain('“Edsger” — *who is this?*');                                                                // a short highlight is kept when the student explained it
    expect(r.terms.map(t => t.term)).not.toContain('Shortest paths');                                                  // heading, not a term
  });
  it('shows "Term :: definition" lines as definitions only, and does not repeat in a document what the student already wrote', () => {
    const { s, doc } = setup(); const st = useStore.getState();
    st.update('notes', liveNote(s).id, { body: '## Heaps\n- Heap :: a tree structure with logarithmic insert and extract-min\n- Dijkstra finds the shortest path from a source vertex to all other vertices in a weighted graph\n' });
    const r = buildLectureSummary(getData(), getData().sessions[0], { [doc.id]: DOC }); const d = r.markdown;
    expect(d).toContain('**Heap** – a tree structure with logarithmic insert and extract-min'); expect(d).not.toMatch(/^- Heap :: /m);
    expect((d.match(/finds the shortest path from a source vertex/g) ?? []).length).toBe(1); // the student's wording wins over the document's
  });
  it('is honest about an empty lecture and tolerates missing documents', () => {
    const { s } = setup(); liveNote(s); const d = getData(); const r = buildLectureSummary(d, d.sessions[0], {});
    expect(r.empty).toBe(true); expect(r.markdown).toContain('# Lecture summary'); expect(r.markdown).not.toContain('## Key points');
    const st = useStore.getState(); st.update('sessions', s.id, { docIds: ['gone'] }); expect(() => buildLectureSummary(getData(), getData().sessions[0], {})).not.toThrow();
  });
  it('prepares bounded material for the AI writer, notes first', () => {
    const { d, s } = build(); const m = lectureMaterial(d, s, { [d.docs[0].id]: DOC.repeat(50) }, 3000);
    expect(m.text.startsWith("### Student's notes")).toBe(true); expect(m.text).toContain('highlighted'); expect(m.text.length).toBeLessThan(3000 + 2500); expect(m.chars).toBeGreaterThan(m.text.length - 2000);
  });
});
