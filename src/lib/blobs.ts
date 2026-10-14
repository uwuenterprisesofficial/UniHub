import Dexie, { type Table } from 'dexie';
import { create } from 'zustand';

class FileDB extends Dexie {
  files!: Table<{ key: string; blob: Blob }, string>;
  texts!: Table<{ id: string; text: string }, string>;
  vectors!: Table<{ id: string; h: string; m: string; v: Float32Array }, string>;
  constructor() {
    super('unihub-files');
    this.version(1).stores({ files: 'key' });
    this.version(2).stores({ files: 'key', texts: 'id' });
    this.version(3).stores({ files: 'key', texts: 'id', vectors: 'id' });
  }
}
const db = new FileDB();

/** Set by the sync engine: fetches a file from the server when it is not stored on this device. */
let remote: ((key: string) => Promise<Blob | undefined>) | null = null;
export const setRemoteFetcher = (f: typeof remote) => { remote = f; };

export const blobs = {
  put: (key: string, blob: Blob) => db.files.put({ key, blob }),
  get: async (key: string) => {
    const local = (await db.files.get(key))?.blob; if (local || !remote) return local;
    const b = await remote(key); if (b) await db.files.put({ key, blob: b });
    return b;
  },
  getLocal: async (key: string) => (await db.files.get(key))?.blob,
  del: (key: string) => db.files.delete(key),
  clear: async () => { await db.files.clear(); await db.texts.clear(); await db.vectors.clear(); useTexts.setState({ map: {} }); },
  keys: () => db.files.toCollection().primaryKeys(),
};

/** Full extracted text per document (kept out of localStorage because it can be large). */
export const useTexts = create<{ map: Record<string, string>; ready: boolean }>(() => ({ map: {}, ready: false }));
export const texts = {
  async load() {
    const all = await db.texts.toArray();
    useTexts.setState({ map: Object.fromEntries(all.map(t => [t.id, t.text])), ready: true });
  },
  async set(id: string, text: string) {
    await db.texts.put({ id, text });
    useTexts.setState(s => ({ map: { ...s.map, [id]: text } }));
  },
  async del(id: string) {
    await db.texts.delete(id);
    useTexts.setState(s => { const m = { ...s.map }; delete m[id]; return { map: m }; });
  },
};
texts.load();

/** Derived embedding vectors (never synced; rebuilt per device). */
export const vectorDB = {
  all: () => db.vectors.toArray(),
  put: (rows: { id: string; h: string; m: string; v: Float32Array }[]) => db.vectors.bulkPut(rows),
  del: (ids: string[]) => db.vectors.bulkDelete(ids),
  clear: () => db.vectors.clear(),
};
