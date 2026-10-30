import type { Auth, NetworkInfo, NotesResult } from '../types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function request<T>(path: string, opts: { method?: string; token?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the classroom server. Check that the host is running and you are on the same network.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'ERROR', data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; aiConfigured: boolean }>('/api/health'),
  publicInfo: (code: string) => request<{ exists: boolean; name?: string; requiresPassword?: boolean; closed?: boolean; requiresApproval?: boolean }>(`/api/sessions/${encodeURIComponent(code)}/public`),
  create: (b: { name: string; hostName: string; password?: string; requireApproval: boolean }) =>
    request<{ code: string; name: string; token: string }>('/api/sessions', { body: b }),
  join: (code: string, b: { name: string; password?: string }) =>
    request<{ code: string; name: string; token: string; status: string }>(`/api/sessions/${encodeURIComponent(code)}/join`, { body: b }),
  network: (a: Auth) => request<NetworkInfo>(`/api/sessions/${a.code}/network`, { token: a.token }),
  reopen: (a: Auth) => request<{ ok: boolean }>(`/api/sessions/${a.code}/reopen`, { method: 'POST', token: a.token }),
  upload: (a: Auth, file: File) => { const f = new FormData(); f.append('file', file); return request<{ src: string }>(`/api/sessions/${a.code}/uploads`, { token: a.token, form: f }); },
  generateNotes: (a: Auth, mode: string, image?: string) => request<NotesResult>(`/api/sessions/${a.code}/ai/notes`, { token: a.token, body: { mode, image } }),
  latestNotes: (a: Auth) => request<{ latest: (NotesResult & { notes: NotesResult['notes'] }) | null; configured: boolean }>(`/api/sessions/${a.code}/ai/notes/latest`, { token: a.token }),
  exportJson: async (a: Auth) => {
    const res = await fetch(`/api/sessions/${a.code}/export/board`, { headers: { Authorization: `Bearer ${a.token}` } });
    if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Could not export the board.');
    return res.blob();
  },
  fileUrl: (a: Auth, src: string) => `/api/sessions/${a.code}/files/${src}?token=${encodeURIComponent(a.token)}`,
};

// ---- locally remembered classrooms (tokens stay on this device) ----
const KEY = 'lancanvas.saved.v1';
export const saved = {
  list(): Auth[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } },
  put(a: Auth) { const l = saved.list().filter((x) => x.code !== a.code); l.unshift(a); localStorage.setItem(KEY, JSON.stringify(l.slice(0, 12))); },
  remove(code: string) { localStorage.setItem(KEY, JSON.stringify(saved.list().filter((x) => x.code !== code))); },
};
const ACTIVE = 'lancanvas.active.v1';
export const activeAuth = {
  get(): Auth | null { try { return JSON.parse(sessionStorage.getItem(ACTIVE) || 'null'); } catch { return null; } },
  set(a: Auth | null) { if (a) sessionStorage.setItem(ACTIVE, JSON.stringify(a)); else sessionStorage.removeItem(ACTIVE); },
};
