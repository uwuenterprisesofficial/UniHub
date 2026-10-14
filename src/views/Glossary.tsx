import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { scanWorkspace } from '../lib/analysis';
import { KIND_ICON, KIND_LABEL, snippetFor, type ChunkKind } from '../lib/kb';
import { useIndex } from '../lib/useIndex';
import { Card, Empty, ModChip, ModuleSelect, openDialog, toast } from '../components/ui';
import { TermDialog } from '../components/TermDialog';
import { Marked } from '../components/Marked';
import { BackLink } from '../components/BackLink';
import { useUrlState } from '../lib/nav';

export function GlossaryList() {
  const nav = useNavigate();
  const { terms, docs, update, remove, modules } = useStore();
  const idx = useIndex();
  const [tab, setTab] = useUrlState<'confirmed' | 'suggested'>('tab', 'confirmed', ['confirmed', 'suggested']);
  const [q, setQ] = useState(''), [mf, setMf] = useState(''), [busy, setBusy] = useState(false);
  const list = terms.filter(t => t.status === tab && (!mf || t.moduleId === mf) && (!q || (t.term + ' ' + t.aliases.join(' ') + ' ' + t.definition).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }));
  const nSug = terms.filter(t => t.status === 'suggested').length;
  const groups = useMemo(() => { const m = new Map<string, typeof list>(); list.forEach(t => { const k = t.term[0]?.toUpperCase() ?? '#'; m.set(k, [...(m.get(k) ?? []), t]); }); return [...m]; }, [list]);
  const scan = async () => { setBusy(true); const n = await scanWorkspace(); setBusy(false); toast(n ? `Found ${n} new term suggestions` : 'No new terms found'); if (n) setTab('suggested'); };

  return <>
    <div className="page-head"><h1>Glossary</h1>
      <button className="btn" onClick={scan} disabled={busy}>{busy ? 'Scanning…' : '🔎 Scan documents & notes'}</button>
      <button className="btn primary" onClick={() => openDialog(<TermDialog onSaved={id => nav('/glossary/' + id)} />)}>＋ Term</button></div>
    <div className="row" style={{ marginBottom: 12 }}>
      <input type="search" placeholder="Search terms and definitions…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 280 }} />
      <div style={{ width: 220 }}><ModuleSelect value={mf} onChange={setMf} none="All modules" /></div>
      <div className="seg"><button className={tab === 'confirmed' ? 'on' : ''} onClick={() => setTab('confirmed')}>Glossary ({terms.length - nSug})</button>
        <button className={tab === 'suggested' ? 'on' : ''} onClick={() => setTab('suggested')}>Suggested ({nSug})</button></div>
      {tab === 'suggested' && list.length > 0 && <button className="btn sm" onClick={() => list.forEach(t => update('terms', t.id, { status: 'confirmed' }))}>Accept all shown</button>}
    </div>

    {tab === 'confirmed' ? (groups.length ? groups.map(([letter, items]) => <div key={letter}>
      <div className="sec-title">{letter}</div>
      <div className="card"><div className="list">{items.map(t => {
        const n = idx.termChunks.get(t.id)?.length ?? 0, nd = new Set((idx.termChunks.get(t.id) ?? []).map(i => idx.chunks[i].docId).filter(Boolean)).size;
        return <div key={t.id} className="itm" onClick={() => nav('/glossary/' + t.id)}>
          <div className="grow"><div className="t"><b>{t.term}</b>{t.aliases.length > 0 && <span className="muted small"> · {t.aliases.join(', ')}</span>}</div>
            <div className="small muted">{t.definition.length > 160 ? t.definition.slice(0, 160) + '…' : t.definition || 'No definition yet'}</div></div>
          <ModChip id={t.moduleId} /><span className="chip" title="Passages mentioning this term">{n} mentions{nd ? ` · ${nd} docs` : ''}</span></div>;
      })}</div></div></div>)
      : <Card><Empty>{terms.length ? 'No terms match.' : <>Your glossary is empty. Select a word while reading a document and press 📖, or <a href="#/glossary" onClick={e => { e.preventDefault(); scan(); }}>scan your documents and notes</a> for terms.</>}</Empty></Card>)
      : <Card>{list.length ? <div className="list">{list.map(t => <div key={t.id} style={{ alignItems: 'flex-start' }}>
        <div className="grow"><b>{t.term}</b>{t.aliases.length > 0 && <span className="muted small"> · {t.aliases.join(', ')}</span>}
          <div className="small muted">{t.definition || 'No definition found in the text'}</div>
          {t.sourceDocId && <Link className="small" to={'/documents/' + t.sourceDocId}>from {docs.find(d => d.id === t.sourceDocId)?.name ?? 'document'}</Link>}</div>
        <button className="btn sm primary" onClick={() => update('terms', t.id, { status: 'confirmed' })}>Add</button>
        <button className="btn sm" onClick={() => openDialog(<TermDialog id={t.id} />)}>Edit</button>
        <button className="btn sm" onClick={() => remove('terms', t.id)}>Reject</button></div>)}</div>
        : <Empty>No pending suggestions. Suggestions appear automatically when you import documents (and with “Scan”).</Empty>}</Card>}

  </>;
}

export function GlossaryDetail() {
  const { id = '' } = useParams(); const nav = useNavigate();
  const { terms, annotations, docs, quotes } = useStore();
  const idx = useIndex();
  const t = terms.find(x => x.id === id);
  if (!t) return <div className="card empty">Term not found. <Link to="/glossary">Back to glossary</Link></div>;
  const forms = [t.term, ...t.aliases];
  const chunks = (idx.termChunks.get(t.id) ?? []).map(i => idx.chunks[i]).filter(c => !(c.kind === 'term' && c.id === 'term:' + t.id));
  const byKind = new Map<ChunkKind, typeof chunks>(); chunks.forEach(c => byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]));
  const related = idx.related(t.id).slice(0, 12).map(r => ({ ...r, term: terms.find(x => x.id === r.id)! })).filter(r => r.term);
  const myAnns = annotations.filter(a => a.termId === t.id);
  const myQuotes = quotes.filter(q => q.status === 'saved' && forms.some(f => q.text.toLowerCase().includes(f.toLowerCase())));
  return <>
    <div className="page-head"><div><BackLink fallback="/glossary" label="Glossary" /><h1>📖 {t.term}</h1>
      <div className="muted small">{t.aliases.length > 0 && <>Also: {t.aliases.join(', ')} · </>}{t.status === 'suggested' ? 'Suggested term' : 'Confirmed'}{t.auto && ' · auto-detected'}</div></div>
      <ModChip id={t.moduleId} />
      <Link className="btn" to={'/knowledge?q=' + encodeURIComponent(t.term)}>🔎 Ask knowledge base</Link>
      <button className="btn" onClick={() => openDialog(<TermDialog id={t.id} />)}>✎ Edit</button></div>
    <div className="dash">
      <Card title="Definition" wide>
        <p style={{ fontSize: 15, margin: 0, whiteSpace: 'pre-wrap' }}>{t.definition || <span className="muted">No definition yet — edit this term to add your own explanation.</span>}</p>
        {t.sourceDocId && <p className="small muted">Source: <Link to={'/documents/' + t.sourceDocId}>{docs.find(d => d.id === t.sourceDocId)?.name}</Link></p>}
      </Card>
      <Card title="Connected terms">
        {related.length ? <div className="row" style={{ gap: 6 }}>{related.map(r => <Link key={r.id} className="chip" to={'/glossary/' + r.id} title={`Appear together in ${Math.round(r.weight * 100)}% of the relevant passages`}>{r.term.term}<span className="muted"> {Math.round(r.weight * 100)}</span></Link>)}</div>
          : <Empty>No connections yet. Terms are connected when they are mentioned in the same passage.</Empty>}
      </Card>
      <Card title={`Annotations (${myAnns.length})`}>
        {myAnns.map(a => <div key={a.id} className="annitem" style={{ borderLeftColor: a.color }} onClick={() => nav(`/documents/${a.docId}?at=${a.start}`)}>
          <div className="small muted">{docs.find(d => d.id === a.docId)?.name}</div><div>“{a.quote.slice(0, 160)}”</div>{a.note && <div className="annnote">{a.note}</div>}</div>)}
        {!myAnns.length && <Empty>Mark passages in the reader as this term to collect your notes here.</Empty>}
      </Card>
      {myQuotes.length > 0 && <Card title={`Quotes (${myQuotes.length})`}>{myQuotes.slice(0, 4).map(q => <div key={q.id} className="annitem" style={{ borderLeftColor: '#38bdf8' }}>“{q.text}”</div>)}</Card>}
      <Card title={`Where it appears (${chunks.length})`} wide>
        {[...byKind].map(([kind, items]) => <div key={kind}>
          <div className="sec-title">{KIND_ICON[kind]} {KIND_LABEL[kind]}s · {items.length}</div>
          {items.slice(0, 8).map(c => { const sn = snippetFor(c.text, forms); return <div key={c.id} className="kb-hit" onClick={() => nav(c.to)}>
            <div className="kt"><b>{c.title}</b>{c.page ? <span className="muted small"> · p. {c.page}</span> : null}</div><div className="small"><Marked text={sn.text} marks={sn.marks} /></div></div>; })}
        </div>)}
        {!chunks.length && <Empty>This term has not been found in your documents, notes or other material yet.</Empty>}
      </Card>
    </div>
  </>;
}
