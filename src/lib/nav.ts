import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { getData } from './store';
import { fmtDate } from './util';

/* Navigation that remembers where you were:
   1. the position inside a page (tab, selected lecture, reader panel …) lives in the address, so Back returns to exactly that view
   2. "← Back" links go to the page you actually came from, not to a fixed parent
   3. scroll positions are restored on Back */

/** A piece of view state kept in the address (`?tab=docs`). Changing it replaces the current history entry, so Back leaves the page rather than stepping through tabs. */
export function useUrlState<T extends string>(key: string, def: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get(key);
  const value = (raw && (!allowed || (allowed as readonly string[]).includes(raw)) ? raw : def) as T;
  const set = useCallback((v: T) => setSp(prev => { const n = new URLSearchParams(prev); if (v === def) n.delete(key); else n.set(key, v); return n; }, { replace: true }), [setSp, key, def]);
  return [value, set];
}

/** Sets several address parameters at once (undefined / empty removes one), replacing the current entry. */
export function useUrlParams(): (patch: Record<string, string | undefined>) => void {
  const [, setSp] = useSearchParams();
  return useCallback(patch => setSp(prev => { const n = new URLSearchParams(prev); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } return n; }, { replace: true }), [setSp]);
}

/* ---------- where have I been ---------- */
const KEY = 'unihub.navstack';
let stack: string[] = (() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { return []; } })();
const histIdx = () => (window.history.state?.idx as number | undefined) ?? 0;
export function recordLocation(path: string) {
  stack[histIdx()] = path;
  try { sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-200))); } catch { /* private mode */ }
}
export const previousPath = (): string | undefined => histIdx() > 0 ? stack[histIdx() - 1] : undefined;
export const canGoBack = () => histIdx() > 0;

const TAB_LABEL: Record<string, string> = { notes: 'Notes', docs: 'Documents', summary: 'Summary', gloss: 'Glossary', ask: 'Ask', graph: 'Graph', overview: 'Course overview', tasks: 'Tasks', quotes: 'Quotes', knowledge: 'Knowledge', grades: 'Grades', details: 'Details', original: 'Original', reader: 'Reader' };

/** A human-readable name for a path such as `/modules/abc/workspace?s=x&tab=docs`. */
export function describePath(path: string): string {
  const [pathname, query = ''] = path.split('?'); const sp = new URLSearchParams(query); const d = getData(); const parts = pathname.split('/').filter(Boolean);
  const tab = sp.get('tab') ?? sp.get('view'); const withTab = (s: string) => tab && TAB_LABEL[tab] ? `${s} · ${TAB_LABEL[tab]}` : s;
  if (!parts.length) return 'Dashboard';
  if (parts[0] === 'modules' && parts[1]) {
    const m = d.modules.find(x => x.id === parts[1]); const name = m?.code || m?.name || 'Module';
    if (parts[2] === 'workspace') { const s = d.sessions.find(x => x.id === sp.get('s')); return withTab(`${name} lectures${s ? ' · ' + fmtDate(s.date, d.settings.dateFormat) : ''}`); }
    return withTab(m?.name ?? 'Module');
  }
  if (parts[0] === 'documents' && parts[1]) return withTab(d.docs.find(x => x.id === parts[1])?.name ?? 'Document');
  if (parts[0] === 'notes' && parts[1]) return d.notes.find(x => x.id === parts[1])?.title ?? 'Note';
  if (parts[0] === 'glossary' && parts[1]) return d.terms.find(x => x.id === parts[1])?.term ?? 'Glossary entry';
  if (parts[0] === 'thesis' && parts[1]) return withTab(d.projects.find(x => x.id === parts[1])?.title ?? 'Thesis');
  const names: Record<string, string> = { modules: 'Modules', calendar: 'Calendar', tasks: 'Tasks', documents: 'Documents', notes: 'Notes', glossary: 'Glossary', quotes: 'Quotes', knowledge: 'Knowledge base', graph: 'Knowledge graph', study: 'Study', thesis: 'Thesis', settings: 'Settings', search: 'Search' };
  return withTab(names[parts[0]] ?? 'previous page');
}

/** Call once in the app shell: records every location and restores scroll positions when going back. */
export function useNavigationMemory() {
  const loc = useLocation(); const type = useNavigationType(); const saved = useRef<Record<string, number>>({});
  useEffect(() => { try { saved.current = JSON.parse(sessionStorage.getItem('unihub.scroll') ?? '{}'); } catch { saved.current = {}; } }, []);
  useEffect(() => {
    const path = loc.pathname + loc.search; recordLocation(path);
    const key = loc.key;
    if (type === 'POP' && saved.current[key] != null) {
      // content renders asynchronously (documents, the graph …): try a few times until the page is tall enough
      const y = saved.current[key]; let tries = 0;
      const tick = () => { window.scrollTo(0, y); if (Math.abs(window.scrollY - y) > 4 && tries++ < 20) setTimeout(tick, 60); };
      setTimeout(tick, 0);
    } else if (type !== 'POP') window.scrollTo(0, 0);
    // Save the position once it has settled, or the moment the user presses / clicks something (before a navigation starts).
    // A plain scroll listener is not enough: when the next page is shorter the browser clamps the scroll position and fires a scroll event that would overwrite it.
    const save = () => { saved.current[key] = window.scrollY; }; let t = 0;
    const onScroll = () => { clearTimeout(t); t = window.setTimeout(save, 120); };
    window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('pointerdown', save, true); window.addEventListener('keydown', save, true);
    return () => {
      clearTimeout(t); window.removeEventListener('scroll', onScroll); window.removeEventListener('pointerdown', save, true); window.removeEventListener('keydown', save, true);
      try { sessionStorage.setItem('unihub.scroll', JSON.stringify(saved.current)); } catch { /* private mode */ }
    };
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
}
