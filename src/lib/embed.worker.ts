/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';

// Runtime files are served from /ort; model weights come from the Hugging Face hub once and are cached by the browser.
env.allowLocalModels = false;
env.useBrowserCache = true;
const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env.backends.onnx.wasm as any).wasmPaths = { mjs: base + 'ort/ort-wasm-simd-threaded.mjs', wasm: base + 'ort/ort-wasm-simd-threaded.wasm' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env.backends.onnx.wasm as any).numThreads = 1; // cross-origin isolation is not available, so a single thread

let extractor: any = null, loaded = ''; // eslint-disable-line @typescript-eslint/no-explicit-any
const files = new Map<string, { loaded: number; total: number }>();

self.onmessage = async (e: MessageEvent<{ id: number; type: 'embed'; model: string; texts: string[] }>) => {
  const { id, model, texts } = e.data;
  try {
    if (!extractor || loaded !== model) {
      files.clear();
      extractor = await pipeline('feature-extraction', model, {
        dtype: 'q8', device: 'wasm',
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === 'progress' && p.file) {
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
            let l = 0, t = 0; files.forEach(v => { l += v.loaded; t += v.total; });
            self.postMessage({ type: 'progress', pct: t ? Math.round((l / t) * 100) : 0 });
          }
        },
      });
      loaded = model;
    }
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    const dim = out.dims[1] as number, data = out.data as Float32Array;
    const vecs: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) vecs.push(data.slice(i * dim, (i + 1) * dim));
    (self as unknown as Worker).postMessage({ id, type: 'done', vecs }, vecs.map(v => v.buffer));
  } catch (err) {
    self.postMessage({ id, type: 'error', message: (err as Error).message ?? String(err) });
  }
};
