import { useState } from 'react';
import { PRESETS, activeProvider, estimateChunks, testProvider, useAI, type Provider, type ProviderKind } from '../lib/ai';
import { Card, Field, Modal, closeDialog, closeGate, confirmBox, openDialog, openGate, toast } from './ui';

/** Ask before any text leaves the device. Resolves false when declined, closed, or no provider exists. */
export function aiGate(what: string, chars: number): Promise<boolean> {
  const p = activeProvider();
  if (!p) { toast('Add an AI provider in Settings → AI provider first.'); return Promise.resolve(false); }
  if (useAI.getState().skipConfirm) return Promise.resolve(true);
  return new Promise(resolve => openGate(<GateDialog what={what} chars={chars} name={p.name} done={resolve} />, () => resolve(false)));
}
function GateDialog({ what, chars, name, done }: { what: string; chars: number; name: string; done: (ok: boolean) => void }) {
  const [dont, setDont] = useState(false);
  const finish = (ok: boolean) => { if (ok && dont) useAI.setState({ skipConfirm: true }); done(ok); };
  const calls = estimateChunks(chars);
  return <div className="modal" onClick={e => e.stopPropagation()}>
    <h2>Send to AI provider?</h2>
    <p><b>{what}</b></p>
    <p className="small">About {chars.toLocaleString()} characters of your text will be sent to <b>{name}</b>{calls > 1 ? ` in ${calls} requests` : ''}. Providers may bill per use and apply their own data policy.</p>
    <label className="small"><input type="checkbox" checked={dont} onChange={e => setDont(e.target.checked)} /> Don’t ask again (you can change this in Settings)</label>
    <div className="foot"><button className="btn" onClick={() => { finish(false); closeGate(); }}>Cancel</button><button className="btn primary" onClick={() => { finish(true); closeGate(); }}>Send</button></div>
  </div>;
}

function ProviderDialog({ id }: { id?: string }) {
  const { providers, save } = useAI();
  const ex = providers.find(p => p.id === id);
  const [d, setD] = useState<Omit<Provider, 'id'>>(ex ?? { name: '', kind: 'anthropic', baseUrl: PRESETS.anthropic.baseUrl, apiKey: '', model: PRESETS.anthropic.model });
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null); const [busy, setBusy] = useState(false);
  const preset = PRESETS[d.kind];
  const setKind = (kind: ProviderKind) => { const pr = PRESETS[kind]; setD({ ...d, kind, baseUrl: pr.baseUrl, model: pr.model, name: d.name || pr.label.split(' (')[0] }); setTest(null); };
  const runTest = async () => {
    setBusy(true); setTest(null);
    try { await testProvider({ ...d, id: 'test' }); setTest({ ok: true, msg: 'Connection works.' }); } catch (e) { setTest({ ok: false, msg: (e as Error).message }); }
    setBusy(false);
  };
  return <Modal title={id ? 'Edit AI provider' : 'Add AI provider'} buttons={[{ label: 'Cancel' }, { label: 'Save', cls: 'primary', onClick: () => {
    if (!d.model.trim()) { toast('Enter a model name'); return false; }
    save({ ...d, id, name: d.name.trim() || preset.label.split(' (')[0], apiKey: d.apiKey.trim(), model: d.model.trim(), baseUrl: d.kind === 'custom' ? d.baseUrl.trim() : preset.baseUrl });
  } }]}>
    <Field label="Provider type"><select value={d.kind} onChange={e => setKind(e.target.value as ProviderKind)}>{(Object.keys(PRESETS) as ProviderKind[]).map(k => <option key={k} value={k}>{PRESETS[k].label}</option>)}</select></Field>
    {d.kind === 'custom' && <Field label="Display name"><input type="text" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>}
    <Field label="API key"><input type="password" value={d.apiKey} autoComplete="off" onChange={e => setD({ ...d, apiKey: e.target.value })} placeholder={d.kind === 'custom' ? 'Optional for local servers' : 'Paste your key'} /></Field>
    <p className="small muted" style={{ marginTop: -4 }}>{preset.hint}</p>
    <div className="grid2">
      <Field label="Model"><input type="text" list="ai-models" value={d.model} onChange={e => setD({ ...d, model: e.target.value })} placeholder="model name" /><datalist id="ai-models">{preset.models.map(m => <option key={m} value={m} />)}</datalist></Field>
      {d.kind === 'custom' && <Field label="Server address"><input type="url" value={d.baseUrl} onChange={e => setD({ ...d, baseUrl: e.target.value })} /></Field>}
    </div>
    <div className="row"><button className="btn sm" disabled={busy} onClick={runTest}>{busy ? 'Testing…' : 'Test connection'}</button>
      {test && <span className={'small ' + (test.ok ? '' : 'overdue')}>{test.ok ? '✅ ' : '⚠ '}{test.msg}</span>}</div>
    <p className="small muted">The key is stored only in this browser. It is not synced and never sent to the UniHub server; requests go directly from your browser to the provider.</p>
  </Modal>;
}

export function AIProviderCard() {
  const { providers, activeId, language, skipConfirm, maxChars, remove } = useAI();
  return <Card title="✨ AI provider">
    <p className="small muted">Optional. Connect your own account to get written answers, AI summaries, quote finding and definition drafts. Everything stays extractive and local until you add a provider and confirm a request.</p>
    {providers.map(p => <div key={p.id} className="row" style={{ marginBottom: 6 }}>
      <label className="grow"><input type="radio" name="aiactive" checked={activeId === p.id} onChange={() => useAI.setState({ activeId: p.id })} /> <b>{p.name}</b> <span className="muted small">· {p.model} · {PRESETS[p.kind].label.split(' (')[0]}</span></label>
      <button className="btn sm" onClick={() => openDialog(<ProviderDialog id={p.id} />)}>Edit</button>
      <button className="btn sm danger" onClick={() => confirmBox(`Remove “${p.name}” and its key from this browser?`, () => remove(p.id), 'Remove')}>✕</button></div>)}
    <button className="btn sm primary" onClick={() => openDialog(<ProviderDialog />)}>＋ Add provider</button>
    {providers.length > 0 && <div style={{ marginTop: 12 }}>
      <Field label="Answer language (empty = same as the source text)"><input type="text" value={language} onChange={e => useAI.setState({ language: e.target.value })} placeholder="e.g. German" /></Field>
      <Field label="Text per request"><select value={maxChars} onChange={e => useAI.setState({ maxChars: +e.target.value })}><option value={6000}>Small (~6k characters, cheaper)</option><option value={14000}>Medium (~14k characters)</option><option value={30000}>Large (~30k characters)</option></select></Field>
      <label className="small"><input type="checkbox" checked={!skipConfirm} onChange={e => useAI.setState({ skipConfirm: !e.target.checked })} /> Ask for confirmation before sending text to the provider</label>
    </div>}
  </Card>;
}
export { closeDialog };
