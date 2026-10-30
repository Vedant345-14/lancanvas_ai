import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { Config, loadConfig } from './config';
import type { AppContext } from './context';
import { openDatabase } from './database/db';
import { buildApi } from './routes/api';
import { NotesService } from './services/ai/notesService';
import { AIProvider, OpenAICompatibleProvider } from './services/ai/provider';
import { BoardService } from './services/board/boardService';
import { ChatService } from './services/chatService';
import { SessionService } from './services/sessions/sessionService';
import { UploadService } from './services/uploadService';
import { attachSockets } from './sockets';

export function createApp(opts: { config?: Partial<Config>; provider?: AIProvider } = {}) {
  const config = loadConfig(opts.config);
  const db = openDatabase(config.databasePath);
  const ctx: AppContext = {
    config, db,
    sessions: new SessionService(db),
    board: new BoardService(db),
    chat: new ChatService(db),
    uploads: new UploadService(db, config.uploadDir, config.maxUploadBytes),
    notes: new NotesService(db, opts.provider ?? new OpenAICompatibleProvider(config.ai)),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (process.env.LANCANVAS_LOG !== '0' && req.path.startsWith('/api')) {
      res.on('finish', () => console.log(`[http] ${req.method} ${req.path.replace(/token=[^&]+/, 'token=…')} ${res.statusCode}`));
    }
    next();
  });
  app.use('/api', buildApi(ctx));

  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('LanCanvas AI server is running, but the client is not built yet. Run "npm run build" (or "npm run dev" for development).'));
  }

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { maxHttpBufferSize: 256_000, pingInterval: 10_000, pingTimeout: 8_000 });
  const sockets = attachSockets(io, ctx);

  async function close() {
    sockets.shutdown();
    await new Promise<void>((r) => { io.close(() => r()); });
    if (httpServer.listening) await new Promise<void>((r) => httpServer.close(() => r()));
    db.close();
  }
  return { app, httpServer, io, ctx, close };
}
