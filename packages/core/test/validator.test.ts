import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { START_FEN, compileLadder, lineTitleProblems, playLine, splitSentences, validateSay, type ConceptLadderFile, type Fact, type FactPacket, type ValidatorContext } from '../src/index.ts';
import { MESSAGES } from './fixtures/s2/messages.ts';
import { POSITIONS } from './fixtures/s2/positions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const packets = JSON.parse(readFileSync(path.join(here, 'fixtures', 's2', 'packets.json'), 'utf8')) as { key: string; packet: FactPacket }[];
const facts = new Map<string, Fact>();
for (const p of packets) for (const f of p.packet.facts) facts.set(f.id, f);
const fact = (id: string) => facts.get(id);

// the concept ladder is content: the same file the app reads
const ladder = compileLadder(JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'concept-ladder.json'), 'utf8')) as ConceptLadderFile);

// The spike S2 set (TRACKER, Phase 2), kept as a regression test (PLAN WP 4.4): 20 true coach
// messages and 20 with one planted error, on eight real positions with real engine facts.
describe('spike S2 regression: planted errors are caught, true messages pass', () => {
  for (const [i, m] of MESSAGES.entries()) {
    const pos = POSITIONS.find((p) => p.key === m.pos)!;
    it(`${String(i + 1).padStart(2)} ${m.truth ? 'true ' : 'FALSE'} [${m.pos}] ${m.text.slice(0, 70)}`, () => {
      const v = validateSay({ kind: m.kind, text: m.text, claims: m.claims }, { fen: pos.fen, you: pos.you, fact, budgetSentences: 2, canAnswer: true, vocabulary: 'core', ladder });
      expect(v.ok, v.problems.map((p) => `${p.rule}: ${p.message}`).join(' | ') || m.planted).toBe(m.truth);
    });
  }
});

const italian = (() => {
  const r = playLine(START_FEN, 'e4 e5 Nf3 Nc6 Bc4 Bc5'.split(' '));
  if (!r.ok) throw new Error('setup');
  return r.fens.at(-1)!;
})();
const ctx = (over: Partial<ValidatorContext> = {}): ValidatorContext => ({ fen: italian, you: 'white', fact, budgetSentences: 2, canAnswer: true, vocabulary: 'core', ladder, ...over });
const rules = (text: string, c: Partial<ValidatorContext> = {}, claims: string[] = [], kind: 'explain' | 'answer' | 'question' = 'explain') =>
  validateSay({ kind, text, claims }, ctx(c)).problems.map((p) => p.rule);

describe('the rules one by one', () => {
  it('R1: notation the board cannot place is refused; a legal move or a square written bare becomes a token', () => {
    expect(rules('Play Nd5 next.')).toContain('R1');
    expect(rules('Castle with O-O-O soon.')).toContain('R1');
    // a legal move written bare is made a token, and then checked like one
    const bare = validateSay({ kind: 'explain', text: 'Castle with O-O soon, or play Nc3 first.', claims: [] }, ctx());
    expect(bare.problems).toEqual([]);
    expect(bare.tokens.map((t) => t.kind === 'move' && t.san)).toEqual(['O-O', 'Nc3']);
    // and then a claim about it needs a fact, as it would for a token the coach typed
    expect(rules('Nc3 is the strongest move here.')).toContain('R3');
    const v = validateSay({ kind: 'explain', text: 'Your bishop on c4 is well placed.', claims: [] }, ctx());
    expect(v.ok).toBe(true);
    expect(v.tokens).toEqual([{ kind: 'square', raw: '{sq:c4}', square: 'c4' }]);
    // and the softened square is still checked against the board
    expect(rules('Your rook on c4 is well placed.')).toContain('R2');
  });

  it('R2: tokens must be true on the board', () => {
    expect(rules('What about {m:Ke3}?')).toContain('R2');
    expect(rules('Look at {pc:Qc4}.')).toContain('R2');
    expect(rules('Look at {sq:j9}.')).toContain('R2');
    expect(rules('What about {m:d3}?')).toEqual([]);
    expect(rules('Look at {pc:Bc4} and {sq:f7}.')).toEqual([]);
  });

  it('R2: a relation between two pieces is checked by geometry', () => {
    expect(rules('{pc:Bc4} attacks {pc:Pf7}.')).toEqual([]);
    expect(rules('{pc:Bc4} attacks {pc:Pe5}.')).toContain('R2');
    expect(rules('{pc:Nf3} defends {sq:d4}.')).toEqual([]);
  });

  it('R2: a bare move may come from a cited fact line or from another board in view', () => {
    // P2.F5's line is Nxe5 dxe5 Qxg4, played from the "legal" position, not from the Italian
    expect(rules('What about {m:Qxg4}?')).toContain('R2');
    expect(rules('What about {m:Qxg4}?', {}, ['P2.F5'])).toEqual([]);
    const legal = POSITIONS.find((p) => p.key === 'legal')!.fen;
    expect(rules('What about {m:Nxe5}?', { alsoFens: [legal] })).toEqual([]);
  });

  it('R3: a claim needs a fact, and the fact must be about the same thing', () => {
    expect(rules('{m:d3} is the best move.')).toContain('R3');
    expect(rules('{m:d3} is the best move.', {}, ['P5.F6'])).toEqual([]);
    expect(rules('{m:c3} is the best move.', {}, ['P5.F6'])).toContain('R3'); // the fact names d3
    expect(rules('You win a pawn here.')).toContain('R3');
    expect(rules('You can castle now.')).toContain('R3'); // no castling fact cited
  });

  it('R3: a genuine question may use claim words; a leading question may not', () => {
    expect(rules('Is your knight on {sq:f3} hanging?', {}, [], 'question')).toEqual([]);
    expect(rules('What does their bishop threaten?', {}, [], 'question')).toEqual([]);
    expect(rules('Did you notice that your knight on {sq:f3} is hanging?', {}, [], 'question')).toContain('R3');
  });

  it('R3: saying that nothing is hanging or threatened needs a quiet fact, and a quiet fact backs nothing else', () => {
    const quiet: Fact = { id: 'Q.F1', type: 'quiet', text: 'None of your pieces can be taken for free right now, and they have no immediate threat.', data: { side: 'mine' } };
    const withQuiet = { fact: (id: string) => (id === 'Q.F1' ? quiet : fact(id)) };
    expect(rules('Nothing of yours is hanging right now.')).toContain('R3');
    expect(rules('There is no threat here.')).toContain('R3');
    expect(rules('Nothing of yours is hanging right now.', withQuiet, ['Q.F1'])).toEqual([]);
    expect(rules('There is no threat here.', withQuiet, ['Q.F1'])).toEqual([]);
    expect(rules('Their queen is hanging.', withQuiet, ['Q.F1'])).toContain('R3'); // not what a quiet fact says
    expect(rules('They threaten your queen.', withQuiet, ['Q.F1'])).toContain('R3');
  });

  it('R3: a reason given for a move must be one the board confirms', () => {
    expect(rules('{m:d3} protects your bishop.')).toEqual([]); // the pawn on d3 does guard c4
    expect(rules('{m:Nc3} develops a piece.')).toEqual([]);
    expect(rules('{m:a3} develops a piece.')).toContain('R3');
    expect(rules('{m:h3} attacks their queen.')).toContain('R3');
    expect(rules('{m:a3} stops their threat.')).toContain('R3');
  });

  it('R3: a general statement about chess is not a claim about this position', () => {
    expect(rules('A fork is when one piece attacks two enemy pieces at the same time. Knights are especially good at forks.')).toEqual([]);
    expect(rules('A pin is when a piece cannot move without exposing a more valuable piece behind it.')).toEqual([]);
    expect(rules('Their knight forks your king and rook.')).toContain('R3'); // about this position: needs a fork fact
    expect(rules('A knight on {sq:c7} would be a fork.')).toContain('R3');
  });

  it('kind "general": chess knowledge passes, but it may not point at or talk about the board', () => {
    const general = (text: string) => validateSay({ kind: 'general', text, claims: [] }, ctx({ budgetSentences: 4 })).problems.map((p) => p.rule);
    expect(general('A fork is one move where a single piece attacks two or more enemy pieces at once. Your opponent can only save one of them, so you usually win material. Look for forks among your checks, captures and threats.')).toEqual([]);
    expect(general('A pin is when a piece cannot move without exposing a more valuable piece behind it.')).toEqual([]);
    expect(general('A fork is a double attack, like {m:d3} here.')).toEqual(expect.arrayContaining(['R2', 'R3']));
    expect(general('A piece is hanging when nothing defends it, and your queen is hanging.')).toContain('R3');
    expect(general('Forks win material. In this position you have one.')).toContain('R3');
  });

  it('R3: negation is judged inside the clause', () => {
    const hang = packets.find((x) => x.key === 'queenfork')!.packet.facts.find((f) => f.type === 'hangs' && f.text.includes('{pc:Ne5}'))!;
    const c = { fen: POSITIONS.find((x) => x.key === 'queenfork')!.fen };
    expect(rules('Your knight on {sq:e5} has no good defender, so it is en prise.', c, [hang.id])).toEqual([]);
    expect(rules('Your knight on {sq:e5} is not hanging.', c, [hang.id])).toContain('R3');
  });

  it('R1: a bare square becomes a token, but a bare pawn move does not slip through', () => {
    expect(validateSay({ kind: 'explain', text: 'Your knight leaving f3 changes things.', claims: [] }, ctx()).tokens).toEqual([{ kind: 'square', raw: '{sq:f3}', square: 'f3' }]);
    expect(rules('Then play d5 next.')).toContain('R1');
    expect(validateSay({ kind: 'explain', text: 'Then play d3 next.', claims: [] }, ctx()).tokens).toMatchObject([{ kind: 'move', san: 'd3' }]);
    // after "and", a square that is the subject of the sentence is a square
    expect(rules('A queen moves along diagonals, and h7 is not within its reach from {sq:d1}.')).toEqual([]);
    // the last square of a list is a square as well
    expect(validateSay({ kind: 'explain', text: 'Their pawns on f7, g7 and h7 have not moved.', claims: [] }, ctx()).tokens).toHaveLength(3);
    expect(rules('Bring your knight to c3.')).toEqual([]); // a real destination
    expect(rules('Bring your knight to d8.')).toContain('R2'); // nothing of either side can go there
    expect(rules('Castle now, or d5 first.')).toContain('R1');
  });

  it('R4: engine numbers are refused unless the owner switched numbers on', () => {
    expect(rules('You are +1.5 here.')).toContain('R4');
    expect(rules('That is a 60% position.')).toContain('R4');
    expect(rules('You have three attackers and two defenders.')).toEqual([]);
    expect(rules('You are +1.5 here.', { numbersOn: true })).not.toContain('R4');
  });

  it('R5: deferred concepts wait, unless the owner asked about them', () => {
    expect(rules('This gives you an outpost.')).toContain('R5');
    expect(rules('This gives you an outpost.', { ownerText: 'what is an outpost?' })).not.toContain('R5');
    expect(rules('This gives you an outpost.', { vocabulary: 'all' })).not.toContain('R5');
    // "some theory" lets the simpler ideas through and still holds the hardest back
    expect(rules('This gives you an outpost.', { vocabulary: 'intro' })).not.toContain('R5');
    expect(rules('That is prophylaxis.', { vocabulary: 'intro' })).toContain('R5');
    expect(rules('That is prophylaxis.', { vocabulary: 'all' })).not.toContain('R5');
    // the coach is told what to say instead
    const problem = validateSay({ kind: 'explain', text: 'This gives you an outpost.', claims: [] }, ctx()).problems.find((p) => p.rule === 'R5')!;
    expect(problem.message).toMatch(/Say it in plain words instead: a square for your piece that their pawns can never attack/);
    // the words the coach uses all the time are never held back
    for (const fine of ['That is a fork.', 'Your knight is pinned.', 'It is a skewer.', 'Your king safety matters here.']) expect(rules(fine), fine).not.toContain('R5');
  });

  it('the concept ladder is data, and a broken one is refused with the reason', () => {
    expect(ladder.concepts.length).toBeGreaterThan(20);
    expect(ladder.deferredAt('core').map((d) => d.concept.id)).toEqual(expect.arrayContaining(['outpost', 'prophylaxis', 'zugzwang']));
    expect(ladder.deferredAt('intro').map((d) => d.concept.id)).not.toContain('outpost');
    expect(ladder.deferredAt('all')).toEqual([]);
    const base = { id: 'x', name: 'x', use: 'defer' as const, from: 'intro' as const, words: ['\\bx\\b'], plain: 'x' };
    expect(() => compileLadder({ concepts: [base, base] })).toThrow(/twice/);
    expect(() => compileLadder({ concepts: [{ ...base, words: [] }] })).toThrow(/no words to spot it by/);
    expect(() => compileLadder({ concepts: [{ ...base, plain: undefined }] })).toThrow(/no plain wording/);
    expect(() => compileLadder({ concepts: [{ ...base, words: ['('] }] })).toThrow(/not a valid regular expression/);
  });

  it('R6: the sentence budget', () => {
    expect(rules('One. Two. Three.')).toContain('R6');
    expect(rules('One. Two.')).toEqual([]);
    expect(splitSentences('After {m:Nf3} you castle. Then what?')).toHaveLength(2);
  });

  it('R7: no answer before the owner has tried', () => {
    expect(rules('{m:d3} is a fine choice.', { canAnswer: false }, [], 'answer')).toContain('R7');
    expect(rules('What are your checks and captures?', { canAnswer: false }, [], 'question')).toEqual([]);
  });

  it('R8: a reply to an old board is refused', () => {
    expect(rules('Hello.', { seq: 4, currentSeq: 5 })).toContain('R8');
    expect(rules('Hello.', { seq: 5, currentSeq: 5 })).toEqual([]);
  });

  it('gives the page segments it can render, and plain text for logs', () => {
    const v = validateSay({ kind: 'explain', text: 'Your bishop {pc:Bc4} looks at {sq:f7}; {m:d3} supports it.', claims: [] }, ctx());
    expect(v.ok).toBe(true);
    expect(v.segments.filter((s) => s.type === 'token')).toHaveLength(3);
    expect(v.plain).toBe('Your bishop on c4 looks at f7; d3 supports it.');
    const move = v.tokens.find((t) => t.kind === 'move');
    expect(move).toMatchObject({ san: 'd3', from: 'd2', to: 'd3', baseFen: italian });
  });
});

// Four ways a true message was refused in the first full harness runs (TRACKER, WP 4.10).
describe('what the playbook harness showed (2026-11-14)', () => {
  const withFacts = (extra: Fact[]) => (id: string) => extra.find((x) => x.id === id) ?? fact(id);

  it('a move check_move found not legal may be named, in plain words, once its fact is cited', () => {
    const illegal: Fact = { id: 'X1.F1', type: 'illegal', text: 'Qh7 is not a legal move in this position: your own pawn on d2 is in the way of your queen on d1.', data: { move: 'Qh7' } };
    const c = { fact: withFacts([illegal]), budgetSentences: 4 };
    const text = '{m:Qh7} is not a legal move here: your queen on {sq:d1} cannot go to {sq:h7}. Which move did you have in mind?';
    // from the coach's own head: refused
    expect(rules(text, c)).toContain('R2');
    expect(rules('That is not a legal move.', c)).toContain('R3');
    const v = validateSay({ kind: 'explain', text, claims: ['X1.F1'] }, ctx(c));
    expect(v.problems).toEqual([]);
    expect(v.plain).toContain('Qh7 is not a legal move here');
    // it cannot be played, so it is never a clickable move
    expect(v.tokens.some((t) => t.kind === 'move')).toBe(false);
    expect(rules('Qh7 is not a legal move here.', c, ['X1.F1'])).toEqual([]);
    // any other bare move is still refused
    expect(rules('Qh7 is not a legal move here, so think about Nd5.', c, ['X1.F1'])).toContain('R1');
  });

  it('"cannot go to" and "just moved to" do not claim that a piece can move there', () => {
    expect(rules('Your queen goes to {sq:h7} next.')).toContain('R2');
    expect(rules('Your queen cannot go to {sq:h7} from where it stands.')).toEqual([]);
    expect(rules('A queen move to {sq:h7} is not possible here.')).toEqual([]);
    // a piece that "just moved" somewhere must be standing there
    expect(rules('Their bishop just moved to {sq:c5}.')).toEqual([]);
    expect(rules('Their bishop just moved to {sq:e3}.')).toContain('R2');
  });

  it('a move written bare that the message also has as a token is that token', () => {
    const v = validateSay({ kind: 'explain', text: 'Nc3 is a normal move here; {m:Nc3} brings a knight out.', claims: [] }, ctx());
    expect(v.problems).toEqual([]);
    expect(v.tokens.filter((t) => t.kind === 'move')).toHaveLength(2);
    // a different bare move is not helped by it
    expect(rules('Nd5 is a normal move here; {m:d3} is another.')).toContain('R1');
  });

  it('a bare move from the line of a cited fact is a token as well (the move just played)', () => {
    const before = playLine(START_FEN, 'e4 e5 Nf3 Nc6 Bc4'.split(' '));
    if (!before.ok) throw new Error('setup');
    const played: Fact = { id: 'G1.F1', type: 'graded', text: 'Bc5 was a good move.', data: { baseFen: before.fens.at(-1)!, line: ['Bc5'], move: 'Bc5' } };
    const c = { fact: withFacts([played]) };
    const v = validateSay({ kind: 'explain', text: 'Bc5 brought their bishop out.', claims: ['G1.F1'] }, ctx(c));
    expect(v.problems).toEqual([]);
    expect(v.tokens).toMatchObject([{ kind: 'move', san: 'Bc5', factId: 'G1.F1' }]);
    // without the fact, the board cannot place it: Black's move is not White's to play
    expect(rules('Bc5 brought their bishop out.')).toContain('R1');
  });

  it('the move that led to the position may be named: it resolves from the position it was played in', () => {
    const before = playLine(START_FEN, 'e4 e5 Nf3 Nc6 Bc4'.split(' '));
    if (!before.ok) throw new Error('setup');
    const c = { lastMove: { san: 'Bc5', baseFen: before.fens.at(-1)! } };
    const v = validateSay({ kind: 'question', text: 'Their last move was {m:Bc5}. What is that bishop aiming at?', claims: [] }, ctx(c));
    expect(v.problems).toEqual([]);
    expect(v.tokens).toMatchObject([{ kind: 'move', san: 'Bc5', from: 'f8', to: 'c5' }]);
    // written bare, it becomes the same token
    expect(rules('Their last move was Bc5.', c)).toEqual([]);
    // nothing else is checked against the earlier position: their bishop no longer stands on f8
    expect(rules('Their bishop on {sq:f8} has not moved.', c)).toContain('R2');
    // and another move that is not on the board is still refused
    expect(rules('Their last move was {m:Bb4}.', c)).toContain('R2');
    expect(rules('Their last move was {m:Bc5}.')).toContain('R2');
  });

  it('a move written as a check is that check, not a quiet move with the same letters on the board in front of the owner', () => {
    // found by gate V3 on Black's repertoire: White's 11.Nxe7+ is answered by 11...Nxe7, so "Nxe7" is also legal on the owner's board
    const line = 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 c5 dxc5 dxc5 Qxd8 Rxd8 Bxc5 Nc6 Nd5 Nd7 Nxe7+'.split(' ');
    const p = playLine(START_FEN, line);
    if (!p.ok) throw new Error('setup');
    const c = { fen: p.fens.at(-1)!, you: 'black' as const, lastMove: { san: 'Nxe7+', baseFen: p.fens.at(-2)! } };
    const v = validateSay({ kind: 'question', text: 'Their move {m:Nxe7+} gives check. What can take the knight?', claims: [] }, ctx(c));
    expect(v.tokens).toMatchObject([{ kind: 'move', san: 'Nxe7+', baseFen: p.fens.at(-2)! }]);
    expect(v.problems.map((x) => x.message).join(' ')).not.toMatch(/no move in it is a check/);
    // written without the "+", it is the move on the owner's own board, as before
    expect(validateSay({ kind: 'question', text: 'Can you play {m:Nxe7}?', claims: [] }, ctx(c)).tokens).toMatchObject([{ kind: 'move', san: 'Nxe7', baseFen: p.fens.at(-1)! }]);
    // and a check that is not one is still refused
    expect(rules('{m:Nxe7#} wins.', c)).toContain('R2');
  });

  it('a move that is the subject of "wins" or "loses" must agree with the verdict of its fact', () => {
    const before = playLine(START_FEN, 'e4 e5 Qh5 Nc6 Bc4'.split(' '));
    if (!before.ok) throw new Error('setup');
    const base = before.fens.at(-1)!;
    // the owner (Black) played Nf6 and was mated: the fact says so, and it mentions the queen that mates
    const slip: Fact = { id: 'M1.F1', type: 'unsafe', text: 'Nf6 is a serious mistake: it attacks their queen, but it allows checkmate with Qxf7#.', data: { baseFen: base, line: ['Nf6', 'Qxf7#'], move: 'Nf6', verdictForYou: 'bad', side: 'black' } };
    const c = { fen: base, you: 'black' as const, fact: withFacts([slip]), budgetSentences: 4 };
    expect(rules('{m:Nf6@M1.F1} allowed checkmate.', c, ['M1.F1'])).toEqual([]);
    // the word "queen" is in the fact, but the fact does not say the move won one
    expect(rules('{m:Nf6@M1.F1} won a queen.', c, ['M1.F1'])).toContain('R3');
    expect(rules('{m:Nf6@M1.F1} would win their queen.', c, ['M1.F1'])).toContain('R3');
  });

  it('"does not stop the threat" does not say that there is no threat', () => {
    const threat: Fact = { id: 'T1.F1', type: 'threat', text: 'They threaten to take on f2.', data: {} };
    const c = { fact: withFacts([threat]) };
    const needsQuiet = (text: string) => validateSay({ kind: 'explain', text, claims: ['T1.F1'] }, ctx(c)).problems.some((p) => /quiet fact/.test(p.message));
    expect(needsQuiet('That move does not stop their threat.')).toBe(false);
    expect(needsQuiet('You did not see the threat coming.')).toBe(false);
    expect(needsQuiet('There is no threat at the moment.')).toBe(true);
    expect(needsQuiet('They are not threatening anything.')).toBe(true);
  });

  it('a sentence with no square of its own is about the fact\'s piece when it names that piece', () => {
    const hangs: Fact = { id: 'H1.F1', type: 'hangs', text: 'Your knight on e5 can be taken for free.', data: { piece: { square: 'e5', role: 'knight', color: 'white' } } };
    const c = { fact: withFacts([hangs]), budgetSentences: 4 };
    const wrongPiece = (text: string) => validateSay({ kind: 'explain', text, claims: ['H1.F1'] }, ctx(c)).problems.some((p) => /not the piece in your message/.test(p.message));
    expect(wrongPiece('Their queen attacked your knight, and nothing defends it. Keep an eye on {sq:f2} as well.')).toBe(false);
    expect(wrongPiece('Their queen attacked your bishop, and nothing defends it. Keep an eye on {sq:f2} as well.')).toBe(true);
    // a square of its own still has to be the fact's square
    expect(wrongPiece('Your knight on {sq:f3} is not defended.')).toBe(true);
  });

  it('"bring it back here" is about the app, not about the board', () => {
    const general = (text: string) => validateSay({ kind: 'general', text, claims: [] }, ctx({ budgetSentences: 4 })).problems.map((p) => p.rule);
    expect(general('I cannot help with a game in progress. Bring it back here when it is over.')).toEqual([]);
    expect(general('The knight here is strong.')).toContain('R3');
  });

  it('"back rank" is backed by a cited fact whose line ends in a back-rank mate', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const backRank: Fact = { id: 'B1.F1', type: 'mate_in', text: 'Rd8# is checkmate.', data: { baseFen: fen, line: ['Rd8#'], move: 'Rd8#', mateIn: 1, side: 'white' } };
    const c = { fen, fact: withFacts([backRank]), budgetSentences: 4 };
    const text = '{m:Rd8#@B1.F1} is checkmate. Your rook goes to the back rank, and their king is shut in by its own pawns.';
    expect(validateSay({ kind: 'answer', text, claims: ['B1.F1'] }, ctx(c)).problems).toEqual([]);
    // a mate that is not on the back rank does not back the words
    const scholar = playLine(START_FEN, 'e4 e5 Bc4 Nc6 Qh5 Nf6'.split(' '));
    if (!scholar.ok) throw new Error('setup');
    const base = scholar.fens.at(-1)!;
    const other: Fact = { id: 'B2.F1', type: 'mate_in', text: 'Qxf7# is checkmate.', data: { baseFen: base, line: ['Qxf7#'], move: 'Qxf7#', mateIn: 1, side: 'white' } };
    const v = validateSay({ kind: 'answer', text: '{m:Qxf7#@B2.F1} is checkmate, a back-rank mate.', claims: ['B2.F1'] }, ctx({ fen: base, fact: withFacts([other]), budgetSentences: 4 }));
    expect(v.problems.map((p) => p.rule)).toContain('R3');
  });

  it('"without giving check" is not a claim that a move gives check (how a stalemate is described)', () => {
    const fen = 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1';
    const c = { fen, budgetSentences: 4 };
    const gives = (text: string) => validateSay({ kind: 'explain', text, claims: [] }, ctx(c)).problems.some((p) => /gives check, but no move in it is a check/.test(p.message));
    expect(gives('{m:Qc7} gives check.')).toBe(true);
    expect(gives('{m:Qc7} takes their last square without giving check.')).toBe(false);
    expect(gives('{m:Qc7} leaves their king no move while not giving check.')).toBe(false);
    expect(gives('{m:Qc7} boxes the king in with no check.')).toBe(false);
    // a checking move named alongside still satisfies the claim when one is made
    expect(gives('{m:Qc8#} gives check, and {m:Qc7} does not.')).toBe(false);
    // nor is "wasn't in check" a claim that someone is in check
    const inCheck = (text: string) => validateSay({ kind: 'explain', text, claims: [] }, ctx(c)).problems.some((p) => /nobody is in check/.test(p.message));
    expect(inCheck('Their king is in check.')).toBe(true);
    expect(inCheck("Their king had no legal move and wasn't in check, so it is stalemate.")).toBe(false);
    expect(inCheck('Their king was not in check.')).toBe(false);
    expect(inCheck('It is never in check here.')).toBe(false);
  });

  it('a mate passed over: "misses a forced checkmate in 2" is backed by the move\'s fact, "mates in 2" is not', () => {
    const scholar = playLine(START_FEN, 'e4 e5 Bc4 Nc6 Qh5 Nf6'.split(' '));
    if (!scholar.ok) throw new Error('setup');
    const base = scholar.fens.at(-1)!;
    // check_move's verdict on a move that let a mate in 2 go (as gradeMove words it), both as a mistake and as "loses nothing"
    const slip: Fact = { id: 'X1.F1', type: 'unsafe', text: 'Qe2 is a mistake: you miss a forced checkmate in 2.', data: { baseFen: base, line: ['Qe2'], move: 'Qe2', side: 'white', missedMate: 2 } };
    const calm: Fact = { id: 'X2.F1', type: 'safe', text: 'Qe2 loses nothing, but you miss a forced checkmate in 2.', data: { baseFen: base, line: ['Qe2'], move: 'Qe2', side: 'white', missedMate: 2 } };
    const c = { fen: base, fact: withFacts([slip, calm]), budgetSentences: 4 };
    const ok = (text: string, id: string) => validateSay({ kind: 'explain', text, claims: [id] }, ctx(c)).problems.map((p) => `${p.rule}: ${p.message}`);
    expect(ok('{m:Qe2@X1.F1} misses a forced checkmate in 2.', 'X1.F1')).toEqual([]);
    expect(ok('You missed a mate in two there.', 'X1.F1')).toEqual([]);
    expect(ok('{m:Qe2@X2.F1} loses nothing, but it misses a forced checkmate in 2.', 'X2.F1')).toEqual([]);
    // the count must still be right
    expect(ok('{m:Qe2@X1.F1} misses a forced checkmate in 3.', 'X1.F1').join(' ')).toMatch(/do not show a mate in 3/);
    // and a mate passed over is not a mate made
    expect(ok('{m:Qe2@X1.F1} mates in 2.', 'X1.F1').join(' ')).toMatch(/do not show a mate in 2/);
    expect(ok('{m:Qe2@X2.F1} mates in 2.', 'X2.F1').length).toBeGreaterThan(0);
  });
});

describe('a question reported inside a sentence (D72)', () => {
  const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const say = (text: string, kind: 'idea' | 'question' = 'idea') => validateSay({ kind, text, claims: [] }, { fen: FEN, you: 'white', fact: () => undefined, budgetSentences: 4, canAnswer: true });
  it('asks, so it needs no fact', () => {
    expect(say('For this game, before each move, ask yourself: what did their last move threaten?').ok).toBe(true);
    expect(say('Before each move, ask what their last move threatens, then check what they could capture.').ok).toBe(true);
    expect(say('Look at which of your pieces are hanging before you move.').ok).toBe(true);
    expect(say('For this game, ask one question before each move: what does their last move threaten?').ok).toBe(true);
    expect(say('Before each move, ask yourself what their last move threatens.').ok).toBe(true);
    expect(say('Ask one question: after their last move, what does it threaten?').ok).toBe(true);
    expect(say('Before every move, ask yourself, "What did their last move threaten?"').ok).toBe(true);
    // the routine's own words name its steps
    expect(say('Then check your own captures and threats before you play.').ok).toBe(true);
    expect(say('Before you move, look at your checks, captures and threats.').ok).toBe(true);
  });
  it('a plain statement still needs its fact', () => {
    const r = say('Their last move threatens your queen.');
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.rule)).toContain('R3');
    // a claim before the reported question is still a claim
    expect(say('Your knight is hanging, so ask what they could take.').ok).toBe(false);
    expect(say('Their bishop makes two threats at once.').ok).toBe(false);
  });
});

describe("the title of a line on the coach's board", () => {
  // the case seen while recording the README (2026-11-17): after 6.Nxf7?? the coach asked for "threat",
  // which is White's (the owner's) Nxh8, and titled it "Their threat: Qxe4+"
  const threat = { moves: ['Nxh8', 'Qxe4+', 'Qe2', 'Qxe2+', 'Kxe2'], firstBy: 'you' as const };

  it('refuses a title that names the wrong side, or a move the line does not start with', () => {
    const problems = lineTitleProblems('Their threat: Qxe4+', threat);
    expect(problems.join(' ')).toMatch(/names Qxe4\+ first, but the line starts with Nxh8/);
    expect(problems.join(' ')).toMatch(/"Their threat", but the line starts with Nxh8, which is the owner's move/);
    expect(lineTitleProblems('If they play Bc5', threat)).toEqual([expect.stringMatching(/names Bc5, which is not in the line/)]);
    expect(lineTitleProblems('What they threaten', threat)).toHaveLength(1);
  });

  it('lets a title through that says what the line is', () => {
    for (const ok of ['Your threat', 'Your threat: Nxh8', 'If you take the rook', 'Nxh8, then Qxe4+', 'Your big threat on h8', 'If you do nothing, Nxh8']) expect(lineTitleProblems(ok, threat), ok).toEqual([]);
    // a bare square may be a square, so it is never read as a move; tokens are read as what they say
    expect(lineTitleProblems('The rook on h8', threat)).toEqual([]);
    expect(lineTitleProblems('Their threat: {m:Qxe5}', { moves: ['Qxe5+', 'Qe2'], firstBy: 'they' })).toEqual([]);
    expect(lineTitleProblems('Castling: O-O', { moves: ['O-O', 'Nf6'], firstBy: 'you' })).toEqual([]);
  });
});
