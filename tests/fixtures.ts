import { defaultSettings } from '../src/lib/store';
import type { CalEvent, Data, Task } from '../src/lib/types';
import { addDays, today } from '../src/lib/util';

export const emptyData = (): Data => ({ modules: [], events: [], tasks: [], notes: [], docs: [], flashcards: [], projects: [], refs: [], annotations: [], terms: [], quotes: [], sessions: [], settings: defaultSettings() });
export const D = (n: number) => addDays(today(), n);

let n = 0;
export const task = (p: Partial<Task> = {}): Task => ({ id: 't' + ++n, title: 'Task ' + n, desc: '', moduleId: '', type: 'Homework', due: '', start: '', priority: 2, status: 'Not started', estimate: 0, spent: 0, subtasks: [], docIds: [], noteIds: [], link: '', ...p });
export const event = (p: Partial<CalEvent> = {}): CalEvent => ({ id: 'e' + ++n, title: 'Event ' + n, type: 'lecture', moduleId: '', date: D(0), start: '10:00', end: '11:00', location: '', desc: '', repeat: 'none', until: '', exceptions: [], reminder: '', ...p });
