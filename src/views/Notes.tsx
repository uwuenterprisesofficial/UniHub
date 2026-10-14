import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { newTask, newNote, useStore } from '../lib/store';
import { linkTerms, md } from '../lib/markdown';
import { parseTags } from '../lib/util';
import { Field, ModuleSelect, confirmBox, toast } from '../components/ui';

export default function Notes() {
  const { id } = useParams(); const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const { notes, modules, terms, add, update, remove } = useStore();
  const [q, setQ] = useState(''); const [mf, setMf] = useState(''); const [tag, setTag] = useState('');
  const [preview, setPreview] = useState(true);

  // create note from an unresolved [[wiki link]]
  useEffect(() => {
    const t = sp.get('new'); if (!t) return;
    const ex = notes.find(n => n.title.toLowerCase() === t.toLowerCase());
    const nid = ex?.id ?? add('notes', newNote({ title: t })).id;
    setSp({}, { replace: true }); nav('/notes/' + nid, { replace: true });
  }, [sp]);

  const tags = useMemo(() => [...new Set(notes.flatMap(n => n.tags))].sort(), [notes]);
  const list = notes.filter(n => (!mf || n.moduleId === mf) && (!tag || n.tags.includes(tag)) && (!q || (n.title + n.body + n.tags.join(' ')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => +b.pinned - +a.pinned || b.updated - a.updated);
  const note = notes.find(n => n.id === id);
  const backlinks = note ? notes.filter(n => n.id !== note.id && n.body.toLowerCase().includes(`[[${note.title.toLowerCase()}]]`)) : [];
  const patch = (p: Partial<typeof notes[number]>) => note && update('notes', note.id, { ...p, updated: Date.now() });

  const extractTasks = () => {
    if (!note) return;
    const lines = [...note.body.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)].map(m => m[1].trim()).filter(Boolean);
    if (!lines.length) return toast('No open "- [ ]" checklist items found');
    lines.forEach(l => add('tasks', { ...newTask({ title: l, moduleId: note.moduleId, type: 'Study goal', noteIds: [note.id] }) }));
    toast(`Created ${lines.length} task(s)`);
  };

  return <>
    <div className="page-head"><h1>Notes</h1>
      <button className="btn primary" onClick={() => nav('/notes/' + add('notes', newNote()).id)}>＋ New note</button></div>
    <div className="split">
      <div>
        <input type="search" placeholder="Search notes…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 8 }} />
        <div className="row" style={{ marginBottom: 8 }}><div className="grow"><ModuleSelect value={mf} onChange={setMf} none="All modules" /></div>
          <select style={{ width: 110 }} value={tag} onChange={e => setTag(e.target.value)}><option value="">All tags</option>{tags.map(t => <option key={t}>{t}</option>)}</select></div>
        <div className="nlist">{list.map(n => <div key={n.id} className={'it' + (n.id === id ? ' on' : '')} onClick={() => nav('/notes/' + n.id)}>
          <strong>{n.pinned && '📌 '}{n.title}</strong>
          <div className="small muted">{modules.find(m => m.id === n.moduleId)?.name ?? 'No module'}{n.tags.length > 0 && ' · #' + n.tags.join(' #')}</div></div>)}
          {!list.length && <div className="empty">No notes.</div>}</div>
      </div>
      {note ? <div className="card" key={note.id}>
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="text" className="grow" style={{ fontSize: 18, fontWeight: 600 }} value={note.title} onChange={e => patch({ title: e.target.value })} />
          <button className="btn" onClick={() => patch({ pinned: !note.pinned })}>{note.pinned ? '📌 Pinned' : 'Pin'}</button>
          <button className="btn" onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Preview'}</button>
          <button className="btn danger" onClick={() => confirmBox('Delete this note?', () => { remove('notes', note.id); nav('/notes'); })}>Delete</button></div>
        <div className="grid2"><Field label="Module"><ModuleSelect value={note.moduleId} onChange={v => patch({ moduleId: v })} /></Field>
          <Field label="Tags (comma separated)"><input type="text" defaultValue={note.tags.join(', ')} onBlur={e => patch({ tags: parseTags(e.target.value) })} /></Field></div>
        <div className="editor" style={preview ? {} : { gridTemplateColumns: '1fr' }}>
          <textarea value={note.body} placeholder="Write in Markdown. Link notes with [[Note title]]. Checklist: - [ ] item" onChange={e => patch({ body: e.target.value })} />
          {preview && <div className="md" dangerouslySetInnerHTML={{ __html: linkTerms(md(note.body, notes), terms.filter(t => t.status === 'confirmed')) }} />}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={extractTasks}>☑ Checklist items → tasks</button>
          <button className="btn sm" onClick={() => { add('tasks', newTask({ title: note.title, moduleId: note.moduleId, noteIds: [note.id] })); toast('Task created'); }}>＋ Task from note</button>
          {note.eventId && <span className="small muted">Lecture note · linked to appointment</span>}</div>
        {backlinks.length > 0 && <><div className="sec-title">Linked from</div><div className="row">{backlinks.map(b => <Link key={b.id} className="chip" to={'/notes/' + b.id}>{b.title}</Link>)}</div></>}
      </div> : <div className="card empty">Select a note, or create a new one.</div>}
    </div>
  </>;
}
