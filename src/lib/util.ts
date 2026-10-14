import type { Settings } from './types';
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const pad = (n: number) => String(n).padStart(2, '0');
export const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseD = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => fmt(new Date());
export const addDays = (s: string, n: number) => { const d = parseD(s); d.setDate(d.getDate() + n); return fmt(d); };
export const diffDays = (a: string, b: string) => Math.round((+parseD(a) - +parseD(b)) / 864e5);
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function weekStart(s: string, ws: number) {
  const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7)); return fmt(d);
}
export function fmtDate(s: string, f: Settings['dateFormat'] = 'ISO', long = false) {
  if (!s) return '';
  const d = parseD(s);
  if (long) return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  if (f === 'DMY') return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  if (f === 'MDY') return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  return s;
}
export function relDay(s: string) {
  const n = diffDays(s, today());
  if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
export const toMin = (t: string) => { const [a, b] = (t || '00:00').split(':').map(Number); return a * 60 + b; };
export const fromMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const fmtDur = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;
export const fmtSize = (b: number) => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b > 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B';
export const parseTags = (s: string) => [...new Set(s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean))];
export function download(name: string, content: string | Blob, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export const blobToB64 = (b: Blob) => new Promise<string>(r => { const f = new FileReader(); f.onload = () => r(f.result as string); f.readAsDataURL(b); });
export const b64ToBlob = async (u: string) => (await fetch(u)).blob();
