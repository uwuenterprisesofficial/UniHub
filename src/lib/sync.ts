import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { blobs, setRemoteFetcher } from './blobs';
import { COLS, defaultSettings, useStore, wipeLocal } from './store';
import type { Settings } from './types';

export interface AccountUser { id: string; email: string; name: string }
interface SyncState {
  url: string; token: string; user: AccountUser | null;
  cursor: number; pushed: Record<string, number>; uploaded: string[]; syncUserId: string;
  /** true once this session has received the account's data from the server */ ready: boolean;
  /** true while the live connection to the server is open */ live: boolean;
  /** number of local changes the server has not confirmed yet */ pending: number;
  lastSync: number; status: 'idle' | 'syncing' | 'ok' | 'offline' | 'error'; error: string;
}
export const useSync = create<SyncState>()(persist<SyncState>(() => ({
  url: '', token: '', user: null, cursor: 0, pushed: {}, uploaded: [], syncUserId: '', ready: false, live: false, pending: 0, lastSync: 0, status: 'idle', error: '',
}), {
  name: 'unihub.sync',
  // only the sign-in is kept on this device; the workspace itself is loaded from the server on every start
  partialize: s => ({ url: s.url, token: s.token, user: s.user }) as SyncState,
}));

const base = () => (useSync.getState().url.replace(/\/+$/, '') || '') + '/api';
class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function api<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (auth) headers.set('authorization', 'Bearer ' + useSync.getState().token);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  let res: Response;
  try { res = await fetch(base() + path, { ...init, headers }); } catch { throw new ApiError('Cannot reach the server', 0); }
  if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Server error (${res.status})`, res.status);
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.blob()) as Promise<T>;
}

/* ---------- account ---------- */
export async function authenticate(mode: 'login' | 'register', email: string, password: string, name = ''): Promise<AccountUser> {
  const r = await api<{ token: string; user: AccountUser }>('/auth/' + mode, { method: 'POST', body: JSON.stringify({ email, password, name }) }, false);
  const prev = useSync.getState().syncUserId;
  // a different account must start from a clean sync state
  const fresh = prev !== r.user.id ? { cursor: 0, pushed: {}, uploaded: [] } : {};
  useSync.setState({ token: r.token, user: r.user, syncUserId: r.user.id, status: 'idle', error: '', ...fresh });
  return r.user;
}
/** Text of a calendar feed: through the server when signed in (it can read feeds browsers cannot), otherwise directly. */
export async function fetchFeedText(url: string): Promise<string> {
  const direct = url.trim().replace(/^webcals?:/i, 'https:');
  if (useSync.getState().token) {
    const blob = await api<Blob>('/feed?url=' + encodeURIComponent(direct));
    return blob.text();
  }
  try { const r = await fetch(direct); if (!r.ok) throw new Error(`The calendar server answered with an error (${r.status}).`); return await r.text(); }
  catch (e) {
    if (e instanceof TypeError) throw new Error('Your browser is not allowed to read this calendar directly. Sign in under Settings → Account so the server can fetch it for you.');
    throw e;
  }
}
export const serverConfig = () => api<{ passwordResetByEmail: boolean }>('/config', {}, false);
export const requestPasswordReset = (email: string) => api<{ ok: true }>('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }, false);
export const completePasswordReset = (token: string, password: string) => api<{ ok: true }>('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) }, false);
/** Forget everything about the account on this device (the data stays on the server). */
export async function clearDevice() {
  stopStream(); wipeLocal(); await blobs.clear();
  useSync.setState({ token: '', user: null, syncUserId: '', cursor: 0, pushed: {}, uploaded: [], ready: false, live: false, pending: 0, status: 'idle' });
}
export async function signOut() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* token may already be invalid */ }
  await clearDevice(); useSync.setState({ error: '' });
}
export async function deleteAccount(password: string) {
  await api('/me/delete', { method: 'POST', body: JSON.stringify({ password }) });
  await clearDevice();
}

/* ---------- sync engine ---------- */
interface Change { col: string; id: string; u: number; deleted?: boolean; data?: unknown }
let running = false, again = false;

function collectChanges(): Change[] {
  const st = useStore.getState(), pushed = useSync.getState().pushed, out: Change[] = [];
  for (const col of COLS) for (const item of st[col] as { id: string; u?: number }[]) {
    const u = item.u ?? 1;
    if (u > (pushed[`${col}:${item.id}`] ?? 0)) out.push({ col, id: item.id, u, data: item });
  }
  for (const [key, ts] of Object.entries(st.tomb)) {
    if (ts > (pushed[key] ?? 0)) { const [col, id] = key.split(/:(.+)/); out.push({ col, id, u: ts, deleted: true }); }
  }
  const su = st.settings.u ?? 1;
  if (su > (pushed['settings:main'] ?? 0)) out.push({ col: 'settings', id: 'main', u: su, data: st.settings });
  return out;
}

function applyRemote(changes: Change[]) {
  if (!changes.length) return {};
  const pushedPatch: Record<string, number> = {};
  useStore.setState(st => {
    const next: Record<string, unknown> = {}; const tomb = { ...st.tomb }; let settings: Settings | undefined;
    for (const ch of changes) {
      const key = `${ch.col}:${ch.id}`;
      if (ch.col === 'settings') {
        if (ch.u > (st.settings.u ?? 0) && ch.data) { const d = ch.data as Settings, df = defaultSettings(); settings = { ...df, ...d, widgets: { ...df.widgets, ...d.widgets }, u: ch.u }; pushedPatch[key] = ch.u; }
        continue;
      }
      const list = (next[ch.col] ?? (st as unknown as Record<string, unknown[]>)[ch.col]) as { id: string; u?: number }[];
      const idx = list.findIndex(x => x.id === ch.id), local = list[idx];
      if (ch.deleted) {
        if (local && (local.u ?? 0) > ch.u) continue; // local edit is newer than the delete
        if (local) next[ch.col] = list.filter(x => x.id !== ch.id);
        tomb[key] = Math.max(tomb[key] ?? 0, ch.u); pushedPatch[key] = ch.u;
      } else {
        if ((tomb[key] ?? 0) > ch.u) continue; // deleted locally after this version
        if (!local || ch.u > (local.u ?? 0)) {
          next[ch.col] = local ? list.map(x => x.id === ch.id ? (ch.data as typeof x) : x) : [...list, ch.data as { id: string }];
          delete tomb[key]; pushedPatch[key] = ch.u;
        } else if (local.u === ch.u) pushedPatch[key] = ch.u;
      }
    }
    return { ...next, tomb, ...(settings ? { settings } : {}) } as Partial<typeof st>;
  });
  return pushedPatch;
}

async function syncFiles() {
  const s = useSync.getState(); const have = new Set(s.uploaded);
  const keys = useStore.getState().docs.flatMap(d => d.versions.map(v => v.blobKey)).filter(k => !have.has(k));
  if (!keys.length) return;
  const onServer = new Set((await api<{ keys: string[] }>('/files')).keys);
  for (const k of keys) {
    if (!onServer.has(k)) {
      const b = await blobs.getLocal(k); if (!b) continue; // not on this device yet
      await api('/files/' + k, { method: 'PUT', body: b, headers: { 'content-type': 'application/octet-stream' } });
    }
    have.add(k);
  }
  useSync.setState({ uploaded: [...have] });
}

export async function syncNow(): Promise<void> {
  if (!useSync.getState().token) return;
  if (running) { again = true; return; }
  running = true; useSync.setState({ status: 'syncing', error: '' });
  try {
    await syncFiles(); // files go first, so another device never sees a document whose file is missing
    const all = collectChanges();
    const batches: Change[][] = []; for (let i = 0; i < all.length; i += 300) batches.push(all.slice(i, i + 300));
    if (!batches.length) batches.push([]);
    for (const batch of batches) {
      const r = await api<{ cursor: number; changes: Change[] }>('/sync', { method: 'POST', body: JSON.stringify({ cursor: useSync.getState().cursor, changes: batch }) });
      const patch = applyRemote(r.changes);
      const pushed = { ...useSync.getState().pushed, ...patch };
      for (const c of batch) pushed[`${c.col}:${c.id}`] = Math.max(pushed[`${c.col}:${c.id}`] ?? 0, c.u);
      useSync.setState({ cursor: r.cursor, pushed });
    }
    useSync.setState({ status: 'ok', lastSync: Date.now(), ready: true, pending: collectChanges().length });
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) { await clearDevice(); useSync.setState({ status: 'error', error: 'Your session expired — please sign in again' }); }
    else useSync.setState({ status: err.status === 0 ? 'offline' : 'error', error: err.message });
  } finally {
    running = false;
    if (again) { again = false; setTimeout(syncNow, 300); }
  }
}

/* ---------- one-time import of data an older, local-first version left in this browser ---------- */
const LEGACY = 'unihub.v2';
const legacyState = (): Record<string, unknown> | null => { try { return JSON.parse(localStorage.getItem(LEGACY) ?? 'null')?.state ?? null; } catch { return null; } };
export function legacyCount(): number { const s = legacyState(); return s ? COLS.reduce((n, c) => n + (Array.isArray(s[c]) ? (s[c] as unknown[]).length : 0), 0) : 0; }
export function discardLegacy() { try { localStorage.removeItem(LEGACY); } catch { /* ignore */ } }
/** Adds the old local items the account does not have (or has older versions of); returns how many were taken over. */
export function importLegacy(): number {
  const raw = legacyState(); if (!raw) return 0; let n = 0;
  useStore.setState(cur => {
    const next: Record<string, unknown> = {};
    for (const col of COLS) {
      const list = [...(cur[col] as { id: string; u?: number }[])];
      for (const it of (raw[col] as { id: string; u?: number }[] | undefined) ?? []) {
        const u = it.u ?? 1; if ((cur.tomb[`${col}:${it.id}`] ?? 0) >= u) continue;
        const i = list.findIndex(x => x.id === it.id);
        if (i < 0) { list.push({ ...it, u }); n++; } else if ((list[i].u ?? 0) < u) { list[i] = { ...it, u }; n++; }
      }
      next[col] = list;
    }
    const rs = raw.settings as Settings | undefined, df = defaultSettings();
    if (rs && (cur.settings.u ?? 0) <= 1) next.settings = { ...df, ...rs, widgets: { ...df.widgets, ...rs.widgets }, u: Date.now() };
    return next as Partial<typeof cur>;
  });
  discardLegacy(); void syncNow(); return n;
}

let started = false;
export function initSync() {
  if (started) return; started = true;
  setRemoteFetcher(async key => {
    if (!useSync.getState().token) return undefined;
    try { return await api<Blob>('/files/' + key); } catch { return undefined; }
  });
  // every change is sent right away (a short pause only batches keystrokes into one request)
  let t = 0;
  useStore.subscribe(() => {
    if (!useSync.getState().token || !useSync.getState().ready) return;
    const pending = collectChanges().length; if (pending !== useSync.getState().pending) useSync.setState({ pending });
    if (pending && !t) t = window.setTimeout(() => { t = 0; void syncNow(); }, 150);
  });
  // sign-in starts the live connection and loads the workspace; sign-out stops it
  useSync.subscribe((s, p) => { if (s.token && !p.token) { void syncNow(); startStream(); } });
  setInterval(() => { if (!useSync.getState().live || useSync.getState().pending) void syncNow(); }, 20_000); // safety net; the stream normally makes this unnecessary
  for (const ev of ['focus', 'online']) addEventListener(ev, () => { void syncNow(); if (useSync.getState().token && !useSync.getState().live) startStream(); });
  addEventListener('beforeunload', e => { if (useSync.getState().pending > 0) { e.preventDefault(); } }); // unsent changes exist only in this tab
  if (useSync.getState().token) { void syncNow(); startStream(); }
}

/* ---------- live connection: the server tells us the moment another device saves something ---------- */
let stream: AbortController | null = null;
export function stopStream() { stream?.abort(); stream = null; useSync.setState({ live: false }); }
export function startStream() {
  if (stream || !useSync.getState().token || typeof TextDecoderStream === 'undefined') return;
  const ctl = stream = new AbortController();
  void (async () => {
    let delay = 1000;
    while (!ctl.signal.aborted && useSync.getState().token) {
      try {
        const res = await fetch(base() + '/events', { headers: { authorization: 'Bearer ' + useSync.getState().token }, signal: ctl.signal });
        if (!res.ok || !res.body) throw new Error('stream refused');
        useSync.setState({ live: true }); delay = 1000; void syncNow(); // catch up on whatever happened while we were disconnected
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += value; let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); if (/^event: sync/m.test(ev)) void syncNow(); }
        }
      } catch { if (ctl.signal.aborted) return; }
      useSync.setState({ live: false });
      await new Promise(r => setTimeout(r, delay)); delay = Math.min(delay * 2, 15_000);
    }
  })();
}

/** Best-effort removal of an uploaded file (used when a document is deleted). */
export async function deleteRemoteFile(key: string) {
  if (!useSync.getState().token) return;
  try { await api('/files/' + key, { method: 'DELETE' }); useSync.setState(s => ({ uploaded: s.uploaded.filter(k => k !== key) })); } catch { /* server unreachable: file stays orphaned */ }
}
