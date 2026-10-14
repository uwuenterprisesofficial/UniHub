import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { existsSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, ensureDir, tx, userDir } from './db.ts';
import { FeedError, fetchFeed } from './feed.ts';
import { mailConfigured, publicUrl, sendMail } from './mail.ts';
import { createResetToken, createSession, createUser, destroySession, findUserByEmail, limited, purgeExpiredSessions, requireAuth, resetPassword, verifyUser, type Env } from './auth.ts';

const app = new Hono<Env>();
app.use('/api/*', cors({ origin: '*', allowHeaders: ['authorization', 'content-type'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
// reject oversized bodies before they are read into memory
const tooBig = (c: { json: (b: unknown, s: 413) => Response }) => c.json({ error: 'Request too large' }, 413);
app.use('/api/auth/*', bodyLimit({ maxSize: 16 * 1024, onError: tooBig }));
app.use('/api/me/*', bodyLimit({ maxSize: 16 * 1024, onError: tooBig }));
app.use('/api/sync', bodyLimit({ maxSize: Number(process.env.UNIHUB_SYNC_LIMIT ?? 25 * 1024 * 1024), onError: tooBig }));
app.use('/api/files/*', bodyLimit({ maxSize: 100 * 1024 * 1024, onError: tooBig }));
app.onError((e, c) => { console.error(e); return c.json({ error: 'Server error' }, 500); });
app.get('/api/health', c => c.json({ ok: true }));

/* ---------- auth ---------- */
const creds = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(8).max(200), name: z.string().trim().max(100).optional() });
const REGISTER_LIMIT = Number(process.env.UNIHUB_REGISTER_LIMIT ?? 10); // new accounts per address per 10 minutes
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header('x-forwarded-for') ?? 'local';

app.post('/api/auth/register', async c => {
  const p = creds.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Enter a valid email and a password of at least 8 characters' }, 400);
  if (limited('reg:' + ip(c), REGISTER_LIMIT)) return c.json({ error: 'Too many attempts, try again later' }, 429);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(p.data.email)) return c.json({ error: 'An account with this email already exists' }, 409);
  const user = createUser(p.data.email, p.data.password, p.data.name ?? '');
  return c.json({ token: createSession(user.id), user });
});
app.post('/api/auth/login', async c => {
  const p = creds.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Invalid email or password' }, 400);
  if (limited(`login:${ip(c)}:${p.data.email}`)) return c.json({ error: 'Too many attempts, try again in a few minutes' }, 429);
  const user = verifyUser(p.data.email, p.data.password);
  if (!user) return c.json({ error: 'Invalid email or password' }, 401);
  return c.json({ token: createSession(user.id), user });
});
// calendar subscriptions: the server fetches the feed (browsers cannot because of CORS); signed-in users only, never an open proxy
app.get('/api/feed', requireAuth, async c => {
  const p = z.string().min(8).max(2000).safeParse(c.req.query('url'));
  if (!p.success) return c.json({ error: 'Missing calendar link' }, 400);
  if (limited('feed:' + c.get('user').id, 60, 10 * 60_000)) return c.json({ error: 'Too many calendar refreshes, try again in a few minutes' }, 429);
  try { return c.body(await fetchFeed(p.data), 200, { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' }); }
  catch (e) { const fe = e instanceof FeedError ? e : new FeedError('Could not load the calendar.', 502); return c.json({ error: fe.message }, fe.status as 400); }
});
app.get('/api/config', c => c.json({ passwordResetByEmail: mailConfigured() }));

// Always answers the same way, so it cannot be used to find out which emails have an account.
app.post('/api/auth/forgot', async c => {
  const p = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).safeParse(await c.req.json().catch(() => null));
  const reply = () => c.json({ ok: true });
  if (!p.success) return reply();
  if (limited('forgot-ip:' + ip(c), 20, 60 * 60_000) || limited('forgot:' + p.data.email, 3, 60 * 60_000)) return c.json({ error: 'Too many requests, try again later' }, 429);
  const user = findUserByEmail(p.data.email);
  if (user) {
    const link = `${publicUrl()}/#/reset?token=${createResetToken(user.id)}`;
    const body = `Hello${user.name ? ' ' + user.name : ''},\n\nsomeone asked to reset the password of your UniHub account. If that was you, open this link within one hour:\n\n${link}\n\nIf it was not you, ignore this email: your password stays unchanged.\n`;
    if (mailConfigured()) sendMail(user.email, 'Reset your UniHub password', body).catch(e => console.error('Could not send reset mail:', (e as Error).message));
    else console.log(`[password reset] SMTP is not configured. Reset link for ${user.email}: ${link}`);
  }
  return reply();
});
app.post('/api/auth/reset', async c => {
  const p = z.object({ token: z.string().min(20).max(100), password: z.string().min(8).max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Choose a password of at least 8 characters' }, 400);
  if (limited('reset-ip:' + ip(c), 30, 60 * 60_000)) return c.json({ error: 'Too many attempts, try again later' }, 429);
  if (!resetPassword(p.data.token, p.data.password)) return c.json({ error: 'This reset link is invalid or has expired. Request a new one.' }, 400);
  return c.json({ ok: true });
});
app.post('/api/auth/logout', requireAuth, c => { destroySession(c.get('token')); return c.json({ ok: true }); });
app.get('/api/me', requireAuth, c => c.json({ user: c.get('user') }));
app.post('/api/me/delete', requireAuth, async c => {
  const p = z.object({ password: z.string() }).safeParse(await c.req.json().catch(() => null));
  const u = c.get('user');
  if (!p.success || !verifyUser(u.email, p.data.password)) return c.json({ error: 'Password is incorrect' }, 403);
  tx(() => db.prepare('DELETE FROM users WHERE id = ?').run(u.id)); // cascades to sessions, items, files
  rmSync(userDir(u.id), { recursive: true, force: true });
  return c.json({ ok: true });
});

/* ---------- sync ---------- */
const COLS = ['modules', 'events', 'tasks', 'notes', 'docs', 'flashcards', 'projects', 'refs', 'annotations', 'terms', 'quotes', 'sessions', 'settings'] as const;
const change = z.object({ col: z.enum(COLS), id: z.string().min(1).max(64), u: z.number().int().nonnegative(), deleted: z.boolean().optional(), data: z.unknown().optional() });
const syncBody = z.object({ cursor: z.number().int().nonnegative(), changes: z.array(change).max(5000) });

// Live updates: every open device of an account holds one event stream and is told when another device saved something.
const listeners = new Map<string, Set<(seq: number) => void>>();
const notify = (uid: string, seq: number) => listeners.get(uid)?.forEach(f => f(seq));
app.get('/api/events', requireAuth, c => {
  const uid = c.get('user').id; c.header('x-accel-buffering', 'no'); c.header('cache-control', 'no-store');
  return streamSSE(c, async stream => {
    const send = (seq: number) => { void stream.writeSSE({ event: 'sync', data: String(seq) }).catch(() => { }); };
    const set = listeners.get(uid) ?? new Set(); listeners.set(uid, set); set.add(send);
    stream.onAbort(() => { set.delete(send); if (!set.size) listeners.delete(uid); });
    await stream.writeSSE({ event: 'hello', data: 'ok' });
    while (!stream.aborted) { await stream.sleep(20_000); if (stream.aborted) break; await stream.writeSSE({ event: 'ping', data: '1' }).catch(() => { }); }
  });
});

app.post('/api/sync', requireAuth, async c => {
  const p = syncBody.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Bad sync request' }, 400);
  const uid = c.get('user').id;
  const out = tx(() => {
    let seq = (db.prepare('SELECT seq FROM users WHERE id = ?').get(uid) as { seq: number }).seq;
    const get = db.prepare('SELECT u FROM items WHERE user_id=? AND col=? AND id=?');
    const up = db.prepare(`INSERT INTO items (user_id,col,id,u,deleted,data,seq) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id,col,id) DO UPDATE SET u=excluded.u, deleted=excluded.deleted, data=excluded.data, seq=excluded.seq`);
    let wrote = 0;
    for (const ch of p.data.changes) {
      const ex = get.get(uid, ch.col, ch.id) as { u: number } | undefined;
      if (ex && ex.u >= ch.u) continue; // last write wins
      up.run(uid, ch.col, ch.id, ch.u, ch.deleted ? 1 : 0, ch.deleted ? 'null' : JSON.stringify(ch.data ?? null), ++seq); wrote++;
    }
    db.prepare('UPDATE users SET seq = ? WHERE id = ?').run(seq, uid);
    const rows = db.prepare('SELECT col,id,u,deleted,data FROM items WHERE user_id=? AND seq>? ORDER BY seq').all(uid, p.data.cursor) as { col: string; id: string; u: number; deleted: number; data: string }[];
    return { cursor: seq, wrote, changes: rows.map(r => ({ col: r.col, id: r.id, u: r.u, deleted: !!r.deleted, data: JSON.parse(r.data) })) };
  });
  if (out.wrote) notify(uid, out.cursor);
  return c.json({ cursor: out.cursor, changes: out.changes });
});

/* ---------- files ---------- */
const MAX_FILE = 100 * 1024 * 1024;
const keyOk = (k: string) => /^[a-z0-9]{4,40}$/i.test(k);
const filePath = (uid: string, k: string) => join(userDir(uid), k);

app.get('/api/files', requireAuth, c => c.json({ keys: (db.prepare('SELECT key FROM files WHERE user_id = ?').all(c.get('user').id) as { key: string }[]).map(r => r.key) }));
app.put('/api/files/:key', requireAuth, async c => {
  const key = c.req.param('key') ?? ''; if (!keyOk(key)) return c.json({ error: 'Bad key' }, 400);
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > MAX_FILE) return c.json({ error: 'File too large (100 MB max)' }, 413);
  const uid = c.get('user').id, p = filePath(uid, key);
  ensureDir(p); writeFileSync(p, buf);
  db.prepare('INSERT OR REPLACE INTO files (user_id,key,size,created) VALUES (?,?,?,?)').run(uid, key, buf.length, Date.now());
  return c.json({ ok: true });
});
app.get('/api/files/:key', requireAuth, c => {
  const key = c.req.param('key') ?? ''; if (!keyOk(key)) return c.json({ error: 'Bad key' }, 400);
  const p = filePath(c.get('user').id, key);
  if (!existsSync(p)) return c.json({ error: 'Not found' }, 404);
  return new Response(readFileSync(p), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(statSync(p).size) } });
});
app.delete('/api/files/:key', requireAuth, c => {
  const key = c.req.param('key') ?? ''; if (!keyOk(key)) return c.json({ error: 'Bad key' }, 400);
  const uid = c.get('user').id, p = filePath(uid, key);
  if (existsSync(p)) unlinkSync(p);
  db.prepare('DELETE FROM files WHERE user_id=? AND key=?').run(uid, key);
  return c.json({ ok: true });
});

/* ---------- serve the built web app (production) ---------- */
if (existsSync('dist')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

purgeExpiredSessions(); setInterval(purgeExpiredSessions, 6 * 3600 * 1000).unref();

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, i => console.log(`UniHub API listening on http://localhost:${i.port}`));
