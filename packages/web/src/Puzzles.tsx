// "Puzzles" (PLAN WP 6.2): one puzzle at a time on a board of its own. The owner finds the move;
// a wrong one is answered with what it runs into, hints come a rung at a time, and at the end the
// reason is given. Nothing from the engine is on the screen while the owner is still looking, and
// it all works with the coach off.

import { Lightbulb, RotateCcw, SkipForward } from 'lucide-react';
import { roundPace, themeName, type PuzzleView } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { SafetyPanels } from './Safety.tsx';
import { ThreatPanels } from './Threat.tsx';
import { ConvertPanels } from './Convert.tsx';
import { OpeningPanels } from './Openings.tsx';
import { SpeedPanels } from './Speed.tsx';
import { Message } from './CoachPanel.tsx';
import { San } from './San.tsx';
import { playTick, send, setting, type Store } from './store.ts';

/** "tomorrow", "in 5 days", "in about 3 months" */
function comesBackIn(iso: string): string {
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days <= 1) return 'tomorrow';
  if (days < 21) return `in ${days} days`;
  if (days < 60) return `in about ${Math.round(days / 7)} weeks`;
  return `in about ${Math.round(days / 30)} months`;
}

/** tags that say how long a puzzle is or which phase it is from: not ideas */
const NOT_SHOWN = new Set(['oneMove', 'short', 'long', 'veryLong', 'opening', 'middlegame', 'endgame', 'master', 'masterVsMaster', 'superGM', 'crushing', 'advantage', 'equality', 'mate']);

const HINT_LABEL: Record<string, string> = { question: 'Hint', nudge: 'Another hint', arrow: 'Show me where', answer: 'Show the answer' };

/** The moves played so far, written as a game is: "12. Nf3 Nc6". The first move may be Black's. */
function Line({ p, figurine }: { p: PuzzleView; figurine: boolean }) {
  if (!p.moves.length) return <p className="muted">No moves yet.</p>;
  // who played the first move of the line: the side that is not to move in the position after it
  const firstBy = p.moves[0]!.fen.split(' ')[1] === 'b' ? 'white' : 'black';
  return (
    <p className="puzzle-line">
      {p.moves.map((m, i) => {
        const by = (i % 2 === 0) === (firstBy === 'white') ? 'white' : 'black';
        return (
          <span key={i} className={m.by === 'you' ? 'yours' : undefined}>
            <San san={m.san} by={by} figurine={figurine} />{' '}
          </span>
        );
      })}
    </p>
  );
}

/**
 * What to practise (C5): the owner's own games, one theme from the Lichess database at their
 * level, or a mix with the themes hidden. The level follows their results.
 */
type Count = { ready: number; due: number } | null;

function Sets({ p, safety, threat, convert }: { p: PuzzleView; safety: Count; threat: Count; convert: Count }) {
  const on = (kind: string, theme?: string) => p.set.kind === kind && (kind !== 'theme' || (p.set.kind === 'theme' && p.set.theme === theme));
  return (
    <section className="pane-section puzzle-sets">
      <header className="pane-head">
        <h2>Practise</h2>
      </header>
      <button className={`puzzle-set${on('due') ? ' on' : ''}`} aria-pressed={on('due')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'due' } })} title="Puzzles you have met before, back on their schedule">
        <span>Due today</span>
        <span className="muted">{p.due}</span>
      </button>
      <button className={`puzzle-set${on('games') ? ' on' : ''}`} aria-pressed={on('games')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'games' } })}>
        <span>From my games</span>
        <span className="muted">{p.ready}</span>
      </button>
      <button className={`puzzle-set${on('safety') ? ' on' : ''}`} aria-pressed={on('safety')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'safety' } })} title="Is this move safe? Moves from your own games to judge">
        <span>Safety check</span>
        <span className="muted">{safety ? safety.ready : 0}</span>
      </button>
      <button className={`puzzle-set${on('threat') ? ' on' : ''}`} aria-pressed={on('threat')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'threat' } })} title="Name their threat, then deal with it: positions from your own games">
        <span>What's the threat?</span>
        <span className="muted">{threat ? threat.ready : 0}</span>
      </button>
      <button className={`puzzle-set${on('convert') ? ' on' : ''}`} aria-pressed={on('convert')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'convert' } })} title="Clearly won positions from your own games, played out against the engine">
        <span>Win the won game</span>
        <span className="muted">{convert ? convert.ready : 0}</span>
      </button>

      {p.modes?.woodpecker && (
        <button className={`puzzle-set${on('woodpecker') ? ' on' : ''}`} aria-pressed={on('woodpecker')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'woodpecker' } })} title="The same set again and again, faster each round">
          <span>Woodpecker</span>
        </button>
      )}
      {p.modes?.speed && (
        <>
          <button className={`puzzle-set${on('streak') ? ' on' : ''}`} aria-pressed={on('streak')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'streak' } })} title="Harder each time; one wrong move ends it">
            <span>Streak</span>
          </button>
          <button className={`puzzle-set${on('timed') ? ' on' : ''}`} aria-pressed={on('timed')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'timed' } })} title="As many as you can before the time is up">
            <span>Timed run</span>
          </button>
        </>
      )}
      {p.modes && !p.modes.woodpecker && !p.modes.speed && <p className="muted puzzle-level">Woodpecker rounds and speed runs are off: they can be switched on in Settings, under Puzzles.</p>}
      {p.catalogue ? (
        <>
          <button className={`puzzle-set${on('mixed') ? ' on' : ''}`} aria-pressed={on('mixed')} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'mixed' } })} title="Puzzles of every theme, with the theme hidden: you find the idea on the board">
            <span>Mixed, theme hidden</span>
          </button>
          <p className="muted puzzle-level">One theme at a time · your level {p.level}</p>
          <div className="puzzle-themes-list">
            {p.catalogue.slice(0, 14).map((t) => (
              <button key={t.theme} className={`chip${on('theme', t.theme) ? ' on' : ''}`} aria-pressed={on('theme', t.theme)} onClick={() => send({ type: 'puzzle', action: 'set', set: { kind: 'theme', theme: t.theme } })}>
                {t.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="muted puzzle-level">Themed puzzles come from the Lichess puzzle database. Install it once: <code>npm run content:install -- puzzles</code></p>
      )}
    </section>
  );
}

export function PuzzlesView({ s }: { s: Store }) {
  const p = s.puzzle;
  if (!p) return <main className="layout play puzzles" />;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const idle = p.status === 'idle';
  const over = p.status === 'solved' || p.status === 'shown';
  const waiting = p.status === 'solving' && !p.yourTurn;
  const sets = <Sets p={p} safety={s.safety} threat={s.threat} convert={s.convert} />;
  if (p.set.kind === 'safety') return <SafetyPanels s={s} sets={sets} />;
  if (p.set.kind === 'threat') return <ThreatPanels s={s} sets={sets} />;
  if (p.set.kind === 'convert') return <ConvertPanels s={s} sets={sets} />;
  if (p.set.kind === 'openings') return <OpeningPanels s={s} sets={sets} />;
  if (p.set.kind === 'streak' || p.set.kind === 'timed') return <SpeedPanels s={s} sets={sets} mode={p.set.kind} />;

  return (
    <main className="layout play puzzles">
      <aside className="pane pane-left">
        {sets}
        <section className="pane-section">
          <header className="pane-head">
            <h2>Puzzle</h2>
          </header>
          {idle ? (
            <p className="muted">{p.ready ? `${p.ready} ${p.ready === 1 ? 'puzzle is' : 'puzzles are'} ready.` : 'No puzzles yet.'}</p>
          ) : (
            <>
              <p className="puzzle-from">{p.from}</p>
              <p className="muted">You play {p.you === 'white' ? 'White' : 'Black'}.</p>
            </>
          )}
        </section>
        {!idle && (
          <section className="pane-section grow">
            <header className="pane-head">
              <h2>Moves</h2>
            </header>
            <Line p={p} figurine={figurine} />
          </section>
        )}
        {idle && p.motifs && p.motifs.length > 0 && <Motifs motifs={p.motifs} />}
        <p className="play-foot muted puzzle-count">
          From your games: {p.ready} {p.ready === 1 ? 'puzzle' : 'puzzles'} · {p.fresh} not tried yet
        </p>
      </aside>

      <section className="stage">
        <div className="board-stack">
          <div className="board-pair">
            <Board
              fen={p.fen}
              orientation={p.you}
              interactive={p.status === 'solving' && p.yourTurn}
              movable={p.you}
              lastMove={p.lastMove}
              coachShapes={p.shapes}
              bestArrows={[]}
              hoverSquares={[]}
              coordinates={setting(s, 'display.coordinates', true)}
              theme={setting(s, 'display.boardTheme', 'brown')}
              resync={s.resync + p.misses}
              onMove={(from, to, promotion) => {
                playTick();
                send({ type: 'puzzle', action: 'move', from, to, promotion });
              }}
            />
          </div>
          {!idle && (
            <div className="under-board">
              <div className="turn">
                <span className={`turn-dot ${p.fen.split(' ')[1] === 'w' ? 'white' : 'black'}`} aria-hidden="true" />
                {over ? (p.status === 'solved' ? 'Solved' : 'The answer is shown') : waiting ? 'Their move…' : 'Your move'}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="pane pane-right play-side puzzle-side">
        {idle ? (
          <section className="pane-section">
            <p className="thread-empty-title">{p.set.kind === 'woodpecker' ? 'Woodpecker' : p.ready ? 'Ready when you are.' : 'Puzzles from your own games'}</p>
            <p className="muted">{p.problem ?? 'Each puzzle is a moment from one of your games where a better move was there.'}</p>
            {p.set.kind === 'woodpecker' && p.woodpecker && <Woodpecker w={p.woodpecker} />}
            {p.catalogue && <p className="muted">Or choose a theme on the left: puzzles from the Lichess database, at your level.</p>}
            {p.ready > 0 && p.set.kind !== 'woodpecker' && (
              <button className="btn primary big" onClick={() => send({ type: 'puzzle', action: 'start' })}>
                Start a puzzle
              </button>
            )}
          </section>
        ) : (
          <section className="pane-section">
            <p className="puzzle-task">{p.task}</p>
            {p.routine && (
              <p className="puzzle-routine" aria-live="polite">
                <span className="walk-label">Before you move</span>
                {p.routine}
              </p>
            )}
            {p.guide && (
              <div className="puzzle-guide">
                <p>{p.guide.text}</p>
                {p.guide.offerExample && (
                  <button className="btn" onClick={() => send({ type: 'puzzle', action: 'example' })}>
                    Show me how it works
                  </button>
                )}
              </div>
            )}
            <DrillCoach s={s} id={p.id} />
            <div className={`puzzle-says${p.feedback ? ` ${p.feedback.tone}` : ''}`} aria-live="polite">
              {p.feedback ? p.feedback.text : waiting ? 'Watch what they play.' : 'Take your time. A wrong move costs nothing but a try.'}
            </div>
            {over && p.comesBack && <p className="muted puzzle-tally">It comes back {comesBackIn(p.comesBack)}.</p>}
            {over && p.themes && p.themes.length > 0 && (
              <p className="muted puzzle-themes">
                The idea:{' '}
                {p.themes
                  .filter((t) => !NOT_SHOWN.has(t))
                  .map(themeName)
                  .join(' · ') || 'a better move'}
              </p>
            )}
            {!over && (p.hints > 0 || p.misses > 0) && (
              <p className="muted puzzle-tally">
                {p.hints > 0 && `${p.hints} ${p.hints === 1 ? 'hint' : 'hints'}`}
                {p.hints > 0 && p.misses > 0 && ' · '}
                {p.misses > 0 && `${p.misses} ${p.misses === 1 ? 'miss' : 'misses'}`}
              </p>
            )}
            <div className="play-actions puzzle-actions">
              {over ? (
                <>
                  <button className="btn primary" onClick={() => send({ type: 'puzzle', action: 'next' })}>
                    <SkipForward size={15} strokeWidth={2} aria-hidden="true" />
                    Next puzzle
                  </button>
                  <button className="btn" onClick={() => send({ type: 'puzzle', action: 'retry' })}>
                    <RotateCcw size={15} strokeWidth={1.9} aria-hidden="true" />
                    Try it again
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" disabled={!p.yourTurn} onClick={() => send({ type: 'puzzle', action: 'hint' })}>
                    <Lightbulb size={15} strokeWidth={1.9} aria-hidden="true" />
                    {HINT_LABEL[p.nextHint ?? 'question']}
                  </button>
                  {p.nextHint !== 'answer' && (
                    <button className="link" disabled={!p.yourTurn} onClick={() => send({ type: 'puzzle', action: 'show' })}>
                      Show the answer
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        )}
      </aside>
    </main>
  );
}

const STAGE_LABEL = { example: 'new', partial: 'learning', full: 'known', mixed: 'mastered' } as const;

/** The owner's ideas from their puzzles (G7): the stage, and how many of the latest were solved alone. */
function Motifs({ motifs }: { motifs: NonNullable<PuzzleView['motifs']> }) {
  return (
    <section className="pane-section">
      <header className="pane-head">
        <h2>Your ideas</h2>
      </header>
      <ul className="motif-list">
        {motifs.map((m) => (
          <li key={m.motif}>
            <span>{m.name}</span>
            <span className={`motif-stage ${m.stage}`}>{STAGE_LABEL[m.stage]}</span>
            <span className="muted" title={`${m.alone} of your last ${m.recent} solved without help`}>
              {m.alone}/{m.recent}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const minutes = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

/** A Woodpecker set (C6): every round so far, the time it took and how many were solved alone; then the next round, or a new set. */
function Woodpecker({ w }: { w: NonNullable<PuzzleView['woodpecker']> }) {
  const pace = roundPace(w.rounds);
  return (
    <div className="woodpecker">
      <p className="muted">
        A set of {w.size} puzzles you have met, solved again and again, faster each round. A second go does not move your schedule.
      </p>
      {w.rounds.length > 0 && (
        <table className="woodpecker-rounds">
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">Solved alone</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {w.rounds.map((r) => (
              <tr key={r.round}>
                <td>{r.round}</td>
                <td>
                  {r.alone} of {r.ms === undefined ? `${r.done} so far` : w.size}
                </td>
                <td>{r.ms === undefined ? 'under way' : minutes(r.ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pace !== undefined && <p className="muted">The last round took {Math.round(pace * 100)}% of the time of the one before.</p>}
      <div className="play-actions">
        <button className="btn primary" onClick={() => send({ type: 'puzzle', action: w.over ? 'woodpecker_round' : 'next' })}>
          {w.over ? (w.rounds.length ? 'Next round' : 'Start round 1') : 'Go on with the round'}
        </button>
        {w.over && (
          <button className="btn" onClick={() => send({ type: 'puzzle', action: 'woodpecker_new' })}>
            A new set
          </button>
        )}
      </div>
    </div>
  );
}

/** Is the coach on? Then it coaches the puzzles too (the drill coach, WP 6.11). */
export function coachOn(s: Store): boolean {
  return !!s.status && s.status.state !== 'off' && s.status.state !== 'error';
}

/** The drill coach's messages about the puzzle on the board, and the button to ask it for help. */
function DrillCoach({ s, id }: { s: Store; id?: number }) {
  if (!coachOn(s) || id === undefined) return null;
  const p = s.puzzle;
  const messages = s.thread.filter((m) => m.drill === id);
  const solving = p?.status === 'solving' && p.yourTurn;
  const thinking = s.status?.state === 'thinking' || s.status?.state === 'retrying';
  return (
    <div className="drill-coach">
      {messages.length > 0 && (
        <div className="drill-thread" aria-live="polite">
          {messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
        </div>
      )}
      {thinking && <p className="muted drill-thinking">The coach is thinking…</p>}
      {solving && (
        <button className="btn" disabled={thinking} onClick={() => send({ type: 'puzzle', action: 'ask_coach' })} title="The coach asks you a question about the position; it counts as a hint">
          Ask the coach
        </button>
      )}
    </div>
  );
}
