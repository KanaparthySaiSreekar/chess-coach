// The opening drill (features D3, D4; PLAN WP 8.8): the owner's repertoire one position at a time.
// A new card shows the move, its why and the opponent's idea; a card due again asks for the move;
// now and then a right answer is followed by "why this move?", in the owner's own words.

import { useState } from 'react';
import { SkipForward } from 'lucide-react';
import { lineText, type Color, type Shape, type WordsBy } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { Message } from './CoachPanel.tsx';
import { OpeningCoach } from './OpeningCoach.tsx';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';


const side = (c: Color) => (c === 'white' ? 'White' : 'Black');

/** Who wrote a move's words (D13), as the page says it: generated text is never shown as if it came from a book. */
export const WORDS_BY: Record<WordsBy, string> = {
  facts: "Phrased by the app from the engine's checked facts",
  claude: "Written by Claude from the engine's checked facts, and checked against them",
  owner: 'Your own words',
};

/** What the drill draws from (D11): everything, one repertoire, or one of its chapters. */
function Scope({ s }: { s: Store }) {
  const v = s.opening;
  const scopes = v?.scopes ?? [];
  if (!v || !scopes.length) return null;
  const value = v.scope?.repertoire === null || !v.scope ? 'all' : `${v.scope.repertoire}${v.scope.chapters?.length ? `|${v.scope.chapters[0]}` : ''}`;
  const choose = (x: string) => {
    if (x === 'all') return send({ type: 'opening', action: 'scope', repertoire: null });
    const [id, chapter] = [Number(x.split('|')[0]), x.includes('|') ? x.slice(x.indexOf('|') + 1) : undefined];
    send({ type: 'opening', action: 'scope', repertoire: id, chapters: chapter ? [chapter] : undefined });
  };
  return (
    <label className="opening-scope">
      <span className="muted">Practise</span>
      <select aria-label="What to practise" value={value} onChange={(e) => choose(e.target.value)}>
        <option value="all">Everything (and the traps)</option>
        {scopes.map((r) => (
          <optgroup key={r.id} label={`${r.name} (${side(r.colour)})`}>
            <option value={String(r.id)}>All of {r.name}</option>
            {r.chapters.map((c) => (
              <option key={c.name} value={`${r.id}|${c.name}`}>
                {c.name} · {c.fresh} new{c.due ? `, ${c.due} due` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function OpeningPanels({ s, sets }: { s: Store; sets: React.ReactNode }) {
  const v = s.opening;
  const [words, setWords] = useState('');
  if (!v) return <main className="layout play puzzles" />;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const asking = v.status === 'ask' || v.status === 'learn' || v.status === 'wrong';
  const shown = v.move && (v.status === 'learn' || v.status === 'wrong');
  const arrows: Shape[] = shown ? [{ from: v.move!.from, to: v.move!.to, style: 'good' }] : [];
  const after = (v.status === 'right' || v.status === 'why') && v.after;
  const opponent: Color = v.you === 'white' ? 'black' : 'white';

  return (
    <main className="layout play puzzles">
      <aside className="pane pane-left">
        {sets}
        <section className="pane-section">
          <header className="pane-head">
            <h2>Openings</h2>
          </header>
          <p className="muted">Your repertoire, one position at a time: play your move, and know why. Cards come from the lines you approve, and the trap pack.</p>
          <Scope s={s} />
        </section>
        <p className="play-foot muted puzzle-count">
          {v.ready} {v.ready === 1 ? 'card' : 'cards'} · {v.due} due today
          {v.newPerDay !== undefined ? ` · ${v.newToday ?? 0} of ${v.newPerDay} new today` : ''}
        </p>
      </aside>

      <section className="stage">
        <div className="board-stack">
          <div className="board-pair">
            <Board
              fen={after ? v.after! : v.fen}
              orientation={v.you}
              interactive={asking}
              movable={v.you}
              lastMove={after && v.move ? [v.move.from, v.move.to] : undefined}
              coachShapes={arrows}
              bestArrows={[]}
              hoverSquares={[]}
              coordinates={setting(s, 'display.coordinates', true)}
              theme={setting(s, 'display.boardTheme', 'brown')}
              resync={s.resync + v.tries}
              onMove={(from, to, promotion) => send({ type: 'opening', action: 'move', from, to, promotion })}
            />
          </div>
          {v.status !== 'idle' && (
            <div className="under-board">
              <div className="turn">
                <span className={`turn-dot ${v.you}`} aria-hidden="true" />
                You are {side(v.you)}
                {v.repertoire ? <span className="muted"> · {v.repertoire}</span> : null}
                {v.chapter ? <span className="muted"> · {v.chapter}</span> : null}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="pane pane-right play-side puzzle-side">
        {v.status === 'idle' ? (
          <section className="pane-section">
            <p className="thread-empty-title">Openings</p>
            <p className="muted">{v.problem ?? 'Your repertoire, one position at a time.'}</p>
            {v.left > 0 && (
              <button className="btn primary big" onClick={() => send({ type: 'opening', action: 'next' })}>
                Start
              </button>
            )}
          </section>
        ) : (
          <section className="pane-section opening-card">
            {v.line.length > 0 && (
              <p className="opening-line muted" aria-label="How the position was reached">
                {lineText(v.startFen, v.line)}
              </p>
            )}
            {v.trap?.name && v.status !== 'ask' && <p className="opening-trap">Trap: {v.trap.name}</p>}
            <p className="puzzle-task">
              {v.status === 'learn'
                ? v.trap
                  ? v.trap.kind === 'avoid'
                    ? 'A trap they set at your level. Here you play the move shown. Play it on the board.'
                    : 'Their last move was a mistake. Here you play the move shown. Play it on the board.'
                  : 'A new position: here you play the move shown. Play it on the board.'
                : v.status === 'ask'
                  ? v.trap
                    ? v.trap.kind === 'avoid'
                      ? 'They are setting a trap. What do you play?'
                      : 'Their last move was a mistake. What do you play?'
                    : 'Your move in this position?'
                  : v.status === 'wrong'
                    ? 'Not this one. Play the move shown.'
                    : v.status === 'why'
                      ? v.trap?.kind === 'avoid'
                        ? 'Right. What were they hoping you would play?'
                        : 'Right. Why this move?'
                      : 'Right.'}
            </p>
            {v.punish && asking && <p className="opening-punish">Their last move was a mistake: this is how you punish it.</p>}
            {v.played && v.status === 'wrong' && (
              <p className="muted">
                You played <San san={v.played} by={v.you} figurine={figurine} />.
              </p>
            )}
            {v.move && v.status !== 'ask' && (
              <p className="opening-move">
                The move: <San san={v.move.san} by={v.you} figurine={figurine} />
                {v.book !== undefined && <span className="muted"> · played in {v.book.toLocaleString('en-US')} of the masters' games</span>}
              </p>
            )}
            {v.status === 'why' && !v.why && (
              <div className="opening-why">
                <textarea aria-label="Why this move, in your words" rows={2} value={words} onChange={(e) => setWords(e.target.value)} placeholder={v.trap?.kind === 'avoid' ? 'In your own words: what were they hoping for?' : 'In your own words: what does it do?'} />
                <button className="btn primary" onClick={() => (send({ type: 'opening', action: 'why', text: words }), setWords(''))}>
                  {words.trim() ? 'Compare with the reason' : 'Show me the reason'}
                </button>
              </div>
            )}
            {v.why && <p className="opening-words">{v.why}</p>}
            {v.idea && v.status !== 'why' && <p className="opening-words idea">{v.idea}</p>}
            {(v.why || (v.idea && v.status !== 'why')) && v.wordsBy && <p className="words-source">{WORDS_BY[v.wordsBy]}</p>}
            {v.status === 'why' && v.why && (
              <div className="opening-why">
                {v.words && <p className="muted">You said: “{v.words}”</p>}
                <span className="muted">Did you have the idea?</span>
                <div className="play-actions">
                  <button className="btn primary" onClick={() => send({ type: 'opening', action: 'why_known', known: true })}>
                    Yes
                  </button>
                  <button className="btn" onClick={() => send({ type: 'opening', action: 'why_known', known: false })}>
                    Not really
                  </button>
                </div>
              </div>
            )}
            {v.status === 'right' && v.replies && v.replies.length > 0 && (
              <div className="opening-replies">
                <span className="muted">What they reply, and you have an answer for:</span>
                <ul>
                  {v.replies.map((r) => (
                    <li key={r.san}>
                      <San san={r.san} by={opponent} figurine={figurine} />
                      {r.share !== undefined && <span className="muted"> {r.share < 1 ? '<1' : Math.round(r.share)}% at your level</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s.thread.some((m) => m.drill === v.id) && (
              <div className="drill-thread" aria-live="polite">
                {s.thread
                  .filter((m) => m.drill === v.id)
                  .map((m) => (
                    <Message key={m.id} m={m} />
                  ))}
              </div>
            )}
            {(s.status?.state === 'thinking' || s.status?.state === 'retrying') && v.status !== 'ask' && <p className="muted drill-thinking">The coach is thinking…</p>}
            {v.status === 'right' && (
              <div className="play-actions puzzle-actions">
                <button className="btn primary" onClick={() => send({ type: 'opening', action: 'next' })}>
                  <SkipForward size={15} strokeWidth={2} aria-hidden="true" />
                  Next
                </button>
              </div>
            )}
          </section>
        )}
        {/* the coach sees this card and can be asked any time (D12); its answers show with the card above */}
        {v.status !== 'idle' && <OpeningCoach s={s} shows="this card" thread={(m) => m.drill === v.id} compact />}
      </aside>
    </main>
  );
}
