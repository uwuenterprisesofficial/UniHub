import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { db } from './db.ts';

const DAY = 864e5, SESSION_DAYS = 30;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface User { id: string; email: string; name: string }
export const hashPw = (pw: string, salt: string) => scryptSync(pw, salt, 64, { N: 16384 }).toString('hex');

export function createUser(email: string, password: string, name: string): User {
  const id = randomUUID(), salt = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users (id,email,name,pw_hash,salt,created) VALUES (?,?,?,?,?,?)').run(id, email, name, hashPw(password, salt), salt, Date.now());
  return { id, email, name };
}
export function verifyUser(email: string, password: string): User | null {
  const r = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as { id: string; email: string; name: string; pw_hash: string; salt: string } | undefined;
  // always hash, so timing does not reveal whether the account exists
  const h = Buffer.from(hashPw(password, r?.salt ?? 'x'.repeat(32)), 'hex');
  if (!r) return null;
  return timingSafeEqual(h, Buffer.from(r.pw_hash, 'hex')) ? { id: r.id, email: r.email, name: r.name } : null;
}
export function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires,created) VALUES (?,?,?,?)').run(sha(token), userId, Date.now() + SESSION_DAYS * DAY, Date.now());
  return token;
}
/** Expired sessions and reset tokens are useless; remove them so the tables do not grow forever. */
export const purgeExpiredSessions = () => { db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()); db.prepare('DELETE FROM password_resets WHERE expires < ?').run(Date.now()); };

/* ---- password reset: single-use, one hour, only the hash of the token is stored ---- */
const RESET_MINUTES = Number(process.env.UNIHUB_RESET_MINUTES ?? 60);
export function findUserByEmail(email: string): User | null {
  return (db.prepare('SELECT id,email,name FROM users WHERE email = ?').get(email) as User | undefined) ?? null;
}
export function createResetToken(userId: string): string {
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId); // a new request invalidates older links
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO password_resets (token_hash,user_id,expires) VALUES (?,?,?)').run(sha(token), userId, Date.now() + RESET_MINUTES * 60_000);
  return token;
}
/** Sets a new password if the token is valid, then burns the token and signs the account out everywhere. */
export function resetPassword(token: string, password: string): boolean {
  const row = db.prepare('SELECT user_id, expires FROM password_resets WHERE token_hash = ?').get(sha(token)) as { user_id: string; expires: number } | undefined;
  db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(sha(token));
  if (!row || row.expires < Date.now()) return false;
  const salt = randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET pw_hash = ?, salt = ? WHERE id = ?').run(hashPw(password, salt), salt, row.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  return true;
}
export const destroySession = (token: string) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));

export type Env = { Variables: { user: User; token: string } };
export async function requireAuth(c: Context<Env>, next: Next) {
  const m = (c.req.header('authorization') ?? '').match(/^Bearer (.+)$/);
  if (!m) return c.json({ error: 'Not signed in' }, 401);
  const row = db.prepare('SELECT u.id,u.email,u.name,s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha(m[1])) as (User & { expires: number }) | undefined;
  if (!row || row.expires < Date.now()) return c.json({ error: 'Session expired' }, 401);
  c.set('user', { id: row.id, email: row.email, name: row.name }); c.set('token', m[1]);
  await next();
}

/** Tiny in-memory limiter for auth endpoints. */
const hits = new Map<string, { n: number; t: number }>();
export function limited(key: string, max = 8, windowMs = 10 * 60_000) {
  const now = Date.now(), h = hits.get(key);
  if (!h || now - h.t > windowMs) { hits.set(key, { n: 1, t: now }); return false; }
  return ++h.n > max;
}
