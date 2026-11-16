// Builds fact packets with the engine (ARCHITECTURE §7) and remembers every fact it has handed
// out, so the validator can look up whatever the coach cites.
//
// The owner's rule (decision D33): every move, line and verdict comes from the engine; the model
// only explains. So this service, not the coach, picks the moves of every line that is shown.

import {
  anyToMove,
  balanceInWords,
  buildFactPacket,
  capturables,
  describeMove,
  dropOf,
  fenOf,
  flipScore,
  gaugeOf,
  labelMove,
  materialChangeInWords,
  moveFacts,
  moveReasons,
  mustPosition,
  parsePosition,
  passPosition,
  plainText,
  positionKey,
  pvToSan,
  settle,
  threatWords,
  tok,
  uciToMove,
  findableMove,
  findableByPeople,
  whyIllegal,
  DEFAULT_THRESHOLDS,
  type BestArrow,
  type Color,
  type EngineEval,
  type EngineLine,
  type Fact,
  type FactInput,
  type FactPacket,
  type Findable,
  type Gauge,
  type GradeResult,
  type Judged,
  type Thresholds,
  type ThreatResult,
} from '@chess-coach/core';
import type { EngineService, PoolName } from './engine/service.ts';
import type { CloudSource } from './lichess.ts';
import type { Opening } from './openings.ts';

/** Which analysis a verdict rests on, in words the page can show. */
export type VerdictSource = { by: 'lichess' | 'local'; depth?: number; agrees?: boolean; text: string };

export type PacketRequest = {
  fen: string;
  you: Color;
  lastMove?: { san: string; by: 'owner' | 'opponent' | 'coach'; fenBefore: string };
  opening?: Opening;
  /** the deeper search, for positions the coach is about to talk about */
  deep?: boolean;
};

export type CheckMoveResult =
  | { legal: false; reason: string; legalMoves: string[]; factId?: string }
  | { legal: true; san: string; verdict: string; class: string; facts: Fact[]; factId: string; bestFactId?: string; grade: GradeResult; findable?: Findable };

export type LineRequest = {
  baseFen: string;
  you: Color;
  /** best = the engine's best play from here; move = one given move, then the engine's best play; threat = what the other side does with a free move */
  what: 'best' | 'move' | 'threat';
  move?: string;
  maxPlies: number;
};

export type LineResult =
  | { ok: false; reason: string; facts?: Fact[] }
  | {
      ok: true;
      id: string;
      baseFen: string;
      moves: string[];
      fens: string[];
      /** per move: was it a mistake for the side that played it? Only a move the engine did not choose can be. */
      marks: ('' | '?' | '??')[];
      facts: Fact[];
      /** what the tool tells the coach */
      summary: string;
      /** the engine's verdict in plain words, printed on the page beside the line */
      verdict: string;
      /** which analysis the verdict rests on */
      source: VerdictSource;
      /** the first move's label, from the same analysis as the verdict (none for a threat line) */
      firstJudged?: Judged;
    };

/** What the eval bar and the best-move arrows show for one position. */
export type Look = { gauge: Gauge | null; arrows: BestArrow[]; sure: boolean };

export class FactService {
  private facts = new Map<string, Fact>();
  private counter = 0;
  /** nodes for the quiet background check of every position */
  nodes: number;
  /** nodes for anything the coach states: verdicts on moves and the lines it shows */
  verdictNodes: number;
  thresholds: Thresholds;
  /** check verdicts against Lichess's cloud analysis (a setting, on by default) */
  useCloud = true;
  /** below this depth a Lichess answer is not trusted over the local search */
  minCloudDepth = 22;
  /** a move within this many points of the best one is labelled excellent */
  excellent = 2;
  /** is a position opening theory? (its name, true, or false): set by the app from the openings list */
  book: (fen: string) => string | boolean = () => false;
  /** labels that came out of a verdict the coach was given: the badge on the board must agree with it */
  private byReference = new Map<string, Judged>();
  /** tools: called with exactly what the fact builder is given (the golden files keep it, so the builder can be re-run without an engine) */
  onInput?: (input: FactInput) => void;
  private readonly engine: EngineService;
  private readonly cloud?: CloudSource;

  constructor(engine: EngineService, opts: { nodes?: number; verdictNodes?: number; thresholds?: Thresholds; startAt?: number; cloud?: CloudSource } = {}) {
    this.engine = engine;
    this.cloud = opts.cloud;
    this.nodes = opts.nodes ?? 250_000;
    this.verdictNodes = opts.verdictNodes ?? 1_000_000;
    this.thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
    this.counter = opts.startAt ?? 0;
  }

  /**
   * The analysis a verdict is judged against. The local engine always runs; when Lichess's cloud
   * has the position (deeper, usually depth 30 to 60), its lines are the reference and the local
   * search is the cross-check. Without it, the local search stands alone, and the page says so.
   */
  private async referenceEval(fen: string, multipv: number): Promise<{ ev: EngineEval; source: VerdictSource }> {
    const [local, cloud] = await Promise.all([
      this.evalOf(fen, multipv, this.verdictNodes),
      this.useCloud && this.cloud ? this.cloud.evaluate(fen, multipv).catch(() => null) : Promise.resolve(null),
    ]);
    const localBest = local.lines[0] ? pvToSan(fen, local.lines[0].pv, 1).sans[0] : undefined;
    if (!cloud || cloud.depth < this.minCloudDepth || !cloud.lines.length) {
      const why = !this.useCloud || !this.cloud ? '' : cloud ? ' (Lichess has only a shallow analysis of this position)' : ' (Lichess has no analysis of this position)';
      return { ev: local, source: { by: 'local', text: `Checked by Stockfish on this computer${why}` } };
    }
    const ref: EngineEval = { fen, lines: cloud.lines };
    const lichessBest = pvToSan(fen, cloud.lines[0]!.pv, 1).sans[0];
    // agreement: the local best move is Lichess's best, or one Lichess rates as just as good
    const localFirst = local.lines[0]?.pv[0];
    const inCloud = cloud.lines.find((l) => l.pv[0] === localFirst);
    const agrees = !!localFirst && (localFirst === cloud.lines[0]!.pv[0] || (!!inCloud && dropOf(cloud.lines[0]!.score, inCloud.score) < this.thresholds.inaccuracy));
    const text = agrees
      ? `Checked against Lichess's cloud analysis (depth ${cloud.depth}); Stockfish on this computer agrees`
      : `Checked against Lichess's cloud analysis (depth ${cloud.depth}), which is deeper: it prefers ${lichessBest} to ${localBest ?? 'the local choice'}, so its verdict is used`;
    return { ev: ref, source: { by: 'lichess', depth: cloud.depth, agrees, text } };
  }

  private tag(facts: Fact[], source: VerdictSource) {
    for (const f of facts) f.data.source = source.text;
  }

  private nextPacketId(): string {
    return `P${++this.counter}`;
  }

  private remember(facts: Fact[]) {
    for (const f of facts) this.facts.set(f.id, f);
    while (this.facts.size > 4000) this.facts.delete(this.facts.keys().next().value!);
  }

  fact = (id: string): Fact | undefined => this.facts.get(id.trim());

  /** A model of human play at the owner's level (Maia, WP 7.8): how often people play each move in a position. Null when it is not running. */
  humanProbs?: (fen: string) => Promise<ReadonlyMap<string, number> | null>;

  /**
   * Facts the app knows from checked content rather than from a search (a puzzle's ideas, which went
   * through the content gates): numbered and kept like the engine's, so the coach can cite them.
   */
  addFacts(make: (nextId: () => string) => Fact[]): Fact[] {
    const base = this.nextPacketId();
    let n = 0;
    const facts = make(() => `${base}.F${++n}`);
    this.remember(facts);
    return facts;
  }

  private async evalOf(fen: string, multipv: number, nodes: number, pool: PoolName = 'quick'): Promise<EngineEval> {
    const r = await this.engine.analyse({ fen, nodes, multipv, pool });
    return { fen: r.fen, lines: r.lines, tbhits: r.tbhits };
  }

  /** Forget every label that rests on a verdict (the grading thresholds changed). */
  forgetLabels() {
    this.byReference.clear();
  }

  private rememberLabel(fenBefore: string, san: string, judged: Judged | undefined) {
    if (!judged) return;
    this.byReference.set(`${positionKey(fenBefore)}|${san}`, { ...judged, sure: true });
    while (this.byReference.size > 2000) this.byReference.delete(this.byReference.keys().next().value!);
  }

  private labelFrom(fenBefore: string, san: string, fenAfter: string, evalBefore: EngineEval, playedLine: EngineLine): Judged | undefined {
    return labelMove({ fenBefore, san, evalBefore, playedLine, thresholds: this.thresholds, excellent: this.excellent, book: this.book(fenAfter) })?.judged;
  }

  /** The label a verdict already given to the coach implies for a move, if there is one. */
  knownLabel(fenBefore: string, san: string): Judged | undefined {
    return this.byReference.get(`${positionKey(fenBefore)}|${san}`);
  }

  /** Has the deeper search already looked at this position? Then use it: it is free and it is the better answer. */
  private deepKnown(fen: string): boolean {
    return !!this.engine.cached({ fen, nodes: this.verdictNodes, multipv: 3 });
  }

  /**
   * The eval bar's reading and the engine's first choices for a position (features A6, A16).
   * Quick by default; `deep` uses the budget for anything stated to the owner.
   */
  async look(fen: string, opts: { arrows?: number; deep?: boolean; reference?: boolean; pool?: PoolName } = {}): Promise<Look> {
    const pos = parsePosition(fen);
    if (!pos) return { gauge: null, arrows: [], sure: false };
    if (pos.isEnd()) return { gauge: gaugeOf(fen), arrows: [], sure: true };
    const base = fenOf(pos);
    const deep = !!opts.reference || !!opts.deep || this.deepKnown(base);
    // `reference`: the analysis the coach's verdicts rest on (Lichess's cloud when it has the position)
    const ev = opts.reference ? (await this.referenceEval(base, 3)).ev : await this.evalOf(base, 3, deep ? this.verdictNodes : this.nodes, opts.pool);
    const first = ev.lines[0];
    const arrows: BestArrow[] = [];
    for (const line of ev.lines.slice(0, Math.max(0, opts.arrows ?? 0))) {
      // further arrows only for moves that are about as good as the first
      if (!first || dropOf(first.score, line.score) >= this.thresholds.inaccuracy) continue;
      const move = line.pv[0] ? uciToMove(pos, line.pv[0]) : null;
      if (!move) continue;
      const info = describeMove(pos, move);
      arrows.push({ from: info.from, to: info.to, san: info.san });
    }
    return { gauge: gaugeOf(base, first, ev.tbhits), arrows, sure: deep };
  }

  /**
   * Label one move the way Chess.com names them, from the engine's grading (feature A17, D40).
   * A move the coach has already been given a verdict on keeps the label that verdict implies.
   */
  async judge(fenBefore: string, san: string, opts: { deep?: boolean; reference?: boolean; pool?: PoolName; engineChose?: boolean } = {}): Promise<Judged | null> {
    const pos = parsePosition(fenBefore);
    const move = pos ? anyToMove(pos, san) : null;
    if (!pos || !move) return null;
    const info = describeMove(pos, move);
    const base = fenOf(pos);
    const known = this.byReference.get(`${positionKey(base)}|${info.san}`);
    if (known) return known;
    const book = this.book(info.fenAfter);
    // forced and book moves need no engine
    const plain = labelMove({ fenBefore: base, san: info.san, evalBefore: { fen: base, lines: [] }, playedLine: { pv: [], score: { cp: 0 } }, book });
    if (plain) return { ...plain.judged, sure: true };
    const deep = !!opts.reference || !!opts.deep || this.deepKnown(base);
    const nodes = deep ? this.verdictNodes : this.nodes;
    // `reference`: judged exactly as check_move judges it, so the badge and the coach always agree
    const ev = opts.reference ? (await this.referenceEval(base, 3)).ev : await this.evalOf(base, 3, nodes, opts.pool);
    const played = await this.lineFor(base, info.uci, ev, nodes, opts.pool);
    if (!played) return null;
    const r = labelMove({ fenBefore: base, san: info.san, evalBefore: ev, playedLine: played, thresholds: this.thresholds, excellent: this.excellent, book });
    if (!r) return null;
    if (opts.reference) this.rememberLabel(base, info.san, r.judged);
    // a move the engine itself chose for a line is its best play there by construction
    if (opts.engineChose && !['brilliant', 'great', 'best', 'forced', 'book'].includes(r.judged.label)) return { label: 'best', sure: deep };
    return { ...r.judged, sure: deep };
  }

  /** The engine's line that starts with one given move, searched from the same position and budget. */
  private async lineFor(fen: string, uci: string, known: EngineEval | undefined, nodes: number, pool: PoolName = 'quick'): Promise<EngineLine | undefined> {
    const hit = known?.lines.find((l) => l.pv[0] === uci);
    if (hit) return hit;
    const r = await this.engine.analyse({ fen, nodes, multipv: 1, searchmoves: [uci], pool });
    return r.lines[0];
  }

  /** Does the side that has just moved threaten something? (With a free move it would win material or mate.) */
  async hasThreatAfter(fenAfter: string): Promise<boolean> {
    return !!(await this.threatMove(fenAfter, this.nodes));
  }

  /**
   * Their threats against the side to move (feature C8): the engine's first few moves for the other
   * side with the turn passed, each with what it would win, the strongest first. The deeper search.
   */
  async threats(fen: string, lines = 5): Promise<ThreatResult[]> {
    const passFen = passPosition(fen);
    if (!passFen) return [];
    const ev = await this.evalOf(passFen, lines, this.verdictNodes);
    const owner = mustPosition(fen).turn;
    return ev.lines.map((line) => this.threatResult(passFen, owner, line)).filter((r): r is ThreatResult => !!r);
  }

  /** What one of their moves would win with the turn passed, searched from the same position and budget. */
  async threatOf(fen: string, moveText: string): Promise<ThreatResult | null> {
    const passFen = passPosition(fen);
    const pass = passFen ? parsePosition(passFen) : null;
    const move = pass ? anyToMove(pass, moveText) : null;
    if (!passFen || !pass || !move) return null;
    const line = await this.lineFor(passFen, describeMove(pass, move).uci, undefined, this.verdictNodes);
    return line ? this.threatResult(passFen, mustPosition(fen).turn, line) : null;
  }

  /** One of their lines with the turn passed, read from the owner's side: a mate, or the material once the captures are over. */
  private threatResult(passFen: string, owner: Color, line: EngineLine): ThreatResult | null {
    const pass = mustPosition(passFen);
    const first = line.pv[0] ? uciToMove(pass, line.pv[0]) : null;
    if (!first) return null;
    const info = describeMove(pass, first);
    const mate = line.score.mate !== undefined && line.score.mate > 0 ? line.score.mate : undefined;
    const change = materialChangeInWords(passFen, settle(passFen, line.pv, 1).fen, owner);
    return { san: info.san, from: info.from, to: info.to, mate, delta: change?.delta ?? 0, what: threatWords(mate, change) };
  }

  /** What the other side would play against the side to move with a free move, when that wins something. */
  private async threatMove(fen: string, nodes: number): Promise<string | undefined> {
    const passFen = passPosition(fen);
    if (!passFen) return undefined;
    const ev = await this.evalOf(passFen, 1, nodes);
    const line = ev.lines[0];
    if (!line) return undefined;
    const mover = mustPosition(passFen).turn;
    const san = pvToSan(passFen, line.pv, 1).sans[0];
    if (line.score.mate !== undefined) return line.score.mate > 0 ? san : undefined;
    const s = settle(passFen, line.pv, 1);
    const change = materialChangeInWords(passFen, s.fen, mover);
    return change && change.delta >= 1 ? san : undefined;
  }

  /** The full packet for a position: what both sides attack, the threats, the engine's best, the owner's last move graded. */
  async packet(req: PacketRequest): Promise<FactPacket> {
    const pos = mustPosition(req.fen);
    const fen = fenOf(pos);
    const id = this.nextPacketId();
    const nodes = req.deep ? this.verdictNodes : this.nodes;
    if (pos.isEnd()) {
      const input: FactInput = { id, fen, you: req.you, lastMove: req.lastMove, opening: req.opening, thresholds: this.thresholds };
      this.onInput?.(input);
      const p = buildFactPacket(input);
      this.remember(p.facts);
      return p;
    }
    const passFen = passPosition(fen);
    // the move that led here is judged whoever played it: the owner asks about either side's moves
    const gradeLast = req.lastMove && req.lastMove.by !== 'coach' ? req.lastMove : undefined;
    const prevPos = gradeLast ? parsePosition(gradeLast.fenBefore) : null;
    const playedMove = prevPos && gradeLast ? anyToMove(prevPos, gradeLast.san) : null;
    const playedUci = prevPos && playedMove ? describeMove(prevPos, playedMove).uci : null;

    // what the coach speaks from is checked against Lichess; the quiet background check is local only
    const evalFor = (f: string) => (req.deep ? this.referenceEval(f, 3) : this.evalOf(f, 3, nodes).then((ev) => ({ ev, source: undefined })));
    const [main, passEval, prev] = await Promise.all([
      evalFor(fen),
      passFen ? this.evalOf(passFen, 1, nodes) : Promise.resolve(undefined),
      gradeLast && prevPos && !prevPos.isEnd() ? evalFor(gradeLast.fenBefore) : Promise.resolve(undefined),
    ]);
    const ev = main.ev;
    const prevEval = prev?.ev;

    // is a "free" piece really free? ask the engine about the top winning captures
    const captureLines: Record<string, EngineLine> = {};
    const captureJobs: Promise<void>[] = [];
    if (pos.turn === req.you) {
      for (const c of capturables(pos).filter((c) => c.net > 0).slice(0, 3)) {
        const move = anyToMove(pos, c.bestCapture);
        if (!move) continue;
        const uci = describeMove(pos, move).uci;
        captureJobs.push(
          this.lineFor(fen, uci, ev, nodes).then((line) => {
            if (line) captureLines[c.bestCapture] = line;
          }),
        );
      }
    }
    const playedLineP = gradeLast && prevEval && playedUci ? this.lineFor(gradeLast.fenBefore, playedUci, prevEval, nodes) : Promise.resolve(undefined);
    const [playedLine] = await Promise.all([playedLineP, ...captureJobs]);

    const input: FactInput = { id, fen, you: req.you, lastMove: req.lastMove, eval: ev, passEval, prevEval, playedLine, captureLines, opening: req.opening, thresholds: this.thresholds };
    this.onInput?.(input);
    const p = buildFactPacket(input);
    // facts that rest on the engine say which analysis they rest on; board facts need no engine
    const engineFacts = new Set(['best_move', 'good_move', 'only_move', 'mate_in', 'fork']);
    if (main.source) this.tag(p.facts.filter((f) => engineFacts.has(f.type) && f.data.baseFen === fen), main.source);
    if (prev?.source) this.tag(p.facts.filter((f) => f.type === 'graded' || f.data.baseFen === gradeLast?.fenBefore), prev.source);
    // the owner's last move was graded for the coach: the label on the board must say the same
    if (req.deep && gradeLast && prevEval && playedLine) this.rememberLabel(gradeLast.fenBefore, gradeLast.san, this.labelFrom(gradeLast.fenBefore, gradeLast.san, fen, prevEval, playedLine));
    this.remember(p.facts);
    return p;
  }

  /** Judge one move with the deeper search: legal? good or bad? what does it win or lose, and what does it do? */
  async checkMove(fen: string, moveText: string, owner?: Color): Promise<CheckMoveResult> {
    const pos = parsePosition(fen);
    if (!pos) return { legal: false, reason: 'the position is not valid', legalMoves: [] };
    const move = anyToMove(pos, moveText);
    if (!move) {
      const legal = [...pos.allDests()].flatMap(([from, dests]) => [...dests].map((to) => describeMove(pos, { from, to }).san));
      // the reason is worked out from the board, so the coach repeats it instead of making one up
      const reason = `${moveText} is not a legal move in this position: ${whyIllegal(pos, moveText)}`;
      // a fact of its own, so the coach can name the move it was asked about and say why it cannot be played
      const fact: Fact = { id: `${this.nextPacketId()}.F1`, type: 'illegal', text: `${reason}.`, data: { move: moveText.trim() } };
      this.remember([fact]);
      return { legal: false, reason, legalMoves: [...new Set(legal)].slice(0, 40), factId: fact.id };
    }
    const info = describeMove(pos, move);
    const base = fenOf(pos);
    const [ref, threat] = await Promise.all([this.referenceEval(base, 3), this.threatMove(base, this.nodes)]);
    const evalBefore = ref.ev;
    const playedLine = await this.lineFor(base, info.uci, evalBefore, this.verdictNodes);
    const id = this.nextPacketId();
    let n = 0;
    const res = playedLine
      ? moveFacts({ fenBefore: base, san: info.san, evalBefore, playedLine, you: pos.turn, thresholds: this.thresholds }, () => `${id}.F${++n}`, { owner: owner ?? pos.turn, threatMove: threat })
      : null;
    if (!res) return { legal: false, reason: 'the engine could not judge this move', legalMoves: [] };
    this.tag(res.facts, ref.source);
    this.remember(res.facts);
    if (playedLine) this.rememberLabel(base, info.san, this.labelFrom(base, info.san, info.fenAfter, evalBefore, playedLine));
    const main = res.facts.find((f) => f.id === res.mainId)!;
    // the move to teach: among the engine's own lines, one about as good as its first choice that is easier to find (H12)
    // the move to teach: the one people at the owner's level find most often, when the human model is running; else the rule of thumb
    const people = this.humanProbs ? await this.humanProbs(base).catch(() => null) : null;
    const findable = (people ? findableByPeople(base, evalBefore.lines, people, this.excellent) : null) ?? findableMove(base, evalBefore.lines, this.excellent) ?? undefined;
    return { legal: true, san: info.san, verdict: main.text, class: res.grade.cls, facts: res.facts, factId: res.mainId, bestFactId: res.bestId, grade: res.grade, findable };
  }

  /**
   * A line for the coach's board, built by the engine. The coach may name at most the first move
   * ("what if X?"); every other move is the engine's best play, so no reply is ever made up.
   */
  async engineLine(req: LineRequest): Promise<LineResult> {
    const { you } = req;
    const basePos = parsePosition(req.baseFen);
    if (!basePos) return { ok: false, reason: 'the starting position is not valid' };
    if (basePos.isEnd()) return { ok: false, reason: 'the game is over in that position: there is nothing to play' };
    let baseFen = fenOf(basePos);
    const id = this.nextPacketId();
    let n = 0;
    const nextId = () => `${id}.F${++n}`;
    const facts: Fact[] = [];
    let pv: string[] = [];
    let score: EngineLine['score'] | undefined; // from the point of view of the side to move at baseFen
    let firstMark: '' | '?' | '??' = '';
    let headline = '';
    let firstJudged: Judged | undefined;
    let source: VerdictSource = { by: 'local', text: 'Checked by Stockfish on this computer' };
    const maxPlies = Math.max(1, req.maxPlies);

    if (req.what === 'threat') {
      const passFen = passPosition(baseFen);
      if (!passFen) return { ok: false, reason: 'the side to move is in check, so "doing nothing" is not possible: it must answer the check' };
      const ev = await this.evalOf(passFen, 1, this.verdictNodes);
      const line = ev.lines[0];
      if (!line) return { ok: false, reason: 'the engine found nothing to show' };
      const mover = mustPosition(passFen).turn;
      const s = settle(passFen, line.pv, 1);
      const change = materialChangeInWords(passFen, s.fen, mover);
      const real = (line.score.mate !== undefined && line.score.mate > 0) || (change?.delta ?? 0) >= 1;
      if (!real) {
        const quiet: Fact = {
          id: nextId(),
          type: 'quiet',
          text: mover === you ? 'With a free move you would not win anything by force here: you have no immediate threat.' : 'With a free move they would not win anything by force here: they have no immediate threat.',
          data: { side: mover === you ? 'theirs' : 'mine' },
        };
        this.remember([quiet]);
        return { ok: false, reason: `There is no immediate threat to show. ${quiet.text} (to say so, cite ${quiet.id})`, facts: [quiet] };
      }
      baseFen = passFen;
      pv = line.pv;
      score = line.score;
      headline = mover === you ? 'Your threat (what you play if they do nothing about it):' : 'Their threat (what they play if you do nothing about it):';
    } else if (req.what === 'move') {
      const move = req.move ? anyToMove(basePos, req.move) : null;
      if (!move) {
        const legal = [...basePos.allDests()].flatMap(([from, dests]) => [...dests].map((to) => describeMove(basePos, { from, to }).san));
        if (!req.move) return { ok: false, reason: 'No move was given.' };
        const why = `${req.move} is not a legal move there: ${whyIllegal(basePos, req.move)}`;
        const fact: Fact = { id: `${this.nextPacketId()}.F1`, type: 'illegal', text: `${why}.`, data: { move: req.move.trim() } };
        this.remember([fact]);
        return { ok: false, reason: `${why}. Say only this reason, with ${fact.id} in claims (then the move may be written plain). Legal moves: ${[...new Set(legal)].slice(0, 40).join(', ')}`, facts: [fact] };
      }
      const info = describeMove(basePos, move);
      const [ref, threat] = await Promise.all([this.referenceEval(baseFen, 3), this.threatMove(baseFen, this.nodes)]);
      const evalBefore = ref.ev;
      source = ref.source;
      const playedLine = await this.lineFor(baseFen, info.uci, evalBefore, this.verdictNodes);
      if (!playedLine) return { ok: false, reason: 'the engine could not judge this move' };
      const res = moveFacts({ fenBefore: baseFen, san: info.san, evalBefore, playedLine, you: basePos.turn, thresholds: this.thresholds }, nextId, { owner: you, threatMove: threat });
      if (!res) return { ok: false, reason: 'the engine could not judge this move' };
      facts.push(...res.facts);
      const g = res.grade;
      pv = playedLine.pv;
      score = g.playedScore;
      firstMark = g.cls === 'blunder' || g.mateAllowed !== undefined ? '??' : g.cls === 'mistake' ? '?' : '';
      headline = plainText(res.facts[0]!.text);
      firstJudged = this.labelFrom(baseFen, info.san, info.fenAfter, evalBefore, playedLine);
      this.rememberLabel(baseFen, info.san, firstJudged);
    } else {
      const ref = await this.referenceEval(baseFen, 3);
      const ev = ref.ev;
      source = ref.source;
      const line = ev.lines[0];
      if (!line) return { ok: false, reason: 'the engine found nothing to show' };
      const threat = await this.threatMove(baseFen, this.nodes);
      const res = moveFacts({ fenBefore: baseFen, san: pvToSan(baseFen, line.pv, 1).sans[0] ?? '', evalBefore: ev, playedLine: line, you: basePos.turn, thresholds: this.thresholds }, nextId, { owner: you, threatMove: threat });
      if (res) {
        facts.push(...res.facts);
        headline = plainText(res.facts[0]!.text);
      }
      const first = pvToSan(baseFen, line.pv, 1);
      if (first.sans[0]) {
        firstJudged = this.labelFrom(baseFen, first.sans[0], first.fens[0]!, ev, line);
        this.rememberLabel(baseFen, first.sans[0], firstJudged);
      }
      pv = line.pv;
      score = line.score;
    }

    // how far to play it out: until the captures stop, or to the end of a forced mate
    const mateLen = score?.mate !== undefined ? 2 * Math.abs(score.mate) - (score.mate > 0 ? 1 : 0) : 0;
    const sans = mateLen > 0 ? pvToSan(baseFen, pv, Math.min(mateLen, maxPlies)).sans : settle(baseFen, pv, Math.min(2, maxPlies), maxPlies).sans;
    if (!sans.length) return { ok: false, reason: 'the engine found nothing to show' };
    const fens = [baseFen];
    {
      const pos = mustPosition(baseFen);
      for (const san of sans) {
        const move = anyToMove(pos, san)!;
        const info = describeMove(pos, move);
        pos.play(move);
        fens.push(info.fenAfter);
      }
    }
    const endFen = fens.at(-1)!;
    const endPos = mustPosition(endFen);
    const baseTurn = mustPosition(baseFen).turn;
    const forYou = score ? (baseTurn === you ? score : flipScore(score)) : undefined;
    const change = materialChangeInWords(baseFen, endFen, you);
    let outcome: string;
    if (endPos.isCheckmate()) outcome = endPos.turn === you ? 'you are checkmated' : 'it is checkmate and you win';
    else if (endPos.isStalemate()) outcome = 'it is stalemate, a draw';
    else outcome = `${change?.text ?? 'no material changes hands'}${forYou ? `, and you are ${balanceInWords(forYou)}` : ''}`;

    const marks = sans.map((_, i) => (i === 0 ? firstMark : '')) as ('' | '?' | '??')[];
    const firstByOwner = baseTurn === you;
    // good or bad news for the owner? A forced mate decides it; otherwise a mistake is bad for whoever makes it.
    const verdictForYou: 'good' | 'bad' | undefined =
      forYou?.mate !== undefined ? (forYou.mate > 0 ? 'good' : 'bad') : firstMark ? (firstByOwner ? 'bad' : 'good') : req.what === 'threat' ? (firstByOwner ? 'good' : 'bad') : undefined;
    const lineId = nextId();
    const shown = sans.map((m) => tok.m(m, lineId)).join(' ');
    const lineFact: Fact = {
      id: lineId,
      type: 'line',
      text: `${req.what === 'threat' ? 'The threat' : req.what === 'best' ? 'Best play' : 'The line'} ${shown}: at the end ${outcome}.`,
      data: { baseFen, line: sans, move: sans[0], delta: change?.delta ?? 0, side: you, mateIn: forYou?.mate, verdictForYou, reasons: moveReasons(baseFen, sans[0]!, you).map((r) => r.tag) },
    };
    facts.push(lineFact);
    this.tag(facts, source);
    this.remember(facts);

    const rest = sans.length > 1 ? ` Then best play is ${sans.slice(1).join(' ')}.` : '';
    const verdict = `${headline}${req.what === 'threat' ? ` ${sans.join(' ')}.` : rest} At the end ${outcome}.`.replace(/\s+/g, ' ').trim();
    const summary = `ENGINE VERDICT: ${facts
      .filter((f) => f.id !== lineId)
      .map((f) => f.text)
      .join(' ')} ${lineFact.text} Every move after the first is the engine's best play. Explain this to the owner; do not add moves or judgements of your own.`.replace(/\s+/g, ' ');
    return { ok: true, id: lineId, baseFen, moves: sans, fens, marks, facts, summary, verdict, source, firstJudged: firstJudged ? { ...firstJudged, sure: true } : undefined };
  }
}
