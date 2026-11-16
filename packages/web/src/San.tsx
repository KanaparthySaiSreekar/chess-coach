// A move written with a small picture of the piece instead of its letter (feature I13):
// "♘f3" rather than "Nf3". The pictures are the board's own pieces, in the mover's colour.

import type { Color } from '@chess-coach/core';
import { setting, useStore } from './store.ts';

const ROLE: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };
const ROLES = new Set(['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']);

/**
 * One of chessground's piece pictures, in a box of the given class. Its stylesheet draws
 * `<piece class="knight white">` inside a `.cg-wrap`; the tag is written as HTML because React
 * warns about a tag it does not know. Only the fixed role and colour names ever go into it.
 */
export function PieceBox({ role, color, className }: { role: string; color: Color; className: string }) {
  const safeRole = ROLES.has(role) ? role : 'pawn';
  const safeColor = color === 'black' ? 'black' : 'white';
  return <span className={`cg-wrap ${className}`} role="img" aria-label={safeRole} dangerouslySetInnerHTML={{ __html: `<piece class="${safeRole} ${safeColor}"></piece>` }} />;
}

function Fig({ letter, color }: { letter: string; color: Color }) {
  return <PieceBox className="fig" role={ROLE[letter]!} color={color} />;
}

/** Is figurine notation switched on? */
export function useFigurine(): boolean {
  return setting(useStore(), 'display.notation', 'figurine') === 'figurine';
}

/** One move in SAN. `by` is the side that plays it. */
export function San({ san, by, figurine }: { san: string; by: Color; figurine: boolean }) {
  if (!figurine) return <>{san}</>;
  const piece = /^([KQRBN])(.*)$/.exec(san);
  const rest = piece ? piece[2]! : san;
  const promo = /^(.*=)([QRBN])(.*)$/.exec(rest);
  return (
    <span className="fig-san" title={san}>
      {piece && <Fig letter={piece[1]!} color={by} />}
      {promo ? (
        <>
          {promo[1]}
          <Fig letter={promo[2]!} color={by} />
          {promo[3]}
        </>
      ) : (
        rest
      )}
    </span>
  );
}

/** A run of moves from one position: who plays each follows from whose turn it was at the start. */
export function SanLine({ sans, fenBefore, figurine }: { sans: string[]; fenBefore: string; figurine: boolean }) {
  const first: Color = fenBefore.split(' ')[1] === 'b' ? 'black' : 'white';
  const other: Color = first === 'white' ? 'black' : 'white';
  return (
    <>
      {sans.map((san, i) => (
        <span key={i} className="san-in-line">
          <San san={san} by={i % 2 === 0 ? first : other} figurine={figurine} />{' '}
        </span>
      ))}
    </>
  );
}
