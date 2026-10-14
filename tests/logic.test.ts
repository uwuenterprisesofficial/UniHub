import { beforeEach, describe, expect, it } from 'vitest';
import { reanchor } from '../src/lib/analysis';
import { chunkText, findVerbatim, withPageMarks } from '../src/lib/ai';
import { pageOf } from '../src/lib/extract';
import { buildIndex } from '../src/lib/kb';
import { retrieve, packContext } from '../src/lib/rag';
import { getData, useStore, wipeLocal } from '../src/lib/store';
import { hash } from '../src/lib/embed';
import { emptyData } from './fixtures';

const newTask = (title: string) => ({ title, desc: '', moduleId: '', type: 'Homework', due: '', start: '', priority: 2 as const, status: 'Not started', estimate: 0, spent: 0, subtasks: [], docIds: [], noteIds: [], link: '' });

describe('store bookkeeping for sync', () => {
  beforeEach(() => wipeLocal());
  it('stamps every write and records deletions as tombstones', () => {
    const s = useStore.getState(); const t = s.add('tasks', newTask('a')); expect(t.u).toBeGreaterThan(0);
    const before = useStore.getState().tasks[0].u!; return new Promise<void>(res => setTimeout(() => {
      s.update('tasks', t.id, { title: 'b' }); expect(useStore.getState().tasks[0].u!).toBeGreaterThan(before);
      s.remove('tasks', t.id); expect(useStore.getState().tasks).toHaveLength(0); expect(useStore.getState().tomb['tasks:' + t.id]).toBeGreaterThan(0); res();
    }, 3));
  });
  it('"delete all" tombstones everything so it also clears other devices, while wipeLocal does not', () => {
    const s = useStore.getState(); const a = s.add('tasks', newTask('a')), n = s.add('notes', { title: 'n', body: '', moduleId: '', tags: [], pinned: false, updated: 1 });
    s.reset(); const tomb = useStore.getState().tomb; expect(Object.keys(tomb)).toEqual(expect.arrayContaining(['tasks:' + a.id, 'notes:' + n.id]));
    wipeLocal(); expect(useStore.getState().tomb).toEqual({});
  });
  it('restoring a backup re-stamps items so they win over older remote copies', () => {
    const d = emptyData(); d.tasks.push({ id: 'old', ...newTask('restored'), u: 5 });
    useStore.getState().replaceAll(d); expect(useStore.getState().tasks[0].u!).toBeGreaterThan(1_000_000_000_000);
  });
  it('keeps unknown settings keys working after a partial settings object is restored', () => {
    useStore.getState().replaceAll({ ...emptyData(), settings: { stages: ['a', 'b'] } as never });
    const s = useStore.getState().settings; expect(s.stages).toEqual(['a', 'b']); expect(s.widgets.today).toBe(true); expect(s.dailyHours).toBeGreaterThan(0);
  });
});

describe('re-anchoring annotations after the text changes', () => {
  beforeEach(() => wipeLocal());
  const setup = (quote: string, start: number) => {
    const s = useStore.getState();
    const a = s.add('annotations', { docId: 'd', start, end: start + quote.length, quote, kind: 'highlight', color: '#fff', note: 'keep me', termId: '', tags: [], page: 1, created: 0 });
    return a.id;
  };
  const get = (id: string) => useStore.getState().annotations.find(a => a.id === id)!;
  it('moves an annotation to where its text now is, preferring the closest match', () => {
    const quote = 'the greedy choice'; const id = setup(quote, 60);
    const newText = `${quote} first. ` + 'x'.repeat(30) + ` and then ${quote} again.`;
    reanchor('d', newText); const a = get(id); expect(newText.slice(a.start, a.end)).toBe(quote); expect(a.note).toBe('keep me');
    expect(a.start).toBe(newText.lastIndexOf(quote)); // closest to the old offset (60), not the first occurrence
  });
  it('detaches (but keeps) annotations whose text disappeared, and leaves valid ones alone', () => {
    const keep = setup('stays here', 0), gone = setup('vanished text', 50);
    const res = reanchor('d', 'stays here and the rest of the document'); expect(res).toEqual({ moved: 0, detached: 1 });
    expect(get(gone)).toMatchObject({ start: -1, end: -1, note: 'keep me' }); expect(get(keep).start).toBe(0);
    expect(reanchor('d', 'stays here and the rest of the document')).toEqual({ moved: 0, detached: 0 }); // idempotent
  });
  it('re-attaches a detached annotation if its text comes back', () => {
    const id = setup('vanished text', 5); reanchor('d', 'nothing relevant in this text'); expect(get(id).start).toBe(-1);
    reanchor('d', 'now the vanished text is back'); expect(get(id).start).toBe(8);
  });
  it('only touches the given document', () => {
    useStore.getState().add('annotations', { docId: 'other', start: 0, end: 3, quote: 'abc', kind: 'note', color: '', note: '', termId: '', tags: [], page: 1, created: 0 });
    reanchor('d', 'zzz'); expect(useStore.getState().annotations.find(a => a.docId === 'other')!.start).toBe(0);
  });
});

describe('verifying AI quotes against the document', () => {
  const doc = 'The greedy strategy is optimal.\nEvery vertex   that is settled\nhas its final distance.';
  it('accepts exact quotes and quotes that differ only in whitespace', () => {
    expect(findVerbatim(doc, 'The greedy strategy is optimal.')).toEqual([0, 31]);
    const r = findVerbatim(doc, 'Every vertex that is settled has its final distance.'); expect(r).not.toBeNull(); expect(doc.slice(r![0], r![1])).toContain('settled');
  });
  it('rejects invented, altered or too-short quotes', () => {
    expect(findVerbatim(doc, 'The greedy strategy is never optimal.')).toBeNull(); expect(findVerbatim(doc, 'Dijkstra invented this in 1959 while shopping.')).toBeNull(); expect(findVerbatim(doc, 'greedy')).toBeNull();
  });
  it('treats regex characters in a quote literally', () => { expect(findVerbatim('runtime is O((V+E) log V) in total here', 'runtime is O((V+E) log V) in total')).not.toBeNull(); });
  it('chunks long text on paragraph boundaries without losing anything', () => {
    const t = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(40)).join('\n\n'); const chunks = chunkText(t, 1000);
    expect(chunks.every(c => c.length <= 1000)).toBe(true); expect(chunks.join('\n\n').replace(/\s+/g, ' ')).toBe(t.replace(/\s+/g, ' '));
  });
  it('splits a single huge paragraph and labels pages', () => { expect(chunkText('a'.repeat(2500), 1000)).toHaveLength(3); expect(withPageMarks('one\ftwo')).toBe('[Page 1]\none\n\n[Page 2]\ntwo'); expect(pageOf('a\fb\fc', 4)).toBe(3); });
});

describe('retrieval limits', () => {
  const d = emptyData();
  d.modules.push({ id: 'm', name: 'M', code: '', lecturer: '', email: '', semester: '', ects: 1, room: '', link: '', exam: '', color: '', icon: '', objectives: '', grades: [] });
  d.docs.push({ id: 'big', name: 'Big.md', ext: 'md', mime: '', size: 1, moduleId: 'm', folder: '', tags: [], fav: false, added: 0, opened: 0, text: '', read: false, versions: [] });
  const paras = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} explains the heap structure variant number ${i} with a distinct detail about ${'abcdefghijkl'[i]}-trees and pointers. ${'filler '.repeat(8)}`);
  const idx = buildIndex(d, { big: paras.join('\n\n') });
  it('does not flood the context with passages from one document', async () => {
    const r = await retrieve(idx, d, 'heap structure', { k: 8 });
    expect(r.sources.filter(s => s.via !== 'neighbor' && s.via !== 'graph' && s.chunk.docId === 'big').length).toBeLessThanOrEqual(3);
    expect(r.sources.map(s => s.n)).toEqual(r.sources.map((_, i) => i + 1)); // numbering is contiguous for citations
  });
  it('respects module filters and returns nothing for unknown topics', async () => {
    expect((await retrieve(idx, d, 'heap', { moduleId: 'other' })).sources).toEqual([]);
    expect((await retrieve(idx, d, 'quantum chromodynamics')).sources).toEqual([]);
  });
  it('packs context within the budget but always keeps at least three sources', async () => {
    const r = await retrieve(idx, d, 'heap structure', { k: 8 }); const ctx = packContext(r.sources, 200);
    expect((ctx.match(/<source /g) ?? []).length).toBeGreaterThanOrEqual(Math.min(3, r.sources.length)); expect(ctx).not.toContain('undefined');
  });
  it('hashes text deterministically and detects changes', () => { expect(hash('abc')).toBe(hash('abc')); expect(hash('abc')).not.toBe(hash('abd')); expect(getData().tasks).toBeDefined(); });
});
