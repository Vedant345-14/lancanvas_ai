import { describe, expect, it } from 'vitest';
import { hashPassword, signToken, verifyPassword, verifyToken, generateCode } from '../src/utils/auth';
import { can } from '../src/services/sessions/permissions';
import { getLanAddresses, isPrivateIPv4 } from '../src/utils/network';
import { describeBoard } from '../src/services/board/describe';
import { sniffImage } from '../src/services/uploadService';
import { DEFAULT_PERMS, DEFAULT_SETTINGS } from '../src/services/sessions/sessionService';
import { extractJson } from '../src/services/ai/notesService';
import { RateLimiter } from '../src/utils/rateLimit';
import { PNG } from './helpers';
import type { BoardObject, Participant, Session } from '../src/types';

const session = (s: Partial<Session['settings']> = {}): Session => ({ id: 's1', code: 'ABC234', name: 'x', passwordHash: null, hostId: 'h', settings: { ...DEFAULT_SETTINGS, ...s }, createdAt: 0, closed: false });
const person = (o: Partial<Participant> = {}): Participant => ({ id: 'p1', sessionId: 's1', name: 'a', role: 'participant', status: 'approved', perms: { ...DEFAULT_PERMS }, createdAt: 0, ...o });

describe('auth utils', () => {
  it('verifies signed tokens and rejects tampering/expiry', () => {
    const t = signToken('secret', 'p', 's');
    expect(verifyToken('secret', t)).toMatchObject({ pid: 'p', sid: 's' });
    expect(verifyToken('other', t)).toBeNull();
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ pid: 'host', sid: 's', exp: 9999999999 })).toString('base64url');
    expect(verifyToken('secret', `${forged}.${sig}`)).toBeNull();
    expect(verifyToken('secret', payload)).toBeNull();
    expect(verifyToken('secret', signToken('secret', 'p', 's', -10))).toBeNull();
  });
  it('hashes passwords with salt', () => {
    const h = hashPassword('hunter2');
    expect(h).not.toContain('hunter2');
    expect(verifyPassword('hunter2', h)).toBe(true);
    expect(verifyPassword('nope', h)).toBe(false);
    expect(hashPassword('hunter2')).not.toBe(h);
  });
  it('generates unambiguous codes', () => { expect(generateCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); });
});

describe('permission matrix', () => {
  it('host can always do everything, even when locked', () => {
    const s = session({ locked: true, drawPolicy: 'none' });
    for (const a of ['draw', 'upload', 'chat', 'clear', 'manage'] as const) expect(can(s, person({ role: 'host' }), a)).toBe(true);
  });
  it('policy none/everyone/selected', () => {
    expect(can(session({ drawPolicy: 'none' }), person({ perms: { ...DEFAULT_PERMS, canDraw: true } }), 'draw')).toBe(false);
    expect(can(session({ drawPolicy: 'everyone' }), person(), 'draw')).toBe(true);
    expect(can(session({ drawPolicy: 'selected' }), person(), 'draw')).toBe(false);
    expect(can(session({ drawPolicy: 'selected' }), person({ perms: { ...DEFAULT_PERMS, canDraw: true } }), 'draw')).toBe(true);
  });
  it('lock overrides everything for non-hosts', () => {
    expect(can(session({ drawPolicy: 'everyone', locked: true }), person(), 'draw')).toBe(false);
  });
  it('pending/removed/other-session users get nothing', () => {
    const s = session({ drawPolicy: 'everyone' });
    expect(can(s, person({ status: 'pending' }), 'chat')).toBe(false);
    expect(can(s, person({ status: 'removed' }), 'draw')).toBe(false);
    expect(can(s, person({ sessionId: 'other' }), 'draw')).toBe(false);
  });
  it('upload / ai / clear / manage rules', () => {
    const editor = person({ perms: { ...DEFAULT_PERMS, canDraw: true } });
    expect(can(session(), editor, 'upload')).toBe(true);
    expect(can(session({ allowUploads: false }), editor, 'upload')).toBe(false);
    expect(can(session(), person(), 'upload')).toBe(false);
    expect(can(session(), editor, 'ai')).toBe(false);
    expect(can(session({ allowAI: true }), editor, 'ai')).toBe(true);
    expect(can(session(), editor, 'clear')).toBe(false);
    expect(can(session(), editor, 'manage')).toBe(false);
  });
});

describe('network utils', () => {
  it('classifies private ranges', () => {
    expect(isPrivateIPv4('192.168.1.5')).toBe(true);
    expect(isPrivateIPv4('10.0.0.2')).toBe(true);
    expect(isPrivateIPv4('172.20.1.1')).toBe(true);
    expect(isPrivateIPv4('172.32.0.1')).toBe(false);
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
  });
  it('lists non-loopback IPv4 only, preferring physical private adapters', () => {
    const mk = (address: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4') => ({ address, netmask: '', family, mac: '', internal, cidr: null }) as any;
    const out = getLanAddresses(8000, { lo: [mk('127.0.0.1', true)], 'vEthernet (WSL)': [mk('172.25.0.1')], 'Wi-Fi': [mk('192.168.1.23'), mk('fe80::1', false, 'IPv6')] });
    expect(out.map((o) => o.address)).toEqual(['192.168.1.23', '172.25.0.1']);
    expect(out[0].url).toBe('http://192.168.1.23:8000');
    expect(out[1].likelyVirtual).toBe(true);
  });
});

describe('misc', () => {
  it('sniffs real image types, not filenames', () => {
    expect(sniffImage(PNG)?.ext).toBe('png');
    expect(sniffImage(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext).toBe('jpg');
  });
  it('rate limiter windows', () => {
    const r = new RateLimiter(2, 1000);
    expect([r.allow('a', 0), r.allow('a', 1), r.allow('a', 2), r.allow('a', 1500)]).toEqual([true, true, false, true]);
  });
  it('extractJson handles fences and prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(() => extractJson('nothing')).toThrow();
  });
  it('describeBoard links labels and arrow endpoints', () => {
    const base = { color: '#000000', strokeWidth: 2, author: 'x', z: 1, ts: 0 };
    const objs: BoardObject[] = [
      { ...base, id: 'a1', type: 'rect', x: 0, y: 0, w: 100, h: 60 },
      { ...base, id: 'a2', type: 'text', x: 20, y: 20, w: 60, h: 20, text: 'Client' },
      { ...base, id: 'a3', type: 'rect', x: 300, y: 0, w: 100, h: 60 },
      { ...base, id: 'a4', type: 'text', x: 320, y: 20, w: 60, h: 20, text: 'Server' },
      { ...base, id: 'a5', type: 'arrow', x: 100, y: 30, w: 200, h: 0 },
      { ...base, id: 'a6', type: 'text', x: 0, y: 200, w: 200, h: 20, text: 'TCP three-way handshake' },
    ];
    const d = describeBoard(objs);
    expect(d.text).toContain('arrow points from "Client" to "Server"');
    expect(d.text).toContain('TCP three-way handshake');
    expect(d.counts.rect).toBe(2);
    expect(describeBoard([]).text).toBe('The board is empty.');
  });
});
