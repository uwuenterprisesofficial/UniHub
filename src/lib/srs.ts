import type { Flashcard } from './types';
import { addDays, today } from './util';

/** SM-2 style scheduling. grade: 0 again, 1 hard, 2 good, 3 easy. */
export function review(c: Flashcard, grade: 0 | 1 | 2 | 3): Partial<Flashcard> {
  let { ease, interval, reps, lapses } = c;
  if (grade === 0) { reps = 0; lapses++; interval = 0; ease = Math.max(1.3, ease - 0.2); }
  else {
    reps++;
    interval = reps === 1 ? 1 : reps === 2 ? (grade === 1 ? 2 : 4) : Math.round(interval * ease * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1));
    ease = Math.max(1.3, ease + (grade === 3 ? 0.15 : grade === 1 ? -0.15 : 0));
  }
  return { ease, interval, reps, lapses, due: addDays(today(), interval), confidence: Math.min(100, Math.round((reps * 20) + (grade * 5) - lapses * 5)) };
}
export const newCard = (p: Partial<Flashcard> = {}): Omit<Flashcard, 'id'> =>
  ({ front: '', back: '', moduleId: '', ease: 2.5, interval: 0, due: today(), reps: 0, lapses: 0, confidence: 0, ...p });
