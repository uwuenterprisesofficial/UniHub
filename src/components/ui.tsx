import { type ReactNode } from 'react';
import { create } from 'zustand';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';

/* ---------- dialog + toast state ---------- */
interface UI { dialog: ReactNode | null; gate: ReactNode | null; gateCancel: (() => void) | null; toasts: { id: number; msg: string }[] }
export const useUI = create<UI>(() => ({ dialog: null, gate: null, gateCancel: null, toasts: [] }));
/** A second layer above the normal dialog, so a confirmation never replaces a dialog the user is working in. */
export const openGate = (gate: ReactNode, onCancel?: () => void) => useUI.setState({ gate, gateCancel: onCancel ?? null });
export const closeGate = () => useUI.setState({ gate: null, gateCancel: null });
const dismissGate = () => { useUI.getState().gateCancel?.(); closeGate(); };
export const openDialog = (dialog: ReactNode) => useUI.setState({ dialog });
export const closeDialog = () => useUI.setState({ dialog: null });
let tid = 0;
export function toast(msg: string) {
  const id = ++tid;
  useUI.setState(s => ({ toasts: [...s.toasts, { id, msg }] }));
  setTimeout(() => useUI.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 4000);
}

export function DialogHost() {
  const { dialog, gate, toasts } = useUI();
  return <>
    <div id="overlay" className={dialog ? 'on' : ''} onClick={closeDialog}>{dialog}</div>
    <div id="overlay2" className={gate ? 'on' : ''} onClick={dismissGate}>{gate}</div>
    <div id="toasts">{toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}</div>
  </>;
}

export interface Btn { label: string; cls?: string; onClick?: () => void | false | Promise<void>; keepOpen?: boolean }
export function Modal({ title, wide, buttons = [], children }: { title: string; wide?: boolean; buttons?: Btn[]; children: ReactNode }) {
  return <div className={'modal' + (wide ? ' wide' : '')} onClick={e => e.stopPropagation()}>
    <h2>{title}</h2>
    {children}
    <div className="foot">
      {buttons.map(b => <button key={b.label} className={'btn ' + (b.cls ?? '')}
        onClick={() => { const r = b.onClick?.(); if (r !== false && !b.keepOpen) closeDialog(); }}>{b.label}</button>)}
    </div>
  </div>;
}

export function confirmBox(msg: string, fn: () => void, label = 'Delete') {
  openDialog(<Modal title="Please confirm" buttons={[{ label: 'Cancel' }, { label, cls: 'danger', onClick: fn }]}><p>{msg}</p></Modal>);
}

/* ---------- small building blocks ---------- */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="f"><span>{label}</span>{children}</label>;
}
export function Card({ title, extra, wide, children }: { title?: ReactNode; extra?: ReactNode; wide?: boolean; children: ReactNode }) {
  return <section className={'card' + (wide ? ' wide' : '')}>
    {title && <h2>{title}{extra && <span className="sp small">{extra}</span>}</h2>}
    {children}
  </section>;
}
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function ModChip({ id }: { id: string }) {
  const m = useStore(s => s.modules.find(x => x.id === id));
  if (!m) return null;
  return <Link className="chip dot" style={{ ['--c' as string]: m.color }} to={'/modules/' + m.id} onClick={e => e.stopPropagation()}>{m.code || m.name}</Link>;
}

export function ModuleSelect({ value, onChange, none = 'No module' }: { value: string; onChange: (v: string) => void; none?: string }) {
  const modules = useStore(s => s.modules);
  return <select value={value} onChange={e => onChange(e.target.value)}>
    <option value="">{none}</option>
    {modules.map(m => <option key={m.id} value={m.id}>{m.code ? m.code + ' · ' : ''}{m.name}</option>)}
  </select>;
}
