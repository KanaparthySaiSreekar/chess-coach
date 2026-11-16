// Spike S2: 40 hand-written coach messages about the eight positions in positions.ts.
// 20 are true; 20 carry one planted error (a false move, a false piece, or a false claim).
// Fact ids refer to packets.json (built by dump.ts with node-limited, repeatable searches).

import type { SayKind } from '@chess-coach/core';

export type S2Message = { pos: string; truth: boolean; kind: SayKind; text: string; claims: string[]; planted?: string };

export const MESSAGES: S2Message[] = [
  // ---- scholar (the owner is Black, to move; White threatens Qxf7#)
  { pos: 'scholar', truth: true, kind: 'question', text: 'What is their queen on {sq:h5} aiming at?', claims: [] },
  { pos: 'scholar', truth: true, kind: 'answer', text: 'They threaten {m:Qxf7#@P1.F8}, which is checkmate, so you have to stop it right now.', claims: ['P1.F8'] },
  { pos: 'scholar', truth: true, kind: 'answer', text: "{m:g6} is your strongest move: it blocks the queen's path to {sq:f7}.", claims: ['P1.F6'] },
  { pos: 'scholar', truth: false, kind: 'answer', text: 'Just take the queen with {m:Nxh5}.', claims: [], planted: 'illegal move: no knight can capture on h5' },
  { pos: 'scholar', truth: false, kind: 'answer', text: 'Their queen on {sq:h5} is hanging, so take it.', claims: ['P1.F2'], planted: 'false claim: the queen is not hanging; the cited fact is about the f7 pawn' },

  // ---- legal (the owner is White, to move; Nxe5 wins material)
  { pos: 'legal', truth: true, kind: 'answer', text: '{m:Nxe5} is the strongest move: after {m:dxe5@P2.F5} you play {m:Qxg4@P2.F5} and win a pawn.', claims: ['P2.F5'] },
  { pos: 'legal', truth: true, kind: 'idea', text: 'A simple plan is to castle with {m:O-O} and then bring your rooks to the middle.', claims: [] },
  { pos: 'legal', truth: false, kind: 'explain', text: 'Their bishop on {sq:g4} has pinned your knight to your king.', claims: ['P2.F4'], planted: 'false claim: the knight is not pinned to the king; the cited fact is a plain attack' },
  { pos: 'legal', truth: false, kind: 'nudge', text: 'Their knight on {sq:g4} is attacking your queen.', claims: [], planted: 'false piece: g4 holds a bishop' },
  { pos: 'legal', truth: false, kind: 'answer', text: '{m:Bxf7+} wins a pawn for free.', claims: ['P2.F3'], planted: 'false claim: the cited fact says taking f7 does not win material' },

  // ---- queenfork (the owner is White, to move; the queen attacks the knight on e5 and the pawn on e4)
  { pos: 'queenfork', truth: true, kind: 'question', text: 'Which two things is their queen on {sq:d4} attacking at the same time?', claims: [] },
  { pos: 'queenfork', truth: true, kind: 'explain', text: 'Your knight on {sq:e5} is hanging: nothing defends it, and their queen can take it with {m:Qxe5@P3.F4}.', claims: ['P3.F4'] },
  { pos: 'queenfork', truth: true, kind: 'answer', text: '{m:Ng4} saves the knight, and it is your strongest move even though you lose a pawn after {m:Qxe4+@P3.F9}.', claims: ['P3.F9'] },
  { pos: 'queenfork', truth: false, kind: 'praise', text: "Don't worry, your knight on {sq:e5} is perfectly safe.", claims: ['P3.F2'], planted: 'false claim: the knight is hanging; the cited fact is about the c6 pawn' },
  { pos: 'queenfork', truth: false, kind: 'answer', text: 'Take their queen with {m:Nxd4}.', claims: [], planted: 'illegal move: no knight attacks d4' },

  // ---- pin (the owner is Black; White to move; the c6 knight is pinned)
  { pos: 'pin', truth: true, kind: 'explain', text: 'Your knight on {sq:c6} is pinned by their bishop on {sq:b5}: it cannot move without exposing your king.', claims: ['P4.F5'] },
  { pos: 'pin', truth: true, kind: 'praise', text: 'Good: {m:d6@P4.F9} was a safe move that also protects your pawn on {sq:e5}.', claims: ['P4.F9'] },
  { pos: 'pin', truth: false, kind: 'explain', text: '{m:Nc3} wins a pawn for them.', claims: ['P4.F6'], planted: 'false claim: the cited fact says no material changes hands' },
  { pos: 'pin', truth: false, kind: 'explain', text: 'Careful: they have mate in two with {m:Bxc6+}.', claims: ['P4.F6'], planted: 'false claim: there is no mate' },
  { pos: 'pin', truth: false, kind: 'praise', text: 'Your bishop on {sq:b5} is doing a great job.', claims: [], planted: "false piece: the b5 bishop is the opponent's" },

  // ---- italian (the owner is White, to move; a quiet position)
  { pos: 'italian', truth: true, kind: 'explain', text: 'This position is the Italian Game: both sides have developed a knight and a bishop.', claims: ['P5.F2'] },
  { pos: 'italian', truth: true, kind: 'answer', text: '{m:d3} is the strongest move here, and {m:O-O} is good too.', claims: ['P5.F6', 'P5.F7'] },
  { pos: 'italian', truth: false, kind: 'explain', text: 'Your {pc:Bc4} attacks their pawn {pc:Pe5}.', claims: [], planted: 'false relation: the bishop on c4 does not attack e5' },
  { pos: 'italian', truth: false, kind: 'explain', text: 'After {m:d3} the evaluation is +0.3 for you.', claims: ['P5.F6'], planted: 'engine number' },
  { pos: 'italian', truth: false, kind: 'answer', text: "Play Bxf7+ and you win the king's pawn for free.", claims: [], planted: 'loose notation and an unbacked claim (Bxf7+ loses a bishop for a pawn)' },

  // ---- hung (the owner is White and has just played Ne6, losing the knight; Black to move)
  { pos: 'hung', truth: true, kind: 'question', text: 'After your move, what captures does your opponent have?', claims: [] },
  { pos: 'hung', truth: true, kind: 'explain', text: 'Your last move {m:Ne6@P6.F11} was a mistake: you lose a knight after {m:fxe6}.', claims: ['P6.F11'] },
  { pos: 'hung', truth: true, kind: 'explain', text: 'A calmer choice was {m:Bb5+@P6.F12}, which would have kept the material level.', claims: ['P6.F12'] },
  { pos: 'hung', truth: false, kind: 'praise', text: 'Great move: {m:Ne6@P6.F11} wins their queen.', claims: ['P6.F11'], planted: 'false claim: the move loses a knight' },
  { pos: 'hung', truth: false, kind: 'nudge', text: 'Their rook on {sq:d8} is now under attack from your knight.', claims: [], planted: 'false piece: d8 holds the queen' },

  // ---- backrank (the owner is White, to move; Rd8 is mate)
  { pos: 'backrank', truth: true, kind: 'question', text: 'Their king is stuck behind its own pawns: can any of your pieces reach the last row with check?', claims: [] },
  { pos: 'backrank', truth: true, kind: 'answer', text: '{m:Rd8#} is checkmate: their king has no escape squares.', claims: ['P7.F2'] },
  { pos: 'backrank', truth: false, kind: 'explain', text: 'You are up a queen, so this is easy.', claims: ['P7.F1'], planted: 'false claim: the owner is up a rook, not a queen' },
  { pos: 'backrank', truth: false, kind: 'answer', text: 'You have a forced mate in three starting with {m:Rd7}.', claims: ['P7.F2'], planted: 'false claim: it is mate in one, with a different move' },
  { pos: 'backrank', truth: false, kind: 'answer', text: 'Your queen {pc:Qd1} delivers the mate.', claims: ['P7.F2'], planted: 'false piece: d1 holds a rook' },

  // ---- knightfork (the owner is White, to move; Nc7+ forks king and rook)
  { pos: 'knightfork', truth: true, kind: 'answer', text: '{m:Nc7+} is a fork: your knight attacks their king and their rook on {sq:a8} at once.', claims: ['P8.F4'] },
  { pos: 'knightfork', truth: true, kind: 'explain', text: 'After {m:Nc7+} {m:Kf8@P8.F3} {m:Nxa8@P8.F3} you win a rook.', claims: ['P8.F3'] },
  { pos: 'knightfork', truth: true, kind: 'nudge', text: 'Look for a knight move that gives check.', claims: [] },
  { pos: 'knightfork', truth: false, kind: 'answer', text: '{m:Nd6+} is the best move because it wins the rook.', claims: ['P8.F3'], planted: 'false claim: the fact is about Nc7+, not Nd6+' },
  { pos: 'knightfork', truth: false, kind: 'nudge', text: 'Move your knight to c7, forking the king and the rook on h8.', claims: ['P8.F4'], planted: 'loose notation, and the rook is on a8' },
];
