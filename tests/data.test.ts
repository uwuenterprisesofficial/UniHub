import { describe, expect, it } from 'vitest';
import { conflictSet, exportICS, occurrences, parseICS } from '../src/lib/schedule';
import { blankRef, formatCitation, formatQuote, inTextCitation, missingFields, parseBibtex, parseRis, toBibtex, toRis } from '../src/lib/bib';
import { linkTerms, md } from '../src/lib/markdown';
import { buildIndex, query } from '../src/lib/kb';
import { buildGraph, insights, shortestPath } from '../src/lib/graph';
import { addDays, diffDays, fmt, parseD, weekStart } from '../src/lib/util';
import type { Note, Ref, Term } from '../src/lib/types';
import { D, emptyData, event } from './fixtures';

describe('dates', () => {
  it('round-trips and does arithmetic across month and DST boundaries', () => {
    expect(fmt(parseD('2026-03-29'))).toBe('2026-03-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(diffDays('2026-03-30', '2026-03-28')).toBe(2); expect(diffDays('2026-10-26', '2026-10-24')).toBe(2);
  });
  it('finds the start of the week for Monday and Sunday weeks', () => { expect(weekStart('2026-10-14', 1)).toBe('2026-10-12'); expect(weekStart('2026-10-14', 0)).toBe('2026-10-11'); expect(weekStart('2026-10-11', 1)).toBe('2026-10-05'); });
});

describe('recurring events', () => {
  const weekly = event({ date: '2026-01-05', repeat: 'weekly', until: '2026-02-02', exceptions: ['2026-01-19'] });
  it('expands weekly events inside a window, honouring until and exceptions', () => {
    expect(occurrences([weekly], '2026-01-01', '2026-03-01').map(o => o.date)).toEqual(['2026-01-05', '2026-01-12', '2026-01-26', '2026-02-02']);
  });
  it('starts mid-series correctly', () => { expect(occurrences([weekly], '2026-01-20', '2026-01-31').map(o => o.date)).toEqual(['2026-01-26']); });
  it('supports biweekly and daily', () => {
    expect(occurrences([event({ date: '2026-01-01', repeat: 'biweekly', until: '2026-02-01' })], '2026-01-01', '2026-02-28').map(o => o.date)).toEqual(['2026-01-01', '2026-01-15', '2026-01-29']);
    expect(occurrences([event({ date: '2026-01-01', repeat: 'daily', until: '2026-01-03' })], '2026-01-01', '2026-01-31')).toHaveLength(3);
  });
  it('detects overlaps but not touching events or different days', () => {
    const a = event({ date: D(1), start: '10:00', end: '11:00' }), b = event({ date: D(1), start: '10:30', end: '12:00' }), c = event({ date: D(1), start: '11:00', end: '12:00' }), d = event({ date: D(2), start: '10:30', end: '11:30' });
    const c1 = conflictSet(occurrences([a, b, c, d], D(0), D(3)));
    expect(c1.has(a.id + D(1)) && c1.has(b.id + D(1))).toBe(true);
    expect(c1.has(c.id + D(1))).toBe(true); // c overlaps b (11:00-12:00 vs 10:30-12:00)
    expect(c1.has(d.id + D(2))).toBe(false); // different day
    expect(conflictSet(occurrences([a, c], D(0), D(3))).size).toBe(0);
  });
});

describe('ICS', () => {
  it('round-trips events, recurrence, exceptions and special characters', () => {
    const e = event({ title: 'Lecture; with, special \\ chars', date: '2026-02-02', start: '09:15', end: '10:45', location: 'Hall A, 1st floor', desc: 'Line one\nLine two', repeat: 'weekly', until: '2026-05-04', exceptions: ['2026-03-02'] });
    const back = parseICS(exportICS([e]))[0];
    expect(back).toMatchObject({ title: e.title, date: e.date, start: '09:15', end: '10:45', location: e.location, desc: e.desc, repeat: 'weekly', until: '2026-05-04', exceptions: ['2026-03-02'] });
  });
  it('reads folded lines and all-day events from foreign calendars', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Final exam\r\n  in hall B\r\nDTSTART;VALUE=DATE:20260612\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const [ev] = parseICS(ics); expect(ev.title).toBe('Final exam in hall B'); expect(ev.date).toBe('2026-06-12'); expect(ev.start).toBe(''); expect(ev.type).toBe('exam');
  });
});

describe('bibliography', () => {
  const bib = `@article{smith2020,\n  author = {Smith, John and Doe, Jane},\n  title = {Deep {Learning} for Study},\n  journal = {Journal of Learning},\n  year = {2020},\n  volume = {12},\n  pages = {1--10},\n  doi = {10.1000/xyz}\n}\n\n@book{lee2018,\n  author = "Lee, Amy",\n  title = "Thinking",\n  publisher = "MIT Press",\n  year = 2018\n}\n`;
  const refs = parseBibtex(bib);
  it('parses BibTeX with braces, quotes and bare numbers', () => {
    expect(refs).toHaveLength(2); expect(refs[0]).toMatchObject({ key: 'smith2020', title: 'Deep Learning for Study', pages: '1–10', year: '2020' }); expect(refs[1]).toMatchObject({ type: 'book', year: '2018' });
  });
  const full = (r: typeof refs[number], i: number): Ref => ({ ...r, id: 'r' + i, projectId: 'p' });
  it('round-trips through BibTeX and RIS', () => {
    const all = refs.map(full);
    expect(parseBibtex(toBibtex(all)).map(r => r.title)).toEqual(refs.map(r => r.title));
    expect(parseRis(toRis(all)).map(r => [r.title, r.authors, r.year])).toEqual(refs.map(r => [r.title, r.authors, r.year]));
  });
  it('formats APA, IEEE and Chicago references', () => {
    expect(formatCitation(refs[0], 'APA')).toBe('Smith, J. & Doe, J. (2020). Deep Learning for Study. Journal of Learning, 12, 1–10. https://doi.org/10.1000/xyz');
    expect(formatCitation(refs[0], 'IEEE', 3)).toMatch(/^\[3\] J\. Smith and J\. Doe, "Deep Learning for Study,"/);
    expect(formatCitation(refs[1], 'Chicago')).toContain('Lee, Amy.');
  });
  it('builds in-text citations with pages and author counts', () => {
    expect(inTextCitation(refs[0], 'APA', '42')).toBe('(Smith & Doe, 2020, p. 42)');
    expect(inTextCitation(refs[0], 'APA', '42-43')).toContain('pp. 42-43');
    expect(inTextCitation({ ...refs[0], authors: 'A, B and C, D and E, F' }, 'APA')).toBe('(A et al., 2020)');
    expect(inTextCitation(refs[0], 'IEEE', '7', 2)).toBe('[2, p. 7]'); expect(inTextCitation(refs[0], 'Chicago', '9')).toBe('(Smith and Doe 2020, 9)');
  });
  it('uses a block quote for long passages (not for IEEE) and flags missing metadata', () => {
    const long = Array(45).fill('word').join(' ');
    expect(formatQuote(long, refs[0], 'APA', '3').inline).not.toContain('“'); expect(formatQuote(long, refs[0], 'IEEE', '3').inline).toContain('“');
    expect(formatQuote('Short quote.', undefined, 'APA').inline).toBe('“Short quote.”');
    expect(missingFields({ ...blankRef(), title: 'x' })).toEqual(expect.arrayContaining(['authors', 'year', 'DOI/URL']));
  });
});

describe('markdown', () => {
  const notes = [{ id: 'n1', title: 'Graph glossary' }] as Note[];
  it('escapes HTML so notes cannot inject markup', () => { expect(md('<img src=x onerror=alert(1)> **bold**', [])).not.toContain('<img'); expect(md('**bold**', [])).toContain('<b>bold</b>'); });
  it('resolves wiki links and marks missing ones', () => { const h = md('[[Graph glossary]] and [[Nope]]', notes); expect(h).toContain('href="#/notes/n1"'); expect(h).toContain('missing'); });
  it('links glossary terms in text only, never inside links or code', () => {
    const terms = [{ id: 't1', term: 'priority queue', aliases: ['PQ'], definition: 'A "queue"' }];
    const html = linkTerms('<p>A priority queues and PQ. <code>priority queue</code> <a href="#">priority queue</a></p>', terms);
    expect((html.match(/class="term"/g) ?? []).length).toBe(2); expect(html).toContain('title="A &quot;queue&quot;"');
  });
});

describe('knowledge index, query and graph', () => {
  const d = emptyData();
  const term = (id: string, t: string, def: string, aliases: string[] = []): Term => ({ id, term: t, aliases, definition: def, moduleId: 'm1', status: 'confirmed', auto: false, sourceDocId: '', created: 0 });
  d.modules.push({ id: 'm1', name: 'Algorithms', code: 'CS1', lecturer: '', email: '', semester: 's', ects: 5, room: '', link: '', exam: '', color: '#000', icon: '', objectives: '', grades: [] }, { id: 'm2', name: 'Statistics', code: 'ST1', lecturer: '', email: '', semester: 's', ects: 5, room: '', link: '', exam: '', color: '#000', icon: '', objectives: '', grades: [] });
  d.terms.push(term('pq', 'Priority queue', 'Supports insert and extract-min.', ['PQ']), term('heap', 'Binary heap', 'Tree implementing a priority queue.', ['heap']), term('var', 'Variance', 'Spread of a distribution.'));
  d.docs.push({ id: 'doc1', name: 'Lecture.md', ext: 'md', mime: '', size: 1, moduleId: 'm1', folder: '', tags: [], fav: false, added: 0, opened: 0, text: '', read: false, versions: [] });
  const text = 'A priority queue supports insert and extract-min. The binary heap implements a priority queue efficiently in logarithmic time.\n\nDijkstra uses a heap to pick the closest vertex first and finish quickly on sparse graphs.';
  d.notes.push({ id: 'n1', title: 'Stats note', body: 'Variance measures how far values spread around the mean value of the sample.', moduleId: 'm2', tags: [], pinned: false, updated: 0 });
  d.notes.push({ id: 'n2', title: 'Heap note', body: 'See [[Stats note]] and #/documents/doc1 for the heap and priority queue details of this course.', moduleId: 'm1', tags: [], pinned: false, updated: 0 });
  const idx = buildIndex(d, { doc1: text });

  it('indexes documents by paragraph and links glossary terms to every passage that mentions them', () => {
    expect(idx.chunks.filter(c => c.kind === 'document')).toHaveLength(2);
    expect((idx.termChunks.get('pq') ?? []).length).toBeGreaterThanOrEqual(2);
    expect(idx.chunks.filter(c => c.terms.has('var')).every(c => c.moduleId === 'm2' || c.kind === 'term' || c.kind === 'module')).toBe(true);
  });
  it('finds passages through aliases and ranks the answer source first', () => {
    const r = query(idx, d, 'PQ time complexity', { limit: 5 }); // "PQ" is only an alias
    expect(r.termIds).toContain('pq'); expect(r.hits[0].chunk.text.toLowerCase()).toContain('priority queue');
  });
  it('honours module filters, kind filters and phrase boosts', () => {
    expect(query(idx, d, 'variance', { moduleId: 'm1' }).hits.every(h => h.chunk.moduleId === 'm1')).toBe(true);
    expect(query(idx, d, 'priority queue', { kinds: new Set(['note']) }).hits.every(h => h.chunk.kind === 'note')).toBe(true);
    expect(query(idx, d, '"closest vertex"').hits[0].chunk.text).toContain('closest vertex');
  });
  it('returns nothing for text it has never seen', () => { expect(query(idx, d, 'quantum chromodynamics').hits).toEqual([]); });
  it('computes related terms from co-occurrence', () => { expect(idx.related('pq').map(r => r.id)).toContain('heap'); });

  const g = buildGraph(d, idx);
  it('connects concepts, documents, notes and modules with typed edges', () => {
    const has = (s: string, t: string, type: string) => g.edges.some(e => e.type === type && ((e.s === s && e.t === t) || (e.s === t && e.t === s)));
    expect(has('term:pq', 'doc:doc1', 'mentions')).toBe(true); expect(has('doc:doc1', 'mod:m1', 'in_module')).toBe(true);
    expect(has('note:n2', 'note:n1', 'links_to')).toBe(true); expect(has('note:n2', 'doc:doc1', 'links_to')).toBe(true); expect(has('term:pq', 'term:heap', 'related_to')).toBe(true);
  });
  it('finds the shortest path and respects unreachable nodes', () => {
    const p = shortestPath(g, 'term:var', 'doc:doc1'); expect(p).not.toBeNull(); expect(p!.nodes[0]).toBe('term:var'); expect(p!.nodes.at(-1)).toBe('doc:doc1'); expect(p!.edges.length).toBe(p!.nodes.length - 1);
    expect(shortestPath(g, 'term:pq', 'term:pq')!.edges).toEqual([]);
    const lonely = buildGraph({ ...d, notes: [...d.notes, { ...d.notes[0], id: 'n9', title: 'Island', body: 'x', moduleId: '' }] }, idx);
    expect(shortestPath(lonely, 'term:pq', 'note:n9')).toBeNull();
  });
  it('reports concepts that bridge modules', () => { expect(insights(g).bridges.map(b => b.t.id)).toEqual(expect.arrayContaining(['term:var'])); });
});
