// The coach's tools (ARCHITECTURE §6, features H2–H4), served over MCP on localhost with a per-run
// token. Few on purpose: a small model uses a short list well. The coach has no other tools.
//
// Built so far: get_state, get_facts, say, annotate, show_position, play_line, check_move, owner_profile, find_content.
// The owner's rule (D33): the coach never supplies moves, lines or squares. play_line asks the
// engine for the line; annotate draws from facts; check_move is the engine's verdict.
// Arriving with their phases: owner_profile, find_content, start_activity, record (Phase 5 on).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export type ToolResult = Record<string, unknown>;

export type CoachTools = {
  get_state(): Promise<ToolResult>;
  get_facts(a: { target?: 'focus' | 'demo' }): Promise<ToolResult>;
  say(a: { seq: number; kind: string; text: string; claims?: string[]; expect?: string; choices?: string[] }): Promise<ToolResult>;
  annotate(a: { seq: number; facts?: string[]; show?: 'threats' | 'targets' | 'attacks'; clear?: boolean }): Promise<ToolResult>;
  show_position(a: { seq: number; fen?: string; moves?: string[]; at?: string; label?: string; restore?: boolean }): Promise<ToolResult>;
  play_line(a: { seq: number; what: 'best' | 'move' | 'threat'; move?: string; label?: string; from?: string }): Promise<ToolResult>;
  check_move(a: { move: string; from?: string }): Promise<ToolResult>;
  owner_profile(): Promise<ToolResult>;
  find_content(a: { type: 'puzzle'; theme?: string }): Promise<ToolResult>;
};

export function buildMcpServer(tools: CoachTools): McpServer {
  const server = new McpServer({ name: 'chess', version: '0.1.0' });
  const reply = (r: ToolResult) => ({ content: [{ type: 'text' as const, text: JSON.stringify(r) }] });
  const guard = async (fn: () => Promise<ToolResult>) => {
    try {
      return reply(await fn());
    } catch (e) {
      return reply({ ok: false, problems: [`tool error: ${(e as Error).message}`] });
    }
  };

  server.registerTool(
    'get_state',
    { description: 'The board right now: seq, whose move, the last move, which layer is showing (the owner\'s board or your demo) and where your demo board stands, the lines you have shown (and which ones are the owner\'s own tries), and anything the owner has drawn on the board themselves (`ownerDrew`).', inputSchema: {} },
    () => guard(() => tools.get_state()),
  );

  server.registerTool(
    'get_facts',
    {
      description: 'The verified facts for a position: every attack, hanging pieces, the threat, the strongest moves, checks/captures/threats. target "focus" = the owner\'s board (usually already in the event); "demo" = the position you are showing.',
      inputSchema: { target: z.enum(['focus', 'demo']).optional() },
    },
    (a) => guard(() => tools.get_facts(a)),
  );

  server.registerTool(
    'say',
    {
      description:
        'Say one short message to the owner. The ONLY way to speak. Write every move, square and piece as a token: {m:Nf3} (a legal move on the board), {m:Bxf3@P4.F2} (a move inside fact P4.F2\'s line), {sq:e4}, {pc:Nf3}. List in `claims` the ids of the facts that back what you state. It is checked against the board; if it returns ok:false, fix the listed problems and call say again.',
      inputSchema: {
        seq: z.number().int().describe('the seq of the event you are answering'),
        kind: z.enum(['question', 'nudge', 'answer', 'explain', 'praise', 'idea', 'summary', 'general']),
        text: z.string().min(1),
        claims: z.array(z.string()).optional().describe('fact ids, e.g. ["P7.F2"]'),
        expect: z.enum(['none', 'move', 'choice', 'text']).optional().describe('what you want back: a move on the board, a choice, typed text, or nothing'),
        choices: z.array(z.string()).max(4).optional(),
      },
    },
    (a) => guard(() => tools.say(a)),
  );

  server.registerTool(
    'annotate',
    {
      description:
        'Draw on the board the owner is looking at. Either give `facts` (the ids of the facts to show: the app draws the attacker\'s arrow and a box on the piece in danger for a hangs / attack / pin / check / threat fact; the move for a best_move, check_move or line fact), or give `show` and the app works out the whole category itself on the board that is showing: "threats" = everything the other side is doing to the owner (red boxes on the owner\'s pieces that can be taken, red arrows from the attackers, the threat move, a check, a pin); "targets" = the owner\'s chances (amber boxes on their loose pieces, the owner\'s attacking lines); "attacks" = every attacked piece on both sides. `show` returns the facts it drew, to cite. You never give squares yourself. Replaces your earlier drawings; clear:true removes them.',
      inputSchema: {
        seq: z.number().int(),
        facts: z.array(z.string()).max(4).optional().describe('fact ids to draw, e.g. ["P7.F4"]'),
        show: z.enum(['threats', 'targets', 'attacks']).optional().describe('draw a whole category instead of single facts'),
        clear: z.boolean().optional(),
      },
    },
    (a) => guard(() => tools.annotate(a)),
  );

  server.registerTool(
    'play_line',
    {
      description:
        'Have the engine play a line on your demo board so the owner can watch it and step through it. Their own board is kept. You never supply the moves: what "best" = the engine\'s best play from the position; what "move" + move = one move you name ("what if X?"), judged by the engine, then the engine\'s best replies; what "threat" = what the other side plays if nothing is done about it. `from`: "focus" (default: the owner\'s position), "demo" (the position you are showing), or "L3:2" (a subline: branch after move 2 of line L3, e.g. "what if they play Y there instead?"). Returns the engine\'s verdict, the line, and fact ids to cite.',
      inputSchema: {
        seq: z.number().int(),
        what: z.enum(['best', 'move', 'threat']),
        move: z.string().optional().describe('SAN of the one move to try, only with what "move", e.g. "Nxe5"'),
        label: z.string().max(60).optional().describe('a short title the owner sees, e.g. "If you take the pawn"'),
        from: z.string().optional(),
      },
    },
    (a) => guard(() => tools.play_line(a)),
  );

  server.registerTool(
    'show_position',
    {
      description:
        'Control your demo board without moving the owner\'s pieces. Set up a position: give `moves` (SAN from the normal starting position) or a `fen`. Step to a moment of a line you have already shown: `at: "L3:2"` (line L3 after two of its moves) or `at: "base"`. restore:true goes back to the owner\'s board. The owner may try moves on your demo board; you get an `owner_tries` event when they do. Returns the facts of the position shown.',
      inputSchema: {
        seq: z.number().int(),
        fen: z.string().optional(),
        moves: z.array(z.string()).optional(),
        at: z.string().optional().describe('"L3:2" or "base": step your demo board there'),
        label: z.string().max(60).optional(),
        restore: z.boolean().optional(),
      },
    },
    (a) => guard(() => tools.show_position(a)),
  );

  server.registerTool(
    'check_move',
    {
      description:
        'Judge one move before you talk about it: is it legal, is it good or a mistake, and what does it win or lose in plain words. Use it for a move the owner suggests and for any move you want to make a claim about. `from`: "focus" (default) or "demo". Returns fact ids to cite.',
      inputSchema: { move: z.string().describe('SAN, e.g. "Nxe5"'), from: z.enum(['focus', 'demo']).optional() },
    },
    (a) => guard(() => tools.check_move(a)),
  );

  server.registerTool(
    'owner_profile',
    {
      description:
        "What the app knows about the owner from their own games: how often they blunder, hang pieces, lose the opening and convert won games, which step of the thinking routine they skip most, the habits their reviews keep coming back to, and their own notes on the game on the board. Counted by code. Use it to choose what to dwell on and how much to explain; do not read numbers out to the owner.",
    },
    () => guard(() => tools.owner_profile()),
  );

  server.registerTool(
    'find_content',
    {
      description:
        "What the owner can practise: the puzzles made from their own games (with where each came from and its themes), and the themes of the Lichess puzzle database that have puzzles at their level. Only checked, live puzzles are listed. Use it to suggest practice in words; the owner starts it on the Puzzles tab.",
      inputSchema: { type: z.enum(['puzzle']), theme: z.string().optional().describe('only this theme, e.g. "fork"') },
    },
    (a) => guard(() => tools.find_content(a)),
  );

  return server;
}

/** Handle one MCP request (stateless: a fresh server object per request, as the SDK recommends). */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, body: unknown, tools: CoachTools, token: string): Promise<void> {
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    return;
  }
  const server = buildMcpServer(tools);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
