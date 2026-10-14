/** Text extraction. Pages of a PDF are separated by a form feed (\f); paragraphs by a blank line. */
import { isImageExt, ocrImage, setOcrLabel } from './ocr';
import { useStore } from './store';

const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tex', 'bib', 'html', 'json'];
export const isTextExt = (e: string) => TEXT_EXT.includes(e);
export const canExtract = (ext: string) => isTextExt(ext) || ext === 'pdf' || ext === 'docx' || isImageExt(ext);
export interface ExtractOpts { ocr?: boolean; force?: boolean; label?: string }
export const PAGE_BREAK = '\f';

async function pdfText(blob: Blob, o: Required<Pick<ExtractOpts, 'ocr' | 'force' | 'label'>> & { langs: string }): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    // rebuild lines from positioned fragments; a larger vertical gap than usual starts a new paragraph
    const lines: { y: number; h: number; s: string }[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5], h = it.height || 10;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < h * 0.5) last.s += it.str + (it.hasEOL ? '' : '');
      else lines.push({ y, h, s: it.str });
    }
    const gaps = lines.slice(1).map((l, i) => Math.abs(lines[i].y - l.y)).sort((a, b) => a - b);
    // typical line spacing = lower quartile of the gaps (paragraph gaps are the minority, so the median can be too large)
    const norm = gaps.length ? Math.max(gaps[Math.floor(gaps.length * 0.25)], 6) : 12;
    let out = '';
    lines.forEach((l, i) => {
      const s = l.s.replace(/\s+/g, ' ').trim(); if (!s) return;
      if (i === 0) { out = s; return; }
      const gap = Math.abs(lines[i - 1].y - l.y);
      if (gap > norm * 1.45) out += '\n\n' + s;
      else if (/-$/.test(out) && /^[a-zäöüß]/.test(s)) out = out.slice(0, -1) + s; // join hyphenated word
      else out += ' ' + s;
    });
    out = out.trim();
    // pages without a text layer (scans) or all pages when re-running OCR: render the page and read it with OCR
    if (o.ocr && (o.force || out.replace(/\s/g, '').length < 25)) {
      setOcrLabel(`${o.label} · page ${n}/${pdf.numPages}`);
      const page = await pdf.getPage(n), base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, Math.max(1.5, 1800 / base.width)) });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
      const t = await ocrImage(canvas, o.langs, `${o.label} · page ${n}/${pdf.numPages}`);
      canvas.width = canvas.height = 0;
      if (t.replace(/\s/g, '').length > out.replace(/\s/g, '').length) out = t;
    }
    pages.push(out);
  }
  return pages.join(PAGE_BREAK);
}

async function docxText(blob: Blob): Promise<string> {
  const mammoth = await import('mammoth');
  const r = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
  return r.value.replace(/\n{3,}/g, '\n\n');
}

export async function extractText(blob: Blob, ext: string, opts: ExtractOpts = {}): Promise<string> {
  const S = useStore.getState().settings;
  const o = { ocr: opts.ocr ?? S.ocr, force: opts.force ?? false, label: opts.label ?? 'Document', langs: S.ocrLangs || 'eng' };
  try {
    if (ext === 'pdf') return await pdfText(blob, o);
    if (ext === 'docx') return await docxText(blob);
    if (isTextExt(ext)) return (await blob.text()).replace(/\r\n/g, '\n');
    if (isImageExt(ext) && o.ocr) return await ocrImage(blob, o.langs, o.label);
  } catch (e) { console.warn('Text extraction failed', e); }
  return '';
}
export const pageOf = (text: string, offset: number) => { let n = 1; for (let i = text.indexOf(PAGE_BREAK); i >= 0 && i < offset; i = text.indexOf(PAGE_BREAK, i + 1)) n++; return n; };
