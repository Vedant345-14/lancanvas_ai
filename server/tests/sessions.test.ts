import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, connect, createClassroom, joinClassroom, rpc, startServer, TestServer, waitFor } from './helpers';

let srv: TestServer;
beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); });

describe('session creation and join', () => {
  it('creates a session with an unguessable code and a host token', async () => {
    const c = await createClassroom(srv);
    expect(c.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(c.hostToken.split('.')).toHaveLength(2);
  });
  it('rejects invalid creation payloads', async () => {
    expect((await api(srv, '/api/sessions', { body: { name: '', hostName: 'x' } })).status).toBe(400);
    expect((await api(srv, '/api/sessions', { body: { name: 'ok', hostName: 'x'.repeat(100) } })).status).toBe(400);
    expect((await api(srv, '/api/sessions', { body: { name: 'ok', hostName: 'x', role: 'host' } })).status).toBe(400);
  });
  it('hashes the classroom password (never stored in plaintext)', async () => {
    const c = await createClassroom(srv, { password: 'sesame-open' });
    const row = srv.ctx.db.prepare('SELECT password_hash h FROM sessions WHERE code = ?').get(c.code) as { h: string };
    expect(row.h.startsWith('scrypt$')).toBe(true);
    expect(row.h).not.toContain('sesame');
  });
  it('accepts valid credentials and rejects wrong password / unknown code with the same message', async () => {
    const c = await createClassroom(srv, { password: 'pw12345' });
    const ok = await joinClassroom(srv, c.code, 'Asha', 'pw12345');
    expect(ok.status).toBe(201);
    const bad = await joinClassroom(srv, c.code, 'Ben', 'wrong');
    const none = await joinClassroom(srv, 'ZZZZZZ', 'Ben', 'pw12345');
    expect(bad.status).toBe(401);
    expect(none.status).toBe(401);
    expect(bad.json.error).toBe(none.json.error);
    expect((await joinClassroom(srv, c.code, 'Ben')).status).toBe(401); // missing password
  });
  it('rejects duplicate display names and invalid names', async () => {
    const c = await createClassroom(srv);
    expect((await joinClassroom(srv, c.code, 'Asha')).status).toBe(201);
    expect((await joinClassroom(srv, c.code, 'asha')).status).toBe(409);
    expect((await joinClassroom(srv, c.code, '   ')).status).toBe(400);
  });
  it('joins are case-insensitive on the code', async () => {
    const c = await createClassroom(srv);
    expect((await joinClassroom(srv, c.code.toLowerCase(), 'Zed')).status).toBe(201);
  });
});

describe('approval flow and host-only operations', () => {
  it('pending participants get no board until the host approves', async () => {
    const c = await createClassroom(srv, { approval: true });
    const host = await connect(srv, c.hostToken);
    const j = await joinClassroom(srv, c.code, 'Asha');
    expect(j.json.status).toBe('pending');
    const student = await connect(srv, j.token);
    expect(student.init.pending).toBe(true);
    expect(student.init.objects).toBeUndefined();
    expect((await rpc(student, 'chat:send', { text: 'hi' })).ok).toBe(false);
    expect((await api(srv, `/api/sessions/${c.code}/export/board`, { token: j.token })).status).toBe(403);
    await waitFor(() => !!host.events['join:request']);
    const res = await rpc(host, 'host:decision', { participantId: j.id, action: 'approve' });
    expect(res.ok).toBe(true);
    await waitFor(() => (student.events['session:init']?.length ?? 0) >= 1 && student.events['session:init'].some((i: any) => i.pending === false) || student.init.pending === false);
    const approvedInit = student.events['session:init'].at(-1);
    expect(approvedInit.pending).toBe(false);
    expect(approvedInit.me.effective.draw).toBe(false);
    expect(approvedInit.objects).toEqual([]);
    host.sock.close(); student.sock.close();
  });
  it('rejects host-only socket events from participants', async () => {
    const c = await createClassroom(srv);
    const a = await joinClassroom(srv, c.code, 'Asha');
    const b = await joinClassroom(srv, c.code, 'Ben');
    const sa = await connect(srv, a.token);
    for (const [ev, data] of [
      ['host:setSettings', { settings: { drawPolicy: 'everyone' } }],
      ['host:setParticipant', { participantId: b.id, perms: { canDraw: true } }],
      ['host:decision', { participantId: b.id, action: 'remove' }],
      ['host:closeSession', {}],
      ['board:clear', {}],
    ] as const) {
      const r = await rpc(sa, ev, data);
      expect(r.ok, ev).toBe(false);
      expect(r.code, ev).toBe('FORBIDDEN');
    }
    expect(srv.ctx.sessions.getSessionByCode(c.code)!.settings.drawPolicy).toBe('selected');
    expect(srv.ctx.sessions.getParticipant(b.id)!.status).toBe('approved');
    sa.sock.close();
  });
  it('host-only REST endpoints reject participants; unauthenticated calls get 401', async () => {
    const c = await createClassroom(srv);
    const a = await joinClassroom(srv, c.code, 'Asha');
    expect((await api(srv, `/api/sessions/${c.code}/network`, { token: a.token })).status).toBe(403);
    expect((await api(srv, `/api/sessions/${c.code}/network`)).status).toBe(401);
    const ok = await api(srv, `/api/sessions/${c.code}/network`, { token: c.hostToken });
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.json.addresses)).toBe(true);
    expect((await api(srv, `/api/sessions/${c.code}/reopen`, { method: 'POST', token: a.token })).status).toBe(403);
  });
  it('forged tokens and removed participants are refused', async () => {
    const c = await createClassroom(srv);
    const a = await joinClassroom(srv, c.code, 'Asha');
    await expect(connect(srv, a.token.slice(0, -3) + 'abc')).rejects.toThrow(/unauthorized/);
    const host = await connect(srv, c.hostToken);
    const sa = await connect(srv, a.token);
    await rpc(host, 'host:decision', { participantId: a.id, action: 'remove' });
    await waitFor(() => !!sa.events['access:revoked']);
    await expect(connect(srv, a.token)).rejects.toThrow(/access_denied/);
    expect((await api(srv, `/api/sessions/${c.code}/export/board`, { token: a.token })).status).toBe(403);
    host.sock.close();
  });
  it('closed sessions refuse participants but allow the host to reopen', async () => {
    const c = await createClassroom(srv);
    const a = await joinClassroom(srv, c.code, 'Asha');
    const host = await connect(srv, c.hostToken);
    const sa = await connect(srv, a.token);
    expect((await rpc(host, 'host:closeSession')).ok).toBe(true);
    await waitFor(() => !!sa.events['session:closed']);
    await expect(connect(srv, a.token)).rejects.toThrow(/session_closed/);
    expect((await joinClassroom(srv, c.code, 'Late')).status).toBe(423);
    expect((await api(srv, `/api/sessions/${c.code}/reopen`, { method: 'POST', token: c.hostToken })).status).toBe(200);
    const again = await connect(srv, a.token);
    expect(again.init.pending).toBe(false);
    host.sock.close(); again.sock.close();
  });
});

describe('brute-force protection', () => {
  it('rate-limits repeated join attempts per IP', async () => {
    const limited = await startServer({ joinRateLimit: 5 });
    const c = await createClassroom(limited, { password: 'right-password' });
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await joinClassroom(limited, c.code, 'User' + i, 'guess' + i)).status);
    expect(codes.slice(0, 4).every((x) => x === 401)).toBe(true);
    expect(codes).toContain(429);
    await limited.close();
  });
});
