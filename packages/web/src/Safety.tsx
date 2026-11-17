// The safety check (feature C7): the board with the move or moves in question drawn as arrows,
// and two answers. Nothing says which move is safe until the owner has answered; then each move's
// verdict is given in the engine's words.
//
// With the listing step on (safety.listFirst), one move is judged in two steps: first the board
// shows the position after it, and the owner makes each of the opponent's checks and captures, and
// with safety.listThreats their threats, there (every piece goes back); then the ones missed are
// drawn, and the question is asked.

import type { Color, Shape } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { BoardCoach } from './OpeningCoach.tsx';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';

const ARROW_STYLES: Shape['style'][] = ['idea', 'move'];
const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

export function SafetyPanels({ s, sets }: { s: Store; sets: React.ReactNode }) {
  const v = s.safety;
  if (!v) return <main className="layout play puzzles" />;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const asking = v.status === 'asking';
  const answered = v.status === 'answered' && v.result;
  const list = v.list;
  const listing = asking && list?.stage === 'listing';
  const by = v.you;
  const them = other(v.you);
  // while asking, every move gets the same neutral arrow; afterwards the losing move is drawn in red.
  // In the listing step the board is the position after the move: their checks and captures are drawn
  // as the owner finds them (blue), and the ones missed in red once the owner says that is all.
  const shapes: Shape[] = list
    ? [...list.found.map((r): Shape => ({ from: r.from, to: r.to, style: 'move' })), ...(list.missed ?? []).map((r): Shape => ({ from: r.from, to: r.to, style: 'danger' }))]
    : v.candidates.map((c, i) => {
        const verdict = v.result?.candidates.find((x) => x.san === c.san);
        return { from: c.from, to: c.to, style: verdict ? (verdict.safe ? 'good' : 'danger') : v.question === 'which_loses' ? ARROW_STYLES[i]! : 'idea' };
      });
  const move = v.candidates[0];

  return (
    <main className="layout play puzzles">
      <aside className="pane pane-left">
        {sets}
        <section className="pane-section">
          <header className="pane-head">
            <h2>Safety check</h2>
          </header>
          <p className="muted">The last step of the routine on its own: before a move is played, what could they capture, check or threaten?</p>
        </section>
        <p className="play-foot muted puzzle-count">
          {v.ready} safety {v.ready === 1 ? 'check' : 'checks'} · {v.due} due today
        </p>
      </aside>

      <section className="stage">
        <div className="board-stack">
          <div className="board-pair">
            <Board
              fen={list ? list.fen : v.fen}
              orientation={v.you}
              interactive={!!listing}
              movable={them}
              lastMove={list?.lastMove}
              coachShapes={shapes}
              bestArrows={[]}
              hoverSquares={[]}
              coordinates={setting(s, 'display.coordinates', true)}
              theme={setting(s, 'display.boardTheme', 'brown')}
              resync={s.resync + (list?.tries ?? 0)}
              onMove={(from, to) => send({ type: 'safety', action: 'try', from, to })}
            />
          </div>
          {v.status !== 'idle' && (
            <div className="under-board">
              <div className="turn">
                <span className={`turn-dot ${list ? them : v.you}`} aria-hidden="true" />
                {listing ? <>Their move: make their {list?.threats ? 'checks, captures and threats' : 'checks and captures'}</> : list ? <>After your move: {them === 'white' ? 'White' : 'Black'} to move</> : <>You are {v.you === 'white' ? 'White' : 'Black'}, to move</>}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="pane pane-right play-side puzzle-side">
        {v.status === 'idle' ? (
          <section className="pane-section">
            <p className="thread-empty-title">Is this move safe?</p>
            <p className="muted">{v.problem ?? 'Moves from your own games, to judge before they are played.'}</p>
            {v.left > 0 && (
              <button className="btn primary big" onClick={() => send({ type: 'safety', action: 'next' })}>
                Start
              </button>
            )}
          </section>
        ) : (
          <section className="pane-section">
            <p className="puzzle-task">
              {v.question === 'is_safe' ? (
                <>
                  You are thinking of <San san={move!.san} by={by} figurine={figurine} />. {listing ? 'Before you decide: what can they do after it?' : 'Is it safe?'}
                </>
              ) : (
                <>
                  <San san={v.candidates[0]!.san} by={by} figurine={figurine} /> or <San san={v.candidates[1]!.san} by={by} figurine={figurine} />: which one is not safe?
                </>
              )}
            </p>
            {listing && (
              <>
                <p className="muted">
                  The board shows the position after your move. Make each of their checks and captures{list!.threats ? ', and each threat: a move that attacks something of yours it could then win' : ''}, one at a time; every piece goes back.
                </p>
                {list!.note && (
                  <div className={`puzzle-says ${list!.note.good ? 'good' : 'wrong'}`} aria-live="polite">
                    {list!.note.san && <San san={list!.note.san} by={them} figurine={figurine} />} {list!.note.text}
                  </div>
                )}
                <Found list={list!.found} by={them} figurine={figurine} />
                <div className="play-actions">
                  <button className="btn primary" onClick={() => send({ type: 'safety', action: 'listed' })}>
                    That's all
                  </button>
                </div>
              </>
            )}
            {list && list.stage === 'listed' && (
              <>
                <Found list={list.found} by={them} figurine={figurine} />
                <p className="safety-tally" aria-live="polite">
                  {list.found.length + (list.missed?.length ?? 0) === 0 ? (
                    list.threats ? 'They have no checks, captures or threats after it.' : 'They have no checks or captures after it.'
                  ) : list.missed?.length ? (
                    <>
                      You found {list.found.length} of {list.found.length + list.missed.length}. Missed:{' '}
                      {list.missed.map((r, i) => (
                        <span key={r.san}>
                          {i > 0 && ', '}
                          <San san={r.san} by={them} figurine={figurine} />
                        </span>
                      ))}{' '}
                      (red on the board).
                    </>
                  ) : (
                    `You found all ${list.found.length}.`
                  )}
                </p>
              </>
            )}
            {asking && !listing && (
              <div className="play-actions">
                {v.question === 'is_safe' ? (
                  <>
                    <button className="btn" onClick={() => send({ type: 'safety', action: 'answer', safe: true })}>
                      Safe
                    </button>
                    <button className="btn" onClick={() => send({ type: 'safety', action: 'answer', safe: false })}>
                      Not safe
                    </button>
                  </>
                ) : (
                  v.candidates.map((c) => (
                    <button key={c.san} className="btn" onClick={() => send({ type: 'safety', action: 'answer', pick: c.san })}>
                      <San san={c.san} by={by} figurine={figurine} />
                    </button>
                  ))
                )}
              </div>
            )}
            {answered && (
              <>
                <div className={`puzzle-says ${v.result!.right ? 'good' : 'wrong'}`} aria-live="polite">
                  {v.result!.right ? 'Right.' : 'Not quite.'}
                </div>
                {v.result!.candidates.map((c) => (
                  <p key={c.san} className="safety-verdict">
                    <b className={c.safe ? 'safe' : 'unsafe'}>{c.safe ? 'Safe' : 'Not safe'}:</b> {c.why}
                  </p>
                ))}
                {v.result!.played && (
                  <p className="muted puzzle-tally">
                    In your game you played <San san={v.result!.played} by={by} figurine={figurine} />.
                  </p>
                )}
                <div className="play-actions">
                  <button className="btn primary" onClick={() => send({ type: 'safety', action: 'next' })}>
                    Next
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {/* the drill coach sees this board and can be asked any time; it never rules for the owner (D105) */}
        {v.status !== 'idle' && v.id !== undefined && <BoardCoach s={s} shows="this safety check" thread={(m) => m.drill === v.id} suggestions={asking ? ['What should I look at after this move?'] : ['Why is it safe, or not?']} />}
      </aside>
    </main>
  );
}

/** The checks and captures the owner has made so far. */
function Found({ list, by, figurine }: { list: { san: string }[]; by: Color; figurine: boolean }) {
  if (!list.length) return null;
  return (
    <p className="safety-found">
      <span className="muted">Found: </span>
      {list.map((r, i) => (
        <span key={r.san}>
          {i > 0 && ', '}
          <San san={r.san} by={by} figurine={figurine} />
        </span>
      ))}
    </p>
  );
}
