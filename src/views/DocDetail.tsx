import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { blobs, texts, useTexts } from '../lib/blobs';
import { canExtract, extractText } from '../lib/extract';
import { isImageExt } from '../lib/ocr';
import { ensureText, reanchor } from '../lib/analysis';
import { deleteRemoteFile } from '../lib/sync';
import { useStore } from '../lib/store';
import { download, fmtDate, fmtSize, parseTags, uid } from '../lib/util';
import { Field, ModuleSelect, confirmBox, toast } from '../components/ui';
import { Reader } from '../components/Reader';
import { BackLink } from '../components/BackLink';
import { useUrlState } from '../lib/nav';

const extOf = (n: string) => (n.split('.').pop() ?? '').toLowerCase();

export function DocDetail() {
  const { id = '' } = useParams(); const nav = useNavigate(); const verRef = useRef<HTMLInputElement>(null);
  const [sp] = useSearchParams();
  const { docs, notes, tasks, annotations, update, remove } = useStore();
  const full = useTexts(s => s.map); const textsReady = useTexts(s => s.ready);
  const d = docs.find(x => x.id === id);
  const [url, setUrl] = useState(''); const [ver, setVer] = useState(-1);
  const [view, setView] = useUrlState<'reader' | 'original' | 'details'>('view', 'reader', ['reader', 'original', 'details']);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (d) update('docs', d.id, { opened: Date.now() }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  // make sure the full text exists (e.g. on a device that received this document through sync)
  useEffect(() => {
    if (d && textsReady && full[d.id] === undefined && canExtract(d.ext)) { setBusy(true); ensureText(d).finally(() => setBusy(false)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id, textsReady]);
  const vi = d ? (ver < 0 ? d.versions.length - 1 : ver) : 0;
  useEffect(() => {
    let u = ''; let alive = true;
    (async () => {
      const v = d?.versions[vi]; if (!v) return;
      const b = await blobs.get(v.blobKey);
      if (b && alive) { u = URL.createObjectURL(b.type ? b : new Blob([b], { type: d!.mime })); setUrl(u); }
    })();
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [id, vi, d?.versions.length]);

  if (!d) return <div className="card empty">Document not found. <Link to="/documents">Back to library</Link></div>;
  const text = full[d.id] ?? '';
  const hasText = !!text;
  const linkedNotes = notes.filter(n => n.body.includes(`#/documents/${d.id}`));
  const linkedTasks = tasks.filter(t => t.docIds.includes(d.id));
  const isImg = d.mime.startsWith('image/'), isPdf = d.ext === 'pdf';
  const rename = (name: string) => update('docs', d.id, { name, ext: extOf(name) || d.ext });
  const newVersion = async (f?: File) => {
    if (!f) return; const key = uid(); await blobs.put(key, f);
    const t = await extractText(f, extOf(f.name));
    update('docs', d.id, { versions: [...d.versions, { blobKey: key, size: f.size, added: Date.now() }], size: f.size, text: t.slice(0, 20_000) });
    if (t) await texts.set(d.id, t);
    setVer(-1);
    const r = t ? reanchor(d.id, t) : { moved: 0, detached: 0 };
    toast('New version saved; the original is kept.' + (r.moved || r.detached ? ` ${r.moved} annotation(s) moved, ${r.detached} detached.` : ''));
  };
  const mode = view === 'reader' && !hasText && !busy ? (isPdf || isImg ? 'original' : 'details') : view;
  const at = sp.get('at');

  return <>
    <div className="page-head"><div><BackLink fallback="/documents" label="Documents" /><h1>{d.name}</h1>
      <div className="muted small">{fmtSize(d.size)} · added {fmtDate(new Date(d.added).toISOString().slice(0, 10), 'ISO')} · {d.versions.length} version(s) · {annotations.filter(a => a.docId === d.id).length} annotations</div></div>
      <button className="btn" onClick={() => update('docs', d.id, { fav: !d.fav })}>{d.fav ? '★ Favorite' : '☆ Favorite'}</button>
      <button className="btn" onClick={() => update('docs', d.id, { read: !d.read })}>{d.read ? '✓ Read' : 'Mark as read'}</button>
      <button className="btn" onClick={async () => { const b = await blobs.get(d.versions[vi].blobKey); if (b) download(d.name, b); }}>⬇ Download</button>
      <button className="btn danger" onClick={() => confirmBox('Delete this document, its versions and annotations?', async () => {
        await Promise.all(d.versions.map(v => blobs.del(v.blobKey).then(() => deleteRemoteFile(v.blobKey)))); await texts.del(d.id);
        annotations.filter(a => a.docId === d.id).forEach(a => remove('annotations', a.id));
        const qs = useStore.getState().quotes.filter(q => q.docId === d.id);
        qs.filter(q => q.status === 'suggested').forEach(q => remove('quotes', q.id)); // keep saved quotes, just unlink the document
        qs.filter(q => q.status === 'saved').forEach(q => update('quotes', q.id, { docId: '' }));
        remove('docs', d.id); nav('/documents');
      })}>Delete</button></div>
    <div className="tabs">
      {([['reader', '📖 Reader & annotations'], ['original', isPdf ? '📄 Original PDF' : '📄 Original'], ['details', 'Details']] as const).map(([k, l]) =>
        <button key={k} className={mode === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
    {busy && <div className="card empty">Reading document…</div>}
    {mode === 'reader' && hasText && <Reader key={d.id} doc={d} text={text} at={at ? +at : undefined} />}
    {mode === 'original' && <>
      {isPdf && url && <iframe className="preview" src={url} title={d.name} />}
      {isImg && url && <img className="preview" src={url} alt={d.name} />}
      {!isPdf && !isImg && <div className="card empty">No inline preview for .{d.ext} files — use the Reader tab for the extracted text, or download it.</div>}
    </>}
    {mode === 'details' && <div className="split doc-split">
      <div className="card">
        <Field label="Name"><input type="text" value={d.name} onChange={e => rename(e.target.value)} /></Field>
        <Field label="Module"><ModuleSelect value={d.moduleId} onChange={v => update('docs', d.id, { moduleId: v })} /></Field>
        <Field label="Folder"><input type="text" value={d.folder} placeholder="e.g. Lectures" onChange={e => update('docs', d.id, { folder: e.target.value })} /></Field>
        <Field label="Tags (comma separated)"><input type="text" defaultValue={d.tags.join(', ')} onBlur={e => update('docs', d.id, { tags: parseTags(e.target.value) })} /></Field>
        {(isPdf || isImageExt(d.ext)) && <div style={{ marginBottom: 8 }}><button className="btn sm" disabled={busy} onClick={async () => {
          const b = await blobs.get(d.versions[vi].blobKey); if (!b) return toast('File not available on this device yet');
          setBusy(true); const t = await extractText(b, d.ext, { force: true, ocr: true, label: d.name }); setBusy(false);
          if (!t.trim()) return toast('OCR found no text');
          await texts.set(d.id, t); update('docs', d.id, { text: t.slice(0, 20_000) });
          const r = reanchor(d.id, t); toast('Text re-read with OCR' + (r.moved || r.detached ? ` · ${r.moved} annotation(s) moved, ${r.detached} detached` : ''));
        }}>🔍 Re-read with OCR</button><div className="small muted">Use for scans or when the text layer is poor. Replaces the extracted text; annotations are re-anchored.</div></div>}
        {!hasText && canExtract(d.ext) && <button className="btn sm" onClick={() => { setBusy(true); ensureText(d).finally(() => setBusy(false)); }}>Extract text</button>}
        {!hasText && !canExtract(d.ext) && <p className="small muted">Text can be extracted from PDF, Word (.docx), Markdown and plain-text files. Other formats and scans have no text layer.</p>}
      </div>
      <div className="card">
        <div className="sec-title" style={{ marginTop: 0 }}>Versions</div>
        {d.versions.map((v, i) => <div key={v.blobKey} className="row small" style={{ marginBottom: 4 }}>
          <button className={'btn sm' + (i === vi ? ' primary' : '')} onClick={() => setVer(i)}>v{i + 1}</button>{fmtSize(v.size)} · {new Date(v.added).toLocaleDateString()}</div>)}
        <button className="btn sm" onClick={() => verRef.current?.click()}>＋ Upload new version</button>
        <input ref={verRef} type="file" hidden onChange={e => { newVersion(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="sec-title">Related</div>
        {linkedNotes.map(n => <div key={n.id}><Link to={'/notes/' + n.id}>📝 {n.title}</Link></div>)}
        {linkedTasks.map(t => <div key={t.id} className="small">☐ {t.title}</div>)}
        {!linkedNotes.length && !linkedTasks.length && <div className="small muted">Nothing linked yet.</div>}
      </div>
    </div>}
  </>;
}
