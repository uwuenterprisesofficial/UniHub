import { useState } from 'react';
import { useStore } from '../lib/store';
import { removeFeed, syncFeed } from '../lib/feeds';
import { uid } from '../lib/util';
import { Field, Modal, ModuleSelect, confirmBox, toast } from './ui';

const ago = (t: number) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

export function FeedsDialog() {
  const { settings: S, setSettings } = useStore();
  const [name, setName] = useState(''), [url, setUrl] = useState(''), [moduleId, setModuleId] = useState(''), [busy, setBusy] = useState('');
  const run = async (id: string) => {
    setBusy(id);
    try { const r = await syncFeed(id); toast(`${r.total} events: ${r.added} new, ${r.updated} changed, ${r.removed} removed`); } catch (e) { toast((e as Error).message); }
    setBusy('');
  };
  const add = async () => {
    const u = url.trim(); if (!/^(https?|webcals?):\/\//i.test(u)) { toast('Paste the calendar’s iCal address (it starts with https:// or webcal://)'); return; }
    const id = uid(); setSettings({ icsFeeds: [...S.icsFeeds, { id, name: name.trim() || new URL(u.replace(/^webcals?:/i, 'https:')).hostname, url: u, moduleId, lastSync: 0, lastCount: 0, error: '' }] });
    setName(''); setUrl(''); await run(id);
  };
  return <Modal title="Calendar subscriptions" wide buttons={[{ label: 'Close' }]}>
    <p className="small muted" style={{ marginTop: 0 }}>Keep a Google, Outlook or university calendar up to date here (read-only). Use the calendar’s private iCal address: Google Calendar → Settings → “Secret address in iCal format”; Outlook → Shared calendars → Publish → ICS. Feeds refresh about every 6 hours while the app is open.</p>
    {S.icsFeeds.map(f => <div key={f.id} className="card" style={{ marginBottom: 8, padding: 10 }}>
      <div className="row"><b className="grow">📡 {f.name}</b>
        <button className="btn sm" disabled={busy === f.id} onClick={() => run(f.id)}>{busy === f.id ? 'Updating…' : '↻ Refresh'}</button>
        <button className="btn sm danger" onClick={() => confirmBox(`Remove “${f.name}” and the ${f.lastCount} events it brought in?`, () => removeFeed(f.id), 'Remove')}>✕</button></div>
      <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{f.url.replace(/([?&/][\w-]{6})[\w%-]{12,}/g, '$1…')}</div>
      <div className="small">{f.error ? <span className="overdue">⚠ {f.error}</span> : <span className="muted">{f.lastSync ? `${f.lastCount} events · updated ${ago(f.lastSync)}` : 'not imported yet'}</span>}</div></div>)}
    <div className="sec-title">Add a subscription</div>
    <Field label="Calendar address (iCal / .ics link)"><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" /></Field>
    <div className="grid2"><Field label="Name"><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Timetable" /></Field>
      <Field label="Link its events to module"><ModuleSelect value={moduleId} onChange={setModuleId} /></Field></div>
    <button className="btn primary" disabled={!!busy || !url.trim()} onClick={add}>Add and import</button>
  </Modal>;
}
