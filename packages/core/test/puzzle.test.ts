import { describe, expect, it } from 'vitest';
import { answer, attemptOf, expectedMove, nextRung, playReply, playSetup, reveal, runFen, startRun, yourTurn, type Puzzle, type PuzzleRun } from '../src/index.ts';

// the bishop leaves d1 and the knight forks king and rook: a set-up move, then three moves with a reply between
const FORK: Puzzle = { fen: 'r3k3/ppp5/8/8/1n6/8/PP3PPP/R2BK3 w Qq - 0 1', setup: 'Bf3', solution: ['Nc2+', 'Kd2', 'Nxa1'], themes: ['fork'], kind: 'punish' };
const MATE: Puzzle = { fen: 'r5k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1', solution: ['Rd8+', 'Rxd8', 'Rxd8#'], themes: ['backRankMate'], kind: 'mistake' };
const TWO_WAYS: Puzzle = { fen: '4k3/8/8/3n4/4P3/2N5/PPP3PP/6K1 w - - 0 1', solution: ['exd5'], accepted: { 0: ['Nxd5'] }, themes: ['hangingPiece'], kind: 'punish' };

const begin = (p: Puzzle): PuzzleRun => {
  const r = startRun(p);
  if (!r.ok) throw new Error(r.reason);
  return r.run;
};

describe('solving a puzzle', () => {
  it('starts on the position before the set-up move, then the opponent plays it', () => {
    const run = begin(FORK);
    expect(run).toMatchObject({ you: 'black', ready: false, index: 0, status: 'solving' });
    expect(runFen(run)).toBe(FORK.fen);
    expect(yourTurn(run)).toBe(false);
    expect(answer(run, 'Nc2+').result).toBe('not-now');
    const ready = playSetup(run);
    expect(ready.moves).toMatchObject([{ san: 'Bf3', from: 'd1', to: 'f3', by: 'them' }]);
    expect(yourTurn(ready)).toBe(true);
    // a puzzle with no set-up move is ready at once
    expect(yourTurn(begin(MATE))).toBe(true);
    expect(startRun({ ...MATE, fen: 'nonsense' })).toMatchObject({ ok: false });
  });

  it('a multi-move solution: each right move is answered by the reply, and the last one solves it', () => {
    let run = playSetup(begin(FORK));
    const first = answer(run, 'b4c2');
    expect(first).toMatchObject({ result: 'correct', san: 'Nc2+' });
    run = first.run;
    expect(run).toMatchObject({ index: 1, status: 'solving' });
    expect(yourTurn(run)).toBe(false);
    run = playReply(run);
    expect(run.moves.map((m) => `${m.by}:${m.san}`)).toEqual(['them:Bf3', 'you:Nc2+', 'them:Kd2']);
    expect(yourTurn(run)).toBe(true);
    const last = answer(run, 'Nxa1');
    expect(last.result).toBe('correct');
    expect(last.run.status).toBe('solved');
    expect(attemptOf(last.run)).toEqual({ result: 'solved', hints: 0, misses: 0, clean: true });
    // nothing more happens once it is over
    expect(playReply(last.run)).toBe(last.run);
    expect(answer(last.run, 'Nb3').result).toBe('not-now');
  });

  it('a wrong move changes nothing but the count of misses; an illegal one is not a miss', () => {
    const run = playSetup(begin(FORK));
    const wrong = answer(run, 'Nxa2');
    expect(wrong).toMatchObject({ result: 'wrong', san: 'Nxa2' });
    expect(wrong.run.misses).toBe(1);
    expect(runFen(wrong.run)).toBe(runFen(run));
    expect(answer(run, 'Nb9')).toMatchObject({ result: 'illegal' });
    expect(answer(run, 'Nb9').run.misses).toBe(0);
    // solved after a miss is still solved, but not clean
    const then = answer(playReply(answer(wrong.run, 'Nc2+').run), 'Nxa1').run;
    expect(attemptOf(then)).toEqual({ result: 'solved', hints: 0, misses: 1, clean: false });
  });

  it('an accepted answer is right too, and so is any move that mates', () => {
    const also = answer(begin(TWO_WAYS), 'Nxd5');
    expect(also).toMatchObject({ result: 'also', san: 'Nxd5' });
    expect(also.run).toMatchObject({ status: 'solved', also: true });
    expect(answer(begin(TWO_WAYS), 'e4d5').result).toBe('correct');
    // a three-move line: the last move is the solution's own mate
    const twoMates: Puzzle = { fen: 'r5k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1', solution: ['Rd8+', 'Rxd8', 'Rxd8#'], themes: [], kind: 'mistake' };
    const run = playReply(answer(begin(twoMates), 'Rd8+').run);
    expect(run.moves.map((m) => m.san)).toEqual(['Rd8+', 'Rxd8']);
    expect(answer(run, 'Rxd8#').result).toBe('correct');
    const oneMove: Puzzle = { fen: '6k1/5ppp/8/8/8/8/5PPP/3RQ1K1 w - - 0 1', solution: ['Rd8#'], themes: ['mateIn1'], kind: 'mistake' };
    expect(answer(begin(oneMove), 'Qe8#')).toMatchObject({ result: 'also' });
  });

  it('the hint ladder points at the solution a rung at a time', () => {
    const run = playSetup(begin(FORK));
    expect(nextRung(run)).toBe('question');
    expect(nextRung({ ...run, hints: 1 })).toBe('nudge');
    expect(nextRung({ ...run, hints: 2 })).toBe('arrow');
    expect(nextRung({ ...run, hints: 3 })).toBe('answer');
    expect(expectedMove(run)).toEqual({ san: 'Nc2+', from: 'b4', to: 'c2', role: 'knight' });
    expect(expectedMove(begin(FORK))).toBeNull(); // not before the set-up move
  });

  it('showing the answer plays the rest of the line, from wherever the attempt stands', () => {
    const fromStart = reveal(begin(FORK));
    expect(fromStart.status).toBe('shown');
    expect(fromStart.moves.map((m) => m.san)).toEqual(['Bf3', 'Nc2+', 'Kd2', 'Nxa1']);
    const midway = reveal(playReply(answer(playSetup(begin(FORK)), 'Nc2+').run));
    expect(midway.moves.map((m) => `${m.by}:${m.san}`)).toEqual(['them:Bf3', 'you:Nc2+', 'them:Kd2', 'you:Nxa1']);
    expect(attemptOf({ ...midway, hints: 2, misses: 1 })).toEqual({ result: 'shown', hints: 2, misses: 1, clean: false });
    expect(attemptOf(begin(FORK))).toBeNull();
    // a solved puzzle is not turned into a shown one
    const solved = answer(begin(TWO_WAYS), 'exd5').run;
    expect(reveal(solved).status).toBe('solved');
  });
});
