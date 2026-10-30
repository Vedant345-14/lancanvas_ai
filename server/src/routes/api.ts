import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { ZodError } from 'zod';
import type { AppContext } from '../context';
import { authenticate } from '../middleware/auth';
import { generateSchema } from '../services/ai/schema';
import { can } from '../services/sessions/permissions';
import { createSessionSchema, joinSchema } from '../services/sessions/sessionService';
import { signToken } from '../utils/auth';
import { badRequest, forbidden, HttpError, notFound } from '../utils/errors';
import { getLanAddresses } from '../utils/network';
import { RateLimiter } from '../utils/rateLimit';

const wrap = (fn: express.RequestHandler): express.RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

export function buildApi(ctx: AppContext): Router {
  const r = Router();
  const createLimit = new RateLimiter(ctx.config.joinRateLimit, 60_000);
  const joinLimit = new RateLimiter(ctx.config.joinRateLimit, 60_000);
  const aiLimit = new RateLimiter(6, 60_000);
  const uploadLimit = new RateLimiter(20, 60_000);
  const small = express.json({ limit: '20kb' });
  const big = express.json({ limit: '9mb' });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ctx.config.maxUploadBytes, files: 1 } });
  const ip = (req: express.Request) => req.ip ?? 'unknown';

  r.get('/health', (_req, res) => res.json({ ok: true, name: 'LanCanvas AI', time: Date.now(), aiConfigured: ctx.notes.isConfigured() }));

  r.post('/sessions', small, wrap((req, res) => {
    if (!createLimit.allow(ip(req))) throw new HttpError(429, 'RATE_LIMITED', 'Too many classrooms created. Wait a minute.');
    const input = createSessionSchema.parse(req.body);
    const { session, host } = ctx.sessions.createSession(input);
    res.status(201).json({
      code: session.code, name: session.name, participantId: host.id, role: 'host',
      token: signToken(ctx.config.sessionSecret, host.id, session.id),
    });
  }));

  r.get('/sessions/:code/public', wrap((req, res) => {
    if (!joinLimit.allow('pub:' + ip(req))) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute.');
    const s = ctx.sessions.getSessionByCode(req.params.code);
    if (!s) return res.json({ exists: false });
    res.json({ exists: true, name: s.name, requiresPassword: !!s.passwordHash, closed: s.closed, requiresApproval: s.settings.requireApproval });
  }));

  r.post('/sessions/:code/join', small, wrap((req, res) => {
    if (!joinLimit.allow('join:' + ip(req))) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
    const input = joinSchema.parse(req.body);
    const { session, participant } = ctx.sessions.join(req.params.code, input);
    res.status(201).json({
      code: session.code, name: session.name, participantId: participant.id, role: participant.role, status: participant.status,
      token: signToken(ctx.config.sessionSecret, participant.id, session.id),
    });
  }));

  r.get('/sessions/:code/network', wrap((req, res) => {
    const { participant } = authenticate(ctx, req, { allowClosedForHost: true });
    if (participant.role !== 'host') throw forbidden('Only the host can view network details.');
    res.json({ port: ctx.config.port, bindHost: ctx.config.host, addresses: getLanAddresses(ctx.config.port) });
  }));

  r.post('/sessions/:code/reopen', wrap((req, res) => {
    const { session, participant } = authenticate(ctx, req, { allowClosedForHost: true });
    if (participant.role !== 'host') throw forbidden('Only the host can reopen the classroom.');
    ctx.sessions.setClosed(session.id, false);
    res.json({ ok: true });
  }));

  r.get('/sessions/:code/export/board', wrap((req, res) => {
    const { session, participant } = authenticate(ctx, req);
    const payload: Record<string, unknown> = {
      exportedAt: new Date().toISOString(), classroom: session.name, code: session.code,
      objects: ctx.board.list(session.id),
    };
    if (can(session, participant, 'chat') || participant.role === 'host') payload.chat = ctx.chat.recent(session.id, 1000);
    res.setHeader('Content-Disposition', `attachment; filename="lancanvas-${session.code}.json"`);
    res.json(payload);
  }));

  r.post('/sessions/:code/uploads', wrap((req, res, next) => {
    // Authenticate and authorize BEFORE reading the body.
    const { session, participant } = authenticate(ctx, req);
    if (!can(session, participant, 'upload')) throw forbidden('You do not have permission to upload images.');
    if (!uploadLimit.allow(participant.id)) throw new HttpError(429, 'RATE_LIMITED', 'Too many uploads. Slow down.');
    (req as any).auth = { session, participant };
    upload.single('file')(req, res, (err) => {
      if (err) return next(err instanceof multer.MulterError ? badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 5 MB).' : 'Upload failed.') : err);
      try {
        if (!req.file) throw badRequest('No file received (field name must be "file").');
        const saved = ctx.uploads.save(session.id, participant.id, req.file.originalname, req.file.buffer);
        res.status(201).json(saved);
      } catch (e) { next(e); }
    });
  }));

  r.get('/sessions/:code/files/:name', wrap((req, res) => {
    const { session } = authenticate(ctx, req);
    const f = ctx.uploads.resolve(session.id, req.params.name);
    if (!f) throw notFound('File not found.');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.resolve(f.file));
  }));

  r.post('/sessions/:code/ai/notes', big, wrap(async (req, res) => {
    const { session, participant } = authenticate(ctx, req);
    if (!can(session, participant, 'ai')) throw forbidden('The host has not allowed you to generate AI notes.');
    if (!ctx.notes.isConfigured()) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI is not configured on this server. Ask the host to set AI_API_KEY in .env and restart.');
    if (!aiLimit.allow(session.id)) throw new HttpError(429, 'RATE_LIMITED', 'AI notes were requested too often. Wait a minute.');
    const input = generateSchema.parse(req.body ?? {});
    const out = await ctx.notes.generate({
      sessionId: session.id, sessionName: session.name, participantId: participant.id, mode: input.mode,
      objects: ctx.board.list(session.id), // server-held board is the source of truth, never client-sent text
      chat: session.settings.chatToAI ? ctx.chat.recent(session.id, 300) : null,
      image: input.image,
    });
    res.json(out);
  }));

  r.get('/sessions/:code/ai/notes/latest', wrap((req, res) => {
    const { session, participant } = authenticate(ctx, req);
    if (!can(session, participant, 'ai')) throw forbidden('The host has not allowed you to view AI notes.');
    res.json({ latest: ctx.notes.latest(session.id), configured: ctx.notes.isConfigured() });
  }));

  r.use((_req, _res, next) => next(notFound('Unknown API endpoint.')));
  r.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid request.', code: 'BAD_REQUEST' });
    if ((err as any)?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.', code: 'TOO_LARGE' });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON.', code: 'BAD_REQUEST' });
    console.error('[api] unexpected error', err);
    res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL' });
  });
  return r;
}
