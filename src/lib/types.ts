export type ID = string;
export type EventType = 'lecture' | 'seminar' | 'exam' | 'study' | 'office' | 'other';
export type Repeat = 'none' | 'daily' | 'weekly' | 'biweekly';

export interface Grade { id: ID; u?: number; name: string; weight: number; score: number; max: number }
export interface Module {
  id: ID; u?: number; name: string; code: string; lecturer: string; email: string; semester: string; ects: number | '';
  room: string; link: string; exam: string; color: string; icon: string; objectives: string; grades: Grade[];
}
export interface CalEvent {
  id: ID; u?: number; title: string; type: EventType; moduleId: ID; date: string; start: string; end: string;
  location: string; desc: string; repeat: Repeat; until: string; exceptions: string[]; reminder: number | '';
  /** Set for events that come from a calendar subscription: which feed, and the event's id inside that feed. */
  feed?: ID; uid?: string;
}
export interface Subtask { t: string; done: boolean }
export interface Task {
  id: ID; u?: number; title: string; desc: string; moduleId: ID; type: string; due: string; start: string; priority: 1 | 2 | 3;
  status: string; estimate: number; spent: number; subtasks: Subtask[]; docIds: ID[]; noteIds: ID[]; link: string; doneAt?: number | null;
}
export interface Note {
  id: ID; u?: number; title: string; body: string; moduleId: ID; tags: string[]; pinned: boolean; updated: number; eventId?: ID; date?: string; sessionId?: ID;
}
export interface DocVersion { blobKey: string; size: number; added: number }
export interface DocMeta {
  id: ID; u?: number; name: string; ext: string; mime: string; size: number; moduleId: ID; folder: string; tags: string[]; fav: boolean;
  added: number; opened: number; text: string; versions: DocVersion[]; read: boolean;
}
export interface IcsFeed { id: ID; name: string; url: string; moduleId: ID; lastSync: number; lastCount: number; error: string }
export interface Settings {
  icsFeeds: IcsFeed[];
  u?: number;
  semesters: string[]; currentSemester: string; stages: string[];
  widgets: Record<'today' | 'deadlines' | 'overdue' | 'progress' | 'recent' | 'week' | 'notifications', boolean>;
  dateFormat: 'ISO' | 'DMY' | 'MDY'; weekStart: 0 | 1; defaultPriority: 1 | 2 | 3; theme: 'auto' | 'light' | 'dark';
  reminders: boolean; dailyHours: number; autoAnalyze: boolean; ocr: boolean; ocrLangs: string;
}
export interface Flashcard {
  id: ID; u?: number; front: string; back: string; moduleId: ID; noteId?: ID; ease: number; interval: number; due: string; reps: number; lapses: number; confidence: number;
}
export interface Chapter { id: ID; u?: number; title: string; status: 'todo' | 'research' | 'drafting' | 'review' | 'done'; words: number; target: number; notes: string }
export interface Milestone { id: ID; u?: number; title: string; date: string; done: boolean }
export interface Feedback { id: ID; u?: number; text: string; date: string; done: boolean }
export interface Project {
  id: ID; u?: number; title: string; description: string; question: string; scope: string; supervisor: string; supervisorEmail: string;
  deadline: string; requirements: string; style: 'APA' | 'IEEE' | 'Chicago'; chapters: Chapter[]; milestones: Milestone[]; feedback: Feedback[]; openQuestions: string;
}
export interface Ref {
  id: ID; u?: number; projectId: ID; type: 'article' | 'book' | 'inproceedings' | 'misc'; key: string; authors: string; title: string; year: string;
  journal: string; volume: string; pages: string; publisher: string; doi: string; url: string; docId: ID; topic: string; status: 'to-read' | 'reading' | 'read'; quotes: string; chapterId: ID;
}
/** One lecture / working day of a module. Notes link to it with Note.sessionId; documents are attached here. */
export interface Session {
  id: ID; u?: number; moduleId: ID; date: string; title: string; topic: string; eventId: ID; status: 'planned' | 'open' | 'done';
  docIds: ID[]; summary: string; summarySource: '' | 'extract' | 'ai'; summaryEdited: boolean; summaryAt: number; created: number;
}
export type AnnKind = 'highlight' | 'term' | 'note' | 'important' | 'unclear' | 'research';
export interface Annotation {
  id: ID; u?: number; docId: ID; start: number; end: number; quote: string; kind: AnnKind; color: string; note: string; termId: ID; tags: string[]; page: number; created: number;
}
export interface Term {
  id: ID; u?: number; term: string; aliases: string[]; definition: string; moduleId: ID; status: 'suggested' | 'confirmed'; auto: boolean; sourceDocId: ID; created: number;
}
export interface Quote {
  id: ID; u?: number; text: string; docId: ID; refId: ID; page: string; annotationId: ID; moduleId: ID; projectId: ID; chapterId: ID; tags: string[]; comment: string;
  status: 'suggested' | 'saved'; auto: boolean; score: number; start: number; created: number;
}
export interface Data {
  modules: Module[]; events: CalEvent[]; tasks: Task[]; notes: Note[]; docs: DocMeta[]; settings: Settings;
  flashcards: Flashcard[]; projects: Project[]; refs: Ref[];
  annotations: Annotation[]; terms: Term[]; quotes: Quote[]; sessions: Session[];
}
export interface Occurrence { ev: CalEvent; date: string }
