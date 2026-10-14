import { useEffect, useMemo } from 'react';
import { syncVectors, useEmbedCfg } from './embed';
import { useTexts } from './blobs';
import { buildIndex, type Index } from './kb';
import { useStore } from './store';

/** Knowledge index over everything in the workspace; rebuilt only when the underlying data changes. */
export function useIndex(): Index {
  const s = useStore(); const texts = useTexts(x => x.map);
  return useMemo(() => buildIndex({
    modules: s.modules, events: s.events, tasks: s.tasks, notes: s.notes, docs: s.docs, flashcards: s.flashcards, projects: s.projects,
    refs: s.refs, annotations: s.annotations, terms: s.terms, quotes: s.quotes, sessions: s.sessions, settings: s.settings,
  }, texts),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [s.modules, s.events, s.tasks, s.notes, s.docs, s.flashcards, s.projects, s.refs, s.annotations, s.terms, s.quotes, s.sessions, texts]);
}

/** Keeps the vector index up to date while a page that uses it is open (debounced). */
export function useVectorSync(idx: Index) {
  const enabled = useEmbedCfg(s => s.enabled), backend = useEmbedCfg(s => s.backend), model = useEmbedCfg(s => s.localModel), pm = useEmbedCfg(s => s.providerModel);
  useEffect(() => {
    if (!enabled) return; const t = setTimeout(() => { void syncVectors(idx.chunks); }, 1500); return () => clearTimeout(t);
  }, [idx, enabled, backend, model, pm]);
}
