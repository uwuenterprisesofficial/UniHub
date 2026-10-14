import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/* Fetches a calendar feed on behalf of a signed-in user (browsers cannot read most calendar URLs because of CORS).
   Because the server is making the request, it must never become a way to reach internal services (SSRF):
   - only http(s) on common ports (any port when private feeds are allowed), at most 3 redirects, each hop re-checked
   - every address the host name resolves to must be public, and the connection is made to exactly the address that was checked
   - 10 s timeout, 5 MB limit
   Set UNIHUB_ALLOW_PRIVATE_FEEDS=1 to allow addresses on your own network (e.g. a calendar server in your LAN). */
const MAX_BYTES = 5 * 1024 * 1024, PORTS = new Set(['', '80', '443', '8080', '8443']);
const timeoutMs = () => Number(process.env.UNIHUB_FEED_TIMEOUT_MS ?? 10_000);
const allowPrivate = () => process.env.UNIHUB_ALLOW_PRIVATE_FEEDS === '1';

const blocked = new net.BlockList();
for (const [net4, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96]] as const) blocked.addSubnet(net6, bits, 'ipv6');

export function isPrivateAddress(ip: string): boolean {
  const v4mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) ip = v4mapped[1];
  if (net.isIPv4(ip)) return blocked.check(ip, 'ipv4');
  if (net.isIPv6(ip)) return blocked.check(ip, 'ipv6');
  return true; // anything we cannot classify is refused
}

export class FeedError extends Error {
  status: number; // no constructor parameter properties: Node's built-in TypeScript support only strips types
  constructor(msg: string, status = 400) { super(msg); this.status = status; }
}

function checkedLookup(host: string, opts: dns.LookupOptions, cb: (err: Error | null, address: unknown, family?: number) => void) {
  dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err, '');
    const list = addrs as dns.LookupAddress[];
    if (!list.length || (!allowPrivate() && list.some(a => isPrivateAddress(a.address)))) return cb(new FeedError('That address is not allowed (it points to a private network).'), '');
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function once(url: URL): Promise<{ status: number; location?: string; body?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', lookup: checkedLookup as never, timeout: timeoutMs(), headers: { 'user-agent': 'UniHub-calendar-sync', accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1' } }, res => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ status, location: res.headers.location }); }
      if (status !== 200) { res.resume(); return reject(new FeedError(`The calendar server answered with an error (${status}).`, 502)); }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new FeedError('The calendar file is too large (5 MB max).', 502)); } else chunks.push(c); });
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new FeedError('The calendar server took too long to answer.', 504)));
    req.on('error', e => reject(e instanceof FeedError ? e : new FeedError(e.message.includes('private') ? e.message : 'Could not reach the calendar server.', 502)));
    req.end();
  });
}

export async function fetchFeed(raw: string): Promise<string> {
  let url: URL;
  try { url = new URL(raw.trim().replace(/^webcals?:/i, 'https:')); } catch { throw new FeedError('That is not a valid web address.'); }
  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FeedError('Only http and https calendar links are supported.');
    if (!allowPrivate() && !PORTS.has(url.port)) throw new FeedError('That port is not allowed.');
    if (url.username || url.password) throw new FeedError('Put the key in the link itself; user names in links are not supported.');
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && !allowPrivate() && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) throw new FeedError('That address is not allowed (it points to a private network).');
    const r = await once(url);
    if (r.body != null) return r.body;
    url = new URL(r.location!, url);
  }
  throw new FeedError('Too many redirects.', 502);
}
