import type { Index } from './kb';
import { cosine, vecMap } from './embed';
import type { Data } from './types';

export type NodeType = 'module' | 'session' | 'doc' | 'note' | 'term' | 'quote' | 'annotation' | 'task' | 'project' | 'chapter' | 'source' | 'card';
export type EdgeType = 'in_module' | 'mentions' | 'related_to' | 'defines' | 'annotates' | 'quoted_from' | 'cites' | 'links_to' | 'attached' | 'based_on' | 'part_of' | 'supports' | 'has_file' | 'similar' | 'shares_concepts';
export interface GNode { id: string; type: NodeType; label: string; moduleId: string; to: string; degree: number }
export interface GEdge { s: string; t: string; type: EdgeType; w: number }
export interface Graph { nodes: GNode[]; edges: GEdge[]; byId: Map<string, GNode>; adj: Map<string, GEdge[]> }

export const TYPE_META: Record<NodeType, { label: string; color: string; icon: string }> = {
  module: { label: 'Modules', color: '#4f46e5', icon: '🗂' }, session: { label: 'Lectures', color: '#6366f1', icon: '🎓' }, doc: { label: 'Documents', color: '#0891b2', icon: '📄' }, note: { label: 'Notes', color: '#16a34a', icon: '📝' },
  term: { label: 'Concepts', color: '#a855f7', icon: '📖' }, quote: { label: 'Quotes', color: '#0ea5e9', icon: '❝' }, annotation: { label: 'Annotations', color: '#eab308', icon: '🖍' },
  task: { label: 'Tasks', color: '#f97316', icon: '☑' }, project: { label: 'Thesis', color: '#e11d48', icon: '🎓' }, chapter: { label: 'Chapters', color: '#fb7185', icon: '§' },
  source: { label: 'Sources', color: '#14b8a6', icon: '📚' }, card: { label: 'Flashcards', color: '#84cc16', icon: '🧠' },
};
export const EDGE_LABEL: Record<EdgeType, string> = { in_module: 'belongs to', mentions: 'mentions', related_to: 'related to', defines: 'defines', annotates: 'annotates', quoted_from: 'quoted from', cites: 'cites', links_to: 'links to', attached: 'attached to', based_on: 'based on', part_of: 'part of', supports: 'supports', has_file: 'has file', similar: 'similar to', shares_concepts: 'shares concepts with' };

const cut = (s: string, n = 42) => s.length > n ? s.slice(0, n - 1) + '…' : s;

export function buildGraph(d: Data, idx: Index): Graph {
  const nodes = new Map<string, GNode>(); const edges = new Map<string, GEdge>();
  const node = (id: string, type: NodeType, label: string, moduleId: string, to: string) => { if (!nodes.has(id)) nodes.set(id, { id, type, label: cut(label), moduleId, to, degree: 0 }); };
  const edge = (a: string, b: string, type: EdgeType, w = 1) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return;
    const [s, t] = type === 'related_to' || type === 'similar' || type === 'shares_concepts' ? [a, b].sort() : [a, b];
    const k = `${s}|${t}|${type}`, e = edges.get(k); if (e) e.w += w; else edges.set(k, { s, t, type, w });
  };

  for (const m of d.modules) node('mod:' + m.id, 'module', m.name, m.id, '/modules/' + m.id);
  for (const x of d.sessions ?? []) node('sess:' + x.id, 'session', `${x.date}${x.title ? ' ' + x.title : ''}`, x.moduleId, `/modules/${x.moduleId}/workspace?s=${x.id}`);
  for (const x of d.docs) node('doc:' + x.id, 'doc', x.name, x.moduleId, '/documents/' + x.id);
  for (const n of d.notes) node('note:' + n.id, 'note', n.title, n.moduleId, '/notes/' + n.id);
  const terms = d.terms.filter(t => t.status === 'confirmed');
  for (const t of terms) node('term:' + t.id, 'term', t.term, t.moduleId, '/glossary/' + t.id);
  for (const q of d.quotes.filter(q => q.status === 'saved')) node('quote:' + q.id, 'quote', '“' + q.text, q.moduleId, '/quotes');
  for (const a of d.annotations) { const doc = d.docs.find(x => x.id === a.docId); node('ann:' + a.id, 'annotation', a.note || a.quote, doc?.moduleId ?? '', `/documents/${a.docId}?at=${a.start}`); }
  for (const t of d.tasks) node('task:' + t.id, 'task', t.title, t.moduleId, '/tasks');
  for (const p of d.projects) { node('proj:' + p.id, 'project', p.title, '', '/thesis/' + p.id); p.chapters.forEach(c => node(`chap:${p.id}:${c.id}`, 'chapter', c.title, '', '/thesis/' + p.id)); }
  for (const r of d.refs) node('ref:' + r.id, 'source', r.title, '', '/thesis/' + r.projectId);
  for (const f of d.flashcards) node('card:' + f.id, 'card', f.front, f.moduleId, '/study');

  for (const x of d.docs) if (x.moduleId) edge('doc:' + x.id, 'mod:' + x.moduleId, 'in_module');
  for (const t of terms) if (t.moduleId) edge('term:' + t.id, 'mod:' + t.moduleId, 'in_module');
  for (const t of d.tasks) { if (t.moduleId) edge('task:' + t.id, 'mod:' + t.moduleId, 'in_module'); t.docIds.forEach(i => edge('task:' + t.id, 'doc:' + i, 'attached')); t.noteIds.forEach(i => edge('task:' + t.id, 'note:' + i, 'based_on')); }
  for (const f of d.flashcards) { if (f.moduleId) edge('card:' + f.id, 'mod:' + f.moduleId, 'in_module'); if (f.noteId) edge('card:' + f.id, 'note:' + f.noteId, 'based_on'); }
  for (const q of d.quotes.filter(q => q.status === 'saved')) { edge('quote:' + q.id, 'doc:' + q.docId, 'quoted_from'); edge('quote:' + q.id, 'ref:' + q.refId, 'cites'); edge('quote:' + q.id, `chap:${q.projectId}:${q.chapterId}`, 'supports'); }
  for (const a of d.annotations) { edge('ann:' + a.id, 'doc:' + a.docId, 'annotates'); if (a.termId) edge('ann:' + a.id, 'term:' + a.termId, 'defines'); }
  for (const p of d.projects) p.chapters.forEach(c => edge(`chap:${p.id}:${c.id}`, 'proj:' + p.id, 'part_of'));
  for (const r of d.refs) { edge('ref:' + r.id, 'proj:' + r.projectId, 'part_of'); edge('ref:' + r.id, `chap:${r.projectId}:${r.chapterId}`, 'supports'); edge('ref:' + r.id, 'doc:' + r.docId, 'has_file'); }
  for (const x of d.sessions ?? []) { edge('sess:' + x.id, 'mod:' + x.moduleId, 'in_module'); x.docIds.forEach(i => edge('sess:' + x.id, 'doc:' + i, 'attached')); }
  for (const n of d.notes) {
    if (n.sessionId) edge('note:' + n.id, 'sess:' + n.sessionId, 'part_of');
    if (n.moduleId) edge('note:' + n.id, 'mod:' + n.moduleId, 'in_module');
    for (const m of n.body.matchAll(/\[\[([^\]]+)\]\]/g)) { const o = d.notes.find(x => x.title.toLowerCase() === m[1].trim().toLowerCase()); if (o) edge('note:' + n.id, 'note:' + o.id, 'links_to'); }
    for (const m of n.body.matchAll(/#\/documents\/([a-z0-9]+)/g)) edge('note:' + n.id, 'doc:' + m[1], 'links_to');
  }

  // concepts ↔ the material that mentions them (derived from the knowledge index)
  for (const t of terms) for (const ci of idx.termChunks.get(t.id) ?? []) {
    const c = idx.chunks[ci], [kind, ref] = c.id.split(':');
    const owner = c.docId ? 'doc:' + c.docId : kind === 'note' ? 'note:' + ref : kind === 'sess' ? 'sess:' + ref : kind === 'q' ? 'quote:' + ref : kind === 'ref' ? 'ref:' + ref : kind === 'fc' ? 'card:' + ref : kind === 'task' ? 'task:' + ref : kind === 'pr' ? 'proj:' + ref : kind === 'mod' ? 'mod:' + ref : '';
    if (owner && kind !== 'term') edge('term:' + t.id, owner, 'mentions');
    if (kind === 'ann') edge('term:' + t.id, 'ann:' + ref, 'mentions');
  }
  for (const t of terms) for (const r of idx.related(t.id).slice(0, 4)) if (r.weight >= 0.2) edge('term:' + t.id, 'term:' + r.id, 'related_to', r.weight * 3);

  // similar documents: by embedding when available, otherwise by shared concepts
  const docVec = new Map<string, { sum: Float32Array; n: number }>();
  for (const [id, v] of vecMap) { if (!id.startsWith('doc:')) continue; const did = id.split(':')[1]; const e = docVec.get(did) ?? { sum: new Float32Array(v.length), n: 0 }; for (let i = 0; i < v.length; i++) e.sum[i] += v[i]; e.n++; docVec.set(did, e); }
  const ids = [...docVec.keys()];
  if (ids.length > 1) {
    const unit = new Map(ids.map(i => { const s = docVec.get(i)!.sum; const n = Math.hypot(...s) || 1; return [i, s.map(x => x / n)] as const; }));
    for (const a of ids) {
      const sims = ids.filter(b => b !== a).map(b => ({ b, s: cosine(unit.get(a)!, unit.get(b)!) })).sort((x, y) => y.s - x.s).slice(0, 3).filter(x => x.s >= 0.55);
      sims.forEach(x => edge('doc:' + a, 'doc:' + x.b, 'similar', x.s));
    }
  } else {
    const termsOf = new Map<string, Set<string>>(); edges.forEach(e => { if (e.type === 'mentions' && e.t.startsWith('doc:')) { const s = termsOf.get(e.t) ?? new Set(); s.add(e.s); termsOf.set(e.t, s); } });
    const dl = [...termsOf.keys()];
    for (let i = 0; i < dl.length; i++) for (let j = i + 1; j < dl.length; j++) { let n = 0; termsOf.get(dl[i])!.forEach(t => termsOf.get(dl[j])!.has(t) && n++); if (n >= 3) edge(dl[i], dl[j], 'shares_concepts', n); }
  }

  const list = [...edges.values()], adj = new Map<string, GEdge[]>();
  for (const e of list) { for (const k of [e.s, e.t]) { const a = adj.get(k) ?? []; a.push(e); adj.set(k, a); nodes.get(k)!.degree++; } }
  return { nodes: [...nodes.values()], edges: list, byId: nodes, adj };
}

export const other = (e: GEdge, id: string) => e.s === id ? e.t : e.s;

/** Shortest chain of connections between two nodes (breadth-first, ignoring direction). */
export function shortestPath(g: Graph, from: string, to: string, allow?: (n: GNode) => boolean): { nodes: string[]; edges: GEdge[] } | null {
  if (from === to) return { nodes: [from], edges: [] };
  const prev = new Map<string, { id: string; e: GEdge }>([[from, { id: '', e: null as unknown as GEdge }]]); const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const e of g.adj.get(cur) ?? []) {
      const nx = other(e, cur); if (prev.has(nx) || (allow && !allow(g.byId.get(nx)!) && nx !== to)) continue;
      prev.set(nx, { id: cur, e }); if (nx === to) { const ns = [to], es: GEdge[] = []; for (let c = to; c !== from;) { const p = prev.get(c)!; es.unshift(p.e); ns.unshift(p.id); c = p.id; } return { nodes: ns, edges: es }; }
      q.push(nx);
    }
  }
  return null;
}

/** Items within `depth` connections of `id`. `through` can stop the search from expanding via hub nodes (e.g. a module, which touches everything). */
export function neighborhood(g: Graph, id: string, depth: number, through?: (n: GNode) => boolean): Set<string> {
  const seen = new Set([id]); let frontier = [id];
  for (let d = 0; d < depth; d++) { const next: string[] = []; for (const n of frontier) { if (n !== id && through && !through(g.byId.get(n)!)) continue; for (const e of g.adj.get(n) ?? []) { const o = other(e, n); if (!seen.has(o)) { seen.add(o); next.push(o); } } } frontier = next; }
  return seen;
}

export function insights(g: Graph) {
  const terms = g.nodes.filter(n => n.type === 'term');
  const hubs = [...terms].sort((a, b) => b.degree - a.degree).slice(0, 8);
  const modsOf = (id: string) => { const s = new Set<string>(); for (const e of g.adj.get(id) ?? []) { const o = g.byId.get(other(e, id))!; if (o.moduleId) s.add(o.moduleId); } const self = g.byId.get(id)!; if (self.moduleId) s.add(self.moduleId); return s; };
  const bridges = terms.map(t => ({ t, mods: modsOf(t.id) })).filter(x => x.mods.size >= 2).sort((a, b) => b.mods.size - a.mods.size || b.t.degree - a.t.degree).slice(0, 8);
  const orphans = g.nodes.filter(n => (n.type === 'doc' || n.type === 'note') && !(g.adj.get(n.id) ?? []).some(e => g.byId.get(other(e, n.id))!.type === 'term'));
  return { hubs, bridges, orphans };
}
