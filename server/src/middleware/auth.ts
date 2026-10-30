import type { Request } from 'express';
import type { AppContext } from '../context';
import type { Participant, Session } from '../types';
import { verifyToken } from '../utils/auth';
import { HttpError } from '../utils/errors';

export interface Authed { session: Session; participant: Participant }

export function tokenFromRequest(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return typeof req.query.token === 'string' ? req.query.token : undefined; // used by <img src> only
}

/**
 * Resolves the caller from the signed token AND re-checks state in the database,
 * so removed/rejected users lose access immediately. The :code in the URL must
 * match the token's session (cross-session isolation).
 */
export function authenticate(ctx: AppContext, req: Request, opts: { allowClosedForHost?: boolean } = {}): Authed {
  const claims = verifyToken(ctx.config.sessionSecret, tokenFromRequest(req));
  if (!claims) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to the classroom first.');
  const participant = ctx.sessions.getParticipant(claims.pid);
  const session = participant && ctx.sessions.getSessionById(participant.sessionId);
  if (!participant || !session || participant.sessionId !== claims.sid) throw new HttpError(401, 'UNAUTHENTICATED', 'Your session is no longer valid.');
  if (session.code !== String(req.params.code ?? '').toUpperCase()) throw new HttpError(403, 'WRONG_SESSION', 'This token does not belong to that classroom.');
  if (participant.status !== 'approved') throw new HttpError(403, 'NOT_APPROVED', 'The host has not approved you yet.');
  if (session.closed && !(opts.allowClosedForHost && participant.role === 'host')) throw new HttpError(423, 'SESSION_CLOSED', 'The classroom is closed.');
  return { session, participant };
}
