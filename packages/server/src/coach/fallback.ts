// The scripted fallback (COACH §7, feature A11). Used when the coach is off, when its process
// is down, and after two rejected messages. It speaks from the same verified facts through fixed
// templates, so hints and explanations work without the model.

import { readFileSync } from 'node:fs';
import { anyToMove, describeMove, mustPosition, type Fact, type FactPacket, type SayKind, type Shape } from '@chess-coach/core';

export type Scripted = { kind: SayKind; text: string; claims: string[]; shapes?: Shape[]; expect?: 'none' | 'move' };

export type ScriptedAsk = 'hint' | 'tell_me' | 'why' | 'show_me' | 'question' | 'move';

/** The fallback's own sentences (coach/templates/analysis.json): the questions and nudges of the hint ladder. */
const TEMPLATE_KEYS = ['over', 'hint.question.threat', 'hint.question.loose', 'hint.question.routine', 'hint.nudge.piece', 'hint.nudge.danger', 'hint.nudge.improve', 'hint.arrow', 'hint.captures', 'quiet'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type Templates = Record<TemplateKey, string>;

/** Read the templates file. Throws, naming the key, when a sentence is missing: the fallback must never be speechless. */
export function loadTemplates(file: string): Templates {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const out = {} as Templates;
  for (const key of TEMPLATE_KEYS) {
    const text = raw[key];
    if (typeof text !== 'string' || !text.trim()) throw new Error(`the scripted fallback's templates (${file}) have no sentence for "${key}"`);
    out[key] = text;
  }
  return out;
}

const first = (p: FactPacket, ...types: Fact['type'][]) => p.facts.find((f) => types.includes(f.type));

function arrowFor(p: FactPacket, fact: Fact | undefined, style: Shape['style']): Shape[] {
  const move = fact?.data.move ?? fact?.data.line?.[0];
  const base = fact?.data.baseFen ?? p.fen;
  if (typeof move !== 'string') return [];
  const pos = mustPosition(base);
  const m = anyToMove(pos, move);
  if (!m) return [];
  const info = describeMove(pos, m);
  return [{ from: info.from, to: info.to, style }];
}

/** What the scripted coach says. `level` is the hint ladder's rung (0 question … 3 answer). */
export function scripted(ask: ScriptedAsk, p: FactPacket, level: number, t: Templates): Scripted {
  if (p.over) {
    const f = first(p, 'game_over');
    return { kind: 'summary', text: f?.text ?? t.over, claims: f ? [f.id] : [] };
  }
  const threat = p.threat ? p.facts.find((f) => f.id === p.threat!.factId) : undefined;
  const hangMine = p.facts.find((f) => f.type === 'hangs' && f.data.side === 'mine');
  const hangTheirs = p.facts.find((f) => f.type === 'hangs' && f.data.side === 'theirs');
  const best = first(p, 'mate_in', 'best_move');
  const graded = first(p, 'graded');
  const yourMove = p.turn === p.you;

  if (ask === 'why' || (ask === 'move' && graded)) {
    if (graded) {
      const bestAlt = p.graded?.bestFactId ? p.facts.find((f) => f.id === p.graded!.bestFactId) : undefined;
      return { kind: 'explain', text: bestAlt ? `${graded.text} ${bestAlt.text}` : graded.text, claims: [graded.id, ...(bestAlt ? [bestAlt.id] : [])], shapes: arrowFor(p, bestAlt, 'idea') };
    }
    if (threat) return { kind: 'explain', text: threat.text, claims: [threat.id], shapes: arrowFor(p, threat, 'threat') };
    if (best) return { kind: 'explain', text: best.text, claims: [best.id] };
    return { kind: 'explain', text: p.material.inWords, claims: [] };
  }

  if (ask === 'tell_me' || ask === 'show_me' || (ask === 'hint' && level >= 3)) {
    if (!yourMove && best) return { kind: 'answer', text: best.text, claims: [best.id], shapes: arrowFor(p, best, 'threat') };
    if (best) return { kind: 'answer', text: best.text, claims: [best.id], shapes: arrowFor(p, best, 'move') };
    return { kind: 'answer', text: p.material.inWords, claims: [] };
  }

  if (ask === 'hint') {
    if (level <= 0) {
      if (threat) return { kind: 'question', text: t['hint.question.threat'], claims: [], expect: 'move' };
      if (hangTheirs) return { kind: 'question', text: t['hint.question.loose'], claims: [], expect: 'move' };
      return { kind: 'question', text: t['hint.question.routine'], claims: [], expect: 'move' };
    }
    if (level === 1) {
      const piece = (hangMine?.data.piece ?? hangTheirs?.data.piece) as { role: string; square: string } | undefined;
      if (piece) return { kind: 'nudge', text: t['hint.nudge.piece'].replace('{role}', piece.role).replace('{square}', `{sq:${piece.square}}`), claims: [] };
      if (threat) return { kind: 'nudge', text: t['hint.nudge.danger'], claims: [threat.id] };
      return { kind: 'nudge', text: t['hint.nudge.improve'], claims: [] };
    }
    // level 2: the arrow
    const target = threat ?? hangMine ?? hangTheirs ?? best;
    const shapes = arrowFor(p, target, threat || hangMine ? 'threat' : 'idea');
    if (shapes.length) return { kind: 'nudge', text: t['hint.arrow'], claims: [], shapes };
    return best ? { kind: 'answer', text: best.text, claims: [best.id] } : { kind: 'nudge', text: t['hint.captures'], claims: [] };
  }

  // a typed question with the coach off: the checked facts that matter most
  const gradedBad = graded && (p.graded?.cls === 'mistake' || p.graded?.cls === 'blunder') ? graded : undefined;
  const picks = [threat, hangMine, hangTheirs, gradedBad].filter((f): f is Fact => !!f).slice(0, 2);
  if (!picks.length && best && !yourMove) picks.push(best);
  if (!picks.length) {
    const castle = p.facts.find((f) => f.type === 'castling' && f.data.side === p.you);
    return { kind: 'explain', text: `${p.material.inWords} ${t.quiet}${castle ? ` ${castle.text}` : ''}`.trim(), claims: [p.facts.find((f) => f.type === 'material')?.id ?? '', castle?.id ?? ''].filter(Boolean) };
  }
  return { kind: 'explain', text: picks.map((f) => f.text).join(' '), claims: picks.map((f) => f.id), shapes: arrowFor(p, picks[0], 'threat') };
}
