import { create } from 'zustand';
import { createWorker, type Worker } from 'tesseract.js';

/** On-device OCR (Tesseract compiled to WebAssembly). Engine and language data are served from /ocr, nothing is uploaded. */
export const OCR_LANGS: Record<string, string> = { eng: 'English', deu: 'German', fra: 'French', spa: 'Spanish' };
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
export const isImageExt = (e: string) => IMAGE_EXT.includes(e);

export const useOcr = create<{ job: { label: string; pct: number } | null }>(() => ({ job: null }));

const abs = (p: string) => new URL(import.meta.env.BASE_URL + p, location.origin).href; // workers need absolute URLs
let worker: Worker | null = null, workerLangs = '', pending = 0;
let chain: Promise<unknown> = Promise.resolve();
let label = '';

async function getWorker(langs: string): Promise<Worker> {
  if (worker && workerLangs === langs) return worker;
  if (worker) { await worker.terminate(); worker = null; }
  const simd = typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  worker = await createWorker(langs.split('+'), 1, {
    workerPath: abs('ocr/worker.min.js'), corePath: abs(simd ? 'ocr/core.wasm.js' : 'ocr/core-nosimd.wasm.js'), langPath: abs('ocr'),
    gzip: true, cacheMethod: 'none',
    logger: m => { if (m.status === 'recognizing text') useOcr.setState({ job: { label, pct: Math.round(m.progress * 100) } }); },
  });
  workerLangs = langs; return worker;
}

/** OCR one image or canvas. Jobs run one at a time so a batch of uploads never spawns many workers. */
export function ocrImage(src: Blob | HTMLCanvasElement, langs: string, jobLabel: string): Promise<string> {
  pending++;
  const run = async () => {
    label = jobLabel; useOcr.setState({ job: { label, pct: 0 } });
    try {
      const w = await getWorker(langs || 'eng');
      const { data } = await w.recognize(src);
      return data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } finally { if (--pending === 0) useOcr.setState({ job: null }); }
  };
  const p = chain.then(run, run); chain = p.catch(() => undefined); return p;
}
export const setOcrLabel = (l: string) => { label = l; useOcr.setState(s => s.job ? { job: { ...s.job, label: l } } : s); };
