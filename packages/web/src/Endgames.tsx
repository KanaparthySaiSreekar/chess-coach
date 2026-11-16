// The Endgames tab (feature F2; built early at the owner's request, 2026-11-15): the key endgames in
// the order of the ladder, each played out against the engine, which defends with the tablebases.
// The move that lets the win go (or loses the draw) ends the go at once, with the move that kept it:
// the engine's, never the coach's (D33).

import { Check, Flag, Lightbulb, MessageCircleQuestion, RotateCcw, Shuffle, SkipForward, Undo2 } from 'lucide-react';
import type { Color, EndgameView } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { Message } from './CoachPanel.tsx';
import { coachOn } from './Puzzles.tsx';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';

const side = (c: Color) => (c === 'white' ? 'White' : 'Black');
const GOAL: Record<EndgameView['ladder'][number]['positions'][number]['goal'], string> = { mate: 'mate', promote: 'queen', draw: 'hold' };
type RandomKind = NonNullable<EndgameView['ladder'][number]['random']>;

function Ladder({ v }: { v: EndgameView }) {
  if (v.ladder.length === 0) return <p className="muted">{v.problem ?? 'The endgame positions are being checked: they appear here in a moment.'}</p>;
  return (
    <ol className="eg-ladder">
      {v.ladder.map((t) => (
        <li key={t.id} className="eg-topic">
          <p className="eg-topic-name" title={t.about || undefined}>
            {t.name}
          </p>
          <ul>
            {t.positions.map((p) => (
              <li key={p.id}>
                <button className={`eg-pick${v.id === p.id ? ' on' : ''}`} onClick={() => send({ type: 'endgame', action: 'start', id: p.id })} title={`Play this position (${GOAL[p.goal]})`}>
                  <span className={`eg-mark${p.solved ? ' solved' : ''}`} aria-label={p.solved ? 'done before' : 'not done yet'}>
                    {p.solved ? <Check size={12} strokeWidth={2.6} aria-hidden="true" /> : null}
                  </span>
                  <span className="eg-pick-name">{p.name}</span>
                  <span className="muted eg-goal">{GOAL[p.goal]}</span>
                  {p.due && <span className="mode-dot" title="Due again today" />}
                </button>
              </li>
            ))}
            {t.random && (
              <li>
                <button className={`eg-pick eg-random${v.position?.random === t.random ? ' on' : ''}`} disabled={!!v.busy} onClick={() => send({ type: 'endgame', action: 'random', kind: t.random as RandomKind })} title="A new position each time, checked by the tablebases before you play it">
                  <span className="eg-mark random" aria-hidden="true">
                    <Shuffle size={10} strokeWidth={2.4} />
                  </span>
                  <span className="eg-pick-name">A new position</span>
                  <span className="muted eg-goal">mate</span>
                </button>
              </li>
            )}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function EndgamesTab({ s }: { s: Store }) {
  const v = s.endgame;
  if (!v) return <main className="layout play puzzles" />;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const playing = v.status === 'playing';
  const over = v.status === 'over' && v.result;
  const good = over && v.result!.outcome === 'done';
  // the go ended on a move of the owner's that let the goal go: it can be tried again from just before it
  const slipped = over && ['thrown', 'lost', 'drawn'].includes(v.result!.outcome) && v.moves.some((m) => m.by === v.you);
  const topic = v.position ? v.ladder.find((t) => (v.position!.random ? t.random === v.position!.random : t.positions.some((p) => p.id === v.id))) : undefined;
  const coach = coachOn(s);
  const thinking = coach && (s.status?.state === 'thinking' || s.status?.state === 'retrying');
  const said = v.id === undefined ? [] : s.thread.filter((m) => m.drill === v.id);

  return (
    <main className="layout play puzzles endgames-tab">
      <aside className="pane pane-left">
        <section className="pane-section">
          <header className="pane-head">
            <h2>Endgames</h2>
          </header>
          <p className="muted">The endings every player needs, easiest first. Play each against the engine; the tablebases judge every move.</p>
        </section>
        <section className="pane-section">
          <Ladder v={v} />
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
              onMove={(from, to, promotion) => send({ type: 'endgame', action: 'move', from, to, promotion })}
            />
          </div>
          {v.status !== 'idle' && (
            <div className="under-board">
              <div className="turn">
                <span className={`turn-dot ${v.you}`} aria-hidden="true" />
                {playing ? (v.busy ? 'The engine is thinking…' : `You are ${side(v.you)}`) : `You were ${side(v.you)}`}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="pane pane-right play-side puzzle-side">
        {v.status === 'idle' || !v.position ? (
          <section className="pane-section">
            <p className="thread-empty-title">Endgames</p>
            <p className="muted">{v.problem ?? 'Queen and rook mates, the square of the pawn, the opposition, Lucena and Philidor. Start with the next one, or pick any position on the ladder.'}</p>
            {v.busy && <p className="muted drill-thinking">Checking a new position with the tablebases…</p>}
            {v.ready > 0 && (
              <button className="btn primary big" onClick={() => send({ type: 'endgame', action: 'next' })}>
                Start
              </button>
            )}
          </section>
        ) : (
          <section className="pane-section eg-side">
            <p className="muted eg-where">
              {v.position.topicName} · {v.position.name}
            </p>
            <p className="puzzle-task">{v.position.task}</p>
            {topic?.about && !over && <p className="muted">{topic.about}</p>}
            {v.position.idea && <p className="opening-words idea">{v.position.idea}</p>}
            {v.moves.length > 0 && (
              <p className="convert-moves" aria-label="The moves so far">
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
                {v.position.goal === 'draw' ? `Hold for ${v.movesLeft} more ${v.movesLeft === 1 ? 'move' : 'moves'}` : `${v.movesLeft} of your moves left`}
              </p>
            )}
            {over && (
              <>
                <div className={`puzzle-says ${good ? 'good' : 'wrong'}`} aria-live="polite">
                  {v.result!.text}
                </div>
                {v.result!.better && (
                  <p className="safety-verdict">
                    The move that kept it: <San san={v.result!.better} by={v.you} figurine={figurine} />
                  </p>
                )}
              </>
            )}
            {coach && (said.length > 0 || thinking) && (
              <div className="drill-coach">
                {said.length > 0 && (
                  <div className="drill-thread" aria-live="polite">
                    {said.map((m) => (
                      <Message key={m.id} m={m} />
                    ))}
                  </div>
                )}
                {thinking && <p className="muted drill-thinking">The coach is thinking…</p>}
              </div>
            )}
            <div className="play-actions puzzle-actions">
              {playing ? (
                <>
                  {coach && (
                    <button className="btn" disabled={thinking || !v.yourTurn || !!v.busy} onClick={() => send({ type: 'endgame', action: 'ask' })} title="The coach asks you a question about this ending; it counts as a hint">
                      <MessageCircleQuestion size={15} strokeWidth={1.9} aria-hidden="true" />
                      Ask the coach
                    </button>
                  )}
                  {v.position.hasIdea && !v.position.idea && (
                    <button className="btn" onClick={() => send({ type: 'endgame', action: 'idea' })} title="The idea of this ending (counts as a hint)">
                      <Lightbulb size={15} strokeWidth={1.9} aria-hidden="true" />
                      Show the idea
                    </button>
                  )}
                  <button className="btn" onClick={() => send({ type: 'endgame', action: 'resign' })}>
                    <Flag size={15} strokeWidth={1.9} aria-hidden="true" />
                    Stop here
                  </button>
                </>
              ) : (
                <>
                  {v.position.random ? (
                    <button className="btn primary" disabled={!!v.busy} onClick={() => send({ type: 'endgame', action: 'random', kind: v.position!.random! })}>
                      <Shuffle size={15} strokeWidth={2} aria-hidden="true" />
                      A new position
                    </button>
                  ) : (
                    <button className="btn primary" onClick={() => send({ type: 'endgame', action: 'next' })}>
                      <SkipForward size={15} strokeWidth={2} aria-hidden="true" />
                      Next
                    </button>
                  )}
                  {slipped && (
                    <button className="btn" onClick={() => send({ type: 'endgame', action: 'retry_before' })} title="Back to the position before your last move">
                      <Undo2 size={15} strokeWidth={1.9} aria-hidden="true" />
                      Try that move again
                    </button>
                  )}
                  <button className="btn" onClick={() => send({ type: 'endgame', action: 'retry' })}>
                    <RotateCcw size={15} strokeWidth={1.9} aria-hidden="true" />
                    {slipped ? 'From the start' : 'Again'}
                  </button>
                </>
              )}
            </div>
          </section>
        )}
      </aside>
    </main>
  );
}
