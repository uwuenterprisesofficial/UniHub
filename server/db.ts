import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DATA_DIR = process.env.UNIHUB_DATA ?? join(process.cwd(), 'server-data');
mkdirSync(join(DATA_DIR, 'files'), { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'unihub.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
    pw_hash TEXT NOT NULL, salt TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL, created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS items (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, col TEXT NOT NULL, id TEXT NOT NULL,
    u INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT 'null', seq INTEGER NOT NULL,
    PRIMARY KEY (user_id, col, id)
  );
  CREATE INDEX IF NOT EXISTS items_seq ON items(user_id, seq);
  CREATE TABLE IF NOT EXISTS files (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );
`);

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const userDir = (uid: string) => join(DATA_DIR, 'files', uid);
export const ensureDir = (p: string) => mkdirSync(dirname(p), { recursive: true });
