import type { Config } from './config';
import type { DB } from './database/db';
import type { SessionService } from './services/sessions/sessionService';
import type { BoardService } from './services/board/boardService';
import type { ChatService } from './services/chatService';
import type { UploadService } from './services/uploadService';
import type { NotesService } from './services/ai/notesService';

export interface AppContext {
  config: Config;
  db: DB;
  sessions: SessionService;
  board: BoardService;
  chat: ChatService;
  uploads: UploadService;
  notes: NotesService;
}
