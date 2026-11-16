// The board: Lichess's chessground, with chessops deciding what is legal. The page checks moves
// for instant feedback; the server checks again and is the authority (ARCHITECTURE §4).
//
// Everything drawn here comes from the server: the coach's arrows and boxes (built from facts),
// the engine's best-move arrows, and the label on the last move. The page chooses nothing.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { chessgroundDests } from 'chessops/compat';
import { parsePosition, parseSquare, type BestArrow, type Color, type MoveLabel, type Shape } from '@chess-coach/core';
import { isKnightHop, knightArrowSvg } from './arrows.ts';
import { badgeSvg } from './labels.tsx';
import { PieceBox } from './San.tsx';

export type BoardProps = {
  fen: string;
  orientation: Color;
  /** may the owner move pieces here? (not while a line is being played out, not while peeking) */
  interactive: boolean;
  /** in a game against a bot the owner moves only their own side; on the analysis board, both */
  movable?: Color | 'turn';
  lastMove?: [string, string];
  coachShapes: Shape[];
  /** the engine's first choices for this position (feature A16) */
  bestArrows: BestArrow[];
  /** the label on the move that led here, drawn on the square the piece landed on (feature A17) */
  badge?: { square: string; label: MoveLabel };
  hoverSquares: string[];
  coordinates: boolean;
  theme: string;
  /** goes up when the board must be put back as the server has it (a move was refused) */
  resync: number;
  onMove: (from: string, to: string, promotion?: 'queen' | 'rook' | 'bishop' | 'knight') => void;
  onOwnerShapes?: (shapes: Shape[]) => void;
  /** the owner's own arrows and circles for this position, as the server keeps them */
  ownerShapes?: Shape[];
  /** the move that should have been played instead of the last one, when that was a mistake (feature A19) */
  betterMove?: { from: string; to: string };
  /** draw the arrow for a knight's move bent like the move, not as one straight line */
  bentKnightArrows?: boolean;
  /** drawings stay until they are drawn again or cleared (a study); otherwise a click on a piece wipes them (a scratch pad) */
  keepDrawings?: boolean;
};

// the owner's drawings use chessground's own four brushes, which are also Lichess's four colours
const OWNER_BRUSHES = ['green', 'red', 'blue', 'yellow'] as const;
const brushColor = (brush?: string) => (OWNER_BRUSHES as readonly string[]).includes(brush ?? '') ? (brush as (typeof OWNER_BRUSHES)[number]) : 'green';
const ownerDraw = (s: Shape): DrawShape => ({ orig: s.from as Key, dest: s.to as Key | undefined, brush: s.color ?? 'green' });
const drawKey = (shapes: DrawShape[]) => shapes.map((s) => `${s.orig}${s.dest ?? ''}${s.brush ?? ''}`).sort().join(',');

/** The colour of the 'this was the better move' arrow, and of that move's name under the board. */
export const BETTER_COLOR = '#58a81c';

// the coach draws in its own colours, apart from the owner's green; the engine's arrows are pale
const BRUSHES = {
  coachMove: { key: 'coachMove', color: '#2f80ed', opacity: 0.9, lineWidth: 11 },
  coachThreat: { key: 'coachThreat', color: '#e5484d', opacity: 0.9, lineWidth: 11 },
  coachIdea: { key: 'coachIdea', color: '#f2a93b', opacity: 0.9, lineWidth: 10 },
  coachGood: { key: 'coachGood', color: '#12a594', opacity: 0.9, lineWidth: 10 },
  engine: { key: 'engine', color: '#6f4bd8', opacity: 0.75, lineWidth: 12 },
  hover: { key: 'hover', color: '#8b5cf6', opacity: 0.85, lineWidth: 9 },
  // the move that should have been played instead of the one on the board (feature A19)
  better: { key: 'better', color: BETTER_COLOR, opacity: 1, lineWidth: 11 },
  // the owner's own green, as the board library has it: needed here to bend a knight's arrow in it
  green: { key: 'green', color: '#15781B', opacity: 1, lineWidth: 10 },
};
// the board library draws its arrows on a layer that is itself 60% see-through
const SHAPE_LAYER_OPACITY = 0.6;
const STYLE_BRUSH: Record<string, string> = { move: 'coachMove', threat: 'coachThreat', danger: 'coachThreat', idea: 'coachIdea', target: 'coachIdea', good: 'coachGood', owner: 'green' };

// a box around a square: red for a piece of the owner's in danger, amber for a target, teal for a good square
const BOX_COLOR: Record<string, string> = { danger: '#e5484d', target: '#f2a93b', good: '#12a594', idea: '#f2a93b', threat: '#e5484d', move: '#2f80ed' };
const boxSvg = (color: string) => `<rect x="4" y="4" width="92" height="92" rx="7" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="7"/>`;
const ARROW_WIDTH = [12, 8, 6];

type Promo = { from: string; to: string; color: Color };

export function Board(p: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const [promo, setPromo] = useState<Promo | null>(null);

  const pos = useMemo(() => parsePosition(p.fen), [p.fen]);
  const turn: Color = pos?.turn ?? 'white';
  const mover: Color | undefined = !p.interactive ? undefined : !p.movable || p.movable === 'turn' ? turn : p.movable === turn ? turn : undefined;

  const config = useMemo((): Config => {
    const dests = pos && mover ? (chessgroundDests(pos) as Map<Key, Key[]>) : new Map<Key, Key[]>();
    const auto: DrawShape[] = [];
    // one arrow: a straight one from the board library, or, for a knight's move, one bent like the move
    const arrow = (from: string, to: string, brush: string, lineWidth?: number) => {
      const look = BRUSHES[brush as keyof typeof BRUSHES];
      if (p.bentKnightArrows && look && isKnightHop(from, to)) {
        const html = knightArrowSvg(from, to, p.orientation, { color: look.color, opacity: look.opacity * SHAPE_LAYER_OPACITY, lineWidth: lineWidth ?? look.lineWidth });
        auto.push({ orig: from as Key, customSvg: { html, center: 'orig' } });
      } else auto.push({ orig: from as Key, dest: to as Key, brush, modifiers: lineWidth ? { lineWidth } : undefined });
    };
    // the engine's arrows step aside while the coach is drawing something of its own
    if (!p.coachShapes.length) {
      p.bestArrows.forEach((a, i) => arrow(a.from, a.to, 'engine', ARROW_WIDTH[i] ?? 6));
    }
    // what should have been played instead of the move on the board: drawn from where the piece stood
    if (p.betterMove && !p.coachShapes.length) arrow(p.betterMove.from, p.betterMove.to, 'better');
    for (const s of p.coachShapes) {
      if (s.to) arrow(s.from, s.to, STYLE_BRUSH[s.style] ?? 'coachIdea');
      else if (s.style === 'owner') auto.push({ orig: s.from as Key, brush: 'green' });
      else auto.push({ orig: s.from as Key, customSvg: { html: boxSvg(BOX_COLOR[s.style] ?? '#f2a93b'), center: 'orig' }, below: true });
    }
    for (const sq of p.hoverSquares) auto.push({ orig: sq as Key, brush: 'hover' });
    if (p.badge) auto.push({ orig: p.badge.square as Key, customSvg: { html: badgeSvg(p.badge.label), center: 'orig' } });
    return {
      fen: p.fen,
      orientation: p.orientation,
      turnColor: turn,
      check: pos?.isCheck() ? turn : false,
      lastMove: p.lastMove as Key[] | undefined,
      coordinates: p.coordinates,
      viewOnly: false,
      movable: { free: false, color: mover, dests, showDests: true, rookCastle: true },
      premovable: { enabled: false },
      draggable: { enabled: !!mover, showGhost: true },
      selectable: { enabled: !!mover },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 220 },
      drawable: { enabled: true, visible: true, eraseOnMovablePieceClick: !p.keepDrawings, autoShapes: auto, brushes: { ...BRUSHES } as never },
    };
  }, [p.fen, p.orientation, mover, p.lastMove?.[0], p.lastMove?.[1], p.coachShapes, p.bestArrows, p.badge?.square, p.badge?.label, p.hoverSquares, p.coordinates, p.keepDrawings, p.betterMove?.from, p.betterMove?.to, p.bentKnightArrows, pos, turn]);

  // create once
  useEffect(() => {
    if (!el.current) return;
    const cg = Chessground(el.current, {
      ...config,
      events: {},
      movable: {
        ...config.movable,
        events: {
          after: (orig, dest) => {
            const cur = latest.current;
            const position = parsePosition(cur.fen);
            const from = parseSquare(orig);
            const piece = position && from !== undefined ? position.board.get(from) : undefined;
            const lastRank = dest[1] === '8' || dest[1] === '1';
            if (piece?.role === 'pawn' && lastRank) setPromo({ from: orig, to: dest, color: piece.color });
            else cur.onMove(orig, dest);
          },
        },
      },
      drawable: {
        ...config.drawable,
        onChange: (shapes) => latest.current.onOwnerShapes?.(shapes.map((s) => ({ from: s.orig, to: s.dest, style: 'owner' as const, color: brushColor(s.brush) }))),
      },
    });
    api.current = cg;
    const wrap = el.current;
    const ro = new ResizeObserver(() => cg.redrawAll());
    ro.observe(wrap);
    // Chessground remembers where the board is on the screen. A bar appearing above it (the
    // coach's board, a look ahead) moves the board without resizing it, so the remembered place
    // would be stale and a click would land on the wrong square: look again before every touch.
    const refresh = () => cg.state.dom.bounds.clear();
    wrap.addEventListener('mousedown', refresh, { capture: true });
    wrap.addEventListener('touchstart', refresh, { capture: true, passive: true });
    wrap.addEventListener('contextmenu', refresh, { capture: true });
    return () => {
      wrap.removeEventListener('mousedown', refresh, { capture: true });
      wrap.removeEventListener('touchstart', refresh, { capture: true });
      wrap.removeEventListener('contextmenu', refresh, { capture: true });
      ro.disconnect();
      // a redraw may still be queued for the next frame; with nothing to draw it cannot try to place
      // shapes on a board that has left the page
      cg.state.drawable.autoShapes = [];
      cg.state.drawable.shapes = [];
      cg.destroy();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep it in step with the props (and put a refused move back: `resync`)
  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    cg.state.dom.bounds.clear(); // the page around the board may have changed with this update
    cg.set({ ...config, movable: { ...config.movable }, drawable: { ...config.drawable } });
    if (!mover) cg.cancelMove();
  }, [config, mover, p.resync]);

  // The owner's drawings follow the server: a position shows the drawings kept with it, and one
  // without any is clean. What the owner has just drawn is already on the board, so the server's
  // echo of it changes nothing.
  const ownerKey = JSON.stringify(p.ownerShapes ?? []);
  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    const want = (latest.current.ownerShapes ?? []).map(ownerDraw);
    if (drawKey(cg.state.drawable.shapes) !== drawKey(want)) cg.setShapes(want);
  }, [ownerKey, p.fen]);

  const choose = (role: 'queen' | 'rook' | 'bishop' | 'knight' | null) => {
    const pr = promo;
    setPromo(null);
    if (!pr) return;
    if (role) p.onMove(pr.from, pr.to, role);
    else api.current?.set({ fen: latest.current.fen }); // cancelled: put the pawn back
  };

  return (
    <div className={`board-frame theme-${p.theme}`}>
      <div ref={el} className="cg-wrap board" />
      {promo && (
        <div className="promo-backdrop" onClick={() => choose(null)}>
          <div className="promo" role="dialog" aria-label="Choose a piece to promote to" onClick={(e) => e.stopPropagation()}>
            <span>Promote to</span>
            {(['queen', 'rook', 'bishop', 'knight'] as const).map((role) => (
              <button key={role} className="promo-piece" onClick={() => choose(role)} title={role} aria-label={role}>
                <PieceBox className="promo-wrap" role={role} color={promo.color} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
