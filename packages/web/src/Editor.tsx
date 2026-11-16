// The board editor (feature I2): set up any position by placing pieces, or paste a FEN.
//
// The page only places pieces. Whether the result is a position chess allows is decided by the
// same rules as everything else (core's checkSetup), shown here at once and checked again by the
// server when the position is sent.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key, Piece } from '@lichess-org/chessground/types';
import { ArrowUpDown, Check, CircleAlert, Eraser, Hand, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { START_FEN, castlingOptions, checkSetup, epOptions, setupFen, setupParts, type CastlingRights, type Color } from '@chess-coach/core';
import { PieceBox } from './San.tsx';
import { send, setting, type Store } from './store.ts';
import { Segmented } from './ui.tsx';

const ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
type Role = (typeof ROLES)[number];
type Tool = { kind: 'move' } | { kind: 'erase' } | { kind: 'piece'; color: Color; role: Role };
const EMPTY = '8/8/8/8/8/8/8/8';
const RIGHTS: { key: keyof CastlingRights; label: string }[] = [
  { key: 'K', label: 'White, short (O-O)' },
  { key: 'Q', label: 'White, long (O-O-O)' },
  { key: 'k', label: 'Black, short (O-O)' },
  { key: 'q', label: 'Black, long (O-O-O)' },
];

export function EditorView({ s, initialFen, initialOrientation, onClose }: { s: Store; initialFen: string; initialOrientation: Color; onClose: () => void }) {
  const first = useMemo(() => setupParts(initialFen) ?? setupParts(START_FEN)!, [initialFen]);
  const [placement, setPlacement] = useState(first.placement);
  const [turn, setTurn] = useState<Color>(first.turn);
  const [castling, setCastling] = useState<CastlingRights>(first.castling);
  const [ep, setEp] = useState<string | undefined>(first.ep);
  const [orientation, setOrientation] = useState<Color>(initialOrientation);
  const [tool, setTool] = useState<Tool>({ kind: 'move' });
  const [fenText, setFenText] = useState<string | null>(null); // what is being typed in the FEN box, while it is being typed

  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const can = castlingOptions(placement);
  const epChoices = epOptions(placement, turn);
  const fen = setupFen(placement, turn, castling, ep);
  const check = checkSetup(fen);

  // the board: every piece can go anywhere, and a piece dragged off the board is removed
  useEffect(() => {
    if (!el.current) return;
    const read = () => setPlacement(cg.getFen());
    const cg = Chessground(el.current, {
      fen: first.placement,
      orientation: initialOrientation,
      coordinates: true,
      movable: { free: true, color: 'both', showDests: false },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true, deleteOnDropOff: true },
      selectable: { enabled: true },
      highlight: { lastMove: false, check: false },
      animation: { enabled: false },
      drawable: { enabled: false },
      events: { change: read, dropNewPiece: read },
    });
    api.current = cg;
    const wrap = el.current;
    const ro = new ResizeObserver(() => cg.redrawAll());
    ro.observe(wrap);
    // with a piece or the eraser chosen, a press on a square places or removes instead of dragging
    const press = (e: MouseEvent | TouchEvent) => {
      const t = toolRef.current;
      cg.state.dom.bounds.clear();
      if (t.kind === 'move') return;
      if ('button' in e && e.button !== 0) return;
      const point = 'touches' in e ? e.touches[0] : e;
      if (!point) return;
      const key = cg.getKeyAtDomPos([point.clientX, point.clientY]);
      if (!key) return;
      e.stopPropagation();
      e.preventDefault();
      const there = cg.state.pieces.get(key);
      const same = t.kind === 'piece' && there?.color === t.color && there.role === t.role;
      // pressing the same piece again takes it off, so a slip is one more press away from fixed
      cg.setPieces(new Map<Key, Piece | undefined>([[key, t.kind === 'erase' || same ? undefined : { color: t.color, role: t.role }]]));
      read();
    };
    wrap.addEventListener('mousedown', press, { capture: true });
    wrap.addEventListener('touchstart', press, { capture: true, passive: false });
    return () => {
      wrap.removeEventListener('mousedown', press, { capture: true });
      wrap.removeEventListener('touchstart', press, { capture: true });
      ro.disconnect();
      cg.destroy();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.set({ orientation });
  }, [orientation]);

  /** Put a whole placement on the board (the buttons and the FEN box). */
  const place = (next: string) => {
    api.current?.set({ fen: next });
    setPlacement(next);
  };

  const typed = (text: string) => {
    setFenText(text);
    const parts = setupParts(text);
    if (!parts) return;
    place(parts.placement);
    setTurn(parts.turn);
    setCastling(parts.castling);
    setEp(parts.ep);
  };

  const is = (t: Tool) => t.kind === tool.kind && (t.kind !== 'piece' || (tool.kind === 'piece' && t.color === tool.color && t.role === tool.role));
  const boardTheme = setting(s, 'display.boardTheme', 'brown');

  return (
    <main className="layout editor">
      <aside className="pane pane-left">
        <section className="pane-section">
          <div className="pane-head">
            <h2>Pieces</h2>
          </div>
          <p className="ed-help">Pick a piece, then press squares to place it. Press the same piece again to take it off. Or drag a piece from here onto the board.</p>
          {(['white', 'black'] as const).map((color) => (
            <div key={color} className="palette" role="group" aria-label={`${color} pieces`}>
              {ROLES.map((role) => {
                const t: Tool = { kind: 'piece', color, role };
                return (
                  <button
                    key={role}
                    className={`palette-piece${is(t) ? ' on' : ''}`}
                    aria-pressed={is(t)}
                    aria-label={`${color} ${role}`}
                    title={`${color} ${role}`}
                    onMouseDown={(e) => {
                      setTool(t);
                      api.current?.dragNewPiece({ color, role }, e.nativeEvent, true);
                    }}
                    onTouchStart={(e) => {
                      setTool(t);
                      api.current?.dragNewPiece({ color, role }, e.nativeEvent, true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setTool(t);
                    }}
                  >
                    <PieceBox className="palette-wrap" role={role} color={color} />
                  </button>
                );
              })}
            </div>
          ))}
          <div className="editor-tools">
            <button className={`btn quiet${tool.kind === 'move' ? ' on' : ''}`} aria-pressed={tool.kind === 'move'} onClick={() => setTool({ kind: 'move' })} title="Drag pieces around; drag one off the board to remove it">
              <Hand size={15} strokeWidth={1.9} aria-hidden="true" />
              Move pieces
            </button>
            <button className={`btn quiet${tool.kind === 'erase' ? ' on' : ''}`} aria-pressed={tool.kind === 'erase'} onClick={() => setTool({ kind: 'erase' })} title="Press a square to clear it">
              <Eraser size={15} strokeWidth={1.9} aria-hidden="true" />
              Erase
            </button>
          </div>
        </section>
        <section className="pane-section">
          <div className="pane-head">
            <h2>Board</h2>
          </div>
          <div className="editor-tools column">
            <button className="btn quiet" onClick={() => typed(START_FEN)}>
              <RotateCcw size={15} strokeWidth={1.9} aria-hidden="true" />
              Starting position
            </button>
            <button
              className="btn quiet"
              onClick={() => {
                // an empty board is a new position: the old one's castling and en passant do not carry over
                place(EMPTY);
                setCastling({ K: false, Q: false, k: false, q: false });
                setEp(undefined);
              }}
              disabled={placement === EMPTY}
            >
              <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
              Clear the board
            </button>
            <button className="btn quiet" onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}>
              <ArrowUpDown size={15} strokeWidth={1.9} aria-hidden="true" />
              Turn the board round
            </button>
          </div>
        </section>
      </aside>

      <section className="stage">
        <div className="board-stack">
          <div className="board-pair">
            <div className={`board-frame theme-${boardTheme} editing${tool.kind === 'move' ? '' : ' placing'}`}>
              <div ref={el} className="cg-wrap board" />
            </div>
          </div>
          <div className="under-board">
            <div className={`setup-state ${check.ok ? 'ok' : 'bad'}`} role="status">
              {check.ok ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />}
              <span>{check.ok ? `A legal position, ${turn} to move${check.over ? `. It is already over: ${check.over}` : ''}.` : check.reason}</span>
            </div>
          </div>
        </div>
      </section>

      <aside className="pane pane-right editor-side">
        <section className="pane-section">
          <div className="pane-head">
            <h2>Set up a position</h2>
          </div>
          <div className="ed-field">
            <span className="field-label" id="ed-turn">
              To move
            </span>
            <Segmented
              label="Side to move"
              value={turn}
              onChange={(v) => {
                setTurn(v);
                setEp(undefined);
              }}
              options={[
                { value: 'white', label: 'White' },
                { value: 'black', label: 'Black' },
              ]}
            />
          </div>
          <div className="ed-field">
            <span className="field-label">Castling still allowed</span>
            <div className="checks">
              {RIGHTS.map((r) => (
                <label key={r.key} className={`check${can[r.key] ? '' : ' off'}`} title={can[r.key] ? undefined : 'Only with the king and that rook on their starting squares'}>
                  <input type="checkbox" disabled={!can[r.key]} checked={can[r.key] && castling[r.key]} onChange={(e) => setCastling({ ...castling, [r.key]: e.target.checked })} />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
          {epChoices.length > 0 && (
            <div className="ed-field">
              <span className="field-label">En passant</span>
              <Segmented
                label="En passant square"
                value={ep && epChoices.includes(ep) ? ep : 'none'}
                onChange={(v) => setEp(v === 'none' ? undefined : v)}
                options={[{ value: 'none', label: 'Not possible' }, ...epChoices.map((sq) => ({ value: sq, label: `On ${sq}`, title: `The pawn that just moved two squares can be taken on ${sq}` }))]}
              />
            </div>
          )}
          <div className="ed-field">
            <label className="field-label" htmlFor="ed-fen">
              FEN
            </label>
            <input
              id="ed-fen"
              className="fen-input"
              spellCheck={false}
              autoComplete="off"
              value={fenText ?? fen}
              onChange={(e) => typed(e.target.value)}
              onBlur={() => setFenText(null)}
              aria-describedby="ed-fen-help"
            />
            <span className="ed-help" id="ed-fen-help">
              Paste a FEN here to load it, or copy this one.
            </span>
          </div>
        </section>
        <section className="pane-section editor-actions">
          <p className="fair">
            <ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
            <span>Not a position from a game you are still playing, Daily games included: both sites ban outside help.</span>
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!check.ok}
              onClick={() => {
                if (!check.ok) return;
                send({ type: 'setup', fen: check.fen });
                onClose();
              }}
            >
              Analyse this position
            </button>
          </div>
        </section>
      </aside>
    </main>
  );
}
