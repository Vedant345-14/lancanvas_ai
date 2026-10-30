import fs from 'fs';
import os from 'os';
import path from 'path';
import { io as ioc, Socket } from 'socket.io-client';
import { createApp } from '../src/app';
import type { AIProvider } from '../src/services/ai/provider';

export interface TestServer { url: string; close: () => Promise<void>; ctx: ReturnType<typeof createApp>['ctx']; dir: string }

export async function startServer(opts: { provider?: AIProvider; dbFile?: string; dir?: string; secret?: string; joinRateLimit?: number } = {}): Promise<TestServer> {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'lancanvas-test-'));
  const app = createApp({
    config: { databasePath: opts.dbFile ?? ':memory:', uploadDir: path.join(dir, 'uploads'), sessionSecret: opts.secret ?? 'test-secret-test-secret-test-secret-1234', port: 0, host: '127.0.0.1', joinRateLimit: opts.joinRateLimit ?? 100000 },
    provider: opts.provider,
  });
  await new Promise<void>((r) => app.httpServer.listen(0, '127.0.0.1', r));
  const port = (app.httpServer.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: app.close, ctx: app.ctx, dir };
}

export async function api(srv: TestServer, p: string, o: { method?: string; token?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(srv.url + p, { method: o.method ?? (o.body !== undefined || o.raw ? 'POST' : 'GET'), headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) });
  const type = res.headers.get('content-type') ?? '';
  const json = type.includes('json') ? await res.json() : null;
  return { status: res.status, json: json as any, res };
}

export async function createClassroom(srv: TestServer, o: { approval?: boolean; password?: string; name?: string; host?: string } = {}) {
  const r = await api(srv, '/api/sessions', { body: { name: o.name ?? 'Networks 101', hostName: o.host ?? 'Prof', password: o.password, requireApproval: o.approval ?? false } });
  if (r.status !== 201) throw new Error('create failed ' + JSON.stringify(r.json));
  return { code: r.json.code as string, hostToken: r.json.token as string, hostId: r.json.participantId as string };
}

export async function joinClassroom(srv: TestServer, code: string, name: string, password?: string) {
  const r = await api(srv, `/api/sessions/${code}/join`, { body: { name, password } });
  return { ...r, token: r.json?.token as string, id: r.json?.participantId as string };
}

export interface TestSocket { sock: Socket; init: any; events: Record<string, any[]> }
export async function connect(srv: TestServer, token: string): Promise<TestSocket> {
  const sock = ioc(srv.url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  const events: Record<string, any[]> = {};
  sock.onAny((ev, payload) => { (events[ev] ??= []).push(payload); });
  const init = await new Promise<any>((resolve, reject) => {
    sock.once('session:init', resolve);
    sock.once('connect_error', (e) => reject(new Error('connect_error: ' + e.message)));
    setTimeout(() => reject(new Error('init timeout')), 5000);
  });
  return { sock, init, events };
}
export const rpc = (s: TestSocket, ev: string, data: unknown = {}): Promise<any> =>
  new Promise((resolve) => s.sock.emit(ev, data, resolve));
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('waitFor timeout'); await wait(20); }
}
export const rid = () => 'o' + Math.random().toString(36).slice(2, 12);
export const rect = (id = rid()) => ({ id, type: 'rect', x: 10, y: 10, w: 100, h: 50, color: '#4263EB', strokeWidth: 3 });
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
