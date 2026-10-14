import { createElement as h, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import { BackLink } from '../src/components/BackLink';
import { beforeEach, describe, expect, it } from 'vitest';
import { describePath, previousPath, recordLocation, useUrlParams, useUrlState } from '../src/lib/nav';
import { getData, useStore, wipeLocal } from '../src/lib/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(routes: { path: string; el: ReactNode }[], start: string[]) {
  const router = createMemoryRouter(routes.map(r => ({ path: r.path, element: r.el })), { initialEntries: start });
  const box = document.createElement('div'); document.body.append(box); const root = createRoot(box);
  act(() => { root.render(h(RouterProvider, { router })); });
  return { router, box, done: () => act(() => root.unmount()) };
}
const path = (r: { state: { location: { pathname: string; search: string } } }) => r.state.location.pathname + r.state.location.search;

describe('view state in the address', () => {
  let setTab: (v: 'notes' | 'docs' | 'summary') => void = () => { }, tabNow = '', setMany: (p: Record<string, string | undefined>) => void = () => { };
  const Page = () => { const [tab, set] = useUrlState<'notes' | 'docs' | 'summary'>('tab', 'notes', ['notes', 'docs', 'summary']); setTab = set; tabNow = tab; setMany = useUrlParams(); const l = useLocation(); return h('div', {}, l.search); };
  const routes = [{ path: '/ws', el: h(Page) }, { path: '/doc/:id', el: h('div', {}, 'doc') }];

  it('reads the tab from the address, falls back to the default for missing or unknown values', () => {
    for (const [url, want] of [['/ws', 'notes'], ['/ws?tab=docs', 'docs'], ['/ws?tab=bogus', 'notes'], ['/ws?s=7&tab=summary', 'summary']] as const) {
      const m = mount(routes, [url]); expect(tabNow, url).toBe(want); m.done();
    }
  });
  it('changing a tab replaces the history entry (Back leaves the page, not the previous tab) and keeps other parameters', () => {
    const m = mount(routes, ['/ws?s=lecture1']);
    act(() => setTab('docs')); expect(path(m.router)).toBe('/ws?s=lecture1&tab=docs'); expect(m.router.state.historyAction).toBe('REPLACE');
    act(() => setTab('notes')); expect(path(m.router)).toBe('/ws?s=lecture1'); // the default is not written to the address
    act(() => setMany({ s: 'lecture2', tab: 'summary' })); expect(path(m.router)).toBe('/ws?s=lecture2&tab=summary');
    act(() => setMany({ tab: undefined })); expect(path(m.router)).toBe('/ws?s=lecture2'); m.done();
  });

  it('Lectures → Documents tab → open a document → Back returns to the Documents tab of that lecture', () => {
    const m = mount(routes, ['/dashboard-ish', '/ws?s=today']);
    act(() => { void m.router.navigate('/ws?s=today'); });
    act(() => setTab('docs'));                                   // on the lecture's Documents tab
    act(() => { void m.router.navigate('/doc/42'); });           // open a document from there
    expect(path(m.router)).toBe('/doc/42');
    act(() => { void m.router.navigate(-1); });                  // Back
    expect(path(m.router)).toBe('/ws?s=today&tab=docs'); expect(tabNow).toBe('docs'); m.done();
  });
});

describe('where Back goes', () => {
  beforeEach(() => { wipeLocal(); window.history.replaceState({ idx: 0 }, ''); });
  it('knows the previous page by history position and says nothing when there is none', () => {
    window.history.replaceState({ idx: 0 }, ''); recordLocation('/modules/m1/workspace?s=a&tab=docs'); expect(previousPath()).toBeUndefined();
    window.history.replaceState({ idx: 1 }, ''); recordLocation('/documents/d1'); expect(previousPath()).toBe('/modules/m1/workspace?s=a&tab=docs');
    window.history.replaceState({ idx: 2 }, ''); recordLocation('/glossary/t1'); expect(previousPath()).toBe('/documents/d1');
    window.history.replaceState({ idx: 1 }, ''); expect(previousPath()).toBe('/modules/m1/workspace?s=a&tab=docs'); // after going back one step
  });

  it('describes pages in words, including the tab and lecture', () => {
    const st = useStore.getState();
    const m = st.add('modules', { name: 'Algorithms', code: 'CS201', lecturer: '', email: '', semester: 's', ects: 5, room: '', link: '', exam: '', color: '#000', icon: '', objectives: '', grades: [] });
    const s = st.add('sessions', { moduleId: m.id, date: '2026-10-13', title: '', topic: '', eventId: '', status: 'open', docIds: [], summary: '', summarySource: '', summaryEdited: false, summaryAt: 0, created: 0 });
    const doc = st.add('docs', { name: 'Slides.pdf', ext: 'pdf', mime: '', size: 1, moduleId: m.id, folder: '', tags: [], fav: false, added: 0, opened: 0, text: '', read: false, versions: [] });
    const note = st.add('notes', { title: 'My note', body: '', moduleId: '', tags: [], pinned: false, updated: 0 });
    const term = st.add('terms', { term: 'Heap', aliases: [], definition: '', moduleId: '', status: 'confirmed', auto: false, sourceDocId: '', created: 0 });
    expect(getData().modules).toHaveLength(1);
    expect(describePath(`/modules/${m.id}/workspace?s=${s.id}&tab=docs`)).toBe('CS201 lectures · 2026-10-13 · Documents');
    expect(describePath(`/modules/${m.id}/workspace`)).toBe('CS201 lectures'); expect(describePath(`/modules/${m.id}?tab=graph`)).toBe('Algorithms · Graph'); expect(describePath(`/modules/${m.id}`)).toBe('Algorithms');
    expect(describePath(`/documents/${doc.id}?view=original`)).toBe('Slides.pdf · Original'); expect(describePath('/documents')).toBe('Documents'); expect(describePath(`/notes/${note.id}`)).toBe('My note');
    expect(describePath(`/glossary/${term.id}`)).toBe('Heap'); expect(describePath('/')).toBe('Dashboard'); expect(describePath('/graph?focus=x')).toBe('Knowledge graph'); expect(describePath('/knowledge?q=heap')).toBe('Knowledge base');
    expect(describePath('/documents/gone')).toBe('Document'); expect(describePath('/somewhere/else')).toBe('previous page');
  });
});

describe('BackLink', () => {
  beforeEach(() => { wipeLocal(); window.history.replaceState({ idx: 0 }, ''); });
  const render = () => { const box = document.createElement('div'); document.body.append(box); const root = createRoot(box); act(() => { root.render(h(MemoryRouter, {}, h(BackLink, { fallback: '/documents', label: 'Documents' }))); }); return { text: () => box.textContent, href: () => box.querySelector('a')?.getAttribute('href'), done: () => act(() => root.unmount()) }; };

  it('with no history (a bookmark or a new tab) goes to the parent page and says so', () => {
    window.history.replaceState({ idx: 0 }, ''); const r = render(); expect(r.text()).toBe('← Documents'); expect(r.href()).toBe('#/documents'); r.done();
  });
  it('with history says where it will really go, including the tab and lecture', () => {
    const st = useStore.getState();
    const m = st.add('modules', { name: 'Algorithms', code: 'CS201', lecturer: '', email: '', semester: 's', ects: 5, room: '', link: '', exam: '', color: '#000', icon: '', objectives: '', grades: [] });
    const s = st.add('sessions', { moduleId: m.id, date: '2026-10-13', title: '', topic: '', eventId: '', status: 'open', docIds: [], summary: '', summarySource: '', summaryEdited: false, summaryAt: 0, created: 0 });
    window.history.replaceState({ idx: 3 }, ''); recordLocation(`/modules/${m.id}/workspace?s=${s.id}&tab=docs`); window.history.replaceState({ idx: 4 }, '');
    const r = render(); expect(r.text()).toBe('← Back to CS201 lectures · 2026-10-13 · Documents'); expect(r.href()).toBe(`#/modules/${m.id}/workspace?s=${s.id}&tab=docs`); r.done();
  });
  it('still offers a plain "Back" when the previous page is unknown (history exists but this session lost track)', () => {
    window.history.replaceState({ idx: 9 }, ''); const r = render(); expect(r.text()).toBe('← Back'); r.done();
  });
});
