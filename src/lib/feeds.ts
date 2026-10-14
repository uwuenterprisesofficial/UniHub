import { parseICS } from './ics';
import { useStore } from './store';
import type { CalEvent } from './types';
import { fetchFeedText } from './sync';

/* Calendar subscriptions (Google "secret address in iCal format", Outlook "published calendar", university timetables).
   Events get stable ids derived from the feed and the event's UID, so a refresh updates them in place — and every device
   that refreshes the same feed produces the same ids, so synced devices never see duplicates. */
export interface FeedStats { added: number; updated: number; removed: number; total: number }

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
export const feedEventId = (feedId: string, uid: string) => `f${feedId}_${fnv(uid)}${uid.length.toString(36)}`;

/** Fields that come from the feed and are overwritten on every refresh; the user's module link and reminder are kept. */
const FEED_FIELDS = ['title', 'type', 'date', 'start', 'end', 'location', 'desc', 'repeat', 'until', 'exceptions'] as const;

export async function syncFeed(feedId: string): Promise<FeedStats> {
  const st = useStore.getState(), feed = st.settings.icsFeeds.find(f => f.id === feedId);
  if (!feed) throw new Error('Subscription not found');
  const setFeed = (p: Partial<typeof feed>) => useStore.getState().setSettings({ icsFeeds: useStore.getState().settings.icsFeeds.map(f => f.id === feedId ? { ...f, ...p } : f) });
  try {
    const text = await fetchFeedText(feed.url);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link did not return a calendar (is it the iCal / .ics address?).');
    const parsed = new Map<string, CalEvent>();
    for (const p of parseICS(text)) { const id = feedEventId(feedId, p.uid); parsed.set(id, { ...p, id, feed: feedId, moduleId: feed.moduleId }); }
    const have = new Map(useStore.getState().events.filter(e => e.feed === feedId).map(e => [e.id, e]));
    const stats: FeedStats = { added: 0, updated: 0, removed: 0, total: parsed.size };
    for (const [id, ev] of parsed) {
      const cur = have.get(id);
      if (!cur) { st.add('events', ev); stats.added++; continue; }
      if (FEED_FIELDS.some(k => JSON.stringify(cur[k]) !== JSON.stringify(ev[k]))) { st.update('events', id, Object.fromEntries(FEED_FIELDS.map(k => [k, ev[k]]))); stats.updated++; }
    }
    for (const id of have.keys()) if (!parsed.has(id)) { st.remove('events', id); stats.removed++; }
    setFeed({ lastSync: Date.now(), lastCount: stats.total, error: '' });
    return stats;
  } catch (e) { setFeed({ error: (e as Error).message }); throw e; }
}

export function removeFeed(feedId: string) {
  const st = useStore.getState();
  st.events.filter(e => e.feed === feedId).forEach(e => st.remove('events', e.id));
  st.setSettings({ icsFeeds: st.settings.icsFeeds.filter(f => f.id !== feedId) });
}

const REFRESH_MS = 6 * 3600_000;
let busy = false;
/** Refreshes subscriptions that have not been updated for six hours. Called at start-up and periodically. */
export async function refreshDueFeeds() {
  if (busy) return; busy = true;
  try { for (const f of useStore.getState().settings.icsFeeds) if (Date.now() - f.lastSync > REFRESH_MS) { try { await syncFeed(f.id); } catch { /* error is stored on the feed and shown in the dialog */ } } }
  finally { busy = false; }
}
