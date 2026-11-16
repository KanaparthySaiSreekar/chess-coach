// "Play a bot" (features A5, F4, F9): the roster of human-like opponents, and the game itself.
// While a game is being played nothing from the engine is on the screen and the coach is quiet:
// the owner thinks for themselves. Afterwards the game goes to the analysis board in one click.

import { useEffect, useState } from 'react';
import { Flag, Handshake, Microscope, Plus, Repeat2, Undo2 } from 'lucide-react';
import { TIME_CONTROLS, clockLeft, clockText, type BotView, type BotsView, type Color, type GameClock, type GameView } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { MoveList } from './MoveList.tsx';
import { PieceBox } from './San.tsx';
import { playTick, send, setting, useStore, type Store } from './store.ts';
import { Message } from './CoachPanel.tsx';
import { Segmented, Transport } from './ui.tsx';
import { MaterialStrip } from './Material.tsx';

type Side = 'white' | 'black' | 'random';
const OUTCOME: Record<string, string> = { win: 'Won', loss: 'Lost', draw: 'Drew' };

function mainEnd(game: GameView): string {
  let cur = game.tree.nodes[game.tree.root]!;
  while (cur.children.length) cur = game.tree.nodes[cur.children[0]!]!;
  return cur.id;
}

/** The opponent's face: a pawn on a light square. */
function BotFace() {
  return (
    <span className="bot-avatar" aria-hidden="true">
      <PieceBox className="mark-piece" role="pawn" color="black" />
    </span>
  );
}

function Picker({ bots, picked, onPick }: { bots: BotsView; picked: string; onPick: (id: string) => void }) {
  const bands = [...new Set(bots.bots.map((b) => b.band))];
  return (
    <section className="pane-section grow bots">
      <header className="pane-head">
        <h2>Choose an opponent</h2>
      </header>
      <div className="bots-scroll">
        {bands.map((band) => (
          <div key={band} className="bot-band">
            <h3 className="bot-band-name">{band}</h3>
            <div className="bot-grid">
              {bots.bots
                .filter((b) => b.band === band)
                .map((b) => (
                  <button key={b.id} className={`bot${picked === b.id ? ' picked' : ''}`} onClick={() => onPick(b.id)} aria-pressed={picked === b.id} title={b.about}>
                    <span className="bot-name">{b.name}</span>
                    <span className="bot-elo">{b.elo}</span>
                    {bots.suggested === b.id && <span className="bot-suggested">For you</span>}
                  </button>
                ))}
            </div>
          </div>
        ))}
        {bots.minis.length > 0 && (
          <div className="bot-band">
            <h3 className="bot-band-name">Mini-games</h3>
            <div className="mini-list">
              {bots.minis.map((m) => (
                <button key={m.id} className={`mini${picked === `mini:${m.id}` ? ' picked' : ''}`} aria-pressed={picked === `mini:${m.id}`} onClick={() => onPick(`mini:${m.id}`)} title={m.about}>
                  <span className="bot-name">{m.name}</span>
                  <span className="muted">{m.idea}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** A mini-game picked (F6): its idea, its goal, and the bot it is played against. */
function MiniSetup({ mini, bots }: { mini: BotsView['minis'][number]; bots: BotsView }) {
  const bot = bots.bots.find((b) => b.id === bots.suggested) ?? bots.bots[0];
  return (
    <aside className="pane pane-right play-side">
      <div className="bot-card">
        <div>
          <div className="bot-card-name">{mini.name}</div>
          <div className="muted">You play {mini.you === 'white' ? 'White' : 'Black'}</div>
        </div>
      </div>
      <p className="bot-about">{mini.about}</p>
      <p className="bot-why">
        <strong>Goal:</strong> {mini.goal} <span className="muted">The idea: {mini.idea.toLowerCase()}.</span>
      </p>
      {bot && (
        <button className="btn primary big" onClick={() => send({ type: 'game', action: 'mini', id: mini.id })}>
          Play it against {bot.name}
        </button>
      )}
    </aside>
  );
}

/** One side's clock, counting down on the page between the server's updates. */
function Clock({ clock, side, mine }: { clock: GameClock; side: Color; mine: boolean }) {
  const running = clock.running === side;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running, clock.at]);
  const left = clockLeft(clock, side, running ? now : clock.at);
  return (
    <div className={`clock${running ? ' running' : ''}${left < 30_000 ? ' low' : ''}`} aria-label={`${mine ? 'Your' : 'Their'} time: ${clockText(left)}`}>
      {clockText(left)}
    </div>
  );
}

function Setup({ bots, bot, side, setSide, time }: { bots: BotsView; bot: BotView | undefined; side: Side; setSide: (s: Side) => void; time: string }) {
  const control = TIME_CONTROLS.find((t) => t.id === time) ?? TIME_CONTROLS[0]!;
  return (
    <aside className="pane pane-right play-side">
      {bot ? (
        <>
          <div className="bot-card">
            <BotFace />
            <div>
              <div className="bot-card-name">{bot.name}</div>
              <div className="muted">
                Rated {bot.elo}, {bot.band.toLowerCase()}
              </div>
            </div>
          </div>
          <p className="bot-about">{bot.about}</p>
          {bots.suggested === bot.id && <p className="bot-why">Suggested from your results so far: two wins in three games move you up a step, three losses in a row move you down.</p>}
          <div className="field">
            <span className="field-label">You play</span>
            <Segmented
              label="Your colour"
              value={side}
              onChange={setSide}
              options={[
                { value: 'white', label: 'White' },
                { value: 'black', label: 'Black' },
                { value: 'random', label: 'Random' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Clock</span>
            <div className="chips time-controls" role="group" aria-label="Clock">
              {TIME_CONTROLS.map((t) => (
                <button key={t.id} className={`chip${t.id === control.id ? ' on' : ''}`} aria-pressed={t.id === control.id} onClick={() => send({ type: 'setting', key: 'play.timeControl', value: t.id })}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button className="btn primary big" onClick={() => send({ type: 'game', action: 'start', bot: bot.id, color: side, time: control.time })}>
            Play {bot.name}
          </button>
        </>
      ) : (
        <p className="muted">The bot roster did not load (content/bots.json).</p>
      )}
      {bots.state === 'starting' && <p className="play-note">Waking the bots up… (a few seconds, the first time)</p>}
      {bots.state === 'error' && <p className="play-note error">The bots are not available: {bots.problem}</p>}
      {bots.record.length > 0 && (
        <div className="record">
          <h3>Your recent games</h3>
          <div className="group">
            {bots.record.map((r, i) => (
              <div key={i} className={`record-row ${r.outcome}`}>
                <span className="record-outcome">{OUTCOME[r.outcome]}</span>
                <span>
                  {r.name} <span className="muted">({r.elo})</span>
                </span>
                <span className="muted">{new Date(r.at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="play-foot muted">
        The bots are Maia-3: each plays the moves real players of its rating play, mistakes included. Ratings are on Lichess's scale. How close the weakest bots are to a real beginner has not been measured yet.
      </p>
    </aside>
  );
}

function GameSide({ game, atEnd }: { game: GameView; atEnd: boolean }) {
  const [confirmResign, setConfirmResign] = useState(false);
  useEffect(() => setConfirmResign(false), [game.status]);
  const bot = game.bot!;
  const over = game.status === 'over';
  const won = over && game.result?.winner === game.you;
  const drew = over && !game.result?.winner;
  const them: Color = game.you === 'white' ? 'black' : 'white';
  return (
    <aside className="pane pane-right play-side">
      <div className="bot-card">
        <BotFace />
        <div>
          <div className="bot-card-name">{bot.name}</div>
          <div className="muted">
            Rated {bot.elo}, plays {game.you === 'white' ? 'Black' : 'White'}
          </div>
        </div>
        {game.clock && <Clock clock={game.clock} side={them} mine={false} />}
      </div>
      {game.mini && (
        <p className="bot-why">
          <strong>{game.mini.name}.</strong> {game.mini.goal}
        </p>
      )}
      {game.clock && (
        <div className="your-clock">
          <span className="muted">Your time</span>
          <Clock clock={game.clock} side={game.you} mine />
        </div>
      )}

      {over ? (
        <div className={`game-result ${won ? 'won' : drew ? 'drew' : 'lost'}`} role="status">
          <strong>{won ? 'You won' : drew ? 'A draw' : 'You lost'}</strong>
          <span>{game.result?.text}</span>
        </div>
      ) : (
        <div className="game-status" role="status">
          {game.problem ? (
            <>
              <span className="error">{game.problem}</span>
              <button className="btn small" onClick={() => send({ type: 'game', action: 'retry' })}>
                Try again
              </button>
            </>
          ) : game.thinking ? (
            <span className="thinking-dots">
              {bot.name} is thinking <i />
              <i />
              <i />
            </span>
          ) : (
            <>
              <strong>Your move</strong>
              {game.prompt && <span className="routine-prompt">{game.prompt}</span>}
            </>
          )}
          {!atEnd && (
            <button className="link" onClick={() => send({ type: 'game', action: 'nav', to: 'end' })}>
              Back to the game
            </button>
          )}
        </div>
      )}

      <SparCoach game={game} />

      {!over && game.offer && !game.thinking && (
        <div className="undo-offer" role="status">
          <strong>That move {game.offer.what}.</strong>
          <p>{game.offer.question}</p>
          <div className="play-actions">
            <button className="btn primary" onClick={() => send({ type: 'game', action: 'take_offer' })}>
              <Undo2 size={15} strokeWidth={1.9} aria-hidden="true" />
              Take it back
            </button>
            <button className="btn" onClick={() => send({ type: 'game', action: 'play_on' })}>
              Play on
            </button>
          </div>
          <p className="muted">Taking it back counts like a hint.</p>
        </div>
      )}

      {over ? (
        <div className="play-actions">
          <button className="btn primary big" onClick={() => send({ type: 'game', action: 'analyse' })}>
            <Microscope size={17} strokeWidth={1.9} aria-hidden="true" />
            Review this game with the coach
          </button>
          {game.mini ? (
            <button className="btn" onClick={() => send({ type: 'game', action: 'mini', id: game.mini!.id, bot: bot.id })}>
              <Repeat2 size={15} strokeWidth={1.9} aria-hidden="true" />
              Play it again
            </button>
          ) : (
            <button className="btn" onClick={() => send({ type: 'game', action: 'start', bot: bot.id, color: game.you === 'white' ? 'black' : 'white', time: game.time ?? null })}>
              <Repeat2 size={15} strokeWidth={1.9} aria-hidden="true" />
              Rematch (switch sides)
            </button>
          )}
          <button className="btn" onClick={() => send({ type: 'game', action: 'new' })}>
            <Plus size={15} strokeWidth={1.9} aria-hidden="true" />
            Choose another bot
          </button>
        </div>
      ) : (
        <div className="play-actions">
          <button className="btn" onClick={() => send({ type: 'game', action: 'takeback' })} disabled={Object.keys(game.tree.nodes).length < 2} title="Take your last move back. Counted, so you can see how often you needed it.">
            <Undo2 size={15} strokeWidth={1.9} aria-hidden="true" />
            Take back{game.takebacks ? ` (${game.takebacks} used)` : ''}
          </button>
          <button className="btn" onClick={() => send({ type: 'game', action: 'draw' })} title="The bot accepts when it is not better; not in the first ten moves">
            <Handshake size={15} strokeWidth={1.9} aria-hidden="true" />
            Offer a draw
          </button>
          {confirmResign ? (
            <span className="confirm-inline">
              Resign?
              <button className="btn danger small" onClick={() => send({ type: 'game', action: 'resign' })}>
                Yes
              </button>
              <button className="btn small" onClick={() => setConfirmResign(false)}>
                No
              </button>
            </span>
          ) : (
            <button className="btn" onClick={() => setConfirmResign(true)}>
              <Flag size={15} strokeWidth={1.9} aria-hidden="true" />
              Resign
            </button>
          )}
        </div>
      )}

      {!over && (
        <p className="play-note">
          While you play, the eval bar, the arrows, the move labels and the coach stay off: this is your thinking time. The one exception is the offer to take back a serious mistake, which you can switch off in Settings. Review the game afterwards and the coach goes through it with you.
        </p>
      )}
    </aside>
  );
}

/** The sparring coach beside the game (WP 7.7): its lines for this game, and the button to ask it. */
function SparCoach({ game }: { game: GameView }) {
  const s = useStore();
  const on = !!s.status && s.status.state !== 'off' && s.status.state !== 'error';
  if (!on || game.gameNo === undefined) return null;
  const messages = s.thread.filter((m) => m.spar === game.gameNo);
  const thinking = s.status?.state === 'thinking' || s.status?.state === 'retrying';
  const yourTurn = game.status === 'playing' && !game.thinking;
  return (
    <div className="drill-coach">
      {messages.length > 0 && (
        <div className="drill-thread" aria-live="polite">
          {messages.slice(-3).map((m) => (
            <Message key={m.id} m={m} />
          ))}
        </div>
      )}
      {yourTurn && (
        <button className="btn" disabled={thinking} onClick={() => send({ type: 'game', action: 'ask_coach' })} title="The coach asks you a question about the routine; it counts like a hint">
          Ask the coach
        </button>
      )}
    </div>
  );
}

/** The whole "Play a bot" screen: three panes, like the analysis board. */
export function PlayView({ s }: { s: Store }) {
  const game = s.game;
  const bots = s.bots;
  const [picked, setPicked] = useState<string>('');
  const [side, setSide] = useState<Side>('white');
  const suggested = bots?.suggested ?? '';
  useEffect(() => {
    if (!picked && suggested) setPicked(suggested);
  }, [picked, suggested]);

  // the arrow keys step through the game
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!game || game.status === 'idle') return;
      const to = e.key === 'ArrowLeft' ? 'prev' : e.key === 'ArrowRight' ? 'next' : e.key === 'ArrowUp' || e.key === 'Home' ? 'start' : e.key === 'ArrowDown' || e.key === 'End' ? 'end' : null;
      if (!to) return;
      send({ type: 'game', action: 'nav', to });
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game?.status]);

  if (!game || !bots) return <main className="layout play" />;
  const idle = game.status === 'idle';
  const node = game.tree.nodes[game.focus]!;
  const end = mainEnd(game);
  const atEnd = game.focus === end;
  const turn = node.fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const canMove = game.status === 'playing' && !game.thinking && atEnd && turn === game.you && !game.problem;
  const mini = picked.startsWith('mini:') ? bots.minis.find((m) => `mini:${m.id}` === picked) : undefined;
  const bot = bots.bots.find((b) => b.id === picked) ?? bots.bots.find((b) => b.id === suggested) ?? bots.bots[0];
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';

  return (
    <main className="layout play">
      <aside className="pane pane-left">
        {idle ? (
          <Picker bots={bots} picked={mini ? picked : (bot?.id ?? '')} onPick={setPicked} />
        ) : (
          <section className="pane-section grow">
            <header className="pane-head">
              <h2>Moves</h2>
            </header>
            <MoveList tree={game.tree} focus={game.focus} figurine={figurine} labels={false} onGoto={(id) => send({ type: 'game', action: 'nav', to: id })} empty={game.you === 'white' ? 'Your move: you are White.' : `${game.bot?.name ?? 'The bot'} moves first.`} />
          </section>
        )}
      </aside>

      <section className="stage">
        <div className="board-stack">
          {!idle && <MaterialStrip fen={node.fen} side={game.you === 'white' ? 'black' : 'white'} mode={setting(s, 'display.material', 'captured')} />}
          <div className="board-pair">
            <Board
              fen={idle && mini ? mini.fen : node.fen}
              orientation={idle && mini ? mini.you : idle && side === 'black' ? 'black' : idle ? 'white' : game.you}
              interactive={canMove}
              movable={game.you}
              lastMove={node.from && node.to ? [node.from, node.to] : undefined}
              coachShapes={[]}
              bestArrows={[]}
              hoverSquares={[]}
              coordinates={setting(s, 'display.coordinates', true)}
              theme={setting(s, 'display.boardTheme', 'brown')}
              resync={s.resync}
              onMove={(from, to, promotion) => {
                playTick();
                send({ type: 'game', action: 'move', from, to, promotion });
              }}
            />
          </div>
          {!idle && <MaterialStrip fen={node.fen} side={game.you} mode={setting(s, 'display.material', 'captured')} />}
          {!idle && (
            <div className="under-board">
              <Transport label="Step through the game" endName="Latest position" onStep={(to) => send({ type: 'game', action: 'nav', to })} />
              <div className="turn">
                <span className={`turn-dot ${turn}`} aria-hidden="true" />
                {game.status === 'over' ? 'Game over' : turn === game.you ? 'Your move' : `${game.bot?.name ?? 'The bot'} to move`}
                <span className="muted">(you are {game.you})</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {idle ? mini ? <MiniSetup mini={mini} bots={bots} /> : <Setup bots={bots} bot={bot} side={side} setSide={setSide} time={setting(s, 'play.timeControl', 'untimed')} /> : <GameSide game={game} atEnd={atEnd} />}
    </main>
  );
}
