// The owner's games against their repertoire (features B6, D5, D7, G3; PLAN WP 8.10): on the analysis
// board, where the game on it left the repertoire and what to play there next time; on My games, the
// results per line and where the preparation runs out.

import type { Color, MoveTree, RepGameView, RepStatsView } from '@chess-coach/core';
import { San } from './San.tsx';
import { send } from './store.ts';

/** The mainline node before the move at this index (the position to look at). */
function nodeAt(tree: MoveTree, ply: number): string {
  let id = tree.root;
  for (let i = 0; i < ply; i++) {
    const next = tree.nodes[id]?.children[0];
    if (!next) break;
    id = next;
  }
  return id;
}

export function RepGameNote({ v, tree, you, figurine }: { v: RepGameView; tree: MoveTree; you: Color; figurine: boolean }) {
  const them: Color = you === 'white' ? 'black' : 'white';
  const go = () => send({ type: 'nav', to: nodeAt(tree, v.ply) });
  const num = v.moveText.replace(/[^0-9.]+$/, '').match(/^\d+\.+/)?.[0] ?? '';
  if (v.by === 'outside') return null;
  return (
    <section className="pane-section rep-game" aria-label="Your repertoire in this game">
      <header className="pane-head">
        <h2>Your repertoire</h2>
        {v.by !== 'stayed' && (
          <button className="link" onClick={go}>
            Go to the move
          </button>
        )}
      </header>
      {v.by === 'you' && (
        <p>
          You left it at {num}
          <San san={v.played!} by={you} figurine={figurine} />: your repertoire plays <San san={v.expected!} by={you} figurine={figurine} /> here.
          {v.why && <span className="rep-game-why"> {v.why}</span>}
        </p>
      )}
      {v.by === 'them' && (
        <p>
          They left it at {num}
          <San san={v.played!} by={them} figurine={figurine} />: your repertoire prepares{' '}
          {v.prepared!.map((s, i) => (
            <span key={s}>
              {i > 0 && (i === v.prepared!.length - 1 ? ' and ' : ', ')}
              <San san={s} by={them} figurine={figurine} />
            </span>
          ))}
          .{' '}
          {v.engineMove ? (
            <>
              Next time, the engine's move after theirs is <San san={v.engineMove} by={you} figurine={figurine} />.
            </>
          ) : null}
        </p>
      )}
      {v.by === 'them' && v.engineMove && (
        <div className="rep-game-add">
          <button className="btn small" onClick={() => send({ type: 'repgame', action: 'add' })} title="Their move as played, then the engine's move: added to this repertoire and checked by every gate; it waits for your approval">
            Add to my repertoire
          </button>
          <span className="muted">Checked by every gate first; it waits for your approval.</span>
        </div>
      )}
      {v.by === 'end' && (
        <p>
          Your preparation ran out at {num}
          <San san={v.played!} by={v.moveText.includes('...') ? 'black' : 'white'} figurine={figurine} />, after {v.inBook} {v.inBook === 1 ? 'move' : 'moves'} in it.
        </p>
      )}
      {v.by === 'stayed' && <p>The whole game stayed in your repertoire.</p>}
      {v.line && <p className="muted rep-game-line">Line: {v.line}</p>}
    </section>
  );
}

export function RepStats({ v }: { v: RepStatsView }) {
  if (!v.lines.length) return null;
  return (
    <section className="pane-section rep-stats" aria-label="Your openings">
      <header className="pane-head">
        <h2>Your openings</h2>
      </header>
      <p className="play-note">
        In {v.games} {v.games === 1 ? 'game' : 'games'} with your repertoire: you left it {v.leftByYou} {v.leftByYou === 1 ? 'time' : 'times'}, they left it {v.leftByThem}, the preparation ran out {v.prepRanOut}.
      </p>
      <ul>
        {v.lines.map((l) => (
          <li key={`${l.colour}|${l.line}`}>
            <span className="rep-stats-line">{l.line}</span>
            <span className="muted">
              {' '}
              as {l.colour === 'white' ? 'White' : 'Black'}: {l.games} {l.games === 1 ? 'game' : 'games'}, won {l.won}, drew {l.drawn}, lost {l.lost}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
