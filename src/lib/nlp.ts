/* Local, dependency-free text analysis (English + German). Everything here is extractive:
   it selects and ranks the author's own sentences, it never invents text. */

const EN = `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours however therefore thus also may might must shall upon within without whether either neither among per via et al fig table eg ie etc one two three first second new many much even still often likely based using used use every require requires required allow allows allowed explore explores solve solves publish published improve improves implement implements support supports make makes made take takes give gives find finds found show shows shown work works need needs call called become becomes remain remains include includes provide provides apply applies follow follows result results lead leads rarely nearly already simple simply instead otherwise because although`;
const DE = `der die das den dem des ein eine einer einem einen eines und oder aber auch als wie wenn dass daß weil nicht kein keine ist sind war waren wird werden wurde wurden hat haben hatte hatten sein ihr ihre ihrem ihren ihrer es sie er wir ihr mit von zu zur zum bei nach aus auf für über unter vor durch im in am an um so noch nur schon sehr wird kann können muss müssen soll sollen diese dieser dieses diesem diesen man sich dabei dazu daher also jedoch dann denn doch`;
export const STOP = new Set((EN + ' ' + DE).split(/\s+/));

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
export function stem(w: string): string {
  w = w.toLowerCase().replace(/['’]s$/, '');
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}
export interface Tok { raw: string; low: string; s: string; start: number; end: number; stop: boolean }
export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(WORD)) {
    const low = m[0].toLowerCase();
    out.push({ raw: m[0], low, s: stem(low), start: m.index!, end: m.index! + m[0].length, stop: STOP.has(low) || low.length < 2 || /^\d+$/.test(low) });
  }
  return out;
}
export const contentStems = (text: string) => tokenize(text).filter(t => !t.stop).map(t => t.s);

/* ---------- paragraphs ---------- */
export interface Para { start: number; end: number; text: string; heading: boolean; page: number; section: string }
const HEAD_RE = /^(#{1,6}\s+.+|(\d+(\.\d+){0,3}\.?|[IVX]+\.|Chapter \d+|Kapitel \d+)\s+\p{Lu}.{0,80}|\p{Lu}[^.!?:;]{2,80})$/u;
function looksLikeHeading(t: string, next?: string) {
  if (t.length > 90 || t.includes('\n') || /[.,;]$/.test(t)) return false;
  if (!HEAD_RE.test(t)) return false;
  const words = t.split(/\s+/);
  if (/^#{1,6}\s/.test(t) || /^(\d+(\.\d+){0,3}\.?|[IVX]+\.)\s/.test(t)) return true;
  if (words.length > 10) return false;
  const caps = words.filter(w => /^[\p{Lu}\d]/u.test(w) || STOP.has(w.toLowerCase())).length;
  return caps >= words.length * 0.75 && !!next && next.length > t.length;
}
export function paragraphs(text: string): Para[] {
  const raw: { start: number; end: number }[] = [];
  let pos = 0, page = 1;
  const pages: number[] = [];
  const re = /\n[ \t]*\n+|\f/g; let m: RegExpExecArray | null; let last = 0;
  const push = (a: number, b: number, pg: number) => { while (a < b && /\s/.test(text[a])) a++; while (b > a && /\s/.test(text[b - 1])) b--; if (b > a) { raw.push({ start: a, end: b }); pages.push(pg); } };
  while ((m = re.exec(text))) { push(last, m.index, page); if (m[0] === '\f') page++; last = m.index + m[0].length; }
  push(last, text.length, page);
  // plain text with only single newlines: treat each line as a paragraph
  if (raw.length < 4 && text.length > 1200 && text.includes('\n')) {
    raw.length = 0; pages.length = 0; page = 1; pos = 0;
    for (const ln of text.split(/(\n|\f)/)) { if (ln === '\f') page++; else if (ln !== '\n') push(pos, pos + ln.length, page); pos += ln.length; }
  }
  const out: Para[] = []; let section = '';
  raw.forEach((r, i) => {
    const t = text.slice(r.start, r.end);
    const heading = looksLikeHeading(t, i + 1 < raw.length ? text.slice(raw[i + 1].start, raw[i + 1].end) : undefined);
    if (heading) section = t.replace(/^#{1,6}\s+/, '');
    out.push({ ...r, text: t, heading, page: pages[i], section });
  });
  return out;
}

/* ---------- sentences ---------- */
export interface Sent { start: number; end: number; text: string; page?: number }
const ABBR = /(?:\b(?:Dr|Prof|Mr|Mrs|Ms|vs|etc|cf|Fig|Figs|No|Nr|al|approx|ca|bzw|z\.B|d\.h|u\.a|e\.g|i\.e|St|Jr|Sr|Inc|Ltd)|\b\p{Lu})\.$/u;
export function sentences(text: string, base = 0): Sent[] {
  const out: Sent[] = []; let start = 0;
  // a sentence ends at terminal punctuation or at a paragraph/page break (headings have no punctuation)
  const re = /[.!?]+["'”’)\]]*\s+|\n[ \t]*\n\s*|\f\s*/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].trimEnd().length, chunk = text.slice(start, end);
    if (!/^[.!?]/.test(m[0])) { push(start, m.index); start = m.index + m[0].length; continue; }
    const nextCh = text[m.index + m[0].length] ?? '';
    if (ABBR.test(chunk) && !/^\p{Lu}[a-z]/u.test(nextCh) && /\d|\p{Ll}/u.test(nextCh)) continue;
    if (ABBR.test(chunk) && chunk.length < 6) continue;
    if (/\d\.$/.test(chunk) && /^\d/.test(nextCh)) continue;
    push(start, end); start = m.index + m[0].length;
  }
  push(start, text.length);
  function push(a: number, b: number) { while (a < b && /\s/.test(text[a])) a++; while (b > a && /\s/.test(text[b - 1])) b--; if (b - a > 1) out.push({ start: base + a, end: base + b, text: text.slice(a, b) }); }
  return out;
}

/* ---------- corpus statistics ---------- */
export interface Corpus { N: number; df: Map<string, number> }
export function buildCorpus(texts: string[]): Corpus {
  const df = new Map<string, number>();
  for (const t of texts) for (const s of new Set(contentStems(t))) df.set(s, (df.get(s) ?? 0) + 1);
  return { N: texts.length, df };
}
export const idf = (c: Corpus | undefined, s: string) => c && c.N > 1 ? Math.log(1 + (c.N + 1) / (1 + (c.df.get(s) ?? 0))) : 1;

/* ---------- definitions ---------- */
export interface Definition { term: string; definition: string; start: number; end: number; alias?: string }
const GENERIC = new Set('show shows shown time times operation operations result results chapter introduction conclusion approach case cases number numbers way ways problem problems example examples section figure paper work works method methods system systems point points part parts form type types kind thing things fact facts idea ideas question questions answer answers value values order step steps change changes level levels end beginning rule rules role roles issue issues term terms word words text texts line lines list lists set sets group groups'.split(' '));
const stripArt = (t: string) => t.replace(/^(?:the|a|an|der|die|das|ein|eine)\s+/i, '').trim();
const DEF_PATTERNS: RegExp[] = [
  /^(?:the |a |an |der |die |das )?([\p{L}][\p{L}\p{N}\- ]{2,50}?)\s+(?:is|are|ist|sind)\s+(?:defined as|called|known as|referred to as|definiert als|bezeichnet als|genannt)\s+(.{12,})/iu,
  /^(?:we|let us|to)\s+define\s+(?:the |a |an )?([\p{L}][\p{L}\p{N}\- ]{2,50}?)\s+as\s+(.{12,})/iu,
  /^(?:the |a |an |der |die |das )?([\p{L}][\p{L}\p{N}\- ]{2,50}?)\s+(?:refers to|describes|denotes|bezeichnet|beschreibt)\s+(.{12,})/iu,
  /^(?:the |a |an )?([\p{Lu}][\p{L}\p{N}\- ]{2,40}?)\s+(?:is|are)\s+(?:a|an|the)\s+(.{20,})/u,
  /^(?:der |die |das |ein |eine )?([\p{Lu}][\p{L}\p{N}\- ]{2,40}?)\s+ist\s+(?:ein|eine|der|die|das)\s+(.{20,})/u,
];
export function findDefinitions(text: string): Definition[] {
  const out: Definition[] = [];
  for (const s of sentences(text)) {
    let hit = false;
    for (const re of DEF_PATTERNS) {
      const m = s.text.replace(/^[-*•]\s+/, '').match(re); if (!m) continue;
      const term = stripArt(m[1]);
      const words = term.split(/\s+/);
      if (words.length > 5 || words.every(w => STOP.has(w.toLowerCase())) || STOP.has(term.toLowerCase())) continue;
      out.push({ term, definition: s.text.replace(/^[-*•]\s+/, ''), start: s.start, end: s.end }); hit = true; break;
    }
    if (hit) continue;
  }
  // glossary-style lines:  Term :: definition  |  **Term** – definition  |  Term: definition
  for (const m of text.matchAll(/^[ \t]*(?:[-*•][ \t]+)?(?:\*\*|__)?([\p{L}][\p{L}\p{N}\- ]{1,40}?)(?:\*\*|__)?[ \t]*(?:::|[–—-]{1,2}|:)[ \t]+(.{15,})$/gmu)) {
    const term = m[1].trim(); if (term.split(/\s+/).length > 4 || STOP.has(term.toLowerCase())) continue;
    if (m[0].includes('::') || m[0].includes('**') || /^[\p{Lu}]/u.test(term)) out.push({ term, definition: m[2].trim(), start: m.index!, end: m.index! + m[0].length });
  }
  // abbreviations: "Natural Language Processing (NLP)"
  for (const m of text.matchAll(/((?:\p{Lu}[\p{L}\-]+\s+){1,4}\p{Lu}[\p{L}\-]+|(?:\p{L}[\p{L}\-]+\s+){1,4}\p{L}[\p{L}\-]+)\s+\(([\p{Lu}]{2,8})\)/gu)) {
    const letters = m[2].toLowerCase(), words = m[1].split(/\s+/);
    if (words.map(w => w[0].toLowerCase()).join('').endsWith(letters) || words.length >= letters.length)
      out.push({ term: m[1].trim(), alias: m[2], definition: `${m[1].trim()} (${m[2]})`, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/* ---------- key terms ---------- */
export interface TermCand { key: string; surface: string; count: number; score: number; n: number }
export function candidateTerms(text: string, corpus?: Corpus, limit = 60): TermCand[] {
  const toks = tokenize(text);
  const map = new Map<string, { surface: Map<string, number>; count: number; n: number; cap: number }>();
  let i = 0;
  while (i < toks.length) {
    if (toks[i].stop) { i++; continue; }
    // run of content tokens joined only by spaces/hyphens
    let j = i;
    while (j + 1 < toks.length && !toks[j + 1].stop && /^[ \t\-–]+$/.test(text.slice(toks[j].end, toks[j + 1].start))) j++;
    for (let a = i; a <= j; a++) for (let n = 1; n <= 3 && a + n - 1 <= j; n++) {
      const seg = toks.slice(a, a + n), surface = text.slice(seg[0].start, seg[n - 1].end).replace(/\s+/g, ' ');
      const key = seg.map(t => t.s).join(' ');
      if (n === 1 && GENERIC.has(seg[0].s)) continue;
      if (n === 1 && (seg[0].low.length < 4 && !/^\p{Lu}{2,6}$/u.test(seg[0].raw))) continue;
      const e = map.get(key) ?? { surface: new Map(), count: 0, n, cap: 0 };
      e.count++; e.surface.set(surface, (e.surface.get(surface) ?? 0) + 1);
      if (/^\p{Lu}/u.test(seg[0].raw) && (a > 0 && !/[.!?]\s*$/.test(text.slice(Math.max(0, toks[a].start - 3), toks[a].start)))) e.cap++;
      map.set(key, e);
    }
    i = j + 1;
  }
  const cands: TermCand[] = [];
  for (const [key, e] of map) {
    if (e.count < 2) continue;
    const parts = key.split(' ');
    const surface0 = [...e.surface.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (e.n === 1) {
      const acr = /^\p{Lu}{2,6}$/u.test(surface0), proper = e.cap / e.count >= 0.6;
      if (!acr && !proper && e.count < 3) continue;
      if (!acr && /(?:ly|ed|ing)$/i.test(surface0) && surface0.length < 9) continue;
    }
    const idfAvg = parts.reduce((a, p) => a + idf(corpus, p), 0) / parts.length;
    const surface = surface0.replace(/['’]s$/, '');
    const acronym = /^\p{Lu}{2,6}$/u.test(surface);
    cands.push({ key, surface, count: e.count, n: e.n, score: Math.pow(e.count, 0.85) * idfAvg * (1 + 0.6 * (e.n - 1)) * (1 + Math.min(e.cap / e.count, 1) * 0.3) * (acronym ? 1.4 : 1) });
  }
  cands.sort((a, b) => b.score - a.score);
  // drop unigrams that only appear as part of a stronger phrase
  const kept = cands.filter(c => !cands.some(o => o.n > c.n && o.count >= c.count * 0.8 && (' ' + o.key + ' ').includes(' ' + c.key + ' ')));
  return kept.slice(0, limit);
}

/* ---------- summary ---------- */
const CUE = /\b(in conclusion|to conclude|in summary|overall|importantly|in particular|key|crucial|fundamental|essential|significant(?:ly)?|we (?:find|show|propose|argue|conclude)|results? (?:show|indicate|suggest)|demonstrate[sd]?|therefore|thus|consequently|main|primary|central|zusammenfassend|wesentlich|entscheidend|folglich|somit)\b/i;
const NUM = /\b\d[\d.,]*\s?(%|percent|prozent|years?|jahre|million|billion|ms|kg|km|€|\$)?|\b(1[5-9]|20)\d{2}\b/;
export interface ScoredSent extends Sent { score: number; para: number; fact: boolean; definition: boolean }
export interface ParaSummary { para: Para; index: number; key: ScoredSent[]; terms: string[] }
export interface Summary {
  overall: ScoredSent[]; facts: ScoredSent[]; paras: ParaSummary[]; paragraphs: Para[]; keyTerms: TermCand[];
  highlight: [number, number][]; words: number;
}
export function summarize(text: string, corpus?: Corpus, opts: { overall?: number } = {}): Summary {
  const paras = paragraphs(text);
  const body = paras.filter(p => !p.heading);
  const terms = candidateTerms(text, corpus, 40);
  const tw = new Map<string, number>();
  const toks = tokenize(text).filter(t => !t.stop); const tf = new Map<string, number>();
  toks.forEach(t => tf.set(t.s, (tf.get(t.s) ?? 0) + 1));
  for (const [s, c] of tf) tw.set(s, (1 + Math.log(c)) * idf(corpus, s));
  terms.forEach(t => t.key.split(' ').forEach(k => tw.set(k, (tw.get(k) ?? 0) * 1.25)));
  const defStarts = new Set(findDefinitions(text).map(d => d.start));
  const all: ScoredSent[] = [];
  paras.forEach((p, pi) => {
    if (p.heading) return;
    const ss = sentences(p.text, p.start);
    ss.forEach((s, si) => {
      if (s.text.length < 35 || s.text.length > 450 || /^\W*(fig|table|abb|tab)\b/i.test(s.text)) return;
      const ts = new Set(tokenize(s.text).filter(t => !t.stop).map(t => t.s)); if (ts.size < 4) return;
      let w = 0; ts.forEach(t => { w += tw.get(t) ?? 0; });
      let score = w / Math.pow(ts.size, 0.65);
      const first = si === 0, def = [...defStarts].some(d => d >= s.start && d <= s.end);
      if (first) score *= 1.25; if (pi === 0 || pi === paras.length - 1) score *= 1.1;
      if (CUE.test(s.text)) score *= 1.3; if (def) score *= 1.3;
      const hasNum = NUM.test(s.text); if (hasNum) score *= 1.12;
      all.push({ ...s, page: p.page, score, para: pi, fact: hasNum || def || CUE.test(s.text), definition: def });
    });
  });
  const max = Math.max(1, ...all.map(s => s.score)); all.forEach(s => { s.score /= max; });
  const jaccard = (a: string, b: string) => { const A = new Set(contentStems(a)), B = new Set(contentStems(b)); let i = 0; A.forEach(x => B.has(x) && i++); return i / (A.size + B.size - i || 1); };
  const wanted = opts.overall ?? Math.max(4, Math.min(9, Math.round(body.length / 3)));
  const overall: ScoredSent[] = [];
  for (const s of [...all].sort((a, b) => b.score - a.score)) {
    if (overall.length >= wanted) break;
    if (overall.every(o => jaccard(o.text, s.text) < 0.5)) overall.push(s);
  }
  overall.sort((a, b) => a.start - b.start);
  const perPara: ParaSummary[] = [];
  paras.forEach((p, pi) => {
    if (p.heading) return;
    const ss = all.filter(s => s.para === pi);
    if (ss.length < 2 && p.text.length < 220) return;
    const n = ss.length > 7 ? 2 : 1;
    const key = [...ss].sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.start - b.start);
    const ptf = new Map<string, { s: number; surface: string }>();
    for (const t of tokenize(p.text)) if (!t.stop) { const e = ptf.get(t.s); ptf.set(t.s, { s: (e?.s ?? 0) + (tw.get(t.s) ?? 0), surface: e?.surface ?? t.raw }); }
    perPara.push({ para: p, index: pi, key, terms: [...ptf.values()].sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.surface) });
  });
  const facts = all.filter(s => s.fact && s.score > 0.35).sort((a, b) => b.score - a.score).slice(0, 10).sort((a, b) => a.start - b.start);
  const highlight: [number, number][] = [...overall, ...perPara.flatMap(p => p.key), ...facts].map(s => [s.start, s.end] as [number, number]);
  return { overall, facts, paras: perPara, paragraphs: paras, keyTerms: terms, highlight, words: toks.length };
}

/* ---------- quote-worthy passages ---------- */
const QCUE = /\b(argue[sd]?|claim[sd]?|conclude[sd]?|demonstrate[sd]?|show[s]? that|found that|we find|according to|significant(?:ly)?|fundamental|crucial|essential|central|is defined as|refers to|never|always|must|cannot|should|paradox|distinction|theory|principle|law|behaupte|folgert|zeigt|grundlegend|entscheidend)\b/i;
export interface QuoteCand { start: number; end: number; text: string; score: number; page: number }
export function quoteCandidates(text: string, corpus?: Corpus, limit = 12): QuoteCand[] {
  const s = summarize(text, corpus);
  const paras = s.paragraphs;
  const out: QuoteCand[] = [];
  paras.forEach((p, pi) => {
    if (p.heading) return;
    for (const se of sentences(p.text, p.start)) {
      const len = se.text.length;
      if (len < 70 || len > 340 || !/[.!?]["”’)]?$/.test(se.text) || /\[\d+\]|\bet al\.\s*\(?\d{4}/.test(se.text) && len < 100) continue;
      const toks = tokenize(se.text).filter(t => !t.stop);
      if (toks.length < 7) continue;
      let sc = toks.reduce((a, t) => a + idf(corpus, t.s), 0) / toks.length * 0.35;
      if (QCUE.test(se.text)) sc += 0.55;
      if (s.keyTerms.slice(0, 15).some(k => se.text.toLowerCase().includes(k.surface.toLowerCase()))) sc += 0.3;
      if (/^(However|This|It|These|Those|Such|They|Dies|Es|Diese)\b/.test(se.text)) sc -= 0.25;
      if (len >= 90 && len <= 240) sc += 0.2;
      if (/\d{3,}|http/.test(se.text)) sc -= 0.15;
      out.push({ start: se.start, end: se.end, text: se.text, score: sc, page: p.page });
    }
  });
  const max = Math.max(0.01, ...out.map(o => o.score));
  return out.map(o => ({ ...o, score: Math.max(0, Math.min(1, o.score / max)) })).sort((a, b) => b.score - a.score).slice(0, limit).sort((a, b) => a.start - b.start);
}
