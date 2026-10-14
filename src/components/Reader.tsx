import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Annotation, AnnKind, DocMeta, Term } from '../lib/types';
import { newCard } from '../lib/srs';
import { newNote, newTask, useStore } from '../lib/store';
import { useTexts } from '../lib/blobs';
import { getCorpus, suggestQuotes, suggestTerms } from '../lib/analysis';
import { findOccurrences } from '../lib/kb';
import { paragraphs, sentences, summarize, type Summary } from '../lib/nlp';
import { pageOf, PAGE_BREAK } from '../lib/extract';
import { download, parseTags } from '../lib/util';
import { Field, Modal, confirmBox, openDialog, toast } from './ui';
import { TermDialog, findTerm } from './TermDialog';
import { aiGate } from './AI';
import { useUrlState } from '../lib/nav';
import { aiQuotes, aiSummarize, useActiveProvider } from '../lib/ai';
import { findDeadlines } from '../lib/deadlines';
import { md } from '../lib/markdown';

export const COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'];
const KIND_LABEL: Record<AnnKind, string> = { highlight: 'Highlight', term: 'Glossary term', note: 'Note', important: 'Important', unclear: 'Unclear', research: 'Research further' };

interface Mark { s: number; e: number; type: 'ann' | 'term' | 'fact'; id: string; color?: string; kind?: AnnKind }

/* ---------- annotation dialog ---------- */
function AnnotationDialog({ id }: { id: string }) {
  const { annotations, terms, update, remove, add } = useStore();
  const a = annotations.find(x => x.id === id); const nav = useNavigate();
  const [d, setD] = useState(() => a ?? ({} as Annotation)); const [tags, setTags] = useState(a?.tags.join(', ') ?? '');
  if (!a) return null;
  return <Modal title="Annotation" buttons={[
    { label: 'Delete', cls: 'danger left', keepOpen: true, onClick: () => confirmBox('Delete this annotation?', () => remove('annotations', id)) },
    { label: '🧠 Flashcard', onClick: () => { add('flashcards', newCard({ front: d.note || `What is meant by: “${a.quote.slice(0, 80)}”?`, back: a.quote })); toast('Flashcard created'); } },
    { label: '☑ Task', onClick: () => { add('tasks', newTask({ title: `Follow up: ${(d.note || a.quote).slice(0, 70)}`, type: 'Reading' })); toast('Task created'); } },
    { label: 'Close' },
    { label: 'Save', cls: 'primary', onClick: () => update('annotations', id, { note: d.note, kind: d.kind, color: d.color, termId: d.termId, tags: parseTags(tags) }) }]}>
    <blockquote className="md" style={{ margin: '0 0 12px', padding: '8px 12px', borderLeft: `4px solid ${d.color}`, background: 'var(--panel2)', borderRadius: 6 }}>{a.quote}</blockquote>
    <Field label="Your note"><textarea value={d.note} onChange={e => setD({ ...d, note: e.target.value })} autoFocus placeholder="Add your thoughts, interpretation, question…" /></Field>
    <div className="grid2">
      <Field label="Type"><select value={d.kind} onChange={e => setD({ ...d, kind: e.target.value as AnnKind })}>{(Object.keys(KIND_LABEL) as AnnKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
      <Field label="Glossary term"><select value={d.termId} onChange={e => setD({ ...d, termId: e.target.value, kind: e.target.value ? 'term' : d.kind })}><option value="">— none —</option>{terms.filter(t => t.status === 'confirmed').map(t => <option key={t.id} value={t.id}>{t.term}</option>)}</select></Field>
    </div>
    <div className="row" style={{ marginBottom: 10 }}>{COLORS.map(c => <button key={c} aria-label={c} onClick={() => setD({ ...d, color: c })} style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: d.color === c ? '3px solid var(--text)' : '2px solid transparent', cursor: 'pointer' }} />)}</div>
    <Field label="Tags (comma separated)"><input type="text" value={tags} onChange={e => setTags(e.target.value)} /></Field>
    {d.termId && <p className="small"><a href={'#/glossary/' + d.termId} onClick={() => nav('/glossary/' + d.termId)}>Open glossary entry →</a></p>}
  </Modal>;
}

/* ---------- helpers ---------- */
function offsetOf(node: Node, off: number): number | null {
  const own = (n: Node | null): HTMLElement | null => (n && (n.nodeType === 3 ? n.parentElement : (n as HTMLElement))) ? ((n!.nodeType === 3 ? n!.parentElement : n as HTMLElement)!.closest('[data-s]') as HTMLElement | null) : null;
  if (node.nodeType === 3) { const sp = own(node); return sp ? +sp.dataset.s! + off : null; }
  const el = node as HTMLElement, child = el.childNodes[off];
  if (child) {
    const sp = own(child); if (sp) return +sp.dataset.s!;
    const first = (child as HTMLElement).querySelector?.('[data-s]') as HTMLElement | null; if (first) return +first.dataset.s!;
  }
  const prev = el.childNodes[off - 1] ?? el.lastChild;
  const sp = prev && (own(prev) ?? ((prev as HTMLElement).querySelector?.('[data-s]:last-of-type') as HTMLElement | null));
  return sp ? +sp.dataset.s! + (sp.textContent?.length ?? 0) : null;
}

function Emphasis({ text, terms }: { text: string; terms: string[] }) {
  const alts = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  const re = new RegExp(`(\\b\\d[\\d.,]*\\s?(?:%|percent|years?)?|${alts.length ? alts.join('|') : '(?!)'})`, 'giu');
  const parts = text.split(re);
  return <>{parts.map((p, i) => i % 2 ? <mark key={i} className="em">{p}</mark> : <Fragment key={i}>{p}</Fragment>)}</>;
}

/* ---------- reader ---------- */
export function Reader({ doc, text, at }: { doc: DocMeta; text: string; at?: number }) {
  const nav = useNavigate();
  const { annotations, terms, quotes, add, update, remove, refs } = useStore();
  const full = useTexts(s => s.map);
  const [showTerms, setShowTerms] = useState(true), [showFacts, setShowFacts] = useState(false);
  const [panel, setPanel] = useUrlState<'notes' | 'summary' | 'glossary' | 'quotes' | 'dates'>('panel', 'notes', ['notes', 'summary', 'glossary', 'quotes', 'dates']);
  const [tool, setTool] = useState<{ x: number; y: number; s: number; e: number } | null>(null);
  const [flash, setFlash] = useState<number | null>(at ?? null);
  const [kindF, setKindF] = useState('all'), [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const provider = useActiveProvider();
  const [aiSum, setAiSum] = useState<{ text: string; busy: boolean; prog: string }>({ text: '', busy: false, prog: '' });
  const [aiBusy, setAiBusy] = useState('');

  const paras = useMemo(() => paragraphs(text), [text]);
  const anns = useMemo(() => annotations.filter(a => a.docId === doc.id).sort((a, b) => a.start - b.start), [annotations, doc.id]);
  const confirmed = useMemo(() => terms.filter(t => t.status === 'confirmed'), [terms]);
  const termMarks = useMemo(() => {
    const out: Mark[] = [];
    for (const t of confirmed) for (const [s, e] of findOccurrences(text, [t.term, ...t.aliases])) out.push({ s, e, type: 'term', id: t.id });
    return out;
  }, [confirmed, text]);
  const summary: Summary | null = useMemo(() => (panel === 'summary' || showFacts) ? summarize(text, getCorpus()) : null, [panel, showFacts, text, full]);
  const marks = useMemo(() => {
    const m: Mark[] = anns.filter(a => a.start >= 0).map(a => ({ s: a.start, e: a.end, type: 'ann' as const, id: a.id, color: a.color, kind: a.kind }));
    if (showTerms) m.push(...termMarks);
    if (showFacts && summary) summary.highlight.forEach(([s, e], i) => m.push({ s, e, type: 'fact', id: 'f' + i }));
    return m;
  }, [anns, termMarks, showTerms, showFacts, summary]);

  const jump = (o: number) => {
    const els = [...(box.current?.querySelectorAll<HTMLElement>('[data-s]') ?? [])];
    let target: HTMLElement | undefined; for (const el of els) { if (+el.dataset.s! <= o) target = el; else break; }
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' }); setFlash(o); setTimeout(() => setFlash(null), 2200);
  };
  useEffect(() => { if (at != null) setTimeout(() => jump(at), 150); }, [at, text]);

  /* selection → floating toolbar */
  const onSelect = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !box.current?.contains(sel.anchorNode) || !box.current?.contains(sel.focusNode)) { setTool(null); return; }
    const r = sel.getRangeAt(0);
    let s = offsetOf(r.startContainer, r.startOffset), e = offsetOf(r.endContainer, r.endOffset);
    if (s == null || e == null) { setTool(null); return; }
    if (e < s) [s, e] = [e, s];
    while (s < e && /\s/.test(text[s])) s++; while (e > s && /\s/.test(text[e - 1])) e--;
    if (e - s < 2) { setTool(null); return; }
    const rc = r.getBoundingClientRect(); setTool({ x: rc.left + rc.width / 2, y: rc.top, s, e });
  };
  const clear = () => { window.getSelection()?.removeAllRanges(); setTool(null); };

  const createAnn = (kind: AnnKind, color: string, openNote = false, termId = '') => {
    if (!tool) return; const { s, e } = tool;
    const a = add('annotations', { docId: doc.id, start: s, end: e, quote: text.slice(s, e), kind, color, note: '', termId, tags: [], page: pageOf(text, s), created: Date.now() });
    clear(); if (openNote) openDialog(<AnnotationDialog id={a.id} />); return a;
  };
  const sentenceAround = (s: number) => { for (const p of paras) if (s >= p.start && s <= p.end) { const ss = sentences(p.text, p.start); return ss.find(x => s >= x.start && s <= x.end)?.text ?? ''; } return ''; };
  const addTerm = () => {
    if (!tool) return; const { s, e } = tool; const sel = text.slice(s, e).replace(/\s+/g, ' ');
    const ex = findTerm(terms, sel);
    const a = add('annotations', { docId: doc.id, start: s, end: e, quote: text.slice(s, e), kind: 'term', color: '#a78bfa', note: '', termId: ex?.id ?? '', tags: [], page: pageOf(text, s), created: Date.now() });
    clear();
    if (ex) { update('terms', ex.id, { status: 'confirmed' }); toast(`Linked to “${ex.term}”`); return; }
    const sent = sel.split(' ').length <= 6 ? sentenceAround(s) : '';
    openDialog(<TermDialog preset={{ term: sel.length > 60 ? sel.slice(0, 60) : sel, definition: sent, moduleId: doc.moduleId, sourceDocId: doc.id }} onSaved={id => update('annotations', a.id, { termId: id })} />);
  };
  const addQuote = () => {
    if (!tool) return; const { s, e } = tool; const a = createAnn('highlight', '#38bdf8', false);
    const ref = refs.find(r => r.docId === doc.id);
    add('quotes', { text: text.slice(s, e).replace(/\s+/g, ' '), docId: doc.id, refId: ref?.id ?? '', page: String(pageOf(text, s)), annotationId: a?.id ?? '', moduleId: doc.moduleId, projectId: ref?.projectId ?? '', chapterId: '', tags: [], comment: '', status: 'saved', auto: false, score: 1, start: s, created: Date.now() });
    toast('Saved to your quote list');
  };

  /* rendering */
  const renderPara = (p: (typeof paras)[number], i: number) => {
    const inP = marks.filter(m => m.e > p.start && m.s < p.end);
    const hm = p.heading ? p.text.match(/^#{1,6}\s+/) : null, hmEnd = hm ? p.start + hm[0].length : -1;
    const pts = new Set<number>([p.start, p.end]); if (hm) pts.add(hmEnd); inP.forEach(m => { pts.add(Math.max(m.s, p.start)); pts.add(Math.min(m.e, p.end)); });
    if (flash != null && flash >= p.start && flash < p.end) { pts.add(flash); }
    const sorted = [...pts].sort((a, b) => a - b); const spans: ReactNode[] = [];
    for (let k = 0; k < sorted.length - 1; k++) {
      const a = sorted[k], b = sorted[k + 1]; if (a === b) continue;
      const cov = inP.filter(m => m.s <= a && m.e >= b);
      const ann = cov.filter(m => m.type === 'ann'), term = cov.find(m => m.type === 'term'), fact = cov.some(m => m.type === 'fact');
      const last = ann[ann.length - 1];
      const cls = [hm && b <= hmEnd && 'hmark', last && 'mk-ann', last?.kind === 'important' && 'k-important', last?.kind === 'unclear' && 'k-unclear', last?.kind === 'research' && 'k-research', term && !last && 'mk-term', fact && 'mk-fact', flash != null && flash >= a && flash < b + 1 && flash >= p.start && flash <= b && 'mk-flash'].filter(Boolean).join(' ');
      spans.push(<span key={a} data-s={a} className={cls || undefined} style={last ? { background: (last.color ?? '#facc15') + '66' } : undefined}
        data-a={ann.map(x => x.id).join(',') || undefined} data-t={term?.id}
        title={term && !last ? terms.find(t => t.id === term.id)?.definition : ann.length ? 'Click to edit annotation' : undefined}>{text.slice(a, b)}</span>);
    }
    const pageMark = i === 0 || paras[i - 1].page !== p.page ? <div key={'pg' + i} className="pagemark">Page {p.page}</div> : null;
    return <Fragment key={p.start}>{PAGE_BREAK && doc.ext === 'pdf' && pageMark}
      {p.heading ? <h3 data-p={p.start} className="rd-h">{spans}</h3> : <p data-p={p.start} className="rd-p">{spans}</p>}</Fragment>;
  };
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-s]') as HTMLElement | null; if (!el || !window.getSelection()?.isCollapsed) return;
    if (el.dataset.a) openDialog(<AnnotationDialog id={el.dataset.a.split(',').pop()!} />);
    else if (el.dataset.t) nav('/glossary/' + el.dataset.t);
  };

  /* side panels */
  const shown = anns.filter(a => (kindF === 'all' || a.kind === kindF) && (!q || (a.quote + a.note + a.tags.join(' ')).toLowerCase().includes(q.toLowerCase())));
  const exportMd = () => download(`${doc.name}-annotations.md`, `# Annotations: ${doc.name}\n\n` + anns.map(a => `> ${a.quote.replace(/\n+/g, ' ')}\n\n*${KIND_LABEL[a.kind]}${doc.ext === 'pdf' ? ', p. ' + a.page : ''}*${a.note ? '\n\n' + a.note : ''}${a.tags.length ? '\n\n' + a.tags.map(t => '#' + t).join(' ') : ''}\n`).join('\n---\n\n'));
  const docSuggestedTerms = terms.filter(t => t.status === 'suggested' && t.sourceDocId === doc.id);
  const docConfirmed = confirmed.filter(t => termMarks.some(m => m.id === t.id));
  const docSuggestedQuotes = quotes.filter(q => q.docId === doc.id && q.status === 'suggested');
  const tasksAll = useStore(s => s.tasks), dateFmt = useStore(s => s.settings.dateFormat);
  const deadlines = useMemo(() => panel === 'dates' || true ? findDeadlines(text, tasksAll, dateFmt === 'MDY' ? 'MDY' : 'DMY') : [], [text, tasksAll, dateFmt, panel]);
  const keyWords = summary ? summary.keyTerms.slice(0, 14).map(t => t.surface) : [];

  const saveSummaryNote = () => {
    if (!summary) return;
    const body = `# Summary: ${doc.name}\n\n## Key points\n${summary.overall.map(s => `- ${s.text}${doc.ext === 'pdf' ? ` *(p. ${s.page})*` : ''}`).join('\n')}\n\n## Key facts\n${summary.facts.map(s => `- ${s.text}`).join('\n')}\n\n## By section\n` +
      summary.paras.map(p => `${p.para.section ? `**${p.para.section}** — ` : ''}${p.key.map(k => k.text).join(' ')}`).join('\n\n') + `\n\n*Auto-generated extract from [${doc.name}](#/documents/${doc.id}). Edit freely.*`;
    const n = add('notes', newNote({ title: `Summary: ${doc.name}`, body, moduleId: doc.moduleId, tags: ['summary'] }));
    toast('Summary saved as note'); nav('/notes/' + n.id);
  };

  const runAiSummary = async () => {
    if (!(await aiGate(`Summarise “${doc.name}” with AI`, text.length))) return;
    setAiSum({ text: '', busy: true, prog: '' });
    try { const t = await aiSummarize(doc.name, text, (d, n) => setAiSum(s => ({ ...s, prog: n > 1 ? `part ${Math.min(d + 1, n)} of ${n}` : '' }))); setAiSum({ text: t, busy: false, prog: '' }); }
    catch (e) { setAiSum({ text: '', busy: false, prog: '' }); toast((e as Error).message); }
  };
  const runAiQuotes = async () => {
    if (!(await aiGate(`Find quote-worthy passages in “${doc.name}” with AI`, text.length))) return;
    setAiBusy('quotes');
    try {
      const { found, rejected } = await aiQuotes(doc.name, text);
      const have = new Set(useStore.getState().quotes.filter(q => q.docId === doc.id).map(q => q.text.slice(0, 60)));
      const ref = refs.find(r => r.docId === doc.id); let n = 0;
      for (const f of found) { if (have.has(f.text.slice(0, 60))) continue; add('quotes', { text: f.text, docId: doc.id, refId: ref?.id ?? '', page: String(pageOf(text, f.start)), annotationId: '', moduleId: doc.moduleId, projectId: ref?.projectId ?? '', chapterId: '', tags: [], comment: f.why, status: 'suggested', auto: true, score: 0.9, start: f.start, created: Date.now() }); n++; }
      toast(`${n} AI suggestion(s) added${rejected ? `; ${rejected} dropped because they were not literally in the document` : ''}`);
    } catch (e) { toast((e as Error).message); }
    setAiBusy('');
  };

  return <div className="reader-wrap">
    <div>
      <div className="row small" style={{ marginBottom: 8 }}>
        <label><input type="checkbox" checked={showTerms} onChange={e => setShowTerms(e.target.checked)} /> Underline glossary terms</label>
        <label><input type="checkbox" checked={showFacts} onChange={e => setShowFacts(e.target.checked)} /> Highlight summary sentences</label>
        <span className="muted">Select text to annotate</span>
      </div>
      <div ref={box} className="reader card" onMouseUp={() => setTimeout(onSelect, 0)} onKeyUp={onSelect} onClick={onClick}>
        {paras.map(renderPara)}
        {!paras.length && <div className="empty">This document has no readable text.</div>}
      </div>
    </div>

    <aside className="reader-side">
      <div className="tabs" style={{ marginBottom: 10 }}>
        {([['notes', `Notes ${anns.length}`], ['summary', 'Summary'], ['glossary', `Terms ${docConfirmed.length + docSuggestedTerms.length}`], ['quotes', `Quotes ${docSuggestedQuotes.length}`], ['dates', `Dates ${deadlines.length}`]] as const).map(([k, l]) => <button key={k} className={panel === k ? 'on' : ''} onClick={() => setPanel(k)}>{l}</button>)}
      </div>

      {panel === 'notes' && <>
        <div className="row" style={{ marginBottom: 8 }}>
          <input type="search" placeholder="Search annotations…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1 }} />
          <select style={{ width: 110 }} value={kindF} onChange={e => setKindF(e.target.value)}><option value="all">All</option>{(Object.keys(KIND_LABEL) as AnnKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
        {shown.map(a => <div key={a.id} className="annitem" style={{ borderLeftColor: a.color }} onClick={() => a.start >= 0 && jump(a.start)}>
          <div className="small muted">{a.start < 0 && '⚠ detached (text changed) · '}{KIND_LABEL[a.kind]}{doc.ext === 'pdf' && ` · p. ${a.page}`}{a.termId && ' · 📖 ' + (terms.find(t => t.id === a.termId)?.term ?? '')}</div>
          <div>“{a.quote.length > 140 ? a.quote.slice(0, 140) + '…' : a.quote}”</div>
          {a.note && <div className="annnote">{a.note}</div>}
          <div className="row" style={{ gap: 4, marginTop: 4 }}>{a.tags.map(t => <span key={t} className="chip">#{t}</span>)}
            <button className="btn sm ghost" onClick={e => { e.stopPropagation(); openDialog(<AnnotationDialog id={a.id} />); }}>Edit</button></div>
        </div>)}
        {!shown.length && <div className="empty">{anns.length ? 'No matches.' : 'Select a passage in the text to highlight it, add a note, or mark it as a glossary term.'}</div>}
        {anns.length > 0 && <button className="btn sm" onClick={exportMd}>⬇ Export as Markdown</button>}
      </>}

      {panel === 'summary' && summary && <>
        {provider && <div style={{ marginBottom: 12 }}>
          <button className="btn sm primary" disabled={aiSum.busy} onClick={runAiSummary}>{aiSum.busy ? `Summarising… ${aiSum.prog}` : '✨ Summarise with AI'}</button>
          {aiSum.text && <div className="answer" style={{ marginTop: 8 }}>
            <div className="small muted">✨ AI-generated by {provider.name} — check against the source</div>
            <div className="md" dangerouslySetInnerHTML={{ __html: md(aiSum.text, []) }} />
            <button className="btn sm" onClick={() => { const n = add('notes', newNote({ title: `AI summary: ${doc.name}`, body: aiSum.text + `\n\n*AI-generated by ${provider.name} from [${doc.name}](#/documents/${doc.id}). Verify before relying on it.*`, moduleId: doc.moduleId, tags: ['summary', 'ai'] })); nav('/notes/' + n.id); }}>Save as note</button>
          </div>}
        </div>}
        <div className="sec-title" style={{ marginTop: 0 }}>Extractive summary · {summary.words.toLocaleString()} words, {summary.paragraphs.filter(p => !p.heading).length} paragraphs</div>
        <ul className="sumlist">{summary.overall.map(s => <li key={s.start} onClick={() => jump(s.start)}><Emphasis text={s.text} terms={keyWords} />{doc.ext === 'pdf' && <span className="muted small"> p. {s.page}</span>}</li>)}</ul>
        {summary.facts.length > 0 && <><div className="sec-title">Key facts</div>
          <ul className="sumlist">{summary.facts.map(s => <li key={s.start} onClick={() => jump(s.start)}><Emphasis text={s.text} terms={keyWords} /></li>)}</ul></>}
        <div className="sec-title">Paragraph by paragraph</div>
        {summary.paras.map(p => <div key={p.index} className="parasum" onClick={() => jump(p.para.start)}>
          <div className="small muted">{p.para.section || 'Paragraph'}{doc.ext === 'pdf' && ` · p. ${p.para.page}`}</div>
          <div><Emphasis text={p.key.map(k => k.text).join(' ')} terms={keyWords} /></div>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>{p.terms.map(t => <span key={t} className="chip">{t}</span>)}</div></div>)}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm primary" onClick={saveSummaryNote}>Save as note</button>
          <button className="btn sm" onClick={() => { setShowFacts(true); }}>Highlight in text</button></div>
        <p className="small muted">Extracted automatically from the document’s own sentences (nothing is generated or reworded). Check important points against the source.</p>
      </>}

      {panel === 'glossary' && <>
        <div className="row" style={{ marginBottom: 8 }}><button className="btn sm" onClick={() => toast(`${suggestTerms(doc, text)} new suggestions`)}>🔎 Find terms</button><Link className="btn sm" to="/glossary">Open glossary</Link></div>
        {docSuggestedTerms.length > 0 && <div className="sec-title" style={{ marginTop: 0 }}>Suggested</div>}
        {docSuggestedTerms.map(t => <TermSuggestion key={t.id} t={t} onJump={() => { const m = findOccurrences(text, [t.term, ...t.aliases])[0]; if (m) jump(m[0]); }} />)}
        <div className="sec-title">In this document</div>
        {docConfirmed.map(t => <div key={t.id} className="annitem" style={{ borderLeftColor: '#a78bfa' }}>
          <Link to={'/glossary/' + t.id}><b>{t.term}</b></Link> <span className="muted small">× {termMarks.filter(m => m.id === t.id).length}</span>
          <div className="small muted">{t.definition.slice(0, 120)}</div></div>)}
        {!docConfirmed.length && <div className="empty">No confirmed glossary terms appear here yet.</div>}
      </>}

      {panel === 'dates' && <>
        <p className="small muted" style={{ marginTop: 0 }}>Deadlines and exam dates found in this document. Each one shows the sentence it came from.</p>
        {deadlines.map(dl => <div key={dl.start + dl.due} className="annitem" style={{ borderLeftColor: dl.exam ? '#ef4444' : '#f59e0b' }}>
          <div className="small muted">{dl.exam ? '🎓 Exam' : '📌 Deadline'} · <b>{dl.due}</b>{doc.ext === 'pdf' && ` · p. ${dl.page}`}</div>
          <div style={{ cursor: 'pointer' }} onClick={() => jump(dl.start)}>{dl.sentence}</div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn sm primary" onClick={() => { add('tasks', newTask({ title: dl.title, due: dl.due, moduleId: doc.moduleId, type: dl.type, docIds: [doc.id], desc: `From “${doc.name}”${doc.ext === 'pdf' ? `, p. ${dl.page}` : ''}:\n${dl.sentence}` })); toast('Task created'); }}>＋ Create task</button>
            {dl.exam && <button className="btn sm" onClick={() => { add('events', { title: dl.title, type: 'exam', moduleId: doc.moduleId, date: dl.due, start: '', end: '', location: '', desc: dl.sentence, repeat: 'none', until: '', exceptions: [], reminder: 1440 }); toast('Exam added to calendar'); }}>＋ Calendar</button>}</div></div>)}
        {!deadlines.length && <div className="empty">No upcoming dates found. (Past dates and dates you already have as tasks are skipped.)</div>}
      </>}

      {panel === 'quotes' && <>
        <div className="row" style={{ marginBottom: 8 }}><button className="btn sm" onClick={() => toast(`${suggestQuotes(doc, text)} quote suggestions added`)}>✨ Find quotable passages</button>{provider && <button className="btn sm" disabled={!!aiBusy} onClick={runAiQuotes}>{aiBusy ? 'Asking AI…' : '🤖 Ask AI'}</button>}<Link className="btn sm" to="/quotes">Quote list</Link></div>
        {docSuggestedQuotes.map(q => <div key={q.id} className="annitem" style={{ borderLeftColor: '#38bdf8' }}>
          <div onClick={() => jump(q.start)} style={{ cursor: 'pointer' }}>“{q.text}”</div>
          <div className="small muted">p. {q.page} · relevance {Math.round(q.score * 100)}%</div>
          <div className="row" style={{ marginTop: 4 }}><button className="btn sm primary" onClick={() => update('quotes', q.id, { status: 'saved' })}>Save</button><button className="btn sm" onClick={() => remove('quotes', q.id)}>Dismiss</button></div></div>)}
        {!docSuggestedQuotes.length && <div className="empty">No pending suggestions. Select text and choose ❝ to save your own quotes.</div>}
        <div className="sec-title">Saved from this document</div>
        {quotes.filter(q => q.docId === doc.id && q.status === 'saved').map(q => <div key={q.id} className="annitem" style={{ borderLeftColor: '#38bdf8' }} onClick={() => jump(q.start)}>“{q.text.slice(0, 160)}”</div>)}
      </>}
    </aside>

    {tool && <div className="seltool" style={{ left: tool.x, top: tool.y }} onMouseDown={e => e.preventDefault()}>
      {COLORS.map(c => <button key={c} className="sw" style={{ background: c }} title="Highlight" onClick={() => createAnn('highlight', c)} />)}
      <span className="sep" />
      <button title="Add note" onClick={() => createAnn('note', '#facc15', true)}>📝</button>
      <button title="Add to glossary" onClick={addTerm}>📖</button>
      <button title="Save as quote" onClick={addQuote}>❝</button>
      <button title="Important" onClick={() => createAnn('important', '#f87171')}>★</button>
      <button title="Unclear" onClick={() => createAnn('unclear', '#fb923c')}>?</button>
      <button title="Research further" onClick={() => createAnn('research', '#60a5fa')}>🔍</button>
    </div>}
  </div>;
}

function TermSuggestion({ t, onJump }: { t: Term; onJump: () => void }) {
  const { update, remove } = useStore();
  return <div className="annitem" style={{ borderLeftColor: '#a78bfa' }}>
    <b style={{ cursor: 'pointer' }} onClick={onJump}>{t.term}</b>
    {t.definition && <div className="small muted">{t.definition.length > 140 ? t.definition.slice(0, 140) + '…' : t.definition}</div>}
    <div className="row" style={{ marginTop: 4 }}>
      <button className="btn sm primary" onClick={() => update('terms', t.id, { status: 'confirmed' })}>Add</button>
      <button className="btn sm" onClick={() => openDialog(<TermDialog id={t.id} />)}>Edit</button>
      <button className="btn sm" onClick={() => remove('terms', t.id)}>Reject</button></div></div>;
}
export { TermSuggestion };
