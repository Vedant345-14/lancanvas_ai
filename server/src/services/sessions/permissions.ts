import type { Action, Effective, Participant, Session } from '../../types';

/**
 * Single source of truth for "may this participant do X right now?".
 * Used by REST routes and Socket.IO handlers; also sent to clients (for UI hints only).
 */
export function can(session: Session, p: Participant, action: Action): boolean {
  if (p.sessionId !== session.id || p.status !== 'approved') return false;
  const s = session.settings;
  if (p.role === 'host') return true;
  switch (action) {
    case 'manage':
    case 'clear':
      return false;
    case 'draw':
      return !s.locked && (s.drawPolicy === 'everyone' || (s.drawPolicy === 'selected' && p.perms.canDraw));
    case 'upload':
      return can(session, p, 'draw') && s.allowUploads && p.perms.canUpload;
    case 'chat':
      return s.chatEnabled && p.perms.canChat;
    case 'ai':
      return s.allowAI && p.perms.canAI;
    case 'request':
      return p.perms.canRequest && !can(session, p, 'draw');
  }
}

export function effective(session: Session, p: Participant): Effective {
  return {
    draw: can(session, p, 'draw'),
    upload: can(session, p, 'upload'),
    chat: can(session, p, 'chat'),
    ai: can(session, p, 'ai'),
    request: can(session, p, 'request'),
    clear: can(session, p, 'clear'),
    manage: can(session, p, 'manage'),
  };
}
