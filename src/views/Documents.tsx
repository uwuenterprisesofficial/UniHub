import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blobs, texts, useTexts } from '../lib/blobs';
import { extractText } from '../lib/extract';
import { analyzeDoc } from '../lib/analysis';
import { useStore } from '../lib/store';
import type { DocMeta } from '../lib/types';
import { download, fmtDate, fmtSize, parseTags, uid } from '../lib/util';
import { Field, ModChip, ModuleSelect, confirmBox, toast } from '../components/ui';

const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'json', 'tex', 'bib', 'html'];
const extOf = (n: string) => (n.split('.').pop() ?? '').toLowerCase();

export async function importFiles(files: File[], opts: { moduleId?: string } = {}): Promise<DocMeta[]> {
  const s = useStore.getState(); let n = 0; const result: DocMeta[] = [];
  for (const f of files) {
    const ext = extOf(f.name);
    const dup = s.docs.find(d => d.name === f.name && d.size === f.size);
    if (dup) { toast(opts.moduleId ? `${f.name} is already in your library — using that copy` : `Possible duplicate skipped: ${f.name}`); result.push(dup); continue; }
    const key = uid();
    await blobs.put(key, f);
    const text = await extractText(f, ext, { label: f.name });
    const low = f.name.toLowerCase();
    const match = s.modules.find(m => (m.code && low.includes(m.code.toLowerCase())) || low.includes(m.name.toLowerCase()));
    const doc = s.add('docs', { name: f.name, ext, mime: f.type, size: f.size, moduleId: opts.moduleId ?? match?.id ?? '', folder: '', tags: [], fav: false, added: Date.now(), opened: 0, text: text.slice(0, 20_000), read: false, versions: [{ blobKey: key, size: f.size, added: Date.now() }] });
    if (text) await texts.set(doc.id, text);
    if (text && useStore.getState().settings.autoAnalyze) { const r = await analyzeDoc(doc); if (r.terms || r.quotes) toast(`${f.name}: ${r.terms} glossary and ${r.quotes} quote suggestions found`); }
    n++; result.push(useStore.getState().docs.find(d => d.id === doc.id) ?? doc);
  }
  if (n) toast(`Added ${n} document(s)`);
  return result;
}

export function Documents() {
  const nav = useNavigate(); const fileRef = useRef<HTMLInputElement>(null);
  const { docs, update } = useStore(); const full = useTexts(s => s.map);
  const [q, setQ] = useState(''), [mf, setMf] = useState(''), [folder, setFolder] = useState('all'), [type, setType] = useState('all'), [favOnly, setFavOnly] = useState(false), [over, setOver] = useState(false);
  const [sort, setSort] = useState<'added' | 'opened' | 'name'>('added');
  const folders = useMemo(() => [...new Set(docs.map(d => d.folder).filter(Boolean))].sort(), [docs]);
  const types = useMemo(() => [...new Set(docs.map(d => d.ext))].sort(), [docs]);
  const ql = q.toLowerCase();
  const list = docs.filter(d => (!mf || d.moduleId === mf) && (folder === 'all' || d.folder === folder) && (type === 'all' || d.ext === type) && (!favOnly || d.fav)
    && (!ql || (d.name + ' ' + d.tags.join(' ') + ' ' + (full[d.id] ?? d.text)).toLowerCase().includes(ql)))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : (b[sort] || 0) - (a[sort] || 0));
  const snippet = (d: DocMeta) => { const t = full[d.id] ?? d.text; const i = ql ? t.toLowerCase().indexOf(ql) : -1; return i < 0 ? '' : '…' + t.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ') + '…'; };
  return <>
    <div className="page-head"><h1>Documents</h1>
      <button className="btn primary" onClick={() => fileRef.current?.click()}>⬆ Upload files</button>
      <input ref={fileRef} type="file" multiple hidden onChange={e => { importFiles([...(e.target.files ?? [])]); e.target.value = ''; }} /></div>
    <div className={'dropzone' + (over ? ' dragover' : '')} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); importFiles([...e.dataTransfer.files]); }}>
      Drop files here — PDF, Word, PowerPoint, images, Markdown or text. Files are stored privately in your browser.</div>
    <div className="row" style={{ marginBottom: 16 }}>
      <input type="search" placeholder="Search names, tags and text content…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 280 }} />
      <div style={{ width: 200 }}><ModuleSelect value={mf} onChange={setMf} none="All modules" /></div>
      <select style={{ width: 130 }} value={type} onChange={e => setType(e.target.value)}><option value="all">All types</option>{types.map(t => <option key={t}>{t}</option>)}</select>
      <select style={{ width: 150 }} value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="added">Recently added</option><option value="opened">Recently opened</option><option value="name">Name</option></select>
      <label><input type="checkbox" checked={favOnly} onChange={e => setFavOnly(e.target.checked)} /> ★ Favorites</label></div>
    {folders.length > 0 && <div className="row" style={{ marginBottom: 12, gap: 6 }}>
      {['all', ...folders].map(f => <button key={f} className={'btn sm' + (folder === f ? ' primary' : '')} onClick={() => setFolder(f)}>{f === 'all' ? 'All folders' : '📁 ' + f}</button>)}</div>}
    <div className="cards">{list.map(d => <div key={d.id} className="card dcard" onClick={() => nav('/documents/' + d.id)}>
      <div className="dicon">{d.ext.toUpperCase().slice(0, 4)}</div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="t" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.fav && '★ '}{d.name}</div>
        <div className="small muted">{fmtSize(d.size)}{d.folder && ' · 📁 ' + d.folder}</div>
        <div className="row" style={{ gap: 4, marginTop: 4 }}><ModChip id={d.moduleId} />{d.tags.map(t => <span key={t} className="chip">#{t}</span>)}</div>
        {snippet(d) && <div className="small muted" style={{ marginTop: 4 }}>{snippet(d)}</div>}
      </div>
      <button className="icon-btn" title="Favorite" onClick={e => { e.stopPropagation(); update('docs', d.id, { fav: !d.fav }); }}>{d.fav ? '★' : '☆'}</button>
    </div>)}</div>
    {!list.length && <div className="card empty">{docs.length ? 'No documents match your filters.' : 'No documents yet. Upload some to get started.'}</div>}
  </>;
}
