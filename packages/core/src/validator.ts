// The claim validator (ARCHITECTURE §9, feature H13). Every coach message passes through here
// before the page sees it. It is deliberately simple: tokens are checked against the board, and
// claim words must be backed by a cited fact. It does not understand language; it stops inventions.

import type { ConceptLadder, VocabularyLevel } from './ladder.ts';
import { LETTER_ROLE, anyToMove, describeMove, legalMoves, mustPosition, parsePosition, parseSquare, passPosition, sanToMove, type Color, type Role } from './chess.ts';
import { attacksSquare } from './attacks.ts';
import { moveReasons, type Fact, type FactType } from './facts.ts';
import { motifsOf, type Motif } from './motifs.ts';

export type SayKind = 'question' | 'nudge' | 'answer' | 'explain' | 'praise' | 'idea' | 'summary' | 'general';
export type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8';
export type Problem = { rule: Rule; message: string };

/** A token as the page needs it: what to show and what to do when it is clicked. */
export type ResolvedToken =
  | { kind: 'move'; raw: string; san: string; baseFen: string; fenAfter: string; from: string; to: string; factId?: string }
  | { kind: 'square'; raw: string; square: string }
  | { kind: 'piece'; raw: string; square: string; role: Role; color: Color };

export type Segment = { type: 'text'; text: string } | { type: 'token'; token: ResolvedToken };

export type ValidatorContext = {
  /** the position bare tokens refer to: what the owner is looking at */
  fen: string;
  /** other positions the owner has in front of them (their own board while a demo is showing): a token may be true there instead */
  alsoFens?: string[];
  you: Color;
  /** look up any fact the coach may cite (recent packets, check_move results, shown lines) */
  fact: (id: string) => Fact | undefined;
  budgetSentences: number;
  /** the hint ladder: may the coach give the answer now? */
  canAnswer?: boolean;
  seq?: number;
  currentSeq?: number;
  numbersOn?: boolean;
  vocabulary?: VocabularyLevel;
  /** the concept ladder (content/concept-ladder.json). Without it the vocabulary rule R5 is not checked */
  ladder?: ConceptLadder;
  /** what the owner typed, if anything: a deferred concept is allowed when the owner asked about it */
  ownerText?: string;
  /**
   * The move that led to the position on the board, and the position it was played from. The coach
   * may name it ("their last move, Bc4, …"): it resolves as a move token, and nothing else is
   * checked against the earlier position.
   */
  lastMove?: { san: string; baseFen: string };
};

export type Verdict = { ok: boolean; problems: Problem[]; tokens: ResolvedToken[]; segments: Segment[]; sentences: number; plain: string };

const TOKEN_RE = /\{(m|sq|pc):([^}@]*)(?:@([^}]*))?\}/g;

const ROLE_WORDS: Record<string, Role> = { king: 'king', queen: 'queen', rook: 'rook', bishop: 'bishop', knight: 'knight', pawn: 'pawn' };
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/** words that make a mate count about a chance passed over, not a mate made */
const MISSED_WORDS = /\bmiss(?:es|ed|ing)?\b|\bpass(?:es|ed)? (?:it )?(?:up|over)\b|\bcould have\b|\bwould have\b|\bwas there\b/i;

// R1: anything that looks like chess notation outside a token
const LOOSE: { re: RegExp; what: string }[] = [
  { re: /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?/g, what: 'a move' },
  { re: /\b[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?/g, what: 'a move' },
  { re: /\b[a-h][1-8]-?[a-h][1-8][qrbn]?\b/g, what: 'a move' },
  { re: /\b[O0]-[O0](?:-[O0])?\b/g, what: 'castling' },
  { re: /\b[a-h][1-8]\b/g, what: 'a square' },
];

// R4: engine numbers
const NUMBERS: RegExp[] = [/[+\-−–]\s?\d+(?:\.\d+)?(?!\w)/, /\b\d+\.\d+\b/, /\b\d+\s?%/, /\bcentipawns?\b/i, /\bcp\b/, /\bevals?\b/i, /\bdepth\s*\d+/i, /\bwin(?:ning)? (?:chance|probabilit)/i];

// R5 (concepts kept for later) reads the concept ladder, which is data: content/concept-ladder.json, ladder.ts

type ClaimRule = {
  id: string;
  re: RegExp;
  types: FactType[];
  /** how to fix it, shown to the coach */
  hint: string;
};

const PIECE = '(queen|rook|bishop|knight|pawn|piece|exchange|material)s?';
const CLAIMS: ClaimRule[] = [
  { id: 'mate', re: /\b(?:check)?mate(?:s|d)?\b/i, types: ['mate_in', 'game_over', 'unsafe', 'threat', 'graded'], hint: 'a mate claim needs a mate fact' },
  {
    id: 'wins',
    re: new RegExp(`\\b(?:win|wins|winning|won|pick(?:s|ing)? up|grab(?:s|bing)?|gain(?:s|ing)?|net(?:s|ting)?)\\s+(?:back\\s+)?(?:a|an|the|your|their|two|three|some|free)?\\s*(?:free\\s+|whole\\s+|full\\s+)?${PIECE}\\b`, 'i'),
    types: ['wins_material', 'loses_material', 'hangs', 'best_move', 'good_move', 'threat', 'graded', 'line', 'fork', 'safe', 'unsafe'],
    hint: 'a "wins material" claim needs a fact that says so',
  },
  {
    id: 'loses',
    re: new RegExp(`\\b(?:lose|loses|losing|lost|drop|drops|dropped|dropping|blunder(?:s|ed|ing)?|give(?:s)? (?:up|away)|gave (?:up|away)|cost(?:s)?(?: you| them)?|sacrific\\w+)\\s+(?:a|an|the|your|their|two|three|some)?\\s*(?:whole\\s+|full\\s+)?${PIECE}\\b`, 'i'),
    types: ['loses_material', 'wins_material', 'hangs', 'threat', 'graded', 'unsafe', 'line', 'best_move', 'good_move', 'fork'],
    hint: 'a "loses material" claim needs a fact that says so',
  },
  {
    id: 'hanging',
    re: /\b(?:hanging|hangs|hung|undefended|unprotected|unguarded|en prise|for free|free (?:piece|pawn|knight|bishop|rook|queen)|not (?:defended|protected|guarded)|no (?:defender|protector|protection)s?|nothing (?:defends|protects|guards|takes back)|can(?:not|'t) (?:be )?(?:recaptured?|taken? back))\b/i,
    types: ['hangs', 'graded', 'loses_material', 'threat'],
    hint: 'a "hanging / undefended" claim needs a hangs fact about that piece',
  },
  { id: 'fork', re: /\bfork(?:s|ed|ing)?\b|\bdouble attack\b/i, types: ['fork'], hint: 'a fork claim needs a fork fact' },
  { id: 'pin', re: /\bpin(?:s|ned|ning)?\b/i, types: ['pin'], hint: 'a pin claim needs a pin fact' },
  // these three have no fact type of their own: they are backed by a cited fact whose line shows the motif (LINE_MOTIF)
  { id: 'skewer', re: /\bskewer/i, types: [], hint: 'no cited fact has a line with a skewer in it' },
  { id: 'discovered', re: /\bdiscover(?:ed|y)\b/i, types: [], hint: 'no cited fact has a line with a discovered attack in it' },
  { id: 'backrank', re: /\bback[- ]rank\b/i, types: [], hint: 'no cited fact has a line that ends in a back-rank mate' },
  { id: 'illegal', re: /\b(?:not (?:a )?legal|illegal|against the rules)\b/i, types: ['illegal'], hint: 'saying a move is not legal needs the fact check_move gives for that move' },
  { id: 'best', re: /\b(?:best|strongest|top|winning|correct|right) (?:move|reply|choice|capture|continuation)\b|\b(?:is|was|it'?s) (?:the )?(?:best|strongest)\b/i, types: ['best_move', 'mate_in', 'only_move', 'graded', 'wins_material'], hint: 'a "best move" claim needs a best_move fact' },
  { id: 'only', re: /\bonly (?:good |legal |real |safe |playable |sensible )?(?:move|reply|way|defen[cs]e)\b/i, types: ['only_move'], hint: 'an "only move" claim needs an only_move fact' },
  { id: 'safe', re: /\b(?:is|was|it'?s|looks|perfectly|completely|totally|quite|still) safe\b|\bsafe (?:move|square|capture)\b|\bsafely\b/i, types: ['safe', 'best_move', 'good_move', 'wins_material', 'graded', 'attack'], hint: 'a "safe" claim needs a fact from check_move that says the move is safe' },
  { id: 'bad', re: /\b(?:unsafe|not safe|a mistake|a blunder|blunders?|bad move|an error|inaccura\w+|a (?:serious|big|bad) mistake)\b/i, types: ['unsafe', 'loses_material', 'graded', 'attack'], hint: 'a "mistake" claim needs a fact that says the move is a mistake' },
  { id: 'stalemate', re: /\bstalemate\b/i, types: ['game_over'], hint: 'a stalemate claim needs a game_over fact' },
  { id: 'castling', re: /\b(?:can(?:not|'t)?|could(?:n't)?|able to|unable to|allowed to|ready to|free to)\s+(?:not\s+)?(?:yet\s+|now\s+|still\s+|already\s+)?castle\b|\b(?:block|stop|prevent)(?:s|ing|ed)? (?:you |them |your |their )?(?:from )?castling\b|\blost the right to castle\b/i, types: ['castling'], hint: 'a statement about whether someone can castle needs a castling fact' },
  {
    id: 'balance',
    re: /\b(?:you are|you're|they are|they're|white is|black is|you will be|you'd be|you would be) (?:now )?(?:completely |clearly |totally |easily |much |far |a (?:little |bit )?|slightly )?(?:winning|losing|lost|better|worse|ahead|behind)\b|\b(?:up|down) (?:a|an|two|three) (?:whole |full )?(?:queen|rook|bishop|knight|pawn|piece|exchange)s?\b/i,
    types: ['material', 'best_move', 'good_move', 'graded', 'line', 'wins_material', 'loses_material', 'mate_in', 'threat', 'safe', 'unsafe'],
    hint: 'a claim about who is ahead needs a material, best_move or line fact',
  },
  { id: 'threat', re: /\bthreat(?:en|ens|ening|ened)?s?\b/i, types: ['threat', 'hangs', 'attack', 'mate_in', 'best_move', 'graded', 'loses_material', 'unsafe', 'fork', 'pin'], hint: 'a threat claim needs a threat, attack or hangs fact' },
];

// "{m:X} protects / stops / attacks / develops …": a reason given for a move must be one the board confirms
const REASON_RE = /(\{m:[^}]+\})\s+(?:(?:also|just|simply|now|then|does|would|will|can|could|really|actually|only|both|still|even|not only)\s+)*(protect|defend|guard|cover|support|save|rescue|stop|prevent|block|parr|deal|meet|attack|threaten|hit|target|pressure|develop)\w*/gi;
const REASON_TAGS: { re: RegExp; tags: string[] }[] = [
  { re: /^(?:protect|defend|guard|cover|support|save|rescue)/i, tags: ['defends', 'saves', 'guards', 'stops_threat'] },
  { re: /^(?:stop|prevent|block|parr|deal|meet)/i, tags: ['stops_threat', 'defends', 'saves', 'answers_check'] },
  { re: /^(?:attack|threaten|hit|target|pressure)/i, tags: ['attacks', 'check', 'mate'] },
  { re: /^develop/i, tags: ['develops'] },
];
const NEGATION = /\b(?:no|not|nothing|none|never|neither|nor|without|isn't|aren't|wasn't|doesn't|don't|won't|can't|cannot)\b/i;
/** "does not stop the threat", "did not see their threat": the threat is there; what is denied is the answer to it */
const NOT_DEALT_WITH = /\b(?:not|n't|never|cannot|without)\s+(?:\w+\s+){0,2}?(?:stop|deal|meet|parr|answer|address|see|saw|notic|ignor|handl|cover|remov|end|solv|prevent|block|defend|react|respond)\w*\b/i;
const GENUINE_QUESTION = /^(?:and |so |now |ok(?:ay)?,? |first,? |before (?:you|that)[^,]*, )?(?:what|which|where|who|whose|how many|is|are|does|do|did|can|could|would|will|was|were|has|have|should)\b/i;
/**
 * A question reported inside a sentence: "ask yourself: what did their move threaten?", "check what
 * their pieces attack". A claim word that comes after it is part of the question, not a statement
 * about the board (TRACKER D72). A plain statement ("their move threatens your queen") is not one.
 */
const REPORTED_QUESTION = /\b(?:ask(?:ing)?|check|look at|wonder)\b(?:\s+(?:yourself|them|one question))*(?:[^.?!:]{0,40}:)?\s*(?:[^.?!,]{0,30},\s*)?["“'‘]?(?:what|whether|if|which|where|how many)\b/i;
/** The routine's own words ("your checks, captures and threats"): the steps of the routine, not a claim that a threat is there. */
const ROUTINE_PHRASE = /\b(?:checks?|captures?)\b(?:,?\s*(?:and|or)?\s*(?:checks?|captures?|attacks?))*,?\s*(?:and|or)\s+threats\b/i;
const PRESUPPOSES = /\b(?:that|notice[ds]?|realis\w+|realiz\w+|since|because|now that|given that|even though|although)\b|\bsee (?:that|how|why)\b|\bwhy\b|\bhow (?:can|could|did|does|do|will|would)\b/i;

const MOVE_WORD = /^(?:play|plays|played|playing|push|pushes|pushed|pushing|advance|advances|advancing|try|tries|trying|with|after|then|by|move|moves|moving|reply|replies|answer|answers|continue|continues|and|or)$/i;

/**
 * A bare square name in running text ("their pawn on e4", "leaving f3") can only be a square, so it
 * is turned into a token instead of bouncing the message. After a word that makes it a pawn move
 * ("play e4") it is left alone: rule R1 then asks for a move token, which the board checks.
 */
export function softenSquares(text: string): string {
  let out = '';
  let last = 0;
  const fix = (plain: string) =>
    plain.replace(/(\b[\w']+\s+)?\b([a-h][1-8])\b(?![+#=-])/g, (all: string, before: string | undefined, sq: string, at: number, whole: string) => {
      const word = (before ?? '').trim();
      // "…and h7 is not within reach": after "and" / "or", a square that is the subject of a verb is a square, not a move
      const subject = /^(?:and|or)$/i.test(word) && /^\s+(?:is|are|was|were|has|have|stays|remains|will|would|can|cannot|could)\b/i.test(whole.slice(at + all.length));
      if (word && MOVE_WORD.test(word) && !subject) return all;
      return (before ?? '') + '{sq:' + sq + '}';
    });
  for (const m of text.matchAll(TOKEN_RE)) {
    out += fix(text.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  // the last square of a list is a square too: "pawns on {sq:f7}, {sq:g7} and h7"
  return (out + fix(text.slice(last))).replace(/(\{sq:[a-h][1-8]\},?\s+(?:and|or)\s+)([a-h][1-8])\b(?![+#=-])/g, '$1{sq:$2}');
}

// kind "general": chess knowledge that is not about this position (what a fork is, how a knight moves).
// It may not point at the board or say anything about it; in return it is not held to the position's facts,
// and the page labels it as general knowledge.
const ABOUT_THE_BOARD = /(?<!\bback )\bhere\b|\b(?:right now|currently|at the moment|in this position|this position|this move|on the board|on your board|last move|just played|just moved)\b|\b(?:your|their|the)\s+(?:king|queen|rook|bishop|knight|pawn)s?\s+(?:is|are|was|were|has|have|can|cannot|can't|on|at)\b/i;

// a general statement about chess ("A fork is when one piece attacks two…") is not a claim about this position
const GENERAL_SUBJECT = /^(?:a|an|one|any|every|each|in chess|generally|usually|often|knights|bishops|rooks|queens|pawns|kings|pieces|forks|pins|skewers|that is|this is called|it is called|it means)\b/i;
const POSITION_WORD = /\b(?:your|their|my|here|now|currently|this position|this move|on the board|at the moment|you (?:are|have|were|lose|win|can|could)|they (?:are|have|were|lose|win|threaten))\b/i;
const MOTIF_CLAIMS = new Set(['fork', 'pin', 'skewer', 'discovered', 'backrank', 'stalemate', 'mate']);
/** claims that are true when the line of a cited fact shows the motif (the detectors of motifs.ts, checked against Lichess's puzzle themes) */
const LINE_MOTIF: Record<string, Motif[]> = { skewer: ['skewer'], discovered: ['discoveredAttack', 'doubleCheck'], backrank: ['backRankMate'] };

/** The motifs in a fact's line, for the side that plays its first move. */
function factMotifs(fact: Fact): Motif[] {
  const base = fact.data.baseFen;
  const pos = base ? parsePosition(base) : null;
  if (!base || !pos) return [];
  const first = pos.turn;
  const ucis: string[] = [];
  for (const san of fact.data.line ?? []) {
    const move = anyToMove(pos, san);
    if (!move) break;
    ucis.push(describeMove(pos, move).uci);
    pos.play(move);
  }
  return ucis.length ? motifsOf(base, ucis, first) : [];
}

/** The same move, however it was typed: "Qh7", "Qh7?", "qh7+". */
const sameMoveText = (a: unknown, b: string) => typeof a === 'string' && a.replace(/[+#!?\s]/g, '').toLowerCase() === b.replace(/[+#!?\s]/g, '').toLowerCase();

/**
 * A move written bare is made a token when the board can check it: it is a legal move on a board
 * in front of the owner, or the same message already writes it as a token ("Nf6 loses to … after
 * {m:Nf6@F1}"). The token then goes through every rule a typed token does, so nothing is let
 * through unchecked; only the bounce for the missing braces is saved. A bare move the board cannot
 * place is left alone, and rule R1 refuses it.
 */
export function softenMoves(text: string, isLegal: (move: string) => boolean = () => false): string {
  const byBody = new Map<string, string>();
  for (const m of text.matchAll(TOKEN_RE)) if (m[1] === 'm') byBody.set((m[2] ?? '').trim().replace(/[+#!?]/g, ''), m[0]);
  const fix = (plain: string) =>
    plain
      .replace(/\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][18]=[QRBN]|O-O-O|O-O)[+#]?/g, (all: string) => byBody.get(all.replace(/[+#!?]/g, '')) ?? (isLegal(all) ? `{m:${all}}` : all))
      // what softenSquares left bare is a pawn move after a word like "play": a token when a pawn can go there
      .replace(/\b[a-h][1-8]\b(?![+#=-])/g, (all: string) => byBody.get(all) ?? (isLegal(all) ? `{m:${all}}` : all));
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    out += fix(text.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + fix(text.slice(last));
}

/** The part of a sentence around position i, cut at commas, colons and "but / so / because". */
function clauseAround(sentence: string, i: number): string {
  const cut = /[,;:]|\b(?:but|so|because|while|although|and then)\b/gi;
  let start = 0;
  let end = sentence.length;
  for (const m of sentence.matchAll(cut)) {
    if (m.index! < i) start = m.index! + m[0].length;
    else {
      end = m.index!;
      break;
    }
  }
  return sentence.slice(start, end);
}

export function splitSentences(text: string): string[] {
  const masked = text.replace(TOKEN_RE, (m) => m.replace(/[.!?]/g, '_'));
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]+(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const end = m.index + m[0].length;
    const s = text.slice(start, end).trim();
    if (s) out.push(s);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

const stripTokens = (text: string) => text.replace(TOKEN_RE, ' ⟦⟧ ');

function positionsAlong(fact: Fact): string[] {
  const base = fact.data.baseFen;
  if (!base) return [];
  const pos = parsePosition(base);
  if (!pos) return [];
  const fens = [base];
  for (const san of fact.data.line ?? []) {
    const move = anyToMove(pos, san);
    if (!move) break;
    const info = describeMove(pos, move);
    pos.play(move);
    fens.push(info.fenAfter);
  }
  return fens;
}

/** Check one coach message. `claims` are the fact ids the coach says back its statements. */
export function validateSay(msg: { kind: SayKind; text: string; claims?: string[] }, ctx: ValidatorContext): Verdict {
  const problems: Problem[] = [];
  const tokens: ResolvedToken[] = [];
  const segments: Segment[] = [];
  // a bare square after a preposition ("pawn on e4", "went to f7") can only be a square: make it a token
  // rather than bounce the message. Loose moves are still rejected: they need the board's word.
  const pos = mustPosition(ctx.fen);
  const boards = [pos, ...(ctx.alsoFens ?? []).map((f) => parsePosition(f)).filter((x): x is NonNullable<typeof x> => !!x)];
  const boardFens = [ctx.fen, ...(ctx.alsoFens ?? [])];
  // a general message may not point at the board at all, so nothing in it is turned into a token
  const add = (rule: Rule, message: string) => problems.push({ rule, message });

  // R8 fresh
  if (ctx.seq !== undefined && ctx.currentSeq !== undefined && ctx.seq !== ctx.currentSeq) {
    add('R8', `stale: this answers board seq ${ctx.seq} but the board is at seq ${ctx.currentSeq}. Drop this reply.`);
  }

  const cited: Fact[] = [];
  for (const id of msg.claims ?? []) {
    const fact = ctx.fact(id);
    if (!fact) add('R3', `claims lists ${id}, but there is no such fact.`);
    else cited.push(fact);
  }
  // moves check_move found to be not legal: the coach may name them (it has to, to answer), and they stay plain text
  const notLegal = cited.filter((f) => f.type === 'illegal');
  // a move written bare is a token when a board in front of the owner, or the line of a cited fact, can place it.
  // A general message may not point at the board at all, so nothing in it is turned into a move
  const citedBoards = cited.flatMap((f) => positionsAlong(f)).map((f) => parsePosition(f)).filter((x): x is NonNullable<typeof x> => !!x);
  const placeable = (move: string) => !notLegal.some((f) => sameMoveText(f.data.move, move)) && ([...boards, ...citedBoards].some((b) => !!sanToMove(b, move)) || (!!ctx.lastMove && sameMoveText(ctx.lastMove.san, move)));
  const text = msg.kind === 'general' ? softenSquares(msg.text ?? '') : softenMoves(softenSquares(msg.text ?? ''), placeable);

  // the move that led here, as a token of its own
  const lastMoveToken = (raw: string, body: string): Extract<ResolvedToken, { kind: 'move' }> | null => {
    const lm = ctx.lastMove;
    if (!lm || !sameMoveText(lm.san, body)) return null;
    const p = parsePosition(lm.baseFen);
    const move = p ? anyToMove(p, lm.san) : null;
    if (!p || !move) return null;
    const info = describeMove(p, move);
    return { kind: 'move', raw, san: info.san, baseFen: lm.baseFen, fenAfter: info.fenAfter, from: info.from, to: info.to };
  };

  // ---- tokens (R2)
  let last = 0;
  const tokenSquares = new Set<string>();
  const tokenMoves = new Set<string>();
  const moveByRaw = new Map<string, string>(); // raw token → SAN as the board writes it
  const baseByRaw = new Map<string, string>(); // raw token → the position the move is played from
  const norm = (san: string) => san.replace(/[+#!?]/g, '');
  for (const m of text.matchAll(TOKEN_RE)) {
    const [raw, type, bodyRaw, ref] = m;
    const body = (bodyRaw ?? '').trim();
    if (m.index! > last) segments.push({ type: 'text', text: text.slice(last, m.index) });
    last = m.index! + raw.length;
    let resolved: ResolvedToken | null = null;
    if (type === 'sq') {
      if (/^[a-h][1-8]$/.test(body)) {
        resolved = { kind: 'square', raw, square: body };
        tokenSquares.add(body);
      } else add('R2', `${raw}: "${body}" is not a square.`);
    } else if (type === 'pc') {
      const mm = /^([KQRBNP])?([a-h][1-8])$/.exec(body);
      if (!mm) add('R2', `${raw}: write a piece as its letter and square, like {pc:Nf3} or {pc:Pe4}.`);
      else {
        const role = LETTER_ROLE[mm[1] ?? 'P']!;
        const sqn = parseSquare(mm[2]!)!;
        const hit = boards.map((b) => b.board.get(sqn)).find((x) => x?.role === role);
        const piece = hit ?? pos.board.get(sqn);
        if (!piece) add('R2', `${raw}: there is no piece on ${mm[2]}.`);
        else if (piece.role !== role) add('R2', `${raw}: the piece on ${mm[2]} is a ${piece.role}, not a ${role}.`);
        else {
          resolved = { kind: 'piece', raw, square: mm[2]!, role, color: piece.color };
          tokenSquares.add(mm[2]!);
        }
      }
    } else if (type === 'm' && notLegal.some((f) => sameMoveText(f.data.move, body))) {
      // the move the owner asked about, which cannot be played: named in words, never a clickable move
      segments.push({ type: 'text', text: body });
      continue;
    } else if (type === 'm') {
      if (ref) {
        const fact = ctx.fact(ref.trim());
        if (!fact) add('R2', `${raw}: there is no fact with id ${ref}.`);
        else {
          const fens = positionsAlong(fact);
          let found = false;
          for (const f of fens) {
            const p = parsePosition(f);
            const move = p ? anyToMove(p, body) : null;
            if (p && move) {
              const info = describeMove(p, move);
              resolved = { kind: 'move', raw, san: info.san, baseFen: f, fenAfter: info.fenAfter, from: info.from, to: info.to, factId: fact.id };
              tokenMoves.add(norm(info.san));
              moveByRaw.set(raw, info.san);
              baseByRaw.set(raw, f);
              found = true;
              break;
            }
          }
          const led = found ? null : lastMoveToken(raw, body);
          if (led) {
            resolved = led;
            tokenMoves.add(norm(led.san));
            moveByRaw.set(raw, led.san);
            baseByRaw.set(raw, led.baseFen);
          } else if (!found) add('R2', `${raw}: ${body} is not a legal move anywhere in fact ${ref}'s line.`);
        }
      } else {
        let done = false;
        for (let bi = 0; bi < boards.length && !done; bi++) {
          const move = anyToMove(boards[bi]!, body);
          if (!move) continue;
          const info = describeMove(boards[bi]!, move);
          resolved = { kind: 'move', raw, san: info.san, baseFen: boardFens[bi]!, fenAfter: info.fenAfter, from: info.from, to: info.to };
          tokenMoves.add(norm(info.san));
          moveByRaw.set(raw, info.san);
          baseByRaw.set(raw, boardFens[bi]!);
          done = true;
        }
        // not on a board: is it a move inside one of the cited facts' lines?
        for (const fact of done ? [] : cited) {
          for (const f of positionsAlong(fact)) {
            const p2 = parsePosition(f);
            const move = p2 ? anyToMove(p2, body) : null;
            if (!p2 || !move) continue;
            const info = describeMove(p2, move);
            resolved = { kind: 'move', raw, san: info.san, baseFen: f, fenAfter: info.fenAfter, from: info.from, to: info.to, factId: fact.id };
            tokenMoves.add(norm(info.san));
            moveByRaw.set(raw, info.san);
            baseByRaw.set(raw, f);
            done = true;
            break;
          }
          if (done) break;
        }
        const led = done ? null : lastMoveToken(raw, body);
        if (led) {
          resolved = led;
          tokenMoves.add(norm(led.san));
          moveByRaw.set(raw, led.san);
          baseByRaw.set(raw, led.baseFen);
          done = true;
        }
        if (!done) add('R2', `${raw}: ${body} is not a legal move on the board, and it is not in the line of any fact you cited. For a move inside a fact's line, cite that fact or write {m:${body}@<fact id>}.`);
      }
    }
    if (resolved) {
      tokens.push(resolved);
      segments.push({ type: 'token', token: resolved });
    } else segments.push({ type: 'text', text: raw });
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });

  if (msg.kind === 'general') {
    if (tokens.length) add('R2', 'A "general" message is chess knowledge that is not about this position, so it cannot point at moves, squares or pieces. To talk about the board, use kind "explain" with facts.');
    const hit = ABOUT_THE_BOARD.exec(stripTokens(text));
    if (hit) add('R3', `"${hit[0].trim()}": a "general" message must not say anything about the position on the board. Say that part in a separate "explain" message backed by facts, or leave it out.`);
  }

  // malformed braces
  const leftover = text.replace(TOKEN_RE, '');
  if (/[{}]/.test(leftover)) add('R2', 'There is a broken token. Tokens look like {m:Nf3}, {sq:e4} or {pc:Nf3}.');

  // ---- R1 loose notation
  const bare = stripTokens(text);
  const looseSeen = new Set<string>();
  for (const { re, what } of LOOSE) {
    for (const m of bare.matchAll(re)) {
      if (looseSeen.has(m[0])) continue;
      looseSeen.add(m[0]);
      if (what !== 'a square' && notLegal.some((f) => sameMoveText(f.data.move, m[0]))) continue;
      add('R1', `"${m[0]}" looks like ${what} written outside a token. Write it as ${what === 'a square' ? `{sq:${m[0]}}` : `{m:${m[0]}}`}.`);
    }
  }

  // ---- R2b: words that name a piece next to a token must match the board
  const pieceOnSquare = /\b(?:(your|their|my|white'?s|black'?s|the|a|an)\s+)?(king|queen|rook|bishop|knight|pawn)s?\s+(?:(?:on|at)\s+)?\{(sq|pc):([KQRBNP]?)([a-h][1-8])\}/gi;
  for (const m of text.matchAll(pieceOnSquare)) {
    const [, ownerWord, roleWord, , , square] = m;
    const role = ROLE_WORDS[roleWord!.toLowerCase()]!;
    const w = ownerWord?.toLowerCase().replace("'", '');
    const said: Color | null = w === 'your' || w === 'my' ? ctx.you : w === 'their' ? (ctx.you === 'white' ? 'black' : 'white') : w === 'whites' ? 'white' : w === 'blacks' ? 'black' : null;
    const sqn = parseSquare(square!)!;
    // true on any board in front of the owner is enough
    if (boards.some((b) => { const x = b.board.get(sqn); return !!x && x.role === role && (!said || x.color === said); })) continue;
    const piece = pos.board.get(sqn);
    if (!piece) {
      add('R2', `There is no ${role} on ${square}: that square is empty.`);
      continue;
    }
    if (piece.role !== role) add('R2', `The piece on ${square} is a ${piece.role}, not a ${role}.`);
    else if (said && piece.color !== said) add('R2', `The ${piece.role} on ${square} is ${piece.color === ctx.you ? "the owner's (yours)" : "the opponent's (theirs)"}, not ${ownerWord}.`);
  }

  // ---- R2: "moves to {sq:e4}" names a destination: some piece must be able to go there
  // "cannot go to {sq:h7}" says the opposite, and "just moved to {sq:d4}" is about a piece that already stands there
  const goesTo = /\b(?:to|onto|into)\s+\{sq:([a-h][1-8])\}/gi;
  const ARRIVED = /\b(?:moved|went|came|gone|come|stepped|retreated|jumped|dropped|landed|arrived|got|returned|been)\s+(?:back\s+|over\s+|down\s+|up\s+)?$/i;
  let reachable: Set<string> | null = null;
  for (const m of text.matchAll(goesTo)) {
    const before = text.slice(0, m.index!);
    const sentenceStart = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! ')) + 1;
    const sentence = text.slice(sentenceStart, m.index! + m[0].length);
    if (NEGATION.test(stripTokens(clauseAround(sentence, sentence.length - m[0].length))) || /\b(?:not possible|impossible)\b/i.test(text.slice(m.index!, m.index! + m[0].length + 40))) continue;
    if (ARRIVED.test(before)) {
      const sqn = parseSquare(m[1]!)!;
      if (!boards.some((b) => b.board.get(sqn))) add('R2', `Nothing stands on ${m[1]}, so no piece has just moved there.`);
      continue;
    }
    if (!reachable) {
      reachable = new Set<string>();
      for (const fen of boardFens) {
        for (const f of [fen, passPosition(fen)]) {
          const b = f ? parsePosition(f) : null;
          if (b) for (const mv of legalMoves(b)) reachable.add(mv.to);
        }
      }
    }
    if (!reachable.has(m[1]!)) add('R2', `No piece can move to ${m[1]} in the position on the board.`);
  }

  // ---- R2c: "{pc:A} attacks / defends {pc:B}" must be true on the board
  const relation = /\{pc:[KQRBNP]?([a-h][1-8])\}\s+(?:is\s+|now\s+|also\s+|still\s+)*(attack(?:s|ing)?|hit(?:s|ting)?|eye(?:s|ing)?|target(?:s|ing)?|threaten(?:s|ing)?|defend(?:s|ing)?|protect(?:s|ing)?|guard(?:s|ing)?|cover(?:s|ing)?)\s+(?:(?:your|their|the|a|an|my)\s+)?(?:(?:king|queen|rook|bishop|knight|pawn|piece|square)\s+)?(?:(?:on|at)\s+)?\{(?:sq|pc):[KQRBNP]?([a-h][1-8])\}/gi;
  for (const m of text.matchAll(relation)) {
    const [, from, verb, to] = m;
    const a = boards.map((b) => b.board.get(parseSquare(from!)!)).find(Boolean);
    if (!a) continue; // already reported
    if (!boards.some((b) => attacksSquare(b, parseSquare(from!)!, parseSquare(to!)!))) {
      add('R2', `The ${a.role} on ${from} does not ${/^(defend|protect|guard|cover)/i.test(verb!) ? 'defend' : 'attack'} ${to}.`);
    }
  }

  // ---- R3 claims
  const sentences = splitSentences(text);
  // every move any cited fact is about
  const citedMoves = new Set<string>();
  for (const f of cited) {
    for (const mv of f.data.line ?? []) citedMoves.add(norm(mv));
    if (typeof f.data.move === 'string') citedMoves.add(norm(f.data.move));
    for (const mv of (f.data.moves as string[] | undefined) ?? []) citedMoves.add(norm(mv));
  }
  // which way do the message's material claims point for the owner?
  let saysGood = false;
  let saysBad = false;
  let saysMate = false;
  for (const sentence of sentences) {
    const plain = stripTokens(sentence);
    const asks = /\?\s*$/.test(sentence);
    const isQuestion = asks && GENUINE_QUESTION.test(plain.trim()) && !PRESUPPOSES.test(plain);
    // the tokens of this sentence
    const sentMoves: string[] = [];
    const sentSquares = new Set<string>();
    for (const m of sentence.matchAll(TOKEN_RE)) {
      const san = moveByRaw.get(m[0]);
      if (san) sentMoves.push(san);
      const sq = /^[KQRBNP]?([a-h][1-8])$/.exec((m[2] ?? '').trim());
      if (m[1] !== 'm' && sq) sentSquares.add(sq[1]!);
    }
    if (!isQuestion && msg.kind !== 'general') {
      let claimed = false;
      const reported = REPORTED_QUESTION.exec(plain);
      for (const claim of CLAIMS) {
        const hit = claim.re.exec(plain);
        if (!hit) continue;
        // inside a reported question the word asks; it does not claim
        if (reported && hit.index > reported.index) continue;
        // "your checks, captures and threats" names the routine's steps
        if (claim.id === 'threat') {
          const routine = ROUTINE_PHRASE.exec(plain);
          if (routine && hit.index >= routine.index && hit.index < routine.index + routine[0].length) continue;
        }
        claimed = true;
        // "nothing is hanging", "there is no threat": a statement that something is absent can only
        // be backed by a quiet fact, and a quiet fact backs nothing else
        // (judged inside the clause, with every phrase of the claim itself taken out first: "no defender"
        // is not a negation of "hanging", and "had no defender, so it was en prise" is not one either)
        if (MOTIF_CLAIMS.has(claim.id) && sentMoves.length === 0 && sentSquares.size === 0 && GENERAL_SUBJECT.test(plain.trim()) && !POSITION_WORD.test(plain)) continue;
        const clause = clauseAround(plain, hit.index);
        const negated = (claim.id === 'hanging' || claim.id === 'threat') && NEGATION.test(clause.replace(new RegExp(claim.re.source, 'gi'), ' ')) && !(claim.id === 'threat' && NOT_DEALT_WITH.test(clause));
        const motif = LINE_MOTIF[claim.id];
        // a move that passed a mate over backs "missed a mate" whatever its type (its words may call it safe: "loses nothing, but you miss …")
        const missedMate = claim.id === 'mate' && MISSED_WORDS.test(plain) ? cited.filter((f) => f.data.missedMate !== undefined && !claim.types.includes(f.type)) : [];
        const backing = negated ? cited.filter((f) => f.type === 'quiet') : motif ? cited.filter((f) => factMotifs(f).some((x) => motif.includes(x))) : [...cited.filter((f) => claim.types.includes(f.type)), ...missedMate];
        if (!backing.length) {
          add('R3', negated ? `"${hit[0].trim()}": saying that nothing is hanging or threatened needs a quiet fact in claims. If the facts have none, do not say it.` : `"${hit[0].trim()}": ${claim.hint}. Put the fact's id in claims, or take the claim out.`);
          continue;
        }
        if (negated) continue;
        const problem = checkBacking(claim.id, hit, plain, backing, sentSquares.size ? sentSquares : tokenSquares, new Set(sentMoves.map(norm)), ctx, sentSquares.size > 0);
        if (problem) add('R3', problem);
        if (claim.id === 'mate') saysMate = true;
        if (claim.id === 'wins' || claim.id === 'loses') {
          for (const gain of [...ownerGainsIn(plain), ...moveGainsIn(sentence, baseByRaw, ctx.you)]) {
            if (gain) saysGood = true;
            else saysBad = true;
          }
        }
      }
      // a move named in a sentence that makes a claim must be a move some cited fact is about
      if (claimed) {
        for (const san of sentMoves) {
          if (!citedMoves.has(norm(san))) {
            add('R3', `{m:${san}} is named in a sentence that makes a claim, but no cited fact is about that move. Check it with check_move and cite that fact, or ask about the move in a separate question.`);
          }
        }
      }
      // a reason stated for a move ("{m:X} protects the knight") must be one the board or a cited fact confirms
      for (const m of sentence.matchAll(REASON_RE)) {
        const san = moveByRaw.get(m[1]!);
        const base = baseByRaw.get(m[1]!);
        if (!san || !base) continue; // the token itself was already refused
        const wanted = REASON_TAGS.find((r) => r.re.test(m[2]!))?.tags ?? [];
        const confirmed = new Set<string>(moveReasons(base, san, ctx.you).map((r) => r.tag));
        for (const f of cited) {
          if (typeof f.data.move === 'string' && norm(f.data.move) === norm(san) && Array.isArray(f.data.reasons)) for (const t of f.data.reasons as string[]) confirmed.add(t);
        }
        if (!wanted.some((t) => confirmed.has(t))) {
          add('R3', `"${san} ${m[2]}…": the board does not confirm that reason for ${san}. ${confirmed.size ? `What is confirmed for it: ${[...confirmed].join(', ').replace(/_/g, ' ')}.` : 'Nothing of that kind is confirmed for it.'} Give only the reasons in the fact's "Why", or check the move with check_move and cite it.`);
        }
      }
      // "{m:X} gives check" must be a checking move
      // ("without giving check", "not giving check", "with no check" say the opposite: the way a stalemate is described)
      const saysCheck = /\b(?<!(?:without|not|never|no) )(?:gives?|giving|with|delivers?) (?:a )?check\b/i.test(plain.replace(/\b(?:without|not|never)\s+(?:giving|gives?|delivering|delivers?)\s+(?:a\s+)?check\b|\bwith\s+no\s+check\b/gi, ''));
      if (!asks && sentMoves.length && saysCheck && !sentMoves.some((san) => /[+#]$/.test(san))) {
        add('R3', 'The sentence says a move gives check, but no move in it is a check.');
      }
    }
    // "not in check", "wasn't in check", "is no longer in check", "never in check" say nobody is (how a stalemate is described)
    const notInCheck = /(?:\bnot|n't|\bnever|\bno longer)\s+(?:\w+\s+)?in check\b/i;
    if (/\bin check\b/i.test(plain) && !notInCheck.test(plain) && !asks) {
      if (!pos.isCheck() && !cited.some((f) => f.type === 'check')) add('R3', 'The message says someone is in check, but nobody is in check on the board.');
    }
  }

  // ---- R3: the conclusion must not contradict the facts' verdict. "You lose your queen" drawn from a
  // line that only happens when the opponent blunders (and is in fact good for the owner) is refused.
  const verdicts = cited.map((f) => f.data.verdictForYou).filter((v): v is 'good' | 'bad' => v === 'good' || v === 'bad');
  if (verdicts.length && !saysMate) {
    const allGood = verdicts.every((v) => v === 'good');
    const allBad = verdicts.every((v) => v === 'bad');
    // The best move in a bad spot can still cost something ("the strongest move, and you lose a pawn"),
    // and a mistake can still pick something up. A cited fact that itself states that change in
    // material backs the sentence; a line that ends in mate does not (the material in it is beside the point).
    const ownerDelta = (f: Fact): number => {
      const delta = f.data.delta;
      if (typeof delta !== 'number' || f.data.mateIn !== undefined) return 0;
      const side = f.data.side;
      return side === ctx.you || side === undefined ? delta : side === 'white' || side === 'black' ? -delta : 0;
    };
    const factSaysLoss = cited.some((f) => ownerDelta(f) < 0);
    const factSaysGain = cited.some((f) => ownerDelta(f) > 0);
    if (allGood && saysBad && !saysGood && !factSaysLoss) add('R3', 'Your message says the owner loses material, but the facts you cite are good news for the owner (the line only happens if the opponent slips, or the move is a good one). Use check_move on the move and say what it really does.');
    if (allBad && saysGood && !saysBad && !factSaysGain) add('R3', 'Your message says the owner wins material, but the facts you cite say the move or line is bad for the owner. Say what it really loses.');
  }

  // ---- R4 numbers
  if (!ctx.numbersOn) {
    for (const re of NUMBERS) {
      const hit = re.exec(bare);
      if (hit) {
        add('R4', `"${hit[0].trim()}" is an engine number or score. Say what happens in plain words instead ("you lose a knight").`);
        break;
      }
    }
  }

  // ---- R5 vocabulary
  const vocab = ctx.vocabulary ?? 'core';
  for (const { concept, patterns } of ctx.ladder?.deferredAt(vocab) ?? []) {
    for (const re of patterns) {
      const hit = re.exec(bare);
      // the owner asked about it by name: then it may be explained
      if (!hit || (ctx.ownerText && patterns.some((p) => p.test(ctx.ownerText!)))) continue;
      add('R5', `"${hit[0]}" is a concept kept for later at the owner's level. Say it in plain words instead: ${concept.plain ?? 'explain it simply'}.`);
      break;
    }
  }

  // ---- R6 length
  if (sentences.length > ctx.budgetSentences) {
    add('R6', `Too long: ${sentences.length} sentences, the limit for this message is ${ctx.budgetSentences}. Keep one point.`);
  }
  if (!text.trim()) add('R6', 'The message is empty.');

  // ---- R7 ask before telling
  if (msg.kind === 'answer' && ctx.canAnswer === false) {
    add('R7', 'Ask before telling: the owner has not tried yet. Use kind "question" or "nudge" first.');
  }

  const plain = segments
    .map((seg, i) => {
      if (seg.type === 'text') return seg.text;
      if (seg.token.kind === 'move') return seg.token.san;
      if (seg.token.kind === 'square') return seg.token.square;
      const before = i > 0 && segments[i - 1]!.type === 'text' ? (segments[i - 1] as { text: string }).text : '';
      // "your knight {pc:Ne5}" reads "your knight on e5"; "your knight on {pc:Ne5}" reads "your knight on e5" too
      const tail = before.trimEnd().toLowerCase();
      if (tail.endsWith(`${seg.token.role} on`) || tail.endsWith(`${seg.token.role} at`)) return seg.token.square;
      return tail.endsWith(seg.token.role) ? `on ${seg.token.square}` : `${seg.token.role} on ${seg.token.square}`;
    })
    .join('');
  return { ok: problems.length === 0, problems, tokens, segments, sentences: sentences.length, plain };
}

/**
 * For each material claim in a sentence: does the owner come out ahead (true) or behind (false)?
 * Read from the subject ("you win", "they lose") or from whose piece it is ("wins your queen").
 */
const WIN_VERB = '(?:win|wins|winning|won|gain|gains|pick(?:s)? up|grab(?:s)?|take(?:s)?|capture(?:s)?)';
const LOSE_VERB = '(?:lose|loses|losing|lost|drop|drops|dropped|blunder(?:s|ed)?|give(?:s)? (?:up|away)|gave (?:up|away)|cost(?:s)?)';
const VERB_HELPER = "(?:'ll| will| would| can| could| just| also| then| simply| may| might| do| does| did)*";

/**
 * "{m:Nf6} won a queen", "{m:Bxe6} loses a piece": the move is the subject, so the gain or loss
 * belongs to whoever plays it. Good for the owner when the owner's move wins or the other side's loses.
 */
function moveGainsIn(sentence: string, baseByRaw: Map<string, string>, you: Color): boolean[] {
  const out: boolean[] = [];
  for (const m of sentence.matchAll(new RegExp(`(\\{m:[^}]+\\})${VERB_HELPER}\\s+(${WIN_VERB}|${LOSE_VERB})\\b`, 'gi'))) {
    const base = baseByRaw.get(m[1]!);
    const mover = base ? parsePosition(base)?.turn : undefined;
    if (!mover) continue;
    const isWin = new RegExp(`^${WIN_VERB}$`, 'i').test(m[2]!);
    out.push((mover === you) === isWin);
  }
  return out;
}

function ownerGainsIn(sentence: string): boolean[] {
  const out: boolean[] = [];
  const win = WIN_VERB;
  const lose = LOSE_VERB;
  const helper = VERB_HELPER;
  for (const m of sentence.matchAll(new RegExp(`\\b(you|they)${helper}\\s+(${win}|${lose})\\b`, 'gi'))) {
    const isWin = new RegExp(`^${win}$`, 'i').test(m[2]!);
    out.push((m[1]!.toLowerCase() === 'you') === isWin);
  }
  for (const m of sentence.matchAll(new RegExp(`\\b(${win}|${lose})\\s+(your|their)\\b`, 'gi'))) {
    // "wins your queen" / "lose your queen": bad for the owner. "wins their queen" / "lose their queen": good.
    out.push(m[2]!.toLowerCase() === 'their');
  }
  return out;
}

/** Finer checks that the cited facts really say what the sentence says. */
function checkBacking(
  claimId: string,
  hit: RegExpExecArray,
  sentence: string,
  backing: Fact[],
  squares: Set<string>,
  moves: Set<string>,
  ctx: ValidatorContext,
  /** the squares are the sentence's own (false: borrowed from the rest of the message, because the sentence names none) */
  ownSquares = true,
): string | null {
  const norm = (san: string) => san.replace(/[+#!?]/g, '');

  // a named piece in a wins / loses claim must appear in a cited fact
  if (claimId === 'wins' || claimId === 'loses') {
    const role = (hit[1] ?? '').toLowerCase();
    if (role && role !== 'material') {
      const names = role === 'piece' ? ['knight', 'bishop', 'piece'] : role === 'exchange' ? ['exchange', 'rook'] : [role];
      if (!backing.some((f) => names.some((nm) => f.text.toLowerCase().includes(nm)))) {
        return `"${hit[0].trim()}": none of the cited facts mentions a ${role}.`;
      }
    }
    // who gains must match
    const subj = /\b(you|they)(?:'ll| will| would| can| could| just| also| then)?\s+(win|lose|drop|gain|pick|grab)/i.exec(sentence);
    if (subj) {
      const ownerGains = (subj[1]!.toLowerCase() === 'you') === /^(win|gain|pick|grab)/i.test(subj[2]!);
      const signed = backing.filter((f) => typeof f.data.delta === 'number' && (f.data.delta as number) !== 0 && f.data.side);
      // a fact says the owner gains when it is about the owner's side and a gain, or the other side and a loss
      const factSaysOwnerGains = (f: (typeof signed)[number]) => ((f.data.side as Color) === ctx.you) === ((f.data.delta as number) > 0);
      if (signed.length && !signed.some((f) => factSaysOwnerGains(f) === ownerGains)) {
        return `"${hit[0].trim()}": the cited fact says the opposite side comes out ahead.`;
      }
    }
  }

  // mate in N must match
  if (claimId === 'mate') {
    // "mate in 2", "mates in 2", "mated in 2": each is a count to check
    const n = /mate(?:s|d)? in (\d+|one|two|three|four|five|six|seven|eight)/i.exec(sentence);
    if (n) {
      const want = NUMBER_WORDS[n[1]!.toLowerCase()] ?? Number(n[1]);
      // a mate passed over counts only for a sentence about missing it: "misses a mate in 2", never "mates in 2"
      const missed = MISSED_WORDS.test(sentence) ? backing.map((f) => Number(f.data.missedMate)) : [];
      const mates = [...backing.map((f) => Math.abs(Number(f.data.mateIn))), ...missed].filter((x) => Number.isFinite(x) && x > 0);
      if (!mates.includes(want)) return `"${n[0]}": the cited facts do not show a mate in ${want}.`;
    } else if (!backing.some((f) => f.data.mateIn !== undefined || f.type === 'game_over' || /checkmate/i.test(f.text))) {
      return `"${hit[0].trim()}": none of the cited facts is about checkmate.`;
    }
  }

  // hanging / pin: the piece in the message must be the piece in the fact
  if (claimId === 'hanging' || claimId === 'pin') {
    const keys = claimId === 'pin' ? ['pinned', 'by', 'behind'] : ['piece'];
    const about = backing.flatMap((f) => keys.map((key) => (f.data[key] as { square?: string } | undefined)?.square)).filter(Boolean) as string[];
    // a sentence with no square of its own ("…attacked your knight, and nothing defends it") is about the fact's piece when it names that kind of piece
    const named = !ownSquares && backing.some((f) => keys.some((key) => { const role = (f.data[key] as { role?: string } | undefined)?.role; return !!role && new RegExp(`\\b${role}\\b`, 'i').test(sentence); }));
    if (about.length && squares.size && !named && !about.some((sq) => squares.has(sq))) {
      return `"${hit[0].trim()}": the cited fact is about the piece on ${about.join(' / ')}, not the piece in your message.`;
    }
  }

  // "safe" said about a piece (backed only by attack facts) must be about that piece
  if (claimId === 'safe' && backing.every((f) => f.type === 'attack')) {
    const about = backing.map((f) => (f.data.piece as { square?: string } | undefined)?.square).filter(Boolean) as string[];
    if (!about.some((sq) => squares.has(sq))) return `"${hit[0].trim()}": the cited fact is about the piece on ${about.join(' / ')}, not what your message calls safe.`;
  }

  // "up a queen" must name the piece the fact names
  if (claimId === 'balance') {
    const role = /\b(?:up|down) (?:a|an|two|three) (?:whole |full )?(queen|rook|bishop|knight|pawn|piece|exchange)/i.exec(sentence)?.[1]?.toLowerCase();
    if (role) {
      const names = role === 'piece' ? ['knight', 'bishop', 'piece'] : role === 'exchange' ? ['exchange', 'rook'] : [role];
      if (!backing.some((f) => names.some((nm) => f.text.toLowerCase().includes(nm)))) return `"${hit[0].trim()}": none of the cited facts mentions a ${role}.`;
    }
  }

  // "best" / "only" must be the move the fact itself names first, not just a move somewhere in its line
  if ((claimId === 'best' || claimId === 'only') && moves.size) {
    const firsts = new Set(backing.map((f) => (typeof f.data.move === 'string' ? norm(f.data.move) : '')).filter(Boolean));
    if (firsts.size && ![...moves].some((mv) => firsts.has(mv))) {
      return `"${hit[0].trim()}": the cited fact names a different move as the strongest.`;
    }
  }
  return null;
}

/** Tokens → plain text (for logs and for the scripted fallback's console output). */
export function plainText(text: string): string {
  return text.replace(TOKEN_RE, (_m, type: string, body: string) => {
    if (type === 'pc') {
      const mm = /^([KQRBNP])?([a-h][1-8])$/.exec(body.trim());
      return mm ? `${LETTER_ROLE[mm[1] ?? 'P']} on ${mm[2]}` : body;
    }
    return body.trim();
  });
}
