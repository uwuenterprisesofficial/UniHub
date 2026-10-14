import { useRef, useState } from 'react';
import { blobs } from '../lib/blobs';
import { getData, useStore } from '../lib/store';
import { exportICS } from '../lib/schedule';
import { loadSample } from '../lib/sample';
import { b64ToBlob, blobToB64, download, today } from '../lib/util';
import type { Data } from '../lib/types';
import { Card, Field, confirmBox, toast } from '../components/ui';
import { AccountCard } from './Account';
import { deleteRemoteFile } from '../lib/sync';
import { AIProviderCard } from '../components/AI';
import { SemanticCard } from '../components/Semantic';
import { OCR_LANGS } from '../lib/ocr';

export default function Settings() {
  const { settings: S, setSettings, tasks, events, reset, replaceAll, docs, modules } = useStore();
  const [sem, setSem] = useState(''); const fileRef = useRef<HTMLInputElement>(null);
  const [stagesText, setStagesText] = useState(S.stages.join(', '));

  const backup = async () => {
    const files: Record<string, string> = {};
    for (const d of docs) for (const v of d.versions) { const b = await blobs.get(v.blobKey); if (b) files[v.blobKey] = await blobToB64(b); }
    download(`unihub-backup-${today()}.json`, JSON.stringify({ app: 'unihub', version: 2, data: getData(), files }), 'application/json');
  };
  const restore = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()); if (j.app !== 'unihub') throw new Error('not a UniHub backup');
      await blobs.clear();
      for (const [k, v] of Object.entries(j.files as Record<string, string>)) await blobs.put(k, await b64ToBlob(v));
      replaceAll(j.data as Data); toast('Backup restored');
    } catch (e) { toast('Restore failed: ' + (e as Error).message); }
  };
  const csv = () => {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    download('unihub-tasks.csv', ['title,module,type,due,priority,status,estimate_min,spent_min', ...tasks.map(t => [t.title, modules.find(m => m.id === t.moduleId)?.name, t.type, t.due, t.priority, t.status, t.estimate, t.spent].map(q).join(','))].join('\n'), 'text/csv');
  };
  const saveStages = () => {
    const st = stagesText.split(',').map(s => s.trim()).filter(Boolean);
    if (st.length < 2) return toast('Need at least two stages (the last one means "done")');
    // keep existing tasks valid: map renamed/unknown stages to the first stage, old "done" to the new done
    const oldDone = S.stages[S.stages.length - 1];
    useStore.setState(s => ({ tasks: s.tasks.map(t => ({ ...t, u: Date.now(), status: st.includes(t.status) ? t.status : t.status === oldDone ? st[st.length - 1] : st[0] })) }));
    setSettings({ stages: st }); toast('Stages saved');
  };

  return <>
    <div className="page-head"><h1>Settings</h1></div>
    <div className="dash">
      <AccountCard />
      <AIProviderCard />
      <SemanticCard />
      <Card title="Semesters">
        <Field label="Current semester"><select value={S.currentSemester} onChange={e => setSettings({ currentSemester: e.target.value })}>{S.semesters.map(s => <option key={s}>{s}</option>)}</select></Field>
        <div className="row" style={{ marginBottom: 8 }}>{S.semesters.map(s => <span key={s} className="chip">{s}
          {S.semesters.length > 1 && <button className="icon-btn" style={{ padding: 0, fontSize: 12 }} onClick={() => { const l = S.semesters.filter(x => x !== s); setSettings({ semesters: l, currentSemester: l.includes(S.currentSemester) ? S.currentSemester : l[0] }); }}>✕</button>}</span>)}</div>
        <div className="row"><input type="text" style={{ flex: 1 }} placeholder="e.g. WS 2026/27" value={sem} onChange={e => setSem(e.target.value)} />
          <button className="btn" onClick={() => { const v = sem.trim(); if (v && !S.semesters.includes(v)) { setSettings({ semesters: [...S.semesters, v], currentSemester: v }); setSem(''); } }}>Add</button></div>
      </Card>
      <Card title="Preferences">
        <Field label="Theme"><select value={S.theme} onChange={e => setSettings({ theme: e.target.value as typeof S.theme })}><option value="auto">System</option><option value="light">Light</option><option value="dark">Dark</option></select></Field>
        <div className="grid2">
          <Field label="Date format"><select value={S.dateFormat} onChange={e => setSettings({ dateFormat: e.target.value as typeof S.dateFormat })}><option value="ISO">2026-10-12</option><option value="DMY">12.10.2026</option><option value="MDY">10/12/2026</option></select></Field>
          <Field label="Week starts on"><select value={S.weekStart} onChange={e => setSettings({ weekStart: +e.target.value as 0 | 1 })}><option value={1}>Monday</option><option value={0}>Sunday</option></select></Field>
          <Field label="Default task priority"><select value={S.defaultPriority} onChange={e => setSettings({ defaultPriority: +e.target.value as 1 | 2 | 3 })}><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option></select></Field>
          <Field label="Daily study capacity (hours)"><input type="number" min={1} max={16} value={S.dailyHours} onChange={e => setSettings({ dailyHours: +e.target.value })} /></Field>
        </div>
        <label style={{ display: 'block', marginBottom: 6 }}><input type="checkbox" checked={S.autoAnalyze} onChange={e => setSettings({ autoAnalyze: e.target.checked })} /> Suggest glossary terms and quotable passages automatically when importing documents (runs locally on your device)</label>
        <label style={{ display: 'block', marginBottom: 6 }}><input type="checkbox" checked={S.ocr} onChange={e => setSettings({ ocr: e.target.checked })} /> OCR: read text from scanned PDF pages and images (runs on this device)</label>
        {S.ocr && <div className="row small" style={{ margin: '0 0 8px 22px', gap: 10 }}>OCR languages:
          {Object.entries(OCR_LANGS).map(([k, v]) => <label key={k}><input type="checkbox" checked={S.ocrLangs.split('+').includes(k)} onChange={e => {
            const cur = S.ocrLangs.split('+').filter(Boolean), next = e.target.checked ? [...cur, k] : cur.filter(x => x !== k);
            setSettings({ ocrLangs: (next.length ? next : ['eng']).join('+') });
          }} /> {v}</label>)}</div>}
        <label><input type="checkbox" checked={S.reminders} onChange={e => setSettings({ reminders: e.target.checked })} /> Show event reminders (and browser notifications if allowed)</label>
        <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => 'Notification' in window ? Notification.requestPermission().then(p => toast('Notifications: ' + p)) : toast('Not supported')}>Enable browser notifications</button></div>
      </Card>
      <Card title="Assignment workflow stages">
        <p className="small muted">Comma-separated, in order. The last stage means “completed”.</p>
        <input type="text" value={stagesText} onChange={e => setStagesText(e.target.value)} />
        <div style={{ marginTop: 8 }}><button className="btn" onClick={saveStages}>Save stages</button></div>
      </Card>
      <Card title="Data & backup">
        <div className="row">
          <button className="btn primary" onClick={backup}>⬇ Full backup (incl. files)</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Restore backup</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={e => { restore(e.target.files?.[0]); e.target.value = ''; }} />
          <button className="btn" onClick={() => download('unihub-calendar.ics', exportICS(events), 'text/calendar')}>Export calendar (ICS)</button>
          <button className="btn" onClick={csv}>Export tasks (CSV)</button>
        </div>
        <p className="small muted">Documents and notes are plain files/Markdown inside the backup, so you are never locked in.</p>
      </Card>
      <Card title="Privacy">
        <p className="small">Your workspace is stored in your account on the UniHub server and nowhere else. AI providers are contacted only if you add one, and your API keys never leave this browser.</p>
        <div className="row">
          <button className="btn" onClick={loadSample}>Load sample data</button>
          <button className="btn danger" onClick={() => confirmBox('Permanently delete ALL modules, tasks, notes, events and documents from your account (on every device)?', async () => { const keys = useStore.getState().docs.flatMap(d => d.versions.map(v => v.blobKey)); await Promise.all(keys.map(deleteRemoteFile)); await blobs.clear(); reset(); toast('All data deleted'); }, 'Delete everything')}>Delete all data</button></div>
      </Card>
    </div>
  </>;
}
