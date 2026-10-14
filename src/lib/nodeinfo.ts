import { formatCitation } from './bib';
import { summarize } from './nlp';
import type { Index } from './kb';
import type { Data } from './types';
import { fmtDate, fmtSize } from './util';

/* What to show when the user selects an item in the knowledge graph: the item's actual content, not just its connections. */
export interface NodeInfo {
  icon: string; kind: string; title: string; subtitle?: string;
  /** Markdown shown as the main text (excerpt, definition, summary …). */
  body?: string;
  /** Extra labelled sentences, e.g. the key points of a document. */
  points?: string[];
  facts: [string, string][];
  links: { label: string; to: string }[];
}

const cut = (s: string, n: number) => { const t = s.replace(/\s+\n/g, '\n').trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t; };
const firstParagraphs = (t: string, n: number) => cut(t.split(/\n\s*\n|\f/).map(p => p.trim()).filter(p => p.length > 40 && !/^#{1,6}\s/.test(p) ).slice(0, 2).join('\n\n'), n);

export function nodeInfo(d: Data, texts: Record<string, string>, id: string, idx?: Index): NodeInfo | null {
  const [kind, a, b] = id.split(':'); const fmtD = (x: string) => fmtDate(x, d.settings.dateFormat);
  const mod = (mid: string) => d.modules.find(m => m.id === mid);
  const modName = (mid: string) => mod(mid)?.name ?? '';
  const docFacts = (extra: [string, string][]) => extra.filter(([, v]) => v);

  if (kind === 'mod') {
    const m = mod(a); if (!m) return null;
    const mine = d.sessions.filter(s => s.moduleId === m.id);
    return { icon: m.icon || '🗂', kind: 'Module', title: m.name, subtitle: [m.code, m.semester].filter(Boolean).join(' · '), body: m.objectives || undefined,
      facts: docFacts([['Lecturer', m.lecturer], ['Room', m.room], ['ECTS', String(m.ects || '')], ['Exam', m.exam], ['Lectures', String(mine.length)], ['Documents', String(d.docs.filter(x => x.moduleId === m.id).length)],
        ['Notes', String(d.notes.filter(x => x.moduleId === m.id).length)], ['Open tasks', String(d.tasks.filter(x => x.moduleId === m.id && x.status !== d.settings.stages.at(-1)).length)], ['Glossary terms', String(d.terms.filter(x => x.moduleId === m.id && x.status === 'confirmed').length)]]),
      links: [{ label: 'Open module', to: '/modules/' + m.id }, { label: 'Lecture workspace', to: `/modules/${m.id}/workspace` }] };
  }
  if (kind === 'sess') {
    const s = d.sessions.find(x => x.id === a); if (!s) return null;
    const notes = d.notes.filter(n => n.sessionId === s.id);
    return { icon: '🎓', kind: 'Lecture', title: s.title || `Lecture ${fmtD(s.date)}`, subtitle: [modName(s.moduleId), fmtD(s.date), s.topic].filter(Boolean).join(' · '),
      body: s.summary ? cut(s.summary.replace(/^# .*\n+/, ''), 1400) : 'No summary yet — finish the lecture in the workspace to create one.',
      facts: docFacts([['Status', s.status], ['Notes', String(notes.length)], ['Documents', String(s.docIds.length)], ['Summary', s.summary ? (s.summarySource === 'ai' ? 'AI-written' : 'extracted') : 'none']]),
      links: [{ label: 'Open lecture', to: `/modules/${s.moduleId}/workspace?s=${s.id}` }] };
  }
  if (kind === 'doc') {
    const x = d.docs.find(v => v.id === a); if (!x) return null; const t = texts[x.id] ?? x.text ?? '';
    const key = t ? summarize(t.slice(0, 80_000)).overall.slice(0, 3).map(p => p.text) : [];
    return { icon: '📄', kind: 'Document', title: x.name, subtitle: [modName(x.moduleId), x.folder].filter(Boolean).join(' · '),
      body: t ? firstParagraphs(t, 520) : 'No readable text in this file (images and scans need OCR).', points: key,
      facts: docFacts([['Type', x.ext.toUpperCase()], ['Size', fmtSize(x.size)], ['Words', t ? Math.round(t.split(/\s+/).length).toLocaleString() : ''], ['Pages', /\f/.test(t) ? String(t.split('\f').length) : ''],
        ['Highlights', String(d.annotations.filter(v => v.docId === x.id).length)], ['Tags', x.tags.join(', ')], ['Lectures', String(d.sessions.filter(s => s.docIds.includes(x.id)).length)], ['Read', x.read ? 'yes' : '']]),
      links: [{ label: 'Open in reader', to: '/documents/' + x.id }] };
  }
  if (kind === 'note') {
    const n = d.notes.find(v => v.id === a); if (!n) return null; const s = d.sessions.find(v => v.id === n.sessionId);
    return { icon: '📝', kind: 'Note', title: n.title, subtitle: [modName(n.moduleId), s ? `lecture ${fmtD(s.date)}` : ''].filter(Boolean).join(' · '), body: cut(n.body, 900),
      facts: docFacts([['Tags', n.tags.join(', ')], ['Pinned', n.pinned ? 'yes' : ''], ['Words', String(n.body.split(/\s+/).filter(Boolean).length)]]), links: [{ label: 'Open note', to: '/notes/' + n.id }] };
  }
  if (kind === 'term') {
    const t = d.terms.find(v => v.id === a); if (!t) return null;
    const mentions = idx?.termChunks.get(t.id)?.length;
    return { icon: '📖', kind: 'Glossary term', title: t.term, subtitle: t.aliases.length ? 'also: ' + t.aliases.join(', ') : undefined, body: t.definition || 'No definition yet.',
      facts: docFacts([['Module', modName(t.moduleId)], ['Mentioned in', mentions != null ? `${mentions} passage${mentions === 1 ? '' : 's'}` : ''], ['Status', t.status === 'suggested' ? 'suggested' : '']]),
      links: [{ label: 'Open entry', to: '/glossary/' + t.id }, { label: 'Ask about it', to: '/knowledge?q=' + encodeURIComponent(t.term) }] };
  }
  if (kind === 'quote') {
    const q = d.quotes.find(v => v.id === a); if (!q) return null; const doc = d.docs.find(v => v.id === q.docId), ref = d.refs.find(v => v.id === q.refId);
    return { icon: '❝', kind: 'Quote', title: cut(q.text, 80), body: `“${q.text}”${q.comment ? `\n\n*${q.comment}*` : ''}`,
      facts: docFacts([['From', doc?.name ?? ''], ['Page', q.page], ['Source', ref ? formatCitation(ref, 'APA') : ''], ['Tags', q.tags.join(', ')]]), links: [{ label: 'Open quotes', to: '/quotes' }, ...(doc ? [{ label: 'Open in document', to: `/documents/${doc.id}?at=${q.start}` }] : [])] };
  }
  if (kind === 'ann') {
    const an = d.annotations.find(v => v.id === a); if (!an) return null; const doc = d.docs.find(v => v.id === an.docId);
    return { icon: '🖍', kind: 'Highlight', title: cut(an.quote, 80), body: `“${an.quote}”${an.note ? `\n\n**Your note:** ${an.note}` : ''}`,
      facts: docFacts([['Document', doc?.name ?? ''], ['Page', doc?.ext === 'pdf' ? String(an.page) : ''], ['Type', an.kind], ['Glossary', d.terms.find(v => v.id === an.termId)?.term ?? ''], ['Tags', an.tags.join(', ')]]),
      links: [{ label: 'Show in document', to: `/documents/${an.docId}?at=${an.start}` }] };
  }
  if (kind === 'task') {
    const t = d.tasks.find(v => v.id === a); if (!t) return null; const sub = t.subtasks;
    return { icon: '☑', kind: 'Task', title: t.title, subtitle: [modName(t.moduleId), t.type].filter(Boolean).join(' · '), body: [t.desc, sub.length ? sub.map(s => `- [${s.done ? 'x' : ' '}] ${s.t}`).join('\n') : ''].filter(Boolean).join('\n\n') || undefined,
      facts: docFacts([['Status', t.status], ['Due', t.due ? fmtD(t.due) : ''], ['Priority', ['', 'low', 'medium', 'high'][t.priority]], ['Estimate', t.estimate ? `${t.estimate} min` : ''], ['Spent', t.spent ? `${t.spent} min` : '']]), links: [{ label: 'Open tasks', to: '/tasks' }] };
  }
  if (kind === 'proj') {
    const p = d.projects.find(v => v.id === a); if (!p) return null;
    return { icon: '🎓', kind: 'Thesis project', title: p.title, subtitle: p.supervisor ? 'Supervisor: ' + p.supervisor : undefined, body: [p.question && `**Research question:** ${p.question}`, p.scope].filter(Boolean).join('\n\n') || p.description || undefined,
      facts: docFacts([['Deadline', p.deadline ? fmtD(p.deadline) : ''], ['Chapters', String(p.chapters.length)], ['Sources', String(d.refs.filter(r => r.projectId === p.id).length)], ['Milestones', `${p.milestones.filter(m => m.done).length}/${p.milestones.length} done`]]), links: [{ label: 'Open project', to: '/thesis/' + p.id }] };
  }
  if (kind === 'chap') {
    const p = d.projects.find(v => v.id === a), c = p?.chapters.find(v => v.id === b); if (!p || !c) return null;
    return { icon: '§', kind: 'Chapter', title: c.title, subtitle: p.title, body: c.notes || undefined, facts: docFacts([['Status', c.status], ['Words', c.target ? `${c.words} / ${c.target}` : String(c.words)], ['Sources', String(d.refs.filter(r => r.chapterId === c.id).length)]]), links: [{ label: 'Open project', to: '/thesis/' + p.id }] };
  }
  if (kind === 'ref') {
    const r = d.refs.find(v => v.id === a); if (!r) return null; const p = d.projects.find(v => v.id === r.projectId);
    return { icon: '📚', kind: 'Source', title: r.title, subtitle: [r.authors, r.year].filter(Boolean).join(' · '), body: [formatCitation(r, p?.style ?? 'APA'), r.quotes && `**Findings & quotations:** ${r.quotes}`].filter(Boolean).join('\n\n'),
      facts: docFacts([['Topic', r.topic], ['Reading', r.status], ['File', d.docs.find(v => v.id === r.docId)?.name ?? '']]), links: [{ label: 'Open in thesis', to: '/thesis/' + r.projectId }] };
  }
  if (kind === 'card') {
    const f = d.flashcards.find(v => v.id === a); if (!f) return null;
    return { icon: '🧠', kind: 'Flashcard', title: cut(f.front, 80), body: `**Q:** ${f.front}\n\n**A:** ${f.back}`, facts: docFacts([['Module', modName(f.moduleId)], ['Next review', f.due], ['Confidence', f.confidence + '%']]), links: [{ label: 'Open study', to: '/study' }] };
  }
  return null;
}
