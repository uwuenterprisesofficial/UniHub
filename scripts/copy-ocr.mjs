// Copies the OCR engine and language data into public/ocr so OCR runs fully offline / self-hosted.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = join('public', 'ocr');
mkdirSync(out, { recursive: true });
const copy = (from, to) => { if (existsSync(from)) copyFileSync(from, join(out, to)); else console.warn('OCR asset missing:', from); };

copy(join('node_modules', 'tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js');
copy(join('node_modules', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'core.wasm.js');
copy(join('node_modules', 'tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'core-nosimd.wasm.js');
const data = join('node_modules', '@tesseract.js-data');
if (existsSync(data)) for (const lang of readdirSync(data)) copy(join(data, lang, '4.0.0_best_int', `${lang}.traineddata.gz`), `${lang}.traineddata.gz`);
console.log('OCR assets ready in', out);

// ONNX runtime for on-device embeddings (the model weights themselves are downloaded once from Hugging Face and cached).
const ort = join('public', 'ort'); mkdirSync(ort, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  const from = join('node_modules', 'onnxruntime-web', 'dist', f);
  if (existsSync(from)) copyFileSync(from, join(ort, f)); else console.warn('ORT asset missing:', from);
}
console.log('ONNX runtime ready in', ort);
