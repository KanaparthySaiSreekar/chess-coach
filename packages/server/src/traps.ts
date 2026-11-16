// The trap pack through its gates (feature D8; CONTENT §5, §7; PLAN WP 8.9).
//
// content/traps.json holds the traps as authored: the line that sets each one, the owner's move,
// the move the opponent hopes for, and the words. Every trap is gated like any content:
//   V1  the line, the move and the hoped-for move are legal (core/trap.ts)
//   V2  the owner's move is sound (graded like a repertoire move); for a trap to avoid, the move they
//       hope for really loses (graded a mistake or a blunder); for one the owner springs, the
//       opponent's last move really was a mistake. The other sound moves are accepted on the card.
//   V3  the why and the idea pass the live validator against the facts of the position (with the
//       hoped-for move's own facts, and the position after it, so "then their queen takes on f7" is checked)
//   V4  players at the owner's level really reach the position (the explorer: TRAP_MIN_GAMES games)
//   V6  the envelope; V7  the deeper pass agrees with V2
// A trap is gated again only when its entry, the engine or the budgets change.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  TRAP_MIN_GAMES,
  describeMove,
  gateV6,
  gradeMove,
  mustPosition,
  playLine,
  readTrap,
  sanToMove,
  statusAfter,
  trapKey,
  uciToMove,
  validateSay,
  type ConceptLadder,
  type ContentItem,
  type GateResult,
  type GradeResult,
  type TrapFile,
  type TrapItem,
  type VocabularyLevel,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import type { EngineService } from './engine/service.ts';
import type { FactService } from './facts-service.ts';

export type TrapOptions = {
  nodes: number;
  secondNodes: number;
  maxDrop: number;
  thresholds?: { inaccuracy: number; mistake: number; blunder: number };
  /** traps that pass every gate go live without the owner's yes */
  autoApprove: boolean;
};

export class TrapPack {
  private readonly o: {
    db: Db;
    engine: EngineService;
    facts: FactService;
    ladder?: ConceptLadder;
    vocabulary: () => VocabularyLevel;
    /** how many games players at the owner's level reach a position with (the explorer), or null when it cannot say */
    games: (fen: string) => Promise<number | null>;
    options: () => TrapOptions;
    file: string;
    log?: (msg: string) => void;
  };

  constructor(o: TrapPack['o']) {
    this.o = o;
  }

  /** The traps in the pack's file. */
  read(): TrapFile[] {
    return JSON.parse(readFileSync(this.o.file, 'utf8')) as TrapFile[];
  }

  /** Gate every trap of the file that is new or changed; a trap no longer in the file is removed. Returns what happened. */
  async sync(force = false): Promise<{ checked: number; live: number; quarantined: number; skipped: number; removed: number }> {
    const o = this.o.options();
    const traps = this.read();
    const out = { checked: 0, live: 0, quarantined: 0, skipped: 0, removed: 0 };
    for (const t of traps) {
      const key = trapKey(t.id);
      const version = this.version(t, o);
      const stored = this.o.db.contentKeys('trap').find((k) => k.key === key);
      const before = stored ? (this.o.db.getContent(stored.id) as unknown as ContentItem<TrapItem & { version?: string }>) : undefined;
      if (!force && before?.body.version === version) {
        out.skipped++;
        continue;
      }
      const item = await this.gate(t, o);
      // the owner's decision stays: a trap they took live stays live while it passes
      if (before?.status === 'live' && item.status !== 'quarantined') item.status = 'live';
      this.o.db.saveContent(key, { ...item, body: { ...item.body, version } });
      out.checked++;
      if (item.status === 'quarantined') out.quarantined++;
      else if (item.status === 'live') out.live++;
      this.o.log?.(`trap ${t.id}: ${item.status}`);
    }
    for (const k of this.o.db.contentKeys('trap')) {
      if (traps.some((t) => trapKey(t.id) === k.key)) continue;
      this.o.db.deleteContent(k.id);
      out.removed++;
    }
    return out;
  }

  private version(t: TrapFile, o: TrapOptions): string {
    return createHash('sha256').update(JSON.stringify([t, this.o.engine.signature, o.nodes, o.secondNodes, o.maxDrop, o.thresholds ?? null, TRAP_MIN_GAMES])).digest('hex').slice(0, 16);
  }

  /** Every gate over one trap. Nothing is stored. */
  async gate(t: TrapFile, o = this.o.options()): Promise<ContentItem<TrapItem>> {
    const read = readTrap(t);
    const source = `file:content/traps.json#${t.id}`;
    const base: ContentItem<TrapItem> = { type: 'trap', status: 'draft', source, licence: 'project', level: '400–700', engine: `${this.o.engine.signature}, ${o.nodes} nodes (V2), ${o.secondNodes} nodes (V7)`, gates: [], body: read.ok ? read.item : ({ id: t.id, name: t.name } as TrapItem) };
    if (!read.ok) {
      const gates: GateResult[] = [{ gate: 'V1', result: 'fail', detail: read.reason }];
      gates.push(gateV6(base, { storedUnderData: true, engineRan: true }));
      return { ...base, gates, status: 'quarantined' };
    }
    const item = read.item;
    const v2 = await this.sound(item, o.nodes, o, 'V2');
    item.accepted = v2.accepted;
    const v3 = v2.gate.result === 'pass' ? await this.words(item) : ({ gate: 'V3', result: 'n/a', detail: 'not run: the engine did not pass the trap' } as GateResult);
    const games = await this.o.games(item.fen).catch(() => null);
    const v4: GateResult = games === null ? { gate: 'V4', result: 'n/a', detail: 'not checked: the explorer could not say how often players at your level reach this position' } : games >= TRAP_MIN_GAMES ? { gate: 'V4', result: 'pass', detail: `${games.toLocaleString('en-US')} games at your level reach it` } : { gate: 'V4', result: 'fail', detail: `only ${games} games at your level reach this position: too rare to drill` };
    const v7 = v2.gate.result === 'pass' ? (await this.sound(item, o.secondNodes, o, 'V7')).gate : ({ gate: 'V7', result: 'n/a', detail: 'not run: the engine did not pass the trap' } as GateResult);
    const checked: ContentItem<TrapItem> = { ...base, body: item, gates: [{ gate: 'V1', result: 'pass' }, v2.gate, v3, v4, v7] };
    checked.gates.push(gateV6(checked, { storedUnderData: true, engineRan: true }));
    const status = statusAfter('trap', checked.gates) === 'quarantined' ? 'quarantined' : o.autoApprove ? 'live' : 'machine-verified';
    return { ...checked, status };
  }

  /** V2 (or V7, deeper): the owner's move is sound; the hoped-for move loses (or their last move was a mistake). The other sound moves are accepted. */
  private async sound(item: TrapItem, nodes: number, o: TrapOptions, gate: 'V2' | 'V7'): Promise<{ gate: GateResult; accepted: string[] }> {
    const fail = (detail: string) => ({ gate: { gate, result: 'fail', detail } as GateResult, accepted: [] });
    const ev = await this.o.engine.analyse({ fen: item.fen, nodes, multipv: 5, pool: 'analysis' });
    const best = ev.lines[0];
    if (!best) return fail('the engine gave no line');
    const grade = async (fen: string, uci: string, san: string): Promise<GradeResult | null> => {
      const top = fen === item.fen ? best : (await this.o.engine.analyse({ fen, nodes, multipv: 1, pool: 'analysis' })).lines[0];
      if (!top) return null;
      const line = (fen === item.fen ? ev.lines.find((l) => l.pv[0] === uci) : undefined) ?? (top.pv[0] === uci ? top : (await this.o.engine.analyse({ fen, nodes, multipv: 1, searchmoves: [uci], pool: 'analysis' })).lines[0]);
      return line ? gradeMove({ fenBefore: fen, san, evalBefore: { fen, lines: [top] }, playedLine: line, you: mustPosition(fen).turn, thresholds: o.thresholds }) : null;
    };
    const unsound = (g: GradeResult | null) => !g || g.drop > o.maxDrop || !!g.floor || g.cls === 'mistake' || g.cls === 'blunder';
    const bad = (g: GradeResult | null) => !!g && (g.cls === 'mistake' || g.cls === 'blunder');
    const mine = await grade(item.fen, item.move.uci, item.move.san);
    // V7 only asks that no move be called a mistake; V2 asks for the repertoire's soundness
    if (gate === 'V2' ? unsound(mine) : bad(mine)) return fail(`${item.move.san} is not sound here (${mine?.lost ?? 'it makes the position worse'}); the engine plays ${mine?.best ?? '?'} (${nodes.toLocaleString('en-US')} nodes)`);
    if (item.kind === 'avoid') {
      const hope = await grade(item.fen, item.hope!.uci, item.hope!.san);
      if (!bad(hope)) return fail(`the move they hope for, ${item.hope!.san}, does not lose here: the engine calls it ${hope?.cls === 'ok' ? 'fine' : (hope?.cls ?? 'unclear')}, so this is no trap (${nodes.toLocaleString('en-US')} nodes)`);
    } else {
      const r = playLine(item.startFen, item.line);
      const before = r.ok ? r.fens.at(-2)! : null;
      const last = item.line.at(-1)!;
      const p = before ? mustPosition(before) : null;
      const lm = p ? sanToMove(p, last) : null;
      const m = p && lm ? describeMove(p, lm) : null;
      const theirs = before && m ? await grade(before, m.uci, m.san) : null;
      if (!bad(theirs)) return fail(`their last move, ${last}, is not a mistake by the engine, so there is nothing to spring (${nodes.toLocaleString('en-US')} nodes)`);
    }
    const accepted: string[] = [];
    if (gate === 'V2') {
      const pos = mustPosition(item.fen);
      for (const l of ev.lines) {
        const uci = l.pv[0]!;
        if (uci === item.move.uci || (item.hope && uci === item.hope.uci)) continue;
        const m = uciToMove(pos, uci);
        if (!m) continue;
        if (!unsound(await grade(item.fen, uci, describeMove(pos, m).san))) accepted.push(uci);
      }
    }
    return { gate: { gate, result: 'pass' }, accepted };
  }

  /** V3: the why and the idea, each through the live validator against the position's facts. */
  private async words(item: TrapItem): Promise<GateResult> {
    if (!item.why && !item.idea) return { gate: 'V3', result: 'pass', detail: 'no words written yet' };
    const { facts, ladder, vocabulary } = { facts: this.o.facts, ladder: this.o.ladder, vocabulary: this.o.vocabulary };
    const r = playLine(item.startFen, item.line);
    const last = r.ok ? { san: item.line.at(-1)!, baseFen: r.fens.at(-2)! } : undefined;
    const packet = await facts.packet({ fen: item.fen, you: item.colour, deep: true, lastMove: last ? { san: last.san, by: 'opponent', fenBefore: last.baseFen } : undefined });
    const mine = await facts.checkMove(item.fen, item.move.san, item.colour);
    const hope = item.hope ? await facts.checkMove(item.fen, item.hope.san, item.colour) : null;
    const claims = [...packet.facts, ...(mine.legal ? mine.facts : []), ...(hope?.legal ? hope.facts : [])].map((f) => f.id);
    const pos = mustPosition(item.fen);
    const alsoFens = [item.move, ...(item.hope ? [item.hope] : [])].map((m) => describeMove(pos, uciToMove(pos, m.uci)!).fenAfter);
    for (const [what, text] of [['the why', item.why], ['the idea', item.idea]] as const) {
      if (!text) continue;
      const v = validateSay({ kind: 'explain', text, claims }, { fen: item.fen, alsoFens, you: item.colour, fact: facts.fact, budgetSentences: 2, canAnswer: true, vocabulary: vocabulary(), ladder, lastMove: last });
      if (!v.ok) return { gate: 'V3', result: 'fail', detail: `${what} "${text}": ${v.problems.map((p) => p.message).join(' ')}` };
    }
    return { gate: 'V3', result: 'pass' };
  }
}
