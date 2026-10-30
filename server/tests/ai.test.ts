import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider, type AIProvider } from '../src/services/ai/provider';
import { api, connect, createClassroom, joinClassroom, rect, rpc, startServer, TestServer, PNG } from './helpers';

const goodNotes = { title: 'TCP basics', overview: 'Handshake diagram', mainConcepts: [{ name: 'SYN', explanation: 'start' }], diagramExplanations: [{ title: 'Handshake', observed: 'Client box, arrow to Server', interpretation: 'three-way handshake', uncertain: true }], practiceQuestions: [{ question: 'Q?', answer: 'A' }] };
const calls: any[] = [];
const mock = (out: string | Error): AIProvider => ({
  isConfigured: () => true, model: 'mock',
  generate: async (req) => { calls.push(req); if (out instanceof Error) throw out; return { text: out, visionUsed: !!req.imageDataUrl }; },
});

describe('AI not configured', () => {
  let srv: TestServer;
  beforeAll(async () => { srv = await startServer({ provider: new OpenAICompatibleProvider({ apiKey: '', baseUrl: 'http://x', model: 'm', vision: true }) }); });
  afterAll(async () => { await srv.close(); });
  it('returns a friendly 503 and the rest of the app keeps working', async () => {
    const c = await createClassroom(srv);
    expect((await api(srv, '/api/health')).json.aiConfigured).toBe(false);
    const r = await api(srv, `/api/sessions/${c.code}/ai/notes`, { token: c.hostToken, body: { mode: 'notes' } });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('AI_NOT_CONFIGURED');
    expect(r.json.error).toMatch(/AI_API_KEY/);
    const host = await connect(srv, c.hostToken);
    expect((await rpc(host, 'board:add', { object: rect() })).ok).toBe(true);
    host.sock.close();
  });
});

describe('AI notes', () => {
  let srv: TestServer;
  let current: AIProvider = mock(JSON.stringify(goodNotes));
  beforeAll(async () => { srv = await startServer({ provider: { isConfigured: () => true, model: 'mock', generate: (r) => current.generate(r) } }); });
  afterAll(async () => { await srv.close(); });

  it('enforces the host permission switch', async () => {
    const c = await createClassroom(srv);
    const a = await joinClassroom(srv, c.code, 'Asha');
    const denied = await api(srv, `/api/sessions/${c.code}/ai/notes`, { token: a.token, body: {} });
    expect(denied.status).toBe(403);
    const host = await connect(srv, c.hostToken);
    await rpc(host, 'board:add', { object: rect() });
    expect((await api(srv, `/api/sessions/${c.code}/ai/notes`, { token: c.hostToken, body: {} })).status).toBe(200); // host always allowed
    await rpc(host, 'host:setSettings', { settings: { allowAI: true } });
    expect((await api(srv, `/api/sessions/${c.code}/ai/notes`, { token: a.token, body: {} })).status).toBe(200);
    await rpc(host, 'host:setParticipant', { participantId: a.id, perms: { canAI: false } });
    expect((await api(srv, `/api/sessions/${c.code}/ai/notes`, { token: a.token, body: {} })).status).toBe(403);
    host.sock.close();
  });

  it('validates the AI output, uses server-side board text, honours chat opt-in and stores the result', async () => {
    current = mock(JSON.stringify(goodNotes)); calls.length = 0;
    const c = await createClassroom(srv);
    const host = await connect(srv, c.hostToken);
    await rpc(host, 'board:add', { object: { id: 'txt0000001', type: 'text', x: 0, y: 0, w: 200, h: 30, text: 'Subnet mask 255.255.255.0', color: '#17233C', strokeWidth: 1 } });
    await rpc(host, 'chat:send', { text: 'what is CIDR?' });
    let r = await api(srv, `/api/sessions/${c.code}/ai/notes`, { token: c.hostToken, body: { mode: 'notes', image: 'data:image/png;base64,' + PNG.toString('base64') } });
    expect(r.status).toBe(200);
    expect(r.json.notes.title).toBe('TCP basics');
    expect(r.json.notes.flashcards).toEqual([]); // defaults applied
    expect(r.json.visionUsed).toBe(true);
    expect(calls[0].user).toContain('Subnet mask 255.255.255.0');
    expect(calls[0].user).not.toContain('what is CIDR?'); // chat not shared by default
    await rpc(host, 'host:setSettings', { settings: { chatToAI: true } });
    r = await api(srv, `/api/sessions/${c.code}/ai/notes`, { token: c.hostToken, body: {} });
    expect(calls.at(-1).user).toContain('what is CIDR?');
    const latest = await api(srv, `/api/sessions/${c.code}/ai/notes/latest`, { token: c.hostToken });
    expect(latest.json.latest.notes.title).toBe('TCP basics');
    host.sock.close();
  });

  it('handles empty boards, bad payloads, malformed AI output and provider failures', async () => {
    const c = await createClassroom(srv);
    const url = `/api/sessions/${c.code}/ai/notes`;
    expect((await api(srv, url, { token: c.hostToken, body: {} })).json.code).toBe('EMPTY_BOARD');
    const host = await connect(srv, c.hostToken);
    await rpc(host, 'board:add', { object: rect() });
    expect((await api(srv, url, { token: c.hostToken, body: { mode: 'hack' } })).status).toBe(400);
    expect((await api(srv, url, { token: c.hostToken, body: { image: 'data:text/html;base64,AAAA' } })).status).toBe(400);
    current = mock('I am not JSON at all');
    expect((await api(srv, url, { token: c.hostToken, body: {} })).json.code).toBe('AI_BAD_FORMAT');
    current = mock(JSON.stringify({ title: 5, mainConcepts: 'nope' }));
    expect((await api(srv, url, { token: c.hostToken, body: {} })).status).toBe(502);
    const { HttpError } = await import('../src/utils/errors');
    current = mock(new HttpError(504, 'AI_TIMEOUT', 'The AI request timed out.'));
    const t = await api(srv, url, { token: c.hostToken, body: {} });
    expect(t.status).toBe(504);
    expect(t.json.error).not.toMatch(/key|bearer/i);
    host.sock.close();
  });
});

describe('OpenAI-compatible provider adapter', () => {
  const cfg = { apiKey: 'sk-test', baseUrl: 'http://ai.local/v1', model: 'm', vision: true };
  it('sends bearer auth, image part, and retries text-only when the model rejects images', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('image input not supported', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"x"}' } }] }), { status: 200 }));
    const p = new OpenAICompatibleProvider(cfg, f as any);
    const out = await p.generate({ system: 's', user: 'u', imageDataUrl: 'data:image/png;base64,AAAA' });
    expect(out).toEqual({ text: '{"title":"x"}', visionUsed: false });
    const first = JSON.parse(f.mock.calls[0][1].body);
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
    expect(first.messages[1].content[1].type).toBe('image_url');
    expect(typeof JSON.parse(f.mock.calls[1][1].body).messages[1].content).toBe('string');
  });
  it('maps upstream failures to safe errors', async () => {
    const mk = (status: number) => new OpenAICompatibleProvider(cfg, (async () => new Response('secret detail', { status })) as any);
    await expect(mk(401).generate({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'AI_AUTH' });
    await expect(mk(429).generate({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'AI_RATE_LIMIT' });
    await expect(mk(500).generate({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'AI_UPSTREAM' });
    const down = new OpenAICompatibleProvider(cfg, (async () => { throw new TypeError('fetch failed'); }) as any);
    await expect(down.generate({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'AI_NETWORK' });
  });
});
