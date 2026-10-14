import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { vectorDB } from './blobs';
import { useAI, PRESETS } from './ai';
import type { Chunk } from './kb';

/* Semantic (vector) index. Two backends: a small model that runs on this device, or the embeddings endpoint of an
   OpenAI-compatible provider you configured. Vectors are stored in IndexedDB and are never synced. */
export const LOCAL_MODELS = {
  'Xenova/multilingual-e5-small': { label: 'Multilingual (German, English, +90 languages) · ~120 MB download', q: 'query: ', p: 'passage: ' },
  'Xenova/all-MiniLM-L6-v2': { label: 'English only · fast · ~25 MB download', q: '', p: '' },
} as const;
export type LocalModel = keyof typeof LOCAL_MODELS;

interface EmbedCfg { enabled: boolean; backend: 'local' | 'provider'; localModel: LocalModel; providerId: string; providerModel: string }
export const useEmbedCfg = create<EmbedCfg>()(persist(() => ({
  enabled: false, backend: 'local', localModel: 'Xenova/multilingual-e5-small', providerId: '', providerModel: 'text-embedding-3-small',
} as EmbedCfg), { name: 'unihub.embed' }));

export interface VecStatus { state: 'off' | 'idle' | 'loading' | 'indexing' | 'ready' | 'error'; done: number; total: number; pct: number; msg: string; count: number }
export const useVecStatus = create<VecStatus>(() => ({ state: 'off', done: 0, total: 0, pct: 0, msg: '', count: 0 }));
const setStatus = (p: Partial<VecStatus>) => useVecStatus.setState(p);

const modelKey = () => { const c = useEmbedCfg.getState(); return c.backend === 'local' ? 'local:' + c.localModel : `provider:${c.providerId}:${c.providerModel}`; };
export const vecMap = new Map<string, Float32Array>(); // vectors of the current model, by chunk id
let loadedFor = '';

export function hash(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length; }
const normalize = (v: Float32Array) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o; };

/* ---------- local worker ---------- */
let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, { ok: (v: Float32Array[]) => void; err: (e: Error) => void }>();
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') setStatus({ state: 'loading', pct: m.pct, msg: `Downloading model… ${m.pct}%` });
    else if (m.type === 'done') { waiting.get(m.id)?.ok(m.vecs); waiting.delete(m.id); }
    else if (m.type === 'error') { waiting.get(m.id)?.err(new Error(m.message)); waiting.delete(m.id); }
  };
  worker.onerror = e => { waiting.forEach(w => w.err(new Error(e.message || 'Embedding worker failed'))); waiting.clear(); worker = null; };
  return worker;
}
const localEmbed = (texts: string[]) => new Promise<Float32Array[]>((ok, err) => { const id = ++seq; waiting.set(id, { ok, err }); getWorker().postMessage({ id, type: 'embed', model: useEmbedCfg.getState().localModel, texts }); });

/* ---------- provider ---------- */
async function providerEmbed(texts: string[]): Promise<Float32Array[]> {
  const c = useEmbedCfg.getState(), p = useAI.getState().providers.find(x => x.id === c.providerId);
  if (!p || p.kind === 'anthropic') throw new Error('Choose an OpenAI-compatible provider for embeddings (Anthropic has no embeddings endpoint).');
  const base = (p.baseUrl || PRESETS[p.kind].baseUrl).replace(/\/+$/, '');
  if (p.kind === 'gemini') {
    const model = (c.providerModel.startsWith('gemini-embedding') ? c.providerModel : 'gemini-embedding-001').replace(/^models\//, '');
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 100) {
      let r: Response;
      try { r = await fetch(`${base}/v1beta/models/${model}:batchEmbedContents`, { method: 'POST', signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json', 'x-goog-api-key': p.apiKey }, body: JSON.stringify({ requests: texts.slice(i, i + 100).map(t => ({ model: 'models/' + model, content: { parts: [{ text: t }] } })) }) }); }
      catch { throw new Error(`Could not reach ${p.name} for embeddings.`); }
      const d = await r.json().catch(() => null) as { embeddings?: { values: number[] }[]; error?: { message?: string } } | null;
      if (!r.ok || !d?.embeddings) throw new Error(`${p.name}: ${d?.error?.message ?? 'embeddings request failed'} (${r.status})`);
      out.push(...d.embeddings.map(e => normalize(Float32Array.from(e.values))));
    }
    return out;
  }
  let res: Response;
  try { res = await fetch(base + '/embeddings', { method: 'POST', signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json', ...(p.apiKey ? { authorization: 'Bearer ' + p.apiKey } : {}) }, body: JSON.stringify({ model: c.providerModel, input: texts }) }); }
  catch { throw new Error(`Could not reach ${p.name} for embeddings.`); }
  const data = await res.json().catch(() => null) as { data?: { embedding: number[]; index: number }[]; error?: { message?: string } } | null;
  if (!res.ok || !data?.data) throw new Error(`${p.name}: ${data?.error?.message ?? 'embeddings request failed'} (${res.status})`);
  return [...data.data].sort((a, b) => a.index - b.index).map(d => normalize(Float32Array.from(d.embedding)));
}

export async function embedTexts(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
  const c = useEmbedCfg.getState();
  if (c.backend === 'provider') return providerEmbed(texts);
  const m = LOCAL_MODELS[c.localModel], pre = kind === 'query' ? m.q : m.p;
  return localEmbed(texts.map(t => pre + t));
}

/* ---------- index maintenance ---------- */
async function loadCache() {
  const key = modelKey(); if (loadedFor === key) return;
  vecMap.clear(); for (const r of await vectorDB.all()) if (r.m === key) vecMap.set(r.id, r.v);
  loadedFor = key; setStatus({ count: vecMap.size });
}
const textOf = (c: Pick<Chunk, 'title' | 'text'>) => (c.title + '\n' + c.text).slice(0, 1400);
let syncing = false, again: Chunk[] | null = null;

/** Embed new or changed passages and drop vectors of passages that no longer exist. */
export async function syncVectors(chunks: Chunk[]): Promise<void> {
  const cfg = useEmbedCfg.getState();
  if (!cfg.enabled) { setStatus({ state: 'off' }); return; }
  if (syncing) { again = chunks; return; }
  syncing = true;
  try {
    await loadCache(); const key = modelKey();
    const have = new Map<string, string>(); (await vectorDB.all()).forEach(r => { if (r.m === key) have.set(r.id, r.h); });
    const live = new Set(chunks.map(c => c.id));
    const gone = [...have.keys()].filter(id => !live.has(id)); if (gone.length) { await vectorDB.del(gone); gone.forEach(id => vecMap.delete(id)); }
    const todo = chunks.filter(c => have.get(c.id) !== hash(textOf(c)));
    if (!todo.length) { setStatus({ state: 'ready', done: 0, total: 0, count: vecMap.size, msg: '' }); return; }
    setStatus({ state: 'indexing', done: 0, total: todo.length, msg: 'Preparing model…', pct: 0 });
    const B = cfg.backend === 'local' ? 16 : 64;
    for (let i = 0; i < todo.length; i += B) {
      const batch = todo.slice(i, i + B), vecs = await embedTexts(batch.map(textOf), 'passage');
      await vectorDB.put(batch.map((c, j) => ({ id: c.id, h: hash(textOf(c)), m: key, v: vecs[j] })));
      batch.forEach((c, j) => vecMap.set(c.id, vecs[j]));
      setStatus({ state: 'indexing', done: Math.min(i + B, todo.length), total: todo.length, count: vecMap.size, msg: `Indexing ${Math.min(i + B, todo.length)} / ${todo.length}` });
    }
    setStatus({ state: 'ready', msg: '', count: vecMap.size });
  } catch (e) { setStatus({ state: 'error', msg: (e as Error).message }); }
  finally { syncing = false; if (again) { const a = again; again = null; void syncVectors(a); } }
}

export async function clearVectors() { await vectorDB.clear(); vecMap.clear(); loadedFor = ''; setStatus({ count: 0, state: useEmbedCfg.getState().enabled ? 'idle' : 'off' }); }

export const vectorsReady = () => useEmbedCfg.getState().enabled && vecMap.size > 0;

export async function embedQuery(q: string): Promise<Float32Array | null> {
  if (!useEmbedCfg.getState().enabled) return null;
  try { await loadCache(); const [v] = await embedTexts([q], 'query'); return v; } catch (e) { setStatus({ state: 'error', msg: (e as Error).message }); return null; }
}

export function vectorSearch(q: Float32Array, k: number, allow?: (id: string) => boolean): { id: string; score: number }[] {
  const out: { id: string; score: number }[] = [];
  for (const [id, v] of vecMap) {
    if (allow && !allow(id)) continue;
    let s = 0; const n = Math.min(v.length, q.length); for (let i = 0; i < n; i++) s += v[i] * q[i];
    out.push({ id, score: s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}
export const cosine = (a: Float32Array, b: Float32Array) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
