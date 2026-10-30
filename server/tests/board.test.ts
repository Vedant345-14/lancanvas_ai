import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, connect, createClassroom, joinClassroom, PNG, rect, rid, rpc, startServer, TestServer, wait, waitFor } from './helpers';

let srv: TestServer;
beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); });

async function room() {
  const c = await createClassroom(srv);
  const host = await connect(srv, c.hostToken);
  const a = await joinClassroom(srv, c.code, 'Asha');
  const b = await joinClassroom(srv, c.code, 'Ben');
  const sa = await connect(srv, a.token);
  const sb = await connect(srv, b.token);
  return { c, host, a, b, sa, sb, close: () => [host, sa, sb].forEach((s) => s.sock.close()) };
}

describe('drawing permissions are enforced on the server', () => {
  it('FLOW 4: viewer drawing is rejected and never reaches other clients', async () => {
    const r = await room();
    expect(r.sa.init.me.effective.draw).toBe(false);
    const res = await rpc(r.sa, 'board:add', { object: rect() });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN', error: 'You currently have view-only access.' });
    await wait(150);
    expect(r.sb.events['board:added']).toBeUndefined();
    expect(r.host.events['board:added']).toBeUndefined();
    expect(srv.ctx.board.list(srv.ctx.sessions.getSessionByCode(r.c.code)!.id)).toHaveLength(0);
    // every other mutating board event is also blocked
    const id = rid();
    await rpc(r.host, 'board:add', { object: rect(id) });
    expect((await rpc(r.sa, 'board:update', { id, patch: { x: 999 } })).ok).toBe(false);
    expect((await rpc(r.sa, 'board:remove', { ids: [id] })).ok).toBe(false);
    expect((await rpc(r.sa, 'board:preview', { id: rid(), kind: 'pen', color: '#000000', strokeWidth: 3, points: [[1, 1]] })).ok).toBe(false);
    expect(srv.ctx.board.list(srv.ctx.sessions.getSessionByCode(r.c.code)!.id)[0].x).toBe(10);
    r.close();
  });

  it('FLOW 3: host promotes viewer to editor; edits broadcast live; revoking stops them', async () => {
    const r = await room();
    const grant = await rpc(r.host, 'host:setParticipant', { participantId: r.a.id, perms: { canDraw: true } });
    expect(grant.ok).toBe(true);
    await waitFor(() => r.sa.events['me:update']?.at(-1)?.effective.draw === true);
    const id = rid();
    const ok = await rpc(r.sa, 'board:add', { object: rect(id) });
    expect(ok.ok).toBe(true);
    expect(ok.object.author).toBe('Asha');
    await waitFor(() => r.sb.events['board:added']?.length === 1 && r.host.events['board:added']?.length === 1);
    expect(r.sb.events['board:added'][0].id).toBe(id);
    // Ben is still a viewer
    expect((await rpc(r.sb, 'board:add', { object: rect() })).ok).toBe(false);
    // update & remove by editor
    expect((await rpc(r.sa, 'board:update', { id, patch: { x: 50 } })).ok).toBe(true);
    await waitFor(() => r.sb.events['board:updated']?.length === 1);
    // revoke
    await rpc(r.host, 'host:setParticipant', { participantId: r.a.id, perms: { canDraw: false } });
    await waitFor(() => r.sa.events['me:update']?.at(-1)?.effective.draw === false);
    expect((await rpc(r.sa, 'board:remove', { ids: [id] })).ok).toBe(false);
    expect(srv.ctx.board.list(srv.ctx.sessions.getSessionByCode(r.c.code)!.id)).toHaveLength(1);
    r.close();
  });

  it('policy everyone / nobody / lock', async () => {
    const r = await room();
    await rpc(r.host, 'host:setSettings', { settings: { drawPolicy: 'everyone' } });
    await waitFor(() => r.sb.events['me:update']?.at(-1)?.effective.draw === true);
    expect((await rpc(r.sb, 'board:add', { object: rect() })).ok).toBe(true);
    await rpc(r.host, 'host:setSettings', { settings: { locked: true } });
    await waitFor(() => r.sb.events['me:update']?.at(-1)?.effective.draw === false);
    expect((await rpc(r.sb, 'board:add', { object: rect() })).ok).toBe(false);
    expect((await rpc(r.host, 'board:add', { object: rect() })).ok).toBe(true); // host unaffected
    await rpc(r.host, 'host:setSettings', { settings: { locked: false, drawPolicy: 'none' } });
    await wait(100);
    expect((await rpc(r.sb, 'board:add', { object: rect() })).ok).toBe(false);
    r.close();
  });

  it('only the host can clear the board', async () => {
    const r = await room();
    await rpc(r.host, 'host:setSettings', { settings: { drawPolicy: 'everyone' } });
    await rpc(r.host, 'board:add', { object: rect() });
    expect((await rpc(r.sa, 'board:clear')).ok).toBe(false);
    expect((await rpc(r.host, 'board:clear')).ok).toBe(true);
    await waitFor(() => !!r.sa.events['board:cleared']);
    r.close();
  });

  it('access requests reach the host; viewers cannot request when disabled', async () => {
    const r = await room();
    expect((await rpc(r.sa, 'access:request')).ok).toBe(true);
    await waitFor(() => r.host.events['access:requested']?.[0]?.name === 'Asha');
    await rpc(r.host, 'host:setParticipant', { participantId: r.b.id, perms: { canRequest: false } });
    await wait(50);
    expect((await rpc(r.sb, 'access:request')).ok).toBe(false);
    r.close();
  });
});

describe('payload validation', () => {
  it('rejects malformed, oversized and unknown-field objects', async () => {
    const r = await room();
    const bad: unknown[] = [
      { ...rect(), type: 'script' },
      { ...rect(), color: 'red; background:url(x)' },
      { ...rect(), w: 1e12 },
      { ...rect(), extra: 'x' },
      { ...rect(), id: '../../etc' },
      { id: rid(), type: 'pen', x: 0, y: 0, color: '#000000', strokeWidth: 2, points: Array.from({ length: 4001 }, () => [1, 1]) },
      { id: rid(), type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x'.repeat(2001), color: '#000000', strokeWidth: 1 },
      { id: rid(), type: 'image', x: 0, y: 0, w: 10, h: 10, src: '../x.png', color: '#000000', strokeWidth: 1 },
      'garbage', null,
    ];
    for (const object of bad) expect((await rpc(r.host, 'board:add', { object })).ok, JSON.stringify(object)?.slice(0, 60)).toBe(false);
    expect((await rpc(r.host, 'board:update', { id: 'does-not-exist', patch: { x: 1 } })).ok).toBe(false);
    const id = rid();
    await rpc(r.host, 'board:add', { object: rect(id) });
    expect((await rpc(r.host, 'board:update', { id, patch: { type: 'text' } })).ok).toBe(false);
    expect((await rpc(r.host, 'board:update', { id, patch: { w: 'wide' } })).ok).toBe(false);
    expect((await rpc(r.host, 'board:add', { object: rect(id) })).code).toBe('DUPLICATE'); // no duplicates
    expect(srv.ctx.board.list(srv.ctx.sessions.getSessionByCode(r.c.code)!.id)).toHaveLength(1);
    r.close();
  });
});

describe('cross-session isolation', () => {
  it('a token for session A cannot read or modify session B', async () => {
    const A = await createClassroom(srv, { name: 'A' });
    const B = await createClassroom(srv, { name: 'B' });
    const hostA = await connect(srv, A.hostToken);
    const hostB = await connect(srv, B.hostToken);
    const id = rid();
    await rpc(hostB, 'board:add', { object: rect(id) });
    // Host A cannot update/remove B's object (ids are scoped to the caller's own session)
    expect((await rpc(hostA, 'board:update', { id, patch: { x: 77 } })).ok).toBe(false);
    expect((await rpc(hostA, 'board:remove', { ids: [id] })).removed).toEqual([]);
    expect(srv.ctx.board.list(srv.ctx.sessions.getSessionByCode(B.code)!.id)[0].x).toBe(10);
    // Host A cannot manage B's participants
    const bStudent = await joinClassroom(srv, B.code, 'Zed');
    expect((await rpc(hostA, 'host:setParticipant', { participantId: bStudent.id, perms: { canDraw: true } })).ok).toBe(false);
    expect((await rpc(hostA, 'host:decision', { participantId: bStudent.id, action: 'remove' })).ok).toBe(false);
    // REST: token A against code B
    expect((await api(srv, `/api/sessions/${B.code}/export/board`, { token: A.hostToken })).status).toBe(403);
    // events are not leaked
    await wait(100);
    expect(hostA.events['board:added']).toBeUndefined();
    expect(hostA.events['chat:message']?.some((m: any) => m.text?.includes('Zed'))).toBeFalsy();
    hostA.sock.close(); hostB.sock.close();
  });
});

describe('chat', () => {
  it('FLOW 5: messages reach everyone in the room and only that room; history is stored', async () => {
    const r = await room();
    const other = await createClassroom(srv, { name: 'Other' });
    const outsider = await connect(srv, other.hostToken);
    expect((await rpc(r.sa, 'chat:send', { text: '<img src=x onerror=alert(1)>' })).ok).toBe(true);
    await waitFor(() => r.sb.events['chat:message']?.some((m: any) => m.senderName === 'Asha') && r.host.events['chat:message']?.some((m: any) => m.senderName === 'Asha'));
    await wait(100);
    expect(outsider.events['chat:message']?.some((m: any) => m.senderName === 'Asha')).toBeFalsy();
    const late = await connect(srv, r.b.token);
    expect(late.init.chat.some((m: any) => m.text.startsWith('<img') && m.senderName === 'Asha')).toBe(true);
    expect(new Set(late.init.chat.map((m: any) => m.id)).size).toBe(late.init.chat.length); // no duplicates
    late.sock.close(); outsider.sock.close(); r.close();
  });
  it('rejects empty/oversized messages, disabled chat, and floods', async () => {
    const r = await room();
    expect((await rpc(r.sa, 'chat:send', { text: '   ' })).ok).toBe(false);
    expect((await rpc(r.sa, 'chat:send', { text: 'x'.repeat(1001) })).ok).toBe(false);
    await rpc(r.host, 'host:setParticipant', { participantId: r.b.id, perms: { canChat: false } });
    await wait(50);
    expect((await rpc(r.sb, 'chat:send', { text: 'hello' })).ok).toBe(false);
    const results = [];
    for (let i = 0; i < 14; i++) results.push((await rpc(r.sa, 'chat:send', { text: 'spam ' + i })).code);
    expect(results).toContain('RATE_LIMITED');
    r.close();
  });
});

describe('uploads', () => {
  const form = (buf: Buffer, name: string) => { const f = new FormData(); f.append('file', new Blob([buf]), name); return f; };
  it('enforces permission, magic-byte validation, size limit and session scoping', async () => {
    const r = await room();
    const url = `/api/sessions/${r.c.code}/uploads`;
    expect((await api(srv, url, { token: r.a.token, raw: form(PNG, 'a.png') })).status).toBe(403); // viewer
    expect((await api(srv, url, { raw: form(PNG, 'a.png') })).status).toBe(401);
    await rpc(r.host, 'host:setParticipant', { participantId: r.a.id, perms: { canDraw: true } });
    const bad = await api(srv, url, { token: r.a.token, raw: form(Buffer.from('<html><script>alert(1)</script></html>'), 'evil.png') });
    expect(bad.status).toBe(400);
    const big = await api(srv, url, { token: r.a.token, raw: form(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), 'big.png') });
    expect(big.status).toBe(400);
    const ok = await api(srv, url, { token: r.a.token, raw: form(PNG, '../../evil name.png') });
    expect(ok.status).toBe(201);
    expect(ok.json.src).toMatch(/^[a-f0-9]{24}\.png$/);
    const sessionId = srv.ctx.sessions.getSessionByCode(r.c.code)!.id;
    expect(fs.existsSync(path.join(srv.dir, 'uploads', sessionId, ok.json.src))).toBe(true);
    // image object syncs to others and is retrievable by members only
    const imgId = rid();
    const add = await rpc(r.sa, 'board:add', { object: { id: imgId, type: 'image', x: 0, y: 0, w: 100, h: 100, src: ok.json.src, color: '#000000', strokeWidth: 1 } });
    expect(add.ok).toBe(true);
    await waitFor(() => r.sb.events['board:added']?.length === 1);
    const got = await api(srv, `/api/sessions/${r.c.code}/files/${ok.json.src}`, { token: r.b.token });
    expect(got.status).toBe(200);
    expect(got.res.headers.get('content-type')).toBe('image/png');
    expect(got.res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await api(srv, `/api/sessions/${r.c.code}/files/${ok.json.src}`)).status).toBe(401);
    expect((await api(srv, `/api/sessions/${r.c.code}/files/..%2F..%2Fpackage.json`, { token: r.b.token })).status).toBe(404);
    const other = await createClassroom(srv);
    expect((await api(srv, `/api/sessions/${other.code}/files/${ok.json.src}`, { token: other.hostToken })).status).toBe(404);
    // another classroom cannot reference this upload on its board
    const hostO = await connect(srv, other.hostToken);
    expect((await rpc(hostO, 'board:add', { object: { id: rid(), type: 'image', x: 0, y: 0, w: 10, h: 10, src: ok.json.src, color: '#000000', strokeWidth: 1 } })).ok).toBe(false);
    hostO.sock.close();
    // editor without upload permission cannot add image objects
    await rpc(r.host, 'host:setParticipant', { participantId: r.a.id, perms: { canUpload: false } });
    await wait(50);
    expect((await api(srv, url, { token: r.a.token, raw: form(PNG, 'a.png') })).status).toBe(403);
    r.close();
  });
});

describe('persistence and reconnection', () => {
  it('FLOW 7/8: board, chat and permissions survive a server restart; reconnect has no duplicates', async () => {
    const dir = fs.mkdtempSync(path.join(srv.dir, 'persist-'));
    const dbFile = path.join(dir, 'test.db');
    const secret = 'persist-secret-persist-secret-123456';
    let s = await startServer({ dbFile, dir, secret });
    const c = await createClassroom(s, { name: 'Persist me' });
    const a = await joinClassroom(s, c.code, 'Asha');
    const host = await connect(s, c.hostToken);
    const sa = await connect(s, a.token);
    await rpc(host, 'host:setParticipant', { participantId: a.id, perms: { canDraw: true } });
    const id = rid();
    await rpc(sa, 'board:add', { object: { id, type: 'text', x: 5, y: 5, w: 100, h: 30, text: 'OSI model', color: '#17233C', strokeWidth: 1, fontSize: 20 } });
    await rpc(sa, 'chat:send', { text: 'persist this' });
    sa.sock.close(); host.sock.close();
    await s.close();

    s = await startServer({ dbFile, dir, secret });
    const sa2 = await connect(s, a.token); // same token still valid after restart
    expect(sa2.init.pending).toBe(false);
    expect(sa2.init.me.effective.draw).toBe(true);
    expect(sa2.init.objects.map((o: any) => o.id)).toEqual([id]);
    expect(sa2.init.objects[0].text).toBe('OSI model');
    expect(sa2.init.chat.filter((m: any) => m.text === 'persist this')).toHaveLength(1);
    sa2.sock.close();
    const sa3 = await connect(s, a.token);
    expect(sa3.init.objects).toHaveLength(1);
    expect(sa3.init.participants.filter((p: any) => p.name === 'Asha')).toHaveLength(1);
    sa3.sock.close();
    await s.close();
  });
  it('JSON export contains the board', async () => {
    const r = await room();
    await rpc(r.host, 'board:add', { object: rect() });
    const ex = await api(srv, `/api/sessions/${r.c.code}/export/board`, { token: r.a.token });
    expect(ex.status).toBe(200);
    expect(ex.json.objects).toHaveLength(1);
    r.close();
  });
});
