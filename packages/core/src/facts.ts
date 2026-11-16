// The fact packet: the verified facts for a position or a move (ARCHITECTURE §7, feature H15).
// Built from the rules (chessops) and from engine results handed in by the server. The model never
// adds to it: it may only talk about what is in here, and the validator checks that it did.
//
// Every fact text is written from the owner's side ("your" / "their") and marks anything
// checkable as a token: {m:Nf3} a move, {m:Bxf3@P4.F2} a move inside fact P4.F2's line,
// {sq:e4} a square, {pc:Nf3} a piece on its square.

import { boardStepOf } from './tags.ts';
import {
  ROLE_LETTER,
  ROLE_VALUE,
  anyToMove,
  describeMove,
  fenOf,
  makeSquare,
  mustPosition,
  opposite,
  parsePosition,
  parseSquare,
  passPosition,
  uciToMove,
  type Chess,
  type Color,
  type Role,
} from './chess.ts';
import { attackedBy, attackersOf, attacksSquare, captureGain, capturables, cctOf, materialChangeInWords, materialInWords, materialOf, type Capturable, type Cct, type PieceRef } from './attacks.ts';
import type { NormalMove } from 'chessops/types';
import { DEFAULT_THRESHOLDS, balanceInWords, classifyDrop, dropOf, flipScore, isLiveMove, winChance, type MoveClass, type Score, type Thresholds } from './winchance.ts';
import { between } from 'chessops/attacks';

// ---------------------------------------------------------------- types

/** One engine line: UCI moves and the score from the point of view of the side to move at its start. */
export type EngineLine = { pv: string[]; score: Score };
/** A (multi-line) engine result for one position, best line first. */
export type EngineEval = {
  fen: string;
  lines: EngineLine[];
  /** how many times the search read the endgame tablebases: above zero with five pieces or fewer, the result is exact */
  tbhits?: number;
};

export type FactType =
  | 'material' | 'check' | 'attack' | 'hangs' | 'threat' | 'mate_in' | 'best_move' | 'good_move' | 'only_move'
  | 'wins_material' | 'loses_material' | 'safe' | 'unsafe' | 'fork' | 'pin' | 'graded' | 'line' | 'opening'
  | 'game_over' | 'cct' | 'castling' | 'quiet' | 'tablebase' | 'illegal';

export type Fact = {
  id: string;
  type: FactType;
  text: string;
  /** squares, pieces, moves, counts. `baseFen` + `line` (SAN) give the positions a {m:…@id} token may refer to. */
  data: Record<string, unknown> & { baseFen?: string; line?: string[] };
};

export type EngineMove = { san: string; line: string[]; verdict: string; outcome: string; win: number; mate?: number };

export type ThreatFact = { move: string; line: string[]; text: string; factId: string; mateIn?: number; delta: number };

/** The rows of the skipped-step table (LEARNING §4), as far as a machine can tell them apart: tags.ts. */
export type SkippedStep = 'missed_threat' | 'no_safety_check' | 'seemed_safe' | 'missed_tactic' | 'assumed_reply' | 'missed_free_material' | 'time' | 'unknown';

export type Graded = {
  san: string;
  cls: MoveClass;
  drop: number;
  live: boolean;
  isBest: boolean;
  best: string;
  /** what the move cost, in words; undefined when it cost nothing concrete */
  lost?: string;
  line: string[]; // the move played and the punishing continuation (SAN)
  bestLine: string[];
  factId: string;
  bestFactId?: string;
};

export type FactPacket = {
  id: string;
  fen: string;
  turn: Color;
  you: Color;
  moveNumber: number;
  inCheck: boolean;
  over?: string;
  material: { white: number; black: number; inWords: string };
  lastMove?: { san: string; by: 'owner' | 'opponent' | 'coach' };
  pieces: { yours: PieceRef[]; theirs: PieceRef[] };
  hanging: { mine: PieceRef[]; theirs: PieceRef[] };
  cct: { mine: Cct | null; theirs: Cct | null };
  threat?: ThreatFact;
  engine: { best: EngineMove[]; mate?: number };
  /** an endgame with five pieces or fewer: the exact result with best play, from the tablebases */
  tablebase?: 'you win' | 'draw' | 'you lose';
  graded?: Graded;
  /**
   * The verdict on the move that led here, whoever played it. On the analysis board the owner
   * moves for both sides and asks about either ("why is their queen move good?"), so the other
   * side's move is judged too. `graded` stays the owner's own move only: it drives the hint ladder.
   */
  lastVerdict?: { san: string; by: 'owner' | 'opponent'; cls: MoveClass; factId: string; bestFactId?: string };
  skippedStep?: SkippedStep;
  findable?: { move: string; reason: 'forcing' | 'simple' };
  opening?: { eco: string; name: string };
  facts: Fact[];
};

export type FactInput = {
  id: string;
  fen: string;
  you: Color;
  lastMove?: { san: string; by: 'owner' | 'opponent' | 'coach'; fenBefore: string };
  /** the focus position, MultiPV */
  eval?: EngineEval;
  /** the same position with the other side to move (when that is legal): "what if I pass?" */
  passEval?: EngineEval;
  /** for grading the owner's last move: the position before it… */
  prevEval?: EngineEval;
  /** …and the engine's line that starts with the move played, searched from that same position */
  playedLine?: EngineLine;
  /** engine lines for specific captures in the focus position (SAN → line), to check that a "free" piece really is free */
  captureLines?: Record<string, EngineLine>;
  opening?: { eco: string; name: string };
  thresholds?: Thresholds;
};

// ---------------------------------------------------------------- small helpers

export const tok = {
  m: (san: string, factId?: string) => (factId ? `{m:${san}@${factId}}` : `{m:${san}}`),
  sq: (square: string) => `{sq:${square}}`,
  pc: (p: { role: Role; square: string }) => `{pc:${ROLE_LETTER[p.role]}${p.square}}`,
};

const whose = (color: Color, you: Color) => (color === you ? 'your' : 'their');
const Whose = (color: Color, you: Color) => (color === you ? 'Your' : 'Their');
const pieceText = (p: PieceRef, you: Color) => `${whose(p.color, you)} ${p.role} ${tok.pc(p)}`;
const PieceText = (p: PieceRef, you: Color) => `${Whose(p.color, you)} ${p.role} ${tok.pc(p)}`;
const listText = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Engine UCI moves → SAN, from a FEN. Stops at the first move that does not fit. */
export function pvToSan(fen: string, pv: string[], max = 99): { sans: string[]; fens: string[] } {
  const pos = parsePosition(fen);
  const sans: string[] = [];
  const fens: string[] = [];
  if (!pos) return { sans, fens };
  for (const uci of pv.slice(0, max)) {
    const move = uciToMove(pos, uci);
    if (!move) break;
    const info = describeMove(pos, move);
    sans.push(info.san);
    pos.play(move);
    fens.push(info.fenAfter);
  }
  return { sans, fens };
}

/**
 * Follow an engine line "until the captures stop": keep going while the next move is a capture or a
 * promotion, gives check, or answers a check. Returns the SAN moves played and the quiet position reached.
 */
export function settle(fen: string, pv: string[], minPlies = 1, maxPlies = 10): { sans: string[]; fen: string; plies: number } {
  const pos = mustPosition(fen);
  const sans: string[] = [];
  let plies = 0;
  for (const uci of pv) {
    if (plies >= maxPlies) break;
    const move = uciToMove(pos, uci);
    if (!move) break;
    const info = describeMove(pos, move);
    const forcing = !!info.captured || !!info.promotion || info.check || pos.isCheck();
    if (plies >= minPlies && !forcing) break;
    sans.push(info.san);
    pos.play(move);
    plies++;
  }
  return { sans, fen: fenOf(pos), plies };
}

/** Pieces pinned to their own king (absolute pins), for both sides. */
export function absolutePins(pos: Chess): { pinned: PieceRef; by: PieceRef }[] {
  const out: { pinned: PieceRef; by: PieceRef }[] = [];
  for (const color of ['white', 'black'] as const) {
    const king = pos.board.kingOf(color);
    if (king === undefined) continue;
    for (const [sq, p] of pos.board) {
      if (p.color === color) continue;
      if (p.role !== 'queen' && p.role !== 'rook' && p.role !== 'bishop') continue;
      if (!isAligned(king, sq)) continue;
      const straight = (sq & 7) === (king & 7) || sq >> 3 === king >> 3;
      if (p.role === 'rook' && !straight) continue;
      if (p.role === 'bishop' && straight) continue;
      const blockers = between(king, sq).intersect(pos.board.occupied);
      const only = blockers.singleSquare();
      if (only === undefined) continue;
      const blocker = pos.board.get(only);
      if (!blocker || blocker.color !== color || blocker.role === 'king') continue;
      out.push({
        pinned: { square: makeSquare(only), role: blocker.role, color },
        by: { square: makeSquare(sq), role: p.role, color: p.color },
      });
    }
  }
  return out;
}

/**
 * Relative pins: a piece that shields a more valuable piece of its own from an enemy bishop, rook
 * or queen. It may legally move, but then the piece behind it can be taken.
 */
export function relativePins(pos: Chess): { pinned: PieceRef; by: PieceRef; behind: PieceRef }[] {
  const out: { pinned: PieceRef; by: PieceRef; behind: PieceRef }[] = [];
  for (const [from, slider] of pos.board) {
    if (slider.role !== 'queen' && slider.role !== 'rook' && slider.role !== 'bishop') continue;
    for (const [target, behind] of pos.board) {
      if (behind.color === slider.color || behind.role === 'king' || !isAligned(from, target)) continue;
      const straight = (from & 7) === (target & 7) || from >> 3 === target >> 3;
      if (slider.role === 'rook' && !straight) continue;
      if (slider.role === 'bishop' && straight) continue;
      const only = between(from, target).intersect(pos.board.occupied).singleSquare();
      if (only === undefined) continue;
      const shield = pos.board.get(only);
      if (!shield || shield.color !== behind.color || shield.role === 'king') continue;
      // worth it for the attacker: the piece behind is worth more than the shield, and more than
      // the attacker itself or it has no defender
      const undefended = attackersOf(pos, target, behind.color).length === 0;
      if (ROLE_VALUE[behind.role] > ROLE_VALUE[shield.role] && (ROLE_VALUE[behind.role] > ROLE_VALUE[slider.role] || undefended)) {
        out.push({
          pinned: { square: makeSquare(only), role: shield.role, color: shield.color },
          by: { square: makeSquare(from), role: slider.role, color: slider.color },
          behind: { square: makeSquare(target), role: behind.role, color: behind.color },
        });
      }
    }
  }
  return out;
}

function isAligned(a: number, b: number): boolean {
  const df = Math.abs((a & 7) - (b & 7));
  const dr = Math.abs((a >> 3) - (b >> 3));
  return a !== b && (df === 0 || dr === 0 || df === dr);
}

/**
 * Is this move a fork? After it, the piece that moved must attack two or more targets (the king,
 * a piece worth more than itself, or an undefended piece) and must not be simply lost itself.
 */
export function forkOf(fenBefore: string, san: string): { piece: PieceRef; targets: PieceRef[] } | null {
  const pos = parsePosition(fenBefore);
  const move = pos ? anyToMove(pos, san) : null;
  if (!pos || !move) return null;
  const info = describeMove(pos, move);
  const after = parsePosition(info.fenAfter);
  const to = parseSquare(info.to);
  if (!after || to === undefined) return null;
  const mover = after.board.get(to);
  if (!mover) return null;
  if (capturables(after).some((c) => c.piece.square === info.to && c.net > 0)) return null;
  const targets = attackedBy(after, to).filter(
    (t) => t.role === 'king' || ROLE_VALUE[t.role] > ROLE_VALUE[mover.role] || attackersOf(after, parseSquare(t.square)!, t.color).length === 0,
  );
  return targets.length >= 2 ? { piece: { square: info.to, role: mover.role, color: mover.color }, targets } : null;
}

// ---------------------------------------------------------------- what a move does (checked reasons)

export type ReasonTag = 'mate' | 'check' | 'answers_check' | 'captures' | 'promotes' | 'castles' | 'saves' | 'defends' | 'guards' | 'stops_threat' | 'attacks' | 'develops' | 'centre';
export type Reason = { tag: ReasonTag; text: string };

/**
 * What a move does, worked out from the board alone: the only reasons the coach may give for it.
 * `threatMove` is what the other side would play with a free move in the position before (SAN there).
 */
export function moveReasons(fenBefore: string, san: string, owner: Color, threatMove?: string): Reason[] {
  const pos = parsePosition(fenBefore);
  const move = pos ? anyToMove(pos, san) : null;
  if (!pos || !move) return [];
  const info = describeMove(pos, move);
  const mover = pos.turn;
  const my = mover === owner ? 'your' : 'their';
  const opp = mover === owner ? 'their' : 'your';
  const after = mustPosition(info.fenAfter);
  const out: Reason[] = [];
  if (info.mate) return [{ tag: 'mate', text: 'it is checkmate' }];
  if (pos.isCheck()) out.push({ tag: 'answers_check', text: mover === owner ? 'it gets you out of check' : 'it gets them out of check' });
  if (info.check) out.push({ tag: 'check', text: 'it gives check' });
  // en passant takes the pawn beside the square the capturing pawn lands on
  if (info.captured) out.push({ tag: 'captures', text: `it takes ${opp} ${info.captured} on ${tok.sq(info.enPassant ? `${info.to[0]}${info.from[1]}` : info.to)}` });
  if (info.promotion) out.push({ tag: 'promotes', text: `it promotes the pawn to a ${info.promotion}` });
  if (info.castle) out.push({ tag: 'castles', text: `it castles: ${my} king gets safer and the rook comes into play` });

  // the mover's pieces that could be taken for free: before the move, and after it
  const passBefore = passPosition(fenBefore);
  const lostBefore = passBefore ? capturables(mustPosition(passBefore)).filter((c) => c.net > 0) : [];
  const lostAfter = new Set(capturables(after).filter((c) => c.net > 0).map((c) => c.piece.square));
  for (const c of lostBefore) {
    if (c.piece.square === info.from) {
      if (!lostAfter.has(info.to)) out.push({ tag: 'saves', text: `it moves ${my} attacked ${c.piece.role} out of danger` });
    } else if (!lostAfter.has(c.piece.square) && after.board.get(parseSquare(c.piece.square)!)?.color === mover) {
      out.push({ tag: 'defends', text: `it protects ${my} ${c.piece.role} on ${tok.sq(c.piece.square)}` });
    }
  }

  // own pieces the moved piece now guards from its new square
  const toSq = parseSquare(info.to)!;
  const guarded: PieceRef[] = [];
  for (const [sq, piece] of after.board) {
    if (piece.color !== mover || sq === toSq || piece.role === 'king') continue;
    if (attacksSquare(after, toSq, sq)) guarded.push({ square: makeSquare(sq), role: piece.role, color: piece.color });
  }
  if (guarded.length && !out.some((r) => r.tag === 'defends')) {
    const underFire = guarded.find((g) => attackersOf(after, parseSquare(g.square)!, opposite(mover)).length > 0);
    out.push({ tag: 'guards', text: underFire ? `it adds a defender to ${my} ${underFire.role} on ${tok.sq(underFire.square)}` : '' });
  }

  // the other side's threat: does it still work after this move?
  if (threatMove) {
    const t = anyToMove(after, threatMove);
    let stopped = false;
    if (!t) stopped = true;
    else {
      const ti = describeMove(after, t);
      if (/#/.test(threatMove)) stopped = !ti.mate;
      // the threat was a capture: it is dealt with when there is nothing left to take there, or taking no longer wins
      else if (/x/.test(threatMove)) stopped = !ti.captured || !('from' in t) || captureGain(after, t as NormalMove) <= 0;
    }
    if (stopped) out.push({ tag: 'stops_threat', text: `it deals with ${opp} threat` });
  }

  // a new attack: something of theirs that can now be won and could not before
  const passAfter = lostAfter.has(info.to) ? null : passPosition(info.fenAfter);
  if (passAfter) {
    const winnableBefore = new Set(capturables(pos).filter((c) => c.net > 0).map((c) => c.piece.square));
    const target = capturables(mustPosition(passAfter)).find((c) => c.net > 0 && !winnableBefore.has(c.piece.square));
    if (target) out.push({ tag: 'attacks', text: `it attacks ${opp} ${target.piece.role} on ${tok.sq(target.piece.square)}` });
  }

  // opening principles
  const home = mover === 'white' ? ['b1', 'g1', 'c1', 'f1'] : ['b8', 'g8', 'c8', 'f8'];
  if ((info.role === 'knight' || info.role === 'bishop') && home.includes(info.from) && pos.fullmoves <= 15 && !lostAfter.has(info.to)) {
    out.push({ tag: 'develops', text: `it develops ${my} ${info.role}` });
  }
  if (info.role === 'pawn' && ['e4', 'd4', 'e5', 'd5'].includes(info.to) && pos.fullmoves <= 10 && !info.captured) {
    out.push({ tag: 'centre', text: 'it puts a pawn in the centre' });
  }
  return out;
}

/** " Why: it …; it …." (or, for a mistake, what the move does manage to do). */
function reasonsText(reasons: Reason[], bad: boolean): string {
  const useful = (bad ? reasons.filter((r) => r.tag !== 'develops' && r.tag !== 'centre') : reasons).filter((r) => r.text);
  if (!useful.length) return '';
  return ` ${bad ? 'What it does manage' : 'Why'}: ${useful.map((r) => r.text).join('; ')}.`;
}

// ---------------------------------------------------------------- grading one move

export type GradeInput = {
  fenBefore: string;
  san: string;
  /** MultiPV for fenBefore */
  evalBefore: EngineEval;
  /** the engine line starting with the move, from fenBefore (same search budget) */
  playedLine: EngineLine;
  you: Color; // the mover
  thresholds?: Thresholds;
};

export type GradeResult = {
  /** how bad the move is: the worse of what the drop in winning chances says and what the move concretely gives away */
  cls: MoveClass;
  /** what the drop in winning chances alone says (Lichess's grading) */
  byChances: MoveClass;
  /**
   * Why the class is worse than the winning chances say: the move gives material away, or walks
   * into a forced mate, in a game that was already decided, where winning chances hardly move.
   */
  floor?: 'material' | 'mate';
  /** the game was already decided when the move was played: lost for the mover, or still won after it */
  decided?: 'lost' | 'won';
  /** points of material the move ends up losing compared with the best move, when the engine's score agrees it is lost */
  givenAway: number;
  /** a bigger chance the move passed over while giving nothing away ("you miss the chance to win a knight") */
  missed?: string;
  drop: number;
  live: boolean;
  isBest: boolean;
  best: string;
  bestOutcome: string;
  playedOutcome: string;
  lost?: string;
  line: string[];
  bestLine: string[];
  playedDelta: number;
  bestDelta: number;
  mateAllowed?: number;
  mateFound?: number;
  bestScore: Score;
  playedScore: Score;
};

function outcomeWords(fenBefore: string, line: EngineLine, mover: Color): { sans: string[]; text: string; delta: number; mate?: number } {
  if (line.score.mate !== undefined) {
    const all = pvToSan(fenBefore, line.pv);
    const n = Math.abs(line.score.mate);
    return {
      sans: all.sans,
      text: line.score.mate > 0 ? `it forces checkmate in ${n}` : `it allows checkmate in ${n}`,
      delta: line.score.mate > 0 ? 99 : -99,
      mate: line.score.mate,
    };
  }
  // follow the captures and checks to their end: a count taken in the middle of an exchange is wrong
  let s = settle(fenBefore, line.pv, 1, 24);
  let change = materialChangeInWords(fenBefore, s.fen, mover);
  if (change && change.delta === 0 && line.pv.length > s.plies) {
    // nothing concrete yet: look further down the engine's line before saying "nothing changes"
    const deeper = settle(fenBefore, line.pv, Math.min(line.pv.length, 6), 12);
    const deeperChange = materialChangeInWords(fenBefore, deeper.fen, mover);
    if (deeperChange && Math.abs(deeperChange.delta) >= 2) {
      s = deeper;
      change = deeperChange;
    }
  }
  return { sans: s.sans, text: change?.text ?? 'no material changes hands', delta: change?.delta ?? 0 };
}

/**
 * The exact result of an endgame, for the side to move, when the engine read it from its
 * tablebases: five pieces or fewer on the board and at least one tablebase hit in the search. A
 * tablebase win shows as a mate or as a score no ordinary position reaches; a draw as zero.
 */
export function tablebaseResult(fen: string, ev: EngineEval): 'win' | 'draw' | 'loss' | null {
  const pos = parsePosition(fen);
  const best = ev.lines[0];
  if (!pos || !best || !ev.tbhits || pos.board.occupied.size() > 5) return null;
  if (best.score.mate !== undefined) return best.score.mate > 0 ? 'win' : 'loss';
  const cp = best.score.cp ?? 0;
  if (cp >= 15_000) return 'win';
  if (cp <= -15_000) return 'loss';
  return Math.abs(cp) <= 5 ? 'draw' : null;
}

/**
 * Does the reply to a move simply take one of the mover's pieces? Returns what that costs by the
 * exchange on that square (a free bishop: 3; a queen taken by a bishop and retaken: 6), or 0.
 * `pv` starts with the move itself.
 */
function hungToReply(fenBefore: string, pv: string[]): number {
  const pos = parsePosition(fenBefore);
  const move = pos && pv[0] ? uciToMove(pos, pv[0]) : null;
  if (!pos || !move) return 0;
  pos.play(move);
  const reply = pv[1] ? uciToMove(pos, pv[1]) : null;
  if (!reply) return 0;
  const info = describeMove(pos, reply);
  if (!info.captured) return 0;
  const hit = capturables(pos).find((c) => c.piece.square === info.to);
  return hit && hit.net > 0 ? hit.net : 0;
}

/** Grade one move against the engine's best, in winning chances and plain words. */
export function gradeMove(input: GradeInput): GradeResult | null {
  const { fenBefore, san, evalBefore, playedLine, you } = input;
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const bestLine = evalBefore.lines[0];
  if (!bestLine || !bestLine.pv.length || !playedLine.pv.length) return null;
  const bestSans = pvToSan(fenBefore, bestLine.pv, 1).sans;
  const best = bestSans[0];
  if (!best) return null;
  const isBest = bestLine.pv[0] === playedLine.pv[0];
  const playedScore = isBest ? bestLine.score : playedLine.score;
  const drop = isBest ? 0 : dropOf(bestLine.score, playedScore);
  const byChances = classifyDrop(drop, t);
  const bestOut = outcomeWords(fenBefore, bestLine, you);
  const playedOut = isBest ? bestOut : outcomeWords(fenBefore, playedLine, you);

  // ---- what the move concretely costs, whatever the winning chances say
  // Winning chances stop moving once a game is decided: at 7% a queen given away costs four points
  // and would pass as "good". So a move is also judged by its consequence. Both signals must agree
  // that something is really lost: the engine's line shows the material going (or the mate), and
  // its score is at least a pawn worse than after the best move. A sound sacrifice shows the
  // first and not the second, so it is left alone.
  const cpOf = (s: Score) => (s.mate !== undefined ? (s.mate > 0 ? 100_000 : -100_000) : (s.cp ?? 0));
  const worseBy = isBest ? 0 : cpOf(bestLine.score) - cpOf(playedScore);
  const noMates = bestOut.mate === undefined && playedOut.mate === undefined;
  const decided: GradeResult['decided'] = winChance(bestLine.score) <= 10 ? 'lost' : winChance(playedScore) >= 90 ? 'won' : undefined;
  // In a hopeless position the engine's score stops counting pieces as well (it is all "lost"),
  // so there the board itself is the second signal: the reply simply takes a piece that the
  // exchange on its square says is lost.
  const takenAtOnce = !isBest && decided === 'lost' ? hungToReply(fenBefore, playedLine.pv) : 0;
  const moreThanBest = !isBest && noMates && playedOut.delta < 0 ? Math.max(0, bestOut.delta - playedOut.delta) : 0;
  // a pawn worse by the engine's score; half a pawn when the mover was already lost, where the
  // score moves less for each piece (found by the audit: a knight given up at -6.4 read as -7.4)
  const confirmedBy = decided === 'lost' ? 50 : 100;
  const givenAway = worseBy >= confirmedBy ? moreThanBest : Math.min(moreThanBest, takenAtOnce);
  const mateWalkedInto = !isBest && playedOut.mate !== undefined && playedOut.mate < 0 && !(bestOut.mate !== undefined && bestOut.mate < 0) ? -playedOut.mate : undefined;
  // a piece or more is a blunder, the exchange or two pawns a mistake, a pawn an inaccuracy; one
  // step milder when the game was already decided, as a human annotator would mark it
  const STEPS: MoveClass[] = ['ok', 'inaccuracy', 'mistake', 'blunder'];
  let floorClass: MoveClass = 'ok';
  let floor: GradeResult['floor'];
  if (mateWalkedInto !== undefined) {
    // walking into a mate that could be avoided: a blunder; a mistake only when the game was lost and the mate is not immediate
    floorClass = decided === 'lost' && mateWalkedInto > 2 ? 'mistake' : 'blunder';
    floor = 'mate';
  } else if (givenAway >= 1) {
    const size = givenAway >= 3 ? 3 : givenAway >= 2 ? 2 : 1;
    floorClass = STEPS[Math.max(0, size - (decided ? 1 : 0))]!;
    floor = 'material';
  }
  const cls = STEPS.indexOf(floorClass) > STEPS.indexOf(byChances) ? floorClass : byChances;
  if (cls === byChances) floor = undefined;

  // ---- a chance passed over: nothing given away, but a mate or a piece was there to be had
  let missed: string | undefined;
  if (!isBest && playedOut.delta >= 0 && !(playedOut.mate !== undefined && playedOut.mate > 0)) {
    if (bestOut.mate !== undefined && bestOut.mate > 0) missed = `you miss a forced checkmate in ${bestOut.mate}`;
    else if (noMates && bestOut.delta - playedOut.delta >= 3 && worseBy >= 100) missed = `you miss the chance to ${bestOut.text.replace(/^you /, '')}`;
  }

  let lost: string | undefined;
  if (cls !== 'ok') {
    if (playedOut.mate !== undefined && playedOut.mate < 0) lost = `it allows checkmate in ${-playedOut.mate}`;
    else if (playedOut.delta < 0) lost = playedOut.text;
    else if (cls === 'inaccuracy') lost = missed;
    else if (bestOut.mate !== undefined && bestOut.mate > 0) lost = `you miss a forced checkmate in ${bestOut.mate}`;
    else if (bestOut.delta > playedOut.delta) lost = missed ?? 'you miss a much stronger move';
    else lost = 'it gives up your advantage';
  }
  return {
    cls,
    byChances,
    floor,
    decided,
    givenAway,
    missed,
    drop,
    live: isLiveMove(bestLine.score, playedScore),
    isBest,
    best,
    bestOutcome: bestOut.text,
    playedOutcome: playedOut.text,
    lost,
    line: playedOut.sans.length ? playedOut.sans : [san],
    bestLine: bestOut.sans.length ? bestOut.sans : [best],
    playedDelta: playedOut.delta,
    bestDelta: bestOut.delta,
    mateAllowed: playedOut.mate !== undefined && playedOut.mate < 0 ? -playedOut.mate : undefined,
    mateFound: playedOut.mate !== undefined && playedOut.mate > 0 ? playedOut.mate : undefined,
    bestScore: bestLine.score,
    playedScore,
  };
}

/**
 * The facts for "what does this move do?" (the coach's check_move tool, and the owner's last move).
 * `ids` hands out fact ids. Returns the facts and a short verdict.
 */
export function moveFacts(
  input: GradeInput,
  nextId: () => string,
  opts: { past?: boolean; owner?: Color; threatMove?: string } = {},
): { grade: GradeResult; facts: Fact[]; mainId: string; bestId?: string } | null {
  const g = gradeMove(input);
  if (!g) return null;
  // gradeMove speaks in the mover's voice ("you win a pawn"); the owner may be the other side
  const forThem = opts.owner !== undefined && opts.owner !== input.you;
  const voice = (text: string) => (forThem ? toOtherVoice(text) : text);
  const facts: Fact[] = [];
  const mainId = nextId();
  const m = tok.m(input.san, mainId);
  const reply = g.line[1] ? ` after ${tok.m(g.line[1], mainId)}` : '';
  const was = opts.past ? 'was' : 'is';
  const byThem = forThem ? ' by them' : '';
  const forThemText = forThem ? ' for them' : '';
  let type: FactType;
  let text: string;
  if (g.mateFound !== undefined) {
    type = 'mate_in';
    text = g.mateFound === 1 && g.line.length === 1 ? `${m} ${was} checkmate.` : `${m} forces checkmate in ${g.mateFound}${forThem ? ' against you' : ''}.`;
  } else if (g.mateAllowed !== undefined && (g.bestScore.mate ?? 0) < 0) {
    // every move is mated here: this one is not the mistake, the game was lost before it
    type = 'unsafe';
    text = `${m} does not stop checkmate${forThemText}: nothing does here${g.line[1] ? `. ${tok.m(g.line[1], mainId)} comes next` : ''}.`;
  } else if (g.mateAllowed !== undefined) {
    type = 'unsafe';
    text = `${m} ${was} a serious mistake${byThem}: it allows checkmate in ${g.mateAllowed}${g.line[1] ? `, starting with ${tok.m(g.line[1], mainId)}` : ''}.`;
  } else if (g.cls === 'mistake' || g.cls === 'blunder') {
    type = g.playedDelta < 0 ? 'loses_material' : 'unsafe';
    const lost = voice(g.lost ?? 'it gives up your advantage');
    // the board's label says blunder or mistake; the coach's words say the same thing without the badge
    const how = g.cls === 'blunder' ? 'a serious mistake' : 'a mistake';
    text = g.playedDelta < 0 ? `${m} ${was} ${how}${byThem}: ${lost}${reply}.` : `${m} ${was} ${how}${byThem}: ${lost}.`;
    // in a decided game the bar hardly moves, which is no reason to call the move fine
    if (g.floor && g.decided === 'lost') text += ` ${forThem ? 'They were' : 'You were'} already losing before it, so the winning chances hardly change, but the material still goes.`;
    else if (g.floor && g.decided === 'won') text += ` ${forThem ? 'They are' : 'You are'} still winning after it, but it gives material away for nothing.`;
  } else if (g.playedDelta > 0) {
    type = 'wins_material';
    text = `${m} ${was} good${forThemText}: ${voice(g.playedOutcome)}${g.isBest ? ', and it is the strongest move' : ''}.`;
  } else if (g.isBest) {
    type = 'best_move';
    // the strongest move can still cost something: say so plainly instead of calling it safe
    text = g.playedDelta < 0 ? `${m} ${was} the strongest move here${forThemText}, even though ${voice(g.playedOutcome)}${reply}: the engine still rates it above the other moves.` : `${m} ${was} the strongest move here${forThemText}. It is safe: ${voice(g.playedOutcome)}.`;
  } else if (g.cls === 'inaccuracy') {
    if (g.playedDelta < 0) {
      type = 'loses_material';
      text = `${m} ${was} an inaccuracy${byThem}: ${voice(g.playedOutcome)}${reply}.`;
    } else if (g.missed) {
      type = 'unsafe';
      text = `${m} ${was} an inaccuracy${byThem}: ${voice(g.missed)}.`;
    } else {
      type = 'safe';
      text = `${m} ${was} playable and does not lose material, but there ${was} a stronger move.`;
    }
  } else if (g.givenAway > 0) {
    // a small give-away the grading lets through (a pawn, in a game already decided): still not "safe"
    type = 'loses_material';
    text = `${m} ${was} playable${forThemText}, but it gives something away: ${voice(g.playedOutcome)}${reply}.`;
  } else if (g.playedDelta < 0 && g.bestDelta <= g.playedDelta) {
    // the material goes whatever is played: not this move's doing, and not a "safe" move either
    type = 'loses_material';
    text = `${m} ${was} playable${forThemText}: ${forThem ? 'they lose' : 'you lose'} material whatever ${forThem ? 'they play' : 'you play'} here.`;
  } else if (g.playedDelta < 0) {
    // the engine's line gives material up, but its score is about what the best move gets, so
    // nothing is claimed as lost: the count along a line is not proof on its own
    type = 'safe';
    text = `${m} ${was} playable${forThemText}: the engine rates it about as well as its first choice.`;
  } else if (g.missed) {
    type = 'safe';
    text = `${m} loses nothing, but ${voice(g.missed)}.`;
  } else {
    type = 'safe';
    text = `${m} ${was} a good, safe move${forThemText}: ${voice(g.playedOutcome)}.`;
  }
  const reasons = moveReasons(input.fenBefore, input.san, opts.owner ?? input.you, opts.threatMove);
  // a move that costs material is never explained by its small merits ("Why: it adds a defender")
  const costs = !g.isBest && g.playedDelta < 0;
  const isBad = g.cls === 'mistake' || g.cls === 'blunder' || g.mateAllowed !== undefined || costs;
  text += reasonsText(reasons, isBad);
  facts.push({
    id: mainId,
    type,
    text,
    data: {
      reasons: reasons.map((r) => r.tag),
      baseFen: input.fenBefore, line: g.line, move: input.san, class: g.cls, mateIn: g.mateFound ?? (g.mateAllowed ? -g.mateAllowed : undefined), delta: g.playedDelta, isBest: g.isBest, side: input.you,
      // is this move good or bad news for the owner? (a mistake by the opponent is good news)
      verdictForYou: g.cls === 'mistake' || g.cls === 'blunder' || g.mateAllowed !== undefined ? (forThem ? 'good' : 'bad') : g.isBest || (g.cls === 'ok' && !costs && !g.missed) ? (forThem ? undefined : 'good') : undefined,
      givenAway: g.givenAway || undefined,
      decided: g.decided,
      missed: g.missed ? true : undefined,
      // the mate this move passed over, when the words say so ("you miss a forced checkmate in 2"):
      // a count the mate rule may match only for a sentence about missing it, never "it mates in 2"
      missedMate: Number(/miss a forced checkmate in (\d+)/.exec(text)?.[1]) || undefined,
    },
  });
  if (g.playedDelta > 0 || g.mateFound !== undefined) {
    const fork = forkOf(input.fenBefore, input.san);
    if (fork) {
      facts.push({
        id: nextId(),
        type: 'fork',
        text: `${m} is a fork: the ${fork.piece.role} attacks ${listText(fork.targets.map((x) => `the ${x.role} on ${tok.sq(x.square)}`))} at the same time.`,
        data: { baseFen: input.fenBefore, line: g.line, move: input.san, targets: fork.targets, piece: fork.piece, side: input.you, delta: g.playedDelta },
      });
    }
  }
  let bestId: string | undefined;
  if (!g.isBest && (g.cls === 'mistake' || g.cls === 'blunder' || g.cls === 'inaccuracy' || g.missed !== undefined)) {
    bestId = nextId();
    const bm = tok.m(g.best, bestId);
    const would = opts.past ? 'would have been' : 'is';
    const outcome = g.bestScore.mate !== undefined && g.bestScore.mate > 0 ? `it forces checkmate in ${g.bestScore.mate}` : voice(g.bestOutcome);
    const bestReasons = moveReasons(input.fenBefore, g.best, opts.owner ?? input.you, opts.threatMove);
    facts.push({
      id: bestId,
      type: g.bestScore.mate !== undefined && g.bestScore.mate > 0 ? 'mate_in' : 'best_move',
      text: `${forThem ? 'Their' : 'The'} strongest move ${would} ${bm}: ${outcome}.${reasonsText(bestReasons, false)}`,
      data: { baseFen: input.fenBefore, line: g.bestLine, move: g.best, mateIn: g.bestScore.mate, delta: g.bestDelta, side: input.you, reasons: bestReasons.map((r) => r.tag) },
    });
  }
  return { grade: g, facts, mainId, bestId };
}

/** The mover's voice ("you win a knight") turned into the owner's, when the owner is the other side. */
function toOtherVoice(text: string): string {
  return swapSides(text)
    .replace(/\byou miss\b/g, 'they miss')
    .replace(/\byour advantage\b/g, 'their advantage')
    .replace(/\byou come out well ahead\b/g, 'they come out well ahead')
    .replace(/\byou end up well behind\b/g, 'they end up well behind');
}

// ---------------------------------------------------------------- the packet

export function buildFactPacket(input: FactInput): FactPacket {
  const pos = mustPosition(input.fen);
  const fen = fenOf(pos);
  const you = input.you;
  const turn = pos.turn;
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  let n = 0;
  const nextId = () => `${input.id}.F${++n}`;
  const facts: Fact[] = [];
  const add = (type: FactType, text: string, data: Fact['data'] = {}): Fact => {
    const fact = { id: nextId(), type, text, data };
    facts.push(fact);
    return fact;
  };

  const mat = materialOf(pos);
  const material = { white: mat.white, black: mat.black, inWords: materialInWords(mat, you) };
  const yours: PieceRef[] = [];
  const theirs: PieceRef[] = [];
  for (const [sq, p] of pos.board) (p.color === you ? yours : theirs).push({ square: makeSquare(sq), role: p.role, color: p.color });
  const byValue = (a: PieceRef, b: PieceRef) => (ROLE_VALUE[b.role] || 99) - (ROLE_VALUE[a.role] || 99) || a.square.localeCompare(b.square);
  yours.sort(byValue);
  theirs.sort(byValue);

  const packet: FactPacket = {
    id: input.id,
    fen,
    turn,
    you,
    moveNumber: pos.fullmoves,
    inCheck: pos.isCheck(),
    material,
    lastMove: input.lastMove ? { san: input.lastMove.san, by: input.lastMove.by } : undefined,
    pieces: { yours, theirs },
    hanging: { mine: [], theirs: [] },
    cct: { mine: null, theirs: null },
    engine: { best: [] },
    opening: input.opening,
    facts,
  };

  // --- game over?
  if (pos.isCheckmate()) {
    packet.over = 'checkmate';
    add('game_over', turn === you ? 'You have been checkmated.' : 'It is checkmate: you won.', { result: 'checkmate', winner: opposite(turn) });
    return packet;
  }
  if (pos.isStalemate()) {
    packet.over = 'stalemate';
    add('game_over', 'It is stalemate: the side to move has no legal move and is not in check, so the game is a draw.', { result: 'stalemate' });
    return packet;
  }
  if (pos.isInsufficientMaterial()) {
    packet.over = 'draw';
    add('game_over', 'Neither side has enough material to checkmate: the game is a draw.', { result: 'draw' });
    return packet;
  }

  add('material', material.inWords, { white: mat.white, black: mat.black });
  // an endgame the tablebases know exactly: say the result with best play, in the owner's voice
  const exact = input.eval ? tablebaseResult(fen, input.eval) : null;
  if (exact) {
    packet.tablebase = exact === 'draw' ? 'draw' : (exact === 'win') === (turn === you) ? 'you win' : 'you lose';
    const words = packet.tablebase === 'draw' ? 'this position is a draw' : packet.tablebase === 'you win' ? 'you win this position' : 'you lose this position';
    add('tablebase', `With best play from both sides, ${words}. That is exact: the endgame tablebase knows the result of every position with five pieces or fewer.`, { result: packet.tablebase, baseFen: fen });
  }
  if (input.opening) add('opening', `This position is from the opening called ${input.opening.name}.`, { ...input.opening });

  // --- check
  if (pos.isCheck()) {
    const king = pos.board.kingOf(turn)!;
    const checkers = attackersOf(pos, king, opposite(turn));
    const who = checkers.map((c) => pieceText(c, you));
    add('check', `${turn === you ? 'You are' : 'They are'} in check from ${listText(who)}.`, { checkers, side: turn });
  }

  // --- what can be captured right now (side to move) and after a pass (the other side)
  const passFen = passPosition(fen);
  const passPos = passFen ? parsePosition(passFen) : null;
  const now = capturables(pos); // pieces of the side NOT to move
  const later = passPos ? capturables(passPos) : []; // pieces of the side to move, if it does nothing

  const attackFact = (c: Capturable, baseFen: string, isNow: boolean) => {
    const id = nextId();
    const attackers = listText(c.attackers.map((a) => pieceText(a, you)));
    const defended = c.defenders.length ? `it is defended by ${listText(c.defenders.map((d) => pieceText(d, you)))}` : 'it has no defender';
    const cap = isNow ? tok.m(c.bestCapture) : tok.m(c.bestCapture, id);
    const mine = c.piece.color === you;
    let text: string;
    let type: FactType = 'attack';
    if (c.net > 0) {
      type = 'hangs';
      const line = input.captureLines?.[c.bestCapture];
      let poisoned = false;
      if (isNow && turn === you && input.eval?.lines[0] && line) {
        poisoned = dropOf(input.eval.lines[0].score, line.score) >= t.mistake;
      }
      if (poisoned) {
        type = 'attack';
        text = `${PieceText(c.piece, you)} looks free to take with ${cap}, but taking it is a mistake here.`;
      } else if (!c.defenders.length) {
        const ifLeft = isNow ? '' : mine ? 'if you leave it there, ' : 'if they leave it there, ';
        text = mine
          ? `${PieceText(c.piece, you)} is hanging: ${ifLeft}${attackers} can take it with ${cap} and nothing takes back.`
          : `${PieceText(c.piece, you)} is hanging: ${ifLeft}you can take it with ${cap} and nothing takes back.`;
      } else {
        const ifLeft = isNow ? '' : mine ? ' if you leave it there' : ' if they leave it there';
        text = mine
          ? `${PieceText(c.piece, you)} is not defended well enough: ${cap} wins material for them in the trade on ${tok.sq(c.piece.square)}${ifLeft}.`
          : `${PieceText(c.piece, you)} is not defended well enough: ${cap} wins material for you in the trade on ${tok.sq(c.piece.square)}${ifLeft}.`;
      }
      if (type === 'hangs') (mine ? packet.hanging.mine : packet.hanging.theirs).push(c.piece);
    } else {
      text = `${PieceText(c.piece, you)} is attacked by ${attackers}; ${defended}, so taking it does not win material.`;
    }
    facts.push({
      id,
      type,
      text,
      data: { baseFen, line: [c.bestCapture], piece: c.piece, attackers: c.attackers, defenders: c.defenders, net: c.net, role: c.piece.role, side: mine ? 'mine' : 'theirs' },
    });
  };
  for (const c of now) attackFact(c, fen, true);
  for (const c of later) attackFact(c, passFen!, false);

  // --- pins
  for (const pin of absolutePins(pos)) {
    add('pin', `${PieceText(pin.pinned, you)} is pinned by ${pieceText(pin.by, you)}: it cannot move away without exposing the king.`, {
      pinned: pin.pinned,
      by: pin.by,
    });
  }

  for (const pin of relativePins(pos)) {
    add('pin', `${PieceText(pin.pinned, you)} is pinned to ${pieceText(pin.behind, you)} by ${pieceText(pin.by, you)}: it may move, but then ${pieceText(pin.by, you)} can take the ${pin.behind.role}. Whether moving it is still good is for the engine to say.`, {
      pinned: pin.pinned,
      by: pin.by,
      behind: pin.behind,
      absolute: false,
    });
  }

  // --- castling: can each side castle now, and if not yet, what is in the way
  for (const side of [you, opposite(you)] as const) {
    const who = side === you ? 'You' : 'They';
    const whose2 = side === you ? 'your' : 'their';
    for (const wing of ['h', 'a'] as const) {
      const rook = pos.castles.rook[side][wing];
      if (rook === undefined) continue; // the right is gone: nothing to say
      const king = pos.board.kingOf(side)!;
      const name = wing === 'h' ? 'kingside' : 'queenside';
      const san = wing === 'h' ? 'O-O' : 'O-O-O';
      const blockers: PieceRef[] = [];
      for (const sq of between(king, rook)) {
        const piece = pos.board.get(sq);
        if (piece) blockers.push({ square: makeSquare(sq), role: piece.role, color: piece.color });
      }
      const sideToMove = side === turn;
      const board = sideToMove ? pos : passPos;
      const legalNow = !!board && !!anyToMove(board, san);
      if (legalNow && sideToMove) add('castling', `${who} can castle ${name} right now with ${tok.m(san)}.`, { side, wing: name, can: true, move: san, baseFen: fen, line: [san] });
      else if (legalNow) add('castling', `${who} can castle ${name} on ${whose2} next move.`, { side, wing: name, can: true });
      else if (blockers.length) add('castling', `${who} cannot castle ${name} yet: ${listText(blockers.map((b) => pieceText(b, you)))} ${blockers.length > 1 ? 'are' : 'is'} in the way.`, { side, wing: name, can: false, blockers });
      else if (board && board.isCheck()) add('castling', `${who} cannot castle ${name} while in check.`, { side, wing: name, can: false });
      else add('castling', `${who} cannot castle ${name} right now: the king would cross or land on an attacked square.`, { side, wing: name, can: false });
    }
  }

  // --- checks, captures, threats
  const sideCct = cctOf(pos);
  const otherCct = passPos ? cctOf(passPos) : null;
  packet.cct = turn === you ? { mine: sideCct, theirs: otherCct } : { mine: otherCct, theirs: sideCct };
  const moverWord = turn === you ? 'You have' : 'They have';
  if (sideCct.mates.length) {
    add('mate_in', `${moverWord} checkmate in one move: ${listText(sideCct.mates.map((s) => tok.m(s)))}.`, { mateIn: 1, moves: sideCct.mates, side: turn });
  }

  // what the other side would do to the side to move with a free move (used for "it deals with the threat")
  const passOut = input.passEval?.lines[0] && passFen ? outcomeWords(passFen, input.passEval.lines[0], opposite(turn)) : null;
  const threatAgainstMover = passOut && ((passOut.mate !== undefined && passOut.mate > 0) || passOut.delta >= 1) ? passOut.sans[0] : undefined;

  // --- the engine's view of the focus position
  const ev = input.eval;
  if (ev && ev.lines.length) {
    const first = ev.lines[0]!;
    if (first.score.mate !== undefined) packet.engine.mate = first.score.mate;
    const bestWin = winChance(first.score);
    ev.lines.forEach((line, i) => {
      const sans = pvToSan(fen, line.pv, 4).sans;
      if (!sans.length) return;
      const out = outcomeWords(fen, line, turn);
      const youScore = turn === you ? line.score : flipScore(line.score);
      const outcomeForYou = turn === you ? out.text : swapSides(out.text);
      packet.engine.best.push({ san: sans[0]!, line: sans, verdict: balanceInWords(youScore), outcome: outcomeForYou, win: winChance(line.score), mate: line.score.mate });
      const close = bestWin - winChance(line.score) < t.inaccuracy;
      if (i > 0 && !close) return;
      const id = nextId();
      const mv = tok.m(sans[0]!);
      const who = turn === you ? 'you' : 'they';
      const Who = turn === you ? 'Your' : 'Their';
      let type: FactType = i === 0 ? 'best_move' : 'good_move';
      let text: string;
      if (line.score.mate === 1 && sideCct.mates.length) return; // already stated as "checkmate in one move"
      if (line.score.mate !== undefined && line.score.mate > 0) {
        type = 'mate_in';
        text = `${Who} strongest move is ${mv}: it forces checkmate in ${line.score.mate}.`;
      } else if (i === 0) {
        const reply = out.sans[1] ? ` (the line goes ${out.sans.slice(0, 4).map((s, k) => (k === 0 ? mv : tok.m(s, id))).join(' ')})` : '';
        text = `${Who} strongest move is ${mv}: ${outcomeForYou}${out.delta !== 0 ? reply : ''}. After it you are ${balanceInWords(youScore)}.`;
      } else {
        text = `${mv} is also a good move for ${who === 'you' ? 'you' : 'them'}: ${outcomeForYou}.`;
      }
      const reasons = moveReasons(fen, sans[0]!, you, threatAgainstMover);
      text += reasonsText(reasons, false);
      facts.push({ id, type, text, data: { baseFen: fen, line: out.sans.length ? out.sans : sans, move: sans[0], mateIn: line.score.mate, delta: out.delta, side: turn, rank: i + 1, reasons: reasons.map((r) => r.tag), verdictForYou: turn === you ? 'good' : undefined } });
      if (out.delta > 0 || (line.score.mate ?? 0) > 0) {
        const fork = forkOf(fen, sans[0]!);
        if (fork) {
          const whoseT = turn === you ? 'their' : 'your';
          add('fork', `${mv} is a fork: the ${fork.piece.role} attacks ${listText(fork.targets.map((x) => `${whoseT} ${x.role} ${tok.pc(x)}`))} at the same time.`, {
            baseFen: fen, line: out.sans.length ? out.sans : sans, move: sans[0], targets: fork.targets, piece: fork.piece, side: turn, delta: out.delta,
          });
        }
      }
    });
    // only move
    const second = ev.lines[1];
    if (second && dropOf(first.score, second.score) >= t.blunder && winChance(first.score) > 15) {
      const sans = pvToSan(fen, first.pv, 1).sans;
      if (sans[0]) add('only_move', `${tok.m(sans[0])} is the only good move here: every other move is much worse.`, { move: sans[0], side: turn });
    }
    // findable move: prefer a forcing move when it is as good as the best
    const candidates = ev.lines.filter((l) => bestWin - winChance(l.score) < 3);
    for (const line of candidates) {
      const move = line.pv[0] ? uciToMove(pos, line.pv[0]) : null;
      if (!move) continue;
      const info = describeMove(pos, move);
      if (info.captured || info.check) {
        packet.findable = { move: info.san, reason: 'forcing' };
        break;
      }
    }
    if (!packet.findable && packet.engine.best[0]) packet.findable = { move: packet.engine.best[0].san, reason: 'simple' };
  }

  // --- threats: what a side does with a free move ("if nothing is done about it")
  let theirThreat: boolean | undefined; // undefined = not known (no engine result)
  if (input.passEval?.lines[0] && passFen) {
    const line = input.passEval.lines[0];
    const mover = opposite(turn); // the side that gets the free move
    const out = outcomeWords(passFen, line, mover);
    const real = (out.mate !== undefined && out.mate > 0) || out.delta >= 1;
    if (mover !== you) theirThreat = real;
    if (real && out.sans[0]) {
      const id = nextId();
      const mv = tok.m(out.sans[0], id);
      let text: string;
      if (mover !== you) {
        text = out.mate !== undefined ? `Their threat: if you do nothing about it, they play ${mv} and it is checkmate in ${out.mate}.` : `Their threat: if you do nothing about it, they play ${mv} and ${swapSides(out.text)}.`;
        packet.threat = { move: out.sans[0], line: out.sans, text, factId: id, mateIn: out.mate, delta: out.delta };
      } else {
        text = out.mate !== undefined ? `Your threat: if they do nothing about it, you play ${mv} and it is checkmate in ${out.mate}.` : `Your threat: if they do nothing about it, you play ${mv} and ${out.text}.`;
      }
      facts.push({ id, type: 'threat', text, data: { baseFen: passFen, line: out.sans, move: out.sans[0], mateIn: out.mate, delta: out.delta, side: mover } });
    }
  }
  if (turn !== you && ev?.lines[0]) {
    // the opponent is to move: their best line is what they threaten to do right now
    const line = ev.lines[0];
    const out = outcomeWords(fen, line, turn);
    const real = (out.mate !== undefined && out.mate > 0) || out.delta >= 1;
    theirThreat = real;
    if (real && out.sans[0]) {
      const best = facts.find((f) => (f.type === 'best_move' || f.type === 'mate_in') && f.data.move === out.sans[0]);
      if (best) packet.threat = { move: out.sans[0], line: out.sans, text: best.text, factId: best.id, mateIn: out.mate, delta: out.delta };
    }
  }

  // --- "quiet" facts: the only backing for a statement that nothing is hanging or threatened
  if (theirThreat === false && packet.hanging.mine.length === 0) {
    add('quiet', 'None of your pieces can be taken for free right now, and they have no immediate threat.', { side: 'mine' });
  }
  if (packet.hanging.theirs.length === 0) {
    add('quiet', 'None of their pieces can be taken for free right now.', { side: 'theirs' });
  }

  // --- the owner's last move, graded
  if (input.lastMove?.by === 'owner' && input.prevEval && input.playedLine) {
    const res = moveFacts(
      { fenBefore: input.lastMove.fenBefore, san: input.lastMove.san, evalBefore: input.prevEval, playedLine: input.playedLine, you, thresholds: t },
      nextId,
      { past: true },
    );
    if (res) {
      for (const f of res.facts) {
        f.type = f.id === res.mainId ? 'graded' : f.type;
        f.text = f.id === res.mainId ? `Your last move ${f.text}` : f.text;
        facts.push(f);
      }
      const g = res.grade;
      packet.graded = { san: input.lastMove.san, cls: g.cls, drop: g.drop, live: g.live, isBest: g.isBest, best: g.best, lost: g.lost, line: g.line, bestLine: g.bestLine, factId: res.mainId, bestFactId: res.bestId };
      packet.lastVerdict = { san: input.lastMove.san, by: 'owner', cls: g.cls, factId: res.mainId, bestFactId: res.bestId };
      if (g.cls === 'mistake' || g.cls === 'blunder') packet.skippedStep = skippedStepOf(input, g);
    }
  }

  // --- the other side's last move, judged the same way and written in the owner's voice
  if (input.lastMove?.by === 'opponent' && input.prevEval && input.playedLine) {
    const res = moveFacts(
      { fenBefore: input.lastMove.fenBefore, san: input.lastMove.san, evalBefore: input.prevEval, playedLine: input.playedLine, you: opposite(you), thresholds: t },
      nextId,
      { past: true, owner: you },
    );
    if (res) {
      for (const f of res.facts) {
        if (f.id === res.mainId) f.text = `Their last move ${f.text}`;
        facts.push(f);
      }
      packet.lastVerdict = { san: input.lastMove.san, by: 'opponent', cls: res.grade.cls, factId: res.mainId, bestFactId: res.bestId };
    }
  }

  return packet;
}

/** Turn an outcome written for the mover ("you win a knight") into the other side's view ("they win a knight" → for the owner: "you lose…"). */
function swapSides(text: string): string {
  return text
    .replace(/\byou win\b/g, '#THEYWIN#')
    .replace(/\byou lose\b/g, 'you win')
    .replace(/#THEYWIN#/g, 'you lose')
    .replace(/\byou get\b/g, 'they get')
    .replace(/^it forces checkmate/, 'they force checkmate')
    .replace(/^it allows checkmate/, 'they allow checkmate');
}

/** Which step of the thinking routine the mistake skipped (LEARNING §4): the same tagger the game review uses (tags.ts). */
function skippedStepOf(input: FactInput, g: GradeResult): SkippedStep {
  if (!input.lastMove) return 'unknown';
  return boardStepOf({ fenBefore: input.lastMove.fenBefore, san: input.lastMove.san, grade: g });
}

// ---------------------------------------------------------------- what the coach sees

/** The packet as the coach receives it: words and ids, no engine numbers. */
export function packetForCoach(p: FactPacket): Record<string, unknown> {
  const pcs = (xs: PieceRef[]) => xs.map((x) => `${ROLE_LETTER[x.role]}${x.square}`).join(' ');
  return {
    id: p.id,
    fen: p.fen,
    toMove: p.turn === p.you ? 'you' : 'them',
    youAre: p.you,
    moveNumber: p.moveNumber,
    lastMove: p.lastMove ? `${p.lastMove.san} (${p.lastMove.by === 'owner' ? 'your move' : p.lastMove.by === 'opponent' ? 'their move' : 'shown by the coach'})` : undefined,
    over: p.over,
    yourPieces: pcs(p.pieces.yours),
    theirPieces: pcs(p.pieces.theirs),
    yourChecksCapturesThreats: p.cct.mine ? { checks: p.cct.mine.checks, captures: p.cct.mine.captures, threats: p.cct.mine.threats } : undefined,
    theirChecksCapturesThreats: p.cct.theirs ? { checks: p.cct.theirs.checks, captures: p.cct.theirs.captures, threats: p.cct.theirs.threats } : undefined,
    withBestPlay: p.tablebase,
    lastMoveVerdict: p.lastVerdict ? { fact: p.lastVerdict.factId, strongerMoveFact: p.lastVerdict.bestFactId } : undefined,
    skippedStep: p.skippedStep,
    findable: p.findable?.move,
    facts: p.facts.map((f) => ({ id: f.id, type: f.type, text: f.text })),
  };
}
