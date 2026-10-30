import { z } from 'zod';
import type { DB } from '../database/db';
import type { ChatMessage } from '../types';
import { newId } from '../utils/auth';

export const chatSchema = z.object({ text: z.string().trim().min(1).max(1000) }).strict();
type Row = { id: string; session_id: string; participant_id: string | null; sender_name: string; text: string; kind: string; created_at: number };
const toMsg = (r: Row): ChatMessage => ({
  id: r.id, sessionId: r.session_id, participantId: r.participant_id, senderName: r.sender_name,
  text: r.text, kind: r.kind as 'user' | 'system', createdAt: r.created_at,
});

export class ChatService {
  constructor(private db: DB) {}
  add(sessionId: string, participantId: string | null, senderName: string, text: string, kind: 'user' | 'system' = 'user'): ChatMessage {
    const m: ChatMessage = { id: newId(), sessionId, participantId, senderName, text, kind, createdAt: Date.now() };
    this.db.prepare('INSERT INTO chat_messages (id, session_id, participant_id, sender_name, text, kind, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(m.id, sessionId, participantId, senderName, text, kind, m.createdAt);
    return m;
  }
  recent(sessionId: string, limit = 200): ChatMessage[] {
    const rows = this.db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(sessionId, limit) as Row[];
    return rows.reverse().map(toMsg);
  }
}
