// The material beside the board (feature I17): the pieces one side has taken, and "+2" for the side
// ahead, on the edge of the board nearest that side. Counted from the position (core/material.ts).

import { materialBeside, type Color, type MaterialMode } from '@chess-coach/core';
import { PieceBox } from './San.tsx';

export function MaterialStrip({ fen, side, mode }: { fen: string; side: Color; mode: MaterialMode | 'off' }) {
  if (mode === 'off') return null;
  const m = materialBeside(fen, mode);
  if (!m) return null;
  const mine = m[side];
  const them: Color = side === 'white' ? 'black' : 'white';
  const words = `${side === 'white' ? 'White' : 'Black'}${mine.pieces.length ? ` has taken ${mine.pieces.length} ${mine.pieces.length === 1 ? 'piece' : 'pieces'}` : ' has taken nothing'}${mine.plus ? `, and is ${mine.plus} ${mine.plus === 1 ? 'point' : 'points'} ahead` : ''}`;
  return (
    <div className={`material-strip ${side}`} aria-label={words} title={words}>
      {mine.pieces.map((role, i) => (
        <PieceBox key={i} role={role} color={them} className={`material-piece${i > 0 && mine.pieces[i - 1] === role ? ' same' : ''}`} />
      ))}
      {mine.plus > 0 && <span className="material-plus">+{mine.plus}</span>}
    </div>
  );
}
