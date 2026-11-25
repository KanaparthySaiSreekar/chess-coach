// The HTTP side of the server (ARCHITECTURE §1, §15): the built page, the coach's tool endpoint and
// one WebSocket for the page, all on 127.0.0.1. Kept apart from index.ts so the page tests can
// start the same server around an App of their own (a scripted coach, a stand-in bot).

import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '@chess-coach/core';
import type { App, Client } from './app.ts';
import { handleMcp } from './coach/mcp.ts';
import { int16leToFloat, LISTEN_RATE, VoiceError, type VoiceService } from './voice.ts';

/** A page of this machine (the dev page on Vite's port, or the built one), or no page at all (a tool). */
const sameMachine = (origin: string | undefined) => !origin || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);


/**
 * The voice (A20, A21; ARCHITECTURE §20): the coach's words as audio, the owner's voice as words, and
 * the model download. Binary in and out, so plain HTTP rather than the page's WebSocket. Only pages on
 * this machine may ask.
 */
export function voiceRoutes(fastify: FastifyInstance, voice: VoiceService) {
  const refuse = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (e instanceof VoiceError) return reply.code(e.status).send({ error: e.message });
    return reply.code(500).send({ error: `The voice failed: ${(e as Error).message}` });
  };
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: LISTEN_RATE * 2 * 61 }, (_req, body, done) => done(null, body));

  fastify.get('/api/voice/status', async () => voice.status());

  fastify.post('/api/voice/speak', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (!sameMachine(request.headers.origin)) return reply.code(403).send({ error: 'Not from this machine.' });
    const body = (request.body ?? {}) as { text?: unknown; voice?: unknown; speed?: unknown };
    try {
      const wav = await voice.speak(String(body.text ?? ''), typeof body.voice === 'string' ? body.voice : undefined, typeof body.speed === 'number' ? body.speed : 1);
      return reply.type('audio/wav').header('cache-control', 'no-store').send(wav);
    } catch (e) {
      return refuse(e, reply);
    }
  });

  // 16-bit little-endian mono samples at 16 kHz, as the page records them
  fastify.post('/api/voice/listen', async (request, reply) => {
    if (!sameMachine(request.headers.origin)) return reply.code(403).send({ error: 'Not from this machine.' });
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'Send the samples as application/octet-stream.' });
    try {
      return { text: await voice.listen(int16leToFloat(request.body)) };
    } catch (e) {
      return refuse(e, reply);
    }
  });

  fastify.post('/api/voice/install', async (request, reply) => {
    if (!sameMachine(request.headers.origin)) return reply.code(403).send({ error: 'Not from this machine.' });
    void voice.install().catch(() => {}); // how it goes is in the status
    return voice.status();
  });
}

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
  voiceRoutes(fastify, app.voice);

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
    if (!req.url?.startsWith('/ws') || !sameMachine(req.headers.origin)) return socket.destroy();
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
