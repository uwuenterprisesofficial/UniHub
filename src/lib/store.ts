import { create } from 'zustand';
import type { CalEvent, Data, DocMeta, Module, Note, Settings, Task } from './types';
import { uid } from './util';

export const defaultSettings = (): Settings => ({
  icsFeeds: [],
  semesters: ['Semester 1'], currentSemester: 'Semester 1',
  stages: ['Not started', 'Research', 'Drafting', 'Review', 'Done'],
  widgets: { today: true, deadlines: true, overdue: true, progress: true, recent: true, week: true, notifications: true },
  dateFormat: 'ISO', weekStart: 1, defaultPriority: 2, theme: 'auto', reminders: true, dailyHours: 4, autoAnalyze: true, ocr: true, ocrLangs: 'eng',
});
const empty = (): Data => ({ modules: [], events: [], tasks: [], notes: [], docs: [], flashcards: [], projects: [], refs: [], annotations: [], terms: [], quotes: [], sessions: [], settings: defaultSettings() });

type Col = 'modules' | 'events' | 'tasks' | 'notes' | 'docs' | 'flashcards' | 'projects' | 'refs' | 'annotations' | 'terms' | 'quotes' | 'sessions';
type Item<C extends Col> = Data[C][number];

export const COLS: Col[] = ['modules', 'events', 'tasks', 'notes', 'docs', 'flashcards', 'projects', 'refs', 'annotations', 'terms', 'quotes', 'sessions'];
interface Store extends Data {
  /** Deletion markers "col:id" -> time, so deletes can be synced to other devices. */
  tomb: Record<string, number>;
  add: <C extends Col>(col: C, obj: Omit<Item<C>, 'id'> & { id?: string }) => Item<C>;
  update: <C extends Col>(col: C, id: string, patch: Partial<Item<C>>) => void;
  remove: (col: Col, id: string) => void;
  setSettings: (p: Partial<Settings>) => void;
  replaceAll: (d: Data) => void;
  reset: () => void;
}
const stampAll = (d: Data, u: number): Partial<Data> => {
  const o: Record<string, unknown> = {};
  for (const c of COLS) o[c] = (d[c] as { u?: number }[]).map(x => ({ ...x, u }));
  return o as Partial<Data>;
};

/* The server is the source of truth: this store is the in-memory working copy of the signed-in account's workspace (filled by the sync engine,
   pushed back within a fraction of a second). It is deliberately not persisted on this device. */
export const useStore = create<Store>()((set, get) => ({
  ...empty(),
  tomb: {},
  add: (col, obj) => {
    const item = { ...obj, id: obj.id || uid(), u: Date.now() } as Item<typeof col>;
    set({ [col]: [...(get()[col] as unknown[]), item] } as Partial<Store>);
    return item;
  },
  update: (col, id, patch) =>
    set({ [col]: (get()[col] as { id: string }[]).map(x => x.id === id ? { ...x, ...patch, u: Date.now() } : x) } as Partial<Store>),
  remove: (col, id) => set({
    [col]: (get()[col] as { id: string }[]).filter(x => x.id !== id),
    tomb: { ...get().tomb, [`${col}:${id}`]: Date.now() },
  } as Partial<Store>),
  setSettings: p => set({ settings: { ...get().settings, ...p, u: Date.now() } }),
  replaceAll: d => {
    const full = { ...empty(), ...d, settings: { ...defaultSettings(), ...d.settings, widgets: { ...defaultSettings().widgets, ...d.settings?.widgets } } };
    set({ ...full, ...stampAll(full, Date.now()), tomb: {} });
  },
  reset: () => {
    const s = get(), now = Date.now(), tomb = { ...s.tomb };
    for (const c of COLS) (s[c] as { id: string }[]).forEach(x => { tomb[`${c}:${x.id}`] = now; });
    set({ ...empty(), tomb });
  },
}));

export const getData = (): Data => {
  const { modules, events, tasks, notes, docs, settings, flashcards, projects, refs, annotations, terms, quotes, sessions } = useStore.getState();
  return { modules, events, tasks, notes, docs, settings, flashcards, projects, refs, annotations, terms, quotes, sessions };
};

/* ---- derived helpers ---- */
export const useModule = (id: string) => useStore(s => s.modules.find(m => m.id === id));
export const modColor = (mods: Module[], id: string) => mods.find(m => m.id === id)?.color ?? '#64748b';
export const modName = (mods: Module[], id: string) => mods.find(m => m.id === id)?.name ?? 'No module';
export const doneStage = (s: Settings) => s.stages[s.stages.length - 1];
export const isDone = (t: Task, s: Settings) => t.status === doneStage(s);
export const typeColors: Record<string, string> = { lecture: '#4f46e5', seminar: '#0891b2', exam: '#dc2626', study: '#16a34a', office: '#d97706', other: '#64748b' };
export const eventColor = (ev: CalEvent, mods: Module[]) => mods.find(m => m.id === ev.moduleId)?.color ?? typeColors[ev.type] ?? '#64748b';
export const progressOf = (d: Data, moduleId: string) => {
  const ts = d.tasks.filter(t => t.moduleId === moduleId);
  return ts.length ? Math.round(ts.filter(t => isDone(t, d.settings)).length / ts.length * 100) : 0;
};

export function newTask(p: Partial<Task> = {}): Omit<Task, 'id'> {
  const s = useStore.getState().settings;
  return { title: '', desc: '', moduleId: '', type: 'Homework', due: '', start: '', priority: s.defaultPriority, status: s.stages[0], estimate: 0, spent: 0, subtasks: [], docIds: [], noteIds: [], link: '', ...p };
}
export function newNote(p: Partial<Note> = {}): Omit<Note, 'id'> {
  return { title: 'Untitled note', body: '', moduleId: '', tags: [], pinned: false, updated: Date.now(), ...p };
}
export type { DocMeta };

/** Remove all local data without recording deletions (used when switching accounts). */
export const wipeLocal = () => useStore.setState({ ...empty(), tomb: {} });
export const hasLocalData = () => { const s = useStore.getState(); return COLS.some(c => s[c].length > 0); };
