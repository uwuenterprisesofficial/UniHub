import { beforeEach, describe, expect, it, vi } from 'vitest';

let body = '';
vi.mock('../src/lib/sync', () => ({ fetchFeedText: async () => { if (body === 'THROW') throw new Error('Could not reach the calendar server.'); return body; } }));
import { feedEventId, refreshDueFeeds, removeFeed, syncFeed } from '../src/lib/feeds';
import { useStore, wipeLocal } from '../src/lib/store';

const vevent = (uid: string, title: string, start = '20260302T100000', extra = '') => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${title}\r\nDTSTART:${start}\r\nDTEND:${start.slice(0, 9)}113000\r\n${extra}END:VEVENT\r\n`;
const cal = (...e: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${e.join('')}END:VCALENDAR\r\n`;
const feedEvents = () => useStore.getState().events.filter(e => e.feed === 'F1');

beforeEach(() => {
  wipeLocal();
  useStore.getState().setSettings({ icsFeeds: [{ id: 'F1', name: 'Timetable', url: 'https://x.test/c.ics', moduleId: 'mod1', lastSync: 0, lastCount: 0, error: '' }] });
});

describe('calendar subscriptions', () => {
  it('imports events with stable ids and links them to the chosen module', async () => {
    body = cal(vevent('a', 'Algorithms lecture'), vevent('b', 'Statistics seminar', '20260303T140000'));
    expect(await syncFeed('F1')).toEqual({ added: 2, updated: 0, removed: 0, total: 2 });
    expect(feedEvents().map(e => e.id).sort()).toEqual([feedEventId('F1', 'a'), feedEventId('F1', 'b')].sort());
    expect(feedEvents().every(e => e.moduleId === 'mod1' && e.feed === 'F1')).toBe(true);
    const f = useStore.getState().settings.icsFeeds[0]; expect(f.lastCount).toBe(2); expect(f.lastSync).toBeGreaterThan(0); expect(f.error).toBe('');
  });

  it('updates in place, adds new events, removes cancelled ones — and leaves other events alone', async () => {
    useStore.getState().add('events', { title: 'My own event', type: 'study', moduleId: '', date: '2026-03-02', start: '18:00', end: '19:00', location: '', desc: '', repeat: 'none', until: '', exceptions: [], reminder: '' });
    body = cal(vevent('a', 'Algorithms lecture'), vevent('b', 'Seminar')); await syncFeed('F1');
    const idA = feedEventId('F1', 'a');
    body = cal(vevent('a', 'Algorithms lecture (Room changed)', '20260302T110000'), vevent('c', 'New workshop', '20260304T090000')); // b removed, c added
    expect(await syncFeed('F1')).toEqual({ added: 1, updated: 1, removed: 1, total: 2 });
    const a = feedEvents().find(e => e.id === idA)!; expect(a.title).toBe('Algorithms lecture (Room changed)'); expect(a.start).toBe('11:00');
    expect(feedEvents().map(e => e.title).sort()).toEqual(['Algorithms lecture (Room changed)', 'New workshop']);
    expect(useStore.getState().events.some(e => e.title === 'My own event')).toBe(true);
    expect(useStore.getState().events).toHaveLength(3);
  });

  it('does nothing when nothing changed, and keeps the user’s module link and reminder across refreshes', async () => {
    body = cal(vevent('a', 'Lecture')); await syncFeed('F1');
    const id = feedEventId('F1', 'a'); useStore.getState().update('events', id, { moduleId: 'mine', reminder: 30 });
    const before = useStore.getState().events.find(e => e.id === id)!.u;
    expect(await syncFeed('F1')).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(useStore.getState().events.find(e => e.id === id)!.u).toBe(before); // untouched → nothing to sync to other devices
    body = cal(vevent('a', 'Lecture renamed')); await syncFeed('F1');
    expect(useStore.getState().events.find(e => e.id === id)).toMatchObject({ title: 'Lecture renamed', moduleId: 'mine', reminder: 30 });
  });

  it('never wipes the calendar because of a failed or bogus response', async () => {
    body = cal(vevent('a', 'Lecture')); await syncFeed('F1');
    body = '<html>Sign in to continue</html>'; await expect(syncFeed('F1')).rejects.toThrow(/did not return a calendar/);
    expect(feedEvents()).toHaveLength(1); expect(useStore.getState().settings.icsFeeds[0].error).toMatch(/did not return a calendar/);
    body = 'THROW'; await expect(syncFeed('F1')).rejects.toThrow(/Could not reach/); expect(feedEvents()).toHaveLength(1);
    body = cal(vevent('a', 'Lecture')); await syncFeed('F1'); expect(useStore.getState().settings.icsFeeds[0].error).toBe(''); // error clears on success
  });

  it('treats an empty but valid calendar as "everything was removed"', async () => {
    body = cal(vevent('a', 'Lecture')); await syncFeed('F1'); body = cal(); expect(await syncFeed('F1')).toMatchObject({ removed: 1, total: 0 }); expect(feedEvents()).toEqual([]);
  });

  it('removing a subscription deletes its events (and records the deletions for sync) but not others', async () => {
    useStore.getState().add('events', { title: 'Keep me', type: 'other', moduleId: '', date: '2026-03-02', start: '', end: '', location: '', desc: '', repeat: 'none', until: '', exceptions: [], reminder: '' });
    body = cal(vevent('a', 'Lecture'), vevent('b', 'Seminar')); await syncFeed('F1');
    const ids = feedEvents().map(e => e.id); removeFeed('F1');
    expect(useStore.getState().events.map(e => e.title)).toEqual(['Keep me']); expect(useStore.getState().settings.icsFeeds).toEqual([]);
    for (const id of ids) expect(useStore.getState().tomb['events:' + id]).toBeGreaterThan(0);
  });

  it('refreshes only subscriptions that are older than six hours', async () => {
    body = cal(vevent('a', 'Lecture')); await syncFeed('F1');
    body = cal(vevent('a', 'Lecture'), vevent('z', 'Late addition'));
    await refreshDueFeeds(); expect(feedEvents()).toHaveLength(1); // fresh → skipped
    const s = useStore.getState().settings; useStore.getState().setSettings({ icsFeeds: s.icsFeeds.map(f => ({ ...f, lastSync: Date.now() - 7 * 3600_000 })) });
    await refreshDueFeeds(); expect(feedEvents()).toHaveLength(2);
  });
});
