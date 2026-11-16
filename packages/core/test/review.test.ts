import { describe, expect, it } from 'vitest';
import { START_FEN, gradeGame, isLiveMove, momentCandidates, pickMoments, playLine, pointDepth, replayPlan, summariseGame, tagGame, type Color, type EngineEval, type GamePly, type GradeResult, type MoveLabel, type SkippedStep } from '../src/index.ts';

// The Scholar's Mate, with the engine's answers written by hand: every move is the engine's own
// choice except 3...Nf6, where it wanted g6.
const SCHOLAR = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
const scholarEvals = (): (EngineEval | null)[] => {
  const r = playLine(START_FEN, SCHOLAR);
  if (!r.ok) throw new Error('setup');
  const fens = [START_FEN, ...r.fens];
  const best = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g7g6', 'h5f7'];
  const scores = [{ cp: 30 }, { cp: -30 }, { cp: 10 }, { cp: -10 }, { cp: 20 }, { cp: -30 }, { mate: 1 }];
  return [...best.map((uci, i) => ({ fen: fens[i]!, lines: [{ pv: [uci], score: scores[i]! }] })), null];
};

describe('grading a whole game from one engine result per position', () => {
  const plies = gradeGame({ rootFen: START_FEN, moves: SCHOLAR, evals: scholarEvals() });

  it('labels every move, and finds the one that lost the game', () => {
    expect(plies.map((p) => p.judged?.label)).toEqual(['best', 'best', 'best', 'best', 'best', 'blunder', 'best']);
    const slip = plies[5]!;
    expect(slip).toMatchObject({ ply: 6, san: 'Nf6', by: 'black' });
    expect(slip.judged).toMatchObject({ label: 'blunder', best: 'g6' });
    expect(slip.judged!.why).toMatch(/checkmate/);
    expect(slip.grade).toMatchObject({ live: true, mateAllowed: 1 });
    // the move that mates is scored without asking the engine about the finished position
    expect(plies[6]).toMatchObject({ san: 'Qxf7#', whiteWin: 100 });
    expect(plies[5]!.whiteWin).toBe(100);
    expect(plies[0]!.whiteWin).toBeGreaterThan(50);
  });

  it('the same input gives the same output', () => {
    expect(gradeGame({ rootFen: START_FEN, moves: SCHOLAR, evals: scholarEvals() })).toEqual(plies);
  });

  it('a move into or out of a position the engine was not asked about is left ungraded', () => {
    const evals = scholarEvals();
    evals[5] = null;
    const some = gradeGame({ rootFen: START_FEN, moves: SCHOLAR, evals });
    expect(some[5]!.judged).toBeUndefined();
    expect(some[4]!.judged).toBeDefined(); // Bc4 was the engine's own choice: its line is enough
    expect(some).toHaveLength(7);
  });

  it('an opening position is a book move, and the moments are the owner\'s only', () => {
    const book = gradeGame({ rootFen: START_FEN, moves: SCHOLAR, evals: scholarEvals(), book: (fen) => (fen.includes('4P3') && !fen.includes('Q') ? false : fen.startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/8') ? "King's Pawn Game" : false) });
    expect(book[1]!.judged).toEqual({ label: 'book', why: "King's Pawn Game" });
    expect(pickMoments(plies, 'black').map((m) => [m.number, m.san, m.label, m.kind, m.first])).toEqual([['3...', 'Nf6', 'blunder', 'mate', true]]);
    expect(pickMoments(plies, 'white')).toEqual([]);
    expect(summariseGame(plies, 'black')).toMatchObject({ moves: 3, blunders: 1, liveBlunders: 1, mistakes: 0 });
    expect(summariseGame(plies, 'white')).toMatchObject({ moves: 4, blunders: 0 });
  });
});

// moves made up for the picker: only what it reads is filled in
const slip = (ply: number, label: MoveLabel, drop: number, over: Partial<GradeResult> = {}, by: Color = 'white'): GamePly => ({
  ply,
  san: `m${ply}`,
  by,
  fenBefore: START_FEN,
  fenAfter: START_FEN,
  judged: { label, why: `it loses something on move ${ply}`, best: `b${ply}` },
  grade: { live: true, drop, givenAway: 3, best: `b${ply}`, ...over } as GradeResult,
});

describe('choosing the key moments', () => {
  it('always takes the first turning point, then the biggest, and returns them in game order', () => {
    const plies = [slip(9, 'mistake', 11), slip(21, 'blunder', 40), slip(31, 'blunder', 25), slip(41, 'blunder', 30), slip(51, 'mistake', 12)];
    const picked = pickMoments(plies, 'white', 3);
    expect(picked.map((m) => m.ply)).toEqual([9, 21, 41]);
    expect(picked.map((m) => m.first)).toEqual([true, false, false]);
    expect(picked[0]).toMatchObject({ number: '5.', san: 'm9', label: 'mistake', best: 'b9', why: 'it loses something on move 9', drop: 11 });
    expect(pickMoments(plies, 'white', 1).map((m) => m.ply)).toEqual([9]);
    expect(pickMoments(plies, 'white', 5)).toHaveLength(5);
    expect(pickMoments(plies, 'white', 0)).toEqual([]);
  });

  it('prefers moments of different kinds over a second one of the same kind', () => {
    const plies = [slip(9, 'blunder', 20), slip(21, 'blunder', 40), slip(31, 'mistake', 12, { givenAway: 1 }), slip(41, 'blunder', 30, { mateAllowed: 2 })];
    expect(pickMoments(plies, 'white', 3).map((m) => [m.ply, m.kind])).toEqual([
      [9, 'piece'],
      [31, 'pawn'],
      [41, 'mate'],
    ]);
    // with room for four, the second lost piece comes in as well
    expect(pickMoments(plies, 'white', 4).map((m) => m.ply)).toEqual([9, 21, 31, 41]);
  });

  it('only counts the owner\'s mistakes, blunders and missed chances made while the game was undecided', () => {
    const plies = [
      slip(8, 'blunder', 50, {}, 'black'), // the opponent's
      slip(9, 'inaccuracy', 6),
      slip(11, 'good', 1),
      slip(13, 'blunder', 30, { live: false }), // already lost or already won
      slip(15, 'mistake', 14),
    ];
    expect(momentCandidates(plies, 'white').map((p) => p.ply)).toEqual([15]);
    expect(pickMoments(plies, 'white').map((m) => m.ply)).toEqual([15]);
    expect(pickMoments([slip(9, 'best', 0), { ...slip(11, 'blunder', 30), grade: null }], 'white')).toEqual([]);
  });

  it('takes at most one missed chance, and a slip that lost something comes first', () => {
    const plies = [slip(7, 'miss', 30), slip(15, 'miss', 35), slip(21, 'mistake', 12), slip(33, 'miss', 20)];
    const picked = pickMoments(plies, 'white', 3);
    expect(picked.map((m) => [m.ply, m.label, m.first])).toEqual([
      [15, 'miss', false],
      [21, 'mistake', true],
    ]);
    // nothing but missed chances: the first of them is where the game turned
    expect(pickMoments([slip(7, 'miss', 30), slip(15, 'miss', 35)], 'white').map((m) => [m.ply, m.first])).toEqual([[7, true]]);
  });

  it('once the slips are tagged, different skipped steps come before a second one of the same step', () => {
    const tagged = (ply: number, drop: number, step: SkippedStep) => ({ ...slip(ply, 'blunder', drop), tag: { step, boardStep: step, motifs: [], what: 'hung a knight' } });
    const plies = [tagged(9, 20, 'no_safety_check'), tagged(21, 40, 'no_safety_check'), tagged(31, 12, 'missed_threat'), tagged(41, 30, 'missed_free_material')];
    const picked = pickMoments(plies, 'white', 3);
    expect(picked.map((m) => [m.ply, m.step])).toEqual([
      [9, 'no_safety_check'],
      [31, 'missed_threat'],
      [41, 'missed_free_material'],
    ]);
    expect(picked[0]).toMatchObject({ stepName: 'No safety check on your own move', what: 'hung a knight' });
    expect(summariseGame(plies, 'white').steps).toEqual({ no_safety_check: 2, missed_threat: 1, missed_free_material: 1 });
  });

  it('tags every slip of a graded game, and only the slips', () => {
    const plies = gradeGame({ rootFen: START_FEN, moves: SCHOLAR, evals: scholarEvals() });
    tagGame(plies);
    expect(plies.map((p) => p.tag?.step)).toEqual([undefined, undefined, undefined, undefined, undefined, 'missed_threat', undefined]);
    expect(plies[5]!.tag).toMatchObject({ what: 'allowed checkmate', boardStep: 'missed_threat' });
    // with eight seconds left, the clock is the story
    tagGame(plies, { clocks: [undefined, undefined, undefined, undefined, undefined, { left: 8, base: 600 }] });
    expect(plies[5]!.tag).toMatchObject({ step: 'time', boardStep: 'missed_threat' });
  });

  it('a slip that cost nothing concrete is a moment only when there is nothing else', () => {
    const vague = (ply: number, drop: number) => slip(ply, 'mistake', drop, { givenAway: 0 });
    expect(pickMoments([vague(9, 25), slip(21, 'blunder', 18), vague(31, 30)], 'white').map((m) => m.ply)).toEqual([21]);
    const only = pickMoments([vague(9, 25), vague(31, 30)], 'white');
    expect(only.map((m) => [m.ply, m.kind])).toEqual([
      [9, 'position'],
      [31, 'position'],
    ]);
  });
});

describe('going through a moment: ask, or show a worked example? (the stop rules known before the owner tries)', () => {
  it("counts how many of the mover's own moves the better line needs to show its point", () => {
    // a mate counts its own length
    expect(pointDepth('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['Rd8#'], 1)).toBe(1);
    expect(pointDepth(START_FEN, ['e4'], 3)).toBe(3);
    // a free knight: on the board after one move
    expect(pointDepth('4k3/8/8/3n4/4P3/8/PPP3PP/6K1 w - - 0 1', ['exd5'])).toBe(1);
    // a fork: the check first, the rook on the second move
    expect(pointDepth('r3k3/ppp5/8/8/1n6/5B2/PP3PPP/R3K3 b Qq - 1 1', ['Nc2+', 'Kd2', 'Nxa1'])).toBe(2);
    // a move whose point is not to lose something shows it at once
    expect(pointDepth('4k3/8/8/8/4p3/5N2/PPP3PP/6K1 w - - 0 1', ['Nd4', 'Ke7'])).toBe(1);
    expect(pointDepth('not a position', ['e4'])).toBe(1);
  });

  it('a point deeper than the setting, or a named tactic the owner has not met, is shown instead of asked', () => {
    const opts = { maxDepth: 2, seen: new Set<string>(), workedWhenNew: true };
    expect(replayPlan({ motifs: [], depth: 1 }, opts)).toEqual({ mode: 'ask' });
    expect(replayPlan({ motifs: ['hangingPiece', 'mateIn1'], depth: 2 }, opts)).toEqual({ mode: 'ask' });
    expect(replayPlan({ motifs: [], depth: 3 }, opts)).toEqual({ mode: 'worked', because: 'deep' });
    expect(replayPlan({ motifs: ['fork'], depth: 1 }, opts)).toEqual({ mode: 'worked', because: 'new' });
    // once a fork has come up in a review, the next one is asked
    expect(replayPlan({ motifs: ['fork'], depth: 1 }, { ...opts, seen: new Set(['fork']) })).toEqual({ mode: 'ask' });
    expect(replayPlan({ motifs: ['fork'], depth: 1 }, { ...opts, workedWhenNew: false })).toEqual({ mode: 'ask' });
    // depth is looked at first
    expect(replayPlan({ motifs: ['fork'], depth: 4 }, opts)).toEqual({ mode: 'worked', because: 'deep' });
    expect(replayPlan({}, opts)).toEqual({ mode: 'ask' });
  });
});

describe('a live move (the moves that count for key moments and blunder rates)', () => {
  it('is one played while the game was undecided, or one that threw a won game away', () => {
    expect(isLiveMove({ cp: 30 }, { cp: -250 })).toBe(true); // an even game
    expect(isLiveMove({ cp: 700 }, { cp: 650 })).toBe(false); // won before, still won
    expect(isLiveMove({ cp: 700 }, { cp: -150 })).toBe(true); // won before, thrown away: the turning point
    expect(isLiveMove({ mate: 2 }, { mate: -1 })).toBe(true); // from mating to mated
    expect(isLiveMove({ cp: -800 }, { cp: -1200 })).toBe(false); // lost before: nothing left to lose
    expect(isLiveMove({ cp: -800 }, { mate: -1 })).toBe(false);
  });
});
