// Speed runs (feature I4): streak (one wrong move ends it) and timed (a wrong move costs ten
// seconds). Silent: no hints, nothing explained until the run is over, and the coach stays out.
// Off by default; switched on in Settings.

import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { Board } from './Board.tsx';
import { send, setting, type Store } from './store.ts';

/** Seconds left until `endsAt`, ticking. */
function useLeft(endsAt: string | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000)) : undefined;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function SpeedPanels({ s, sets, mode }: { s: Store; sets: React.ReactNode; mode: 'streak' | 'timed' }) {
  const v = s.speed;
  const left = useLeft(v?.status === 'running' ? v.endsAt : undefined);
  if (!v) return <main className="layout play puzzles" />;
  const running = v.status === 'running';
  const name = mode === 'streak' ? 'Streak' : 'Timed run';

  return (
    <main className="layout play puzzles">
      <aside className="pane pane-left">
        {sets}
        <section className="pane-section">
          <header className="pane-head">
            <h2>{name}</h2>
          </header>
          <p className="muted">
            {mode === 'streak'
              ? 'Puzzles that get harder each time. One wrong move ends the run.'
              : 'As many puzzles as you can before the time is up. A wrong move costs ten seconds.'}{' '}
            No hints, and nothing is explained until the end. These do not move your schedule or your level.
          </p>
        </section>
        <p className="play-foot muted puzzle-count">Best so far: {mode === 'streak' ? v.best.streak : v.best.timed}</p>
      </aside>

      <section className="stage">
        <div className="board-stack">
          <div className="board-pair">
            <Board
              fen={v.fen}
              orientation={v.you}
              interactive={running && v.yourTurn}
              movable={v.you}
              lastMove={v.lastMove}
              coachShapes={[]}
              bestArrows={[]}
              hoverSquares={[]}
              coordinates={setting(s, 'display.coordinates', true)}
              theme={setting(s, 'display.boardTheme', 'brown')}
              resync={s.resync + v.tries}
              onMove={(from, to, promotion) => send({ type: 'speed', action: 'move', from, to, promotion })}
            />
          </div>
          {running && (
            <div className="under-board">
              <div className="turn">
                <span className={`turn-dot ${v.you}`} aria-hidden="true" />
                Your move
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="pane pane-right play-side puzzle-side">
        <section className="pane-section">
          {v.status === 'idle' ? (
            <>
              <p className="thread-empty-title">{name}</p>
              <p className="muted">{v.problem ?? (v.enabled ? 'Press start when you are ready.' : 'Speed runs are off. They can be switched on in Settings, under Puzzles.')}</p>
              {v.enabled && !v.problem && (
                <button className="btn primary big" onClick={() => send({ type: 'speed', action: 'start', mode })}>
                  Start
                </button>
              )}
            </>
          ) : (
            <>
              <p className="speed-score" aria-live="polite">
                <span>{v.solved}</span> solved
                {mode === 'timed' && left !== undefined && <span className="speed-clock">{clock(left)}</span>}
              </p>
              {running && <p className="puzzle-task">Find the best move.</p>}
              {running && v.last && <div className={`puzzle-says ${v.last === 'solved' ? 'good' : 'wrong'}`}>{v.last === 'solved' ? 'Solved.' : 'Missed: ten seconds off.'}</div>}
              {v.status === 'over' && (
                <>
                  <div className="puzzle-says answer" aria-live="polite">
                    Run over: {v.solved} solved{v.misses ? `, ${v.misses} missed` : ''}.{' '}
                    {v.solved > 0 && v.solved >= (mode === 'streak' ? v.best.streak : v.best.timed) ? 'Your best yet.' : ''}
                  </div>
                  {v.log && v.log.length > 0 && (
                    <ol className="speed-log">
                      {v.log.map((r, i) => (
                        <li key={i} className={r.solved ? 'good' : 'missed'}>
                          {r.rating} · {r.solved ? 'solved' : `missed (the answer began ${r.answer})`}
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
              <div className="play-actions">
                {running ? (
                  <button className="btn" onClick={() => send({ type: 'speed', action: 'stop' })}>
                    <Square size={14} strokeWidth={2} aria-hidden="true" />
                    Stop
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => send({ type: 'speed', action: 'start', mode })}>
                    Again
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </aside>
    </main>
  );
}
