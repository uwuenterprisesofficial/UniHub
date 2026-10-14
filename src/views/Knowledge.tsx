import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getData, newNote, useStore } from '../lib/store';
import { KIND_ICON, KIND_LABEL, scopeFilter, scopeKey, type ChunkKind, type Scope } from '../lib/kb';
import { useIndex, useVectorSync } from '../lib/useIndex';
import { retrieve, ragAnswer, type RagAnswer, type Retrieval, type Via } from '../lib/rag';
import { useActiveProvider, type Msg } from '../lib/ai';
import { md } from '../lib/markdown';
import { Card, Empty } from '../components/ui';
import { ScopePicker, scopeLabel } from '../components/ScopePicker';
import { Marked } from '../components/Marked';
import { aiGate } from '../components/AI';
import { SemanticStatus } from '../components/Semantic';
import { useUrlParams, useUrlState } from '../lib/nav';

const KINDS = Object.keys(KIND_LABEL) as ChunkKind[];
const EXAMPLES = ['What is a priority queue?', '"binary heap" runtime', 'Why does Dijkstra need non-negative weights?', 'open questions thesis'];
const VIA: Record<Via, { label: string; tip: string }> = {
  both: { label: 'keyword + meaning', tip: 'Found by both word match and semantic similarity' }, keyword: { label: 'keyword', tip: 'Matched your words' },
  semantic: { label: 'meaning', tip: 'Found by semantic similarity — may not contain your exact words' }, neighbor: { label: 'context', tip: 'The paragraph next to a best match' }, graph: { label: 'via graph', tip: 'Found through a concept connected to the best matches' },
};
interface ChatMsg { role: 'user' | 'assistant'; content: string; ans?: RagAnswer; error?: string }

/** `context` = the module / lecture the page this is embedded in is about; `embedded` hides the page title. */
export default function Knowledge({ context, embedded }: { context?: Scope; embedded?: boolean }) {
  const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const idx = useIndex(); useVectorSync(idx);
  const { terms, modules, add } = useStore(); const provider = useActiveProvider();
  const [mode, setMode] = useUrlState<'search' | 'chat'>('mode', 'search', ['search', 'chat']); const setUrl = useUrlParams();
  const [q, setQ] = useState(sp.get('q') ?? ''); const [submitted, setSubmitted] = useState(sp.get('q') ?? '');
  const [kinds, setKinds] = useState<Set<ChunkKind>>(new Set());
  // question, mode and scope live in the address, so coming back from a result lands on the same search
  const [scope, setScope] = useState<Scope>(() => {
    if (!context) return { moduleId: sp.get('module') || undefined, sessionId: sp.get('session') || undefined };
    const sc = sp.get('sc'), sl = sp.get('sl');
    return sc === 'all' ? {} : sc === 'module' ? { moduleId: context.moduleId } : sl ? { moduleId: context.moduleId, sessionId: sl } : context;
  });
  const [ret, setRet] = useState<Retrieval | null>(null); const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]); const [busy, setBusy] = useState(false); const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const v = sp.get('q'); if (v != null && v !== submitted) { setQ(v); setSubmitted(v); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sp]);
  useEffect(() => {
    if (!submitted.trim()) { setRet(null); return; }
    let live = true; setLoading(true);
    retrieve(idx, getData(), submitted, { scope, kinds: kinds.size ? kinds : undefined })
      .then(r => { if (live) { setRet(r); setLoading(false); } }).catch(() => live && setLoading(false));
    return () => { live = false; };
  }, [idx, submitted, kinds, scopeKey(scope)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat, busy]);

  const submit = (v = q) => { setSubmitted(v); setUrl({ q: v || undefined }); };
  const changeScope = (sc: Scope) => {
    setScope(sc);
    if (!embedded) { setUrl({ module: sc.moduleId, session: sc.sessionId }); return; }
    if (!sc.moduleId) setUrl({ sc: 'all', sl: undefined });
    else if (sc.sessionId) setUrl({ sc: undefined, sl: sc.sessionId === context?.sessionId ? undefined : sc.sessionId });
    else setUrl({ sc: context?.sessionId ? 'module' : undefined, sl: undefined });
  };
  const inScope = useMemo(() => { const f = scopeFilter(getData(), scope); return idx.chunks.filter(c => !f || f(c)); }, [idx, scopeKey(scope)]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => { const m = new Map<ChunkKind, number>(); inScope.forEach(c => m.set(c.kind, (m.get(c.kind) ?? 0) + 1)); return m; }, [inScope]);
  const lex = ret?.lexical;
  const termObjs = lex ? lex.termIds.map(id => terms.find(t => t.id === id)!).filter(Boolean) : [];
  const alsoTerms = useMemo(() => {
    if (!ret || !lex) return [] as typeof terms;
    const n = new Map<string, number>(); ret.fused.slice(0, 15).forEach(h => h.chunk.terms.forEach(t => n.set(t, (n.get(t) ?? 0) + 1)));
    const related = lex.termIds.flatMap(id => idx.related(id).slice(0, 5).map(r => r.id));
    related.forEach(id => n.set(id, (n.get(id) ?? 0) + 2));
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => terms.find(t => t.id === id)!).filter(Boolean);
  }, [ret, lex, terms, idx]);

  /* ---------- chat ---------- */
  const send = async (text: string) => {
    const question = text.trim(); if (!question || busy) return;
    if (!(await aiGate(`Ask “${question.slice(0, 80)}” using your material`, 9000))) return;
    const history: Msg[] = chat.slice(-8).map(m => ({ role: m.role, content: m.content }));
    setChat(c => [...c, { role: 'user', content: question }]); setDraft(''); setBusy(true);
    try {
      const ans = await ragAnswer(idx, getData(), question, history, { scope, kinds: kinds.size ? kinds : undefined });
      setChat(c => [...c, { role: 'assistant', content: ans.text, ans }]);
    } catch (e) { setChat(c => [...c, { role: 'assistant', content: '', error: (e as Error).message }]); }
    setBusy(false);
  };
  const rendered = (m: ChatMsg) => {
    const html = md(m.content, []).replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (all, g: string) => {
      const nums = g.split(/[,;]/).map(x => +x.trim()); if (!m.ans) return all;
      return nums.map(n => { const s = m.ans!.sources.find(x => x.n === n); return s ? `<a class="chip" href="#${s.chunk.to}" title="${s.chunk.title.replace(/"/g, '&quot;')}">${n}</a>` : `<span class="chip overdue" title="No such source">${n}?</span>`; }).join('');
    });
    return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
  };
  const saveChat = () => {
    const body = chat.filter(m => m.content).map(m => m.role === 'user' ? `## ${m.content}\n` : `${m.content}\n\n*Sources:* ${m.ans?.sources.filter(s => m.ans!.cited.includes(s.n)).map(s => `[${s.n}] ${s.chunk.title}`).join('; ') || '—'}\n`).join('\n');
    const n = add('notes', newNote({ title: `Q&A: ${chat.find(m => m.role === 'user')?.content.slice(0, 50) ?? 'Knowledge chat'}`, body: body + '\n*AI-generated from your material; verify against the sources.*', moduleId: scope.moduleId ?? '', tags: ['ai', 'qa'] }));
    nav('/notes/' + n.id);
  };

  return <>
    {!embedded && <div className="page-head"><div><h1>Knowledge base</h1><div className="muted">Search and ask across documents, notes, annotations, quotes, glossary, thesis and tasks — {idx.chunks.length.toLocaleString()} passages.</div></div>
      <Link className="btn" to="/graph">🕸 Knowledge graph</Link></div>}
    <div className="row" style={{ marginBottom: 10 }}>
      <div className="seg"><button className={mode === 'search' ? 'on' : ''} onClick={() => setMode('search')}>🔎 Search</button><button className={mode === 'chat' ? 'on' : ''} onClick={() => setMode('chat')}>💬 Ask (chat)</button></div>
      <SemanticStatus />
    </div>
    {(scope.moduleId || scope.sessionId) && <div className="small muted" style={{ margin: '-4px 0 10px' }}>Looking only at <b>{scopeLabel(scope, getData())}</b> — {inScope.length.toLocaleString()} passages. The glossary is always included.</div>}
    <div className="row" style={{ marginBottom: 16, gap: 6 }}>
      <ScopePicker scope={scope} onChange={changeScope} context={context} />
      {KINDS.filter(k => counts.get(k)).map(k => <button key={k} className={'btn sm' + (kinds.has(k) ? ' primary' : '')} onClick={() => { const n = new Set(kinds); n.has(k) ? n.delete(k) : n.add(k); setKinds(n); }}>{KIND_ICON[k]} {KIND_LABEL[k]} <span className="muted">{counts.get(k)}</span></button>)}
    </div>

    {mode === 'search' && <>
      <form className="row" onSubmit={e => { e.preventDefault(); submit(); }} style={{ marginBottom: 12 }}>
        <input type="search" className="grow" style={{ fontSize: 16, padding: '11px 14px' }} placeholder="Ask a question or search a concept…  e.g. What is Dijkstra's algorithm?" value={q} onChange={e => setQ(e.target.value)} autoFocus={!embedded} />
        <button className="btn primary" style={{ padding: '11px 18px' }}>Search</button>
      </form>
      {!submitted.trim() && <div className="dash">
        <Card title="Try asking"><div className="list">{EXAMPLES.map(e => <div key={e} className="itm" onClick={() => { setQ(e); submit(e); }}><div className="grow t">{e}</div></div>)}</div></Card>
        <Card title="What the knowledge base connects">
          <div className="row" style={{ gap: 8 }}>{KINDS.filter(k => counts.get(k)).map(k => <span key={k} className="chip">{KIND_ICON[k]} {counts.get(k)} {KIND_LABEL[k].toLowerCase()}{counts.get(k)! > 1 ? 's' : ''}</span>)}</div>
          <p className="small muted">Keyword and semantic search are combined. Glossary terms link everything that mentions a concept, so related material is found even without your exact words. See how it all connects in the <Link to="/graph">knowledge graph</Link>.</p>
          {!idx.chunks.length && <Empty>Nothing indexed yet. Upload documents or write notes first.</Empty>}</Card>
      </div>}
      {loading && !ret && <Card><Empty>Searching…</Empty></Card>}
      {ret && lex && <div className="reader-wrap" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
        <div>
          {termObjs.map(t => <div key={t.id} className="answer" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderLeft: '4px solid #a78bfa' }}>
            <div className="small muted">📖 Glossary</div><Link to={'/glossary/' + t.id}><b style={{ fontSize: 16 }}>{t.term}</b></Link>{t.aliases.length > 0 && <span className="muted small"> · {t.aliases.join(', ')}</span>}
            <div>{t.definition || <span className="muted">No definition yet.</span>}</div></div>)}
          {provider && ret.fused.length > 0 && <div style={{ marginBottom: 12 }}><button className="btn primary" onClick={() => { setMode('chat'); void send(submitted); }}>✨ Answer with AI (RAG)</button> <span className="small muted">answers from the best passages and cites them</span></div>}
          {lex.answer.length > 0 && <div className="answer">
            <b>From your material</b> <span className="small muted">— sentences taken from the best-matching passages (not generated)</span>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{lex.answer.map((a, i) => <li key={i}>{a.text} <a className="chip" href={'#' + a.chunk.to} onClick={e => { e.preventDefault(); nav(a.chunk.to); }}>{KIND_ICON[a.chunk.kind]} {a.chunk.title.length > 40 ? a.chunk.title.slice(0, 40) + '…' : a.chunk.title}{a.chunk.page ? ` · p. ${a.chunk.page}` : ''}</a></li>)}</ul></div>}
          <Card title={`${ret.fused.length} matching passages`} extra={ret.semantic ? 'ranked by keywords + meaning' : 'ranked by keywords'}>
            {ret.fused.map(h => <div key={h.chunk.id} className="kb-hit" onClick={() => nav(h.chunk.to)}>
              <div className="row" style={{ gap: 8 }}><span>{KIND_ICON[h.chunk.kind]}</span><b className="kt">{h.chunk.title}</b>
                <span className="muted small">{KIND_LABEL[h.chunk.kind]}{h.chunk.page ? ` · p. ${h.chunk.page}` : ''}</span>
                {ret.semantic && <span className="chip" title={VIA[h.via].tip}>{VIA[h.via].label}</span>}
                {h.chunk.moduleId && <span className="chip dot" style={{ ['--c' as string]: modules.find(m => m.id === h.chunk.moduleId)?.color }}>{modules.find(m => m.id === h.chunk.moduleId)?.code || modules.find(m => m.id === h.chunk.moduleId)?.name}</span>}</div>
              <div className="small" style={{ marginTop: 4 }}><Marked text={h.snippet.text} marks={h.snippet.marks} /></div></div>)}
            {!ret.fused.length && <Empty>Nothing found. Try other words, remove filters, or enable semantic search in Settings to match by meaning.</Empty>}
          </Card>
        </div>
        <aside>
          <Card title="Connected concepts">
            {alsoTerms.length ? <div className="row" style={{ gap: 6 }}>{alsoTerms.map(t => <a key={t.id} className="chip" href={'#/knowledge?q=' + encodeURIComponent(t.term)} onClick={() => { setQ(t.term); submit(t.term); }}>{t.term}</a>)}</div>
              : <div className="small muted">Confirm glossary terms to see how concepts connect.</div>}
            {termObjs[0] && <p className="small"><Link to={'/graph?hop=1&focus=term:' + termObjs[0].id}>Show “{termObjs[0].term}” in the graph →</Link></p>}
          </Card>
          <div style={{ height: 16 }} />
          <Card title="Sources in result"><div className="list">{KINDS.map(k => { const n = ret.fused.filter(h => h.chunk.kind === k).length; return n ? <div key={k}><span>{KIND_ICON[k]}</span><span className="grow">{KIND_LABEL[k]}</span><span className="badge neutral">{n}</span></div> : null; })}</div></Card>
        </aside>
      </div>}
    </>}

    {mode === 'chat' && <>
      {!provider ? <Card><Empty>Chat needs an AI provider. <Link to="/settings">Add your own provider in Settings</Link> — it takes a minute. Meanwhile, the Search tab works without one.</Empty></Card> : <>
        <div className="chat">
          {!chat.length && <Card><Empty>Ask anything about your study material — answers cite their sources. Follow-up questions are understood in context.</Empty>
            <div className="row" style={{ justifyContent: 'center', gap: 6 }}>{EXAMPLES.slice(0, 3).map(e => <button key={e} className="btn sm" onClick={() => void send(e)}>{e}</button>)}</div></Card>}
          {chat.map((m, i) => m.role === 'user'
            ? <div key={i} className="bubble user">{m.content}</div>
            : <div key={i} className="bubble bot">
              {m.error ? <div className="overdue">⚠ {m.error}</div> : <>
                <div className="small muted">✨ AI answer · {provider.name}{m.ans?.semantic ? ' · hybrid retrieval' : ' · keyword retrieval'}</div>
                {rendered(m)}
                {m.ans && m.ans.cited.length === 0 && <div className="small soon">⚠ This answer cites no sources — treat it with care.</div>}
                {m.ans && m.ans.invalid.length > 0 && <div className="small soon">⚠ It referred to non-existent sources ({m.ans.invalid.join(', ')}).</div>}
                {m.ans && <details style={{ marginTop: 8 }}><summary className="small muted" style={{ cursor: 'pointer' }}>{m.ans.sources.length} passages retrieved · {m.ans.cited.length} cited{m.ans.standalone !== chat[i - 1]?.content ? ` · searched for “${m.ans.standalone}”` : ''}</summary>
                  {m.ans.sources.map(s => <div key={s.n} className="small" style={{ padding: '4px 0' }}>{m.ans!.cited.includes(s.n) ? '✓' : '·'} <b>[{s.n}]</b> <a href={'#' + s.chunk.to}>{KIND_ICON[s.chunk.kind]} {s.chunk.title}{s.chunk.page ? ` · p. ${s.chunk.page}` : ''}</a> <span className="chip" title={VIA[s.via].tip}>{VIA[s.via].label}</span></div>)}</details>}
              </>}
            </div>)}
          {busy && <div className="bubble bot muted">Searching your material and writing an answer…</div>}
          <div ref={endRef} />
        </div>
        <form className="row" style={{ marginTop: 12 }} onSubmit={e => { e.preventDefault(); void send(draft); }}>
          <input type="text" className="grow" style={{ padding: '11px 14px' }} value={draft} onChange={e => setDraft(e.target.value)} placeholder={chat.length ? 'Ask a follow-up…' : 'Ask a question about your material…'} disabled={busy} />
          <button className="btn primary" disabled={busy || !draft.trim()}>Send</button>
          {chat.length > 0 && <><button type="button" className="btn" onClick={saveChat}>Save as note</button><button type="button" className="btn" onClick={() => setChat([])}>New chat</button></>}
        </form>
        <p className="small muted">Answers are written by {provider.name} from the passages retrieved from your own material (your question and those passages are sent to it). Check the cited sources.</p>
      </>}
    </>}

  </>;
}
