// The opening explorer on the analysis board (features I3, D6; PLAN WP 8.2): what players at the
// owner's level play from the position on the board, what masters play, and what the owner played
// in their own games. Counts of games, never a verdict. A click on a move plays it on the board.

import type { Color, ExplorerRow, ExplorerSource, ExplorerView } from '@chess-coach/core';
import { San } from './San.tsx';
import { send } from './store.ts';
import { Segmented } from './ui.tsx';

const SOURCES: { value: ExplorerSource; label: string; title: string }[] = [
  { value: 'level', label: 'My level', title: 'Lichess games between players around your rating' },
  { value: 'masters', label: 'Masters', title: 'Over-the-board games between players rated 2200 and up' },
  { value: 'mine', label: 'My games', title: 'Your own games, as the side at the bottom of the board' },
];

const PROMOTION: Record<string, 'queen' | 'rook' | 'bishop' | 'knight'> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };

const count = (n: number) => n.toLocaleString('en-US');
/** "157M", "6.8M", "334k", "912": the panel is narrow; the full count is in the tooltip */
const short = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: n >= 1e6 && n < 1e7 ? 1 : 0 }).format(n);

/** "48% White, 5% drawn, 47% Black" */
function resultWords(r: NonNullable<ExplorerRow['result']>): string {
  return `White won ${r.white}%, ${r.draws}% drawn, Black won ${r.black}%`;
}

/** How the games went: White's wins, the draws, Black's wins, side by side (the Lichess picture). */
function ResultBar({ result }: { result: NonNullable<ExplorerRow['result']> }) {
  const parts: { key: 'white' | 'draws' | 'black'; value: number }[] = [
    { key: 'white', value: result.white },
    { key: 'draws', value: result.draws },
    { key: 'black', value: result.black },
  ];
  return (
    <span className="ex-bar" role="img" aria-label={resultWords(result)} title={resultWords(result)}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.key} className={`ex-seg ${p.key}`} style={{ flexGrow: p.value }}>
            {p.value >= 22 ? `${p.value}%` : ''}
          </span>
        ))}
    </span>
  );
}

export function ExplorerPane({ view, fen, turn, figurine }: { view: ExplorerView; fen: string; turn: Color; figurine: boolean }) {
  const current = view.fen === fen;
  const table = current ? view.table : undefined;
  const play = (uci: string) => send({ type: 'move', from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: PROMOTION[uci[4] ?? ''] });
  const whose = view.source === 'mine' && view.you ? (view.yourMove ? 'Your moves here' : 'What your opponents played here') : null;
  return (
    <section className="pane-section explorer" aria-label="Opening explorer">
      <header className="pane-head">
        <h2>Explorer</h2>
        <button className="link" onClick={() => send({ type: 'setting', key: 'explorer.show', value: false })}>
          Hide
        </button>
      </header>
      <Segmented className="wide ex-sources" value={view.source} options={SOURCES} onChange={(v) => send({ type: 'setting', key: 'explorer.source', value: v })} label="Whose games the explorer counts" />
      {view.about && <p className="ex-about">{view.about}</p>}
      {!current || view.state === 'loading' ? (
        <p className="muted ex-note">Asking Lichess…</p>
      ) : view.state === 'off' || view.state === 'none' ? (
        <p className="muted ex-note">{view.note}</p>
      ) : table ? (
        <>
          {view.note && <p className="ex-note guess">{view.note}</p>}
          {whose && <p className="ex-whose">{whose}</p>}
          <table className={`ex-table${table.guess ? ' guess' : ''}`}>
            <thead>
              <tr>
                <th scope="col">Move</th>
                <th scope="col" className="num">
                  {table.guess ? 'Chosen' : 'Played'}
                </th>
                {!table.guess && (
                  <>
                    <th scope="col" className="num">
                      Games
                    </th>
                    <th scope="col">Results</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.uci} className="ex-row" tabIndex={0} title={`Play ${r.san} on the board`} onClick={() => play(r.uci)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), play(r.uci))}>
                  <td className="ex-move">
                    <San san={r.san} by={turn} figurine={figurine} />
                  </td>
                  <td className="num">{r.share < 1 ? '<1%' : `${Math.round(r.share)}%`}</td>
                  {!table.guess && (
                    <>
                      <td className="num muted" title={`${count(r.games)} games`}>
                        {short(r.games)}
                      </td>
                      <td>{r.result && <ResultBar result={r.result} />}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!table.guess && (
            <p className="muted ex-total">
              <span>{table.games === 1 ? '1 game' : `${count(table.games)} games`} reached this position.</span>{' '}
              <span className="ex-legend" aria-hidden="true">
                <span className="ex-key white" />
                White won <span className="ex-key draws" />
                drawn <span className="ex-key black" />
                Black won
              </span>
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
