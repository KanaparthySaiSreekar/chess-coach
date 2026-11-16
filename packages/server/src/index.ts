// The server: one process on 127.0.0.1 (ARCHITECTURE §1, §15). HTTP for the built page and the
// coach's tool endpoint, one WebSocket for the page (http.ts).
//
//   node packages/server/src/index.ts              API + WebSocket (the page comes from Vite in dev)
//   node packages/server/src/index.ts --serve-web  also serves packages/web/dist

import { existsSync } from 'node:fs';
import path from 'node:path';
import { App } from './app.ts';
import { config } from './config.ts';
import { serve } from './http.ts';

const serveWeb = process.argv.includes('--serve-web');
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

const app = new App({
  repoRoot: config.repoRoot,
  dataDir: config.dataDir,
  stockfish: config.stockfish,
  syzygy: existsSync(config.syzygy) ? config.syzygy : undefined,
  expectedBench: config.expectedBench,
  claudePath: config.claude,
  openingsDir: config.openingsDir,
  mcpUrl: `http://${config.host}:${config.port}/mcp`,
  maia: { python: config.maiaPython, script: config.maiaSidecar, models: config.maiaModels },
  lichessToken: config.lichessToken,
  rosterFile: config.rosterFile,
  log,
});

const served = await serve(app, { host: config.host, port: config.port, webDist: serveWeb ? path.join(config.repoRoot, 'packages', 'web', 'dist') : undefined, log });
log(`chess-coach server on http://${config.host}:${served.port}${serveWeb ? '' : ' (API only; the page runs on the Vite port)'}`);
log(`openings: ${app.book.count}; data: ${config.dataDir}`);
// once the engine is verified, the content checks that depend on it: re-validation when the engine or a threshold changed, then the trap pack
void app.verifyEngine().then(() => app.afterEngineReady());
app.resume();

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  log('stopping');
  await served.close();
  await app.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
