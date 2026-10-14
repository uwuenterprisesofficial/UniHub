import { useRef, useState, type DragEvent } from 'react';
import { eventColor, isDone, modColor, useStore } from '../lib/store';
import { conflictSet, exportICS, occurrences, parseICS } from '../lib/schedule';
import type { Occurrence } from '../lib/types';
import { DOW, MONTHS, addDays, download, fmt, fmtDate, fromMin, nowMin, pad, parseD, today, toMin, weekStart } from '../lib/util';
import { EventDialog, TaskDialog } from '../components/editors';
import { openDialog, toast } from '../components/ui';
import { useUrlState } from '../lib/nav';
import { FeedsDialog } from '../components/Feeds';

type View = 'day' | 'week' | 'month' | 'semester';
const H0 = 7, HPX = 48, HOURS = 15;
const css = (c: string) => ({ ['--c' as string]: c });

export default function Calendar() {
  const { events, tasks, modules, settings: S, add, update } = useStore();
  const narrow = typeof window !== 'undefined' && window.innerWidth < 700;
  const [view, setView] = useUrlState<View>('view', narrow ? 'day' : 'week', ['day', 'week', 'month', 'semester']);
  const [date, setDate] = useUrlState('date', today());
  const fileRef = useRef<HTMLInputElement>(null);
  const d = parseD(date), ws = S.weekStart;
  const [from, to] = view === 'day' ? [date, date] : view === 'week' ? [weekStart(date, ws), addDays(weekStart(date, ws), 6)]
    : view === 'month' ? (() => { const f = parseD(date); f.setDate(1); const s = weekStart(fmt(f), ws); return [s, addDays(s, 41)]; })()
      : [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
  const occ = occurrences(events, from, to), conf = conflictSet(occ);

  const shift = (n: number) => {
    const x = parseD(date);
    if (view === 'day') x.setDate(x.getDate() + n); else if (view === 'week') x.setDate(x.getDate() + 7 * n);
    else if (view === 'month') x.setMonth(x.getMonth() + n, 1); else x.setFullYear(x.getFullYear() + n);
    setDate(fmt(x));
  };
  const title = view === 'day' ? fmtDate(date, S.dateFormat, true) : view === 'week' ? `${fmtDate(from, S.dateFormat)} – ${fmtDate(to, S.dateFormat)}`
    : view === 'month' ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${d.getFullYear()}`;

  const move = (id: string, fromDate: string, toDate: string, newStart: string | null) => {
    const e = events.find(x => x.id === id); if (!e) return;
    const dur = e.start && e.end ? toMin(e.end) - toMin(e.start) : 60;
    const patch = { date: toDate, ...(newStart != null ? { start: newStart, end: fromMin(toMin(newStart) + dur) } : {}) };
    if (e.repeat !== 'none') {
      update('events', id, { exceptions: [...e.exceptions, fromDate] });
      add('events', { ...e, ...patch, id: undefined, repeat: 'none', until: '', exceptions: [] });
      toast('Moved this occurrence only');
    } else update('events', id, patch);
  };
  const onImport = async (f?: File) => {
    if (!f) return;
    const evs = parseICS(await f.text()); evs.forEach(e => add('events', e)); toast(`Imported ${evs.length} events`);
  };
  const dropData = (e: DragEvent) => { try { return JSON.parse(e.dataTransfer.getData('text/plain')) as { id: string; date: string; off?: number }; } catch { return null; } };
  const days = view === 'day' ? [date] : [...Array(7)].map((_, i) => addDays(from, i));
  const t = today();
  const openEv = (o: Occurrence) => openDialog(<EventDialog id={o.ev.id} date={o.date} />);

  return <>
    <div className="page-head"><h1>Calendar</h1>
      <div className="cal-nav"><button className="btn" onClick={() => shift(-1)}>‹</button><button className="btn" onClick={() => setDate(today())}>Today</button><button className="btn" onClick={() => shift(1)}>›</button><strong style={{ minWidth: 170 }}>{title}</strong></div>
      <div className="seg">{(['day', 'week', 'month', 'semester'] as View[]).map(v => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
      <button className="btn" onClick={() => openDialog(<FeedsDialog />)}>📡 Subscriptions{S.icsFeeds.length > 0 && ` (${S.icsFeeds.length})`}</button>
      <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import ICS</button>
      <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={e => { onImport(e.target.files?.[0]); e.target.value = ''; }} />
      <button className="btn" onClick={() => download('unihub-calendar.ics', exportICS(events), 'text/calendar')}>⬇ Export ICS</button>
      <button className="btn primary" onClick={() => openDialog(<EventDialog date={date} />)}>＋ Event</button></div>
    {conf.size > 0 && view !== 'semester' && <div className="card" style={{ marginBottom: 12, borderColor: 'var(--danger)' }}>⚠️ Scheduling conflicts in this view are outlined in red.</div>}

    {(view === 'day' || view === 'week') && <div className="tg-scroll"><div className="tg" style={{ gridTemplateColumns: `52px repeat(${days.length},minmax(0,1fr))`, minWidth: days.length > 1 ? 52 + days.length * 112 : undefined }}>
      <div className="tg-head"><div />{days.map(day => { const dd = parseD(day); return <div key={day} className={day === t ? 'today' : ''} style={{ cursor: 'pointer' }} onClick={() => { setView('day'); setDate(day); }}>{DOW[dd.getDay()]} {dd.getDate()}</div>; })}</div>
      <div className="tg-allday" />
      {days.map(day => <div key={day} className="tg-allday" style={{ borderLeft: '1px solid var(--line)' }}>
        {occ.filter(o => o.date === day && !o.ev.start).map(o => <span key={o.ev.id + day} className="pill" style={css(eventColor(o.ev, modules))} onClick={() => openEv(o)}>{o.ev.title}</span>)}
        {tasks.filter(x => x.due === day).map(x => <span key={x.id} className="pill task" style={{ ...css(modColor(modules, x.moduleId)), textDecoration: isDone(x, S) ? 'line-through' : '' }} onClick={() => openDialog(<TaskDialog id={x.id} />)}>☐ {x.title}</span>)}
      </div>)}
      <div className="tg-hours">{[...Array(HOURS)].map((_, i) => <div key={i}>{H0 + i}:00</div>)}</div>
      {days.map(day => <div key={day} className={'tg-col' + (day === t ? ' today' : '')}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
        onDragLeave={e => e.currentTarget.classList.remove('dragover')}
        onDrop={e => {
          e.preventDefault(); e.currentTarget.classList.remove('dragover');
          const p = dropData(e); if (!p) return;
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top - (p.off ?? 0);
          const m = Math.max(0, Math.round((y / HPX * 60) / 15) * 15) + H0 * 60;
          move(p.id, p.date, day, fromMin(Math.min(m, 21 * 60)));
        }}
        onDoubleClick={e => {
          if (e.target !== e.currentTarget) return;
          const m = Math.round(((e.clientY - e.currentTarget.getBoundingClientRect().top) / HPX * 60) / 30) * 30 + H0 * 60;
          openDialog(<EventDialog date={day} preset={{ start: fromMin(m), end: fromMin(m + 60) }} />);
        }}>
        {occ.filter(o => o.date === day && o.ev.start).map(o => {
          const s = toMin(o.ev.start), e2 = Math.max(toMin(o.ev.end || o.ev.start), s + 30);
          return <div key={o.ev.id + day} className={'ev' + (conf.has(o.ev.id + o.date) ? ' conf' : '')} draggable title={o.ev.title}
            style={{ ...css(eventColor(o.ev, modules)), top: (s - H0 * 60) / 60 * HPX, height: (e2 - s) / 60 * HPX - 2 }}
            onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ id: o.ev.id, date: o.date, off: e.clientY - e.currentTarget.getBoundingClientRect().top }))}
            onClick={() => openEv(o)}><b>{o.ev.title}</b><span>{o.ev.start}–{o.ev.end}</span>{o.ev.location && <div>{o.ev.location}</div>}</div>;
        })}
        {day === t && nowMin() >= H0 * 60 && nowMin() < (H0 + HOURS) * 60 &&
          <div style={{ position: 'absolute', left: 0, right: 0, top: (nowMin() - H0 * 60) / 60 * HPX, borderTop: '2px solid var(--danger)', pointerEvents: 'none' }} />}
      </div>)}
    </div></div>}

    {view === 'month' && <div className="month">
      {[...Array(7)].map((_, i) => <div key={i} className="dh">{DOW[(i + ws) % 7]}</div>)}
      {[...Array(42)].map((_, i) => {
        const day = addDays(from, i), dd = parseD(day);
        return <div key={day} className={'cell' + (dd.getMonth() !== d.getMonth() ? ' other' : '') + (day === t ? ' today' : '')}
          onDoubleClick={() => openDialog(<EventDialog date={day} />)}
          onClick={() => { if (window.innerWidth < 700) { setView('day'); setDate(day); } }}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
          onDragLeave={e => e.currentTarget.classList.remove('dragover')}
          onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); const p = dropData(e); if (p) move(p.id, p.date, day, null); }}>
          <span className="dn">{dd.getDate()}</span>
          {occ.filter(o => o.date === day).map(o => <span key={o.ev.id} className={'pill' + (conf.has(o.ev.id + o.date) ? ' conf' : '')} draggable style={css(eventColor(o.ev, modules))}
            onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ id: o.ev.id, date: o.date }))}
            onClick={e => { e.stopPropagation(); openEv(o); }}>{o.ev.start} {o.ev.title}</span>)}
          {tasks.filter(x => x.due === day).map(x => <span key={x.id} className="pill task" style={{ ...css(modColor(modules, x.moduleId)), textDecoration: isDone(x, S) ? 'line-through' : '' }}
            onClick={e => { e.stopPropagation(); openDialog(<TaskDialog id={x.id} />); }}>☐ {x.title}</span>)}
        </div>;
      })}
    </div>}

    {view === 'semester' && <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>
      {MONTHS.map((name, m) => {
        const year = d.getFullYear(), pre = (new Date(year, m, 1).getDay() - ws + 7) % 7, n = new Date(year, m + 1, 0).getDate();
        return <div key={name} className="card" style={{ cursor: 'pointer' }} onClick={() => { setView('month'); setDate(`${year}-${pad(m + 1)}-01`); }}>
          <h3 style={{ marginBottom: 6 }}>{name}</h3>
          <div className="mini">
            {[...Array(7)].map((_, i) => <div key={i} className="muted">{DOW[(i + ws) % 7][0]}</div>)}
            {[...Array(pre)].map((_, i) => <div key={'p' + i} />)}
            {[...Array(n)].map((_, i) => {
              const day = `${year}-${pad(m + 1)}-${pad(i + 1)}`;
              const c = occ.filter(o => o.date === day).length + tasks.filter(x => x.due === day).length;
              const exam = occ.some(o => o.date === day && o.ev.type === 'exam');
              return <div key={day} className={'d' + (c ? ' has' : '') + (day === t ? ' today' : '')} style={exam ? { background: 'var(--danger)', color: '#fff' } : {}} title={c ? c + ' item(s)' : ''}>{i + 1}</div>;
            })}
          </div></div>;
      })}
    </div>}
  </>;
}
