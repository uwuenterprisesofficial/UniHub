import { useEffect, useRef, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { getData, isDone, useStore } from './lib/store';
import { occurrences } from './lib/schedule';
import { addDays, fmtDur, nowMin, toMin, today } from './lib/util';
import { DialogHost, Modal, closeDialog, openDialog, toast } from './components/ui';
import { EventDialog, ModuleDialog, TaskDialog } from './components/editors';
import Dashboard, { computeNotifications } from './views/Dashboard';
import { ModuleDetail, Modules } from './views/Modules';
import Calendar from './views/Calendar';
import { Documents, importFiles } from './views/Documents';
import { DocDetail } from './views/DocDetail';
import Notes from './views/Notes';
import Tasks from './views/Tasks';
import Search from './views/Search';
import Settings from './views/Settings';
import { LegacyImport, ResetPassword, SyncBadge } from './views/Account';
import { Gate } from './components/Gate';
import { legacyCount, useSync } from './lib/sync';
import { refreshDueFeeds } from './lib/feeds';
import { useNavigationMemory } from './lib/nav';
import { useOcr } from './lib/ocr';
import Study from './views/Study';
import { GlossaryDetail, GlossaryList } from './views/Glossary';
import Quotes from './views/Quotes';
import Knowledge from './views/Knowledge';
import Graph from './views/Graph';
import Workspace from './views/Workspace';
import { ThesisDetail, ThesisList } from './views/Thesis';

/* ---------- study timer ---------- */
const useTimer = create<{ start: number | null; taskId: string }>(() => ({ start: null, taskId: '' }));
function StudyTimer() {
  const { start, taskId } = useTimer(); const { tasks, update } = useStore();
  const [, tick] = useState(0);
  useEffect(() => { if (!start) return; const i = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(i); }, [start]);
  const stop = () => {
    const mins = Math.max(1, Math.round((Date.now() - start!) / 60000)), t = tasks.find(x => x.id === taskId);
    if (t) update('tasks', t.id, { spent: t.spent + mins });
    useTimer.setState({ start: null, taskId: '' }); toast(`Study session: ${fmtDur(mins)}${t ? ' logged to "' + t.title + '"' : ''}`);
  };
  const begin = () => openDialog(<StartSession />);
  if (!start) return <div id="timer"><button className="btn" onClick={begin}>▶ Study</button></div>;
  const s = Math.floor((Date.now() - start) / 1000);
  return <div id="timer"><span className="tm">{String(Math.floor(s / 3600)).padStart(2, '0')}:{String(Math.floor(s / 60) % 60).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</span><button className="btn" onClick={stop}>■ Stop</button></div>;
}
function StartSession() {
  const { tasks, settings: S } = useStore(); const [id, setId] = useState('');
  return <Modal title="Start a study session" buttons={[{ label: 'Cancel' }, { label: 'Start', cls: 'primary', onClick: () => useTimer.setState({ start: Date.now(), taskId: id }) }]}>
    <p className="muted small">Optionally attach the session to a task; the time is added to its “time spent”.</p>
    <select value={id} onChange={e => setId(e.target.value)}><option value="">No task</option>{tasks.filter(t => !isDone(t, S)).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
  </Modal>;
}

function OcrBanner() {
  const job = useOcr(s => s.job);
  if (!job) return null;
  return <div className="ocrbanner" role="status">🔍 Reading text (OCR) — {job.label} <b>{job.pct}%</b></div>;
}

/* ---------- reminders ---------- */
function useReminders() {
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const check = () => {
      const d = getData(); if (!d.settings.reminders) return;
      const t = today(), now = nowMin();
      const items = [...occurrences(d.events, t, addDays(t, 1))];
      for (const o of items) {
        if (o.ev.reminder === '' || !o.ev.start) continue;
        const startAbs = (o.date === t ? 0 : 1440) + toMin(o.ev.start), lead = startAbs - now;
        const k = o.ev.id + o.date;
        if (lead <= +o.ev.reminder && lead >= 0 && !fired.current.has(k)) {
          fired.current.add(k);
          const msg = `${o.ev.title} starts in ${lead} min${o.ev.location ? ' · ' + o.ev.location : ''}`;
          toast('⏰ ' + msg);
          if ('Notification' in window && Notification.permission === 'granted') new Notification('UniHub', { body: msg });
        }
      }
    };
    check(); const i = setInterval(check, 30000); return () => clearInterval(i);
  }, []);
}

/** Rows and cards are clickable <div>s: make them reachable and operable with the keyboard (Tab, Enter, Space). */
const CLICKABLE = '.itm,.annitem,.kb-hit,.check,.mcard,.dcard,.tcard,.nlist .it,.pill,.ev';
function useKeyboardActivation() {
  useEffect(() => {
    const mark = (root: ParentNode) => root.querySelectorAll<HTMLElement>(CLICKABLE).forEach(el => {
      if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) { el.tabIndex = 0; el.setAttribute('role', 'button'); }
    });
    mark(document); let t = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(() => mark(document)); });
    obs.observe(document.body, { childList: true, subtree: true });
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.key === 'Enter' || e.key === ' ') && el.matches?.(CLICKABLE) && !el.matches('input,textarea,select,button,a')) { e.preventDefault(); el.click(); }
    };
    document.addEventListener('keydown', key);
    return () => { obs.disconnect(); document.removeEventListener('keydown', key); };
  }, []);
}

/* ---------- shell ---------- */
function QuickMenu() {
  const nav = useNavigate(); const add = useStore(s => s.add);
  const fileRef = useRef<HTMLInputElement>(null);
  const items: [string, () => void][] = [
    ['☑ Task', () => openDialog(<TaskDialog />)],
    ['📅 Appointment', () => openDialog(<EventDialog date={today()} />)],
    ['📝 Note', () => { closeDialog(); nav('/notes/' + add('notes', { title: 'Untitled note', body: '', moduleId: '', tags: [], pinned: false, updated: Date.now() }).id); }],
    ['📚 Module', () => openDialog(<ModuleDialog />)],
    ['⬆ Upload file', () => fileRef.current?.click()],
  ];
  return <Modal title="Create new…" buttons={[{ label: 'Close' }]}>
    <div style={{ display: 'grid', gap: 8 }}>{items.map(([l, fn]) => <button key={l} className="btn" style={{ justifyContent: 'flex-start' }} onClick={fn}>{l}</button>)}</div>
    <input ref={fileRef} type="file" multiple hidden onChange={e => { importFiles([...(e.target.files ?? [])]); closeDialog(); nav('/documents'); }} />
  </Modal>;
}

const NAV = [['/', '🏠', 'Dashboard'], ['/modules', '📚', 'Modules'], ['/calendar', '📅', 'Calendar'], ['/tasks', '☑', 'Tasks'], ['/documents', '📄', 'Documents'], ['/notes', '📝', 'Notes'], ['/glossary', '📖', 'Glossary'], ['/quotes', '❝', 'Quotes'], ['/knowledge', '🔎', 'Knowledge'], ['/graph', '🕸', 'Graph'], ['/study', '🧠', 'Study'], ['/thesis', '🎓', 'Thesis'], ['/settings', '⚙', 'Settings']] as const;

function Shell() {
  const nav = useNavigate(); const loc = useLocation();
  const [open, setOpen] = useState(false); const theme = useStore(s => s.settings.theme);
  useStore(); const badge = computeNotifications(getData()).filter(n => n.lvl >= 3).length;
  useReminders(); useKeyboardActivation(); useNavigationMemory();
  useEffect(() => { if (legacyCount() > 0) openDialog(<LegacyImport />); }, []);
  const offline = useSync(s => s.status === 'offline'), unsaved = useSync(s => s.pending);
  useEffect(() => { const t = setTimeout(refreshDueFeeds, 3000), i = setInterval(refreshDueFeeds, 30 * 60_000); return () => { clearTimeout(t); clearInterval(i); }; }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme === 'auto' ? '' : theme; }, [theme]);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '/' && !(e.target as HTMLElement).matches('input,textarea,select')) { e.preventDefault(); document.getElementById('gsearch')?.focus(); } if (e.key === 'Escape') useStore.setState({}); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  return <div id="app">
    {open && <div className="scrim" onClick={() => setOpen(false)} />}
    <aside id="sidebar" className={open ? 'open' : ''}>
      <NavLink className="brand" to="/"><span className="logo">U</span><span>UniHub</span></NavLink>
      <nav id="nav">{NAV.map(([to, ico, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''}>
        <span className="ico">{ico}</span>{label}{label === 'Tasks' && badge > 0 && <span className="badge">{badge}</span>}</NavLink>)}</nav>
      <div className="side-foot"><SyncBadge /></div>
    </aside>
    <div id="content">
      {offline && <div className="offline-banner" role="alert">⚠ Connection to the server lost. {unsaved > 0 ? `${unsaved} recent change${unsaved === 1 ? ' is' : 's are'} not saved yet — keep this tab open, they are sent as soon as you are back online.` : 'Reconnecting…'}</div>}
      <header id="topbar">
        <button className="icon-btn" id="menuBtn" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
        <input id="gsearch" type="search" placeholder="Search everything…  ( / )" autoComplete="off" defaultValue=""
          onChange={e => nav('/search?q=' + encodeURIComponent(e.target.value), { replace: loc.pathname === '/search' })}
          onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
        <StudyTimer />
        <button className="btn primary" onClick={() => openDialog(<QuickMenu />)}>＋ New</button>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/modules" element={<Modules />} /><Route path="/modules/:id" element={<ModuleDetail />} /><Route path="/modules/:id/workspace" element={<Workspace />} />
          <Route path="/calendar" element={<Calendar />} /><Route path="/tasks" element={<Tasks />} />
          <Route path="/documents" element={<Documents />} /><Route path="/documents/:id" element={<DocDetail />} />
          <Route path="/notes" element={<Notes />} /><Route path="/notes/:id" element={<Notes />} />
          <Route path="/glossary" element={<GlossaryList />} /><Route path="/glossary/:id" element={<GlossaryDetail />} /><Route path="/quotes" element={<Quotes />} /><Route path="/knowledge" element={<Knowledge />} /><Route path="/graph" element={<Graph />} />
          <Route path="/study" element={<Study />} /><Route path="/thesis" element={<ThesisList />} /><Route path="/thesis/:id" element={<ThesisDetail />} />
          <Route path="/search" element={<Search />} /><Route path="/settings" element={<Settings />} /><Route path="/reset" element={<ResetPassword />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
    <OcrBanner />
    <DialogHost />
  </div>;
}
export default function App() { return <HashRouter><Gate><Shell /></Gate></HashRouter>; }
