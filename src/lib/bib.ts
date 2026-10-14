import type { Ref } from './types';
import { uid } from './util';

export type RefDraft = Omit<Ref, 'id' | 'projectId'>;
export const blankRef = (): RefDraft => ({ type: 'article', key: '', authors: '', title: '', year: '', journal: '', volume: '', pages: '', publisher: '', doi: '', url: '', docId: '', topic: '', status: 'to-read', quotes: '', chapterId: '' });

/** Authors are stored "Last, First and Last, First". */
const authorList = (a: string) => a.split(/\s+and\s+|;\s*/).map(x => x.trim()).filter(Boolean);
const surname = (a: string) => (a.includes(',') ? a.split(',')[0] : a.split(' ').pop() ?? a).trim();
const initials = (a: string) => { const first = a.includes(',') ? a.split(',')[1] : a.split(' ').slice(0, -1).join(' '); return (first ?? '').trim().split(/[\s-]+/).filter(Boolean).map(w => w[0].toUpperCase() + '.'); };

export function missingFields(r: RefDraft): string[] {
  const m: string[] = [];
  if (!r.authors) m.push('authors'); if (!r.title) m.push('title'); if (!r.year) m.push('year');
  if (r.type === 'article' && !r.journal) m.push('journal');
  if (r.type === 'book' && !r.publisher) m.push('publisher');
  if (!r.doi && !r.url) m.push('DOI/URL');
  return m;
}

export function formatCitation(r: RefDraft, style: 'APA' | 'IEEE' | 'Chicago', n = 1): string {
  const au = authorList(r.authors), src = r.journal || r.publisher;
  const doi = r.doi ? ` https://doi.org/${r.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : r.url ? ` ${r.url}` : '';
  if (style === 'APA') {
    const names = au.map(a => `${surname(a)}, ${initials(a).join(' ')}`.trim());
    const list = names.length > 2 ? names.slice(0, -1).join(', ') + ', & ' + names.at(-1) : names.join(' & ');
    return `${list} (${r.year || 'n.d.'}). ${r.title}.${src ? ` ${src}${r.volume ? ', ' + r.volume : ''}${r.pages ? ', ' + r.pages : ''}.` : ''}${doi}`.trim();
  }
  if (style === 'IEEE') {
    const names = au.map(a => `${initials(a).join(' ')} ${surname(a)}`.trim());
    const list = names.length > 2 ? names.slice(0, -1).join(', ') + ', and ' + names.at(-1) : names.join(' and ');
    return `[${n}] ${list}, "${r.title}," ${src ? src + (r.volume ? `, vol. ${r.volume}` : '') + (r.pages ? `, pp. ${r.pages}` : '') + ', ' : ''}${r.year}.${doi}`.trim();
  }
  const names = au.map((a, i) => i === 0 ? `${surname(a)}, ${(a.includes(',') ? a.split(',')[1] : a.split(' ').slice(0, -1).join(' ')).trim()}` : `${(a.includes(',') ? a.split(',')[1] : a.split(' ').slice(0, -1).join(' ')).trim()} ${surname(a)}`);
  const list = names.length > 2 ? names.slice(0, -1).join(', ') + ', and ' + names.at(-1) : names.join(' and ');
  return `${list}. "${r.title}." ${src ? src + (r.volume ? ' ' + r.volume : '') + (r.pages ? ': ' + r.pages : '') : ''} (${r.year}).${doi}`.replace(/\s+/g, ' ').trim();
}

/* ---------- BibTeX ---------- */
export function parseBibtex(text: string): RefDraft[] {
  const out: RefDraft[] = [];
  const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,([\s\S]*?)\n\s*\}\s*(?=@|$)/g;
  for (let m; (m = re.exec(text));) {
    const f: Record<string, string> = {};
    const fr = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\w+))\s*,?/g;
    for (let x; (x = fr.exec(m[3]));) f[x[1].toLowerCase()] = (x[2] ?? x[3] ?? x[4] ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    const t = m[1].toLowerCase();
    out.push({ ...blankRef(), type: t === 'book' ? 'book' : t === 'inproceedings' ? 'inproceedings' : t === 'article' ? 'article' : 'misc', key: m[2],
      authors: f.author ?? '', title: f.title ?? '', year: f.year ?? '', journal: f.journal ?? f.booktitle ?? '', volume: f.volume ?? '', pages: (f.pages ?? '').replace(/--/g, '–'),
      publisher: f.publisher ?? '', doi: f.doi ?? '', url: f.url ?? '' });
  }
  return out;
}
export function toBibtex(refs: Ref[]): string {
  return refs.map(r => {
    const key = r.key || (surname(authorList(r.authors)[0] ?? 'ref').toLowerCase() + r.year);
    const fields: [string, string][] = [['author', r.authors], ['title', r.title], ['year', r.year], [r.type === 'inproceedings' ? 'booktitle' : 'journal', r.journal], ['volume', r.volume], ['pages', r.pages.replace(/–/g, '--')], ['publisher', r.publisher], ['doi', r.doi], ['url', r.url]];
    return `@${r.type}{${key},\n${fields.filter(f => f[1]).map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}`;
  }).join('\n\n');
}

/* ---------- RIS ---------- */
export function parseRis(text: string): RefDraft[] {
  const out: RefDraft[] = []; let cur: RefDraft | null = null; const au: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/); if (!m) continue;
    const [, tag, v] = m;
    if (tag === 'TY') { cur = { ...blankRef(), type: v === 'BOOK' ? 'book' : v === 'CONF' ? 'inproceedings' : v === 'JOUR' ? 'article' : 'misc' }; au.length = 0; }
    else if (!cur) continue;
    else if (tag === 'AU' || tag === 'A1') au.push(v.trim());
    else if (tag === 'TI' || tag === 'T1') cur.title = v.trim();
    else if (tag === 'PY' || tag === 'Y1') cur.year = v.slice(0, 4);
    else if (tag === 'JO' || tag === 'T2' || tag === 'JF') cur.journal = v.trim();
    else if (tag === 'VL') cur.volume = v.trim();
    else if (tag === 'SP') cur.pages = v.trim();
    else if (tag === 'EP') cur.pages += '–' + v.trim();
    else if (tag === 'PB') cur.publisher = v.trim();
    else if (tag === 'DO') cur.doi = v.trim();
    else if (tag === 'UR') cur.url = v.trim();
    else if (tag === 'ER') { cur.authors = au.join(' and '); out.push(cur); cur = null; }
  }
  return out;
}
export function toRis(refs: Ref[]): string {
  const ty = { article: 'JOUR', book: 'BOOK', inproceedings: 'CONF', misc: 'GEN' };
  return refs.map(r => [`TY  - ${ty[r.type]}`, ...authorList(r.authors).map(a => `AU  - ${a}`), `TI  - ${r.title}`, `PY  - ${r.year}`, r.journal && `JO  - ${r.journal}`, r.volume && `VL  - ${r.volume}`,
    r.pages && `SP  - ${r.pages}`, r.publisher && `PB  - ${r.publisher}`, r.doi && `DO  - ${r.doi}`, r.url && `UR  - ${r.url}`, 'ER  - '].filter(Boolean).join('\n')).join('\n\n');
}
export const newId = uid;

/* ---------- quotes ---------- */
const surnames = (r: RefDraft) => authorList(r.authors).map(surname);
function authorsShort(r: RefDraft, joiner: string) {
  const s = surnames(r); if (!s.length) return r.title.split(/\s+/).slice(0, 3).join(' ');
  return s.length === 1 ? s[0] : s.length === 2 ? `${s[0]} ${joiner} ${s[1]}` : `${s[0]} et al.`;
}
export function inTextCitation(r: RefDraft | undefined, style: 'APA' | 'IEEE' | 'Chicago', page = '', n = 1): string {
  if (!r) return '';
  const p = page.trim(), range = /[–-]/.test(p);
  if (style === 'IEEE') return `[${n}${p ? `, ${range ? 'pp.' : 'p.'} ${p}` : ''}]`;
  if (style === 'Chicago') return `(${authorsShort(r, 'and')} ${r.year || 'n.d.'}${p ? ', ' + p : ''})`;
  return `(${authorsShort(r, '&')}, ${r.year || 'n.d.'}${p ? `, ${range ? 'pp.' : 'p.'} ${p}` : ''})`;
}
export interface FormattedQuote { inline: string; block: string; reference: string; footnote: string }
export function formatQuote(text: string, r: RefDraft | undefined, style: 'APA' | 'IEEE' | 'Chicago', page = '', n = 1): FormattedQuote {
  const clean = text.replace(/\s+/g, ' ').trim(), words = clean.split(' ').length;
  const cite = inTextCitation(r, style, page, n);
  const long = style !== 'IEEE' && words >= 40; // block quote convention
  const quoted = long ? clean : `“${clean}”`;
  const inline = long ? `${clean}\n${cite}` : `${quoted} ${cite}`.trim();
  const reference = r ? formatCitation(r, style, n) : '';
  const footnote = r ? `${authorsShort(r, 'and')}, ${r.title}${r.year ? ` (${r.year})` : ''}${page ? ', ' + page : ''}.` : '';
  return { inline, block: long ? `> ${clean}\n> ${cite}` : `> ${quoted} ${cite}`, reference, footnote };
}
