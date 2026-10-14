import { blobs, texts } from './blobs';
import { useStore } from './store';
import { addDays, diffDays, today, uid, weekStart } from './util';

export function loadSample() {
  const st = useStore.getState(); const s = st.settings;
  const t = today(), D = (n: number) => addDays(t, n), wsOff = diffDays(weekStart(t, s.weekStart), t);
  const M = (name: string, code: string, color: string, icon: string, lecturer: string, ects: number, room: string, exam: string) =>
    st.add('modules', { name, code, color, icon, lecturer, email: lecturer.split(' ').pop()!.toLowerCase() + '@uni.edu', semester: s.currentSemester, ects, room, link: '', exam, objectives: '', grades: [] });
  const algo = M('Algorithms & Data Structures', 'CS201', '#4f46e5', '🧮', 'Prof. Weber', 6, 'Hall A', 'Written exam, 90 min');
  const stat = M('Statistics II', 'MA210', '#0891b2', '📊', 'Dr. Okafor', 5, 'Room 2.14', 'Written exam + project');
  const phil = M('Philosophy of Science', 'PH101', '#d97706', '🧠', 'Prof. Lindqvist', 3, 'Seminar room 5', 'Essay');
  st.update('modules', algo.id, { grades: [{ id: uid(), name: 'Midterm', weight: 30, score: 78, max: 100 }] });
  const E = (title: string, type: 'lecture' | 'seminar' | 'exam' | 'study', moduleId: string, off: number, start: string, end: string, rep: 'weekly' | 'none', location: string) =>
    st.add('events', { title, type, moduleId, date: D(off), start, end, repeat: rep, until: rep === 'weekly' ? D(off + 98) : '', location, desc: '', exceptions: [], reminder: 15 });
  E('Algorithms lecture', 'lecture', algo.id, wsOff, '10:00', '11:30', 'weekly', 'Hall A');
  E('Statistics seminar', 'seminar', stat.id, wsOff + 1, '10:30', '12:00', 'weekly', 'Room 2.14');
  E('Philosophy seminar', 'seminar', phil.id, wsOff + 2, '14:00', '15:30', 'weekly', 'Seminar room 5');
  E('Algorithms exercise', 'seminar', algo.id, wsOff + 3, '09:00', '10:30', 'weekly', 'Lab 3');
  E('Study session: graphs', 'study', algo.id, 1, '16:00', '18:00', 'none', '');
  E('Statistics midterm', 'exam', stat.id, 18, '09:00', '10:30', 'none', 'Hall B');
  const sg = s.stages;
  const T = (title: string, moduleId: string, type: string, due: string, priority: 1 | 2 | 3, status: string, estimate: number, subs: string[] = []) =>
    st.add('tasks', { title, desc: '', moduleId, type, due, start: '', priority, status, estimate, spent: 0, subtasks: subs.map(t => ({ t, done: false })), docIds: [], noteIds: [], link: '' });
  T('Problem set 4 – graph algorithms', algo.id, 'Homework', D(2), 3, sg[1], 180, ['Dijkstra proof', 'Implement BFS', 'Runtime analysis']);
  T('Read chapter 7: hypothesis testing', stat.id, 'Reading', D(1), 2, sg[0], 90);
  T('Essay: Popper vs. Kuhn', phil.id, 'Essay', D(9), 3, sg[2], 360, ['Outline', 'First draft', 'Proofread']);
  T('Prepare for statistics midterm', stat.id, 'Exam preparation', D(17), 2, sg[0], 480);
  T('Re-register for housing', '', 'Administrative', D(-2), 2, sg[0], 30);
  T('Group project proposal', algo.id, 'Group project', D(5), 2, sg[3], 120);
  st.add('notes', { title: 'Dijkstra – key ideas', moduleId: algo.id, tags: ['graphs', 'lecture'], pinned: true, updated: Date.now(), body: '# Dijkstra\n\n- Greedy: always expand the closest unvisited node\n- Needs **non-negative** weights\n- Runtime `O((V+E) log V)` with a binary heap\n\nSee also [[Graph glossary]].\n\n- [ ] Review proof of correctness' });
  st.add('notes', { title: 'Graph glossary', moduleId: algo.id, tags: ['glossary'], pinned: false, updated: Date.now(), body: '**Vertex** – a node.\n\n**Edge** – a connection between two vertices.\n\n- Vertex :: A node in a graph\n- Edge :: A connection between two vertices\n- Dijkstra :: Shortest-path algorithm for non-negative edge weights\n- BFS :: Breadth-first search, shortest paths in unweighted graphs\n- Heap :: Tree structure with O(log n) insert and extract-min\n\nBack to [[Dijkstra – key ideas]].' });
  [['Dijkstra\'s algorithm', ['Dijkstra'], 'Algorithm that finds shortest paths from a source in a graph with non-negative edge weights.'],
   ['Priority queue', [], 'A data structure that supports insert and extract-min operations.'],
   ['Binary heap', ['heap'], 'A tree-based structure that implements a priority queue with logarithmic insert and extract-min.']]
    .forEach(([term, aliases, definition]) => st.add('terms', { term: term as string, aliases: aliases as string[], definition: definition as string, moduleId: algo.id, status: 'confirmed', auto: false, sourceDocId: '', created: Date.now() }));
  void addSampleDoc(algo.id);
}

async function addSampleDoc(moduleId: string) {
  const text = `# Graph Algorithms: Lecture 4

## 1. Shortest paths

A graph is defined as a set of vertices connected by edges. Shortest path problems occur in routing, navigation and network design. Edsger Dijkstra published his algorithm in 1959, and it is still taught in nearly every algorithms course.

Dijkstra's algorithm finds the shortest path from a source vertex to all other vertices in a weighted graph. It requires non-negative edge weights, because otherwise the greedy choice of the closest unvisited vertex is no longer correct. We show that the greedy strategy is optimal: every vertex that is settled already has its final distance.

## 2. Data structures

A priority queue is a data structure that supports insert and extract-min operations. The binary heap implements a priority queue efficiently, and with a binary heap the runtime of Dijkstra's algorithm is O((V+E) log V). Fibonacci heaps improve this bound to O(E + V log V) in theory, but they are rarely faster in practice.

Breadth-first search (BFS) solves the unweighted case in linear time. It explores the graph layer by layer using a simple queue instead of a priority queue.

## 3. Conclusion

In conclusion, Dijkstra's algorithm remains a fundamental tool for shortest path problems with non-negative weights. Negative edge weights require the Bellman-Ford algorithm, which is slower but more general.
`;
  const f = new File([text], 'CS201 Graph algorithms lecture 4.md', { type: 'text/markdown' });
  const key = 'sample' + Date.now().toString(36);
  await blobs.put(key, f);
  const doc = useStore.getState().add('docs', { name: f.name, ext: 'md', mime: f.type, size: f.size, moduleId, folder: 'Lectures', tags: ['lecture'], fav: false, added: Date.now(), opened: 0, text, read: false, versions: [{ blobKey: key, size: f.size, added: Date.now() }] });
  await texts.set(doc.id, text);
}
