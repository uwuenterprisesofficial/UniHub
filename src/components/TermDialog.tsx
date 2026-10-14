import { useState } from 'react';
import type { Term } from '../lib/types';
import { useStore } from '../lib/store';
import { parseTags } from '../lib/util';
import { Field, Modal, ModuleSelect, confirmBox, toast } from './ui';
import { aiGate } from './AI';
import { aiDefine, useActiveProvider } from '../lib/ai';
import { useTexts } from '../lib/blobs';
import { findOccurrences } from '../lib/kb';

export const normTerm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function findTerm(terms: Term[], text: string): Term | undefined {
  const n = normTerm(text); if (!n) return undefined;
  return terms.find(t => [t.term, ...t.aliases].some(a => normTerm(a) === n || normTerm(a) + 's' === n || normTerm(a) === n + 's'));
}

export function TermDialog({ id, preset, onSaved }: { id?: string; preset?: Partial<Term>; onSaved?: (termId: string) => void }) {
  const { terms, add, update, remove } = useStore();
  const ex = terms.find(t => t.id === id);
  const [d, setD] = useState({ term: '', definition: '', moduleId: '', sourceDocId: '', ...preset, ...ex });
  const [aliases, setAliases] = useState((ex?.aliases ?? preset?.aliases ?? []).join(', '));
  const provider = useActiveProvider(); const [busy, setBusy] = useState(false);
  const draft = async () => {
    if (!d.term.trim()) return toast('Enter the term first');
    const forms = [d.term, ...aliases.split(',').map(a => a.trim()).filter(Boolean)], map = useTexts.getState().map, ex: string[] = [];
    const ids = [d.sourceDocId, ...Object.keys(map)].filter(Boolean);
    for (const docId of [...new Set(ids)]) for (const [s] of findOccurrences(map[docId] ?? '', forms).slice(0, 2)) { if (ex.length < 6) ex.push(map[docId].slice(Math.max(0, s - 220), s + 320).replace(/\s+/g, ' ')); }
    for (const n of useStore.getState().notes) for (const [s] of findOccurrences(n.body, forms).slice(0, 1)) if (ex.length < 6) ex.push(n.body.slice(Math.max(0, s - 150), s + 250).replace(/\s+/g, ' '));
    if (!ex.length) return toast('No passages mention this term yet, so there is nothing to base a definition on.');
    if (!(await aiGate(`Draft a definition for “${d.term}” from ${ex.length} passages`, ex.join('').length))) return;
    setBusy(true);
    try { const t = await aiDefine(d.term, ex); setD(p => ({ ...p, definition: /^not defined/i.test(t) ? p.definition : t })); toast(/^not defined/i.test(t) ? 'The sources do not define this term.' : 'AI draft inserted — please review and edit'); }
    catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const dup = !id ? findTerm(terms, d.term) : undefined;
  const save = () => {
    if (!d.term.trim()) { toast('A term is required'); return false; }
    if (dup) {
      // an existing term already covers this word: keep one entry and add the spelling as alias
      update('terms', dup.id, { aliases: [...new Set([...dup.aliases, d.term.trim()])].filter(a => normTerm(a) !== normTerm(dup.term)), status: 'confirmed', definition: dup.definition || d.definition });
      toast(`Linked to existing term “${dup.term}”`); onSaved?.(dup.id); return;
    }
    const v = { term: d.term.trim(), definition: d.definition.trim(), aliases: parseTags(aliases).map(a => a), moduleId: d.moduleId, status: 'confirmed' as const };
    if (id) update('terms', id, v);
    else { const t = add('terms', { ...v, auto: false, sourceDocId: d.sourceDocId, created: Date.now() }); onSaved?.(t.id); return; }
    onSaved?.(id!);
  };
  return <Modal title={id ? 'Edit glossary term' : 'Add to glossary'} buttons={[
    ...(id ? [{ label: 'Delete', cls: 'danger left', keepOpen: true, onClick: () => confirmBox('Delete this term? Annotations stay but lose the link.', () => remove('terms', id)) }] : []),
    { label: 'Cancel' }, { label: dup ? 'Link to existing' : 'Save', cls: 'primary', onClick: save }]}>
    <Field label="Term"><input type="text" value={d.term} onChange={e => setD({ ...d, term: e.target.value })} autoFocus /></Field>
    {dup && <p className="small soon">“{dup.term}” is already in your glossary — this will be added as another spelling.</p>}
    <Field label="Also known as (comma separated: abbreviations, synonyms, plural forms)"><input type="text" value={aliases} onChange={e => setAliases(e.target.value)} /></Field>
    <Field label="Definition / explanation"><textarea value={d.definition} onChange={e => setD({ ...d, definition: e.target.value })} style={{ minHeight: 110 }} /></Field>
    {provider && <button className="btn sm" disabled={busy} onClick={draft} style={{ marginBottom: 10 }}>{busy ? 'Drafting…' : '✨ Draft definition from my material (AI)'}</button>}
    <Field label="Module"><ModuleSelect value={d.moduleId} onChange={v => setD({ ...d, moduleId: v })} /></Field>
  </Modal>;
}
