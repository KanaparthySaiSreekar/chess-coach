// The page: a toolbar on top (the mark, the mode picker, the Game menu, the View switches and the
// settings); below it three panes side by side: the moves on the left, the shared board with its
// eval bar in the middle, the coach on the right. "Play a bot" has its own screen.

import { useEffect, useState } from 'react';
import { ArrowUpDown, BookOpen, ChevronDown, ClipboardCheck, Eraser, FolderOpen, Grid3x3, Microscope, PenOff, Plus, RefreshCw, RotateCcw, Settings as Gear, Share, ShieldCheck, SlidersHorizontal, Tags, Undo2 } from 'lucide-react';
import { BAD_LABELS, START_FEN, demoFen, demoGauge, demoLastMove, gaugeWords, type AppMode, type Color, type Gauge, type Judged, type Shape } from '@chess-coach/core';
import { Board } from './Board.tsx';
import { CoachPanel } from './CoachPanel.tsx';
import { DemoBar, DemoLines, demoView, stepDemo } from './DemoBar.tsx';
import { EditorView } from './Editor.tsx';
import { EvalBar } from './EvalBar.tsx';
import { ExplorerPane } from './Explorer.tsx';
import { RepGameNote } from './RepGame.tsx';
import { MaterialStrip } from './Material.tsx';
import { OpeningsTab } from './OpeningsTab.tsx';
import { EndgamesTab } from './Endgames.tsx';
import { GamesView } from './Games.tsx';
import { KeyMoments } from './Moments.tsx';
import { Verdict } from './labels.tsx';
import { MoveList } from './MoveList.tsx';
import { PlayView } from './Play.tsx';
import { PuzzlesView } from './Puzzles.tsx';
import { StudiesDialog } from './Studies.tsx';
import { ContentReviewDialog } from './ContentReview.tsx';
import { SanLine } from './San.tsx';
import { Control, Presets, SettingsWindow } from './Settings.tsx';
import { closePgn, playTick, send, setPeek, setting, stopAnim, toast, useStore, type Store } from './store.ts';
import { Mark, MenuList, Popover, Sheet, Transport, type MenuEntry } from './ui.tsx';

function LoadDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  return (
    <Sheet label="Load a game or position" onClose={onClose}>
      <h2>Load a game or a position</h2>
      <p className="muted">Paste a PGN (a finished game, with side lines if it has them) or a FEN.</p>
      <textarea autoFocus rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1. e4 e5 2. Nf3 Nc6 …\n\nor\n\nr1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'} />
      <p className="fair">
        <ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
        <span>Finished games only. A game still being played, Daily games included, must not be analysed: both sites ban outside help.</span>
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => {
            send({ type: 'load', text });
            onClose();
          }}
        >
          Load
        </button>
      </div>
    </Sheet>
  );
}

function PgnDialog({ text }: { text: string }) {
  return (
    <Sheet label="PGN" onClose={closePgn}>
      <h2>Export PGN</h2>
      <textarea readOnly rows={12} value={text} onFocus={(e) => e.target.select()} />
      <div className="modal-actions">
        <button className="btn" onClick={closePgn}>
          Close
        </button>
        <button
          className="btn primary"
          autoFocus
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => toast('info', 'Copied.'),
              () => toast('error', 'Could not copy: select the text and copy it by hand.'),
            );
          }}
        >
          Copy
        </button>
      </div>
    </Sheet>
  );
}

/** Reset the whole position (feature I14): to the normal start, or to the first position of what is loaded. */
function ResetDialog({ moves, customStart, onClose }: { moves: number; customStart: boolean; onClose: () => void }) {
  const [clearChat, setClearChat] = useState(false);
  const go = (to: 'start' | 'root') => {
    send({ type: 'reset', to });
    if (clearChat) send({ type: 'clear_thread' });
    onClose();
  };
  return (
    <Sheet label="Reset the board" onClose={onClose} className="narrow">
      <h2>Reset the board</h2>
      <p className="muted">
        {moves > 0 ? `This clears ${moves === 1 ? 'the 1 move' : `all ${moves} moves`} on the board, side lines included, and the coach's lines.` : 'This board starts from a position you set up.'} Export the PGN first if you want to keep
        it.
      </p>
      <label className="check">
        <input type="checkbox" checked={clearChat} onChange={(e) => setClearChat(e.target.checked)} />
        Also clear the conversation with the coach
      </label>
      <div className="modal-actions stack">
        <button className="btn primary" autoFocus onClick={() => go('start')}>
          Reset to the starting position
        </button>
        {customStart && (
          <button className="btn" onClick={() => go('root')}>
            Clear the moves, keep this game's first position
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

// what the board shows, switchable without opening the settings window
const ON_BOARD = ['display.evalBar', 'display.bestArrows', 'display.bestArrowCount', 'display.moveLabels', 'display.engineLines', 'display.numbers'];
const LOOK = ['display.notation', 'display.boardTheme', 'display.pieceSet', 'display.appearance'];
const QUICK_LABEL: Record<string, string> = {
  'display.bestArrowCount': 'Arrows to draw',
  'display.moveLabels': 'Move labels',
  'display.notation': 'Notation',
  'display.appearance': 'Appearance',
};

function ViewMenu({ s, openSettings }: { s: Store; openSettings: () => void }) {
  const rows = (keys: string[]) =>
    keys.map((key) => {
      const def = s.settings.find((x) => x.key === key);
      if (!def) return null;
      if (key === 'display.bestArrowCount' && !setting(s, 'display.bestArrows', true)) return null;
      return (
        <div className="quick-row" key={key} title={def.why}>
          <span>{QUICK_LABEL[key] ?? def.label}</span>
          <Control s={def} />
        </div>
      );
    });
  return (
    <Popover
      label={
        <>
          <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" />
          View
        </>
      }
      title="What the board shows, and how the page looks"
      align="end"
    >
      {(close) => (
        <div className="view-menu">
          <h3>On the board</h3>
          <div className="group">{rows(ON_BOARD)}</div>
          <h3>Look</h3>
          <div className="group">{rows(LOOK)}</div>
          <h3>Presets</h3>
          <Presets compact />
          <button
            className="btn quiet wide"
            onClick={() => {
              close();
              openSettings();
            }}
          >
            All settings…
          </button>
        </div>
      )}
    </Popover>
  );
}

function ModePicker({ s }: { s: Store }) {
  const tab = (mode: AppMode, label: string, dot?: string) => (
    <button role="tab" aria-selected={s.mode === mode} className={`mode${s.mode === mode ? ' current' : ''}`} onClick={() => send({ type: 'mode', mode })}>
      {label}
      {dot && <span className="mode-dot" title={dot} />}
    </button>
  );
  return (
    <nav className="modes" role="tablist" aria-label="Mode">
      {tab('analysis', 'Analysis board')}
      {tab('play', 'Play a bot', s.game?.status === 'playing' ? 'A game is in progress' : undefined)}
      {tab('puzzles', 'Puzzles', s.puzzle && s.puzzle.fresh > 0 ? `${s.puzzle.fresh} ${s.puzzle.fresh === 1 ? 'puzzle' : 'puzzles'} not tried yet` : undefined)}
      {tab('openings', 'Openings', s.opening && s.opening.due > 0 ? `${s.opening.due} opening ${s.opening.due === 1 ? 'card' : 'cards'} due` : undefined)}
      {tab('endgames', 'Endgames', s.endgame && s.endgame.due > 0 ? `${s.endgame.due} ${s.endgame.due === 1 ? 'endgame' : 'endgames'} due` : undefined)}
      {tab('games', 'My games')}
    </nav>
  );
}

/** Light or dark, and the typeface of the coach's words: both are settings (I16). */
function useLook(s: Store) {
  const known = s.settings.length > 0;
  const want = setting<string>(s, 'display.appearance', 'auto');
  const voice = setting<string>(s, 'display.coachFont', 'book');
  useEffect(() => {
    if (!known) return; // until the settings arrive the page keeps what index.html worked out
    try {
      localStorage.setItem('cc.appearance', want);
    } catch {
      /* private mode: the next start just follows the system until the settings arrive */
    }
    const light = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      document.documentElement.dataset.theme = want === 'dark' || (want !== 'light' && !light.matches) ? 'dark' : 'light';
    };
    apply();
    light.addEventListener('change', apply);
    return () => light.removeEventListener('change', apply);
  }, [known, want]);
  useEffect(() => {
    document.documentElement.dataset.coachFont = voice;
  }, [voice]);
  // the piece set (I9): the default one needs no attribute, the others are picked by it in pieces.css
  const pieces = setting<string>(s, 'display.pieceSet', 'cburnett');
  useEffect(() => {
    if (pieces === 'cburnett') delete document.documentElement.dataset.pieces;
    else document.documentElement.dataset.pieces = pieces;
  }, [pieces]);
}

export function App() {
  const s = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [showStudies, setShowStudies] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [showReset, setShowReset] = useState(false);
  // the board editor takes the place of the analysis board while a position is being set up (I2)
  const [editing, setEditing] = useState(false);
  const st = s.state;
  const analysis = s.mode === 'analysis';
  useLook(s);

  // leaving the analysis board also leaves the editor
  useEffect(() => {
    if (!analysis) setEditing(false);
  }, [analysis]);

  // keyboard: arrows step through the moves, or through the coach's line when it is showing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes whatever is open, also from inside a text field (the settings search has the focus)
      if (e.key === 'Escape') {
        setPeek(null);
        setShowSettings(false);
        setShowLoad(false);
        setShowReset(false);
        setEditing(false);
        // the sheets too: a button that disables itself drops the focus out of its sheet, where the sheet's own Escape cannot hear it
        setShowStudies(false);
        setShowContent(false);
        closePgn();
        return;
      }
      // the usual key for an app's settings
      if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
        setShowSettings(true);
        return e.preventDefault();
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!st || !analysis || editing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (st.layer === 'demo' && st.demo) {
        if (e.key === 'ArrowLeft') stepDemo(st.demo, st.demo.cursor, -1);
        else if (e.key === 'ArrowRight') stepDemo(st.demo, st.demo.cursor, 1);
        else return;
        return e.preventDefault();
      }
      if (e.key === 'ArrowLeft') send({ type: 'nav', to: 'prev' });
      else if (e.key === 'ArrowRight') send({ type: 'nav', to: 'next' });
      else if (e.key === 'ArrowUp' || e.key === 'Home') send({ type: 'nav', to: 'start' });
      else if (e.key === 'ArrowDown' || e.key === 'End') send({ type: 'nav', to: 'end' });
      else if (e.key === 'f') send({ type: 'flip' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st, analysis, editing]);

  if (!st) {
    return (
      <div className="loading">
        <Mark className="big" />
        <p className="loading-title">{s.connected ? 'Setting up the board…' : 'Connecting to the chess-coach server…'}</p>
        {!s.connected && (
          <p className="muted">
            Start it with <code>npm run dev</code>
          </p>
        )}
      </div>
    );
  }

  const node = st.tree.nodes[st.focus]!;
  const moveCount = Object.keys(st.tree.nodes).length - 1;
  const customStart = st.tree.rootFen !== START_FEN;
  const reset = () => {
    if (moveCount === 0 && !customStart) return toast('info', 'The board is already at the starting position.');
    setShowReset(true);
  };
  const flip = () => {
    stopAnim();
    send({ type: 'flip' });
  };
  // every command of the current mode, in one menu (I15): the game first, then the board, then the conversation
  const menu: MenuEntry[] = analysis
    ? [
        { label: 'Load a PGN or FEN…', icon: FolderOpen, run: () => setShowLoad(true) },
        { label: 'Set up a position…', icon: Grid3x3, run: () => setEditing(true) },
        { label: 'Export the PGN…', icon: Share, run: () => send({ type: 'export' }) },
        { label: 'Studies…', icon: BookOpen, run: () => setShowStudies(true) },
        { label: 'Review content…', icon: ClipboardCheck, run: () => setShowContent(true) },
        { label: 'Reset the board…', icon: RotateCcw, run: reset },
        'sep',
        { label: 'Label every move of this game', icon: Tags, run: () => send({ type: 'label_all' }), disabled: moveCount === 0 || !!s.busy },
        { label: 'Flip the board', icon: ArrowUpDown, hint: 'F', run: flip },
        { label: 'Clear my drawings on this position', icon: PenOff, run: () => send({ type: 'shapes', shapes: [] }), disabled: st.shapes.owner.length === 0 },
        'sep',
        { label: 'Clear the conversation', icon: Eraser, run: () => send({ type: 'clear_thread' }), disabled: s.thread.length === 0 },
        'sep',
        { label: 'Settings…', icon: Gear, hint: 'Ctrl ,', run: () => setShowSettings(true) },
      ]
    : s.mode === 'puzzles'
      ? [
          { label: 'Next puzzle', icon: Plus, run: () => send({ type: 'puzzle', action: 'next' }), disabled: !s.puzzle?.ready },
          { label: 'Try this one again', icon: RotateCcw, run: () => send({ type: 'puzzle', action: 'retry' }), disabled: !s.puzzle || s.puzzle.status === 'idle' },
          'sep',
          { label: 'Settings…', icon: Gear, hint: 'Ctrl ,', run: () => setShowSettings(true) },
        ]
      : s.mode === 'openings'
      ? [
          { label: 'Review content…', icon: ClipboardCheck, run: () => setShowContent(true) },
          { label: 'Next opening card', icon: Plus, run: () => send({ type: 'opening', action: 'next' }) },
          'sep',
          { label: 'Settings…', icon: Gear, hint: 'Ctrl ,', run: () => setShowSettings(true) },
        ]
      : s.mode === 'endgames'
      ? [
          { label: 'Next endgame', icon: Plus, run: () => send({ type: 'endgame', action: 'next' }), disabled: !s.endgame?.ready },
          { label: 'Play this one again', icon: RotateCcw, run: () => send({ type: 'endgame', action: 'retry' }), disabled: !s.endgame || s.endgame.status === 'idle' },
          'sep',
          { label: 'Settings…', icon: Gear, hint: 'Ctrl ,', run: () => setShowSettings(true) },
        ]
      : s.mode === 'games'
      ? [
          { label: 'Fetch new games', icon: RefreshCw, run: () => send({ type: 'library', action: 'sync' }), disabled: !!s.library?.syncing || !s.library?.accounts.some((a) => a.user) },
          'sep',
          { label: 'Settings…', icon: Gear, hint: 'Ctrl ,', run: () => setShowSettings(true) },
        ]
      : [
        { label: 'New game: choose a bot', icon: Plus, run: () => send({ type: 'game', action: 'new' }), disabled: s.game?.status === 'idle' },
        { label: 'Take back my last move', icon: Undo2, run: () => send({ type: 'game', action: 'takeback' }), disabled: s.game?.status !== 'playing' },
        { label: 'Review the finished game with the coach', icon: Microscope, run: () => send({ type: 'game', action: 'analyse' }), disabled: s.game?.status !== 'over' },
        'sep',
        { label: 'Settings…', icon: Gear, hint: 'Ctrl ,', run: () => setShowSettings(true) },
      ];

  const toolbar = (
    <header className="toolbar">
      <div className="brand">
        <Mark />
        <span>Chess Coach</span>
      </div>
      <ModePicker s={s} />
      <div className="toolbar-status">
        {s.busy && (
          <span className="busy" role="status">
            <i className="spinner" /> {s.busy}
          </span>
        )}
        {!s.connected && (
          <span className="offline" role="status">
            Reconnecting…
          </span>
        )}
      </div>
      <div className="toolbar-actions">
        <Popover
          label={
            <>
              Game
              <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
            </>
          }
          title="Everything you can do here"
          align="end"
          menu
        >
          {(close) => <MenuList items={menu} close={close} label="Game" />}
        </Popover>
        <ViewMenu s={s} openSettings={() => setShowSettings(true)} />
        <button className="tb-btn icon" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings (Ctrl+,)">
          <Gear size={17} strokeWidth={1.9} />
        </button>
      </div>
    </header>
  );
  const overlays = (
    <>
      {showSettings && <SettingsWindow onClose={() => setShowSettings(false)} />}
      {showLoad && <LoadDialog onClose={() => setShowLoad(false)} />}
      {showStudies && <StudiesDialog onClose={() => setShowStudies(false)} />}
      {showContent && <ContentReviewDialog onClose={() => setShowContent(false)} />}
      {showReset && <ResetDialog moves={moveCount} customStart={customStart} onClose={() => setShowReset(false)} />}
      {s.pgn !== null && <PgnDialog text={s.pgn} />}
      {s.toast && (
        <div className={`toast ${s.toast.level}`} role="status">
          {s.toast.text}
        </div>
      )}
    </>
  );

  if (s.mode === 'puzzles') {
    return (
      <div className="app">
        {toolbar}
        <PuzzlesView s={s} />
        {overlays}
      </div>
    );
  }

  if (s.mode === 'games') {
    return (
      <div className="app">
        {toolbar}
        <GamesView s={s} />
        {overlays}
      </div>
    );
  }

  if (s.mode === 'openings') {
    return (
      <div className="app">
        {toolbar}
        <OpeningsTab s={s} onReview={() => setShowContent(true)} />
        {overlays}
      </div>
    );
  }

  if (s.mode === 'endgames') {
    return (
      <div className="app">
        {toolbar}
        <EndgamesTab s={s} />
        {overlays}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="app">
        {toolbar}
        <PlayView s={s} />
        {overlays}
      </div>
    );
  }

  if (editing) {
    // start from the position on the board, so a small change to it is a few presses
    return (
      <div className="app">
        {toolbar}
        <EditorView s={s} initialFen={node.fen} initialOrientation={st.orientation} onClose={() => setEditing(false)} />
        {overlays}
      </div>
    );
  }

  const onDemo = st.layer === 'demo' && !!st.demo;
  const anim = onDemo && s.anim && s.anim.demo === st.demo!.id ? s.anim : null;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const labelsOn = setting(s, 'display.moveLabels', true);
  const barOn = setting(s, 'display.evalBar', true);
  const numbersOn = setting(s, 'display.numbers', false);

  // what the board shows: a peeked move, the coach's layer (animated or not), or the owner's position
  let fen = node.fen;
  let lastMove: [string, string] | undefined = node.from && node.to ? [node.from, node.to] : undefined;
  let boardNote: string | null = null;
  let gauge: Gauge | undefined = node.gauge;
  // the move that led to the position on the board, with the engine's label for it
  let shown: { san: string; by: Color; to: string; judged?: Judged; alt?: boolean } | undefined;
  if (node.san && node.to && node.parent) shown = { san: node.san, by: st.tree.nodes[node.parent]!.fen.split(' ')[1] === 'b' ? 'black' : 'white', to: node.to, judged: node.judged };
  if (s.peek) {
    fen = s.peek.fen;
    lastMove = [s.peek.from, s.peek.to];
    boardNote = `Looking at ${s.peek.san}`;
    gauge = undefined;
    shown = undefined;
  } else if (onDemo) {
    const demo = st.demo!;
    const view = { ...demo, cursor: demoView(demo, anim) };
    fen = demoFen(view);
    const lm = demoLastMove(view);
    lastMove = lm ? [lm.from, lm.to] : undefined;
    gauge = demoGauge(view);
    shown = lm ? { san: lm.san, by: lm.by, to: lm.to, judged: lm.judged, alt: lm.alt } : undefined;
  }
  // moves are allowed on the coach's board too: an off-line move becomes "your alternative" (A18)
  const interactive = !s.peek && !anim;
  const shapes: Shape[] = s.peek ? [] : st.shapes.coach;
  const arrows = !s.peek && !onDemo && s.insight && s.insight.fen === fen ? s.insight.arrows : [];
  const held = !s.peek && !onDemo && s.insight?.fen === fen ? s.insight.held : undefined;
  const badge = labelsOn && shown?.judged ? { square: shown.to, label: shown.judged.label } : undefined;
  // the move that should have been played, drawn in green when the move on the board was a slip (A19)
  const betterOn = labelsOn && setting(s, 'display.betterMoveArrow', true);
  const better = betterOn && shown?.judged && BAD_LABELS.has(shown.judged.label) ? shown.judged.bestAt : undefined;
  const turnWhite = fen.split(' ')[1] === 'w';
  const yourTurn = (turnWhite ? 'white' : 'black') === st.orientation;

  return (
    <div className="app">
      {toolbar}
      <main className="layout">
        <aside className="pane pane-left">
          {onDemo ? (
            <section className="pane-section grow coach-lines">
              <header className="pane-head">
                <h2>Coach's lines</h2>
                <button className="link" onClick={() => send({ type: 'demo', action: 'close' })}>
                  Back to my moves
                </button>
              </header>
              <div className="moves-scroll">
                <DemoLines demo={st.demo!} anim={anim} figurine={figurine} labels={labelsOn} />
              </div>
            </section>
          ) : (
            <section className="pane-section grow">
              <header className="pane-head">
                <h2>Moves</h2>
                <div className="pane-tools">
                  <button className="icon-btn plain" onClick={() => setShowLoad(true)} aria-label="Load PGN / FEN" title="Load a game or a position (PGN or FEN)">
                    <FolderOpen size={16} strokeWidth={1.9} />
                  </button>
                  <button className="icon-btn plain" onClick={() => send({ type: 'export' })} aria-label="Export PGN" title="Export this game as PGN">
                    <Share size={16} strokeWidth={1.9} />
                  </button>
                  <button className="icon-btn plain" onClick={reset} aria-label="Reset board" title="Reset the board: back to the starting position, or to the first position of this game">
                    <RotateCcw size={16} strokeWidth={1.9} />
                  </button>
                </div>
              </header>
              {st.game && (
                <div className="opening" title="One of your games. Open another from My games.">
                  <span className="eco">{st.game.result === '1/2-1/2' ? '½-½' : st.game.result}</span>
                  {st.game.white} – {st.game.black}
                </div>
              )}
              {st.opening && (
                <div className="opening" title={`ECO ${st.opening.eco}`}>
                  <span className="eco">{st.opening.eco}</span>
                  {st.opening.name}
                </div>
              )}
              <MoveList
                tree={st.tree}
                focus={st.focus}
                figurine={figurine}
                labels={labelsOn}
                onGoto={(id) => send({ type: 'nav', to: id })}
                onPromote={(id) => send({ type: 'promote', node: id })}
                onDelete={(id) => send({ type: 'delete', node: id })}
              />
              {moveCount > 0 && labelsOn && (
                <button className="btn quiet wide label-all" disabled={!!s.busy} onClick={() => send({ type: 'label_all' })} title="Have the engine label every move of this game, so the move list shows where it turned">
                  <Tags size={15} strokeWidth={1.9} aria-hidden="true" />
                  Label every move
                </button>
              )}
            </section>
          )}
          {!onDemo && st.game && <KeyMoments s={s} />}
          {!onDemo && st.game && s.repgame?.gameId === st.game.id && <RepGameNote v={s.repgame} tree={st.tree} you={st.game.you ?? st.orientation} figurine={figurine} />}
          {s.engine && (
            <section className="pane-section engine">
              <header className="pane-head">
                <h2>Engine lines</h2>
                <button className="link" onClick={() => send({ type: 'setting', key: 'display.engineLines', value: false })}>
                  Hide
                </button>
              </header>
              {s.engine.lines.length === 0 && <p className="muted">Nothing to show here.</p>}
              {s.engine.lines.map((l, i) => (
                <div className="engine-line" key={i}>
                  <span className="engine-moves">
                    <SanLine sans={l.line} fenBefore={node.fen} figurine={figurine} />
                  </span>
                  <span className="engine-words">
                    {l.verdict}
                    {l.win !== undefined ? `, ${l.win}%` : ''}
                  </span>
                </div>
              ))}
            </section>
          )}
          {!onDemo && s.explorer && <ExplorerPane view={s.explorer} fen={node.fen} turn={node.fen.split(' ')[1] === 'b' ? 'black' : 'white'} figurine={figurine} />}
          {/* the standing fair-play banner is gone from here at the owner's request (2026-11-15): it took the pane's
              room; the guard itself still refuses a position of a game in progress, and My games says what it needs */}
        </aside>

        <section className="stage">
          <div className="board-stack">
            {onDemo && !s.peek && <DemoBar demo={st.demo!} anim={anim} />}
            {s.peek && (
              <div className="peek-bar">
                <span>
                  {boardNote} <span className="muted">(a look ahead; no board was changed)</span>
                </span>
                <button className="btn primary small" onClick={() => setPeek(null)}>
                  Back
                </button>
              </div>
            )}
            <MaterialStrip fen={fen} side={st.orientation === 'white' ? 'black' : 'white'} mode={setting(s, 'display.material', 'captured')} />
            <div className={`board-pair${barOn ? ' with-bar' : ''}`}>
              {barOn && <EvalBar gauge={gauge} orientation={st.orientation} numbers={numbersOn} note={s.peek ? 'Not measured for a look ahead' : undefined} />}
              <Board
                fen={fen}
                orientation={st.orientation}
                interactive={interactive}
                lastMove={lastMove}
                coachShapes={shapes}
                bestArrows={arrows}
                badge={badge}
                hoverSquares={s.hover}
                coordinates={setting(s, 'display.coordinates', true)}
                theme={setting(s, 'display.boardTheme', 'brown')}
                resync={s.resync}
                onMove={(from, to, promotion) => {
                  playTick();
                  send({ type: 'move', from, to, promotion });
                }}
                onOwnerShapes={(sh) => send({ type: 'shapes', shapes: sh })}
                ownerShapes={s.peek ? [] : st.shapes.owner}
                betterMove={better}
                bentKnightArrows={setting(s, 'display.knightArrows', 'bent') === 'bent'}
                keepDrawings={setting(s, 'display.keepDrawings', true)}
              />
            </div>
            <MaterialStrip fen={fen} side={st.orientation} mode={setting(s, 'display.material', 'captured')} />
            <div className="caption" aria-live="polite">
              {labelsOn && shown?.judged ? (
                <Verdict san={shown.san} by={shown.by} judged={shown.judged} figurine={figurine} alt={shown.alt} betterShown={!!better} />
              ) : held ? (
                // the engine is being kept quiet here (fair play, or the owner's own review): the reason takes the whole line
                <span className="caption-held muted">{held}</span>
              ) : labelsOn && shown && !s.peek ? (
                <span className="muted">Checking the move…</span>
              ) : onDemo && !s.peek ? (
                <span className="muted">Try a move of your own here: the engine will judge it.</span>
              ) : (
                <span />
              )}
              <span className="caption-right muted">{held ? (labelsOn && shown?.judged ? held : '') : barOn && gauge ? gaugeWords(gauge) : ''}</span>
            </div>
            <div className="under-board">
              <Transport label="Step through the moves" disabled={onDemo} onStep={(to) => send({ type: 'nav', to })} />
              <div className="turn">
                {st.over && !onDemo && !s.peek ? (
                  <strong>Game over: {st.over}</strong>
                ) : (
                  <>
                    <span className={`turn-dot ${turnWhite ? 'white' : 'black'}`} aria-hidden="true" />
                    {turnWhite ? 'White' : 'Black'} to move
                    {!s.peek && <span className="muted">({yourTurn ? 'your side' : 'their side'})</span>}
                  </>
                )}
              </div>
              <button className="btn quiet" onClick={flip} title="Turn the board and play the other side (F)">
                <ArrowUpDown size={15} strokeWidth={1.9} aria-hidden="true" />
                You are {st.orientation}
              </button>
            </div>
          </div>
        </section>

        <CoachPanel />
      </main>
      {overlays}
    </div>
  );
}
