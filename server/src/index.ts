import { createApp } from './app';
import { loadConfig } from './config';
import { getLanAddresses } from './utils/network';

const config = loadConfig();
const { httpServer, close, ctx } = createApp({ config });

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') console.error(`\n✖ Port ${config.port} is already in use. Stop the other program or set PORT in .env.\n`);
  else console.error('Server error:', err);
  process.exit(1);
});

httpServer.listen(config.port, config.host, () => {
  console.log('\n  LanCanvas AI is running\n');
  console.log(`  Bind address : ${config.host}:${config.port}`);
  console.log(`  This computer: http://localhost:${config.port}`);
  if (config.host === '0.0.0.0' || config.host === '::') {
    const addrs = getLanAddresses(config.port);
    if (addrs.length === 0) console.log('  LAN          : no network interface found. Connect to Wi-Fi/Ethernet.');
    for (const a of addrs) console.log(`  LAN (${a.iface.padEnd(10)}): ${a.url}${a.isPrivate && !a.likelyVirtual ? '   <- share this with clients' : ''}`);
    console.log('\n  Only use on trusted private networks. See README > Security.');
  } else {
    console.log('  Bound to a single address: other devices cannot connect unless HOST=0.0.0.0.');
  }
  console.log(`  AI notes     : ${ctx.notes.isConfigured() ? `enabled (${config.ai.model})` : 'not configured (set AI_API_KEY in .env)'}`);
  console.log(`  Database     : ${config.databasePath}\n`);
});

let closing = false;
async function shutdown(sig: string) {
  if (closing) return;
  closing = true;
  console.log(`\n${sig} received — shutting down gracefully...`);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  await close();
  console.log('Goodbye.');
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
