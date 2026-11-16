import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { miniGoalText, miniProblem, miniVerdict, type MiniGame } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = JSON.parse(readFileSync(path.join(here, '..', '..', '..', 'content', 'minigames.json'), 'utf8')) as { games: MiniGame[] };
const mini = (id: string) => file.games.find((g) => g.id === id)!;

describe('mini-games (F6)', () => {
  it('every mini-game in the content file has a legal position and a goal it can reach', () => {
    expect(file.games.length).toBeGreaterThanOrEqual(4);
    expect(new Set(file.games.map((g) => g.id)).size).toBe(file.games.length);
    for (const g of file.games) expect(miniProblem(g), g.id).toBeNull();
    expect(miniProblem({ ...mini('queen-vs-pawns'), fen: '4k3/8/8/8/8/8/8/3QK3 w - - 0 1' })).toBe('queen-vs-pawns: there are no pawns to stop');
    expect(miniProblem({ ...mini('pawn-war'), fen: 'x' })).toBe('pawn-war: the position is not legal');
    expect(miniGoalText({ kind: 'mate', within: 20 })).toBe('Checkmate within 20 moves.');
  });

  it('a pawn war ends at the first queen; the queen game at a pawn through, or every pawn taken; a mate has its limit', () => {
    const war = mini('pawn-war');
    expect(miniVerdict(war, { san: 'a8=Q', by: 'white', fenAfter: 'Q3k3/8/8/8/8/8/8/4K3 b - - 0 40' }, 20)).toEqual({ winner: 'white', text: 'You made a queen first. You win.' });
    expect(miniVerdict(war, { san: 'h1=Q+', by: 'black', fenAfter: '4k3/8/8/8/8/8/8/4K2q w - - 0 40' }, 20)).toEqual({ winner: 'black', text: 'They made a queen first.' });
    expect(miniVerdict(war, { san: 'e4', by: 'white', fenAfter: '4k3/pppppppp/8/8/4P3/8/PPPP1PPP/4K3 b - - 0 1' }, 1)).toBeNull();
    const q = mini('queen-vs-pawns');
    expect(miniVerdict(q, { san: 'a1=Q', by: 'black', fenAfter: '4k3/8/8/8/8/8/8/q3K3 w - - 0 30' }, 15)).toMatchObject({ winner: 'black' });
    expect(miniVerdict(q, { san: 'Qxh7', by: 'white', fenAfter: '4k3/7Q/8/8/8/8/8/4K3 b - - 0 30' }, 15)).toEqual({ winner: 'white', text: 'You took every pawn. You win.' });
    expect(miniVerdict(q, { san: 'Qxh7', by: 'white', fenAfter: '4k3/p6Q/8/8/8/8/8/4K3 b - - 0 30' }, 15)).toBeNull();
    const rooks = mini('two-rook-mate');
    expect(miniVerdict(rooks, { san: 'Ra7', by: 'white', fenAfter: '4k3/R7/8/8/8/8/8/4K2R b - - 0 20' }, 20)).toEqual({ winner: 'black', text: 'No mate within 20 moves. Try it again.' });
    expect(miniVerdict(rooks, { san: 'Ra7', by: 'white', fenAfter: '4k3/R7/8/8/8/8/8/4K2R b - - 0 20' }, 19)).toBeNull();
    // a mate on the last move allowed is a mate
    expect(miniVerdict(rooks, { san: 'Rh8#', by: 'white', fenAfter: '4k2R/R7/8/8/8/8/8/4K3 b - - 0 20' }, 20)).toBeNull();
  });
});
