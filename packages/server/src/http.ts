// The HTTP side of the server (ARCHITECTURE §1, §15): the built page, the coach's tool endpoint and
// one WebSocket for the page, all on 127.0.0.1. Kept apart from index.ts so the page tests can
// start the same server around an App of their own (a scripted coach, a stand-in bot).

import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '@chess-coach/core';
import type { App, Client } from './app.ts';
import { handleMcp } from './coach/mcp.ts';

export type ServeOptions = {
  host: string;
  /** 0 = any free port (tests) */
  port: number;
  /** the folder of the built page (packages/web/dist); left out = API and WebSocket only */
  webDist?: string;
  log?: (msg: string) => void;
};

export type Served = { port: number; url: string; close: () => Promise<void> };

export async function serve(app: App, opts: ServeOptions): Promise<Served> {
  const log = opts.log ?? (() => {});
  const fastify = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  // the coach's tools: only a caller holding this run's token gets in
  fastify.all('/mcp', async (request, reply) => {
    reply.hijack();
    try {
      await handleMcp(request.raw, reply.raw, request.body, app.tools, app.coach.token);
    } catch (e) {
      log(`mcp error: ${(e as Error).message}`);
      if (!reply.raw.headersSent) reply.raw.writeHead(500).end();
    }
  });

  fastify.get('/api/health', async () => ({ ok: true, engine: app.engineInfo, coach: app.coach.status.state, openings: app.book.count }));

  if (opts.webDist && existsSync(opts.webDist)) {
    // only the built page is served; nothing under data/ is ever reachable (ARCHITECTURE §15)
    await fastify.register(fastifyStatic, { root: opts.webDist });
    fastify.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
  } else if (opts.webDist) {
    log('packages/web/dist is missing: run `npm run build` first, or use `npm run dev`');
  }

  const wss = new WebSocketServer({ noServer: true });
  fastify.server.on('upgrade', (req, socket, head) => {
    // same-machine pages only: the dev page (Vite) and the built page
    const origin = req.headers.origin ?? '';
    const okOrigin = !origin || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    if (!req.url?.startsWith('/ws') || !okOrigin) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const client: Client = {
      send: (msg: ServerMsg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    const remove = app.addClient(client);
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString()) as ClientMsg;
      } catch {
        return;
      }
      app.onClientMessage(client, msg).catch((e) => {
        log(`error handling ${msg.type}: ${(e as Error).message}`);
        client.send({ type: 'toast', level: 'error', text: 'Something went wrong handling that. Nothing was lost.' });
      });
    });
    ws.on('close', remove);
    ws.on('error', remove);
  });

  await fastify.listen({ host: opts.host, port: opts.port });
  const port = (fastify.server.address() as AddressInfo).port;
  return {
    port,
    url: `http://${opts.host}:${port}/`,
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await fastify.close().catch(() => {});
    },
  };
}
