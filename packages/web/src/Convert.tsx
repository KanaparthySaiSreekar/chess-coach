// Win-the-won-game drills (feature C9): a clearly won position from one of the owner's games,
// played out against the engine. Nothing from the engine shows while the owner plays; the drill
// ends at checkmate, at a draw, at the move limit, or at the move that gives the win away.

import { Flag, RotateCcw, SkipForward, Undo2 } from 'lucide-react';
import type { Color } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { BoardCoach } from './OpeningCoach.tsx';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';

const side = (c: Color) => (c === 'white' ? 'White' : 'Black');

export function ConvertPanels({ s, sets }: { s: Store; sets: React.ReactNode }) {
  const v = s.convert;
  if (!v) return <main className="layout play puzzles" />;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const playing = v.status === 'playing';
  const over = v.status === 'over' && v.result;
  const good = over && (v.result!.outcome === 'converted' || v.result!.outcome === 'kept');

  return (
    <main className="layout play puzzles">
      <aside className="pane pane-left">
        {sets}
        <section className="pane-section">
          <header className="pane-head">
            <h2>Win the won game</h2>
          </header>
          <p className="muted">Positions from your own games where you were clearly winning and did not win. Play them out against the engine until it is mate.</p>
        </section>
        <p className="play-foot muted puzzle-count">
          {v.ready} {v.ready === 1 ? 'position' : 'positions'} · {v.due} due today
        </p>
      </aside>

      <section className="stage">
        <div className="board-stack">
          <div className="board-pair">
            <Board
              fen={v.fen}
              orientation={v.you}
              interactive={playing && v.yourTurn && !v.busy}
              movable={v.you}
              lastMove={v.lastMove}
              coachShapes={[]}
              bestArrows={[]}
              hoverSquares={[]}
              coordinates={setting(s, 'display.coordinates', true)}
              theme={setting(s, 'display.boardTheme', 'brown')}
              resync={s.resync + v.tries}
              onMove={(from, to, promotion) => send({ type: 'convert', action: 'move', from, to, promotion })}
            />
          </div>
          {v.status !== 'idle' && (
            <div className="under-board">
              <div className="turn">
                <span className={`turn-dot ${v.you}`} aria-hidden="true" />
                {playing ? (v.busy ? 'The engine is thinking…' : `You are ${side(v.you)}: win it`) : `You were ${side(v.you)}`}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="pane pane-right play-side puzzle-side">
        {v.status === 'idle' ? (
          <section className="pane-section">
            <p className="thread-empty-title">Win the won game</p>
            <p className="muted">{v.problem ?? 'Clearly won positions from your own games, played out against the engine.'}</p>
            {v.left > 0 && (
              <button className="btn primary big" onClick={() => send({ type: 'convert', action: 'next' })}>
                Start
              </button>
            )}
          </section>
        ) : (
          <section className="pane-section">
            <p className="puzzle-task">{playing ? 'You are clearly winning here. Win it: the engine defends.' : good ? 'Well played.' : 'Not this time.'}</p>
            {v.game && (
              <p className="muted">
                In your game {v.game.played ? (
                  <>
                    you played <San san={v.game.played} by={v.you} figurine={figurine} /> here
                    {v.game.threw ? ', which gave the win away; ' : ', and in the end '}
                  </>
                ) : (
                  'from here '
                )}
                the game was {v.game.outcome === 'draw' ? 'drawn' : 'lost'}.
              </p>
            )}
            {v.moves.length > 0 && (
              <p className="convert-moves" aria-label="The moves of the drill">
                {v.moves.map((m, i) => (
                  <span key={i}>
                    {i > 0 && ' '}
                    <San san={m.san} by={m.by} figurine={figurine} />
                  </span>
                ))}
              </p>
            )}
            {playing && (
              <p className="muted puzzle-tally">
                {v.movesLeft} of your moves left{v.again ? ' · a second go' : ''}
              </p>
            )}
            {over && (
              <>
                <div className={`puzzle-says ${good ? 'good' : 'wrong'}`} aria-live="polite">
                  {v.result!.text}
                </div>
                {v.result!.throwMove?.why && <p className="safety-verdict">{v.result!.throwMove.why}</p>}
              </>
            )}
            <div className="play-actions puzzle-actions">
              {playing ? (
                <button className="btn" onClick={() => send({ type: 'convert', action: 'resign' })}>
                  <Flag size={15} strokeWidth={1.9} aria-hidden="true" />
                  Stop here
                </button>
              ) : (
                <>
                  <button className="btn primary" onClick={() => send({ type: 'convert', action: 'next' })}>
                    <SkipForward size={15} strokeWidth={2} aria-hidden="true" />
                    Next
                  </button>
                  {v.result?.outcome === 'thrown' && (
                    <button className="btn" onClick={() => send({ type: 'convert', action: 'retry_before' })}>
                      <Undo2 size={15} strokeWidth={1.9} aria-hidden="true" />
                      Try that move again
                    </button>
                  )}
                  <button className="btn" onClick={() => send({ type: 'convert', action: 'retry_start' })}>
                    <RotateCcw size={15} strokeWidth={1.9} aria-hidden="true" />
                    From the start
                  </button>
                </>
              )}
            </div>
          </section>
        )}
        {/* the drill coach sees this board and can be asked any time; it never suggests a move while the owner plays (D105) */}
        {v.status !== 'idle' && v.id !== undefined && <BoardCoach s={s} shows="this position" thread={(m) => m.drill === v.id} suggestions={v.status === 'playing' ? ['What is my plan to finish this?'] : ['Why did the win slip away?']} />}
      </aside>
    </main>
  );
}
