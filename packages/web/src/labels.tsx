// How a move label looks (feature A17): one colour and one small symbol per label, used for the
// badge on the board, the mark in the move list and the line under the board. The label itself is
// worked out on the server from the engine's grading; nothing here decides anything.

import { LABEL_NAME, LABEL_PHRASE, type Color, type Judged, type MoveLabel } from '@chess-coach/core';
import { San } from './San.tsx';

type Look = { color: string; glyph: string };

// white marks drawn in a 100 x 100 box, on a disc of the label's colour
const text = (t: string, size = 62, dy = 0) => `<text x="50" y="${71 + dy}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="#fff">${t}</text>`;
const STAR = '<path fill="#fff" d="M50 17 59.6 38.8 83.3 41.2 65.5 57 70.6 80.3 50 68.4 29.4 80.3 34.5 57 16.7 41.2 40.4 38.8z"/>';
const CHECK = '<path fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" d="M27 52 43 68 73 34"/>';
const DOUBLE_CHECK = '<path fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" d="M17 53 31 67 57 37M45 62 50 67 83 33"/>';
const BOOK = '<path fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round" d="M50 31C42 25 31 24 21 27V71C31 68 42 69 50 75 58 69 69 68 79 71V27C69 24 58 25 50 31ZM50 31V75"/>';
const CROSS = '<path fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" d="M32 32 68 68M68 32 32 68"/>';
const ARROW = '<path fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" d="M24 50H74M56 31 76 50 56 69"/>';

export const LABEL_LOOK: Record<MoveLabel, Look> = {
  brilliant: { color: '#1aa5a0', glyph: text('!!', 60) },
  great: { color: '#4a86c5', glyph: text('!', 66) },
  best: { color: '#6aa630', glyph: STAR },
  excellent: { color: '#6aa630', glyph: DOUBLE_CHECK },
  good: { color: '#7d9f73', glyph: CHECK },
  book: { color: '#a5805a', glyph: BOOK },
  inaccuracy: { color: '#e0a92b', glyph: text('?!', 56) },
  mistake: { color: '#e2852a', glyph: text('?', 66) },
  miss: { color: '#e06a4e', glyph: CROSS },
  blunder: { color: '#d33b34', glyph: text('??', 60) },
  forced: { color: '#7f8894', glyph: ARROW },
};

/** The badge for chessground: a small disc on the top-right corner of the square the piece landed on. */
export function badgeSvg(label: MoveLabel): string {
  const look = LABEL_LOOK[label];
  return `<g transform="translate(62 -8) scale(0.46)"><circle cx="50" cy="50" r="50" fill="${look.color}" stroke="rgba(0,0,0,0.35)" stroke-width="3"/>${look.glyph}</g>`;
}

/** The same disc for use in text: the move list, the lines, the caption. */
export function Badge({ label, small }: { label: MoveLabel; small?: boolean }) {
  const look = LABEL_LOOK[label];
  return (
    <svg className={`badge${small ? ' small' : ''}`} viewBox="0 0 100 100" role="img" aria-label={LABEL_NAME[label]}>
      <title>{LABEL_NAME[label]}</title>
      <circle cx="50" cy="50" r="50" fill={look.color} />
      <g dangerouslySetInnerHTML={{ __html: look.glyph }} />
    </svg>
  );
}

/** The line under the board: "♘f3 is the best move", "♕h5 is a blunder: it loses a queen. ♘f3 was best." */
export function Verdict({ san, by, judged, figurine, alt, betterShown }: { san: string; by: Color; judged: Judged; figurine: boolean; alt?: boolean; betterShown?: boolean }) {
  const look = LABEL_LOOK[judged.label];
  const bad = judged.label === 'inaccuracy' || judged.label === 'mistake' || judged.label === 'miss' || judged.label === 'blunder';
  const mover: Color = by;
  return (
    <div className="verdict" style={{ borderColor: look.color }}>
      <Badge label={judged.label} />
      <span>
        {alt && <span className="alt-tag">Alternative</span>}
        <strong className="verdict-move">
          <San san={san} by={mover} figurine={figurine} />
        </strong>{' '}
        <span style={{ color: look.color, fontWeight: 700 }}>{LABEL_PHRASE[judged.label]}</span>
        {judged.why ? `: ${judged.why}.` : '.'}
        {judged.best && (
          <>
            {' '}
            {/* in the colour of its arrow on the board, when that is drawn */}
            <strong className={betterShown ? 'better-move' : undefined}>
              <San san={judged.best} by={mover} figurine={figurine} />
            </strong>{' '}
            {bad ? 'was best.' : "was the engine's first choice."}
          </>
        )}
      </span>
    </div>
  );
}
