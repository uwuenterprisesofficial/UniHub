import { useStore } from '../lib/store';
import type { Scope } from '../lib/kb';
import { DOW, fmtDate, parseD } from '../lib/util';
import { ModuleSelect } from './ui';

/** Chooses what a question or the graph is about. With a `context` (the page is already about a module / lecture) it
    offers simple chips; without one it offers module and lecture drop-downs. */
export function ScopePicker({ scope, onChange, context }: { scope: Scope; onChange: (s: Scope) => void; context?: Scope }) {
  const { sessions, settings, modules } = useStore();
  const fmt = settings.dateFormat;
  const lectures = (moduleId?: string) => sessions.filter(s => s.moduleId === moduleId).sort((a, b) => b.date.localeCompare(a.date));
  const label = (s: (typeof sessions)[number]) => `${DOW[parseD(s.date).getDay()]} ${fmtDate(s.date, fmt)}${s.title ? ' · ' + s.title : ''}`;

  if (context?.moduleId) {
    const mod = modules.find(m => m.id === context.moduleId)?.name ?? 'module';
    const opts: { key: string; text: string; scope: Scope }[] = [
      ...(context.sessionId ? [{ key: 'lecture', text: '🎓 This lecture', scope: { moduleId: context.moduleId, sessionId: context.sessionId } }] : []),
      { key: 'module', text: `🗂 ${mod}`, scope: { moduleId: context.moduleId } }, { key: 'all', text: '🌐 Everything', scope: {} },
    ];
    const cur = scope.sessionId ? 'lecture' : scope.moduleId ? 'module' : 'all';
    return <div className="row" style={{ gap: 6 }}>
      <span className="small muted">Ask about:</span>
      <div className="seg">{opts.map(o => <button key={o.key} className={cur === o.key ? 'on' : ''} onClick={() => onChange(o.scope)}>{o.text}</button>)}</div>
      {context.moduleId && !context.sessionId && lectures(context.moduleId).length > 0 && <div style={{ width: 230 }}>
        <select value={scope.sessionId ?? ''} onChange={e => onChange(e.target.value ? { moduleId: context.moduleId, sessionId: e.target.value } : { moduleId: context.moduleId })}>
          <option value="">Whole module</option>{lectures(context.moduleId).map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}</select></div>}
    </div>;
  }
  const ls = lectures(scope.moduleId);
  return <div className="row" style={{ gap: 6 }}>
    <div style={{ width: 200 }}><ModuleSelect value={scope.moduleId ?? ''} onChange={v => onChange(v ? { moduleId: v } : {})} none="All modules" /></div>
    {scope.moduleId && ls.length > 0 && <div style={{ width: 240 }}><select value={scope.sessionId ?? ''} onChange={e => onChange({ moduleId: scope.moduleId, sessionId: e.target.value || undefined })}>
      <option value="">Whole module</option>{ls.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}</select></div>}
  </div>;
}

export function scopeLabel(scope: Scope, d: { modules: { id: string; name: string }[]; sessions: { id: string; date: string; title: string }[] }): string {
  const m = d.modules.find(x => x.id === scope.moduleId)?.name, s = d.sessions.find(x => x.id === scope.sessionId);
  return s ? `${m ?? 'Module'} · lecture ${s.date}${s.title ? ' – ' + s.title : ''}` : m ?? 'everything';
}
