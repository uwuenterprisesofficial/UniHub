import 'fake-indexeddb/auto';

// Node ships an experimental localStorage that conflicts with jsdom; use a plain in-memory one.
const mem = new Map<string, string>();
const storage: Storage = {
  get length() { return mem.size; }, clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null,
  getItem: k => mem.get(k) ?? null, removeItem: k => { mem.delete(k); }, setItem: (k, v) => { mem.set(k, String(v)); },
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
