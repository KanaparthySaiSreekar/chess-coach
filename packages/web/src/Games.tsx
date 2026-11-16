// "My games" (features B1, B2, B8, G1): the owner's finished games from Lichess and Chess.com,
// fetched by their names there, and any game they paste. A click puts a game on the analysis
// board. Games still being played are never here: the app reads the sites' lists of them only to
// keep its hands off (the fair-play guard, H10).

import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import type { AccountView, GameSummary, Measure, SkillProfile } from '@chess-coach/core';
import { send, type Store } from './store.ts';
import { Segmented } from './ui.tsx';
import { RepStats } from './RepGame.tsx';

const SITE: Record<string, string> = { lichess: 'Lichess', chesscom: 'Chess.com', pgn: 'Pasted' };
const SPEED: Record<string, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', unknown: '' };
const OUTCOME: Record<string, string> = { win: 'Won', loss: 'Lost', draw: 'Drew' };
const ENDING: Record<string, string> = {
  checkmate: 'by checkmate',
  resignation: 'by resignation',
  time: 'on time',
  abandoned: 'the game was abandoned',
  stalemate: 'by stalemate',
  'draw agreed': 'by agreement',
  repetition: 'by repetition',
  'not enough material': 'not enough material to win',
  'fifty moves': 'by the fifty-move rule',
};
type Filter = 'all' | 'win' | 'loss' | 'draw';

function ago(iso: string | undefined): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function Account({ a }: { a: AccountView }) {
  const [name, setName] = useState(a.user);
  useEffect(() => setName(a.user), [a.user]);
  const save = () => {
    if (name.trim() !== a.user) send({ type: 'setting', key: `accounts.${a.site}`, value: name.trim() });
  };
  const ratings = Object.entries(a.ratings)
    .map(([speed, rating]) => `${SPEED[speed] ?? speed} ${rating}`)
    .join(' · ');
  return (
    <div className="account">
      <label className="field-label" htmlFor={`account-${a.site}`}>
        {SITE[a.site]}
      </label>
      <input
        id={`account-${a.site}`}
        type="text"
        value={name}
        placeholder={`Your name on ${SITE[a.site]}`}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {a.state === 'syncing' && (
        <p className="play-note" role="status">
          <i className="spinner" /> Fetching your games…
        </p>
      )}
      {a.state === 'error' && <p className="play-note error">{a.problem}</p>}
      {a.state === 'ok' && (
        <p className="play-note">
          {a.games} {a.games === 1 ? 'game' : 'games'}
          {a.lastSync ? ` · fetched ${ago(a.lastSync)}` : ' · not fetched yet'}
          {ratings && (
            <>
              <br />
              {ratings}
            </>
          )}
        </p>
      )}
      {a.user && (
        <p className={`play-note${a.ongoingProblem ? ' error' : ''}`}>
          {a.ongoingProblem
            ? `Your games in progress could not be checked: ${a.ongoingProblem}`
            : a.ongoingAt
              ? a.ongoing
                ? `${a.ongoing} ${a.ongoing === 1 ? 'game' : 'games'} in progress: left alone until ${a.ongoing === 1 ? 'it is' : 'they are'} over.`
                : 'No games in progress.'
              : 'Your games in progress have not been checked yet.'}
        </p>
      )}
    </div>
  );
}

const TREND: Record<string, string> = { better: 'better', worse: 'worse', same: 'about the same' };

/**
 * The skill profile (features G2, G5): four figures counted from the analysed games, and the
 * steps of the routine that are skipped most. Each figure is a number with its name; where there
 * are enough games, the line under it compares the newest games with the ones before, in words.
 */
function Profile({ p }: { p: SkillProfile }) {
  if (!p.games) {
    return (
      <section className="profile" aria-label="Your profile">
        <h3>Your profile</h3>
        <p className="muted">It is counted from the games the engine has been through. Open a game and it starts.</p>
      </section>
    );
  }
  const tile = (label: string, m: Measure, unit: string, empty: string) => (
    <div className="profile-tile">
      <span className="profile-value">{m.value === null ? '–' : `${m.value}${unit}`}</span>
      <span className="profile-label">{label}</span>
      <span className="profile-note muted">
        {m.value === null ? empty : m.trend && m.recent !== null && m.before !== null ? `Lately ${m.recent}${unit}, before ${m.before}${unit}: ${TREND[m.trend]}` : `From ${m.games} ${m.games === 1 ? 'game' : 'games'}`}
      </span>
    </div>
  );
  return (
    <section className="profile" aria-label="Your profile">
      <header>
        <h3>Your profile</h3>
        <span className="muted">
          From {p.games} analysed {p.games === 1 ? 'game' : 'games'}
          {p.band ? ` · by your blunder rate you play like the ${p.band.band} band (a rough guide)` : ''}
        </span>
      </header>
      <div className="profile-tiles">
        {tile('Blunders per 100 live moves', p.blunders, '', 'No live moves counted yet')}
        {tile('Pieces hung per game', p.hungPieces, '', 'Not counted yet')}
        {tile('Games lost in the opening', p.openingLosses, '%', 'Not counted yet')}
        {tile('Won positions converted', p.conversion, '%', 'No won position yet')}
      </div>
      {p.steps.length > 0 && (
        <p className="profile-steps">
          <span className="muted">Skipped most often:</span>{' '}
          {p.steps
            .slice(0, 3)
            .map((x) => `${x.name.charAt(0).toLowerCase()}${x.name.slice(1)} (${x.count}${x.trend ? `, ${TREND[x.trend]} lately` : ''})`)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}

function Row({ g }: { g: GameSummary }) {
  const [confirm, setConfirm] = useState(false);
  const opponent = g.you === 'white' ? g.black : g.you === 'black' ? g.white : `${g.white} – ${g.black}`;
  const rating = g.you === 'white' ? g.blackRating : g.you === 'black' ? g.whiteRating : undefined;
  const outcome = g.outcome ? OUTCOME[g.outcome] : g.result === '1/2-1/2' ? 'Draw' : g.result;
  const how = ENDING[g.ending];
  const moves = Math.ceil(g.plies / 2);
  return (
    <li className={`game-row ${g.outcome ?? 'other'}`}>
      <button className="game-open" onClick={() => send({ type: 'library', action: 'open', id: g.id })} title="Open this game on the analysis board">
        <span className="game-outcome">{outcome}</span>
        <span className="game-who">
          {g.you && <i className={`side-dot ${g.you}`} title={`You played ${g.you === 'white' ? 'White' : 'Black'}`} aria-label={`You played ${g.you === 'white' ? 'White' : 'Black'}`} />}
          {g.you ? 'against ' : ''}
          <b>{opponent}</b>
          {rating !== undefined && <span className="muted"> ({rating})</span>}
          {how && <span className="muted"> · {how}</span>}
          {g.reviewed === false && <span className="game-new">Not reviewed</span>}
        </span>
        <span className="game-opening muted">{g.opening ?? ''}</span>
        <span className="game-speed">
          {[SPEED[g.timeClass], g.timeControl].filter(Boolean).join(' · ')}
          {!g.rated && <span className="muted"> · casual</span>}
        </span>
        <span className="game-meta muted">
          {moves} {moves === 1 ? 'move' : 'moves'} · {SITE[g.site]} · {day(g.playedAt)}
        </span>
      </button>
      {confirm ? (
        <span className="confirm-inline">
          Remove?
          <button className="btn danger small" onClick={() => send({ type: 'library', action: 'remove', id: g.id })}>
            Yes
          </button>
          <button className="btn small" onClick={() => setConfirm(false)}>
            No
          </button>
        </span>
      ) : (
        <button className="icon-btn plain" onClick={() => setConfirm(true)} aria-label="Remove this game from the list" title="Remove this game from the list">
          <Trash2 size={15} strokeWidth={1.9} />
        </button>
      )}
    </li>
  );
}

export function GamesView({ s }: { s: Store }) {
  const lib = s.library;
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  if (!lib) return <main className="layout games" />;
  const named = lib.accounts.some((a) => a.user);
  const shown = filter === 'all' ? lib.games : lib.games.filter((g) => g.outcome === filter);
  const { win, loss, draw } = lib.record;
  const add = () => {
    send({ type: 'library', action: 'import', text });
    setText('');
  };

  return (
    <main className="layout games">
      <aside className="pane pane-left">
        <section className="pane-section">
          <header className="pane-head">
            <h2>Your accounts</h2>
          </header>
          <div className="accounts">
            {lib.accounts.map((a) => (
              <Account key={a.site} a={a} />
            ))}
          </div>
          <button className="btn primary wide" disabled={!named || lib.syncing} onClick={() => send({ type: 'library', action: 'sync' })}>
            <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
            {lib.syncing ? 'Fetching…' : 'Fetch new games'}
          </button>
          <p className="play-note">Only your name is needed: finished games are public on both sites. New games are fetched by themselves while the app is open.</p>
        </section>
        <section className="pane-section">
          <header className="pane-head">
            <h2>Add a game</h2>
          </header>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Paste a PGN,\nor a link to a game on Lichess or Chess.com'} aria-label="A PGN, or a link to a game" spellCheck={false} />
          <button className="btn wide" disabled={!text.trim()} onClick={add}>
            Add and open
          </button>
        </section>
        {s.repstats && <RepStats v={s.repstats} />}
        {lib.journal.length > 0 && (
          <section className="pane-section journal">
            <header className="pane-head">
              <h2>Takeaway journal</h2>
            </header>
            <p className="play-note">The habits your reviews keep coming back to, the most frequent first.</p>
            <ol>
              {lib.journal.slice(0, 5).map((j) => (
                <li key={j.step}>
                  {j.habit}. <span className="muted">In {j.games} {j.games === 1 ? 'game' : 'games'}.</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <p className="notice">
          <ShieldCheck size={15} strokeWidth={1.9} aria-hidden="true" />
          <span>Finished games only. A game you are still playing, Daily games included, is never imported or analysed: both sites ban outside help.</span>
        </p>
      </aside>

      <section className="games-main">
        <header className="games-head">
          <div>
            <h2>My games</h2>
            <p className="muted">
              {lib.total === 0 ? 'None yet.' : `${lib.total} ${lib.total === 1 ? 'game' : 'games'}`}
              {win + loss + draw > 0 && ` · won ${win}, lost ${loss}, drew ${draw}`}
              {lib.total > lib.games.length && ` · the newest ${lib.games.length} are shown`}
            </p>
          </div>
          {lib.total > 0 && (
            <Segmented<Filter>
              label="Which games to show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'win', label: 'Won' },
                { value: 'loss', label: 'Lost' },
                { value: 'draw', label: 'Drew' },
              ]}
            />
          )}
        </header>
        {lib.total > 0 && <Profile p={lib.profile} />}
        {lib.total === 0 ? (
          <div className="games-empty">
            <p className="thread-empty-title">Your games will be listed here.</p>
            <p className="muted">
              {named
                ? 'Press "Fetch new games" to bring in your finished games, or paste one on the left.'
                : 'Enter your name on Lichess or Chess.com on the left and your finished Rapid, Classical and Daily games are fetched. You can also paste a single game.'}
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="games-empty muted">No games of that kind.</p>
        ) : (
          <ul className="game-list">
            {shown.map((g) => (
              <Row key={g.id} g={g} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
