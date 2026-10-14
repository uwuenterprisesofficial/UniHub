import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, signOut, syncNow, useSync } from '../src/lib/sync';
import { useStore, wipeLocal } from '../src/lib/store';

const PORT = 18700 + Math.floor(Math.random() * 200), BASE = `http://localhost:${PORT}`;
let proc: ChildProcess, dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'unihub-test-'));
  proc = spawn(process.execPath, ['server/index.ts'], { env: { ...process.env, PORT: String(PORT), UNIHUB_DATA: dir, UNIHUB_REGISTER_LIMIT: '1000', UNIHUB_SYNC_LIMIT: '200000' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)); }
  throw new Error('server did not start');
}, 30_000);
afterAll(() => { proc?.kill(); setTimeout(() => rmSync(dir, { recursive: true, force: true }), 500); });

const post = async (path: string, body: unknown, token = '') => { const r = await fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() as Record<string, any> }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0; const email = () => `user${Date.now()}${++n}@test.io`;
const register = async () => { const e = email(); const r = await post('/auth/register', { email: e, password: 'password123' }); return { email: e, token: r.json.token as string }; };

describe('accounts', () => {
  it('validates credentials and rejects duplicates', async () => {
    expect((await post('/auth/register', { email: 'not-an-email', password: 'password123' })).status).toBe(400);
    expect((await post('/auth/register', { email: email(), password: 'short' })).status).toBe(400);
    const u = await register();
    expect((await post('/auth/register', { email: u.email, password: 'password123' })).status).toBe(409);
    expect((await post('/auth/register', { email: u.email.toUpperCase(), password: 'password123' })).status).toBe(409); // emails are case-insensitive
  });
  it('logs in with the right password only and never stores it in clear', async () => {
    const u = await register();
    expect((await post('/auth/login', { email: u.email, password: 'wrongpass1' })).status).toBe(401);
    expect((await post('/auth/login', { email: 'nobody@test.io', password: 'password123' })).status).toBe(401);
    const ok = await post('/auth/login', { email: u.email, password: 'password123' });
    expect(ok.status).toBe(200); expect(ok.json.token).toBeTruthy(); expect(JSON.stringify(ok.json)).not.toContain('password123');
  });
  it('rate limits repeated failed logins', async () => {
    const u = await register(); let last = 0;
    for (let i = 0; i < 12; i++) last = (await post('/auth/login', { email: u.email, password: 'wrong-' + i + 'xxxx' })).status;
    expect(last).toBe(429);
  });
  it('requires a valid session and ends it on logout', async () => {
    expect((await post('/sync', { cursor: 0, changes: [] })).status).toBe(401);
    expect((await post('/sync', { cursor: 0, changes: [] }, 'bogus-token')).status).toBe(401);
    const u = await register(); expect((await post('/sync', { cursor: 0, changes: [] }, u.token)).status).toBe(200);
    await post('/auth/logout', {}, u.token); expect((await post('/sync', { cursor: 0, changes: [] }, u.token)).status).toBe(401);
  });
  it('deletes the account and its data after the password is confirmed', async () => {
    const u = await register(); await post('/sync', { cursor: 0, changes: [{ col: 'tasks', id: 'a', u: 1, data: { id: 'a' } }] }, u.token);
    expect((await post('/me/delete', { password: 'nope' }, u.token)).status).toBe(403);
    expect((await post('/me/delete', { password: 'password123' }, u.token)).status).toBe(200);
    expect((await post('/auth/login', { email: u.email, password: 'password123' })).status).toBe(401);
  });
});

describe('sync protocol', () => {
  it('rejects malformed requests', async () => {
    const u = await register();
    expect((await post('/sync', { cursor: -1, changes: [] }, u.token)).status).toBe(400);
    expect((await post('/sync', { cursor: 0, changes: [{ col: 'users', id: 'x', u: 1 }] }, u.token)).status).toBe(400); // unknown collection
    expect((await post('/sync', { cursor: 0, changes: [{ col: 'tasks', id: '', u: 1 }] }, u.token)).status).toBe(400);
    expect((await post('/sync', 'not json', u.token)).status).toBe(400);
  });
  it('resolves conflicts per record: the newest edit wins, stale writes are ignored', async () => {
    const u = await register(); const put = (t: number, title: string) => post('/sync', { cursor: 0, changes: [{ col: 'tasks', id: 't1', u: t, data: { id: 't1', title } }] }, u.token);
    await put(100, 'first'); await put(300, 'newest'); const r = await put(200, 'stale');
    expect(r.json.changes.find((c: any) => c.id === 't1').data.title).toBe('newest'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('only returns changes after the cursor and keeps tombstones', async () => {
    const u = await register();
    const a = await post('/sync', { cursor: 0, changes: [{ col: 'notes', id: 'n1', u: 10, data: { id: 'n1' } }, { col: 'notes', id: 'n2', u: 10, data: { id: 'n2' } }] }, u.token);
    expect(a.json.changes).toHaveLength(2);
    const none = await post('/sync', { cursor: a.json.cursor, changes: [] }, u.token); expect(none.json.changes).toEqual([]);
    const del = await post('/sync', { cursor: a.json.cursor, changes: [{ col: 'notes', id: 'n1', u: 20, deleted: true }] }, u.token);
    expect(del.json.changes).toEqual([expect.objectContaining({ id: 'n1', deleted: true })]);
    const fresh = await post('/sync', { cursor: 0, changes: [] }, u.token); expect(fresh.json.changes.find((c: any) => c.id === 'n1').deleted).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('keeps every account’s data separate', async () => {
    const a = await register(), b = await register();
    await post('/sync', { cursor: 0, changes: [{ col: 'tasks', id: 'secret', u: 1, data: { id: 'secret' } }] }, a.token);
    expect((await post('/sync', { cursor: 0, changes: [] }, b.token)).json.changes).toEqual([]);
  });
});

describe('files', () => {
  const file = (token: string, key: string, init: RequestInit = {}) => fetch(`${BASE}/api/files/${key}`, { ...init, headers: { authorization: 'Bearer ' + token } });
  it('stores, serves and deletes files per user and blocks unsafe keys', async () => {
    const a = await register(), b = await register();
    expect((await file(a.token, 'abc123', { method: 'PUT', body: 'hello' })).status).toBe(200);
    expect(await (await file(a.token, 'abc123')).text()).toBe('hello');
    expect((await file(b.token, 'abc123')).status).toBe(404);
    for (const bad of ['..%2Fsecret', '%2e%2e', 'a', 'x'.repeat(60), 'bad.key']) expect((await file(a.token, bad)).status).toBeGreaterThanOrEqual(400);
    expect((await file(a.token, 'abc123', { method: 'DELETE' })).status).toBe(200); expect((await file(a.token, 'abc123')).status).toBe(404);
    expect((await fetch(`${BASE}/api/files/abc123`)).status).toBe(401);
  });
});

/* The real client engine against the real server, with two "devices" taking turns on the same store. */
describe('client sync engine', () => {
  const snapshot = () => ({ store: JSON.parse(JSON.stringify(useStore.getState(), (k, v) => typeof v === 'function' ? undefined : v)), sync: JSON.parse(JSON.stringify(useSync.getState(), (k, v) => typeof v === 'function' ? undefined : v)) });
  const restore = (s: ReturnType<typeof snapshot>) => { useStore.setState({ ...s.store }); useSync.setState({ ...s.sync }); };
  const task = (title: string) => ({ title, desc: '', moduleId: '', type: 'Homework', due: '', start: '', priority: 2 as const, status: 'Not started', estimate: 0, spent: 0, subtasks: [], docIds: [], noteIds: [], link: '' });

  it('propagates adds, edits and deletes between two devices', async () => {
    useSync.setState({ url: BASE }); wipeLocal();
    const e = email();
    // device A creates the account and some data
    await authenticate('register', e, 'password123');
    const t1 = useStore.getState().add('tasks', task('from A')), n1 = useStore.getState().add('notes', { title: 'note', body: 'x', moduleId: '', tags: [], pinned: false, updated: 1 });
    await syncNow(); expect(useSync.getState().status).toBe('ok');
    const A = snapshot();

    // device B signs in fresh and receives everything
    wipeLocal(); useSync.setState({ cursor: 0, pushed: {}, uploaded: [], syncUserId: '' }); await authenticate('login', e, 'password123'); await syncNow();
    expect(useStore.getState().tasks.map(t => t.title)).toEqual(['from A']); expect(useStore.getState().notes).toHaveLength(1);
    // B edits the task, deletes the note, adds another task
    useStore.getState().update('tasks', t1.id, { title: 'edited on B' }); useStore.getState().remove('notes', n1.id); useStore.getState().add('tasks', task('from B'));
    await syncNow(); const B = snapshot();

    // back on A: B's changes arrive; the deletion removes the note
    restore(A); await syncNow();
    expect(useStore.getState().tasks.map(t => t.title).sort()).toEqual(['edited on B', 'from B']); expect(useStore.getState().notes).toHaveLength(0);

    // concurrent edits: the later one wins on both devices
    await new Promise(r => setTimeout(r, 5)); useStore.getState().update('tasks', t1.id, { title: 'A wins' }); await syncNow();
    restore(B); await syncNow(); expect(useStore.getState().tasks.find(t => t.id === t1.id)!.title).toBe('A wins');
    // a deleted item must not come back when an old device syncs
    useStore.getState().remove('tasks', t1.id); await syncNow(); restore(A); await syncNow(); expect(useStore.getState().tasks.some(t => t.id === t1.id)).toBe(false);
    await signOut(); expect(useSync.getState().token).toBe('');
  });
});

/* ---------- password reset ---------- */
async function startServer(env: Record<string, string>) {
  const port = 18900 + Math.floor(Math.random() * 90), logs: string[] = [];
  const p = spawn(process.execPath, ['server/index.ts'], { env: { ...process.env, PORT: String(port), UNIHUB_DATA: mkdtempSync(join(tmpdir(), 'unihub-reset-')), UNIHUB_REGISTER_LIMIT: '1000', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout!.on('data', d => logs.push(String(d))); p.stderr!.on('data', d => logs.push(String(d)));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 250)); }
  const call = async (path: string, body: unknown, token = '') => { const r = await fetch(base + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() as Record<string, any> }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const link = async (email: string) => { for (let i = 0; i < 40; i++) { const m = logs.join('').split(`Reset link for ${email}: `).pop()?.match(/token=([\w-]+)/); if (m && logs.join('').includes(`Reset link for ${email}`)) return m[1]; await new Promise(r => setTimeout(r, 100)); } return ''; };
  return { base, call, logs, link, stop: () => p.kill() };
}

describe('password reset without SMTP (link goes to the server log)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => { s = await startServer({ UNIHUB_RESET_MINUTES: '60' }); }, 30_000);
  afterAll(() => s?.stop());
  const account = async () => { const e = email(); const r = await s.call('/auth/register', { email: e, password: 'password123' }); return { email: e, token: r.json.token as string }; };

  it('announces that email is not configured', async () => { expect((await (await fetch(s.base + '/api/config')).json()).passwordResetByEmail).toBe(false); });
  it('answers identically for unknown and known emails, so accounts cannot be probed', async () => {
    const u = await account();
    const a = await s.call('/auth/forgot', { email: 'nobody@nowhere.io' }), b = await s.call('/auth/forgot', { email: u.email });
    expect(a).toEqual(b); expect(a.status).toBe(200);
    expect(s.logs.join('')).not.toContain('nobody@nowhere.io');
  });
  it('lets the owner choose a new password with the link, once, and signs out all sessions', async () => {
    const u = await account(); expect((await s.call('/sync', { cursor: 0, changes: [] }, u.token)).status).toBe(200);
    await s.call('/auth/forgot', { email: u.email }); const token = await s.link(u.email); expect(token.length).toBeGreaterThan(20);
    expect((await s.call('/auth/reset', { token, password: 'short' })).status).toBe(400); // a rejected weak password must not use up the link
    expect((await s.call('/auth/login', { email: u.email, password: 'password123' })).status).toBe(200); // and must not change anything
    expect((await s.call('/auth/reset', { token, password: 'brand-new-pass' })).status).toBe(200);
    expect((await s.call('/auth/login', { email: u.email, password: 'password123' })).status).toBe(401);
    expect((await s.call('/auth/login', { email: u.email, password: 'brand-new-pass' })).status).toBe(200);
    expect((await s.call('/sync', { cursor: 0, changes: [] }, u.token)).status).toBe(401); // old session revoked
    expect((await s.call('/auth/reset', { token, password: 'another-pass-1' })).status).toBe(400); // single use
  });
  it('rejects garbage tokens and limits how often a link can be requested', async () => {
    expect((await s.call('/auth/reset', { token: 'x'.repeat(43), password: 'password123' })).status).toBe(400);
    expect((await s.call('/auth/reset', { token: 'short', password: 'password123' })).status).toBe(400);
    const u = await account(); let last = 0; for (let i = 0; i < 5; i++) last = (await s.call('/auth/forgot', { email: u.email })).status;
    expect(last).toBe(429);
  });
  it('invalidates the older link when a new one is requested', async () => {
    const u = await account(); await s.call('/auth/forgot', { email: u.email }); const first = await s.link(u.email);
    s.logs.length = 0; await s.call('/auth/forgot', { email: u.email }); const second = await s.link(u.email);
    expect(second).not.toBe(first); expect((await s.call('/auth/reset', { token: first, password: 'password456' })).status).toBe(400);
    expect((await s.call('/auth/reset', { token: second, password: 'password456' })).status).toBe(200);
  });
});

describe('password reset links expire', () => {
  it('rejects a link after its lifetime', async () => {
    const s = await startServer({ UNIHUB_RESET_MINUTES: '0.01' }); // ~600 ms
    try {
      const e = email(); await s.call('/auth/register', { email: e, password: 'password123' });
      await s.call('/auth/forgot', { email: e }); const t = await s.link(e); await new Promise(r => setTimeout(r, 900));
      expect((await s.call('/auth/reset', { token: t, password: 'password456' })).status).toBe(400);
    } finally { s.stop(); }
  });
});

describe('password reset by email (real SMTP delivery)', () => {
  it('sends the link through the configured SMTP server', async () => {
    const received: string[] = [];
    const smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS', 'AUTH'], onData(stream, _s, cb) { let b = ''; stream.on('data', c => { b += c; }); stream.on('end', () => { received.push(b); cb(); }); } });
    await new Promise<void>(r => smtp.listen(0, '127.0.0.1', r)); const smtpPort = (smtp.server.address() as { port: number }).port;
    const s = await startServer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort), SMTP_FROM: 'UniHub <hello@unihub.test>', PUBLIC_URL: 'https://unihub.example.org' });
    try {
      expect((await (await fetch(s.base + '/api/config')).json()).passwordResetByEmail).toBe(true);
      const e = email(); await s.call('/auth/register', { email: e, password: 'password123', name: 'Ada' });
      expect((await s.call('/auth/forgot', { email: e })).status).toBe(200);
      for (let i = 0; i < 50 && !received.length; i++) await new Promise(r => setTimeout(r, 100));
      expect(received).toHaveLength(1);
      const raw = received[0].replace(/=\r?\n/g, '').replace(/=3D/g, '='); // undo quoted-printable
      expect(raw).toMatch(/Subject: Reset your UniHub password/i); expect(raw).toContain('hello@unihub.test'); expect(raw).toContain('Hello Ada');
      const token = raw.match(/https:\/\/unihub\.example\.org\/#\/reset\?token=([\w-]+)/)?.[1]; expect(token).toBeTruthy();
      expect(s.logs.join('')).not.toContain(token!); // the secret is not also written to the log
      expect((await s.call('/auth/reset', { token: token!, password: 'password789' })).status).toBe(200);
      expect((await s.call('/auth/login', { email: e, password: 'password789' })).status).toBe(200);
    } finally { s.stop(); smtp.close(); }
  }, 30_000);
});

describe('calendar feed endpoint', () => {
  const ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:z1', 'SUMMARY:Timetable lecture', 'DTSTART:20260302T100000', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  it('needs a session and refuses private addresses by default', async () => {
    expect((await fetch(`${BASE}/api/feed?url=${encodeURIComponent('https://example.com/c.ics')}`)).status).toBe(401);
    const u = await register(); const get = (url: string) => fetch(`${BASE}/api/feed?url=${encodeURIComponent(url)}`, { headers: { authorization: 'Bearer ' + u.token } });
    expect((await get('http://127.0.0.1:80/c.ics')).status).toBe(400); expect((await get('http://169.254.169.254/latest/meta-data/')).status).toBe(400);
    expect((await get('file:///etc/passwd')).status).toBe(400); expect((await fetch(`${BASE}/api/feed`, { headers: { authorization: 'Bearer ' + u.token } })).status).toBe(400);
    const body = await (await get('http://localhost/x')).json(); expect(body.error).toMatch(/not allowed|private/i); expect(JSON.stringify(body)).not.toMatch(/ECONN|127\.0\.0\.1:/);
  });
  it('lets the app subscribe to a feed through the server when private feeds are allowed', async () => {
    const http = await import('node:http');
    const cal = http.createServer((_q, r) => { r.setHeader('content-type', 'text/calendar'); r.end(ICS); }); await new Promise<void>(r => cal.listen(0, '127.0.0.1', r));
    const calUrl = `http://127.0.0.1:${(cal.address() as { port: number }).port}/c.ics`;
    const s = await startServer({ UNIHUB_ALLOW_PRIVATE_FEEDS: '1' });
    try {
      const reg = await s.call('/auth/register', { email: email(), password: 'password123' });
      const r = await fetch(`${s.base}/api/feed?url=${encodeURIComponent(calUrl)}`, { headers: { authorization: 'Bearer ' + reg.json.token } });
      expect(r.status).toBe(200); expect(r.headers.get('content-type')).toContain('text/calendar'); expect(await r.text()).toBe(ICS);
      // the same call made by the client code
      useSync.setState({ url: s.base, token: reg.json.token as string });
      const { fetchFeedText } = await import('../src/lib/sync'); expect(await fetchFeedText(calUrl)).toBe(ICS);
      useSync.setState({ url: BASE, token: '' });
    } finally { s.stop(); cal.close(); }
  }, 30_000);
});

// last on purpose: the server closes the connection after refusing a large body, which would break a pooled keep-alive socket
describe('limits', () => {
  it('refuses oversized request bodies with 413', async () => {
    const u = await register();
    const big = { cursor: 0, changes: [{ col: 'notes', id: 'big', u: 1, data: { body: 'x'.repeat(300_000) } }] };
    expect((await post('/sync', big, u.token)).status).toBe(413);
    expect((await post('/auth/login', { email: 'a@b.co', password: 'x'.repeat(40_000) })).status).toBe(413);
  });
});

describe('live updates', () => {
  /** Opens the event stream like the app does and collects event names. */
  async function listen(token: string) {
    const ctl = new AbortController(), events: string[] = [];
    const res = await fetch(BASE + '/api/events', { headers: { authorization: 'Bearer ' + token }, signal: ctl.signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    void (async () => { let buf = ''; try { for (;;) { const { value, done } = await reader.read(); if (done) return; buf += value; let i; while ((i = buf.indexOf('\n\n')) >= 0) { events.push((buf.slice(0, i).match(/^event: (\w+)/m) ?? [])[1] ?? ''); buf = buf.slice(i + 2); } } } catch { /* closed */ } })();
    const until = async (pred: () => boolean) => { for (let i = 0; i < 40 && !pred(); i++) await new Promise(r => setTimeout(r, 50)); return pred(); };
    return { res, events, until, close: () => ctl.abort() };
  }
  const item = (id: string, u = 1) => ({ col: 'tasks', id, u, data: { id } });

  it('requires a session', async () => {
    await fetch(BASE + '/api/health').catch(() => { }); // the previous test's oversized upload leaves a closed keep-alive socket in the pool
    expect((await fetch(BASE + '/api/events')).status).toBe(401);
  });
  it('tells every open device the moment another one saves', async () => {
    const u = await register(); const a = await listen(u.token), b = await listen(u.token);
    expect(a.res.headers.get('content-type')).toContain('text/event-stream'); expect(await a.until(() => a.events.includes('hello'))).toBe(true);
    await post('/sync', { cursor: 0, changes: [item('t1')] }, u.token);
    expect(await a.until(() => a.events.includes('sync'))).toBe(true); expect(await b.until(() => b.events.includes('sync'))).toBe(true);
    a.close(); b.close();
  });
  it('stays quiet for reads, for rejected stale writes and for other accounts', async () => {
    const u = await register(), other = await register(); await post('/sync', { cursor: 0, changes: [item('t1', 5)] }, u.token);
    const l = await listen(u.token); await l.until(() => l.events.includes('hello'));
    await post('/sync', { cursor: 0, changes: [] }, u.token);          // a pull
    await post('/sync', { cursor: 0, changes: [item('t1', 2)] }, u.token); // older than what the server has → ignored
    await post('/sync', { cursor: 0, changes: [item('x')] }, other.token);   // somebody else's data
    await new Promise(r => setTimeout(r, 300)); expect(l.events.filter(e => e === 'sync')).toHaveLength(0);
    await post('/sync', { cursor: 0, changes: [item('t1', 9)] }, u.token); expect(await l.until(() => l.events.includes('sync'))).toBe(true);
    l.close();
  });
});
