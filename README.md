# LanCanvas AI

A real-time, **LAN-hosted collaborative whiteboard** for classrooms. One computer (the **host**) runs the server; laptops and phones on the same network open its address in a browser and share a live board, group chat, and AI-generated study notes. No cloud account or internet is needed for drawing and chat (AI notes need an AI provider, see below).

**Stack:** React + Vite + TypeScript + Tailwind (client) · Node.js + Express + Socket.IO + TypeScript (server) · SQLite (`better-sqlite3`) · OpenAI-compatible AI adapter.

## Features

- Host creates a classroom (name, optional password, optional per-person approval) and gets a 6-character code.
- Host dashboard: LAN URL candidates, QR code, copy link, pending requests, recent activity.
- Live whiteboard: pen, highlighter, eraser, text, line, arrow, rectangle, ellipse, sticky notes, image upload, select/move/resize, undo/redo, clear (host), zoom/pan/pinch, remote cursors, colors and thickness.
- **Host-controlled permissions, enforced on the server:** nobody / everyone / selected people can draw; lock board; per-person draw, image, chat, AI, and request-access rights; approve, reject, remove.
- Group chat with history, system messages, unread badge, rate limiting.
- AI notes: structured JSON → validated → editable Markdown; short summary and flashcards modes; export Markdown / HTML / PDF (print), board PNG, board JSON.
- Persistence in SQLite: board, chat, permissions, notes survive restarts and reconnects.

## Quick start

Requires **Node.js 20, 22 or 24 (LTS recommended)**. Check with `node -v`.

### Windows (PowerShell)
```powershell
cd lancanvas-ai
npm install
Copy-Item .env.example .env
npm run lan          # builds the client + server and starts hosting
```
### macOS / Linux
```bash
cd lancanvas-ai
npm install
cp .env.example .env
npm run lan
```
The console prints addresses like `http://192.168.1.23:8000`. Open `http://localhost:8000` on the host, choose **Host a classroom**, and share the LAN address (or the QR code on the dashboard) with the class.

| Command | What it does |
|---|---|
| `npm run dev` | Development: API on :8000 and Vite dev server on :5173 (hot reload; also reachable on the LAN at `http://<ip>:5173`) |
| `npm run build` / `npm start` | Production build / run the built server (serves the client too) |
| `npm run lan` | Build + start |
| `npm test` | Backend test suite (separate in-memory/temp databases) |
| `npm run smoke -- http://<ip>:8000` | Live end-to-end check against a running server (host + two clients) |
| `npm run typecheck` | Type-check server and client |

### Find the host's IP manually
- Windows: `ipconfig` → "IPv4 Address" under your Wi-Fi/Ethernet adapter.
- macOS: `ipconfig getifaddr en0` (Wi-Fi) or System Settings → Network.
- Linux: `ip -4 addr` or `hostname -I`.

### If `npm install` / the build misbehaves (especially on Windows)
- **`gyp ERR! find VS` / `prebuild-install warn ... No prebuilt binaries found`** means `better-sqlite3` could not download a ready-made binary for your Node version and tried to compile it. This project pins a version with prebuilt binaries for Node 20/22/24 (Windows, macOS, Linux). If you still see it, use a Node LTS release (`node -v`), make sure you are online, or install "Desktop development with C++" from Visual Studio Build Tools.
- If you see `EPERM ... operation not permitted, rmdir`, something is holding files open: close VS Code terminals, stop any running `node` process, then delete the folders again.
- **Do not keep the project inside OneDrive/Dropbox** (e.g. `Desktop` or `Documents` on many PCs). Sync tools corrupt `node_modules`. Move it to something like `C:\dev\lancanvas-ai`.
- Reinstall cleanly in PowerShell: `Remove-Item -Recurse -Force node_modules, client\node_modules, server\node_modules; Remove-Item package-lock.json; npm install`
- `npm run build` skips the strict type check so a broken editor-types install cannot block hosting. Run `npm run typecheck` to check types.
- `npm audit` warnings come from dev tooling and are not exposed by the running server.

## How a class uses it (test with two clients)
1. Host: start the server, create a classroom, note the code.
2. Client A (another device on the same Wi-Fi): open `http://<host-ip>:8000`, **Join classroom**, enter name + code.
3. Host approves A in **Waiting to join**. A sees the board but is **view-only**.
4. Host: **People → Editor** for A (or Permissions → "Everyone"). A's toolbar enables instantly; A draws and everyone sees it live.
5. Host: **Permissions → Lock board** or set A back to **Viewer** to revoke. The server rejects further edits even from a modified client.
6. Open a second client (another browser profile or a phone) to see chat and cursors between participants.

## AI notes setup
Edit `.env`, then restart the server:
```
AI_API_KEY=your-key
AI_BASE_URL=https://api.openai.com/v1     # any OpenAI-compatible /chat/completions endpoint
AI_MODEL=gpt-4o-mini                       # use a vision-capable model to analyse diagram images
AI_VISION=true                             # false if the model cannot read images
```
Works with OpenAI, OpenRouter, Groq, or local servers (Ollama `http://localhost:11434/v1`, LM Studio). Without a key, everything else still works and the AI tab explains how to enable it.
- Nothing is sent until someone presses **Generate**. Board text/structure comes from the **server's** copy of the board; the client only supplies the snapshot image.
- The host decides whether participants may generate notes and whether chat is included (both off by default).
- If the model rejects images, the server retries text-only and the notes carry a visible caveat. The prompt forbids inventing content and asks the model to separate "on the board", "AI interpretation" and "uncertain".
- To use a non-OpenAI-style API, implement the `AIProvider` interface in `server/src/services/ai/provider.ts`; nothing else changes.
- The key stays on the server and is never sent to browsers. The AI provider is contacted from the host computer, so the host needs internet for AI.

## Troubleshooting connections
| Symptom | Cause / fix |
|---|---|
| `localhost` works on the host but not on other devices | `localhost` always means "this machine". Clients must use the host's LAN IP (`http://192.168.x.x:8000`). |
| Page doesn't load on clients | Not on the same network; **guest Wi-Fi / "client isolation"** blocks device-to-device traffic; VPN active; different subnet. Ask IT or use a phone hotspot/router without isolation. |
| Works for you, blocked for others | Host firewall. **Allow Node.js inbound on the Private profile** (don't disable the firewall). Windows: Windows Security → Firewall → *Allow an app* → Node.js (Private), or in an admin PowerShell: `New-NetFirewallRule -DisplayName "LanCanvas" -Direction Inbound -Protocol TCP -LocalPort 8000 -Profile Private -Action Allow`. macOS: allow incoming connections for `node` when prompted. Linux (ufw): `sudo ufw allow from 192.168.0.0/16 to any port 8000 proto tcp`. |
| Test from another computer | Browse to `http://<host-ip>:8000/api/health`: you should see `{"ok":true,...}`. Or `curl http://<host-ip>:8000/api/health`. |
| `Port 8000 is already in use` | Windows: `netstat -ano | findstr :8000`. macOS/Linux: `lsof -i :8000`. Stop that program or set `PORT=8001` in `.env`. |
| Page loads but board says "Reconnecting" | Socket.IO (WebSocket) blocked or server stopped. Open the browser dev tools → Network → look for `/socket.io/` failures; check the host console, firewall, and that the server is still running. |
| Several IPs listed | Pick the adapter on the same network as the class (usually Wi-Fi). VM/VPN/Docker adapters rarely work. |
| Everyone disconnected | The host must keep the server running. Restart it: classrooms, boards and chat are restored from SQLite and clients reconnect automatically. |

## Security notes
- Designed for **trusted private networks**. Plain HTTP on a LAN means anyone on that network could sniff traffic. Do not expose the port to the internet (no port forwarding) and avoid public/guest Wi-Fi. Set `HOST=127.0.0.1` to keep it local only.
- Auth: random classroom code + optional scrypt-hashed password → HMAC-signed token. The signing secret is `SESSION_SECRET` or, if blank, a random one auto-generated in `data/.session_secret`.
- Every Socket.IO event and REST route re-reads the participant and session from the database and checks `can(session, participant, action)`; roles and IDs from the browser are never trusted. Object IDs are looked up inside the caller's own session only (cross-classroom isolation).
- Payloads are schema-validated (zod) with size caps; chat, board events, joins, uploads and AI calls are rate-limited; chat is rendered as text only (no HTML injection).
- Uploads: PNG/JPEG/WebP only, detected by **magic bytes**, ≤ 5 MB, random server filenames, stored under `uploads/<session>/`, served only to authenticated members with `nosniff` and a locked-down CSP.

## Project structure
```
lancanvas-ai/
  client/src/{pages,components,hooks,services,types,styles}
  client/src/features/{whiteboard,chat,participants,ai-notes}
  server/src/{routes,sockets,middleware,services/{ai,board,sessions},database,utils,types}
  server/tests/          # vitest suites
  scripts/smoke.mjs      # live end-to-end check
  data/  uploads/        # runtime data (git-ignored, .gitkeep placeholders)
  .env.example  README.md
```

## Design trade-offs (student-project scope)
- Last-write-wins per object (no CRDT/OT). Concurrent edits to the *same* object resolve by arrival order at the server; adds/removes are idempotent by ID.
- Undo/redo is per user and replayed through the server (so permissions still apply). "Clear board" is not undoable.
- Single Node process, in-memory rate limits and presence; SQLite write-through. Fine for a classroom (tens of users), not for thousands.
- Participant identity is a display name per classroom (no email accounts). A token stored in the browser resumes the identity after refresh.
- Image URLs carry the token in the query string (needed for `<img>`); acceptable on a trusted LAN, logged requests mask it.
- No TLS by default. Browsers only allow clipboard APIs on HTTPS/localhost, so "Copy" uses a fallback on plain-HTTP LAN pages.

## How this demonstrates Computer Networks concepts
- **Client–server architecture:** one authoritative server, many thin browser clients.
- **LAN communication & addressing:** private IPv4 discovery (10/8, 172.16/12, 192.168/16), subnets, why `localhost` ≠ LAN IP, adapter selection.
- **Ports & sockets / TCP/IP:** the server listens on TCP port 8000 bound to `0.0.0.0`; HTTP (application layer) over TCP over IP.
- **WebSockets & real-time delivery:** Socket.IO upgrades HTTP to a persistent full-duplex WebSocket; rooms scope broadcasts; volatile events for cursors; reconnection with state resync.
- **Authentication & access control:** credentials → signed tokens → per-event authorization; role-based permissions enforced server-side.
- **Reliability:** acknowledgements, idempotent operations, reconnect/backoff, graceful shutdown.
- **Security/firewalls:** inbound rules, client isolation, why LAN-only exposure matters.

## Tests
`npm test` runs 44 backend tests: session creation, valid/invalid join, host-only operations, viewer rejection / editor acceptance / revocation, cross-session isolation, chat access and rate limits, upload validation, persistence across a server restart, AI configuration errors and provider adapter behaviour, invalid and oversized payloads. Frontend automated tests are not included; the UI was type-checked and built but must be exercised manually in a browser.
