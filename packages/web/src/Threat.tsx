// "What's the threat?" (feature C8): first the owner names the opponent's threat by making it on a
// board where it is the opponent's turn, then finds a move on the real position that deals with it.
// The threat, what it wins, and the verdict on the owner's move all come from the server (the engine).

import { Lightbulb, SkipForward } from 'lucide-react';
import type { Color } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const HINT_LABEL = { 1: 'Hint', 2: 'Another hint', 3: 'Show their threat' } as const;

export function ThreatPanels({ s, sets }: { s: Store; sets: React.ReactNode }) {
  const v = s.threat;
  if (!v) return <main className="layout play puzzles" />;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const them = other(v.you);
  const naming = v.status === 'naming';
  const defending = v.status === 'defending';
  const over = v.status === 'solved' || v.status === 'shown';
  const side = (c: Color) => (c === 'white' ? 'White' : 'Black');

  return (
    <main className="layout play puzzles">
      <aside className="pane pane-left">
        {sets}
        <section className="pane-section">
          <header className="pane-head">
            <h2>What's the threat?</h2>
          </header>
          <p className="muted">The first step of the routine on its own: before you choose a move, what does their last move want to do?</p>
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
              interactive={(naming || defending) && !v.busy}
              movable={naming ? them : v.you}
              lastMove={v.lastMove}
              coachShapes={v.shapes}
              bestArrows={[]}
              hoverSquares={[]}
              coordinates={setting(s, 'display.coordinates', true)}
              theme={setting(s, 'display.boardTheme', 'brown')}
              resync={s.resync + v.tries}
              onMove={(from, to, promotion) => send({ type: 'threat', action: 'try', from, to, promotion })}
            />
          </div>
          {v.status !== 'idle' && (
            <div className="under-board">
              <div className="turn">
                <span className={`turn-dot ${naming ? them : v.you}`} aria-hidden="true" />
                {naming ? <>If it were {side(them)}'s move: make their threat</> : <>You are {side(v.you)}, to move</>}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="pane pane-right play-side puzzle-side">
        {v.status === 'idle' ? (
          <section className="pane-section">
            <p className="thread-empty-title">What's the threat?</p>
            <p className="muted">{v.problem ?? 'Positions from your own games where a threat of theirs went unanswered.'}</p>
            {v.left > 0 && (
              <button className="btn primary big" onClick={() => send({ type: 'threat', action: 'next' })}>
                Start
              </button>
            )}
          </section>
        ) : (
          <section className="pane-section">
            <p className="puzzle-task">
              {naming
                ? 'What is their threat? Make the move they would play if it were their turn.'
                : v.status === 'solved'
                  ? 'Right: that deals with it.'
                  : v.status === 'shown'
                    ? 'A move that deals with it:'
                    : 'Now find a move that deals with it.'}
            </p>
            {v.feedback && (
              <div className={`puzzle-says ${v.feedback.tone}`} aria-live="polite">
                {v.feedback.san && (
                  <>
                    <San san={v.feedback.san} by={v.feedback.by ?? them} figurine={figurine} />{' '}
                  </>
                )}
                {v.feedback.text}
              </div>
            )}
            {v.busy && <p className="muted">Checking…</p>}
            {v.threat && !naming && (
              <p className="safety-verdict">
                <b className="unsafe">Their threat:</b> <San san={v.threat.san} by={them} figurine={figurine} />, {v.threat.what}.
              </p>
            )}
            {over && v.result && (
              <>
                {v.result.found && v.result.found.san !== v.result.best.san && (
                  <p className="safety-verdict">
                    <b className="safe">The engine’s first choice:</b> <San san={v.result.best.san} by={v.you} figurine={figurine} />.
                  </p>
                )}
                <p className="muted puzzle-tally">
                  In your game you played <San san={v.result.played.san} by={v.you} figurine={figurine} />: {v.result.played.why}
                </p>
              </>
            )}
            {!over && (v.hints > 0 || v.misses > 0) && (
              <p className="muted puzzle-tally">
                {v.hints > 0 && `${v.hints} ${v.hints === 1 ? 'hint' : 'hints'}`}
                {v.hints > 0 && v.misses > 0 && ' · '}
                {v.misses > 0 && `${v.misses} ${v.misses === 1 ? 'miss' : 'misses'}`}
              </p>
            )}
            <div className="play-actions puzzle-actions">
              {over ? (
                <button className="btn primary" onClick={() => send({ type: 'threat', action: 'next' })}>
                  <SkipForward size={15} strokeWidth={2} aria-hidden="true" />
                  Next
                </button>
              ) : naming ? (
                <button className="btn" disabled={v.busy} onClick={() => send({ type: 'threat', action: 'hint' })}>
                  <Lightbulb size={15} strokeWidth={1.9} aria-hidden="true" />
                  {HINT_LABEL[v.nextHint ?? 1]}
                </button>
              ) : (
                v.misses > 0 && (
                  <button className="btn" disabled={v.busy} onClick={() => send({ type: 'threat', action: 'show' })}>
                    Show a move
                  </button>
                )
              )}
            </div>
          </section>
        )}
      </aside>
    </main>
  );
}
