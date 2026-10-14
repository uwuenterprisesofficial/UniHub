import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import type { Quote, Ref } from '../lib/types';
import { blankRef, formatQuote } from '../lib/bib';
import { analyzeDoc, ensureText, suggestQuotes } from '../lib/analysis';
import { download, parseTags } from '../lib/util';
import { Card, Empty, Field, Modal, ModChip, ModuleSelect, confirmBox, openDialog, toast } from '../components/ui';
import { useUrlState } from '../lib/nav';

type Style = 'APA' | 'IEEE' | 'Chicago';

export function useQuoteFormatter(defaultStyle: Style) {
  const { refs, projects } = useStore();
  return (q: Quote, style?: Style) => {
    const proj = projects.find(p => p.id === q.projectId);
    const st = style ?? proj?.style ?? defaultStyle;
    const ref = refs.find(r => r.id === q.refId);
    const n = ref ? refs.filter(r => r.projectId === ref.projectId).findIndex(r => r.id === ref.id) + 1 : 1;
    return { st, ref, ...formatQuote(q.text, ref, st, q.page, n) };
  };
}

function QuoteDialog({ id }: { id?: string }) {
  const { quotes, refs, projects, docs, add, update, remove } = useStore();
  const ex = quotes.find(q => q.id === id);
  const [d, setD] = useState<Omit<Quote, 'id'>>(ex ?? { text: '', docId: '', refId: '', page: '', annotationId: '', moduleId: '', projectId: '', chapterId: '', tags: [], comment: '', status: 'saved', auto: false, score: 1, start: 0, created: Date.now() });
  const [tags, setTags] = useState(ex?.tags.join(', ') ?? '');
  const proj = projects.find(p => p.id === d.projectId);
  const projRefs = refs.filter(r => !d.projectId || r.projectId === d.projectId);
  return <Modal title={id ? 'Edit quote' : 'New quote'} wide buttons={[
    ...(id ? [{ label: 'Delete', cls: 'danger left', keepOpen: true, onClick: () => confirmBox('Delete this quote?', () => remove('quotes', id)) }] : []),
    { label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: () => { if (!d.text.trim()) { toast('Quote text is required'); return false; } const v = { ...d, text: d.text.trim(), tags: parseTags(tags), status: 'saved' as const }; id ? update('quotes', id, v) : add('quotes', v); } }]}>
    <Field label="Quote (exactly as in the source)"><textarea value={d.text} onChange={e => setD({ ...d, text: e.target.value })} style={{ minHeight: 110 }} autoFocus /></Field>
    <div className="grid3">
      <Field label="Thesis / project"><select value={d.projectId} onChange={e => setD({ ...d, projectId: e.target.value, refId: '', chapterId: '' })}><option value="">—</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
      <Field label="Source (bibliography)"><select value={d.refId} onChange={e => { const r = refs.find(x => x.id === e.target.value); setD({ ...d, refId: e.target.value, projectId: d.projectId || r?.projectId || '', docId: d.docId || r?.docId || '' }); }}><option value="">— none —</option>{projRefs.map(r => <option key={r.id} value={r.id}>{(r.authors.split(/ and |;/)[0] || 'Unknown') + ' ' + r.year + ' – ' + r.title.slice(0, 40)}</option>)}</select></Field>
      <Field label="Page(s)"><input type="text" value={d.page} onChange={e => setD({ ...d, page: e.target.value })} placeholder="e.g. 42 or 42–43" /></Field>
    </div>
    <div className="grid3">
      <Field label="Chapter"><select value={d.chapterId} onChange={e => setD({ ...d, chapterId: e.target.value })}><option value="">—</option>{proj?.chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
      <Field label="Document"><select value={d.docId} onChange={e => setD({ ...d, docId: e.target.value })}><option value="">—</option>{docs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Module"><ModuleSelect value={d.moduleId} onChange={v => setD({ ...d, moduleId: v })} /></Field>
    </div>
    <Field label="Tags (comma separated)"><input type="text" value={tags} onChange={e => setTags(e.target.value)} /></Field>
    <Field label="Why is this quote useful? (your comment)"><textarea value={d.comment} onChange={e => setD({ ...d, comment: e.target.value })} /></Field>
  </Modal>;
}

const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast('Copied'));

function createSourceFromDoc(q: Quote) {
  const st = useStore.getState(); const doc = st.docs.find(d => d.id === q.docId);
  if (!doc) return toast('This quote has no linked document');
  const projectId = q.projectId || st.projects[0]?.id; if (!projectId) return toast('Create a thesis project first (Thesis page) to hold your bibliography');
  const base = blankRef();
  const ref = st.add('refs', { ...base, projectId, title: doc.name.replace(/\.[a-z0-9]+$/i, ''), docId: doc.id, status: 'reading' } as Omit<Ref, 'id'>);
  st.update('quotes', q.id, { refId: ref.id, projectId });
  toast('Source created from the document — open it in Thesis → Literature to add author, year and title');
}

export default function Quotes() {
  const { quotes, docs, projects, modules, update, remove } = useStore();
  const [tab, setTab] = useUrlState<'saved' | 'suggested'>('tab', 'saved', ['saved', 'suggested']);
  const [q, setQ] = useState(''), [mf, setMf] = useState(''), [pf, setPf] = useState(''), [style, setStyle] = useState<Style>('APA'), [busy, setBusy] = useState(false);
  const fmt = useQuoteFormatter(style);
  const list = quotes.filter(x => x.status === tab && (!mf || x.moduleId === mf) && (!pf || x.projectId === pf) && (!q || (x.text + x.comment + x.tags.join(' ')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => tab === 'suggested' ? b.score - a.score : b.created - a.created);
  const nSug = quotes.filter(x => x.status === 'suggested').length;

  const scan = async () => {
    setBusy(true); let n = 0;
    for (const d of docs) { const t = await ensureText(d); if (t) n += suggestQuotes(d, t, 6); }
    setBusy(false); toast(n ? `${n} quotable passages found` : 'No new passages found'); if (n) setTab('suggested');
  };
  const exportMd = () => download('quotes.md', `# Quotes\n\n` + list.map(x => { const f = fmt(x); return `${f.block}\n\n${f.reference ? '*' + f.reference + '*\n\n' : ''}${x.comment ? 'Note: ' + x.comment + '\n\n' : ''}`; }).join('---\n\n'));

  return <>
    <div className="page-head"><h1>Quotes</h1>
      <button className="btn" onClick={scan} disabled={busy}>{busy ? 'Scanning…' : '✨ Find quotable passages'}</button>
      <button className="btn primary" onClick={() => openDialog(<QuoteDialog />)}>＋ Quote</button></div>
    <div className="row" style={{ marginBottom: 12 }}>
      <input type="search" placeholder="Search quotes…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} />
      <div style={{ width: 200 }}><ModuleSelect value={mf} onChange={setMf} none="All modules" /></div>
      <select style={{ width: 180 }} value={pf} onChange={e => setPf(e.target.value)}><option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <label className="small muted">Default style <select style={{ width: 110, display: 'inline-block' }} value={style} onChange={e => setStyle(e.target.value as Style)}><option>APA</option><option>IEEE</option><option>Chicago</option></select></label>
      <div className="seg"><button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved ({quotes.length - nSug})</button><button className={tab === 'suggested' ? 'on' : ''} onClick={() => setTab('suggested')}>Suggested ({nSug})</button></div>
      {tab === 'saved' && list.length > 0 && <button className="btn sm" onClick={exportMd}>⬇ Export Markdown</button>}
    </div>
    {!list.length && <Card><Empty>{tab === 'saved' ? 'No saved quotes. Select text in a document and press ❝, or review the suggestions.' : 'No suggestions. Suggestions are created when you import documents, or use “Find quotable passages”.'}</Empty></Card>}
    {list.map(x => { const f = fmt(x); const doc = docs.find(d => d.id === x.docId); return <div key={x.id} className="card qcard" style={{ marginBottom: 12 }}>
      <div className="qtext">“{x.text}”</div>
      <div className="row small muted" style={{ marginTop: 6 }}>
        {doc ? <Link to={`/documents/${doc.id}?at=${x.start}`}>📄 {doc.name}{x.page && ` · p. ${x.page}`}</Link> : <span>No document</span>}
        <ModChip id={x.moduleId} />{x.tags.map(t => <span key={t} className="chip">#{t}</span>)}
        {x.auto && <span className="chip" title="Found automatically by relevance analysis">auto · {Math.round(x.score * 100)}%</span>}
        {x.projectId && <span className="chip">🎓 {projects.find(p => p.id === x.projectId)?.title}</span>}</div>
      {x.comment && <div className="annnote">{x.comment}</div>}
      {x.status === 'saved' && <>
        {f.ref ? <div className="cite"><b>{f.st}</b> · {f.inline}{'\n\n'}<span className="muted">{f.reference}</span></div>
          : <div className="cite soon">⚠ No source linked, so no citation can be formatted. {x.docId ? <a href="#/quotes" onClick={e => { e.preventDefault(); createSourceFromDoc(x); }}>Create source from this document</a> : 'Edit the quote to choose a source.'}</div>}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm primary" onClick={() => copy(f.inline)}>Copy quote + citation</button>
          {f.ref && <><button className="btn sm" onClick={() => copy(f.block)}>Copy as block (Markdown)</button><button className="btn sm" onClick={() => copy(f.reference)}>Copy reference</button>{f.st === 'Chicago' && <button className="btn sm" onClick={() => copy(f.footnote)}>Copy footnote</button>}</>}
          <button className="btn sm" onClick={() => openDialog(<QuoteDialog id={x.id} />)}>Edit</button></div></>}
      {x.status === 'suggested' && <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm primary" onClick={() => update('quotes', x.id, { status: 'saved' })}>Save to my list</button>
        <button className="btn sm" onClick={() => openDialog(<QuoteDialog id={x.id} />)}>Edit & save</button>
        <button className="btn sm" onClick={() => remove('quotes', x.id)}>Dismiss</button></div>}
    </div>; })}

  </>;
}
