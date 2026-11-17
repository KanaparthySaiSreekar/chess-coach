// The page's state: one WebSocket to the server, one store the components read.

import { useSyncExternalStore } from 'react';
import type { AppMode, BotsView, ClientMsg, CoachMessage, CoachStatus, EngineView, ExplorerView, ContentReviewView, OpeningView, EndgameView, RepGameView, RepStatsView, RepBrowserView, SystemView, GameView, Insight, LibraryView, PresetView, PuzzleView, ReviewView, SafetyView, ThreatView, ConvertView, SpeedView, StudiesView, ServerMsg, SessionState, SettingView } from '@chess-coach/core';

export type Toast = { id: number; level: 'info' | 'error'; text: string };
/** The coach's line being played move by move on the page. */
export type Anim = { demo: number; line: string; ply: number };
/** A look at one move from a coach message, without changing any board. */
export type Peek = { fen: string; from: string; to: string; san: string };

export type Store = {
  connected: boolean;
  mode: AppMode;
  state: SessionState | null;
  thread: CoachMessage[];
  status: CoachStatus | null;
  settings: SettingView[];
  presets: PresetView[];
  engine: EngineView | null;
  /** the opening explorer for the position on the analysis board (WP 8.2) */
  explorer: ExplorerView | null;
  /** the engine's arrows for the owner's board: only shown when its position is the one on the board */
  insight: Insight | null;
  game: GameView | null;
  bots: BotsView | null;
  /** the owner's finished games and accounts (the Games screen) */
  library: LibraryView | null;
  /** the puzzle on the puzzle board (the Puzzles screen) */
  puzzle: PuzzleView | null;
  /** the safety check, when that is what is practised */
  safety: SafetyView | null;
  /** "what's the threat?", when that is what is practised */
  threat: ThreatView | null;
  /** a win-the-won-game drill, when that is what is practised */
  convert: ConvertView | null;
  /** the opening drill (WP 8.8), when that is what is practised */
  opening: OpeningView | null;
  /** the game on the board against the repertoire, and the results per line (WP 8.10) */
  repgame: RepGameView | null;
  repstats: RepStatsView | null;
  /** the Openings tab's repertoires to walk (D9) */
  repbrowser: RepBrowserView | null;
  /** the computer's load for the top bar (I18) */
  system: SystemView | null;
  /** the Endgames tab: the ladder and the position being played (F2) */
  endgame: EndgameView | null;
  /** a speed run (streak or timed), when that is what is practised */
  speed: SpeedView | null;
  /** the owner's studies (WP 8.1) */
  studies: StudiesView | null;
  /** the review screen's content (WP 8.4), asked for when the screen opens */
  content: ContentReviewView | null;
  /** the analysis of one of the owner's games: shown when that game is the one on the board */
  review: ReviewView | null;
  /** a longer job is running on the server */
  busy: string | null;
  toast: Toast | null;
  pgn: string | null;
  anim: Anim | null;
  peek: Peek | null;
  /** squares a hovered token points at */
  hover: string[];
  /** goes up when the board must be redrawn from the server's state (a move was refused) */
  resync: number;
};

let store: Store = {
  connected: false,
  mode: 'analysis',
  state: null,
  thread: [],
  status: null,
  settings: [],
  presets: [],
  engine: null,
  explorer: null,
  insight: null,
  game: null,
  bots: null,
  library: null,
  puzzle: null,
  safety: null,
  threat: null,
  convert: null,
  opening: null,
  repgame: null,
  repstats: null,
  repbrowser: null,
  system: null,
  endgame: null,
  speed: null,
  studies: null,
  content: null,
  review: null,
  busy: null,
  toast: null,
  pgn: null,
  anim: null,
  peek: null,
  hover: [],
  resync: 0,
};
const listeners = new Set<() => void>();

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  for (const l of listeners) l();
}

export function useStore(): Store {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => store,
  );
}

export function setting<T extends boolean | number | string>(s: Store, key: string, fallback: T): T {
  const hit = s.settings.find((x) => x.key === key);
  return hit ? (hit.value as T) : fallback;
}

let ws: WebSocket | null = null;
let retry = 0;
let toastId = 0;
let animTimer: ReturnType<typeof setInterval> | null = null;

export function send(msg: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else toast('error', 'Not connected to the server yet.');
}

export function toast(level: 'info' | 'error', text: string) {
  const id = ++toastId;
  set({ toast: { id, level, text } });
  setTimeout(() => {
    if (store.toast?.id === id) set({ toast: null });
  }, 4500);
}

export function stopAnim() {
  if (animTimer) clearInterval(animTimer);
  animTimer = null;
  if (store.anim) set({ anim: null });
}

export function setPeek(peek: Peek | null) {
  set({ peek });
}

export function setHover(squares: string[]) {
  if (squares.length === 0 && store.hover.length === 0) return;
  set({ hover: squares });
}

export function closePgn() {
  set({ pgn: null });
}

function startAnim(demo: number, line: string, fromPly: number, speedMs: number) {
  stopAnim();
  const total = store.state?.demo?.lines.find((l) => l.id === line)?.moves.length ?? 0;
  if (!total) return;
  set({ anim: { demo, line, ply: fromPly }, peek: null });
  animTimer = setInterval(() => {
    const a = store.anim;
    const d = store.state?.demo;
    const len = d?.lines.find((l) => l.id === line)?.moves.length ?? 0;
    if (!a || !d || d.id !== demo || store.state?.layer !== 'demo') return stopAnim();
    if (a.ply >= len) return stopAnim();
    set({ anim: { ...a, ply: a.ply + 1 } });
    playTick();
  }, speedMs);
}

let audio: AudioContext | null = null;
/** A soft click for each move, when the sound setting is on. */
export function playTick(capture = false) {
  if (!setting(store, 'display.sound', true)) return;
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(capture ? 180 : 240, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.07);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    /* no audio: fine */
  }
}

function onMessage(m: ServerMsg) {
  switch (m.type) {
    case 'state': {
      const before = store.state;
      // a change of position on the owner's board ends any peek
      const moved = !before || before.focus !== m.state.focus || before.layer !== m.state.layer;
      // a move on the coach's board (the owner's own try) ends the playing-out of a line
      const demoMoved = !!before?.demo && !!m.state.demo && (before.demo.id !== m.state.demo.id || before.seq !== m.state.seq);
      set({ state: m.state, ...(moved ? { peek: null } : {}) });
      if (m.state.layer !== 'demo' || demoMoved) stopAnim();
      return;
    }
    case 'thread':
      return set({ thread: m.messages });
    case 'coach_msg':
      return set({ thread: [...store.thread, m.message] });
    case 'coach_status':
      return set({ status: m.status });
    case 'settings':
      return set({ settings: m.settings, presets: m.presets ?? [] });
    case 'engine':
      return set({ engine: m.view });
    case 'explorer':
      return set({ explorer: m.view });
    case 'insight':
      return set({ insight: m.insight });
    case 'app':
      return set({ mode: m.mode, peek: null });
    case 'game': {
      const before = store.game;
      const grew = !!before && Object.keys(m.game.tree.nodes).length > Object.keys(before.tree.nodes).length;
      set({ game: m.game });
      if (grew && m.game.status !== 'idle') playTick(); // the bot's move (the owner's own was already heard)
      return;
    }
    case 'bots':
      return set({ bots: m.view });
    case 'library':
      return set({ library: m.view });
    case 'review':
      return set({ review: m.view });
    case 'safety':
      return set({ safety: m.view });
    case 'threat':
      return set({ threat: m.view });
    case 'convert':
      return set({ convert: m.view });
    case 'opening':
      return set({ opening: m.view });
    case 'repgame':
      return set({ repgame: m.view });
    case 'repstats':
      return set({ repstats: m.view });
    case 'repbrowser':
      return set({ repbrowser: m.view });
    case 'system':
      return set({ system: m.view });
    case 'endgame':
      return set({ endgame: m.view });
    case 'speed':
      return set({ speed: m.view });
    case 'studies':
      return set({ studies: m.view });
    case 'content':
      return set({ content: m.view });
    case 'puzzle': {
      const before = store.puzzle;
      set({ puzzle: m.view });
      // the opponent's move in a puzzle is heard, like a bot's (the owner's own was heard already)
      const last = m.view.moves.at(-1);
      if (before && m.view.id === before.id && m.view.moves.length > before.moves.length && last?.by === 'them') playTick();
      return;
    }
    case 'busy':
      return set({ busy: m.text });
    case 'pgn':
      return set({ pgn: m.text });
    case 'toast':
      // a refused move leaves the piece where it was dropped: put the board back as the server has it
      if (m.level === 'error') set({ resync: store.resync + 1 });
      return toast(m.level, m.text);
    case 'play_demo':
      return startAnim(m.demo, m.line, m.fromPly, m.speedMs);
  }
}

export function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    retry = 0;
    set({ connected: true });
    ws!.send(JSON.stringify({ type: 'hello' } satisfies ClientMsg));
  };
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data as string) as ServerMsg);
    } catch {
      /* ignore a malformed frame */
    }
  };
  ws.onclose = () => {
    set({ connected: false, busy: null });
    stopAnim();
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 300 * 2 ** retry);
  };
  ws.onerror = () => ws?.close();
}
