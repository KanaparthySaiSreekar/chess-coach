import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  absolutePins,
  buildFactPacket,
  capturables,
  cctOf,
  forkOf,
  gradeMove,
  materialChangeInWords,
  materialInWords,
  materialOf,
  moveFacts,
  moveReasons,
  mustPosition,
  packetForCoach,
  playLine,
  relativePins,
  settle,
  type EngineEval,
} from '../src/index.ts';

const after = (moves: string) => {
  const r = playLine(START_FEN, moves.split(' '));
  if (!r.ok) throw new Error(`illegal: ${r.move}`);
  return r.fens.at(-1)!;
};

describe('exchanges and hanging pieces', () => {
  it('finds an undefended piece that can be taken', () => {
    // the black queen on d4 attacks the undefended knight on e5 (Ruy Lopez exchange line)
    const fen = after('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    const blackToMove = fen.replace(' w ', ' b ').replace(/ [a-h][36] /, ' - ');
    const caps = capturables(mustPosition(blackToMove));
    const knight = caps.find((c) => c.piece.square === 'e5')!;
    expect(knight.net).toBe(3);
    expect(knight.bestCapture).toBe('Qxe5');
    expect(knight.defenders).toHaveLength(0);
  });

  it('does not call a defended pawn hanging', () => {
    const caps = capturables(mustPosition(after('e4 e5 Nf3 Nc6')));
    const e5 = caps.find((c) => c.piece.square === 'e5')!;
    expect(e5.net).toBeLessThanOrEqual(0); // Nxe5 Nxe5 loses a knight for a pawn
  });

  it('never counts a pinned piece as a capturer', () => {
    // White: Ke1, Ne2 (pinned by the rook on e8). Black pawn on d4 is attacked only by that knight.
    const pos = mustPosition('4r1k1/8/8/8/3p4/8/4N3/4K3 w - - 0 1');
    expect(capturables(pos).find((c) => c.piece.square === 'd4')).toBeUndefined();
    expect(absolutePins(pos)).toEqual([{ pinned: { square: 'e2', role: 'knight', color: 'white' }, by: { square: 'e8', role: 'rook', color: 'black' } }]);
  });

  it('lists checks, captures, mates and threats', () => {
    const cct = cctOf(mustPosition(after('e4 e5 Bc4 Nc6 Qh5 Nf6')));
    expect(cct.mates).toEqual(['Qxf7#']);
    expect(cct.captures).toContain('Qxe5+');
    const quiet = cctOf(mustPosition(after('e4 e5 Bc4 Nc6 Qh5')));
    expect(quiet.threats).toContain('g6'); // attacks the queen
  });

  it('says material in plain words, with trades left out', () => {
    const start = mustPosition(START_FEN);
    expect(materialInWords(materialOf(start), 'white')).toBe('Material is level.');
    const upRook = mustPosition('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    expect(materialInWords(materialOf(upRook), 'white')).toBe('You are up a rook.');
    expect(materialInWords(materialOf(upRook), 'black')).toBe('You are down a rook.');
    // queens come off and White also loses a pawn: only the pawn is worth saying
    const before = after('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    const line = playLine(before, ['Nf3', 'Qxe4+', 'Qe2', 'Qxe2+', 'Kxe2']);
    expect(line.ok).toBe(true);
    if (line.ok) expect(materialChangeInWords(before, line.fens.at(-1)!, 'white')).toEqual({ delta: -1, text: 'you lose a pawn' });
  });
});

describe('relative pins', () => {
  it("sees the knight shielding the queen in Legal's trap, and says the engine decides whether to move it", () => {
    const fen = after('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6');
    expect(relativePins(mustPosition(fen))).toEqual([
      { pinned: { square: 'f3', role: 'knight', color: 'white' }, by: { square: 'g4', role: 'bishop', color: 'black' }, behind: { square: 'd1', role: 'queen', color: 'white' } },
    ]);
    const p = buildFactPacket({ id: 'P9', fen, you: 'white' });
    const pin = p.facts.find((f) => f.type === 'pin')!;
    expect(pin.text).toBe('Your knight {pc:Nf3} is pinned to your queen {pc:Qd1} by their bishop {pc:Bg4}: it may move, but then their bishop {pc:Bg4} can take the queen. Whether moving it is still good is for the engine to say.');
  });
  it('does not call a piece pinned when the piece behind it is not worth more', () => {
    expect(relativePins(mustPosition(after('e4 e5 Nf3 Nc6 Bc4 Bc5')))).toEqual([]);
  });
});

describe('fork detection', () => {
  it('sees a knight fork of king and rook', () => {
    const fork = forkOf('r3k3/8/8/1N6/8/8/PPP5/2K5 w - - 0 1', 'Nc7+');
    expect(fork?.targets.map((t) => t.role).sort()).toEqual(['king', 'rook']);
  });
  it('does not call an ordinary move a fork', () => {
    expect(forkOf(START_FEN, 'Nf3')).toBeNull();
  });
});

describe('what a move does: reasons worked out from the board', () => {
  const tags = (fen: string, san: string, threat?: string) => moveReasons(fen, san, 'white', threat).map((r) => r.tag);
  const queenFork = after('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');

  it('sees a piece moved out of danger, and a pawn that now protects it', () => {
    expect(tags(queenFork, 'Ng4')).toContain('saves');
    expect(tags(queenFork, 'f4')).toContain('defends');
    expect(tags(queenFork, 'a3')).not.toContain('saves');
    expect(tags(queenFork, 'a3')).not.toContain('defends');
  });

  it('knows whether a move deals with the threat', () => {
    const scholar = after('e4 e5 Bc4 Nc6 Qh5 a6 a3'); // Black to move again; White threatens Qxf7#
    const forBlack = (san: string) => moveReasons(scholar, san, 'black', 'Qxf7#').map((r) => r.tag);
    expect(forBlack('g6')).toContain('stops_threat'); // the pawn blocks the queen
    expect(forBlack('Qe7')).toContain('stops_threat'); // the queen guards f7
    expect(forBlack('Nf6')).not.toContain('stops_threat'); // attacks the queen but allows mate
    expect(forBlack('Nf6')).toContain('attacks');
  });

  it('names development, castling, the centre, captures and checks', () => {
    expect(tags(START_FEN, 'Nf3')).toContain('develops');
    expect(tags(START_FEN, 'e4')).toContain('centre');
    expect(tags(START_FEN, 'a3')).toEqual([]);
    const italian = after('e4 e5 Nf3 Nc6 Bc4 Bc5');
    expect(tags(italian, 'O-O')).toContain('castles');
    expect(tags(italian, 'd3')).toContain('guards'); // the pawn now guards the bishop on c4
    expect(tags(italian, 'Bxf7+')).toEqual(expect.arrayContaining(['captures', 'check']));
  });

  it("writes the reasons into the fact, in the owner's voice", () => {
    const texts = moveReasons(queenFork, 'Ng4', 'white', 'Qxe5').map((r) => r.text);
    expect(texts).toContain('it moves your attacked knight out of danger');
    expect(texts).toContain('it deals with their threat');
  });

  it('names the square of the pawn an en passant capture takes, not the empty square it lands on', () => {
    // the Réti's 1...d6 2.d4 f5 line: 8.d5 e5 9.dxe6, the pawn taken stood on e5
    const ep = after('Nf3 d6 d4 f5 g3 Nf6 Bg2 g6 O-O Bg7 c4 O-O Nc3 c6 d5 e5');
    expect(moveReasons(ep, 'dxe6', 'white').map((r) => r.text)).toContain('it takes their pawn on {sq:e5}');
    expect(moveReasons(after('e4 e5 Nf3 d6 d4 exd4'), 'Nxd4', 'white').map((r) => r.text)).toContain('it takes their pawn on {sq:d4}');
  });
});

describe('following a line until the captures stop', () => {
  it('keeps going through captures and checks, then stops', () => {
    const fen = after('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6');
    const s = settle(fen, ['f3e5', 'd6e5', 'd1g4', 'b8d7']);
    expect(s.sans).toEqual(['Nxe5', 'dxe5', 'Qxg4']);
  });
});

describe('grading a move from engine lines', () => {
  // synthetic engine output: the facts must follow from it, whatever the engine is
  const fenBefore = after('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5');
  const evalBefore: EngineEval = { fen: fenBefore, lines: [{ pv: ['c4b5', 'c7c6', 'd5c6', 'b7c6'], score: { cp: 60 } }] };

  it('calls a move that drops a knight a blunder and says what was lost', () => {
    const g = gradeMove({ fenBefore, san: 'Ne6', evalBefore, playedLine: { pv: ['g5e6', 'f7e6'], score: { cp: -420 } }, you: 'white' });
    expect(g?.cls).toBe('blunder');
    expect(g?.lost).toBe('you lose a knight');
    expect(g?.best).toBe('Bb5+');
  });

  it('writes facts with tokens that point into the right line', () => {
    let n = 0;
    const res = moveFacts({ fenBefore, san: 'Ne6', evalBefore, playedLine: { pv: ['g5e6', 'f7e6'], score: { cp: -420 } }, you: 'white' }, () => `T.F${++n}`, { past: true });
    expect(res?.facts[0]!.type).toBe('loses_material');
    expect(res?.facts[0]!.text).toBe('{m:Ne6@T.F1} was a serious mistake: you lose a knight after {m:fxe6@T.F1}.');
    expect(res?.facts[1]!.text).toMatch(/^The strongest move would have been \{m:Bb5\+@T\.F2\}/);
  });

  it("speaks from the owner's side when the opponent is the one moving", () => {
    let n = 0;
    const res = moveFacts({ fenBefore, san: 'Ne6', evalBefore, playedLine: { pv: ['g5e6', 'f7e6'], score: { cp: -420 } }, you: 'white' }, () => `T.F${++n}`, { owner: 'black' });
    expect(res?.facts[0]!.text).toBe('{m:Ne6@T.F1} is a serious mistake by them: you win a knight after {m:fxe6@T.F1}.');
  });

  it('reports the best move as best', () => {
    const g = gradeMove({ fenBefore, san: 'Bb5+', evalBefore, playedLine: evalBefore.lines[0]!, you: 'white' });
    expect(g?.isBest).toBe(true);
    expect(g?.cls).toBe('ok');
  });
});

describe('the fact packet', () => {
  it('needs no engine to list attacks, pins, castling and material', () => {
    const fen = after('e4 e5 Nf3 Nc6 Bb5 d6');
    const p = buildFactPacket({ id: 'P1', fen, you: 'black' });
    const texts = p.facts.map((f) => f.text);
    expect(texts).toContain('Material is level.');
    expect(p.facts.find((f) => f.type === 'pin')?.text).toBe('Your knight {pc:Nc6} is pinned by their bishop {pc:Bb5}: it cannot move away without exposing the king.');
    expect(texts).toContain('They can castle kingside right now with {m:O-O}.');
    expect(texts.some((t) => t.startsWith('You cannot castle kingside yet:'))).toBe(true);
    expect(p.facts.every((f) => /^P1\.F\d+$/.test(f.id))).toBe(true);
  });

  it('states the threat found by giving the opponent a free move', () => {
    const fen = after('e4 e5 Bc4 Nc6 Qh5');
    const pass = fen.replace(' b ', ' w ');
    const p = buildFactPacket({
      id: 'P2',
      fen,
      you: 'black',
      eval: { fen, lines: [{ pv: ['g7g6'], score: { cp: 20 } }] },
      passEval: { fen: pass, lines: [{ pv: ['h5f7'], score: { mate: 1 } }] },
    });
    expect(p.threat?.move).toBe('Qxf7#');
    expect(p.threat?.mateIn).toBe(1);
    expect(p.facts.find((f) => f.type === 'threat')?.text).toMatch(/they play \{m:Qxf7#@P2\.F\d+\} and it is checkmate in 1/);
  });

  it('reports checkmate and stalemate instead of analysing them', () => {
    const mate = buildFactPacket({ id: 'P3', fen: after('f3 e5 g4 Qh4#'), you: 'white' });
    expect(mate.over).toBe('checkmate');
    expect(mate.facts[0]!.text).toBe('You have been checkmated.');
    const stale = buildFactPacket({ id: 'P4', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', you: 'white' });
    expect(stale.over).toBe('stalemate');
  });

  it('hands the coach words and ids, never engine numbers', () => {
    const fen = after('e4 e5');
    const p = buildFactPacket({ id: 'P5', fen, you: 'white', eval: { fen, lines: [{ pv: ['g1f3', 'b8c6'], score: { cp: 31 } }] } });
    const forCoach = JSON.stringify(packetForCoach(p));
    expect(forCoach).not.toMatch(/"win"|"cp"|"score"|\b31\b/);
    expect(forCoach).toContain('"toMove":"you"');
  });
});
