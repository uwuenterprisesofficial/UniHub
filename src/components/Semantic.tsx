import { LOCAL_MODELS, clearVectors, syncVectors, useEmbedCfg, useVecStatus, type LocalModel } from '../lib/embed';
import { useAI } from '../lib/ai';
import { useIndex } from '../lib/useIndex';
import { Card, Field, confirmBox, toast } from './ui';

/** Compact status line used on the knowledge page. */
export function SemanticStatus() {
  const enabled = useEmbedCfg(s => s.enabled); const st = useVecStatus();
  if (!enabled) return <div className="small muted">Semantic search is off — results use keywords only. <a href="#/settings">Turn it on in Settings</a> to also find passages by meaning.</div>;
  const text = st.state === 'indexing' || st.state === 'loading' ? (st.msg || 'Indexing…') : st.state === 'error' ? '⚠ ' + st.msg : st.state === 'ready' ? `${st.count.toLocaleString()} passages indexed` : 'Waiting to index…';
  return <div className="small muted">🧭 Semantic search: {text}{(st.state === 'indexing') && st.total > 0 && <span className="bar" style={{ display: 'inline-block', width: 80, marginLeft: 8, verticalAlign: 'middle' }}><i style={{ width: Math.round(st.done / st.total * 100) + '%' }} /></span>}</div>;
}

export function SemanticCard() {
  const cfg = useEmbedCfg(); const st = useVecStatus(); const providers = useAI(s => s.providers).filter(p => p.kind !== 'anthropic'); const idx = useIndex();
  const set = useEmbedCfg.setState;
  return <Card title="🧭 Semantic search (vector index)">
    <p className="small muted">Finds passages by meaning, not just matching words, and powers better answers and similar-document links in the graph. Vectors are stored on this device only and are rebuilt per device.</p>
    <label style={{ display: 'block', marginBottom: 8 }}><input type="checkbox" checked={cfg.enabled} onChange={e => { set({ enabled: e.target.checked }); if (e.target.checked) void syncVectors(idx.chunks); }} /> Enable semantic search</label>
    {cfg.enabled && <>
      <Field label="Where embeddings are computed"><select value={cfg.backend} onChange={e => { set({ backend: e.target.value as 'local' | 'provider' }); }}>
        <option value="local">On this device (private; one-time model download)</option><option value="provider">With my AI provider (OpenAI, Gemini or compatible)</option></select></Field>
      {cfg.backend === 'local'
        ? <Field label="Model"><select value={cfg.localModel} onChange={e => set({ localModel: e.target.value as LocalModel })}>{(Object.keys(LOCAL_MODELS) as LocalModel[]).map(m => <option key={m} value={m}>{LOCAL_MODELS[m].label}</option>)}</select></Field>
        : <div className="grid2">
          <Field label="Provider"><select value={cfg.providerId} onChange={e => set({ providerId: e.target.value })}><option value="">— choose —</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Embedding model"><input type="text" value={cfg.providerModel} onChange={e => set({ providerModel: e.target.value })} /></Field></div>}
      <div className="small" style={{ margin: '4px 0 8px' }}>
        {st.state === 'indexing' || st.state === 'loading' ? <>⏳ {st.msg}</> : st.state === 'error' ? <span className="overdue">⚠ {st.msg}</span> : <>✅ {st.count.toLocaleString()} passages indexed</>}
        {st.state === 'indexing' && st.total > 0 && <div className="bar" style={{ marginTop: 4 }}><i style={{ width: Math.round(st.done / st.total * 100) + '%' }} /></div>}
      </div>
      <div className="row"><button className="btn sm" onClick={() => { void syncVectors(idx.chunks); toast('Updating the semantic index…'); }}>Build / update now</button>
        <button className="btn sm danger" onClick={() => confirmBox('Delete all vectors on this device? They can be rebuilt at any time.', () => { void clearVectors(); }, 'Delete')}>Clear index</button></div>
      <p className="small muted">{cfg.backend === 'local' ? 'The model weights are downloaded once from Hugging Face and cached in your browser; your text is never sent anywhere.' : 'Passage text is sent to the provider you choose to create embeddings.'}</p>
    </>}
  </Card>;
}
