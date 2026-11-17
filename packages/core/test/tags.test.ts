import { describe, expect, it } from 'vitest';
import { STEP_NAME, STEP_QUESTION, findableMove, gradeMove, lookedQuestion, tagMistake, tagUnclear, type EngineLine, type GradeResult, type MoveClock, type SkippedStep } from '../src/index.ts';

// PLAN WP 5.4: a fixture per row of the skipped-step table (LEARNING §4). Each is a small position,
// the move played, and the engine's lines written by hand: its best move, and the line that
// starts with the move played.
type Fixture = { row: string; fen: string; san: string; best: EngineLine; played: EngineLine; ownThreat?: boolean; clock?: MoveClock; step: SkippedStep; what: RegExp; motif?: string };

const FIXTURES: Fixture[] = [
  {
    row: "didn't answer a direct threat",
    // their pawn on e4 already attacks the knight on f3; White plays a3 and the knight goes
    fen: '4k3/8/8/8/4p3/5N2/PPP3PP/6K1 w - - 0 1',
    san: 'a3',
    best: { pv: ['f3d4'], score: { cp: 500 } },
    played: { pv: ['a2a3', 'e4f3', 'g2f3'], score: { cp: 150 } },
    step: 'missed_threat',
    what: /left a threat unanswered/,
  },
  {
    row: 'own move hung a piece',
    // the knight steps onto e4, where the d5 pawn takes it and nothing takes back
    fen: '4k3/8/8/3p4/8/8/PPP2NPP/6K1 w - - 0 1',
    san: 'Ne4',
    best: { pv: ['f2d3'], score: { cp: 500 } },
    played: { pv: ['f2e4', 'd5e4'], score: { cp: 100 } },
    step: 'no_safety_check',
    what: /hung a knight/,
  },
  {
    row: 'it seemed safe: defended once, attacked twice',
    // e4 is defended by the d3 pawn, so the knight looks safe there; a knight and a bishop both aim at it
    fen: '4k3/1b6/5n2/8/8/3P4/PPP2NPP/6K1 w - - 0 1',
    san: 'Ne4',
    best: { pv: ['a2a3'], score: { cp: 300 } },
    played: { pv: ['f2e4', 'f6e4', 'd3e4', 'b7e4'], score: { cp: 150 } },
    step: 'seemed_safe',
    what: /lost a knight that looked defended/,
  },
  {
    row: 'a principled-looking move fails tactically',
    // the bishop "develops" to f3 and stops guarding c2: the knight forks king and rook
    fen: 'r3k3/ppp5/8/8/1n6/8/PP3PPP/R2BK3 w Qq - 0 1',
    san: 'Bf3',
    best: { pv: ['a2a3'], score: { cp: 150 } },
    played: { pv: ['d1f3', 'b4c2', 'e1d2', 'c2a1'], score: { cp: -350 } },
    step: 'missed_tactic',
    what: /allowed a fork/,
    motif: 'fork',
  },
  {
    row: 'only works if the opponent cooperates',
    // Qh5 threatens mate on f7, and the knight on f6 simply takes the queen
    fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3',
    san: 'Qh5',
    best: { pv: ['d2d3'], score: { cp: 20 } },
    played: { pv: ['d1h5', 'f6h5'], score: { cp: -800 } },
    ownThreat: true,
    step: 'assumed_reply',
    what: /hung a queen/,
  },
  {
    row: 'missed winning a free piece',
    // the e4 pawn can take the knight on d5 for nothing; White plays a3 and the knight walks away
    fen: '4k3/8/8/3n4/4P3/8/PPP3PP/6K1 w - - 0 1',
    san: 'a3',
    best: { pv: ['e4d5'], score: { cp: 900 } },
    played: { pv: ['a2a3', 'd5f6'], score: { cp: 250 } },
    step: 'missed_free_material',
    what: /missed a free knight/,
  },
  {
    row: 'an instant move, or a blunder in time trouble',
    // the same hung knight, with eight seconds left of a ten-minute game
    fen: '4k3/8/8/3p4/8/8/PPP2NPP/6K1 w - - 0 1',
    san: 'Ne4',
    best: { pv: ['f2d3'], score: { cp: 500 } },
    played: { pv: ['f2e4', 'd5e4'], score: { cp: 100 } },
    clock: { left: 8, spent: 2, base: 600 },
    step: 'time',
    what: /hung a knight/,
  },
];

const grade = (f: Fixture): GradeResult => {
  const g = gradeMove({ fenBefore: f.fen, san: f.san, evalBefore: { fen: f.fen, lines: [f.best] }, playedLine: f.played, you: 'white' });
  if (!g) throw new Error(`fixture cannot be graded: ${f.row}`);
  return g;
};

describe('the skipped-step table, one fixture per row', () => {
  for (const f of FIXTURES) {
    it(`${f.row} → ${f.step}`, () => {
      const tag = tagMistake({ fenBefore: f.fen, san: f.san, grade: grade(f), ownThreat: f.ownThreat, clock: f.clock });
      expect(tag.step).toBe(f.step);
      expect(tag.what).toMatch(f.what);
      if (f.motif) expect(tag.motifs).toContain(f.motif);
      // every row has its name on the page and its first question for the coach
      expect(STEP_NAME[tag.step]).toBeTruthy();
      expect(STEP_QUESTION[tag.step]).toMatch(/[.?]$/);
    });
  }

  it('covers every row of the table', () => {
    expect(new Set(FIXTURES.map((f) => f.step))).toEqual(new Set(['missed_threat', 'no_safety_check', 'seemed_safe', 'missed_tactic', 'assumed_reply', 'missed_free_material', 'time']));
  });

  it('the clock is the story only in time trouble or after an instant move; the board step is kept beside it', () => {
    const f = FIXTURES[1]!;
    const tag = (clock?: MoveClock) => tagMistake({ fenBefore: f.fen, san: f.san, grade: grade(f), clock });
    expect(tag({ left: 400, spent: 40, base: 600 }).step).toBe('no_safety_check');
    expect(tag({ left: 400, spent: 2, base: 600 })).toMatchObject({ step: 'time', boardStep: 'no_safety_check' });
    expect(tag({ left: 25, spent: 20, base: 600 }).step).toBe('time'); // under 5% of the time left
    // a three-minute game: a two-second move is the normal pace there
    expect(tag({ left: 100, spent: 2, base: 180 }).step).toBe('no_safety_check');
    // a Daily game has no clock to read
    expect(tag({ left: 10, spent: 1 }).step).toBe('no_safety_check');
    expect(tag().step).toBe('no_safety_check');
  });

  it('a piece taken by something cheaper was hung, even when it was defended', () => {
    // the knight on e4 is defended by the d3 pawn, but a pawn takes it: one look at their captures shows it
    const fen = '4k3/8/8/3p4/8/3P4/PPP2NPP/6K1 w - - 0 1';
    const g = gradeMove({ fenBefore: fen, san: 'Ne4', evalBefore: { fen, lines: [{ pv: ['a2a3'], score: { cp: 500 } }] }, playedLine: { pv: ['f2e4', 'd5e4', 'd3e4'], score: { cp: 150 } }, you: 'white' })!;
    expect(tagMistake({ fenBefore: fen, san: 'Ne4', grade: g })).toMatchObject({ step: 'no_safety_check', what: 'hung a knight' });
  });

  it('walking into a mate in one is a safety check; a missed mate is a gift left on the board', () => {
    const before = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    const g = gradeMove({ fenBefore: before, san: 'Nf6', evalBefore: { fen: before, lines: [{ pv: ['g7g6'], score: { cp: -30 } }] }, playedLine: { pv: ['g8f6', 'h5f7'], score: { mate: -1 } }, you: 'black' })!;
    // the mate was already threatened before the move: answering it was the step
    expect(tagMistake({ fenBefore: before, san: 'Nf6', grade: g })).toMatchObject({ step: 'missed_threat', what: 'allowed checkmate' });
    const mating = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const m = gradeMove({ fenBefore: mating, san: 'd3', evalBefore: { fen: mating, lines: [{ pv: ['h5f7'], score: { mate: 1 } }] }, playedLine: { pv: ['d2d3', 'f6h5'], score: { cp: -700 } }, you: 'white' })!;
    // the queen is also lost here, so this one is a blunder of its own: a threat left unanswered
    expect(tagMistake({ fenBefore: mating, san: 'd3', grade: m }).step).not.toBe('unknown');
    const quiet = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const q = gradeMove({ fenBefore: quiet, san: 'h3', evalBefore: { fen: quiet, lines: [{ pv: ['d1d8'], score: { mate: 1 } }] }, playedLine: { pv: ['h2h3', 'h7h6'], score: { cp: 600 } }, you: 'white' })!;
    expect(tagMistake({ fenBefore: quiet, san: 'h3', grade: q })).toMatchObject({ step: 'missed_free_material', what: 'missed a checkmate' });
    expect(tagMistake({ fenBefore: quiet, san: 'h3', grade: q }).motifs).toContain('backRankMate');
  });
});

describe('the findable move (H12)', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

  it("is the engine's first choice when nothing about as good is easier to find", () => {
    expect(findableMove(fen, [{ pv: ['e1g1'], score: { cp: 40 } }, { pv: ['d2d3'], score: { cp: 35 } }])).toEqual({ move: 'O-O', reason: 'best' });
    expect(findableMove(fen, [])).toBeNull();
  });

  it('prefers a capture or a check that is about as good, and never a move outside the margin', () => {
    const quietFirst = '4k3/8/8/3n4/4P3/8/PPP3PP/6K1 w - - 0 1';
    expect(findableMove(quietFirst, [{ pv: ['g1f2'], score: { cp: 905 } }, { pv: ['e4d5'], score: { cp: 900 } }])).toEqual({ move: 'exd5', reason: 'forcing' });
    // the capture is clearly worse here: the engine's own choice stands
    expect(findableMove(quietFirst, [{ pv: ['g1f2'], score: { cp: 300 } }, { pv: ['e4d5'], score: { cp: 100 } }])).toEqual({ move: 'Kf2', reason: 'best' });
  });

  it('always answers with a move from the engine\'s lines', () => {
    const lines = [{ pv: ['d2d3'], score: { cp: 30 } }, { pv: ['c4f7'], score: { cp: 28 } }, { pv: ['e1g1'], score: { cp: 25 } }];
    const f = findableMove(fen, lines)!;
    expect(['d3', 'Bxf7+', 'O-O']).toContain(f.move);
    // Bxf7+ takes a pawn with check but gives up the bishop: a sacrifice is not the easy move to teach
    expect(f.move).not.toBe('Bxf7+');
  });
});

describe('a tag the board cannot settle (WP 5.7, D105)', () => {
  it('only "it looked safe" and "no safety check" are asked', () => {
    expect(tagUnclear('seemed_safe')).toBe(true);
    expect(tagUnclear('no_safety_check')).toBe(true);
    for (const step of Object.keys(STEP_NAME) as SkippedStep[]) if (step !== 'seemed_safe' && step !== 'no_safety_check') expect(tagUnclear(step)).toBe(false);
    expect(tagUnclear(undefined)).toBe(false);
  });

  it('the question names the move as a token, and each answer means one of the two steps', () => {
    const q = lookedQuestion('12.', 'Nf6');
    expect(q.text).toContain('{m:Nf6}');
    expect(q.choices.map((c) => c.step)).toEqual(['seemed_safe', 'no_safety_check']);
    // the two answers are told apart by their text, and each names the moment
    expect(new Set(q.choices.map((c) => c.text)).size).toBe(2);
    for (const c of q.choices) expect(c.text.startsWith('12.Nf6: ')).toBe(true);
  });
});
