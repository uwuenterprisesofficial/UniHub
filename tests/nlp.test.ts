import { describe, expect, it } from 'vitest';
import { buildCorpus, candidateTerms, findDefinitions, paragraphs, quoteCandidates, sentences, summarize } from '../src/lib/nlp';

const TEXT = `1. Introduction

Graph algorithms are central to computer science. A graph is defined as a set of vertices connected by edges. Dr. Smith argued in 1959 that shortest path problems occur in 80% of routing applications. This chapter introduces the basic concepts.

2. Dijkstra's Algorithm

Dijkstra's algorithm finds the shortest path between nodes in a weighted graph. It requires non-negative edge weights, otherwise the greedy choice is no longer correct. The algorithm maintains a priority queue of tentative distances. With a binary heap the runtime is O((V+E) log V). We show that the greedy strategy is optimal because every settled vertex has a final distance.

A priority queue is a data structure that supports insert and extract-min operations. The binary heap implements a priority queue efficiently. Binary heap operations take logarithmic time, which makes Dijkstra's algorithm practical for large sparse graphs.

3. Conclusion

In conclusion, Dijkstra's algorithm remains a fundamental tool. Natural Language Processing (NLP) is unrelated but shows abbreviations.`;

describe('paragraphs', () => {
  const ps = paragraphs(TEXT);
  it('recognises numbered headings and tracks the current section', () => {
    expect(ps.filter(p => p.heading).map(p => p.text)).toEqual(['1. Introduction', "2. Dijkstra's Algorithm", '3. Conclusion']);
    expect(ps.find(p => p.text.startsWith('A priority queue'))!.section).toBe("2. Dijkstra's Algorithm");
  });
  it('keeps character offsets that point back into the text', () => { for (const p of ps) expect(TEXT.slice(p.start, p.end)).toBe(p.text); });
  it('counts pages separated by form feeds', () => {
    const r = paragraphs('First page text here.\fSecond page text here.');
    expect(r.map(p => p.page)).toEqual([1, 2]);
  });
  it('treats a line with a sentence ending as body text, not a heading', () => {
    expect(paragraphs('Short sentence here.\n\nAnother paragraph that follows it.').some(p => p.heading)).toBe(false);
  });
});

describe('sentences', () => {
  it('does not split on common abbreviations or decimals', () => {
    const s = sentences('Dr. Smith measured 3.5 mg of the sample, e.g. in 2020. The result was clear.').map(x => x.text);
    expect(s).toHaveLength(2);
    expect(s[0]).toContain('Dr. Smith');
  });
  it('ends a sentence at a paragraph break even without punctuation (headings)', () => {
    expect(sentences('Neural Networks and Learning\n\nA neural network is a model.').map(s => s.text)).toEqual(['Neural Networks and Learning', 'A neural network is a model.']);
  });
  it('returns offsets that match the source', () => { for (const s of sentences(TEXT)) expect(TEXT.slice(s.start, s.end)).toBe(s.text); });
});

describe('definitions', () => {
  const defs = findDefinitions(TEXT);
  it('finds "X is defined as" and "X is a" definitions, without leading articles', () => {
    const terms = defs.map(d => d.term);
    expect(terms).toContain('graph');
    expect(terms).toContain('priority queue');
  });
  it('captures abbreviations as aliases', () => { expect(defs.find(d => d.alias === 'NLP')?.term).toBe('Natural Language Processing'); });
  it('reads glossary-style lines', () => {
    const d = findDefinitions('- Vertex :: A node in a graph\n- Heap :: Tree structure with logarithmic operations');
    expect(d.map(x => x.term)).toEqual(['Vertex', 'Heap']);
  });
  it('does not treat ordinary sentences as definitions', () => { expect(findDefinitions('We went to the market yesterday and bought apples.')).toEqual([]); });
});

describe('candidate terms', () => {
  const terms = candidateTerms(TEXT, buildCorpus([TEXT]), 12).map(t => t.surface);
  it('prefers multi-word domain phrases', () => { expect(terms).toEqual(expect.arrayContaining(['priority queue', 'binary heap'])); });
  it('keeps possessives inside phrases but drops generic words', () => {
    expect(terms).toContain("Dijkstra's algorithm");
    for (const generic of ['show', 'time', 'result', 'every']) expect(terms).not.toContain(generic);
  });
  it('does not return a single word that only occurs inside a stronger phrase', () => { expect(terms).not.toContain('queue'); });
});

describe('summarize', () => {
  const s = summarize(TEXT, buildCorpus([TEXT]));
  it('selects only sentences that exist verbatim in the text', () => { for (const x of [...s.overall, ...s.facts]) expect(TEXT).toContain(x.text); });
  it('orders the summary as in the document and avoids near-duplicates', () => {
    const starts = s.overall.map(x => x.start); expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(s.overall.map(x => x.text)).size).toBe(s.overall.length);
  });
  it('marks sentences with numbers, dates or definitions as facts', () => { expect(s.facts.some(f => /1959|defined as/.test(f.text))).toBe(true); });
  it('has highlight ranges inside the text', () => { for (const [a, b] of s.highlight) expect(b).toBeLessThanOrEqual(TEXT.length), expect(a).toBeLessThan(b); });
  it('copes with empty input', () => { expect(summarize('').overall).toEqual([]); });
});

describe('quote candidates', () => {
  const q = quoteCandidates(TEXT, buildCorpus([TEXT]), 5);
  it('returns complete verbatim sentences with scores between 0 and 1', () => {
    expect(q.length).toBeGreaterThan(0);
    for (const x of q) { expect(TEXT.slice(x.start, x.end)).toBe(x.text); expect(x.score).toBeGreaterThanOrEqual(0); expect(x.score).toBeLessThanOrEqual(1); expect(x.text.length).toBeGreaterThanOrEqual(70); }
  });
});
