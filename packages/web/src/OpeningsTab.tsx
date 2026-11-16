// The Openings tab (feature D9; 2026-11-15): the owner's repertoires and all their practice in one
// place. *Repertoire*: walk a repertoire on the board, position by position: the move it plays with
// its why and the opponent's idea, the replies it prepares with how often players at the owner's
// level play them, and the gaps. *Practice*: the opening drill (one card per position, the trap pack
// among them). Building, importing and approving stay on the review screen, one click away.

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronsLeft, ClipboardCheck } from 'lucide-react';
import { START_FEN, lineText, playLine, positionKey, type Color, type RepBrowserView, type Shape } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { OpeningCoach } from './OpeningCoach.tsx';
import { OpeningPanels } from './Openings.tsx';
import { RepStats } from './RepGame.tsx';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';
import { Segmented } from './ui.tsx';

type Rep = RepBrowserView['repertoires'][number];
const side = (c: Color) => (c === 'white' ? 'White' : 'Black');

function LeftPane({ s, view, setView, rep, choose, onReview, onChapter }: { s: Store; view: 'repertoire' | 'practice'; setView: (v: 'repertoire' | 'practice') => void; rep?: Rep; choose: (id: number) => void; onReview: () => void; onChapter: (moves: string[]) => void }) {
  const reps = s.repbrowser?.repertoires ?? [];
  const chapters = view === 'repertoire' ? (rep?.chapters ?? []) : [];
  return (
    <>
      <section className="pane-section">
        <header className="pane-head">
          <h2>Openings</h2>
          <button className="icon-btn plain" onClick={onReview} aria-label="Review content" title="Build, import and approve repertoires (Review content)">
            <ClipboardCheck size={16} strokeWidth={1.9} />
          </button>
        </header>
        <Segmented
          className="wide"
          value={view}
          onChange={setView}
          label="Openings view"
          options={[
            { value: 'repertoire', label: 'Repertoire', title: 'Walk your repertoires move by move' },
            { value: 'practice', label: 'Practice', title: 'The opening drill: your moves, from memory' },
          ]}
        />
      </section>
      <section className="pane-section rep-list">
        <header className="pane-head">
          <h2>Your repertoires</h2>
        </header>
        {reps.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul>
            {reps.map((r) => (
              <li key={r.id}>
                <button className={`rep-pick${rep?.id === r.id && view === 'repertoire' ? ' on' : ''}`} onClick={() => (choose(r.id), setView('repertoire'))}>
                  <span className="rep-pick-name">{r.name}</span>
                  <span className="muted">
                    {side(r.colour)} · {r.live} live{r.waiting ? ` · ${r.waiting} waiting` : ''}
                    {r.quarantined ? ` · ${r.quarantined} in quarantine` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="rep-list-actions">
          <button className="btn small" onClick={() => send({ type: 'content', action: 'build', colour: 'white' })} title="A starter around your openings in Settings → Repertoire">
            Build for White
          </button>
          <button className="btn small" onClick={() => send({ type: 'content', action: 'build', colour: 'black' })} title="A starter around your openings in Settings → Repertoire">
            Build for Black
          </button>
          <button className="btn small" onClick={onReview}>
            Import or approve…
          </button>
        </div>
      </section>
      {chapters.length > 0 && (
        <section className="pane-section rep-chapter-list">
          <header className="pane-head">
            <h2>Chapters</h2>
          </header>
          <ul>
            {chapters.map((c) => (
              <li key={c.name}>
                <button className="rep-pick" onClick={() => onChapter(c.moves)} title={`Walk to the start of the chapter: ${c.moves.join(' ')}`}>
                  <span className="rep-pick-name">{c.name}</span>
                  <span className="muted">
                    {c.lines} {c.lines === 1 ? 'line' : 'lines'} · {c.live} live{c.waiting ? ` · ${c.waiting} waiting` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.repstats && <RepStats v={s.repstats} />}
    </>
  );
}

export function OpeningsTab({ s, onReview }: { s: Store; onReview: () => void }) {
  const [view, setView] = useState<'repertoire' | 'practice'>('repertoire');
  const [repId, setRepId] = useState<number | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const reps = s.repbrowser?.repertoires ?? [];
  const rep = reps.find((r) => r.id === repId) ?? reps[0];
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const choose = (id: number) => {
    setRepId(id);
    setPath([]);
  };
  const toPractice = (v: 'repertoire' | 'practice') => {
    setView(v);
    if (v === 'practice' && (!s.opening || s.opening.status === 'idle')) send({ type: 'opening', action: 'next' });
  };
  // a chapter's start: its moves (SAN) as the walk's moves
  const toChapter = (moves: string[]) => {
    const r = playLine(rep?.startFen ?? START_FEN, moves);
    if (r.ok) setPath(r.infos.map((i) => i.uci));
  };
  const left = <LeftPane s={s} view={view} setView={toPractice} rep={rep} choose={choose} onReview={onReview} onChapter={toChapter} />;

  // the coach sees the walked board (D12): the server is told where the owner has walked to, and when they leave
  const walkKey = view === 'repertoire' && rep ? `${rep.id}|${path.join(' ')}` : '';
  useEffect(() => {
    send({ type: 'opening', action: 'walk', repertoire: walkKey ? rep!.id : null, moves: walkKey ? path : undefined });
  }, [walkKey]);
  useEffect(() => () => send({ type: 'opening', action: 'walk', repertoire: null }), []);

  if (view === 'practice') return <OpeningPanels s={s} sets={left} />;

  // the position reached by the moves walked so far
  const start = rep?.startFen ?? START_FEN;
  const walked = playLine(start, path);
  const fen = walked.ok ? walked.fens.at(-1)! : start;
  const sans = walked.ok ? walked.infos.map((i) => i.san) : [];
  const at = rep ? rep.positions[positionKey(fen)] : undefined;
  const you: Color = rep?.colour ?? 'white';
  const them: Color = you === 'white' ? 'black' : 'white';
  const go = (uci: string) => setPath([...path, uci]);
  const shapes: Shape[] = at?.mine
    ? [{ from: at.mine.uci.slice(0, 2), to: at.mine.uci.slice(2, 4), style: 'good' }]
    : (at?.replies ?? []).map((r) => ({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), style: 'move' as const }));
  const lastMove = walked.ok && path.length ? ([path.at(-1)!.slice(0, 2), path.at(-1)!.slice(2, 4)] as [string, string]) : undefined;

  return (
    <main className="layout play puzzles openings-tab">
      <aside className="pane pane-left">{left}</aside>
      <section className="stage">
        <div className="board-stack">
          <div className="board-pair">
            <Board
              fen={fen}
              orientation={you}
              interactive={false}
              movable={you}
              lastMove={lastMove}
              coachShapes={shapes}
              bestArrows={[]}
              hoverSquares={[]}
              coordinates={setting(s, 'display.coordinates', true)}
              theme={setting(s, 'display.boardTheme', 'brown')}
              resync={s.resync}
              onMove={() => {}}
            />
          </div>
          <div className="under-board">
            <div className="play-actions">
              <button className="btn quiet" disabled={!path.length} onClick={() => setPath([])} title="Back to the start">
                <ChevronsLeft size={15} strokeWidth={2} aria-hidden="true" />
                Start
              </button>
              <button className="btn quiet" disabled={!path.length} onClick={() => setPath(path.slice(0, -1))} title="One move back">
                <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
                Back
              </button>
            </div>
            <div className="turn">{rep ? `${rep.name} · you are ${side(you)}` : ''}</div>
          </div>
        </div>
      </section>
      <aside className="pane pane-right play-side puzzle-side">
        {!rep ? (
          <section className="pane-section">
            <p className="thread-empty-title">No repertoire yet</p>
            <p className="muted">Build a starter around your openings, or import one (a PGN, a Lichess study, or one of your studies). Every line is checked before you approve it.</p>
            <div className="play-actions">
              <button className="btn primary" onClick={() => send({ type: 'content', action: 'build', colour: 'white' })}>
                Build for White
              </button>
              <button className="btn" onClick={() => send({ type: 'content', action: 'build', colour: 'black' })}>
                Build for Black
              </button>
            </div>
          </section>
        ) : (
          <section className="pane-section rep-walk">
            <p className="opening-line muted" aria-label="The moves so far">
              {sans.length ? lineText(start, sans) : 'The starting position'}
            </p>
            {at?.mine ? (
              <>
                <p className="puzzle-task">
                  Your move: <San san={at.mine.san} by={you} figurine={figurine} />
                </p>
                {at.book?.[at.mine.uci] !== undefined && <p className="muted rep-book">Book: played in {at.book[at.mine.uci]!.toLocaleString('en-US')} of the masters' games here.</p>}
                {at.mine.waiting && <p className="muted rep-waiting">Not approved yet: it waits under Review content.</p>}
                {at.mine.punish && <p className="opening-punish">Their last move was a mistake: this punishes it.</p>}
                {at.mine.why ? <p className="opening-words">{plain(at.mine.why)}</p> : <p className="muted">No words written for this move yet.</p>}
                {at.mine.idea && <p className="opening-words idea">{plain(at.mine.idea)}</p>}
                <button className="btn primary" onClick={() => go(at.mine!.uci)}>
                  Play it
                </button>
              </>
            ) : at?.replies?.length ? (
              <>
                <p className="puzzle-task">What they play, and you are ready for:</p>
                <ul className="rep-replies">
                  {[...at.replies]
                    .sort((a, b) => (at.shares?.[b.uci] ?? -1) - (at.shares?.[a.uci] ?? -1))
                    .map((r) => (
                      <li key={r.uci}>
                        <button className="rep-reply" onClick={() => go(r.uci)}>
                          <San san={r.san} by={them} figurine={figurine} />
                          {at.shares?.[r.uci] !== undefined && <span className="muted"> {Math.round(at.shares[r.uci]!) || '<1'}% at your level</span>}
                          {at.book?.[r.uci] !== undefined && <span className="muted"> · {at.book[r.uci]!.toLocaleString('en-US')} master games</span>}
                          {r.waiting && <span className="muted"> · waiting</span>}
                        </button>
                      </li>
                    ))}
                </ul>
                {at.gap && (
                  <p className="rep-gap">
                    Not prepared{at.gap.missing.length ? `: ${at.gap.missing.map((m) => `${m.san} (${m.share}%)`).join(', ')}` : ''}. Your lines cover {at.gap.covered}% of {rep.book ? "the masters' games" : 'what players at your level play'} here.
                  </p>
                )}
              </>
            ) : (
              <p className="muted">{path.length ? 'Your repertoire ends here.' : 'This repertoire has no lines that are live or waiting.'}</p>
            )}
          </section>
        )}
        {rep && <OpeningCoach s={s} shows="this position" thread={(m) => !!m.walk} suggestions={at?.mine ? ['Why is this move played?', ...(path.length ? ['What did their last move want?'] : []), 'What is the plan from here?'] : at?.replies?.length ? ['What does each of these replies want?'] : []} />}
      </aside>
    </main>
  );
}

/** The written words' tokens as plain words ("{m:Nf3}" → "Nf3"). */
function plain(text: string): string {
  return text.replace(/\{(?:m|sq|pc):([^}@]*)(?:@[^}]*)?\}/g, '$1');
}
