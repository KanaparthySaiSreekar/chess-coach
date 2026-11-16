// The eval bar (feature A6): who is better, as a bar beside the board. Its length is White's
// winning chances, the same measure every verdict in the app uses. The engine's number shows only
// when engine numbers are switched on; otherwise the reading is given in words.

import { gaugeNumber, gaugeWords, type Color, type Gauge } from '@chess-coach/core';

export function EvalBar({ gauge, orientation, numbers, note }: { gauge: Gauge | undefined; orientation: Color; numbers: boolean; note?: string }) {
  const white = gauge ? Math.max(2, Math.min(98, gauge.white)) : 50;
  const words = gauge ? gaugeWords(gauge) : (note ?? 'The engine is looking…');
  const whiteAhead = (gauge?.white ?? 50) >= 50;
  // the number sits at the end of the side that is ahead, like on Lichess and Chess.com
  const number = gauge && numbers ? gaugeNumber(gauge) : gauge?.mate !== undefined ? `M${Math.abs(gauge.mate)}` : '';
  const whiteAtBottom = orientation === 'white';
  return (
    <div className={`evalbar${gauge ? '' : ' waiting'}${whiteAtBottom ? '' : ' flipped'}`} role="img" aria-label={`Eval bar: ${words}`} title={words}>
      <div className="evalbar-white" style={{ height: `${white}%` }} />
      <div className="evalbar-mid" />
      {number && <span className={`evalbar-num ${whiteAhead ? 'for-white' : 'for-black'}`}>{number}</span>}
    </div>
  );
}
