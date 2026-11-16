// What the page and the server say to each other (ARCHITECTURE §4): JSON over one WebSocket.

import type { Color } from './chess.ts';
import type { GameClock, TimeControl } from './clock.ts';
import type { ContentStatus, ContentType, GateId, PuzzleKind } from './content.ts';
import type { PuzzleMove, Rung } from './puzzle.ts';
import type { ExplorerSource, ExplorerTable } from './explorer.ts';
import type { LineResult } from './repgames.ts';
import type { BrowserPosition } from './repbrowser.ts';
import type { EndgameGoal, RandomStart } from './endgame.ts';
import type { GameSummary } from './games.ts';
import type { Gauge, Judged } from './labels.ts';
import type { SkippedStep } from './facts.ts';
import type { SkillProfile } from './profile.ts';
import type { JournalEntry, ReviewReport } from './report.ts';
import type { GameNumbers, Moment } from './review.ts';
import type { DrawingColor, MoveTree, NodeId } from './tree.ts';
import type { SayKind, Segment } from './validator.ts';

export type Mode = 'analysis' | 'review' | 'drill' | 'opening' | 'spar' | 'lesson' | 'course' | 'session';

/** An arrow (from → to) or a highlighted square (no `to`). */
export type ShapeStyle = 'owner' | 'move' | 'threat' | 'idea' | 'danger' | 'target' | 'good';
/** `color` is set on the owner's own drawings: one of Lichess's four, so they survive a PGN export. */
export type Shape = { from: string; to?: string; style: ShapeStyle; color?: DrawingColor };

export type DemoMove = {
  san: string;
  from: string;
  to: string;
  fen: string;
  by: Color;
  mark: '' | '?' | '??';
  /** the eval bar's reading after this move, and the move's label: filled in by the engine after the line is shown */
  gauge?: Gauge;
  judged?: Judged;
  /** the owner played this move on the coach's board, off the line the coach was showing (feature A18) */
  alt?: boolean;
};
/** One line the coach is showing. A subline hangs off another line after `parent.ply` of its moves. */
export type DemoLine = {
  id: string;
  label: string;
  baseFen: string;
  moves: DemoMove[];
  parent?: { line: string; ply: number };
  /** the engine's verdict on this line in plain words: written by code, not by the coach */
  verdict?: string;
  /** which analysis the verdict rests on (Lichess's cloud analysis, or Stockfish on this computer) */
  checkedBy?: string;
  /** how the line came about: the engine's best play, one named move, the threat, or the owner's own try */
  kind?: 'best' | 'move' | 'threat' | 'alt';
  /** the eval bar's reading at the line's first position */
  baseGauge?: Gauge;
};
/**
 * The coach's own layer (feature A3): a position and the lines it has played from it.
 * `cursor.line === null` shows the base position; otherwise the position after `ply` moves of that line.
 */
export type Demo = { id: number; label: string; baseFen: string; lines: DemoLine[]; cursor: { line: string | null; ply: number }; baseGauge?: Gauge };

export type SessionState = {
  mode: Mode;
  tree: MoveTree;
  focus: NodeId;
  layer: 'owner' | 'demo';
  demo?: Demo;
  shapes: { owner: Shape[]; coach: Shape[] };
  /** the side the owner plays / sits on: "your pieces" in everything the coach says */
  orientation: Color;
  seq: number;
  opening?: { eco: string; name: string };
  over?: string;
  /** shown while the owner's games in progress cannot be checked (the fair-play guard, H10) */
  notice?: string;
  /** the game from the library that is on the board, for the board's heading */
  game?: { id: number; white: string; black: string; result: string; you?: Color };
};

export type CoachMessage = {
  id: number;
  at: string;
  seq: number;
  from: 'coach' | 'owner' | 'system';
  /** who wrote a coach message: the model, or the scripted fallback speaking from the same facts */
  source?: 'coach' | 'scripted';
  kind?: SayKind;
  text: string;
  segments: Segment[];
  expect?: 'none' | 'move' | 'choice' | 'text';
  choices?: string[];
  /** what the message's chess statements were checked against */
  checked?: string;
  /** a message about a puzzle (the drill coach, WP 6.11): the puzzle's id. It is shown with the puzzle, not in the analysis thread */
  drill?: number;
  /** a message about a game against a bot (the sparring coach, WP 7.7): the game's number. Shown beside the game */
  spar?: number;
  /** a message about the repertoire the owner walks on the Openings tab (D12): shown beside that board */
  walk?: boolean;
};

export type CoachState = 'off' | 'starting' | 'ready' | 'thinking' | 'retrying' | 'error';
export type CoachStatus = {
  state: CoachState;
  model?: string;
  detail?: string;
  usage: { turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number };
  /** how many of the coach's messages passed the validator the first time */
  firstTry: { ok: number; total: number };
};

export type SettingValue = boolean | number | string;
export type SettingView = {
  key: string;
  group: string;
  label: string;
  type: 'boolean' | 'number' | 'choice' | 'text';
  value: SettingValue;
  default: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** what each option is called on the page */
  optionLabels?: Record<string, string>;
  /** a technical knob: the page keeps it out of the way unless asked */
  advanced?: boolean;
  why: string;
  source: string;
};

/** A named bundle of setting values, applied with one click (feature K2). */
export type PresetView = { id: string; name: string; about: string; values: Record<string, SettingValue> };

/** One of the engine's first choices, drawn on the board as an arrow (feature A16). */
export type BestArrow = { from: string; to: string; san: string };
/** What the engine adds to the owner's board for one position. */
export type Insight = {
  fen: string;
  arrows: BestArrow[];
  /** why the arrows are being held back, when they are */
  held?: string;
};

// ---------------------------------------------------------------- modes and games against bots

export type AppMode = 'analysis' | 'play' | 'games' | 'puzzles' | 'openings' | 'endgames';

/** One of the human-like opponents (feature F9). Ratings are on Maia's own scale (Lichess). */
/** The owner's studies (I6, WP 8.1): each with its chapters; which chapter is on the board, if one is. */
export type StudiesView = {
  studies: { id: number; name: string; source: string; chapters: { id: number; name: string; orientation: Color }[] }[];
  open?: { study: number; chapter: number };
};

export type BotView = { id: string; name: string; elo: number; about: string; band: string; /** an engine-style bot (WP 7.8): Stockfish held back, not a model of people */ kind?: 'engine' };
export type BotsView = {
  bots: BotView[];
  state: 'idle' | 'starting' | 'ready' | 'error';
  problem?: string;
  /** the bot the app suggests next, from recent results */
  suggested: string;
  /** finished games against bots, newest first */
  record: { bot: string; name: string; elo: number; outcome: 'win' | 'loss' | 'draw'; at: string }[];
  /** the mini-games with few pieces (F6), each with its idea and its goal in words */
  minis: { id: string; name: string; idea: string; about: string; you: Color; goal: string; fen: string }[];
};
export type GameResult = { winner?: Color; reason: 'checkmate' | 'stalemate' | 'material' | 'repetition' | 'fifty' | 'resigned' | 'time' | 'agreed' | 'goal'; text: string };
/** A game against a bot (features A5, F4). It has its own board: the analysis board is left alone. */
export type GameView = {
  status: 'idle' | 'playing' | 'over';
  bot?: BotView;
  /** the side the owner plays */
  you: Color;
  tree: MoveTree;
  focus: NodeId;
  /** the bot is choosing its move */
  thinking: boolean;
  result?: GameResult;
  takebacks: number;
  /** the bot could not produce a move (Maia is not answering); the owner can try again */
  problem?: string;
  /** the time control, when the game has a clock (I10), and the clocks themselves (kept by the server) */
  time?: TimeControl;
  clock?: GameClock;
  /** once over: the game's id in the owner's library, where it is reviewed like any other */
  libraryId?: number;
  /**
   * After a serious mistake (A8, `play.undoOffer`): the offer to take it back, what the move did,
   * and the question about the step that was skipped. Shown once the bot has replied.
   */
  offer?: { ply: number; what: string; question: string };
  /** the routine, voiced before the owner's move (A9): more often at first, fading as the habit shows in their games */
  prompt?: string;
  /** a mini-game (F6): its name and its goal in words; the goal is checked after every move */
  mini?: { id: string; name: string; goal: string };
  /** this game's number (when it started): the sparring coach's messages carry it */
  gameNo?: number;
  /** how often the owner asked the coach for help in this game (counted like hints) */
  helps?: number;
};

export type PracticeSet = { kind: 'due' } | { kind: 'games' } | { kind: 'theme'; theme: string } | { kind: 'mixed' } | { kind: 'safety' } | { kind: 'threat' } | { kind: 'convert' } | { kind: 'openings' } | { kind: 'woodpecker' } | { kind: 'streak' } | { kind: 'timed' };

/**
 * A speed run (feature I4): database puzzles that get harder as the run goes on. Streak ends at the
 * first wrong move; timed ends when the time is up (a wrong move costs time). Silent: no hints and
 * nothing explained until it is over, and the coach stays out of it.
 */
export type SpeedView = {
  status: 'idle' | 'running' | 'over';
  mode?: 'streak' | 'timed';
  fen: string;
  lastMove?: [string, string];
  you: Color;
  yourTurn: boolean;
  /** goes up with every move refused, so the board puts the piece back */
  tries: number;
  solved: number;
  misses: number;
  /** a timed run: when it ends */
  endsAt?: string;
  /** the last puzzle: solved, or missed */
  last?: 'solved' | 'missed';
  /** the best run of each mode so far */
  best: { streak: number; timed: number };
  /** once over: each puzzle of the run, its rating, and whether it was solved; its first move when it was not */
  log?: { rating: number; solved: boolean; answer?: string }[];
  /** always: nothing is explained and the coach is not woken during a run */
  silent: true;
  /** `puzzles.speedModes`: off by default */
  enabled: boolean;
  problem?: string;
};

/**
 * A win-the-won-game drill (feature C9): a clearly won position from one of the owner's games,
 * played out against the engine. While it is played nothing from the engine is shown; the drill
 * ends at checkmate, at a draw, at the move limit, or at the move that gives the win away.
 */
/**
 * One of the owner's games against their repertoire (B6, D5; WP 8.10): where it left, who left it,
 * and what to play there next time (the repertoire's move, or the engine's after a new move of theirs).
 */
export type RepGameView = {
  gameId: number;
  by: 'you' | 'them' | 'end' | 'outside' | 'stayed';
  /** "3.Bb5": the move that left (or the first one past the preparation) */
  moveText: string;
  /** its index in the game's moves: the position before it is the one to look at */
  ply: number;
  played?: string;
  /** the owner left: the repertoire's move there, and its why when it has one */
  expected?: string;
  why?: string;
  /** the opponent left: the replies the repertoire prepares, and the engine's move after theirs (none while the engine is kept quiet) */
  prepared?: string[];
  engineMove?: string;
  inBook: number;
  /** the repertoire line the game followed */
  line?: string;
  /** the repertoire it was matched with, when the side has several (WP 8.15) */
  repertoire?: string;
};

/**
 * The Openings tab's repertoires to walk (D9): each with its counts and its positions by key; a reply
 * carries how often players at the owner's level play it (from the explorer's kept answers), and a
 * position of theirs with a gap says what is not prepared.
 */
export type RepBrowserView = {
  repertoires: {
    id: number;
    name: string;
    colour: Color;
    startFen: string;
    lines: number;
    live: number;
    waiting: number;
    quarantined: number;
    positions: Record<string, BrowserPosition & { shares?: Record<string, number>; gap?: { covered: number; missing: { san: string; share: number }[] }; book?: Record<string, number> }>;
    /** its chapters in teaching order (D11): the moves to where each starts, and how its lines stand */
    chapters?: { name: string; moves: string[]; lines: number; live: number; waiting: number }[];
    /** built from the book: the rule every move passed (D10) */
    book?: { minGames: number };
  }[];
};

/**
 * The Endgames tab (F2, built early 2026-11-15): the ladder of positions, and the one being played
 * against the engine, judged by the tablebases after every move.
 */
export type EndgameView = {
  status: 'idle' | 'playing' | 'over';
  id?: number;
  /** `random`: a new start made for this go (PLAN 9.3), not a position of the ladder; `hasIdea`: there is an idea to show on request */
  position?: { key: string; name: string; topicName: string; goal: EndgameGoal; task: string; idea?: string; hasIdea: boolean; random?: RandomStart };
  fen: string;
  you: Color;
  yourTurn: boolean;
  busy?: boolean;
  lastMove?: [string, string];
  moves: { san: string; by: Color }[];
  /** a draw to hold: moves still to hold; a win: moves before it stops */
  movesLeft: number;
  tries: number;
  result?: { outcome: 'done' | 'thrown' | 'drawn' | 'lost' | 'kept' | 'gave_up'; text: string; better?: string };
  /** `random`: the topic can also start from a new position each time */
  ladder: { id: string; name: string; about: string; random?: RandomStart; positions: { id: number; key: string; name: string; goal: EndgameGoal; solved: boolean; due: boolean }[] }[];
  /** the coach was asked for help during this go (it counts as a hint) */
  asked?: number;
  ready: number;
  due: number;
  problem?: string;
};

/** The owner's results per repertoire line (G3, D7; WP 8.10). */
export type RepStatsView = { lines: LineResult[]; games: number; leftByYou: number; leftByThem: number; prepRanOut: number };

/**
 * The opening drill (D3, D4; WP 8.8): one card per position of the owner's live repertoires. A new card
 * is shown first (the move, its why, the opponent's idea); a card due again is asked: the owner plays
 * the move. Now and then a right answer is followed by "why this move?".
 */
export type OpeningView = {
  status: 'idle' | 'learn' | 'ask' | 'right' | 'wrong' | 'why';
  id?: number;
  /** the card's position, the owner to move */
  fen: string;
  you: Color;
  /** how the position was reached (SAN from `startFen`) */
  line: string[];
  startFen: string;
  /** the repertoire's name */
  repertoire?: string;
  /** the move, once it is shown (learning, after an answer) */
  move?: { san: string; from: string; to: string };
  /** its why and the opponent's idea, as written and checked (V3); plain words */
  why?: string;
  idea?: string;
  /** what the opponent replies after it, as the repertoire prepares, with how often players at the owner's level play it when that is known */
  replies?: { san: string; share?: number }[];
  /** the opponent's last move was a mistake to punish */
  punish?: boolean;
  /** a card of the trap pack: its name (said once the card is answered, so it does not give the move away), avoid or spring */
  trap?: { name?: string; kind: 'avoid' | 'punish' };
  /** the owner's own move, when it was not the card's */
  played?: string;
  /** the position after the move, once it is shown */
  after?: string;
  /** the owner's own words for the why, while the why check is open */
  words?: string;
  ready: number;
  due: number;
  left: number;
  /** goes up with every move refused, so the board puts the piece back */
  tries: number;
  problem?: string;
  /** the card's chapter (D11), and how many of the masters' games played its move (the line's grounding) */
  chapter?: string;
  book?: number;
  /** what the sitting draws from: one repertoire and some of its chapters, or everything (repertoire null) */
  scope?: { repertoire: number | null; chapters?: string[] };
  /** the repertoires there are cards for, chapter by chapter, with how many are new and due */
  scopes?: { id: number; name: string; colour: Color; chapters: { name: string; cards: number; fresh: number; due: number }[] }[];
  /** new cards taken in today, and the day's limit (D11) */
  newToday?: number;
  newPerDay?: number;
};

export type ConvertView = {
  status: 'idle' | 'playing' | 'over';
  id?: number;
  fen: string;
  lastMove?: [string, string];
  you: Color;
  yourTurn: boolean;
  /** the engine is thinking */
  busy?: boolean;
  /** the moves of the drill so far */
  moves: { san: string; by: Color }[];
  /** the owner's moves left before the drill stops (`conversion.maxMoves`) */
  movesLeft: number;
  /** goes up with every move refused, so the board puts the piece back */
  tries: number;
  /** what happened in the game from this position: the move played, whether it threw the win, the result */
  game?: { outcome: 'draw' | 'loss'; played?: string; threw?: string };
  /** once over: how, in words; for a thrown win, the move and why (the engine's verdict) */
  result?: { outcome: 'converted' | 'kept' | 'thrown' | 'drawn' | 'gave_up'; text: string; throwMove?: { san: string; why: string } };
  /** a second go at the same drill: logged, but the schedule is not moved again */
  again: boolean;
  comesBack?: string;
  /** live drills, how many are due again today, and how many can be played now */
  ready: number;
  due: number;
  left: number;
  problem?: string;
};

/**
 * "What's the threat?" (feature C8): first the owner names the opponent's threat by making it on a
 * board where it is the opponent's turn, then finds a move that deals with it on the real position.
 */
export type ThreatView = {
  /** naming the threat, then defending against it; over when solved or shown */
  status: 'idle' | 'naming' | 'defending' | 'solved' | 'shown';
  id?: number;
  /** the board: the position with the turn passed while the threat is named, then the real one */
  fen: string;
  /** their move that led to the position */
  lastMove?: [string, string];
  you: Color;
  /** their threat, once named or shown: the move and what it would win */
  threat?: { san: string; from: string; to: string; what: string; named: boolean };
  hints: number;
  misses: number;
  /** what the next hint gives while the threat is named: 1 a question, 2 the piece, 3 the threat itself */
  nextHint?: 1 | 2 | 3;
  shapes: Shape[];
  /** the last thing said: a hint, why a move was not it, or that it was */
  feedback?: { tone: 'hint' | 'wrong' | 'good' | 'answer'; san?: string; by?: Color; text: string };
  /** a move is with the engine */
  busy?: boolean;
  /** goes up with every move tried, so the board puts a refused piece back */
  tries: number;
  /** once over: the move found (if one was), the engine's first choice, and the move played in the game */
  result?: { found?: { san: string; why: string }; best: { san: string; why: string }; played: { san: string; why: string } };
  comesBack?: string;
  /** live threat items, how many are due again today, and how many can be asked now */
  ready: number;
  due: number;
  left: number;
  problem?: string;
};

/** A safety check (feature C7): one move to judge, or two to tell apart. While it is asked, nothing says which is safe. */
export type SafetyView = {
  status: 'idle' | 'asking' | 'answered';
  id?: number;
  fen: string;
  you: Color;
  question: 'is_safe' | 'which_loses';
  /** the moves asked about, with their squares for the arrows */
  candidates: { san: string; from: string; to: string }[];
  /**
   * The listing step, when it is on (safety.listFirst) and one move is judged: the position after
   * the move, with the opponent to move. The owner makes each of their checks and captures, then
   * says that is all; only then are the ones missed shown, and the question asked.
   */
  list?: {
    stage: 'listing' | 'listed';
    fen: string;
    lastMove: [string, string];
    found: { san: string; from: string; to: string }[];
    /** once listed: the checks and captures the owner did not make */
    missed?: { san: string; from: string; to: string }[];
    /** what the last move tried was: a check or capture found, one found already, or neither */
    note?: { san?: string; text: string; good: boolean };
    /** goes up with every move tried, so the board puts the piece back */
    tries: number;
  };
  /** once answered: right or not, each move's verdict and reason, and the move played in the game */
  result?: { right: boolean; candidates: { san: string; safe: boolean; why: string }[]; played?: string };
  comesBack?: string;
  /** live safety checks, how many are due again today, and how many can be asked now (due, or never asked) */
  ready: number;
  due: number;
  left: number;
  problem?: string;
};

/** The puzzle being solved (PLAN WP 6.2). It has a board of its own: the analysis board is left alone. */
export type PuzzleView = {
  status: 'idle' | 'solving' | 'solved' | 'shown';
  id?: number;
  kind?: PuzzleKind;
  /** where the puzzle came from, in words */
  from?: string;
  fen: string;
  lastMove?: [string, string];
  /** the side the owner solves for */
  you: Color;
  yourTurn: boolean;
  /** the moves played so far, the opponent's set-up move included */
  moves: PuzzleMove[];
  hints: number;
  misses: number;
  /** what the next hint would be: after the arrow comes the answer */
  nextHint?: Rung;
  /** the arrow rung of the hint ladder */
  shapes: Shape[];
  /** what is asked */
  task: string;
  /** the last thing said about the attempt: a hint, what a wrong move runs into, why the solution works */
  feedback?: { tone: 'hint' | 'wrong' | 'good' | 'answer'; text: string };
  /** the themes, once the puzzle is over (before that they would give the idea away) */
  themes?: string[];
  /**
   * The guidance the puzzle's motif gets at the owner's stage (G7, `puzzles.fadeGuidance`): a new idea
   * is named and its worked example offered; one still being learnt is named; a known one is not.
   */
  guide?: { motif: string; name: string; stage: 'example' | 'partial' | 'full' | 'mixed'; text: string; offerExample: boolean };
  /** the optional modes switched on in the settings (C6, I4): their sets are offered only then */
  modes?: { woodpecker: boolean; speed: boolean };
  /** a Woodpecker set (C6): its size, the round under way (or the last one), and every round so far */
  woodpecker?: { size: number; round: number; done: number; over: boolean; rounds: { round: number; ms?: number; solved: number; alone: number; done: number }[] };
  /** the owner's motifs, the most practised first: the stage, and how many of the latest were solved alone */
  motifs?: { motif: string; name: string; stage: 'example' | 'partial' | 'full' | 'mixed'; alone: number; recent: number }[];
  /** puzzles from the owner's games: how many are live, and how many of them have not been tried */
  ready: number;
  fresh: number;
  /** puzzles due again today (the schedule, C4), already under the day's cap */
  due: number;
  /** when the attempt on the board is over: when this puzzle comes back */
  comesBack?: string;
  /** what is being practised: puzzles from the owner's games, one theme from the database, or a mix with the themes hidden (C5) */
  set: PracticeSet;
  /** the owner's puzzle level for the database's sets: it follows their results */
  level: number;
  /** the themes that can be practised at that level, the most puzzles first; null when the database is not installed */
  catalogue: { theme: string; name: string; count: number }[] | null;
  /** why no puzzle is on the board */
  problem?: string;
};

/** One of the owner's accounts on a chess site, as the Games screen shows it (features B1, G1). */
export type AccountView = {
  site: 'lichess' | 'chesscom';
  /** the owner's name there; empty until they enter it */
  user: string;
  state: 'none' | 'ok' | 'syncing' | 'error';
  problem?: string;
  lastSync?: string;
  games: number;
  /** games still being played there, and when that list was last read (the fair-play guard) */
  ongoing: number;
  ongoingAt?: string;
  ongoingProblem?: string;
  /** the owner's rating after their newest rated game of each speed */
  ratings: Record<string, number>;
};
/** The owner's finished games (feature B1), newest first. */
export type LibraryView = {
  accounts: AccountView[];
  games: GameSummary[];
  total: number;
  record: { win: number; loss: number; draw: number };
  syncing: boolean;
  /** the takeaway journal (feature G6): the habits the reviews keep coming back to, the most frequent first */
  journal: JournalEntry[];
  /** the skill profile (features G2, G5): the process measures over the analysed games */
  profile: SkillProfile;
};

/** The analysis of the game on the board (features B3, B9): its key moments, once the engine has been through it. */
export type ReviewView = {
  gameId: number;
  status: 'running' | 'done' | 'skipped';
  /** while running: positions searched so far */
  progress?: { done: number; total: number };
  /** why it did not run (on battery, with "wait for mains power" chosen) */
  note?: string;
  /**
   * The owner's own review (feature B7): while it is `pending` the engine's findings are held back
   * (no moments here, nothing from the engine on the board). `marks` are the moves the owner picked
   * as turning points, as half-move numbers; `notes` is what they wrote.
   */
  own?: { state: 'pending' | 'done' | 'skipped'; marks: number[]; notes: string };
  moments: Moment[];
  /**
   * Going through the moments with the coach (feature B4): which one, and where it stands. `asking`:
   * the owner is looking for a better move on the board; `explained`: it was found, told or shown;
   * `finished`: that was the last one. `mode` says whether this moment is asked or shown as a worked example.
   */
  replay?: { index: number; total: number; phase: 'asking' | 'explained' | 'finished'; mode: 'ask' | 'worked' };
  numbers?: GameNumbers;
  /** the puzzles made from this game (feature C1): being made, made (the ids of the live ones), or waiting for mains power */
  puzzles?: { state: 'making' | 'done' | 'waiting'; ids: number[] };
  /** the written report (feature B10): what went well, the takeaways, how the last game's takeaways fared; and the owner's note for next time */
  report?: ReviewReport;
  ownerNote?: string;
  /** White's winning chances after each move, 0 to 100 (null where the engine was not asked) */
  chart?: (number | null)[];
};

/** One item on the review screen (J4, WP 8.4). */
export type ContentRowView = {
  id: number;
  type: ContentType;
  status: ContentStatus;
  /** what the item is, in words: a repertoire line ("1.e4 a6 2.Bxa6 bxa6 3.d4"), or where a puzzle came from */
  title: string;
  source: string;
  /** why it is quarantined, one line per gate, in plain words */
  reasons: string[];
  /** what a gate flagged without failing it (a gap at the owner's level) */
  flags: string[];
  /** the gates that failed or flagged (the screen's filter) */
  gates: GateId[];
  note?: string;
  repertoire?: number;
  /** a repertoire line's chapter (D11) */
  chapter?: string;
  /** a line built from the book: how many of the masters' games played each move (its grounding) */
  book?: number[];
  /** a repertoire line that can be shown on the board at its failing move and fixed from there */
  fixable: boolean;
};

/** A repertoire's gate report, for its batch on the review screen (CONTENT §10). */
export type RepertoireSummaryView = {
  id: number;
  name: string;
  colour: Color;
  at?: string;
  lines: number;
  live: number;
  waiting: number;
  quarantined: number;
  flagged: number;
  gaps: { at: string; covered: number; missing: { san: string; share: number }[]; source: 'explorer' | 'maia' | 'book' }[];
  sample: { id: number; line: string }[];
  /** the gates are running: which one, how far */
  running?: { step: string; done: number; total: number };
  /** a repertoire built from the book (WP 8.12): its outline, the book rule, and what the build noted */
  built?: { outline: string; at: string; minGames: number; depth: number; budget: number; cut: number | null; notes: string[] };
  /** its chapters in teaching order, with how their lines stand (D11) */
  chapters?: { name: string; lines: number; live: number; waiting: number; quarantined: number; flagged: number }[];
};

/** An outline in content/repertoires/ (WP 8.12): a repertoire the owner can have built from the book. */
export type OutlineView = { id: string; name: string; colour: Color; chapters: number; problems: string[]; repertoire?: number; built?: string };

export type ContentReviewView = {
  counts: { quarantined: number; waiting: number; live: number };
  items: ContentRowView[];
  repertoires: RepertoireSummaryView[];
  outlines?: OutlineView[];
};

export type EngineView = { lines: { san: string; line: string[]; verdict: string; outcome: string; win?: number }[] };

/**
 * The opening explorer for the position on the analysis board (I3, WP 8.2). Counts of games, never a
 * verdict. `fen` is the position the table is for: the page shows it only while that is the one on the board.
 */
export type ExplorerView = {
  source: ExplorerSource;
  fen: string;
  /** what was asked, in words: "Lichess games, players rated under 1200, rapid, classical and daily" */
  about: string;
  state: 'ready' | 'loading' | 'none' | 'off';
  table?: ExplorerTable;
  /** why there is no table, or why Maia's guess stands in for counted games */
  note?: string;
  /** for "my games": the colour the owner played in the games counted, and whether it is their move here */
  you?: Color;
  yourMove?: boolean;
};

export type Chip = 'hint' | 'tell_me' | 'why' | 'show_me';

export type ClientMsg =
  | { type: 'hello' }
  | { type: 'move'; from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' }
  | { type: 'nav'; to: NodeId | 'start' | 'end' | 'prev' | 'next' }
  | { type: 'shapes'; shapes: Shape[] }
  | { type: 'ask'; text: string }
  | { type: 'chip'; chip: Chip }
  | { type: 'coach'; action: 'start' | 'stop' }
  | { type: 'setting'; key: string; value: unknown }
  | { type: 'load'; text: string }
  /** a position set up by hand in the board editor (feature I2) */
  | { type: 'setup'; fen: string }
  | { type: 'new' }
  /** start = the normal starting position; root = the first position of what is loaded, with every move cleared */
  | { type: 'reset'; to: 'start' | 'root' }
  | { type: 'label_all' }
  | { type: 'preset'; id: string }
  | { type: 'settings_reset'; group?: string }
  | { type: 'mode'; mode: AppMode }
  | { type: 'game'; action: 'start'; bot: string; color: 'white' | 'black' | 'random'; time?: TimeControl | null }
  /** a mini-game (F6), against the bot given or the one suggested */
  | { type: 'game'; action: 'mini'; id: string; bot?: string }
  | { type: 'game'; action: 'move'; from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' }
  | { type: 'game'; action: 'nav'; to: NodeId | 'start' | 'end' | 'prev' | 'next' }
  | { type: 'game'; action: 'resign' | 'takeback' | 'new' | 'analyse' | 'retry' | 'draw' | 'take_offer' | 'play_on' | 'ask_coach' }
  /** the owner's games: fetch new ones, put one on the board, add one from a PGN or a link, take one out */
  | { type: 'library'; action: 'sync' }
  | { type: 'library'; action: 'open'; id: number }
  | { type: 'library'; action: 'import'; text: string }
  | { type: 'library'; action: 'remove'; id: number }
  /** analyse the game that is on the board again (it is analysed by itself when opened, if the setting says so) */
  | { type: 'library'; action: 'analyse' }
  /** the owner's own review of the game on the board: mark or unmark a move, then finish with their notes, or skip */
  | { type: 'own_review'; action: 'mark'; ply: number }
  | { type: 'own_review'; action: 'finish'; notes: string }
  | { type: 'own_review'; action: 'skip' }
  /** the report of the game on the board: the owner says which step a slip really skipped, or leaves a note for next time (feature H8) */
  | { type: 'review_tag'; ply: number; step: SkippedStep }
  | { type: 'review_note'; text: string }
  /** go through the key moments of the game on the board with the coach: start, go on to the next moment, or stop */
  | { type: 'replay'; action: 'start' | 'next' | 'stop' }
  /** the puzzle player: start (the next one, or one by its id), play a move, ask for a hint or the answer, try again, go on */
  | { type: 'puzzle'; action: 'start'; id?: number }
  | { type: 'puzzle'; action: 'move'; from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' }
  | { type: 'puzzle'; action: 'hint' | 'show' | 'retry' | 'next' | 'close' | 'example' | 'woodpecker_round' | 'woodpecker_new' | 'ask_coach' }
  /** a speed run: start one, a move, stop, or close */
  | { type: 'speed'; action: 'start'; mode: 'streak' | 'timed' }
  | { type: 'speed'; action: 'move'; from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' }
  | { type: 'speed'; action: 'stop' | 'close' }
  /** choose what to practise: the owner's games, one theme, or a mix (then the next puzzle comes) */
  | { type: 'puzzle'; action: 'set'; set: PracticeSet }
  /** the safety check: the next one, an answer (safe or not, or the move that is not safe), or close */
  | { type: 'safety'; action: 'next' | 'close' | 'listed' }
  | { type: 'safety'; action: 'try'; from: string; to: string }
  /** "what's the threat?": the next one, a hint, the answer, close; or a move on the board (naming their threat, then the owner's own) */
  | { type: 'threat'; action: 'next' | 'close' | 'hint' | 'show' }
  | { type: 'threat'; action: 'try'; from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' }
  /** a win-the-won-game drill: the next one, close, give up, or try again (from the start, or from before the move that threw the win); or a move */
  /** the opening drill (WP 8.8): the next card, a move on its board, the why check (the owner's words, then whether they had it) */
  /** the Endgames tab (F2): the next position on the ladder, one chosen, a move, again (from the start or from before the slip), the idea, stop */
  | { type: 'endgame'; action: 'next' | 'retry' | 'retry_before' | 'close' | 'resign' | 'idea' | 'ask' }
  | { type: 'endgame'; action: 'random'; kind: RandomStart }
  | { type: 'endgame'; action: 'start'; id: number }
  | { type: 'endgame'; action: 'move'; from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' }
  | { type: 'opening'; action: 'next' | 'close' }
  | { type: 'opening'; action: 'move'; from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' }
  | { type: 'opening'; action: 'why'; text: string }
  | { type: 'opening'; action: 'why_known'; known: boolean }
  /** what the drill draws from (D11): one repertoire and some of its chapters, or everything (null) */
  | { type: 'opening'; action: 'scope'; repertoire: number | null; chapters?: string[] }
  /** the position the owner walks to on the Openings tab (D12): the repertoire and the moves from its start (UCI); null when they leave it */
  | { type: 'opening'; action: 'walk'; repertoire: number | null; moves?: string[] }
  | { type: 'convert'; action: 'next' | 'close' | 'resign' | 'retry_start' | 'retry_before' }
  | { type: 'convert'; action: 'move'; from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' }
  | { type: 'safety'; action: 'answer'; safe?: boolean; pick?: string }
  | { type: 'flip' }
  | { type: 'delete'; node: NodeId }
  | { type: 'promote'; node: NodeId }
  | { type: 'demo'; action: 'goto'; line: string | null; ply: number }
  | { type: 'demo'; action: 'close' }
  | { type: 'demo'; action: 'adopt'; line: string }
  | { type: 'export' }
  /** studies (WP 8.1): import a PGN or a Lichess study link; open a chapter on the board; save the board to it; add the board as a chapter (to a study, or a new one); remove; export */
  | { type: 'study'; action: 'import'; text: string }
  | { type: 'study'; action: 'open'; chapter: number }
  | { type: 'study'; action: 'save' }
  | { type: 'study'; action: 'add'; study?: number; name: string }
  | { type: 'study'; action: 'remove' | 'export'; study: number }
  /** the review screen (J4, WP 8.4): approve, drop, accept with a note, show a line on the board at its failing move, fix it with the board's moves; approve a repertoire's waiting lines at once */
  | { type: 'content'; action: 'open' }
  | { type: 'content'; action: 'approve' | 'drop' | 'show' | 'fix'; id: number }
  | { type: 'content'; action: 'accept'; id: number; note: string }
  | { type: 'content'; action: 'approve_all'; repertoire: number }
  /** build a starter repertoire for one side around the seed lines in the settings (D1, WP 8.5) */
  | { type: 'content'; action: 'build'; colour: Color }
  /** build (or build again) the repertoire of an outline from the book (D10, WP 8.12); stop a build that is running */
  | { type: 'content'; action: 'build_outline'; outline: string }
  | { type: 'content'; action: 'stop_build' }
  /** approve every waiting line of one chapter (D11, WP 8.13); remove a repertoire for good (WP 8.15) */
  | { type: 'content'; action: 'approve_chapter'; repertoire: number; chapter: string }
  | { type: 'content'; action: 'remove_repertoire'; repertoire: number }
  /** import a repertoire for one side (D2, WP 8.7): a PGN (pasted, or read from a file), a Lichess study link, or one of the owner's studies */
  | { type: 'content'; action: 'import'; colour: Color; name: string; text?: string; study?: number }
  | { type: 'clear_thread' };

export type ServerMsg =
  | { type: 'state'; state: SessionState }
  | { type: 'thread'; messages: CoachMessage[] }
  | { type: 'coach_msg'; message: CoachMessage }
  | { type: 'coach_status'; status: CoachStatus }
  | { type: 'settings'; settings: SettingView[]; presets: PresetView[] }
  | { type: 'insight'; insight: Insight | null }
  | { type: 'app'; mode: AppMode }
  | { type: 'game'; game: GameView }
  | { type: 'bots'; view: BotsView }
  | { type: 'library'; view: LibraryView }
  | { type: 'puzzle'; view: PuzzleView }
  | { type: 'safety'; view: SafetyView }
  | { type: 'threat'; view: ThreatView }
  | { type: 'convert'; view: ConvertView }
  | { type: 'opening'; view: OpeningView }
  | { type: 'repgame'; view: RepGameView | null }
  | { type: 'repstats'; view: RepStatsView | null }
  | { type: 'repbrowser'; view: RepBrowserView }
  | { type: 'endgame'; view: EndgameView }
  | { type: 'speed'; view: SpeedView }
  | { type: 'review'; view: ReviewView | null }
  /** a longer job is running (labelling a whole game); null text = done */
  | { type: 'busy'; text: string | null }
  | { type: 'play_demo'; demo: number; line: string; fromPly: number; speedMs: number }
  | { type: 'engine'; view: EngineView | null }
  | { type: 'explorer'; view: ExplorerView | null }
  | { type: 'pgn'; text: string }
  | { type: 'studies'; view: StudiesView }
  | { type: 'content'; view: ContentReviewView }
  | { type: 'toast'; level: 'info' | 'error'; text: string };

/** The position currently on the coach's layer. */
export function demoFen(demo: Demo): string {
  if (!demo.cursor.line) return demo.baseFen;
  const line = demo.lines.find((l) => l.id === demo.cursor.line);
  if (!line) return demo.baseFen;
  if (demo.cursor.ply <= 0) return line.baseFen;
  return line.moves[Math.min(demo.cursor.ply, line.moves.length) - 1]!.fen;
}

/** The move that led to the position on the coach's layer, if any. */
export function demoLastMove(demo: Demo): DemoMove | undefined {
  if (!demo.cursor.line || demo.cursor.ply <= 0) return undefined;
  const line = demo.lines.find((l) => l.id === demo.cursor.line);
  return line?.moves[Math.min(demo.cursor.ply, line.moves.length) - 1];
}

/** The eval bar's reading for the position on the coach's layer, once the engine has filled it in. */
export function demoGauge(demo: Demo): Gauge | undefined {
  const last = demoLastMove(demo);
  if (last) return last.gauge;
  const line = demo.cursor.line ? demo.lines.find((l) => l.id === demo.cursor.line) : undefined;
  return line ? line.baseGauge : demo.baseGauge;
}
