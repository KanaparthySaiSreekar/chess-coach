// Reviewing one of the owner's games, under the move list.
//
// First the owner's own review (feature B7): they step through the game with the engine silent,
// mark the moves they think mattered and write what they were thinking. Then the key moments
// (features B3, B9): the one to three moves that decided the game, the first turning point first,
// each with what it cost in words and the step of the thinking routine that was skipped. A click
// goes to the move; the board then shows its label and the better move as it does anywhere.

import { useEffect, useState } from 'react';
import type { Moment, MoveTree, ReviewView } from '@chess-coach/core';
import { LABEL_NAME } from '@chess-coach/core';
import { ReportSheet } from './Report.tsx';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';

/** The move's node on the main line: `ply` half-moves from the start. */
function nodeAt(tree: MoveTree, ply: number): string | undefined {
  let id = tree.root;
  for (let i = 0; i < ply; i++) {
    const next = tree.nodes[id]?.children[0];
    if (!next) return undefined;
    id = next;
  }
  return id;
}

/** How far along the main line a node is, or 0 when it is the start or off the main line. */
function plyOf(tree: MoveTree, id: string): number {
  let cur = tree.root;
  for (let ply = 0; cur; ply++) {
    if (cur === id) return ply;
    cur = tree.nodes[cur]?.children[0] ?? '';
  }
  return 0;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const numberOf = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'}`;

/** The owner's own review: mark moves, write thoughts, then Done or Skip. Nothing from the engine is on the page meanwhile. */
function OwnReview({ s, review }: { s: Store; review: ReviewView }) {
  const st = s.state!;
  const [notes, setNotes] = useState('');
  useEffect(() => setNotes(''), [review.gameId]);
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const marks = review.own?.marks ?? [];
  const here = plyOf(st.tree, st.focus);
  const marked = marks.includes(here);
  return (
    <section className="pane-section moments own-review">
      <header className="pane-head">
        <h2>Your own review first</h2>
      </header>
      <p className="muted">Step through the game before the engine speaks. Where do you think it turned? What were you thinking there, and what else did you consider?</p>
      <button className="btn wide" disabled={here === 0} onClick={() => send({ type: 'own_review', action: 'mark', ply: here })} title={here === 0 ? 'Go to a move of the game first' : undefined}>
        {marked ? 'Unmark this move' : 'Mark this move as a turning point'}
      </button>
      {marks.length > 0 && (
        <ul className="own-marks" aria-label="The moves you marked">
          {marks.map((ply) => {
            const id = nodeAt(st.tree, ply);
            const node = id ? st.tree.nodes[id] : undefined;
            return (
              <li key={ply}>
                <button className={`chip${id === st.focus ? ' current' : ''}`} onClick={() => id && send({ type: 'nav', to: id })} title="Go to this move">
                  {numberOf(ply)} {node?.san && <San san={node.san} by={ply % 2 === 1 ? 'white' : 'black'} figurine={figurine} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Your thoughts on the game (kept with it)" aria-label="Your thoughts on the game" />
      <div className="own-actions">
        <button className="btn primary" onClick={() => send({ type: 'own_review', action: 'finish', notes })}>
          Done: show the engine's view
        </button>
        <button className="link" onClick={() => send({ type: 'own_review', action: 'skip' })}>
          Skip
        </button>
      </div>
    </section>
  );
}

export function KeyMoments({ s }: { s: Store }) {
  // hooks first: the early returns below must not change how many run
  const [showReport, setShowReport] = useState(false);
  const st = s.state;
  if (!st?.game) return null;
  const review = s.review && s.review.gameId === st.game.id ? s.review : null;
  if (review?.own?.state === 'pending') return <OwnReview s={s} review={review} />;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const running = review?.status === 'running';
  const n = review?.numbers;
  const slips = n ? [n.blunders && plural(n.blunders, 'blunder', 'blunders'), n.mistakes && plural(n.mistakes, 'mistake', 'mistakes'), n.misses && plural(n.misses, 'missed chance', 'missed chances')].filter(Boolean) : [];
  const own = review?.own;
  const yours = own?.state === 'done' ? own.marks : [];
  const found = review ? review.moments.filter((m) => yours.includes(m.ply)).length : 0;

  const replay = review?.replay;
  const item = (m: Moment, i: number) => {
    const id = nodeAt(st.tree, m.ply);
    // while the owner is looking for a moment's better move, the list does not tell it or lead to it
    const open = !!replay && replay.phase === 'asking' && replay.index === i;
    const ahead = !!replay && replay.phase !== 'finished' && i > replay.index;
    return (
      <li key={m.ply}>
        <button className={`moment${id === st.focus || (replay && replay.index === i && replay.phase !== 'finished') ? ' current' : ''}`} disabled={!id || open || ahead} onClick={() => id && send({ type: 'nav', to: id })} title={open || ahead ? undefined : 'Go to this move'}>
          <span className="moment-move">
            {m.number} <San san={m.san} by={m.by} figurine={figurine} />
          </span>
          <span className="moment-label">{LABEL_NAME[m.label]}</span>
          {!ahead && <span className="moment-why">{m.why.charAt(0).toUpperCase() + m.why.slice(1)}.</span>}
          {!ahead && !open && m.stepName && m.step !== 'unknown' && <span className="moment-step">{m.stepName}</span>}
          {m.first && <span className="moment-first">Where the game first turned</span>}
          {yours.includes(m.ply) && <span className="moment-yours">You marked this move yourself</span>}
        </button>
      </li>
    );
  };

  return (
    <section className="pane-section moments">
      <header className="pane-head">
        <h2>Key moments</h2>
        {!running && (
          <button className="link" onClick={() => send({ type: 'library', action: 'analyse' })}>
            {review ? 'Analyse again' : 'Analyse'}
          </button>
        )}
      </header>
      {!review && <p className="muted">The engine can go through this game and pick out the moves that decided it.</p>}
      {running && (
        <p className="muted" role="status">
          <i className="spinner" /> Going through the game: {review.progress?.done ?? 0} of {review.progress?.total ?? 0} positions
        </p>
      )}
      {review?.status === 'skipped' && <p className="muted">{review.note}</p>}
      {review?.status === 'done' &&
        (review.moments.length ? <ol className="moment-list">{review.moments.map(item)}</ol> : <p className="muted">No key moments: none of your moves cost you anything while the game was still open.</p>)}
      {review?.status === 'done' && review.moments.length > 0 && !replay && (
        <button className="btn wide replay-start" onClick={() => send({ type: 'replay', action: 'start' })} title="The coach puts each position on the board and you look for the better move">
          Go through {review.moments.length === 1 ? 'it' : 'them'} with the coach
        </button>
      )}
      {replay && (
        <div className="replay-bar" role="status">
          <span className="replay-where">
            {replay.phase === 'finished'
              ? 'That was the last moment.'
              : `Moment ${replay.index + 1} of ${replay.total}: ${replay.phase === 'asking' ? 'find a better move on the board' : replay.mode === 'worked' ? 'shown by the coach' : 'answered'}`}
          </span>
          <span className="replay-actions">
            {replay.phase !== 'finished' && (
              <button className="btn small" onClick={() => send({ type: 'replay', action: 'next' })}>
                {replay.phase === 'asking' ? 'Skip it' : replay.index + 1 < replay.total ? 'Next moment' : 'Finish'}
              </button>
            )}
            <button className="link" onClick={() => send({ type: 'replay', action: 'stop' })}>
              {replay.phase === 'finished' ? 'Close' : 'Stop'}
            </button>
          </span>
        </div>
      )}
      {review?.status === 'done' && review.report && (
        <button className="btn wide report-open" onClick={() => setShowReport(true)} title="What went well, the takeaways, and a note for next time">
          The report: {review.report.takeaways.length === 0 ? 'nothing to fix' : `${review.report.takeaways.length} ${review.report.takeaways.length === 1 ? 'takeaway' : 'takeaways'}`}
        </button>
      )}
      {review?.status === 'done' && review.puzzles?.state === 'making' && (
        <p className="muted moments-puzzles" role="status">
          <i className="spinner" /> Making puzzles from this game…
        </p>
      )}
      {review?.status === 'done' && review.puzzles?.state === 'waiting' && <p className="muted moments-puzzles">Puzzles from this game are made on mains power: open it again when the laptop is plugged in.</p>}
      {review?.status === 'done' && review.puzzles?.state === 'done' && review.puzzles.ids.length > 0 && (
        <button
          className="btn wide moments-puzzles"
          title="Your own slips from this game, as puzzles"
          onClick={() => {
            send({ type: 'puzzle', action: 'start', id: review.puzzles!.ids[0] });
            send({ type: 'mode', mode: 'puzzles' });
          }}
        >
          {review.puzzles.ids.length === 1 ? 'Solve the puzzle from this game' : `Solve the ${review.puzzles.ids.length} puzzles from this game`}
        </button>
      )}
      {showReport && review?.report && <ReportSheet s={s} review={review} onClose={() => setShowReport(false)} />}
      {review?.status === 'done' && n && (
        <p className="moments-numbers">
          Your {plural(n.moves, 'move', 'moves')}: {slips.length ? slips.join(', ') : 'no blunders, mistakes or missed chances'}.
          {yours.length > 0 && review.moments.length > 0 && ` You marked ${plural(yours.length, 'move', 'moves')}; ${found === 0 ? 'none' : found} of them ${found === 1 ? 'is' : 'are'} among the key moments.`}
        </p>
      )}
      {own?.state === 'done' && own.notes && (
        <p className="own-notes">
          <span className="muted">Your notes:</span> {own.notes}
        </p>
      )}
    </section>
  );
}
