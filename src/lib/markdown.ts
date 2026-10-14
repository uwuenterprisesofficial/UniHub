import type { Note } from './types';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const FENCE = '`'.repeat(3);
function inline(s: string, notes: Note[]) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[\[([^\]]+)\]\]/g, (_, t: string) => {
      const n = notes.find(n => n.title.toLowerCase() === t.trim().toLowerCase());
      return n ? `<a class="wiki" href="#/notes/${n.id}">${t}</a>` : `<a class="wiki missing" href="#/notes?new=${encodeURIComponent(t)}" title="Create this note">${t}</a>`;
    })
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([^\]]+)\]\((#[^)\s]+)\)/g, '<a href="$2">$1</a>');
}
export function md(src: string, notes: Note[]): string {
  const out: string[] = []; let list: 'ul' | 'ol' | null = null, code = false; const buf: string[] = [];
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const open = (t: 'ul' | 'ol') => { if (list !== t) { close(); out.push(`<${t}>`); list = t; } };
  for (const ln of esc(src || '').split('\n')) {
    if (ln.startsWith(FENCE)) {
      if (code) { out.push('<pre><code>' + buf.splice(0).join('\n') + '</code></pre>'); code = false; } else { close(); code = true; }
      continue;
    }
    if (code) { buf.push(ln); continue; }
    let m: RegExpMatchArray | null;
    if ((m = ln.match(/^(#{1,3})\s+(.*)/))) { close(); out.push(`<h${m[1].length}>${inline(m[2], notes)}</h${m[1].length}>`); }
    else if ((m = ln.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/i))) { open('ul'); out.push(`<li class="task"><input type="checkbox" disabled ${m[1] !== ' ' ? 'checked' : ''}> ${inline(m[2], notes)}</li>`); }
    else if ((m = ln.match(/^\s*[-*]\s+(.*)/))) { open('ul'); out.push(`<li>${inline(m[1], notes)}</li>`); }
    else if ((m = ln.match(/^\s*\d+\.\s+(.*)/))) { open('ol'); out.push(`<li>${inline(m[1], notes)}</li>`); }
    else if ((m = ln.match(/^&gt;\s?(.*)/))) { close(); out.push(`<blockquote>${inline(m[1], notes)}</blockquote>`); }
    else if (!ln.trim()) close();
    else { close(); out.push(`<p>${inline(ln, notes)}</p>`); }
  }
  close(); if (code) out.push('<pre><code>' + buf.join('\n') + '</code></pre>');
  return out.join('\n');
}

/** Turn glossary terms inside rendered HTML into links (text nodes only; never inside links or code). */
export function linkTerms(html: string, terms: { id: string; term: string; aliases: string[]; definition: string }[]): string {
  const map = new Map<string, { id: string; def: string }>();
  for (const t of terms) for (const f of [t.term, ...t.aliases]) { const k = f.trim().toLowerCase(); if (k.length > 1) map.set(k, { id: t.id, def: t.definition }); }
  if (!map.size) return html;
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${alts.join('|')})(?:s|es)?(?![\\p{L}\\p{N}])`, 'giu');
  let depth = 0;
  return html.split(/(<[^>]+>)/).map(part => {
    if (part.startsWith('<')) {
      if (/^<(a|code|pre)\b/i.test(part)) depth++; else if (/^<\/(a|code|pre)>/i.test(part)) depth = Math.max(0, depth - 1);
      return part;
    }
    if (depth) return part;
    return part.replace(re, (m, g: string) => {
      const hit = map.get(g.toLowerCase().replace(/\s+/g, ' ')); if (!hit) return m;
      return `<a class="term" href="#/glossary/${hit.id}" title="${hit.def.replace(/"/g, '&quot;').slice(0, 160)}">${m}</a>`;
    });
  }).join('');
}
