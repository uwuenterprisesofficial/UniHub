import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, complete, testProvider, type Provider } from '../src/lib/ai';

const gem = (over: Partial<Provider> = {}): Provider => ({ id: 'g', name: 'Google Gemini', kind: 'gemini', baseUrl: PRESETS.gemini.baseUrl, apiKey: 'AIza-test', model: PRESETS.gemini.model, ...over });
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
afterEach(() => vi.unstubAllGlobals());

describe('Google Gemini provider', () => {
  it('is an official preset: the key is all that is needed', () => {
    expect(PRESETS.gemini.baseUrl).toBe('https://generativelanguage.googleapis.com'); expect(PRESETS.gemini.model).toMatch(/^gemini-/);
    expect(PRESETS.custom.label).not.toMatch(/Gemini/);
  });
  it('calls the native generateContent endpoint with the key in a header (never in the address)', async () => {
    const f = reply({ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] }); vi.stubGlobal('fetch', f);
    const out = await complete({ provider: gem(), system: 'Be brief.', user: 'Hi', history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] });
    expect(out).toBe('Hello');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'); expect(url).not.toContain('AIza');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('Be brief.');
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']); // Gemini calls the assistant "model"
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(1500); // room for hidden thinking
  });
  it('ignores thinking parts and joins the answer parts', async () => {
    vi.stubGlobal('fetch', reply({ candidates: [{ content: { parts: [{ text: 'secret reasoning', thought: true }, { text: 'Part one. ' }, { text: 'Part two.' }] } }] }));
    expect(await complete({ provider: gem(), system: 's', user: 'u' })).toBe('Part one. Part two.');
  });
  it('accepts a model typed as "models/…" and tests the connection', async () => {
    const f = reply({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }); vi.stubGlobal('fetch', f);
    await testProvider(gem({ model: 'models/gemini-2.5-pro' }));
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain('/models/gemini-2.5-pro:generateContent');
  });
  it('explains errors: bad key, blocked prompt, empty answer', async () => {
    vi.stubGlobal('fetch', reply({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400));
    await expect(complete({ provider: gem(), system: 's', user: 'u' })).rejects.toThrow(/API key not valid.*400/);
    vi.stubGlobal('fetch', reply({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(complete({ provider: gem(), system: 's', user: 'u' })).rejects.toThrow(/declined.*SAFETY/);
    vi.stubGlobal('fetch', reply({ candidates: [{ content: { parts: [] } }] }));
    await expect(complete({ provider: gem(), system: 's', user: 'u' })).rejects.toThrow(/empty answer/);
    await expect(complete({ provider: gem({ apiKey: '' }), system: 's', user: 'u' })).rejects.toThrow(/no API key/);
  });
});
