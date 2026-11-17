// The Openings tab (feature D9; 2026-11-15): the owner's repertoires and all their practice in one
// place. *Repertoire*: walk a repertoire on the board, position by position: the move it plays with
// its why and the opponent's idea, the replies it prepares with how often players at the owner's
// level play them, and the gaps. *Practice*: the opening drill (one card per position, the trap pack
// among them). Building, importing and approving stay on the review screen, one click away.

import { Fragment, useEffect, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronsLeft, ClipboardCheck, Clock3, Cpu, ListOrdered, Swords, Upload, Users, type LucideIcon } from 'lucide-react';
import { START_FEN, playLine, positionKey, type Color, type MoveFrom, type RepBrowserView, type Shape } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { OpeningCoach, askCoach } from './OpeningCoach.tsx';
import { OpeningPanels, WORDS_BY } from './Openings.tsx';
import { RepStats } from './RepGame.tsx';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';
import { Mark, Segmented } from './ui.tsx';

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
                <button className="rep-pick" onClick={() => onChapter(c.moves)} title={`Walk to the start of the chapter: ${c.moves.join(' ')}${c.added ? ' (a chapter the masters’ games added, not one of the outline’s)' : ''}`}>
                  <span className="rep-pick-name">{c.name}</span>
                  <span className="muted">
                    {c.lines} {c.lines === 1 ? 'line' : 'lines'} · {c.live} live{c.waiting ? ` · ${c.waiting} waiting` : ''}
                    {c.added ? ' · added by the book' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view === 'repertoire' && rep?.origin && <Origin rep={rep} />}
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
  // the chapter the walk is in: the deepest whose moves it has followed
  const clean = (x: string) => x.replace(/[+#!?]+$/, '');
  const chapterHere = (rep?.chapters ?? [])
    .filter((c) => c.moves.length <= sans.length && c.moves.every((m, i) => clean(m) === clean(sans[i]!)))
    .sort((a, b) => b.moves.length - a.moves.length)[0]?.name;
  const coachOn = !!s.status && s.status.state !== 'off' && s.status.state !== 'error';

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
      <aside className="pane pane-right play-side walk-side">
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
            <Crumbs start={start} sans={sans} figurine={figurine} onPick={(n) => setPath(path.slice(0, n))} />
            {chapterHere && (
              <p className="walk-chapter">
                <span className="walk-label">Chapter</span> {chapterHere}
              </p>
            )}
            {at?.mine ? (
              <>
                <div className="walk-block">
                  <span className="walk-label">Your move</span>
                  <div className="walk-move-row">
                    <span className="walk-san">
                      <San san={at.mine.san} by={you} figurine={figurine} />
                    </span>
                    <button className="btn primary" onClick={() => go(at.mine!.uci)}>
                      Play it
                    </button>
                  </div>
                  <div className="walk-tags">
                    {at.mine.from && <Tag icon={FROM[at.mine.from].icon} title={FROM[at.mine.from].about}>{FROM[at.mine.from].label}</Tag>}
                    {at.book?.[at.mine.uci] !== undefined && (
                      <Tag icon={BookOpen} title={`The Lichess masters database: this move was played in ${at.book[at.mine.uci]!.toLocaleString('en-US')} games from this position`}>
                        {at.book[at.mine.uci]!.toLocaleString('en-US')} master games
                      </Tag>
                    )}
                    {at.mine.waiting && (
                      <Tag icon={Clock3} tone="wait" title="Not approved yet: it waits for you under Review content">
                        Waiting for your approval
                      </Tag>
                    )}
                    {at.mine.punish && (
                      <Tag icon={Swords} tone="ok" title="Their last move was a mistake: this move punishes it">
                        Punishes their mistake
                      </Tag>
                    )}
                  </div>
                </div>
                <div className="walk-block">
                  <span className="walk-label">Why</span>
                  {at.mine.why ? (
                    <p className="opening-words">{plain(at.mine.why)}</p>
                  ) : (
                    <p className="walk-none">
                      The engine's checked facts give no reason for this move.{' '}
                      <button className="link-btn" onClick={() => askCoach('Why is this move played?')} disabled={!coachOn}>
                        Ask the coach
                      </button>
                    </p>
                  )}
                  {at.mine.idea && (
                    <>
                      <span className="walk-label">Their last move</span>
                      <p className="opening-words idea">{plain(at.mine.idea)}</p>
                    </>
                  )}
                  {(at.mine.why || at.mine.idea) && at.mine.wordsBy && <p className="words-source">{WORDS_BY[at.mine.wordsBy]}</p>}
                </div>
              </>
            ) : at?.replies?.length ? (
              <div className="walk-block">
                <span className="walk-label">What they play, and you are ready for</span>
                <div className="walk-replies" role="list">
                  <div className="walk-replies-head" aria-hidden="true">
                    <span>Move</span>
                    <span>{rep.book ? 'Masters' : ''}</span>
                    <span>Your level</span>
                  </div>
                  {[...at.replies]
                    .sort((a, b) => (at.shares?.[b.uci] ?? -1) - (at.shares?.[a.uci] ?? -1) || (at.book?.[b.uci] ?? 0) - (at.book?.[a.uci] ?? 0))
                    .map((r) => {
                      const share = at.shares?.[r.uci];
                      const games = at.book?.[r.uci];
                      return (
                        <button key={r.uci} className="rep-reply" role="listitem" onClick={() => go(r.uci)} title={replyTitle(r.from, r.waiting)}>
                          <span className="rep-reply-move">
                            <San san={r.san} by={them} figurine={figurine} />
                            {r.from?.includes('outline') && <span className="rep-reply-tag">your outline</span>}
                            {r.from?.includes('game') && <span className="rep-reply-tag">from your game</span>}
                            {r.from && !r.from.includes('outline') && !r.from.includes('book') && r.from.includes('level') && <span className="rep-reply-tag">your level</span>}
                          </span>
                          <span className="rep-reply-num">{games !== undefined ? games.toLocaleString('en-US') : ''}</span>
                          <span className="rep-reply-share">
                            {share !== undefined ? (
                              <>
                                <span className="share-bar" aria-hidden="true">
                                  <i style={{ width: `${Math.max(2, Math.min(100, share))}%` }} />
                                </span>
                                {Math.round(share) || '<1'}%
                              </>
                            ) : (
                              <span className="muted">–</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                </div>
                {at.gap && (
                  <p className="rep-gap">
                    Not prepared{at.gap.missing.length ? `: ${at.gap.missing.map((m) => `${m.san} (${m.share}%)`).join(', ')}` : ''}. Your lines cover {at.gap.covered}% of {rep.book ? "the masters' games" : 'what players at your level play'} here.
                  </p>
                )}
              </div>
            ) : (
              <div className="walk-block">
                <p className="muted">{path.length ? 'Your repertoire ends here: the masters\' games run out, or this is as deep as it goes.' : 'This repertoire has no lines that are live or waiting.'}</p>
              </div>
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

/** What a repertoire is grounded in, and what in it was made (D13): said once, beside the chapters. */
function Origin({ rep }: { rep: Rep }) {
  const o = rep.origin!;
  return (
    <section className="pane-section rep-origin" aria-label="Where it comes from">
      <header className="pane-head">
        <h2>Where it comes from</h2>
      </header>
      <ul>
        {o.kind === 'book' ? (
          <li>
            <BookOpen size={14} strokeWidth={2} aria-hidden="true" />
            <span>
              <b>Every move is book:</b> played in at least {rep.book?.minGames ?? 25} games of the Lichess masters database, and each of yours passed by Stockfish.
            </span>
          </li>
        ) : o.kind === 'imported' ? (
          <li>
            <Upload size={14} strokeWidth={2} aria-hidden="true" />
            <span>
              <b>Imported by you</b> from a PGN or a study; every line passed the gates.
            </span>
          </li>
        ) : (
          <li>
            <Cpu size={14} strokeWidth={2} aria-hidden="true" />
            <span>
              <b>Built by the engine</b> (Stockfish and Maia) around your seed lines: no book behind it; every line passed the gates.
            </span>
          </li>
        )}
        {o.outline && (
          <li>
            <ListOrdered size={14} strokeWidth={2} aria-hidden="true" />
            <span>{o.outline.by === 'owner' ? <><b>Chapters:</b> your list, its moves checked against the book.</> : <><b>Chapters:</b> drawn up by Claude from your choices, every move checked against the book.</>}</span>
          </li>
        )}
        <li>
          <Mark className="origin-mark" />
          <span>
            <b>Words:</b> made from the engine's checked facts, never copied from a course; each says who wrote it. A move with none, the coach explains when you ask.
          </span>
        </li>
      </ul>
    </section>
  );
}

/** Where a move of the repertoire comes from (D13), as the page labels it: a reference, or something made. */
const FROM: Record<MoveFrom, { label: string; about: string; icon: LucideIcon }> = {
  outline: { label: 'Your outline', about: 'A move of your outline: your own choice, checked against the masters’ games and the engine', icon: ListOrdered },
  book: { label: 'Masters’ choice', about: 'Past your outline: the move the masters played most here (the Lichess masters database) that the engine passes', icon: BookOpen },
  level: { label: 'Your level', about: 'A reply players at your level make here (the Lichess explorer)', icon: Users },
  imported: { label: 'Imported', about: 'From a PGN or a study you imported, checked by the gates', icon: Upload },
  built: { label: 'Engine-built', about: 'Made by the starter builder (Stockfish and Maia): no book behind it, checked by the gates', icon: Cpu },
  game: { label: 'From your game', about: 'Added from one of your games: their move as it was played, yours the engine’s move after it; checked by every gate', icon: Swords },
};

function replyTitle(from: MoveFrom[] | undefined, waiting?: boolean): string {
  const why = (from ?? []).map((f) => ({ outline: 'your outline names it', book: 'the masters play it', level: 'players at your level play it', imported: 'from your import', built: 'from the starter builder', game: 'it was played against you in one of your games' })[f]);
  return `${why.length ? `Prepared because ${why.join(', and ')}` : 'Prepared'}${waiting ? '; not approved yet' : ''}`;
}

function Tag({ children, icon: Icon, tone, title }: { children: React.ReactNode; icon?: LucideIcon; tone?: 'ok' | 'wait'; title?: string }) {
  return (
    <span className={`tag${tone ? ` tag-${tone}` : ''}`} title={title}>
      {Icon && <Icon size={12} strokeWidth={2.2} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** The moves walked so far, each one a step back to there. */
function Crumbs({ start, sans, figurine, onPick }: { start: string; sans: string[]; figurine: boolean; onPick: (n: number) => void }) {
  const whiteFirst = start.split(' ')[1] !== 'b';
  const firstNo = Number(start.split(' ')[5] ?? 1);
  return (
    <nav className="walk-crumbs" aria-label="The moves so far">
      <button className={`crumb${sans.length === 0 ? ' on' : ''}`} onClick={() => onPick(0)}>
        Start
      </button>
      {sans.map((san, i) => {
        const white = whiteFirst ? i % 2 === 0 : i % 2 === 1;
        const no = firstNo + Math.floor((i + (whiteFirst ? 0 : 1)) / 2);
        return (
          <Fragment key={i}>
            {white && <span className="crumb-no">{no}.</span>}
            {!white && i === 0 && <span className="crumb-no">{no}…</span>}
            <button className={`crumb${i === sans.length - 1 ? ' on' : ''}`} onClick={() => onPick(i + 1)} aria-current={i === sans.length - 1 ? 'step' : undefined}>
              <San san={san} by={white ? 'white' : 'black'} figurine={figurine} />
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
