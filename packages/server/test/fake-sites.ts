// A stand-in for Lichess and Chess.com that answers from recorded files (PLAN WP 5.1: recorded API
// answers as fixtures; every name replaced: the owner is "OwnerLichess" / "OwnerChessCom").

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Http, HttpResponse } from '../src/importers.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'test', 'fixtures', 'import');
export const file = (name: string) => readFileSync(path.join(dir, name), 'utf8');
/** the opening explorer's recorded answers (WP 8.2) */
const explorerFile = (name: string) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'explorer', name), 'utf8');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const lichessLines = file('lichess.ndjson').trim().split('\n');
const lichessById = (id: string) => lichessLines.find((l) => (JSON.parse(l) as { id: string }).id === id)!;
export const ongoingCc = JSON.parse(file('chesscom-ongoing.json')) as { games: { pgn: string; fen: string }[] };
export const NOW = Date.UTC(2026, 10, 15, 12);

export type Fake = { http: Http; calls: { url: string; headers: Record<string, string> }[]; fail: Set<string>; status: Map<string, number> };

export function fakeSites(): Fake {
  const calls: Fake['calls'] = [];
  const fail = new Set<string>();
  const status = new Map<string, number>();
  const answer = (code: number, body = '', headers: Record<string, string> = {}): HttpResponse => ({ status: code, header: (n) => headers[n.toLowerCase()] ?? null, text: async () => body });
  const http: Http = async (url, headers = {}) => {
    calls.push({ url, headers });
    const u = new URL(url);
    for (const part of fail) if (url.includes(part)) throw new Error('network down');
    for (const [part, code] of status) if (url.includes(part)) return answer(code);
    if (u.host === 'lichess.org' && u.pathname === '/api/games/user/OwnerLichess') {
      if (u.searchParams.get('ongoing') === 'true') return answer(200, `${JSON.stringify({ id: 'live0001', variant: 'standard', speed: 'correspondence', status: 'started', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3', players: { white: { user: { name: 'OwnerLichess' } }, black: { user: { name: 'rival_three' } } } })}\n`);
      const since = Number(u.searchParams.get('since'));
      const perfs = (u.searchParams.get('perfType') ?? '').split(',');
      const lines = lichessLines.filter((l) => {
        const g = JSON.parse(l) as { perf: string; createdAt: number };
        return g.createdAt >= since && perfs.includes(g.perf);
      });
      return answer(200, `${lines.join('\n')}\n`);
    }
    if (u.host === 'lichess.org' && u.pathname === '/api/games/user/nobody') return answer(404);
    if (u.host === 'lichess.org' && u.pathname === '/game/export/gggg7777') return answer(200, lichessById('gggg7777'));
    if (u.host === 'lichess.org' && u.pathname === '/game/export/eeee5555') return answer(200, lichessById('eeee5555'));
    if (u.host === 'lichess.org' && u.pathname.startsWith('/game/export/')) return answer(404);
    if (u.host === 'api.chess.com' && u.pathname === '/pub/player/ownerchesscom/games/archives') return answer(200, file('chesscom-archives.json'));
    const month = /^\/pub\/player\/ownerchesscom\/games\/(\d{4})\/(\d{2})$/.exec(u.pathname);
    if (u.host === 'api.chess.com' && month) {
      const etag = `W/"${month[1]}-${month[2]}"`;
      if (headers['If-None-Match'] === etag) return answer(304);
      return answer(200, file(`chesscom-${month[1]}-${month[2]}.json`), { etag });
    }
    if (u.host === 'api.chess.com' && u.pathname === '/pub/player/ownerchesscom/games') return answer(200, file('chesscom-ongoing.json'));
    // a study exported from Lichess (WP 8.7): a Black repertoire in chapters
    if (u.host === 'lichess.org' && u.pathname === '/api/study/RepStud1.pgn') return answer(200, readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repertoire-black.pgn'), 'utf8'));
    if (u.host === 'explorer.lichess.org') {
      if (!headers.Authorization) return answer(401);
      const fen = u.searchParams.get('fen');
      if (u.pathname === '/masters' && fen === START) return answer(200, explorerFile('masters-start.json'));
      if (u.pathname === '/lichess' && fen === START) return answer(200, explorerFile('lichess-start.json'));
      if (u.pathname === '/lichess' && fen === AFTER_E4) return answer(200, explorerFile('lichess-e4.json'));
      return answer(200, JSON.stringify({ white: 0, draws: 0, black: 0, moves: [] }));
    }
    return answer(404);
  };
  return { http, calls, fail, status };
}
