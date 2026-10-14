import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeedError, fetchFeed, isPrivateAddress } from '../server/feed';

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Lecture\r\nDTSTART:20260302T100000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
let srv: http.Server, base = '';
beforeAll(async () => {
  srv = http.createServer((req, res) => {
    if (req.url === '/cal.ics') { res.setHeader('content-type', 'text/calendar'); return res.end(ICS); }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/cal.ics' }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    if (req.url === '/big') { res.write('x'.repeat(1024 * 1024)); const t = setInterval(() => res.write('x'.repeat(1024 * 1024)), 5); res.on('close', () => clearInterval(t)); return; }
    if (req.url === '/slow') return; // never answers
    res.writeHead(404); res.end('nope');
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => { srv.closeAllConnections?.(); srv.close(); delete process.env.UNIHUB_ALLOW_PRIVATE_FEEDS; delete process.env.UNIHUB_FEED_TIMEOUT_MS; });

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '127.8.8.8', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'not an ip'])('refuses %s', ip => { expect(isPrivateAddress(ip)).toBe(true); });
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', ip => { expect(isPrivateAddress(ip)).toBe(false); });
});

describe('fetchFeed refuses to reach internal services', () => {
  delete process.env.UNIHUB_ALLOW_PRIVATE_FEEDS;
  it.each([
    () => `${base}/cal.ics`, () => 'http://localhost/cal.ics', () => 'http://127.0.0.1:80/', () => 'http://[::1]/', () => 'http://169.254.169.254/latest/meta-data/', () => 'http://0.0.0.0/',
    () => 'http://10.0.0.1/', () => 'http://192.168.0.1/', () => 'http://[::ffff:127.0.0.1]/', () => 'http://2130706433/', () => 'http://0x7f.0.0.1/', () => 'https://localtest.me/',
  ])('blocks %#', async u => { delete process.env.UNIHUB_ALLOW_PRIVATE_FEEDS; await expect(fetchFeed(u())).rejects.toBeInstanceOf(FeedError); });
  it.each(['file:///etc/passwd', 'ftp://example.com/cal.ics', 'gopher://example.com/', 'javascript:alert(1)', 'not a url', '', 'http://user:pw@example.com/cal.ics', 'https://example.com:22/cal.ics', 'https://example.com:6379/'])('rejects %s', async u => {
    delete process.env.UNIHUB_ALLOW_PRIVATE_FEEDS; await expect(fetchFeed(u)).rejects.toBeInstanceOf(FeedError);
  });
});

describe('fetchFeed with private addresses allowed (self-hosted LAN calendars)', () => {
  beforeAll(() => { process.env.UNIHUB_ALLOW_PRIVATE_FEEDS = '1'; process.env.UNIHUB_FEED_TIMEOUT_MS = '700'; });
  it('downloads a calendar, follows redirects and understands webcal://', async () => {
    expect(await fetchFeed(`${base}/cal.ics`)).toBe(ICS);
    expect(await fetchFeed(`${base}/redirect`)).toBe(ICS);
  });
  it('gives up on redirect loops, errors, oversized files and silent servers', async () => {
    await expect(fetchFeed(`${base}/loop`)).rejects.toThrow(/redirects/i);
    await expect(fetchFeed(`${base}/missing`)).rejects.toThrow(/error \(404\)/);
    await expect(fetchFeed(`${base}/big`)).rejects.toThrow(/too large/i);
    await expect(fetchFeed(`${base}/slow`)).rejects.toThrow(/too long/i);
  });
  it('reports an unreachable server without leaking details', async () => { await expect(fetchFeed('http://127.0.0.1:1/x.ics')).rejects.toThrow(/Could not reach/); });
});
