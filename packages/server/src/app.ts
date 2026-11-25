// The app: one shared board, the fact service, the coach and the page's clients, wired together.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DRAWING_COLORS,
  LABEL_MARK,
  START_FEN,
  anyToMove,
  buildReport,
  compileLadder,
  conversionStart,
  makeSquare,
  demoFen,
  describeMove,
  EXPLORER_LAST_MOVE,
  EXPLORER_SPEEDS,
  bucketsText,
  explorerCovers,
  guessTable,
  indexMyGames,
  levelBuckets,
  movesTo,
  myGamesTable,
  readExplorer,
  speedsText,
  type ExplorerSource,
  type ExplorerView,
  type MyGame,
  type MyGamesIndex,
  type ReplySource,
  type OpeningCard,
  type RepGraph,
  type RepBrowserView,
  browserPositions,
  type RepGameView,
  type RepStatsView,
  type GameForRep,
  type MoveFrom,
  type RepLine,
  repertoireGraph,
  puzzleKey,
  matchGame,
  chapterOf,
  commonMoves,
  type BuildPosition,
  lineResults,
  positionKey,
  uciToMove,
  depthFor,
  lineText,
  lichessStudyId,
  repertoireLines,
  gaugeOf,
  guardText,
  importPgn,
  legalMoves,
  judgedText,
  mainlineEnd,
  mustPosition,
  outcomeOf,
  packetForCoach,
  parsePosition,
  parseSquare,
  pathTo,
  plainText,
  playLine,
  lineTitleProblems,
  profileInWords,
  replayPlan,
  themeName,
  winChance,
  guidanceFor,
  solverStart,
  motifMastery,
  type MotifMastery,
  type MotifStage,
  STEP_HABIT,
  STEP_NAME,
  STEP_QUESTION,
  lookedQuestion,
  tagMistake,
  tagUnclear,
  routineLevel,
  routinePrompt,
  tok,
  validateSay,
  type AppMode,
  type Chip,
  type ClientMsg,
  type CoachMessage,
  type ConceptLadder,
  type ConceptLadderFile,
  type Color,
  type DemoLine,
  type DemoMove,
  type DrawingColor,
  type EngineView,
  type Fact,
  type FactPacket,
  type Moment,
  type MoveTree,
  type ReviewReport,
  type ReviewView,
  type SkippedStep,
  type SayKind,
  type ServerMsg,
  type Shape,
  type ShapeStyle,
  type TreeNode,
  type VocabularyLevel,
} from '@chess-coach/core';
import { MaiaSidecar, type MoveSource } from './bots/service.ts';
import { asksForMove, wakeOnMove, type Verbosity } from './coach/director.ts';
import { loadTemplates, scripted, type ScriptedAsk, type Templates } from './coach/fallback.ts';
import type { CoachTools, ToolResult } from './coach/mcp.ts';
import { CoachSupervisor, type CoachEvent, type Turn } from './coach/supervisor.ts';
import type { TransportEvents } from './coach/transport.ts';
import type { CoachTransport } from './coach/transport.ts';
import { ContentService } from './content.ts';
import { Db } from './db.ts';
import { PowerGate, type BatteryPolicy } from './engine/power.ts';
import { EngineService } from './engine/service.ts';
import { FactService, type LineResult, type Look } from './facts-service.ts';
import { lichessStudyPgn, realHttp, type Http } from './importers.ts';
import { FAILURE_TEXT, LichessExplorer, type ExplorerQuery } from './explorer.ts';
import { RepertoireService, type BookPlan } from './repertoire.ts';
import { bookRules, levelReplies, mastersBook, otherJob, outlineFiles } from './book.ts';
import { ContentDesk } from './content-desk.ts';
import { OpeningTrainer, type OpeningEvent } from './opening-drill.ts';
import { TrapPack } from './traps.ts';
import { EndgamePack, EndgameTrainer, type EndgameCoachState, type EndgameEvent } from './endgames.ts';
import { basisChanges, becauseText, storeBasis, storedBasis, type GateBasis } from './revalidate.ts';
import { GameLibrary } from './library.ts';
import { LichessCloud, type CloudSource } from './lichess.ts';
import { OpeningBook } from './openings.ts';
import { PlayController, loadMinis, loadRoster, type SparEvent } from './play.ts';
import { PuzzleMaker, candidatesOf } from './puzzle-maker.ts';
import { PuzzleController, loadPuzzleWords, type DrillEvent, type DrillState, type PuzzleWords } from './puzzles.ts';
import { SafetyTrainer, safetySlips } from './safety.ts';
import { ThreatTrainer, threatSlips } from './threat.ts';
import { ConvertTrainer } from './convert.ts';
import { SpeedController } from './speed.ts';
import { StudyService } from './studies.ts';
import { SystemMonitor } from './system.ts';
import { NOT_A_THEME, PuzzleDb } from './datasets/puzzle-db.ts';
import { GameAnalyser, type GameAnalysis } from './review.ts';
import { BoardSession } from './session.ts';
import { PRESETS, Settings } from './settings.ts';
import { VoiceService, type VoiceEngines } from './voice.ts';

export type Client = { send: (msg: ServerMsg) => void };

export type AppOptions = {
  repoRoot: string;
  dataDir: string;
  dbFile?: string;
  stockfish: string;
  syzygy?: string;
  expectedBench?: number;
  claudePath: string;
  openingsDir: string;
  mcpUrl: string;
  /** the bots: where Maia-3 lives, and the roster file */
  maia?: { python: string; script: string; models: string };
  rosterFile?: string;
  /** the concept ladder file (content/concept-ladder.json) */
  ladderFile?: string;
  /** tests: a stand-in for Lichess's cloud analysis (null = none) */
  cloud?: CloudSource | null;
  /** tests: a fake coach process */
  makeTransport?: (events: TransportEvents, files: { promptFile: string; mcpConfigFile: string; model: string }) => CoachTransport;
  /** tests: a stand-in for Maia, and no simulated thinking time */
  botSource?: MoveSource;
  botNoDelay?: boolean;
  /** tests: no pause before the opponent's moves in a puzzle */
  puzzleNoDelay?: boolean;
  /** the installed Lichess puzzle database (default: data/datasets/puzzles/puzzles.sqlite) */
  puzzleDbFile?: string;
  /** the owner's Lichess token (from .env), for what needs it: a private study, the explorer */
  lichessToken?: () => string | undefined;
  /** tests: a stand-in for the two chess sites (the importers and the fair-play guard's lists) */
  sites?: Http;
  /** tests: a stand-in for asking Windows whether the laptop is on mains power */
  powerProbe?: () => Promise<boolean | null>;
  /** the coach's voice and the owner's (A20, A21): where the model files are; tests: stand-in engines that need no files */
  voice?: { dir: string; engines?: VoiceEngines; checkFiles?: boolean };
  log?: (msg: string) => void;
};

type Ladder = { seq: number; active: boolean; level: number; misses: number };
/** How one moment of a replay ended: found by the owner, told (a chip), given after the misses allowed, the last rung of the hints, shown as a worked example, or passed over. */
type ReplayHow = 'found' | 'told' | 'two_misses' | 'hints' | 'worked_new' | 'worked_deep' | 'skipped';
/** Going through the key moments of a game with the coach (feature B4). */
type Replay = {
  gameId: number;
  moments: Moment[];
  index: number;
  /** the position before the mistake: where the owner looks for a better move */
  node: string;
  phase: 'asking' | 'explained' | 'finished';
  mode: 'ask' | 'worked';
  /** the hint log (B4): how each moment ended, and what it needed */
  log: { ply: number; how: ReplayHow; hints: number; misses: number }[];
};
type ShowWhat = 'threats' | 'targets' | 'attacks';

/** what the engine and the coach answer while the owner is going through a game themselves (feature B7) */
const OWN_FIRST = 'You are going through this game yourself first. The engine and the coach join in when you press Done, or Skip.';
const CHIP_LABEL: Record<Chip, string> = { hint: 'Hint', tell_me: 'Just tell me', why: 'Why?', show_me: 'Show me' };
/** how long the owner stays on a position before the deeper search confirms its reading and label */
const DEEPEN_AFTER_MS = 450;

/** The kind of fact a puzzle's idea is, so that naming it is backed (a fork by a fork fact, a mate by a mate fact; other ideas by the solution's line). */
const IDEA_FACT: Record<string, Fact['type']> = { fork: 'fork', pin: 'pin', backRankMate: 'mate_in', mateIn1: 'mate_in', mateIn2: 'mate_in', mateIn3: 'mate_in', mateIn4: 'mate_in', mateIn5: 'mate_in', mate: 'mate_in' };

/** What the board tools say on the Puzzles and Play tabs: the board there is the app's. */
const NOT_ON_PUZZLES = 'On this tab the board is the app\'s (the puzzle player\'s, or the game\'s): talk with say only.';

/** How far an engine-style bot searches (WP 7.8): 1000 nodes at 1400, ten times more for every 300 points. */
export function engineBotNodes(elo: number): number {
  return Math.round(10 ** (3 + (Math.max(1000, Math.min(2600, elo)) - 1400) / 300));
}

/** The coach for each tab (COACH §5); a game review has its own. */
const AGENT_FOR: Record<AppMode, string> = { analysis: 'coach-analysis', games: 'coach-analysis', puzzles: 'coach-drill', play: 'coach-spar', openings: 'coach-opening', endgames: 'coach-endgame' };
const MODEL_FOR: Record<AppMode, string> = { analysis: 'coach.model.analysis', games: 'coach.model.analysis', puzzles: 'coach.model.drill', play: 'coach.model.spar', openings: 'coach.model.opening', endgames: 'coach.model.endgame' };
/** The tabs whose coach events are numbered by the drill counter (their own board, not the analysis board's) */
const DRILL_MODES: ReadonlySet<AppMode> = new Set(['puzzles', 'openings', 'endgames']);
/** What the owner hears when the endgame coach cannot answer a request for help in time */
const ENDGAME_ASK_SCRIPT = 'Which squares can their king still go to? Find a move that takes one more away.';
/** What the owner hears when the drill coach cannot answer about the safety check, the threat or the won game (D105): a step of the routine, no move */
const DRILL_ASK_SCRIPT: Record<'safety' | 'threat' | 'convert', string> = {
  safety: 'After the move, what are their checks, captures and threats? Look at each one before you decide.',
  threat: 'Look at their last move: which of your pieces or squares does it go after now?',
  convert: 'Which of their pieces can still make trouble? Find a move that takes away its best square, without giving anything back.',
};
/** What the owner hears when the opening coach cannot answer and the move is theirs to recall, or there is no move of theirs here (D12) */
const OPENING_ASK_SCRIPT = 'Look at what their last move changed: which of your pieces does it touch, and which squares does it take? Then play the move you think your repertoire has here.';

/** A motif's stage, for the coach (owner_profile). */
const STAGE_WORDS: Record<MotifStage, string> = { example: 'new, not tried yet', partial: 'still being learnt', full: 'known', mixed: 'mastered' };

export class App {
  readonly db: Db;
  readonly settings: Settings;
  readonly engine: EngineService;
  readonly facts: FactService;
  readonly book: OpeningBook;
  readonly session: BoardSession;
  readonly coach: CoachSupervisor;
  readonly play: PlayController;
  /** the owner's finished games, and their games in progress for the fair-play guard (Phase 5) */
  readonly library: GameLibrary;
  /** the gate runner: nothing is used for practice until it has passed (Phase 6) */
  readonly content: ContentService;
  /** the puzzle player, on a board of its own (WP 6.2) */
  readonly puzzles: PuzzleController;
  /** the safety-check trainer (WP 6.6) */
  readonly safety: SafetyTrainer;
  readonly threat: ThreatTrainer;
  readonly convert: ConvertTrainer;
  readonly speed: SpeedController;
  readonly studies: StudyService;
  /** the opening explorer (WP 8.2): Lichess's databases, paced and kept */
  readonly explorer: LichessExplorer;
  /** repertoires and their gates (WP 8.3) */
  readonly repertoires: RepertoireService;
  /** the review screen (WP 8.4) */
  readonly desk: ContentDesk;
  /** the opening drill (WP 8.8): one card per position of the live repertoires */
  readonly openings: OpeningTrainer;
  /** the coach's voice and the owner's (A20, A21; D108): loaded only when a voice setting is on */
  readonly voice: VoiceService;
  /** the trap pack (WP 8.9): content/traps.json through its gates, drilled as opening cards */
  readonly traps: TrapPack;
  /** endgame training (F2, built early 2026-11-15): content/endgames.json through its gates, played out against the tablebases */
  readonly endgamePack: EndgamePack;
  readonly endgames: EndgameTrainer;
  private deskSent = 0;
  private building = false;
  /** the outlines a repertoire can be built from (content/repertoires/, WP 8.12) */
  private readonly outlinesDir: string;
  /** the owner asked the build that is running to stop */
  private buildStop = false;
  /** the content checks that follow the engine (re-validation, the trap pack) are on: set once the engine is verified at server start */
  private contentChecks = false;
  private revalidateTimer: NodeJS.Timeout | null = null;
  /** the live repertoires as positions, one per side (WP 8.10): made again when what is live changes */
  private repGraphs: RepGraph[] | null = null;
  /** each game's moves, read once from its PGN */
  private gameSans = new Map<number, string[]>();
  /** the chess sites (Lichess, for a study's PGN) and the owner's Lichess token, read when needed */
  private readonly sites: Http;
  private readonly lichessToken: () => string | undefined;
  /** the owner's games by position, for the explorer's "my games": built when first needed, dropped when the library changes */
  private myGames: MyGamesIndex | null = null;
  private explorerSeq = 0;
  /** the owner's rough rating from their play, for the explorer (worked out again every few minutes: it moves slowly) */
  private level: { at: number; about?: number } | null = null;
  /** puzzles from the owner's own games (WP 6.3) */
  private readonly puzzleMaker: PuzzleMaker;
  private puzzleRun = 0;
  /** set by stop(): background jobs still finishing (puzzle making, the repertoire note) leave the closed database alone */
  private stopped = false;
  private puzzleDb: PuzzleDb | null = null;
  /** the analysis of the game on the board: its key moments (WP 5.3) */
  review: ReviewView | null = null;
  private readonly analyser: GameAnalyser;
  private reviewRun = 0;
  /** the owner's own review of the game on the board, while it is going on (B7): their marks so far, and the engine's findings held back until they finish */
  private own: { gameId: number; marks: number[]; held?: GameAnalysis } | null = null;
  private replay: Replay | null = null;
  private readonly botSource: MoveSource;
  /** the check heavy engine jobs make before they start: is the laptop on mains power? */
  readonly power: PowerGate;
  /** which chess ideas the coach may name at each vocabulary level (content/concept-ladder.json, feature H11) */
  readonly concepts: ConceptLadder;
  /** the scripted fallback's own sentences (coach/templates/analysis.json, feature A11) */
  private readonly templates: Templates;
  mode: AppMode = 'analysis';
  private readonly puzzleWords: PuzzleWords;
  /** the drill coach's events (WP 6.11): their own count, since the puzzle board is not the analysis board */
  private drillSeq = 0;
  /** and the sparring coach's (WP 7.7) */
  private sparSeq = 0;
  /** the puzzle the latest drill event was about: its messages are shown with it */
  private drillFor: number | null = null;
  /** the answers offered to "did you look at their reply?" (WP 5.7): each button's words → the moment and the step it means */
  private readonly tagAsks = new Map<string, { gameId: number; ply: number; step: SkippedStep }>();
  /** the position the owner walks to on the Openings tab (D12): the coach there sees it and answers about it */
  private openingWalk: { repertoire: number; moves: string[] } | null = null;
  /** the computer's load for the top bar (I18): sampled only while a page is open and the setting is on */
  readonly system = new SystemMonitor({ onView: (view) => this.broadcast({ type: 'system', view }), wanted: () => this.clients.size > 0 && this.settings.get<boolean>('display.systemStats') });
  /** clean solves since the last word of praise: "correct → usually silent" */
  private cleanSolves = 0;
  private clients = new Set<Client>();
  private packetCache: { key: string; packet: Promise<FactPacket> } | null = null;
  private deepCache: { key: string; packet: Promise<FactPacket> } | null = null;
  private ladder: Ladder = { seq: 0, active: false, level: 0, misses: 0 };
  private insightRun = 0;
  private deepTimer: NodeJS.Timeout | null = null;
  private deepened = new WeakSet<TreeNode>();
  /** per position: the reading and arrows from the checked analysis, once it is in */
  private confirmed = new WeakMap<TreeNode, Look>();
  private arrowsHeld = false;
  private labelling = false;
  /** the game the running analysis is for, and when it ends (a cancelled one ends soon) */
  private labellingGame: number | null = null;
  private labellingDone: Promise<void> | null = null;
  private lastGameStatus = '';
  private log: (msg: string) => void;
  engineInfo: { ok: boolean; bench: number; name: string } | null = null;

  constructor(opts: AppOptions) {
    this.log = opts.log ?? (() => {});
    this.power = new PowerGate(opts.powerProbe);
    // content the app cannot run without: a broken file stops the start, with the reason
    this.templates = loadTemplates(path.join(opts.repoRoot, 'coach', 'templates', 'analysis.json'));
    this.concepts = compileLadder(JSON.parse(readFileSync(opts.ladderFile ?? path.join(opts.repoRoot, 'content', 'concept-ladder.json'), 'utf8')) as ConceptLadderFile);
    this.db = new Db(opts.dbFile ?? path.join(opts.dataDir, 'chess-coach.sqlite'));
    this.settings = new Settings(this.db);
    this.voice = new VoiceService({ dir: opts.voice?.dir ?? path.join(opts.dataDir, 'voice-models'), engines: opts.voice?.engines, checkFiles: opts.voice?.checkFiles, log: this.log });
    this.warmVoice();
    this.engine = new EngineService({ path: opts.stockfish, syzygyPath: opts.syzygy, quickWorkers: 4, analysisWorkers: 6, expectedBench: opts.expectedBench, cache: this.db.engineCache, log: this.log });
    const cloud = opts.cloud === undefined ? new LichessCloud(this.db, { log: this.log }) : (opts.cloud ?? undefined);
    this.facts = new FactService(this.engine, { cloud, nodes: this.settings.get<number>('engine.quickNodes'), verdictNodes: this.settings.get<number>('engine.verdictNodes'), thresholds: this.thresholds(), startAt: Math.floor(Date.now() / 1000) % 100000 });
    this.facts.useCloud = this.settings.get<boolean>('engine.lichessCrossCheck');
    this.facts.excellent = this.settings.get<number>('grading.excellent');
    this.book = OpeningBook.load(opts.openingsDir);
    this.facts.book = (fen) => this.book.at(fen);
    this.session = new BoardSession(this.db, this.book);
    this.puzzleWords = loadPuzzleWords(path.join(opts.repoRoot, 'coach', 'templates', 'puzzle.json'));
    this.session.onChange = () => this.broadcastState();
    this.coach = new CoachSupervisor({
      db: this.db,
      repoRoot: opts.repoRoot,
      dataDir: opts.dataDir,
      claudePath: opts.claudePath,
      mcpUrl: opts.mcpUrl,
      // a game review has an agent and a model setting of its own (COACH §5)
      // on the Puzzles tab the drill coach talks about the puzzle board (WP 6.11); on Play a bot, the sparring coach about the game (WP 7.7)
      agent: () => (this.replay ? 'coach-review' : this.openingSet() ? 'coach-opening' : AGENT_FOR[this.mode]),
      model: () => this.settings.get<string>(this.replay ? 'coach.model.review' : this.openingSet() ? 'coach.model.opening' : MODEL_FOR[this.mode]),
      idleStopMinutes: () => this.settings.get<number>('coach.idleStopMinutes'),
      turnsPerSession: () => this.settings.get<number>('coach.turnsPerSession'),
      onTurnEnd: (turn, how) => this.onTurnEnd(turn, how),
      onStatus: (status) => this.broadcast({ type: 'coach_status', status }),
      makeTransport: opts.makeTransport,
      log: this.log,
    });
    const maia = opts.maia;
    this.botSource =
      opts.botSource ??
      new MaiaSidecar({
        python: maia?.python ?? '',
        script: maia?.script ?? '',
        spec: () => {
          const size = this.settings.get<string>('play.model');
          return { model: `maia3-${size}`, checkpoint: path.join(maia?.models ?? '', `maia3-${size}.pt`), device: 'cpu' };
        },
        log: this.log,
        onState: () => this.broadcastBots(),
      });
    // the move to teach (H12): Maia's probabilities at the owner's level, when it is running already (never started just for this)
    this.facts.humanProbs = async (fen) => {
      if (!this.settings.get<boolean>('coach.findableByMaia') || this.botSource.state !== 'ready') return null;
      const elo = Math.max(600, Math.round((this.library.profile().band?.about ?? 600) / 100) * 100);
      const probs = await Promise.race([this.botSource.probabilities({ startFen: fen, moves: [], selfElo: elo, oppoElo: elo }), new Promise<null>((r) => setTimeout(() => r(null), 1500).unref?.())]);
      return probs ? new Map(probs.map((p) => [p.uci, p.p])) : null;
    };
    this.play = new PlayController({
      db: this.db,
      engineSource: this.engineBot(),
      // whether the bot takes a draw: the engine's winning chances for the side to move (only yes or no reaches the page)
      assess: async (fen) => {
        const r = await this.engine.analyse({ fen, nodes: this.settings.get<number>('engine.quickNodes'), multipv: 1 });
        return r.lines[0] ? winChance(r.lines[0].score) : 50;
      },
      // A8: a blunder brings the offer to take it back, with the question about the step it skipped (worked out by code)
      judgeMove: async (fenBefore, san, you) => {
        const r = await this.facts.checkMove(fenBefore, san, you);
        if (!r.legal || r.class !== 'blunder') return { blunder: false, what: '', question: '' };
        const tag = tagMistake({ fenBefore, san, grade: r.grade });
        return { blunder: true, what: tag.what, question: STEP_QUESTION[tag.step] };
      },
      // A9: the routine before the owner's moves, fading with the blunder rate of their analysed games
      routine: () => {
        const mode = this.settings.get<string>('play.routineOverlay');
        if (mode === 'off') return { level: 'off' };
        const p = this.library.profile();
        const top = p.steps[0]?.step;
        if (mode === 'always') return { level: 'every', top };
        return { level: routineLevel({ blundersPer100: p.blunders.recent ?? p.blunders.value, games: p.blunders.games }), top };
      },
      // the sparring coach (WP 7.7): the start, the owner's turn, a blunder, the end
      onSpar: (e) => void this.onSpar(e).catch((err) => this.log(`sparring coach: ${(err as Error).message}`)),
      // a finished game goes into the owner's library, where it is reviewed like any other (WP 7.3)
      onFinished: (pgn, you) => this.library.addPlayed(pgn, you),
      settings: this.settings,
      roster: loadRoster(opts.rosterFile ?? path.join(opts.repoRoot, 'content', 'bots.json')),
      minis: loadMinis(path.join(opts.repoRoot, 'content', 'minigames.json'), this.log),
      source: this.botSource,
      onChange: () => this.broadcastGame(),
      onProblem: (text) => this.broadcast({ type: 'toast', level: 'error', text }),
      log: this.log,
      noDelay: opts.botNoDelay,
    });
    this.analyser = new GameAnalyser(this.engine, this.facts);
    const dbFile = opts.dbFile ?? path.join(opts.dataDir, 'chess-coach.sqlite');
    this.content = new ContentService({
      db: this.db,
      engine: this.engine,
      facts: this.facts,
      ladder: this.concepts,
      dataDir: opts.dataDir,
      dbFile,
      options: () => ({ nodes: this.settings.get<number>('content.gateNodes'), vocabulary: this.settings.get<VocabularyLevel>('coach.vocabulary'), autoApprove: this.settings.get<boolean>('content.autoApprovePuzzles') }),
    });
    this.library = new GameLibrary({ db: this.db, settings: this.settings, http: opts.sites, log: this.log, onChange: () => this.libraryChanged() });
    // the outlines in content/repertoires/, each with the repertoire built from it (WP 8.12)
    this.desk = new ContentDesk(this.db, () =>
      outlineFiles(this.outlinesDir).map((o) => {
        const id = this.db.repertoireByOutline(o.id);
        const plan = id ? (this.db.repertoire(id)?.plan as { built?: { at: string } } | null | undefined) : undefined;
        return { id: o.id, name: o.name, colour: o.colour ?? 'white', chapters: o.outline?.chapters.length ?? 0, problems: o.problems, repertoire: id, built: plan?.built?.at };
      }),
    );
    this.sites = opts.sites ?? realHttp;
    this.lichessToken = opts.lichessToken ?? (() => undefined);
    this.outlinesDir = path.join(opts.repoRoot, 'content', 'repertoires');
    this.repertoires = new RepertoireService({
      db: this.db,
      engine: this.engine,
      replies: (fen) => this.repliesAt(fen),
      human: async (fen) => (await this.maiaGuess(fen))?.table.rows.map((r) => ({ uci: r.uci, p: r.share / 100 })) ?? null,
      // the book (WP 8.12): the masters' games, and the replies at the owner's level that are book too
      book: (fen) => mastersBook(this.explorer)(fen),
      level: (fen, hint) => levelReplies(this.explorer, (f) => this.explorerQuery('level', f))(fen, hint),
      openingName: (fens) => this.book.lookup(fens)?.name,
      words: { facts: this.facts, ladder: this.concepts, vocabulary: () => this.settings.get<VocabularyLevel>('coach.vocabulary') },
      dataDir: opts.dataDir,
      dbFile,
      options: () => {
        const depth = this.settings.get<string>('repertoire.depth');
        return {
          nodes: this.settings.get<number>('content.gateNodes'),
          secondNodes: this.settings.get<number>('repertoire.secondNodes'),
          maxDrop: this.settings.get<number>('repertoire.maxDrop'),
          minCovered: this.settings.get<number>('repertoire.minCovered'),
          flagShare: this.settings.get<number>('repertoire.flagShare'),
          depthMoves: depth === 'auto' ? depthFor(this.library.profile().band?.band) : Number(depth),
          thresholds: this.thresholds(),
          autoApprove: this.settings.get<boolean>('repertoire.autoApprove'),
        };
      },
      onProgress: (p) => {
        // the review screen shows how far the gates are (at most twice a second), and the result when they are done
        if (p.step === 'done') {
          this.desk.running.delete(p.repertoire);
          this.log(`repertoire ${p.repertoire}: gates done`);
          return this.sendDesk();
        }
        this.desk.running.set(p.repertoire, { step: p.step, done: p.done, total: p.total });
        if (Date.now() - this.deskSent > 500) this.sendDesk();
      },
    });
    this.safety = new SafetyTrainer({
      db: this.db,
      facts: this.facts,
      storedUnderData: true,
      onChange: () => this.broadcast({ type: 'safety', view: this.safety.view }),
      schedule: () => ({ reviewCap: this.settings.get<number>('puzzles.reviewCap'), maxDays: this.settings.get<number>('puzzles.maxIntervalDays') }),
      listFirst: () => this.settings.get<boolean>('safety.listFirst'),
      listThreats: () => this.settings.get<boolean>('safety.listThreats'),
      guard: (fens) => {
        const hit = this.library.guard(fens);
        return hit ? guardText(hit) : null;
      },
    });
    this.threat = new ThreatTrainer({
      db: this.db,
      facts: this.facts,
      storedUnderData: true,
      onChange: () => this.broadcast({ type: 'threat', view: this.threat.view }),
      schedule: () => ({ reviewCap: this.settings.get<number>('puzzles.reviewCap'), maxDays: this.settings.get<number>('puzzles.maxIntervalDays') }),
      guard: (fens) => {
        const hit = this.library.guard(fens);
        return hit ? guardText(hit) : null;
      },
    });
    this.convert = new ConvertTrainer({
      db: this.db,
      facts: this.facts,
      engine: this.engine,
      storedUnderData: true,
      onChange: () => this.broadcast({ type: 'convert', view: this.convert.view }),
      schedule: () => ({ reviewCap: this.settings.get<number>('puzzles.reviewCap'), maxDays: this.settings.get<number>('puzzles.maxIntervalDays') }),
      guard: (fens) => {
        const hit = this.library.guard(fens);
        return hit ? guardText(hit) : null;
      },
      nodes: () => this.settings.get<number>('conversion.engineNodes'),
      maxMoves: () => this.settings.get<number>('conversion.maxMoves'),
      // a human-like defender (WP 6.8's open item): Maia at the owner's level answers; the engine still judges the win
      defender: () =>
        this.settings.get<string>('conversion.defender') === 'maia' && this.botSource.state !== 'error'
          ? async (fen: string) => {
              const elo = Math.min(2600, Math.max(600, Math.round((this.ownerRating() ?? 600) / 100) * 100));
              const probs = await this.botSource.probabilities({ startFen: fen, moves: [], selfElo: elo, oppoElo: elo });
              return [...probs].sort((a, b) => b.p - a.p)[0]?.uci ?? null;
            }
          : null,
    });
    this.traps = new TrapPack({
      db: this.db,
      engine: this.engine,
      facts: this.facts,
      ladder: this.concepts,
      vocabulary: () => this.settings.get<VocabularyLevel>('coach.vocabulary'),
      // how often players at the owner's level reach a position: the explorer, waiting its turn
      games: async (fen) => {
        const r = await this.explorer.ask(this.explorerQuery('level', fen), { batch: true });
        const t = r.ok ? readExplorer(fen, r.raw) : null;
        return t ? t.games : null;
      },
      options: () => ({
        nodes: this.settings.get<number>('content.gateNodes'),
        secondNodes: this.settings.get<number>('repertoire.secondNodes'),
        maxDrop: this.settings.get<number>('repertoire.maxDrop'),
        thresholds: this.thresholds(),
        autoApprove: this.settings.get<boolean>('content.autoApproveTraps'),
      }),
      file: path.join(opts.repoRoot, 'content', 'traps.json'),
      log: this.log,
    });
    this.endgamePack = new EndgamePack({
      db: this.db,
      engine: this.engine,
      facts: this.facts,
      ladder: this.concepts,
      vocabulary: () => this.settings.get<VocabularyLevel>('coach.vocabulary'),
      nodes: () => this.settings.get<number>('content.gateNodes'),
      autoApprove: () => this.settings.get<boolean>('content.autoApproveEndgames'),
      file: path.join(opts.repoRoot, 'content', 'endgames.json'),
      log: this.log,
    });
    this.endgames = new EndgameTrainer({
      db: this.db,
      engine: this.engine,
      // the defence comes from the tablebases: a small search finds it at once
      nodes: () => 300_000,
      schedule: () => ({ reviewCap: this.settings.get<number>('puzzles.reviewCap'), maxDays: this.settings.get<number>('puzzles.maxIntervalDays') }),
      onChange: () => this.broadcast({ type: 'endgame', view: this.endgames.view }),
      topics: () => this.endgamePack.read().topics,
      onEvent: (e) => void this.onEndgame(e),
    });
    this.openings = new OpeningTrainer({
      db: this.db,
      storedUnderData: true,
      onChange: () => this.broadcast({ type: 'opening', view: this.openings.view }),
      schedule: () => ({ reviewCap: this.settings.get<number>('puzzles.reviewCap'), maxDays: this.settings.get<number>('puzzles.maxIntervalDays') }),
      guard: (fens) => {
        const hit = this.library.guard(fens);
        return hit ? guardText(hit) : null;
      },
      depthMoves: () => {
        const depth = this.settings.get<string>('repertoire.depth');
        return depth === 'auto' ? depthFor(this.library.profile().band?.band) : Number(depth);
      },
      whyEvery: () => this.settings.get<number>('openings.whyEvery'),
      newPerDay: () => this.settings.get<number>('openings.newPerDay'),
      onEvent: (e) => void this.onOpening(e).catch((err) => this.log(`opening coach: ${(err as Error).message}`)),
      // how often players at the owner's level play each reply: the explorer's kept answers only, no call
      replyShares: (fen) => {
        const kept = this.explorer.cached(this.explorerQuery('level', fen));
        const t = kept ? readExplorer(fen, kept) : null;
        return t?.games ? new Map(t.rows.map((r) => [r.uci, r.share])) : null;
      },
    });
    this.puzzleMaker = new PuzzleMaker(this.engine, this.content, () => this.settings.get<number>('content.gateNodes'));
    this.puzzles = new PuzzleController({
      db: this.db,
      facts: this.facts,
      words: this.puzzleWords,
      onDrill: (e) => void this.onDrill(e).catch((err) => this.log(`drill coach: ${(err as Error).message}`)),
      // a puzzle from the owner's games coming back: every other time, the same idea in a new position (WP 6.5, 6.9)
      sameMotif: () => this.settings.get<string>('puzzles.sameIdeaNew') === 'alternate',
      // A9 in the drills (WP 7.5): the routine's question before a puzzle's first move, fading like the games' overlay
      routine: () => {
        const mode = this.settings.get<string>('puzzles.routineOverlay');
        if (mode === 'off') return { level: 'off' };
        const p = this.library.profile();
        const top = p.steps[0]?.step;
        if (mode === 'always') return { level: 'every', top };
        return { level: routineLevel({ blundersPer100: p.blunders.recent ?? p.blunders.value, games: p.blunders.games }), top };
      },
      maxMisses: () => this.settings.get<number>('coach.ladder.maxMisses'),
      // fair play: a puzzle whose position is one of a game still being played is passed over
      guard: (fens) => {
        const hit = this.library.guard(fens);
        return hit ? guardText(hit) : null;
      },
      onChange: () => this.broadcast({ type: 'puzzle', view: this.puzzles.view }),
      content: this.content,
      // opened when first needed, so a database installed while the app runs is found
      puzzleDb: () => (this.puzzleDb ??= PuzzleDb.open(opts.puzzleDbFile ?? path.join(opts.dataDir, 'datasets', 'puzzles', 'puzzles.sqlite'))),
      startLevel: () => this.settings.get<number>('puzzles.startLevel'),
      schedule: () => ({ newPerDay: this.settings.get<number>('puzzles.newPerDay'), reviewCap: this.settings.get<number>('puzzles.reviewCap'), maxDays: this.settings.get<number>('puzzles.maxIntervalDays'), afterNudge: this.settings.get<'hard' | 'good'>('puzzles.afterNudge') }),
      guidance: () => ({ fade: this.settings.get<boolean>('puzzles.fadeGuidance'), mixedKnownOnly: this.settings.get<boolean>('puzzles.mixedKnownOnly') }),
      modes: () => ({ woodpecker: this.settings.get<boolean>('puzzles.woodpecker'), speed: this.settings.get<boolean>('puzzles.speedModes'), woodpeckerSize: this.settings.get<number>('puzzles.woodpeckerSize') }),
      noDelay: opts.puzzleNoDelay,
      log: this.log,
    });
    // the speed runs: database puzzles only, and no engine or coach at all (silent by construction)
    this.speed = new SpeedController({
      db: this.db,
      content: this.content,
      puzzleDb: () => (this.puzzleDb ??= PuzzleDb.open(opts.puzzleDbFile ?? path.join(opts.dataDir, 'datasets', 'puzzles', 'puzzles.sqlite'))),
      level: () => this.puzzles.level(),
      enabled: () => this.settings.get<boolean>('puzzles.speedModes'),
      seconds: () => this.settings.get<number>('puzzles.timedSeconds'),
      guard: (fens) => {
        const hit = this.library.guard(fens);
        return hit ? guardText(hit) : null;
      },
      onChange: () => this.broadcast({ type: 'speed', view: this.speed.view }),
    });
    this.explorer = new LichessExplorer({ db: this.db, http: opts.sites ?? realHttp, token: opts.lichessToken ?? (() => undefined), log: this.log });
    this.studies = new StudyService({ db: this.db, http: opts.sites, token: opts.lichessToken, onChange: () => this.broadcast({ type: 'studies', view: this.studies.view() }) });
    this.session.setNotice(this.library.notice());
    // a game that was on the board when the app stopped: if the owner has not been through it, that still comes first (B7)
    const onBoard = this.session.state.game;
    if (onBoard && this.settings.get<boolean>('review.ownFirst') && !this.db.getSelfReview(onBoard.id)) {
      this.own = { gameId: onBoard.id, marks: [] };
      this.review = { gameId: onBoard.id, status: 'skipped', own: { state: 'pending', marks: [], notes: '' }, moments: [] };
    }
    try {
      const saved = JSON.parse(this.db.loadSession('app') ?? '{}') as { mode?: AppMode };
      if (saved.mode === 'play' || saved.mode === 'analysis' || saved.mode === 'games' || saved.mode === 'puzzles') this.mode = saved.mode;
    } catch {
      /* start on the analysis board */
    }
    this.settings.onChange((key) => {
      // a budget or a threshold the content checks rest on: check the content again, once the owner has stopped changing it
      if (this.contentChecks && (key === 'content.gateNodes' || key === 'repertoire.secondNodes' || key === 'repertoire.maxDrop' || key.startsWith('grading.'))) {
        if (this.revalidateTimer) clearTimeout(this.revalidateTimer);
        this.revalidateTimer = setTimeout(() => {
          this.revalidateTimer = null;
          void this.revalidateIfChanged().catch((e: Error) => this.log(`re-validation: ${e.message}`));
        }, 20_000);
        this.revalidateTimer.unref?.();
      }
      if (key === 'engine.quickNodes') this.facts.nodes = this.settings.get<number>('engine.quickNodes');
      if (key === 'engine.verdictNodes') this.facts.verdictNodes = this.settings.get<number>('engine.verdictNodes');
      if (key === 'engine.lichessCrossCheck') this.facts.useCloud = this.settings.get<boolean>('engine.lichessCrossCheck');
      if (key.startsWith('coach.model.')) this.coach.restart();
      if (key.startsWith('voice.')) this.warmVoice();
      if (key === 'play.model') this.botSource.stop(); // the next bot move loads the other model
      // "your own review first" switched off in the middle of one: the engine's findings are shown now (nothing is recorded as reviewed)
      if (key === 'review.ownFirst' && !this.settings.get<boolean>('review.ownFirst') && this.own) {
        const { gameId, held } = this.own;
        this.own = null;
        if (held) this.showReview(gameId, held);
        else this.setReview(this.review && this.review.status === 'running' ? { ...this.review, own: undefined } : null);
      }
      // the optional puzzle modes switched on or off: their sets appear or go at once
      if (key === 'puzzles.woodpecker' || key === 'puzzles.speedModes') {
        this.puzzles.refresh();
        this.speed.refresh();
      }
      // another account, or another choice of what to import: the library starts over
      if (key.startsWith('accounts.') || key === 'import.speeds' || key === 'import.casual' || key === 'import.monthsBack') this.library.accountsChanged();
      this.packetCache = null;
      this.deepCache = null;
      this.broadcastSettings();
      if (key.startsWith('grading.') || key.startsWith('engine.')) {
        // the labels and readings rest on these: work them out again
        this.facts.thresholds = this.thresholds();
        this.facts.excellent = this.settings.get<number>('grading.excellent');
        this.facts.forgetLabels();
        this.confirmed = new WeakMap();
        this.deepened = new WeakSet();
        if (key.startsWith('grading.')) this.session.clearJudgements();
        else void this.refreshInsight();
      }
      if (key.startsWith('display.')) {
        void this.sendEngineView();
        void this.refreshInsight();
      }
      if (key.startsWith('explorer.')) void this.sendExplorerView();
    });
  }

  private thresholds() {
    return { inaccuracy: this.settings.get<number>('grading.inaccuracy'), mistake: this.settings.get<number>('grading.mistake'), blunder: this.settings.get<number>('grading.blunder') };
  }

  /** Check the engine's fingerprint (decision D31). Runs in the background at startup. */
  async verifyEngine() {
    try {
      this.engineInfo = await this.engine.verify();
      this.log(`engine: ${this.engineInfo.name}, bench ${this.engineInfo.bench}${this.engineInfo.ok ? ' (matches)' : ' (DIFFERENT BUILD)'}`);
      if (!this.engineInfo.ok) this.broadcast({ type: 'toast', level: 'error', text: 'The chess engine is not the expected build. Its answers are kept apart from earlier ones.' });
    } catch (e) {
      this.log(`engine check failed: ${(e as Error).message}`);
      this.broadcast({ type: 'toast', level: 'error', text: 'The chess engine did not start. Check the Stockfish path.' });
    }
  }

  /** After a restart: a bot game that was waiting for the bot carries on. */
  resume() {
    this.play.resume();
    this.library.start(); // the owner's games, and their games in progress: now, then on a timer
  }

  /** Once the engine is verified (its signature is known): re-validate if the engine or a threshold changed, then check the trap pack. */
  async afterEngineReady() {
    this.contentChecks = true;
    await this.revalidateIfChanged();
    await this.checkTraps();
    await this.checkEndgames();
  }

  /** The endgame ladder through its gates when it is new or changed (engine work, through the power gate). */
  async checkEndgames() {
    try {
      const plan = await this.power.plan(this.settings.get<BatteryPolicy>('engine.onBattery'), 'checking the endgame positions');
      if (!plan.run) return;
      const r = await this.endgamePack.sync();
      if (r.checked) this.log(`endgame positions: ${r.checked} checked (${r.live} live, ${r.quarantined} in quarantine)`);
      this.endgames.refresh();
    } catch (e) {
      this.log(`endgame positions: ${(e as Error).message}`);
    }
  }

  /** What the engine checks behind live content ran with: the engine, the budgets, the thresholds. */
  gateBasis(): GateBasis {
    return {
      engine: this.engine.signature,
      nodes: this.settings.get<number>('content.gateNodes'),
      secondNodes: this.settings.get<number>('repertoire.secondNodes'),
      maxDrop: this.settings.get<number>('repertoire.maxDrop'),
      thresholds: this.thresholds(),
    };
  }

  /**
   * Re-validation (J7, WP 8.11): when the engine or a threshold changed since live content was last
   * checked, V2 and V7 run again over the repertoires and V2 over the puzzles from the owner's games.
   * What now fails is quarantined, its reason saying what changed; ids stay, so drill history stays.
   */
  async revalidateIfChanged(): Promise<{ changes: string[]; lines: number; puzzles: number } | null> {
    const now = this.gateBasis();
    const before = storedBasis(this.db);
    if (!before) {
      storeBasis(this.db, now);
      return null;
    }
    const changes = basisChanges(before, now);
    if (!changes.length) return null;
    const plan = await this.power.plan(this.settings.get<BatteryPolicy>('engine.onBattery'), 're-checking your content after the change');
    if (!plan.run) return null;
    const because = becauseText(changes)!;
    this.log(`content: ${because}`);
    let lines = 0;
    let puzzles = 0;
    // one check of content at a time: an import or a build waits for this one
    if (this.building || otherJob(this.db)) return null;
    this.building = true;
    try {
      for (const r of this.db.repertoires()) {
        const was = this.db.repertoireItems(r.id).filter((x) => x.status === 'quarantined').length;
        const report = await this.repertoires.revalidate(r.id, because);
        if (report) lines += Math.max(0, report.quarantined - was);
      }
      for (const item of this.db.listContent({ status: 'live', type: 'puzzle_game', limit: 5000 })) {
        const checked = await this.content.validate(item);
        if (checked.status !== 'quarantined') continue;
        for (const g of checked.gates) if (g.gate === 'V2' && g.result === 'fail') g.detail = `${g.detail} (${because})`;
        this.db.saveContent(puzzleKey(item.body, item.source), { ...checked, status: 'quarantined' });
        puzzles++;
      }
    } finally {
      this.building = false;
    }
    storeBasis(this.db, now);
    this.db.logEvent('revalidated', { changes, lines, puzzles });
    this.sendDesk();
    if (lines || puzzles) this.broadcast({ type: 'toast', level: 'info', text: `Your content was checked again after a change of ${changes.join(', ')}: ${lines} repertoire ${lines === 1 ? 'line' : 'lines'} and ${puzzles} ${puzzles === 1 ? 'puzzle' : 'puzzles'} now fail and wait under Review content.` });
    return { changes, lines, puzzles };
  }

  /** The trap pack through its gates when it is new or changed (engine work: on mains power, or as the battery setting says). */
  async checkTraps(force = false) {
    try {
      const plan = await this.power.plan(this.settings.get<BatteryPolicy>('engine.onBattery'), 'checking the trap pack');
      if (!plan.run) return;
      const r = await this.traps.sync(force);
      if (r.checked || r.removed) this.log(`trap pack: ${r.checked} checked (${r.live} live, ${r.quarantined} in quarantine), ${r.removed} removed`);
      this.openings.sync();
    } catch (e) {
      this.log(`trap pack: ${(e as Error).message}`);
    }
  }

  /** A voice switched on with this computer making it: load its model now, so the first sentence is not slow (A20, A21). */
  private warmVoice() {
    if (this.settings.get<boolean>('voice.speak') && this.settings.get<string>('voice.speakWith') === 'computer') this.voice.warm('speak');
    if (this.settings.get<boolean>('voice.listen') && this.settings.get<string>('voice.listenWith') === 'computer') this.voice.warm('listen');
  }

  async stop() {
    this.stopped = true;
    this.system.stop();
    if (this.deepTimer) clearTimeout(this.deepTimer);
    this.coach.stop('owner');
    this.play.stop();
    this.puzzles.stop();
    this.explorer.stop();
    this.puzzleDb?.close();
    this.library.stop();
    await this.engine.stop();
    this.db.close();
  }

  // ------------------------------------------------------------ clients

  addClient(client: Client): () => void {
    this.clients.add(client);
    this.system.start();
    return () => this.clients.delete(client);
  }

  private broadcast(msg: ServerMsg) {
    for (const c of this.clients) {
      try {
        c.send(msg);
      } catch {
        /* a closed socket is removed by its close handler */
      }
    }
  }

  private broadcastState() {
    this.broadcast({ type: 'state', state: this.session.state });
    void this.sendEngineView();
    void this.sendExplorerView();
    void this.refreshInsight();
  }

  private broadcastSettings() {
    this.broadcast({ type: 'settings', settings: this.settings.all(), presets: PRESETS });
  }

  private broadcastBots() {
    this.broadcast({ type: 'bots', view: this.play.botsView() });
  }

  private broadcastGame() {
    this.broadcast({ type: 'game', game: this.play.game });
    // the record and the suggested bot change when a game ends
    if (this.play.game.status !== this.lastGameStatus) {
      this.lastGameStatus = this.play.game.status;
      this.broadcastBots();
    }
  }

  private async sendEngineView() {
    if (!this.settings.get<boolean>('display.engineLines') || this.blocked()) return this.broadcast({ type: 'engine', view: null });
    const seq = this.session.state.seq;
    try {
      const p = await this.focusPacket();
      if (seq !== this.session.state.seq) return;
      const numbers = this.settings.get<boolean>('display.numbers');
      const view: EngineView = { lines: p.engine.best.map((b) => ({ san: b.san, line: b.line, verdict: b.verdict, outcome: b.outcome, win: numbers ? Math.round(p.turn === p.you ? b.win : 100 - b.win) : undefined })) };
      this.broadcast({ type: 'engine', view });
    } catch {
      /* the engine is down: nothing to show */
    }
  }

  /** What the explorer is asked for: Lichess at the owner's level (or the band chosen), or the masters. */
  private explorerQuery(source: 'level' | 'masters', fen: string): ExplorerQuery {
    if (source === 'masters') return { db: 'masters', fen, ratings: [], speeds: [] };
    const pick = this.settings.get<string>('explorer.ratings');
    const ratings = pick === 'auto' ? levelBuckets(this.ownerRating()) : [Number(pick)];
    return { db: 'lichess', fen, ratings, speeds: EXPLORER_SPEEDS[this.settings.get<'yours' | 'all'>('explorer.speeds')] ?? EXPLORER_SPEEDS.yours };
  }

  /**
   * What players at the owner's level reply in a position, for a repertoire's gate V4: the explorer's
   * counted games when it has enough of them, else Maia's guess (the second source, CONTENT §7).
   */
  private async repliesAt(fen: string): Promise<ReplySource | null> {
    const r = await this.explorer.ask(this.explorerQuery('level', fen), { batch: true });
    if (r.ok) {
      const t = readExplorer(fen, r.raw);
      if (t && t.games >= 20) return { source: 'explorer', games: t.games, replies: t.rows.map((row) => ({ uci: row.uci, san: row.san, share: row.share })) };
    }
    const guess = await this.maiaGuess(fen);
    return guess ? { source: 'maia', replies: guess.table.rows.map((row) => ({ uci: row.uci, san: row.san, share: row.share })) } : null;
  }

  /** The owner's rough rating from the skill profile (H5), or undefined while too few games are analysed. */
  private ownerRating(): number | undefined {
    if (!this.level || Date.now() - this.level.at > 5 * 60_000) this.level = { at: Date.now(), about: this.library.profile().band?.about };
    return this.level.about;
  }

  /** The owner's games by position (built once, dropped when the library changes). */
  private myGamesIndex(): MyGamesIndex {
    if (this.myGames) return this.myGames;
    const games: MyGame[] = [];
    for (const g of this.db.explorerGames()) {
      const r = importPgn(g.pgn);
      if (!r.ok || r.tree.nodes[r.tree.root]!.fen !== START_FEN) continue;
      const result = g.result === '1-0' || g.result === '0-1' || g.result === '1/2-1/2' ? g.result : '*';
      games.push({ id: g.id, you: g.you, result, sans: movesTo(r.tree, mainlineEnd(r.tree)) });
    }
    return (this.myGames = indexMyGames(games));
  }

  /** Maia's guess of what players at the owner's level play (the explorer's stand-in, D6); null when Maia cannot answer. */
  private async maiaGuess(fen: string): Promise<{ table: NonNullable<ExplorerView['table']>; elo: number } | null> {
    if (this.botSource.state === 'error') return null;
    const elo = Math.min(2600, Math.max(600, Math.round((this.ownerRating() ?? 600) / 100) * 100));
    try {
      const probs = await Promise.race([this.botSource.probabilities({ startFen: fen, moves: [], selfElo: elo, oppoElo: elo }), new Promise<null>((r) => setTimeout(() => r(null), 25_000).unref?.())]);
      const table = probs ? guessTable(fen, probs) : null;
      return table ? { table, elo } : null;
    } catch {
      return null;
    }
  }

  /**
   * The opening explorer for the position on the analysis board (I3, WP 8.2). Counts of games, never
   * a verdict; still, it goes through the same gate as the engine (a game in progress, the owner's own
   * review first). A cached answer is shown at once; a new one is asked for at Lichess's pace.
   */
  private async sendExplorerView() {
    if (!this.settings.get<boolean>('explorer.show')) return this.broadcast({ type: 'explorer', view: null });
    const s = this.session.state;
    const fen = s.tree.nodes[s.focus]!.fen;
    const source = this.settings.get<ExplorerSource>('explorer.source');
    const seq = ++this.explorerSeq;
    const send = (v: Omit<ExplorerView, 'source' | 'fen'>) => {
      if (seq === this.explorerSeq) this.broadcast({ type: 'explorer', view: { source, fen, ...v } });
    };
    const stop = this.blocked();
    if (stop) return send({ about: '', state: 'off', note: stop });
    if (source === 'mine') {
      const you = s.orientation;
      const index = this.myGamesIndex();
      const table = myGamesTable(index, fen, you) ?? undefined;
      const turn = mustPosition(fen).turn;
      const about = `Your games as ${you === 'white' ? 'White' : 'Black'}`;
      if (!index.games) return send({ about, state: 'none', note: 'No games of yours yet: add your names on the My games tab.', you, yourMove: turn === you });
      if (!table?.games) return send({ about, state: 'none', note: 'None of your games reached this position.', you, yourMove: turn === you });
      return send({ about, state: 'ready', table, you, yourMove: turn === you });
    }
    const q = this.explorerQuery(source, fen);
    const about = source === 'masters' ? 'Masters’ games (over the board, 2200 and up)' : `Lichess games, players ${bucketsText(q.ratings)}, ${speedsText(q.speeds)}`;
    if (!explorerCovers(fen)) return send({ about, state: 'none', note: `The explorer is for the opening: it is not asked past move ${EXPLORER_LAST_MOVE}.` });
    const kept = this.explorer.cached(q);
    if (kept) {
      const table = readExplorer(fen, kept);
      return send(table?.games ? { about, state: 'ready', table } : { about, state: 'none', note: 'No games reached this position.' });
    }
    send({ about, state: 'loading' });
    const r = await this.explorer.ask(q);
    if (seq !== this.explorerSeq) return;
    if (r.ok) {
      const table = readExplorer(fen, r.raw);
      return send(table?.games ? { about, state: 'ready', table } : { about, state: 'none', note: 'No games reached this position.' });
    }
    if (r.why === 'superseded') return;
    const why = FAILURE_TEXT[r.why];
    // Lichess cannot be asked: Maia's guess of what players at the owner's level play stands in (D6)
    if (source === 'level' && this.settings.get<boolean>('explorer.maiaStandIn')) {
      const guess = await this.maiaGuess(fen);
      if (guess) return send({ about: `Maia's guess for players rated about ${guess.elo}`, state: 'ready', table: guess.table, note: `${why} Shown instead: Maia's guess of what players at your level play; no games are counted.` });
    }
    send({ about, state: 'none', note: why });
  }

  private hello(client: Client) {
    client.send({ type: 'app', mode: this.mode });
    client.send({ type: 'settings', settings: this.settings.all(), presets: PRESETS });
    client.send({ type: 'state', state: this.session.state });
    client.send({ type: 'thread', messages: this.session.thread });
    client.send({ type: 'coach_status', status: this.coach.status });
    client.send({ type: 'game', game: this.play.game });
    client.send({ type: 'bots', view: this.play.botsView() });
    client.send({ type: 'library', view: this.library.view() });
    client.send({ type: 'puzzle', view: this.puzzles.view });
    client.send({ type: 'safety', view: this.safety.view });
    client.send({ type: 'threat', view: this.threat.view });
    client.send({ type: 'convert', view: this.convert.view });
    client.send({ type: 'opening', view: this.openings.view });
    client.send({ type: 'repstats', view: this.repStats() });
    client.send({ type: 'repbrowser', view: this.repBrowser() });
    if (this.system.view && this.settings.get<boolean>('display.systemStats')) client.send({ type: 'system', view: this.system.view });
    client.send({ type: 'endgame', view: this.endgames.view });
    client.send({ type: 'speed', view: this.speed.view });
    client.send({ type: 'studies', view: this.studies.view() });
    client.send({ type: 'review', view: this.review });
    void this.sendEngineView();
    void this.sendExplorerView();
    void this.refreshInsight();
  }

  private setMode(mode: AppMode) {
    if (mode !== 'analysis' && mode !== 'play' && mode !== 'games' && mode !== 'puzzles' && mode !== 'openings' && mode !== 'endgames') return;
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    this.db.saveSession('app', JSON.stringify({ mode }));
    this.db.logEvent('mode', { mode });
    this.broadcast({ type: 'app', mode });
    // into or out of the Puzzles tab: the coach that is on becomes the drill coach, or stops being it
    if (this.coach.isOn && !this.replay && AGENT_FOR[was] !== AGENT_FOR[mode]) this.coach.restart();
    // opening the puzzles puts the next one on its board
    if (mode === 'puzzles') void this.puzzles.open();
    if (mode === 'endgames') this.endgames.refresh();
    // the Openings tab: its cards made again from what is live, and its repertoires to walk
    if (mode === 'openings') {
      this.openings.sync();
      this.sendRepBrowser();
    }
    if (mode === 'play') {
      this.botSource.warm?.(); // load Maia now, so the first move does not wait for it
      this.broadcastBots();
    }
  }

  /** One message from the page. */
  async onClientMessage(client: Client, msg: ClientMsg): Promise<void> {
    const s = this.session;
    // a replay belongs to the game it was started on: anything else on the board ends it
    if (this.replay && s.state.game?.id !== this.replay.gameId) this.endReplay();
    switch (msg.type) {
      case 'hello':
        return this.hello(client);
      case 'move': {
        if (s.state.layer === 'demo') return void this.ownerMovesOnDemo(client, msg.from, msg.to, msg.promotion);
        const r = s.move(msg.from, msg.to, msg.promotion);
        if (!r.ok) return client.send({ type: 'toast', level: 'error', text: r.reason });
        return void this.afterBoardChange('move');
      }
      case 'nav':
        if (s.nav(msg.to)) this.resetLadder();
        return;
      case 'shapes':
        return s.setOwnerShapes(
          msg.shapes
            .filter((x) => validSquare(x.from) && (x.to === undefined || validSquare(x.to)))
            .map((x) => ({ from: x.from, to: x.to === x.from ? undefined : x.to, style: 'owner' as const, color: DRAWING_COLORS.includes(x.color as DrawingColor) ? x.color : ('green' as const) })),
          { keep: this.settings.get<boolean>('display.keepDrawings') },
        );
      case 'load': {
        const stop = this.blockedLoad(String(msg.text ?? ''));
        if (stop) return client.send({ type: 'toast', level: 'error', text: stop });
        this.studies.close();
        const r = s.load(msg.text);
        if (!r.ok) return client.send({ type: 'toast', level: 'error', text: r.reason });
        this.resetLadder();
        return client.send({ type: 'toast', level: 'info', text: 'Loaded.' });
      }
      case 'setup': {
        const stop = this.blockedLoad(String(msg.fen ?? ''));
        if (stop) return client.send({ type: 'toast', level: 'error', text: stop });
        this.studies.close();
        const r = s.setup(String(msg.fen ?? ''));
        if (!r.ok) return client.send({ type: 'toast', level: 'error', text: r.reason });
        this.resetLadder();
        return client.send({ type: 'toast', level: 'info', text: 'Position set up.' });
      }
      case 'new':
        this.studies.close();
        s.reset('start');
        return this.resetLadder();
      case 'study':
        return this.onStudyMessage(client, msg);
      case 'content':
        return this.onContentMessage(client, msg);
      case 'reset':
        s.reset(msg.to === 'root' ? 'root' : 'start');
        this.resetLadder();
        return client.send({ type: 'toast', level: 'info', text: msg.to === 'root' ? 'Moves cleared: back to the first position.' : 'Board reset to the starting position.' });
      case 'flip':
        s.flip();
        return this.resetLadder();
      case 'delete':
        return s.delete(msg.node);
      case 'promote':
        return s.promote(msg.node);
      case 'demo':
        if (msg.action === 'close') return s.closeDemo();
        if (msg.action === 'goto') return s.demoGoto(msg.line, msg.ply);
        if (msg.action === 'adopt') {
          if (!s.adoptDemoLine(msg.line)) client.send({ type: 'toast', level: 'error', text: 'That line does not start from a position on your board.' });
          else this.resetLadder();
        }
        return;
      case 'export':
        return client.send({ type: 'pgn', text: s.pgn() });
      case 'clear_thread':
        s.clearThread();
        return this.broadcast({ type: 'thread', messages: [] });
      case 'setting': {
        const r = this.settings.set(msg.key, msg.value);
        if (!r.ok) client.send({ type: 'toast', level: 'error', text: r.reason });
        return;
      }
      case 'preset': {
        const r = this.settings.applyPreset(msg.id);
        if (!r.ok) return client.send({ type: 'toast', level: 'error', text: r.reason });
        const name = PRESETS.find((p) => p.id === msg.id)?.name ?? msg.id;
        return client.send({ type: 'toast', level: 'info', text: r.changed.length ? `"${name}" applied (${r.changed.length} ${r.changed.length === 1 ? 'setting' : 'settings'} changed).` : `"${name}" was already in effect.` });
      }
      case 'settings_reset': {
        const changed = this.settings.resetAll(msg.group);
        return client.send({ type: 'toast', level: 'info', text: changed.length ? `${changed.length} ${changed.length === 1 ? 'setting' : 'settings'} back to the default.` : 'Everything there is already at its default.' });
      }
      case 'label_all':
        return void this.labelAll(client).catch((e) => this.log(`labelling failed: ${(e as Error).message}`));
      case 'mode':
        return this.setMode(msg.mode);
      case 'game':
        return this.onGameMessage(client, msg);
      case 'puzzle': {
        const p = this.puzzles;
        const tell = (r: { ok: true } | { ok: false; reason: string }) => {
          if (!r.ok) client.send({ type: 'toast', level: 'error', text: r.reason });
        };
        switch (msg.action) {
          case 'start':
            return tell(p.start(msg.id));
          case 'move':
            return tell(p.move(msg.from, msg.to, msg.promotion));
          case 'hint':
            return p.hint();
          case 'example':
            return p.example();
          case 'ask_coach':
            return this.askDrillCoach(client);
          case 'woodpecker_round':
            return tell(p.woodpeckerRound());
          case 'woodpecker_new':
            return tell(p.woodpeckerNew());
          case 'show':
            return p.showAnswer();
          case 'retry':
            return tell(await p.retry());
          case 'next': {
            const r = await p.next();
            // with the owner's games, the view says when nothing is waiting; a themed set says it here
            if (!r.ok && p.view.status !== 'idle') tell(r);
            return;
          }
          case 'set': {
            // the opening drill has a coach of its own: into or out of it, the coach that is on changes
            const wasOpening = this.openingSet();
            const r = await p.choose(msg.set);
            if (this.coach.isOn && !this.replay && wasOpening !== this.openingSet()) this.coach.restart();
            if (msg.set.kind === 'safety') return void this.safety.next();
            if (msg.set.kind === 'threat') return void this.threat.next();
            if (msg.set.kind === 'convert') return void this.convert.next();
            if (msg.set.kind === 'openings') return void this.openings.next();
            if (msg.set.kind === 'streak' || msg.set.kind === 'timed') return void (await this.speed.start(msg.set.kind));
            return tell(r);
          }
          case 'close':
            return p.close();
        }
        return;
      }
      case 'speed':
        if (msg.action === 'start') return void (await this.speed.start(msg.mode === 'timed' ? 'timed' : 'streak'));
        if (msg.action === 'stop') return this.speed.stop();
        if (msg.action === 'close') return this.speed.close();
        if (msg.action === 'move' && typeof msg.from === 'string' && typeof msg.to === 'string') return this.speed.move(msg.from, msg.to, msg.promotion);
        return;
      case 'endgame': {
        const e = this.endgames;
        const tell = (r: { ok: true } | { ok: false; reason: string }) => (r.ok ? undefined : client.send({ type: 'toast', level: 'info', text: r.reason }));
        if (msg.action === 'next') return tell(e.next());
        if (msg.action === 'start' && typeof msg.id === 'number') return tell(e.start(msg.id));
        if (msg.action === 'retry') return e.retry();
        if (msg.action === 'retry_before') return e.retryBefore();
        if (msg.action === 'random' && (msg.kind === 'queen' || msg.kind === 'rook' || msg.kind === 'two-rooks')) return void e.startRandom(msg.kind).then(tell);
        if (msg.action === 'ask') return void this.askEndgameCoach(client);
        if (msg.action === 'close') return e.close();
        if (msg.action === 'resign') return e.resign();
        if (msg.action === 'idea') return e.idea();
        if (msg.action === 'move' && typeof msg.from === 'string' && typeof msg.to === 'string') return void e.move(msg.from, msg.to, msg.promotion);
        return;
      }
      case 'repgame':
        if (msg.action === 'add') return void this.addFromGame(client);
        return;
      case 'opening':
        if (msg.action === 'next') return void this.openings.next();
        if (msg.action === 'close') return this.openings.close();
        if (msg.action === 'move' && typeof msg.from === 'string' && typeof msg.to === 'string') return this.openings.move(msg.from, msg.to, msg.promotion);
        if (msg.action === 'why') return this.openings.why(String(msg.text ?? ''));
        if (msg.action === 'why_known') return this.openings.whyKnown(msg.known === true);
        if (msg.action === 'scope') return this.openings.setScope(typeof msg.repertoire === 'number' ? msg.repertoire : null, Array.isArray(msg.chapters) ? msg.chapters.map(String) : undefined);
        if (msg.action === 'walk') {
          this.openingWalk = typeof msg.repertoire === 'number' ? { repertoire: msg.repertoire, moves: Array.isArray(msg.moves) ? msg.moves.map(String).slice(0, 80) : [] } : null;
          return;
        }
        return;
      case 'convert':
        if (msg.action === 'next') return void this.convert.next();
        if (msg.action === 'close') return this.convert.close();
        if (msg.action === 'resign') return this.convert.resign();
        if (msg.action === 'retry_start') return this.convert.retryStart();
        if (msg.action === 'retry_before') return this.convert.retryBefore();
        if (msg.action === 'move' && typeof msg.from === 'string' && typeof msg.to === 'string') return this.convert.move(msg.from, msg.to, msg.promotion);
        return;
      case 'threat':
        if (msg.action === 'next') return void this.threat.next();
        if (msg.action === 'close') return this.threat.close();
        if (msg.action === 'hint') return this.threat.hint();
        if (msg.action === 'show') return this.threat.show();
        if (msg.action === 'try' && typeof msg.from === 'string' && typeof msg.to === 'string') return this.threat.try(msg.from, msg.to, msg.promotion);
        return;
      case 'safety':
        if (msg.action === 'next') return void this.safety.next();
        if (msg.action === 'close') return this.safety.close();
        if (msg.action === 'listed') return this.safety.listed();
        if (msg.action === 'try') return typeof msg.from === 'string' && typeof msg.to === 'string' ? this.safety.try(msg.from, msg.to) : undefined;
        if (msg.action !== 'answer') return;
        return this.safety.answer({ safe: typeof msg.safe === 'boolean' ? msg.safe : undefined, pick: typeof msg.pick === 'string' ? msg.pick : undefined });
      case 'own_review':
        return this.onOwnReview(client, msg);
      case 'replay':
        return this.onReplay(client, msg);
      case 'review_tag':
      case 'review_note':
        return this.onReportEdit(client, msg);
      case 'library':
        return this.onLibraryMessage(client, msg).catch((e) => client.send({ type: 'toast', level: 'error', text: (e as Error).message }));
      case 'coach':
        if (msg.action === 'start') this.coach.start();
        else this.coach.stop('owner');
        return;
      case 'ask':
        return void this.ownerAsked(msg.text);
      case 'chip':
        return void this.ownerChip(msg.chip);
    }
  }

  // ------------------------------------------------------------ the owner's games, and fair play

  private libraryChanged() {
    this.myGames = null; // the explorer's "my games" counts again when next asked
    this.sendRepStats();
    this.level = null;
    this.session.setNotice(this.library.notice());
    this.broadcast({ type: 'library', view: this.library.view() });
    // the list of games in progress may have changed what the engine may speak about
    void this.refreshInsight();
    void this.sendEngineView();
    if (this.settings.get<string>('explorer.source') === 'mine') void this.sendExplorerView();
  }

  private async onLibraryMessage(client: Client, msg: Extract<ClientMsg, { type: 'library' }>) {
    const say = (text: string, level: 'info' | 'error' = 'info') => client.send({ type: 'toast', level, text });
    switch (msg.action) {
      case 'sync': {
        const r = await this.library.sync();
        const fresh = r.added.lichess + r.added.chesscom > 0 && this.settings.get<boolean>('review.ownFirst');
        return say(fresh ? `${r.text} Open one and go through it yourself first: the engine waits for you.` : r.text, r.problems.length ? 'error' : 'info');
      }
      case 'import': {
        const r = await this.library.importText(String(msg.text ?? ''));
        if (!r.ok) return say(r.reason, 'error');
        say(r.text);
        // one game was asked for: it goes straight onto the board
        if (r.id !== undefined) this.openGame(client, r.id);
        return;
      }
      case 'open':
        return this.openGame(client, Number(msg.id));
      case 'remove':
        if (this.db.deleteGame(Number(msg.id))) {
          this.libraryChanged();
          this.puzzles.refresh();
          this.safety.refresh();
          this.threat.refresh();
          this.convert.refresh();
        }
        return;
      case 'analyse':
        return this.reviewGame(client, true);
    }
  }

  /** Studies (WP 8.1): import, open a chapter on the board, save the board back, add it as a chapter, remove, export. */
  private async onStudyMessage(client: Client, msg: Extract<ClientMsg, { type: 'study' }>) {
    const say = (text: string, level: 'info' | 'error' = 'info') => client.send({ type: 'toast', level, text });
    const st = this.studies;
    switch (msg.action) {
      case 'import': {
        const r = await st.importText(String(msg.text ?? ''));
        if (!r.ok) return say(r.reason, 'error');
        return say(`Study added: ${r.chapters} ${r.chapters === 1 ? 'chapter' : 'chapters'}${r.skipped.length ? `; ${r.skipped.length} could not be read (${r.skipped[0]})` : ''}.`);
      }
      case 'open': {
        const c = st.open(Number(msg.chapter));
        if (!c) return say('That chapter is not here any more.', 'error');
        const stop = this.blockedLoad(c.pgn);
        if (stop) {
          st.close();
          return say(stop, 'error');
        }
        const r = this.session.load(c.pgn);
        if (!r.ok) {
          st.close();
          return say(r.reason, 'error');
        }
        if (this.session.state.orientation !== c.orientation) this.session.flip();
        this.resetLadder();
        this.endReplay();
        this.setMode('analysis');
        return;
      }
      case 'save':
        return st.saveOpen(this.session.pgn()) ? say('Saved to the chapter.') : say('No chapter is open on the board: add it as a new chapter instead.', 'error');
      case 'add': {
        st.add(this.session.pgn(), this.session.state.orientation, String(msg.name ?? ''), typeof msg.study === 'number' ? msg.study : undefined);
        return say('The board is saved as a chapter.');
      }
      case 'remove':
        if (!st.remove(Number(msg.study))) say('That study is not here any more.', 'error');
        return;
      case 'export': {
        const text = st.export(Number(msg.study));
        if (!text) return say('That study is not here any more.', 'error');
        return client.send({ type: 'pgn', text });
      }
    }
  }

  private sendDesk() {
    this.deskSent = Date.now();
    // what the owner approved (or dropped) changes the opening cards, and how the games stand against the repertoire
    if (!this.building) {
      this.openings.sync();
      this.sendRepBrowser();
      this.repGraphs = null;
      this.repGameLater();
      this.sendRepStats();
    }
    this.broadcast({ type: 'content', view: this.desk.view() });
  }

  /** The review screen (J4, WP 8.4): the owner's decisions on content, each logged. */
  private async onContentMessage(client: Client, msg: Extract<ClientMsg, { type: 'content' }>) {
    const say = (text: string, level: 'info' | 'error' = 'info') => client.send({ type: 'toast', level, text });
    const d = this.desk;
    switch (msg.action) {
      case 'open':
        return client.send({ type: 'content', view: d.view() });
      case 'approve':
        if (!d.approve(Number(msg.id))) say('That item is not waiting for approval any more.', 'error');
        return this.sendDesk();
      case 'approve_all': {
        const n = d.approveAll(Number(msg.repertoire));
        say(n ? `${n} ${n === 1 ? 'line' : 'lines'} approved: ${n === 1 ? 'it is' : 'they are'} live.` : 'Nothing was waiting.');
        return this.sendDesk();
      }
      case 'drop':
        if (!d.drop(Number(msg.id))) say('That item is not here any more.', 'error');
        return this.sendDesk();
      case 'import': {
        // a repertoire from a PGN, a Lichess study or one of the owner's studies (D2): through every gate, in the background
        const colour = msg.colour === 'black' ? 'black' : 'white';
        if (this.building) return say('A repertoire is being checked already: wait for it to finish.', 'error');
        if (otherJob(this.db)) return say(`Another job is working on your content (${otherJob(this.db)}): wait for it to finish.`, 'error');
        let pgn: string;
        let source: string;
        let licence: 'own' | 'private';
        let name = String(msg.name ?? '').trim();
        if (typeof msg.study === 'number') {
          const study = this.studies.view().studies.find((x) => x.id === msg.study);
          if (!study) return say('That study is not here any more.', 'error');
          pgn = this.studies.export(study.id) ?? '';
          source = `study:${study.id}`;
          licence = study.source === 'own' ? 'own' : 'private';
          name ||= study.name;
        } else {
          const text = String(msg.text ?? '').trim();
          if (!text) return say('Paste a PGN or a Lichess study link first.', 'error');
          const link = lichessStudyId(text);
          if (!link && /^https?:\/\//i.test(text)) return say('That is not a link to a Lichess study (https://lichess.org/study/ and eight letters or digits).', 'error');
          if (link) {
            try {
              pgn = await lichessStudyPgn(this.sites, link, this.lichessToken());
            } catch (e) {
              return say((e as Error).message, 'error');
            }
            source = `https://lichess.org/study/${link}`;
          } else {
            pgn = text;
            source = `pasted:${new Date().toISOString().slice(0, 10)}`;
          }
          licence = 'private'; // someone else's work, or the owner's: kept under data/ either way, never committed
          name ||= colour === 'white' ? 'My White repertoire' : 'My Black repertoire';
        }
        const read = repertoireLines(pgn, colour);
        if (!read.lines.length) return say(read.skipped.length ? `No lines for ${colour === 'white' ? 'White' : 'Black'} in it: ${read.skipped[0]!.chapter}: ${read.skipped[0]!.reason}.` : 'No moves found in it.', 'error');
        this.building = true;
        say(`Checking ${read.lines.length} ${read.lines.length === 1 ? 'line' : 'lines'} for ${colour === 'white' ? 'White' : 'Black'}: every one goes through the gates, which takes a few minutes. Follow it here.`);
        const band = this.library.profile().band?.band ?? '400–700';
        void this.repertoires
          .importPgn(pgn, { name, colour, source, licence, level: band })
          .then((r) => this.broadcast({ type: 'toast', level: 'info', text: `${r.name}: ${r.lines} ${r.lines === 1 ? "line" : "lines"}, ${r.quarantined} in quarantine${r.skipped.length ? `, ${r.skipped.length} ${r.skipped.length === 1 ? 'chapter' : 'chapters'} left out` : ''}${r.duplicates ? `, ${r.duplicates} ${r.duplicates === 1 ? 'line' : 'lines'} already held by another` : ''}.` }))
          .catch((e: Error) => this.broadcast({ type: 'toast', level: 'error', text: `The repertoire could not be checked: ${e.message}` }))
          .finally(() => {
            this.building = false;
            this.sendDesk();
          });
        return this.sendDesk();
      }
      case 'build': {
        // a starter repertoire around the seed lines (D1): long engine work and paced explorer calls, so it runs in the background
        const colour = msg.colour === 'black' ? 'black' : 'white';
        if (this.building) return say('A repertoire is being checked already: wait for it to finish.', 'error');
        if (otherJob(this.db)) return say(`Another job is working on your content (${otherJob(this.db)}): wait for it to finish.`, 'error');
        this.building = true;
        say(`Building a starter repertoire for ${colour === 'white' ? 'White' : 'Black'}: this takes a few minutes. Its lines go through every gate and wait for your approval here.`);
        const band = this.library.profile().band?.band ?? '400–700';
        void this.repertoires
          .buildStarter({ colour, seeds: this.settings.get<string>(colour === 'white' ? 'repertoire.seedWhite' : 'repertoire.seedBlack'), name: `Starter for ${colour === 'white' ? 'White' : 'Black'}`, minReach: this.settings.get<number>('repertoire.minReach'), level: band })
          .then((r) => this.broadcast({ type: 'toast', level: 'info', text: `${r.name}: ${r.lines} ${r.lines === 1 ? "line" : "lines"}, ${r.quarantined} in quarantine. Look them over under Review content.` }))
          .catch((e: Error) => this.broadcast({ type: 'toast', level: 'error', text: `The starter repertoire could not be built: ${e.message}` }))
          .finally(() => {
            this.building = false;
            this.sendDesk();
          });
        return this.sendDesk();
      }
      case 'build_outline': {
        // a repertoire from the book around an outline (D10, WP 8.12): hours the first time, in the background
        if (this.building) return say('A repertoire is being checked already: wait for it to finish.', 'error');
        const busy = otherJob(this.db);
        if (busy) return say(`Another job is working on your content (${busy}): wait for it to finish.`, 'error');
        const entry = outlineFiles(this.outlinesDir).find((o) => o.id === msg.outline);
        if (!entry) return say('That outline is not here any more.', 'error');
        if (!entry.outline) return say(`${entry.name} cannot be built: ${entry.problems[0]}`, 'error');
        const plan = await this.power.plan(this.settings.get<BatteryPolicy>('engine.onBattery'), 'building a repertoire from the book');
        // a lighter search would build different lines: a build runs at full strength or waits
        if (!plan.run || (plan.onBattery && !plan.deep)) return say('The laptop is on battery: plug it in to build a repertoire (hours of engine work, and a lighter search would build different lines).', 'error');
        this.building = true;
        this.buildStop = false;
        this.db.syncSet('content.job', { pid: process.pid, what: `building ${entry.id}` });
        say(`Building "${entry.name}" from the masters' games: hours the first time (each position is asked of Lichess at its pace, and the engine checks every move of yours). Follow it here. Stopped, it saves nothing; built again, it picks up where it was.`);
        const outline = entry.outline;
        void this.repertoires
          .buildFromOutline(outline, { ...bookRules(this.settings), hash: entry.hash, level: this.library.profile().band?.band ?? '400–700', wait: async () => (this.buildStop ? 'stop' : 'go') })
          .then((r) =>
            this.broadcast(
              r.stopped
                ? { type: 'toast', level: 'info', text: `The build of "${outline.name}" was stopped: nothing was saved.` }
                : { type: 'toast', level: 'info', text: `${r.report.name}: ${r.report.lines} lines, ${r.report.quarantined} in quarantine, ${r.report.verified} waiting for your approval. Look them over chapter by chapter under Review content.` },
            ),
          )
          .catch((e: Error) => this.broadcast({ type: 'toast', level: 'error', text: `The repertoire could not be built: ${e.message}` }))
          .finally(() => {
            this.building = false;
            this.db.syncSet('content.job', { pid: 0, what: '' });
            this.sendDesk();
          });
        return this.sendDesk();
      }
      case 'stop_build':
        if (!this.building) return say('Nothing is being built.', 'error');
        this.buildStop = true;
        return say('The build stops once the positions it is working on are done.');
      case 'approve_chapter': {
        const n = d.approveChapter(Number(msg.repertoire), String(msg.chapter ?? ''));
        say(n ? `${n} ${n === 1 ? 'line' : 'lines'} of "${msg.chapter}" approved: live.` : 'Nothing in that chapter was waiting.');
        return this.sendDesk();
      }
      case 'remove_repertoire': {
        if (this.building) return say('A repertoire is being checked: wait for it to finish.', 'error');
        const r = d.removeRepertoire(Number(msg.repertoire));
        if (!r.ok) return say(r.reason, 'error');
        say(`Removed: ${r.lines} ${r.lines === 1 ? 'line' : 'lines'} and ${r.cards} drill ${r.cards === 1 ? 'card' : 'cards'}. The log keeps what it was.`);
        this.repGraphs = null;
        return this.sendDesk();
      }
      case 'accept': {
        const r = d.accept(Number(msg.id), String(msg.note ?? ''));
        if (!r.ok) say(r.reason, 'error');
        return this.sendDesk();
      }
      case 'show': {
        // a repertoire line on the board, at the move that failed: the owner can try another move there
        const failing = d.failingLine(Number(msg.id));
        const fen = failing ? failing.line.startFen : d.puzzleStart(Number(msg.id));
        if (!fen) return say('That item is not here any more.', 'error');
        const moves = failing ? failing.line.moves.slice(0, failing.at) : [];
        const head = fen === START_FEN ? '' : `[SetUp "1"]\n[FEN "${fen}"]\n\n`;
        const text = `${head}${moves.length ? lineText(fen, moves) : ''}`.trim() || fen;
        const stop = this.blockedLoad(text);
        if (stop) return say(stop, 'error');
        this.studies.close();
        const r = this.session.load(text);
        if (!r.ok) return say(r.reason, 'error');
        this.session.nav('end');
        const side = failing ? failing.line.colour : mustPosition(fen).turn;
        if (this.session.state.orientation !== side) this.session.flip();
        this.resetLadder();
        this.endReplay();
        this.setMode('analysis');
        if (failing?.failed) say(`On the board: the position before ${lineText(fen, failing.line.moves, failing.at + 1).split(' ').at(-1)}. Play another move there, then press "Use the board's moves" on the review screen.`);
        return;
      }
      case 'fix': {
        const s = this.session.state;
        const rootFen = s.tree.nodes[s.tree.root]!.fen;
        const failing = d.failingLine(Number(msg.id));
        if (!failing) return say('That line is not here any more.', 'error');
        if (rootFen.split(' ').slice(0, 4).join(' ') !== failing.line.startFen.split(' ').slice(0, 4).join(' ')) return say('The board does not start where this line starts: show the line on the board first.', 'error');
        say('Checking the new line: the gates run again…');
        const r = await this.repertoires.fixLine(Number(msg.id), movesTo(s.tree, s.focus));
        if (!r.ok) return say(r.reason, 'error');
        const still = r.report.quarantine.find((q) => q.line === lineText(failing.line.startFen, movesTo(s.tree, s.focus)));
        say(still ? `The new line is still in quarantine: ${still.reasons[0]}` : 'The new line passed its gates: it waits for your approval.', still ? 'error' : 'info');
        return this.sendDesk();
      }
    }
  }

  /** The live repertoires as positions: one graph per repertoire (a side can have several, WP 8.15). */
  private graphs(): RepGraph[] {
    if (this.repGraphs) return this.repGraphs;
    const out: RepGraph[] = [];
    for (const r of this.db.repertoires()) {
      const lines = this.db.repertoireItems<RepLine>(r.id).filter((l) => l.status === 'live').map((l) => l.body);
      if (lines.length) out.push(repertoireGraph(r.colour, lines, { repertoire: r.id, name: r.name }));
    }
    return (this.repGraphs = out);
  }

  /** A game's moves from the start (cached), or null for a game from a set-up position. */
  private sansOf(id: number, pgn: string): string[] | null {
    const hit = this.gameSans.get(id);
    if (hit) return hit;
    const r = importPgn(pgn);
    if (!r.ok || r.tree.nodes[r.tree.root]!.fen !== START_FEN) return null;
    const sans = movesTo(r.tree, mainlineEnd(r.tree));
    this.gameSans.set(id, sans);
    return sans;
  }

  /**
   * The game on the board against the repertoire (B6, D5; WP 8.10): where it left and what to play
   * there next time. After a new move of theirs the engine's answer is given, unless the engine is
   * being kept quiet on this game (the owner's own review first, or fair play).
   */
  private async sendRepGame() {
    const game = this.session.state.game;
    const g = game ? this.db.getGame(game.id) : undefined;
    if (!game || !g || (g.you !== 'white' && g.you !== 'black')) return this.broadcast({ type: 'repgame', view: null });
    const sans = this.sansOf(g.id, g.pgn);
    // the repertoire the game stayed in longest, when the side has several
    const m = sans ? matchGame(this.graphs(), g.you, sans) : null;
    if (!m || !sans) return this.broadcast({ type: 'repgame', view: null });
    const { graph, deviation: d } = m;
    const view: RepGameView = { gameId: g.id, by: d.by, moveText: d.moveText, ply: d.ply, played: d.played?.san, inBook: d.inBook, line: d.line !== undefined ? lineText(graph.lines[d.line]!.startFen, graph.lines[d.line]!.moves) : undefined, repertoire: graph.name };
    if (d.by === 'you' && d.expected) {
      view.expected = d.expected.san;
      // its why, from that repertoire's words for the position and move
      const w = graph.repertoire !== undefined ? this.db.repTexts(graph.repertoire).get(positionKey(d.fenBefore)) : undefined;
      if (w?.uci === d.expected.uci && w.why) view.why = plainText(w.why);
    }
    if (d.by === 'them') {
      view.prepared = d.prepared;
      if (!this.blocked() && d.played) {
        const pos = mustPosition(d.fenBefore);
        const after = describeMove(pos, uciToMove(pos, d.played.uci)!).fenAfter;
        try {
          const ev = await this.engine.analyse({ fen: after, nodes: this.settings.get<number>('engine.verdictNodes'), multipv: 1 });
          const best = ev.lines[0]?.pv[0];
          const p = mustPosition(after);
          const m = best ? uciToMove(p, best) : null;
          if (m) view.engineMove = describeMove(p, m).san;
        } catch {
          /* the engine is down: no suggestion */
        }
      }
    }
    if (this.session.state.game?.id === g.id) this.broadcast({ type: 'repgame', view });
  }

  /**
   * The game on the board left the repertoire with a new move of the opponent's: that line goes into the
   * repertoire it matched (WP 8.10): the moves to there, their move as played, then the engine's move
   * after it (the one the note shows). Every gate runs over it; it waits for the owner's approval.
   */
  private async addFromGame(client: Client) {
    const say = (text: string, level: 'info' | 'error' = 'info') => client.send({ type: 'toast', level, text });
    const game = this.session.state.game;
    const g = game ? this.db.getGame(game.id) : undefined;
    if (!g || (g.you !== 'white' && g.you !== 'black')) return say('Open one of your games first.', 'error');
    const stop = this.blocked();
    if (stop) return say(stop, 'error');
    const sans = this.sansOf(g.id, g.pgn);
    const m = sans ? matchGame(this.graphs(), g.you, sans) : null;
    const d = m?.deviation;
    if (!m || !sans || !d || d.by !== 'them' || !d.played || m.graph.repertoire === undefined) return say('This game did not leave your repertoire with a new move of theirs.', 'error');
    const pos = mustPosition(d.fenBefore);
    const after = describeMove(pos, uciToMove(pos, d.played.uci)!).fenAfter;
    let mine: string | undefined;
    try {
      const ev = await this.engine.analyse({ fen: after, nodes: this.settings.get<number>('engine.verdictNodes'), multipv: 1 });
      const p = mustPosition(after);
      const mv = ev.lines[0]?.pv[0] ? uciToMove(p, ev.lines[0].pv[0]) : null;
      mine = mv ? describeMove(p, mv).san : undefined;
    } catch {
      /* below */
    }
    if (!mine) return say('The engine is not answering, so the line cannot be made now.', 'error');
    const moves = [...sans.slice(0, d.ply), d.played.san, mine];
    const repId = m.graph.repertoire;
    const plan = this.db.repertoire(repId)?.plan as BookPlan | null | undefined;
    const outline = plan?.kind === 'book' ? outlineFiles(this.outlinesDir).find((o) => o.id === plan.outline.id)?.outline : undefined;
    const chapter = outline ? chapterOf({ repertoire: repId, colour: g.you, startFen: START_FEN, moves }, outline, (fens) => this.book.lookup(fens)?.name).name : undefined;
    say(`Checking ${lineText(START_FEN, moves)} with every gate…`);
    const r = await this.repertoires.addLine(repId, moves, { game: g.id, chapter });
    if (!r.ok) return say(r.reason, 'error');
    this.repGraphs = null;
    this.sendDesk();
    void this.sendRepGame();
    if (r.status === 'quarantined') say(`Added, but held back: ${r.reasons[0] ?? 'a gate failed'}. It is under Game → Review content…, in quarantine.`, 'error');
    else say(`Added: ${lineText(START_FEN, moves)} waits for your approval under Game → Review content….`);
  }

  /** The owner's results per repertoire line (G3, D7), over every game in the library. */
  private repStats(): RepStatsView | null {
    const graphs = this.graphs();
    if (!graphs.some((g) => g.lines.length)) return null;
    const games: GameForRep[] = [];
    for (const g of this.db.explorerGames()) {
      const sans = this.sansOf(g.id, g.pgn);
      if (!sans) continue;
      games.push({ id: g.id, you: g.you, result: g.result === '1-0' || g.result === '0-1' || g.result === '1/2-1/2' ? g.result : '*', sans });
    }
    const r = lineResults(graphs, games);
    const all = [...r.deviations.values()];
    return { lines: r.lines, games: all.filter((d) => d.by !== 'outside').length, leftByYou: all.filter((d) => d.by === 'you').length, leftByThem: all.filter((d) => d.by === 'them').length, prepRanOut: all.filter((d) => d.by === 'end').length };
  }

  private sendRepStats() {
    this.broadcast({ type: 'repstats', view: this.repStats() });
  }

  /** Put one of the owner's finished games on the analysis board, their side facing them. */
  private openGame(client: Client, id: number) {
    this.studies.close();
    const g = this.db.getGame(id);
    if (!g) return client.send({ type: 'toast', level: 'error', text: 'That game is not here any more.' });
    const r = this.session.load(g.pgn, { orientation: g.you ?? 'white', game: { id: g.id, white: g.white, black: g.black, result: g.result, you: g.you } });
    if (!r.ok) return client.send({ type: 'toast', level: 'error', text: r.reason });
    this.db.logEvent('open_game', { id });
    this.resetLadder();
    this.setMode('analysis');
    this.endReplay();
    const before = this.db.getSelfReview(id);
    this.own = !before && this.settings.get<boolean>('review.ownFirst') ? { gameId: id, marks: [] } : null;
    this.setReview(this.own ? { gameId: id, status: 'skipped', own: { state: 'pending', marks: [], notes: '' }, moments: [] } : null);
    if (this.settings.get<boolean>('review.auto')) void this.reviewGame(client, false);
    else void this.refreshInsight();
  }

  /** Is the owner still going through the game on the board themselves? Then the engine's findings wait. */
  /** The owner's motifs from their puzzle attempts (G7), the most practised first. */
  private motifs(): MotifMastery[] {
    return motifMastery(this.db.motifHistory(), NOT_A_THEME);
  }

  private ownPending(): boolean {
    return !!this.own && this.session.state.game?.id === this.own.gameId;
  }

  private ownView(): ReviewView['own'] {
    const id = this.session.state.game?.id;
    if (this.ownPending()) return { state: 'pending', marks: [...this.own!.marks], notes: '' };
    const saved = id === undefined ? undefined : this.db.getSelfReview(id);
    return saved ? { state: saved.skipped ? 'skipped' : 'done', marks: saved.marks, notes: saved.notes } : undefined;
  }

  /** The owner's own review (feature B7): mark the moves they think mattered, then finish or skip. */
  private onOwnReview(client: Client, msg: Extract<ClientMsg, { type: 'own_review' }>) {
    const game = this.session.state.game;
    if (!game || !this.ownPending() || !this.own) return;
    const own = this.own;
    if (msg.action === 'mark') {
      const ply = Number(msg.ply);
      const moves = pathTo(this.session.state.tree, mainlineEnd(this.session.state.tree)).length - 1;
      if (!Number.isInteger(ply) || ply < 1 || ply > moves) return;
      own.marks = own.marks.includes(ply) ? own.marks.filter((p) => p !== ply) : [...own.marks, ply].sort((a, b) => a - b);
      if (this.review?.gameId === game.id) this.setReview({ ...this.review, own: { state: 'pending', marks: [...own.marks], notes: '' } });
      return;
    }
    const skipped = msg.action === 'skip';
    const notes = skipped ? '' : String(msg.notes ?? '').slice(0, 4000);
    this.db.saveSelfReview(game.id, { skipped, marks: skipped ? [] : own.marks, notes });
    this.db.logEvent('own_review', { game: game.id, skipped, marks: skipped ? 0 : own.marks.length, wrote: notes.length > 0 });
    const held = own.held;
    this.own = null;
    this.broadcast({ type: 'library', view: this.library.view() });
    // now the engine may speak: what it found while the owner was looking, or the search itself if it has not run
    if (held) this.showReview(game.id, held);
    else if (this.review?.gameId === game.id && this.review.status === 'running') this.setReview({ ...this.review, own: this.ownView() });
    else {
      this.setReview(null);
      void this.reviewGame(client, false);
    }
    void this.refreshInsight();
    void this.sendEngineView();
  }

  /** Put a finished analysis on the board and the page: labels and readings on the moves, the key moments in the list. */
  private showReview(gameId: number, result: GameAnalysis, remakePuzzles = false) {
    const s = this.session;
    if (s.state.game?.id !== gameId) return;
    const line = pathTo(s.state.tree, mainlineEnd(s.state.tree));
    // one the deeper search has already confirmed stays
    for (const ply of result.plies) {
      const node = line[ply.ply];
      if (!node || node.san !== ply.san) continue;
      const ev = result.evals[ply.ply];
      if (!node.gauge) {
        const gauge = gaugeOf(node.fen, ev?.lines[0], ev?.tbhits);
        if (gauge && (ev || mustPosition(node.fen).isEnd())) node.gauge = gauge;
      }
      if (ply.judged && node.judged?.sure !== true) node.judged = ply.judged;
    }
    s.touch();
    const written = this.makeReport(gameId, result.you);
    this.setReview({ gameId, status: 'done', own: this.ownView(), moments: this.withOwnerSteps(gameId, result.you, result.moments), numbers: result.numbers, chart: result.plies.map((p) => p.whiteWin ?? null), report: written?.report, ownerNote: written?.note });
    this.broadcast({ type: 'library', view: this.library.view() }); // the journal may have a new line
    void this.makePuzzles(gameId, result, remakePuzzles);
  }

  /**
   * The owner's slips in the game become puzzles (features C1, C2, C3). It runs once the engine's
   * view of the game is on the page, never while the owner is still going through the game
   * themselves. Each puzzle goes through the content gates; only what passes is played.
   */
  private async makePuzzles(gameId: number, result: GameAnalysis, remake: boolean) {
    if (!this.settings.get<boolean>('puzzles.fromGames')) return;
    const tell = (state: 'making' | 'done' | 'waiting', items: { id: number; status: string }[]) => {
      if (this.review?.gameId === gameId) this.setReview({ ...this.review, puzzles: { state, ids: items.filter((x) => x.status === 'live').map((x) => x.id) } });
    };
    const all = this.db.contentFromGame(gameId);
    const have = all.filter((x) => x.type === 'puzzle_game');
    const perGame = this.settings.get<number>('puzzles.perGame');
    // each kind is made when the game has none of it yet (a game gone through before the safety
    // checks existed still gets them), or again when the owner asks for the game to be analysed again
    const candidates = have.length && !remake ? [] : candidatesOf(result.plies, result.you, perGame);
    const slips = all.some((x) => x.type === 'safety') && !remake ? [] : safetySlips(result.plies, result.you, perGame);
    const threats = all.some((x) => x.type === 'threat') && !remake ? [] : threatSlips(result.plies, result.you, perGame);
    // a game the owner was clearly winning and did not win gives one win-the-won-game drill
    const game = this.db.getGame(gameId);
    const outcome = game ? outcomeOf({ result: game.result, you: result.you }) : undefined;
    const convert = !all.some((x) => x.type === 'convert') || remake ? conversionStart(result.plies, result.you, outcome) : null;
    if (!candidates.length && !slips.length && !threats.length && !convert) return tell('done', have);
    // the gates' search is real engine work, and a puzzle is studied many times: it is made in full or not yet
    const plan = await this.power.plan(this.settings.get<BatteryPolicy>('engine.onBattery'), 'making puzzles from the game');
    if (!plan.run || !plan.deep) return tell('waiting', have);
    const run = ++this.puzzleRun;
    tell('making', []);
    try {
      if (candidates.length) {
        const { made, skipped } = await this.puzzleMaker.fromGame(gameId, candidates, this.library.profile().band?.band ?? '400–700', () => run !== this.puzzleRun);
        this.db.logEvent('puzzles_made', { game: gameId, made: made.map((m) => ({ id: m.id, ply: Number(m.source.split('#')[1]), status: m.status, solution: m.body.solution })), skipped });
      }
      // and the safety checks: the slips that lost something, judged again by the engine
      if (slips.length && run === this.puzzleRun) {
        const checks = await this.safety.fromGame(gameId, slips);
        this.db.logEvent('safety_made', { game: gameId, ids: checks });
      }
      // and "what's the threat?": the slips where their threat went unanswered
      if (threats.length && run === this.puzzleRun) {
        const ids = await this.threat.fromGame(gameId, result.plies, threats);
        this.db.logEvent('threats_made', { game: gameId, ids });
      }
      if (convert && run === this.puzzleRun) {
        const ids = await this.convert.fromGame(gameId, result.plies, result.you, outcome);
        this.db.logEvent('convert_made', { game: gameId, ids });
      }
      tell('done', this.db.contentFromGame(gameId).filter((x) => x.type === 'puzzle_game'));
      this.puzzles.refresh();
    } catch (e) {
      // the app was stopped while the engine was still at work: nothing to say, and the database is closed
      if (this.stopped) return;
      this.log(`making puzzles failed: ${(e as Error).message}`);
      tell('done', have);
    }
  }

  /**
   * The written report of a game (features B10, G6): built by code from what the analysis stored
   * (the labels, the tag on each slip, how the replay went), kept in the database, and made again
   * whenever one of those changes.
   */
  private makeReport(gameId: number, you: Color): { report: ReviewReport; note: string } | undefined {
    const review = this.db.getReview(gameId);
    if (!review) return undefined;
    // how going through the moments went, if that was done: the newest finished replay of this game
    let replay: { found: number; total: number } | undefined;
    for (const row of this.db.recentEvents('replay_done', 40)) {
      const d = JSON.parse(row.data) as { game: number; log: { how: string }[] };
      if (d.game !== gameId) continue;
      replay = { found: d.log.filter((x) => x.how === 'found').length, total: d.log.length };
      break;
    }
    const before = this.db.takeawaysBefore(gameId);
    const report = buildReport({ numbers: review.numbers, slips: this.db.ownerSlips(gameId, you), replay, earlier: before.last, known: before.known });
    this.db.saveReport(gameId, report);
    return { report, note: this.db.getReport(gameId)?.note ?? '' };
  }

  /** The moments, with the owner's own word for the skipped step where they gave one. */
  private withOwnerSteps(gameId: number, you: Color, moments: Moment[]): Moment[] {
    const said = new Map(this.db.ownerSlips(gameId, you).filter((x) => x.stepBy).map((x) => [x.ply, x.step]));
    return moments.map((m) => (said.has(m.ply) ? { ...m, step: said.get(m.ply)!, stepName: STEP_NAME[said.get(m.ply)!], stepBy: 'owner' as const } : m));
  }

  /** The owner corrects a tag, or leaves a note for next time (feature H8): the report is made again. */
  private onReportEdit(client: Client, msg: Extract<ClientMsg, { type: 'review_tag' | 'review_note' }>) {
    const game = this.session.state.game;
    const review = this.review;
    if (!game || !review || review.gameId !== game.id || review.status !== 'done' || this.ownPending()) return;
    const you = this.db.getReview(game.id)?.you;
    if (!you) return;
    if (msg.type === 'review_note') {
      const note = String(msg.text ?? '').slice(0, 4000);
      if (this.db.setReportNote(game.id, note)) this.setReview({ ...review, ownerNote: note });
      return;
    }
    const step = String(msg.step) as SkippedStep;
    if (!(step in STEP_NAME) || !this.setOwnerTag(game.id, Number(msg.ply), step, 'chosen')) return void client.send({ type: 'toast', level: 'error', text: 'That move is not one of your slips in this game.' });
  }

  private setReview(view: ReviewView | null) {
    this.review = view;
    this.broadcast({ type: 'review', view });
    // the engine's answer after the opponent's new move waits, like the rest, for the owner's own review
    this.repGameLater();
  }

  /** The repertoire note, made in the background; a failure is logged, never left unhandled. */
  private repGameLater() {
    if (this.stopped) return;
    this.sendRepGame().catch((e: unknown) => {
      if (!this.stopped) this.log(`the repertoire note: ${(e as Error).message}`);
    });
  }

  /**
   * Have the engine go through the game on the board (features B3, B9): a label for every move
   * and the one to three moments worth going through, the first turning point first.
   */
  private async reviewGame(client: Client, asked: boolean) {
    const s = this.session;
    const game = s.state.game;
    const say = (text: string, level: 'info' | 'error' = 'info') => client.send({ type: 'toast', level, text });
    if (!game) return asked ? say('Open one of your games from My games first.', 'error') : undefined;
    if (this.labelling) {
      if (this.labellingGame === game.id) return asked ? say('The engine is already going through this game.') : undefined;
      // the analysis of a game that is no longer on the board is stopping: wait for it, then go through this one
      await this.labellingDone;
      if (s.state.game?.id !== game.id || this.labelling) return;
    }
    const tree = s.state.tree;
    const line = pathTo(tree, mainlineEnd(tree));
    const moves = line.slice(1).map((n) => n.san!);
    if (!moves.length) return;
    const run = ++this.reviewRun;
    const here = () => run === this.reviewRun && s.state.tree === tree && s.state.game?.id === game.id;
    let done!: () => void;
    this.labellingDone = new Promise<void>((resolve) => (done = resolve));
    this.labellingGame = game.id;
    this.labelling = true;
    try {
      // a whole game is real engine work: on battery the owner's setting decides (quick search, full, or wait)
      const plan = await this.power.plan(this.settings.get<BatteryPolicy>('engine.onBattery'), 'analysing the game');
      if (!here()) return;
      if (!plan.run) return this.setReview({ gameId: game.id, status: 'skipped', note: plan.note, own: this.ownView(), moments: [] });
      if (plan.note && asked) say(plan.note);
      this.setReview({ gameId: game.id, status: 'running', progress: { done: 0, total: line.length }, own: this.ownView(), moments: [] });
      const you = game.you ?? s.state.orientation;
      // a live game's clocks, for the "played too fast" tag: time left after each move, and the time the move took
      const tc = /^(\d+)(?:\+(\d+))?$/.exec(tree.headers?.TimeControl ?? '');
      const base = tc ? Number(tc[1]) : undefined;
      const inc = tc ? Number(tc[2] ?? 0) : 0;
      const clocks = line.slice(1).map((n, i) => {
        if (!base || n.clock === undefined) return undefined;
        const before = i >= 2 ? line[i - 1]!.clock : undefined; // the same side's clock after its move before this one
        return { left: n.clock, base, spent: before === undefined ? undefined : Math.max(0, before - n.clock + inc) };
      });
      let last = 0;
      const result = await this.analyser.analyse({
        rootFen: tree.rootFen,
        moves,
        you,
        nodes: plan.deep ? this.settings.get<number>('review.passNodes') : Math.min(this.settings.get<number>('review.passNodes'), this.facts.nodes),
        max: this.settings.get<number>('review.momentsPerGame'),
        confirm: plan.deep ? 12 : 4,
        clocks,
        // fair play: a position this game shares with one the owner is still playing is left alone
        skip: (i, fens) => !!this.library.guard(fens.slice(0, i + 1)),
        cancelled: () => !here(),
        onProgress: (done, total) => {
          if (!here() || Date.now() - last < 250) return;
          last = Date.now();
          this.setReview({ gameId: game.id, status: 'running', progress: { done, total }, own: this.ownView(), moments: [] });
        },
      });
      if (!result || !here()) return;
      this.db.saveReview(game.id, result);
      if (this.ownPending() && this.own) {
        // the owner is still looking for themselves (B7): the findings wait, and nothing of them goes to the page
        this.own.held = result;
        this.setReview({ gameId: game.id, status: 'done', own: this.ownView(), moments: [] });
      } else this.showReview(game.id, result, asked);
      this.db.logEvent('review', { game: game.id, moments: result.moments.map((m) => m.ply), numbers: result.numbers });
    } catch (e) {
      this.log(`game analysis failed: ${(e as Error).message}`);
      if (here()) this.setReview(null);
      if (asked) say('The engine could not go through the game. Check that it is running.', 'error');
    } finally {
      this.labelling = false;
      this.labellingGame = null;
      done();
    }
  }

  // ------------------------------------------------------------ going through the key moments with the coach (B4)

  private replayView(): ReviewView['replay'] {
    const r = this.replay;
    return r ? { index: r.index, total: r.moments.length, phase: r.phase, mode: r.mode } : undefined;
  }

  private pushReplay() {
    if (this.review) this.setReview({ ...this.review, replay: this.replayView() });
  }

  /** What the coach is told about the moment in hand with every event of a replay. */
  private replayContext(): Record<string, unknown> {
    const r = this.replay;
    const m = r?.moments[r.index];
    if (!r || !m) return {};
    return {
      moment: r.index + 1,
      of: r.moments.length,
      youPlayed: m.san,
      whatItCost: m.why,
      citeForWhatItCost: m.factId && this.facts.fact(m.factId) ? m.factId : null,
      skippedStep: m.step ?? 'unknown',
      phase: r.phase,
    };
  }

  private async onReplay(client: Client, msg: Extract<ClientMsg, { type: 'replay' }>) {
    const say = (text: string) => client.send({ type: 'toast', level: 'error', text });
    if (msg.action === 'stop') return this.endReplay();
    if (msg.action === 'start') {
      const game = this.session.state.game;
      const review = this.review;
      if (!game || !review || review.gameId !== game.id || review.status !== 'done' || !review.moments.length) return say('There are no key moments to go through yet.');
      const stop = this.blocked();
      if (stop) return say(stop);
      const coachWasOn = this.coach.isOn;
      this.replay = { gameId: game.id, moments: review.moments, index: 0, node: '', phase: 'asking', mode: 'ask', log: [] };
      if (coachWasOn) this.coach.restart(); // the review has its own agent
      this.db.logEvent('replay_start', { game: game.id, moments: review.moments.length });
      return this.replayMoment(0);
    }
    const r = this.replay;
    if (!r || r.phase === 'finished') return;
    if (r.phase === 'asking') this.closeMoment('skipped');
    if (r.index + 1 < r.moments.length) return this.replayMoment(r.index + 1);
    return this.finishReplay();
  }

  /** Put the position before a moment's mistake in front of the owner, and hand the moment to the coach. */
  private async replayMoment(index: number) {
    const r = this.replay;
    const s = this.session;
    const m = r?.moments[index];
    if (!r || !m) return;
    const line = pathTo(s.state.tree, mainlineEnd(s.state.tree));
    const before = line[m.ply - 1];
    // the game on the board must be the one that was analysed
    if (!before || line[m.ply]?.san !== m.san) return this.endReplay();
    if (s.state.layer === 'demo') s.closeDemo();
    s.nav(before.id);
    this.resetLadder();
    let packet: FactPacket;
    try {
      packet = await this.focusPacket(true);
    } catch {
      this.systemSay('The chess engine is not answering, so the review cannot go on right now.');
      return this.endReplay();
    }
    if (this.replay !== r) return;
    // ask, or show? Known before the owner has tried: the point is too deep, or the tactic is new to them (the stop rules)
    // a tactic is new to the owner when it has come up in neither an earlier replay nor their puzzles (G7)
    const seen = new Set([...this.db.seenMotifs(), ...this.motifs().map((x) => x.motif)]);
    const plan = replayPlan(m, { maxDepth: this.settings.get<number>('review.maxDepthMoves'), seen, workedWhenNew: this.settings.get<boolean>('review.workedExampleWhenNew') });
    r.index = index;
    r.node = before.id;
    r.mode = plan.mode;
    r.phase = plan.mode === 'worked' ? 'explained' : 'asking';
    if (plan.mode === 'ask') {
      // an open exercise: the best-move arrow is held back, and the owner's next move here is their answer
      this.ladder = { seq: s.state.seq, active: true, level: 0, misses: 0 };
      this.ladderMoved();
    } else r.log.push({ ply: m.ply, how: plan.because === 'deep' ? 'worked_deep' : 'worked_new', hints: 0, misses: 0 });
    const numbers = this.review?.numbers;
    // a review opens with one true thing that went well (the positive sandwich): counted, not composed
    const positive = index === 0 && numbers && numbers.strong > 0 ? `You played the engine's first choice, or a move just as good, on ${numbers.strong} of your ${numbers.moves} moves.` : undefined;
    const question = STEP_QUESTION[m.step ?? 'unknown'];
    const review = {
      ...this.replayContext(),
      firstTurningPoint: m.first,
      askFirst: question,
      mode: plan.mode === 'ask' ? 'ask' : 'worked example',
      because: plan.mode === 'worked' ? (plan.because === 'deep' ? 'the point is too deep to ask the owner to find' : 'this tactic has not come up in a review before') : null,
      openWith: positive ?? null,
    };
    const ev: CoachEvent = {
      seq: s.state.seq,
      kind: 'review_moment',
      payload: this.payload('review_moment', packet, { review, youMayGiveTheMove: plan.mode === 'worked' }),
      needsReply: true,
      canAnswer: plan.mode === 'worked',
      scripted:
        plan.mode === 'ask'
          ? { kind: 'question', text: `${positive ? `${positive} ` : ''}In the game you played ${tok.m(m.san)} here. ${question} Find a better move on the board.`, expect: 'move' }
          : { kind: 'explain', text: `In the game you played ${tok.m(m.san)} here: ${m.why}.`, claims: m.factId && this.facts.fact(m.factId) ? [m.factId] : [], thenShowBest: true },
    };
    this.db.logEvent('replay_moment', { game: r.gameId, ply: m.ply, step: m.step, motifs: m.motifs ?? [], mode: plan.mode, because: plan.mode === 'worked' ? plan.because : undefined });
    this.pushReplay();
    this.dispatch(ev, packet, 'question', true);
  }

  /** The search for a moment's move is over: it was found, told, shown or passed over. Kept in the hint log. */
  private closeMoment(how: ReplayHow) {
    const r = this.replay;
    const m = r?.moments[r.index];
    if (!r || !m || r.phase !== 'asking') return;
    r.log.push({ ply: m.ply, how, hints: this.ladder.level, misses: this.ladder.misses });
    r.phase = 'explained';
    this.db.logEvent('replay_answer', { game: r.gameId, ply: m.ply, how, hints: this.ladder.level, misses: this.ladder.misses });
    this.pushReplay();
  }

  private async finishReplay() {
    const r = this.replay;
    if (!r) return;
    r.phase = 'finished';
    this.resetLadder();
    this.db.logEvent('replay_done', { game: r.gameId, log: r.log });
    const you = this.db.getReview(r.gameId)?.you;
    const written = you ? this.makeReport(r.gameId, you) : undefined;
    if (this.review && written) this.review = { ...this.review, report: written.report, ownerNote: written.note };
    this.pushReplay();
    // the tags only the owner can settle: asked now, once each moment has been gone through (WP 5.7)
    this.askUnclearTags(r);
    let packet: FactPacket;
    try {
      packet = await this.focusPacket(true);
    } catch {
      return;
    }
    if (this.replay !== r) return;
    const found = r.log.filter((x) => x.how === 'found').length;
    const total = r.moments.length;
    const ev: CoachEvent = {
      seq: this.session.state.seq,
      kind: 'review_end',
      payload: this.payload('review_end', packet, {
        review: {
          moments: total,
          foundByTheOwner: found,
          howEachWent: r.log.map((x) => ({ ply: x.ply, how: x.how, hintsUsed: x.hints, misses: x.misses })),
          // the written report, worked out by the app: the summary restates it and adds no chess of its own
          report: written ? { whatWentWell: written.report.positives, takeaways: written.report.takeaways.map((t) => t.text), lastLine: written.report.closing } : null,
        },
      }),
      needsReply: true,
      canAnswer: true,
      scripted: {
        kind: 'summary',
        text: [
          found ? `That was the last one. You found the better move yourself ${found === total ? (total === 1 ? 'this time' : 'every time') : `in ${found} of ${total} moments`}.` : 'That was the last moment of this game.',
          written?.report.takeaways[0] ? `The habit to take into your next game: ${STEP_HABIT[written.report.takeaways[0].step].charAt(0).toLowerCase()}${STEP_HABIT[written.report.takeaways[0].step].slice(1)}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      },
    };
    this.dispatch(ev, packet, 'question', true);
  }

  /** Leave the replay: the board and the coach go back to plain analysis. */
  /**
   * A tag the board cannot settle (WP 5.7, COACH §6.2 step 3): for each moment of the replay tagged "it
   * looked safe" or "no safety check" by the machine, the owner is asked whether they looked at the reply.
   * The two answers are buttons; the one pressed becomes the owner's own word for the step (H8).
   */
  private askUnclearTags(r: NonNullable<App['replay']>) {
    this.tagAsks.clear();
    for (const m of r.moments) {
      if (!tagUnclear(m.step) || m.stepBy === 'owner') continue;
      const q = lookedQuestion(m.number, m.san);
      for (const c of q.choices) this.tagAsks.set(c.text, { gameId: r.gameId, ply: m.ply, step: c.step });
      this.deliver({ kind: 'question', text: q.text, claims: [], expect: 'choice', choices: q.choices.map((c) => c.text), source: 'scripted', fen: m.fenBefore });
    }
  }

  /** The owner's own word for a step, from the review screen or an answer to the question above (H8): the report is made again. */
  private setOwnerTag(gameId: number, ply: number, step: SkippedStep, how: 'chosen' | 'asked'): boolean {
    const review = this.review;
    const you = this.db.getReview(gameId)?.you;
    if (!review || review.gameId !== gameId || !you || !this.db.setOwnerStep(gameId, ply, step)) return false;
    this.db.logEvent('tag', { game: gameId, ply, step, how });
    const written = this.makeReport(gameId, you);
    this.setReview({ ...review, moments: this.withOwnerSteps(gameId, you, review.moments), report: written?.report, ownerNote: written?.note });
    this.broadcast({ type: 'library', view: this.library.view() });
    return true;
  }

  private endReplay() {
    if (!this.replay) return;
    this.replay = null;
    this.resetLadder();
    if (this.review?.replay) this.setReview({ ...this.review, replay: undefined });
    if (this.coach.isOn) this.coach.restart(); // back to the analysis agent
  }

  /**
   * The fair-play guard (H10, a hard rule): is the position the owner is looking at one from a game
   * they are still playing, or played on from where such a game stands? Then the engine and the
   * coach say nothing about it. Returns the refusal in plain words, or null.
   */
  private blocked(node?: TreeNode): string | null {
    const s = this.session.state;
    const hit = this.library.guard(pathTo(s.tree, node?.id ?? s.focus).map((n) => n.fen));
    if (hit) return guardText(hit);
    // the owner's own review comes first (B7): the same gate keeps the engine and the coach quiet until it is done or skipped
    return this.ownPending() ? OWN_FIRST : null;
  }

  /** A game or position about to come onto the board from outside (pasted, set up): the same rule at the door. */
  private blockedLoad(text: string): string | null {
    const r = importPgn(text);
    const hit = r.ok ? this.library.guardLoad(r.tree) : null;
    return hit ? guardText(hit) : null;
  }

  /** Say the refusal in the coach's panel, once: not again for every step on the same game. */
  private sayBlocked(text: string) {
    if (this.session.thread.at(-1)?.text === text) return;
    this.systemSay(text);
  }

  // ------------------------------------------------------------ games against bots

  private onGameMessage(client: Client, msg: Extract<ClientMsg, { type: 'game' }>) {
    const p = this.play;
    const say = (text: string, level: 'info' | 'error' = 'error') => client.send({ type: 'toast', level, text });
    switch (msg.action) {
      case 'start': {
        const r = p.start(msg.bot, msg.color, msg.time ?? null);
        if (!r.ok) say(r.reason);
        return;
      }
      case 'mini': {
        const r = p.startMini(msg.id, msg.bot);
        if (!r.ok) say(r.reason);
        return;
      }
      case 'draw':
        return void p.draw().then((r) => say(r.text, 'info'));
      case 'take_offer':
        if (!p.takeOffer()) say('There is nothing to take back now.', 'info');
        return;
      case 'ask_coach':
        return this.askSparCoach(client);
      case 'play_on':
        return p.playOn();
      case 'move': {
        const r = p.move(msg.from, msg.to, msg.promotion);
        if (!r.ok) say(r.reason);
        return;
      }
      case 'nav':
        return p.nav(msg.to);
      case 'resign':
        return p.resign();
      case 'takeback':
        if (!p.takeback()) say('There is nothing to take back yet.', 'info');
        return;
      case 'retry':
        return p.retry();
      case 'new':
        return p.fresh();
      case 'analyse': {
        // a game still being played is not analysed, even against a bot: think first, review after
        if (p.game.status !== 'over') return say('Finish or resign the game first. A game in progress is not analysed.');
        // the game is in the library: it is opened from there, so the review goes as for any game (your own look first, then the engine's)
        if (p.game.libraryId !== undefined && this.db.getGame(p.game.libraryId)) return this.openGame(client, p.game.libraryId);
        const r = this.session.load(p.pgn());
        if (!r.ok) return say(r.reason);
        if (this.session.state.orientation !== p.game.you) this.session.flip();
        this.resetLadder();
        this.setMode('analysis');
        return say('Your game is on the analysis board. Step through it, or ask the coach about any move.', 'info');
      }
    }
  }

  // ------------------------------------------------------------ facts

  private you(): Color {
    return this.session.state.orientation;
  }

  /**
   * The fact packet for the owner's board, built once per board state. `deep` uses the deeper
   * search: it is what the coach (or the scripted fallback) speaks from. The quick one only lets
   * the director decide whether a move is worth a comment.
   */
  focusPacket(deep = false): Promise<FactPacket> {
    const s = this.session;
    const key = `${s.state.seq}|${s.focusFen()}|${this.you()}`;
    if (this.deepCache?.key === key) return this.deepCache.packet;
    if (!deep && this.packetCache?.key === key) return this.packetCache.packet;
    const packet = this.facts.packet({ fen: s.focusFen(), you: this.you(), lastMove: s.lastMove(), opening: s.state.opening, deep });
    const slot = { key, packet };
    if (deep) this.deepCache = slot;
    else this.packetCache = slot;
    packet.then(
      () => {
        // the coach is about to speak from this: the label on the board follows the same verdict
        if (deep && this.deepCache === slot) void this.refreshInsight();
      },
      () => {
        if (this.deepCache === slot) this.deepCache = null;
        if (this.packetCache === slot) this.packetCache = null;
      },
    );
    return packet;
  }

  /** The facts for the position the owner is looking at: their own board, or the coach's. */
  private visiblePacket(): Promise<FactPacket> {
    const s = this.session.state;
    if (s.layer === 'demo' && s.demo) return this.facts.packet({ fen: demoFen(s.demo), you: this.you(), deep: true });
    return this.focusPacket(true);
  }

  // ------------------------------------------------------------ the eval bar, the best-move arrows, the move labels

  /**
   * What the engine adds to the owner's board (features A6, A16, A17). The reading and the label
   * are stored on the move itself, so the move list keeps them; the arrows are sent on their own.
   * A quick search answers at once; if the owner stays on the position, the deeper search (the one
   * used for anything stated to them) confirms or corrects it.
   */
  private async refreshInsight(): Promise<void> {
    const s = this.session;
    const run = ++this.insightRun;
    const bar = this.settings.get<boolean>('display.evalBar');
    const labels = this.settings.get<boolean>('display.moveLabels');
    const arrowsOn = this.settings.get<boolean>('display.bestArrows');
    if (this.deepTimer) clearTimeout(this.deepTimer);
    if (!bar && !labels && !arrowsOn) return this.broadcast({ type: 'insight', insight: null });
    const tree = s.state.tree;
    const node = s.focusNode();
    // fair play: nothing from the engine on a position of a game the owner is still playing
    const stop = this.blocked(node);
    if (stop) {
      const had = !!node.gauge || !!node.judged;
      delete node.gauge;
      delete node.judged;
      this.broadcast({ type: 'insight', insight: { fen: node.fen, arrows: [], held: stop } });
      if (had) s.touch();
      return;
    }
    const alive = () => run === this.insightRun && s.state.tree === tree && tree.nodes[node.id] === node;
    // while the coach is waiting for the owner to find a move, an arrow would give the answer away
    const held = this.ladder.active ? 'Hidden while the coach waits for your move.' : undefined;
    this.arrowsHeld = !!held;
    const count = arrowsOn && !held ? this.settings.get<number>('display.bestArrowCount') : 0;
    try {
      // once the checked analysis is in, everything comes from it; until then a quick search answers
      const confirmed = this.confirmed.get(node);
      const look = confirmed ?? (await this.facts.look(node.fen, { arrows: 3 }));
      if (!alive()) return;
      let changed = false;
      if ((bar || labels) && look.gauge && (!node.gauge || (look.sure && !sameGauge(node.gauge, look.gauge)))) {
        node.gauge = look.gauge;
        changed = true;
      }
      if (labels && node.parent && node.san) {
        const before = tree.nodes[node.parent]!.fen;
        // a verdict the coach was given on this move decides its label: the two must never disagree
        const judged = this.facts.knownLabel(before, node.san) ?? (node.judged ? null : await this.facts.judge(before, node.san));
        if (!alive()) return;
        if (judged && !sameJudged(judged, node.judged)) {
          node.judged = judged;
          changed = true;
        }
      }
      this.broadcast({ type: 'insight', insight: { fen: node.fen, arrows: look.arrows.slice(0, count), held: arrowsOn ? held : undefined } });
      if (changed) return s.touch(); // the state goes out again and this runs once more, now with everything known
      if (!confirmed && !this.deepened.has(node)) {
        this.deepTimer = setTimeout(() => void this.deepen(tree, node), DEEPEN_AFTER_MS);
        this.deepTimer.unref?.();
      }
    } catch (e) {
      this.log(`insight failed: ${(e as Error).message}`);
    }
  }

  /**
   * The owner has stayed on a position: confirm its reading, its arrows and its move's label with
   * the analysis the coach's verdicts rest on (the deeper search, checked against Lichess: D37).
   */
  private async deepen(tree: MoveTree, node: TreeNode) {
    const s = this.session;
    const here = () => s.state.tree === tree && tree.nodes[node.id] === node;
    if (!here() || s.state.focus !== node.id || this.blocked(node)) return;
    this.deepened.add(node); // once per position: a search that fails is not tried again and again
    try {
      const look = await this.facts.look(node.fen, { reference: true, arrows: 3 });
      if (node.parent && node.san && this.settings.get<boolean>('display.moveLabels')) await this.facts.judge(tree.nodes[node.parent]!.fen, node.san, { reference: true });
      if (!here()) return;
      this.confirmed.set(node, look);
      if (s.state.focus === node.id) void this.refreshInsight(); // picks up the confirmed reading, arrows and label
    } catch (e) {
      this.log(`deeper insight failed: ${(e as Error).message}`);
    }
  }

  /** Label every move of what is loaded, in the background (the menu's "Label every move"). */
  private async labelAll(client: Client) {
    if (this.labelling) return;
    const s = this.session;
    const tree = s.state.tree;
    const main = new Set(pathTo(tree, mainlineEnd(tree)).map((n) => n.id));
    const todo = Object.values(tree.nodes)
      .filter((n) => !n.gauge || (n.san && n.judged?.sure !== true))
      // fair play: positions of a game still being played stay unlabelled
      .filter((n) => !this.blocked(n))
      .sort((a, b) => Number(main.has(b.id)) - Number(main.has(a.id)) || a.ply - b.ply);
    if (!todo.length) return client.send({ type: 'toast', level: 'info', text: 'Every move here is already labelled.' });
    this.labelling = true;
    try {
      // a whole game is real engine work: on battery the owner's setting decides (quick search, full, or wait)
      const plan = await this.power.plan(this.settings.get<BatteryPolicy>('engine.onBattery'), 'labelling the game');
      if (plan.note) client.send({ type: 'toast', level: 'info', text: plan.note });
      if (!plan.run) return;
      const deep = plan.deep;
      let done = 0;
      const total = todo.length;
      const progress = () => this.broadcast({ type: 'busy', text: `Labelling moves: ${done} of ${total}` });
      progress();
      const queue = [...todo];
      const worker = async () => {
        for (let node = queue.shift(); node; node = queue.shift()) {
          if (s.state.tree !== tree) return;
          try {
            const look = await this.facts.look(node.fen, { deep, pool: 'analysis' });
            const parent = node.parent ? tree.nodes[node.parent] : undefined;
            const judged = parent && node.san ? await this.facts.judge(parent.fen, node.san, { deep, pool: 'analysis' }) : null;
            if (tree.nodes[node.id] === node) {
              if (look.gauge) node.gauge = look.gauge;
              if (judged) node.judged = judged;
            }
          } catch (e) {
            this.log(`labelling ${node.san ?? 'the start'} failed: ${(e as Error).message}`);
          }
          done++;
          if (done % 6 === 0) {
            progress();
            if (s.state.tree === tree) s.touch();
          }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      this.db.logEvent('label_all', { moves: total, deep });
      if (s.state.tree === tree) s.touch();
    } finally {
      this.labelling = false;
      this.broadcast({ type: 'busy', text: null });
    }
  }

  /** Fill in the eval-bar readings and the labels for a line on the coach's board, once it is showing. */
  private async labelDemoLine(demoId: number, lineId: string) {
    if (!this.settings.get<boolean>('display.evalBar') && !this.settings.get<boolean>('display.moveLabels')) return;
    const s = this.session;
    const find = (): DemoLine | undefined => (s.state.demo?.id === demoId ? s.state.demo.lines.find((l) => l.id === lineId) : undefined);
    const line = find();
    if (!line) return;
    try {
      // one Promise.all for everything: if the engine stops, every one of these is caught together
      const [[base, demoBase], moves] = await Promise.all([
        Promise.all([this.facts.look(line.baseFen), this.facts.look(s.state.demo!.baseFen)]),
        Promise.all(
          line.moves.map(async (m, i) => {
            const before = i === 0 ? line.baseFen : line.moves[i - 1]!.fen;
            const look = await this.facts.look(m.fen);
            // the first move of a "what if" line, or of the owner's own try, was judged together with its
            // verdict; a threat line starts from a made-up position (a free move), so its first move has no label
            const named = i === 0 && (line.kind === 'move' || line.kind === 'alt');
            const judged = m.judged ?? (i === 0 && line.kind === 'threat' ? null : await this.facts.judge(before, m.san, { engineChose: !named }));
            return { look, judged };
          }),
        ),
      ]);
      const now = find();
      if (!now || !s.state.demo) return;
      now.baseGauge = base.gauge ?? undefined;
      s.state.demo.baseGauge = demoBase.gauge ?? undefined;
      now.moves.forEach((m, i) => {
        const r = moves[i];
        if (!r) return;
        m.gauge = r.look.gauge ?? undefined;
        if (r.judged) m.judged = r.judged;
      });
      s.touch();
    } catch (e) {
      this.log(`labelling the coach's line failed: ${(e as Error).message}`);
    }
  }

  private async gaugeDemoBase(demoId: number) {
    if (!this.settings.get<boolean>('display.evalBar')) return;
    try {
      const demo = this.session.state.demo;
      if (!demo || demo.id !== demoId) return;
      const look = await this.facts.look(demo.baseFen);
      if (this.session.state.demo !== demo || !look.gauge) return;
      demo.baseGauge = look.gauge;
      this.session.touch();
    } catch {
      /* the bar simply stays empty */
    }
  }

  // ------------------------------------------------------------ the owner's actions → coach events

  private resetLadder() {
    this.ladder = { seq: this.session.state.seq, active: false, level: 0, misses: 0 };
    this.ladderMoved();
  }

  /** The best-move arrows are held back while an exercise is open: bring them back (or hide them) when that changes. */
  private ladderMoved() {
    if (this.ladder.active !== this.arrowsHeld) void this.refreshInsight();
  }

  private budget() {
    return { short: this.settings.get<number>('coach.sentences.short'), explain: this.settings.get<number>('coach.sentences.explain'), messages: this.settings.get<number>('coach.messagesPerTurn'), linePlies: this.settings.get<number>('coach.lineMaxPlies') };
  }

  /** What the owner has drawn on the board themselves (arrows and circles), in words. */
  private ownerDrew(): string[] | undefined {
    const shapes = this.session.state.shapes.owner;
    if (!shapes.length) return undefined;
    const pos = parsePosition(this.session.visibleFen());
    return shapes.map((x) => {
      const piece = pos?.board.get(parseSquare(x.from)!);
      const what = piece ? ` (the ${piece.color === this.you() ? 'owner\'s' : 'opponent\'s'} ${piece.role})` : '';
      if (!x.to) return `a circle on ${x.from}${what}`;
      // the app names the move the arrow stands for, so the coach never has to work one out
      const move = pos ? anyToMove(pos, `${x.from}${x.to}`) : null;
      const san = pos && move ? describeMove(pos, move).san : null;
      return san ? `an arrow for the move ${san}` : `an arrow from ${x.from}${what} to ${x.to} (not a legal move right now)`;
    });
  }

  /**
   * The moves that led to the position on the owner's board, with the labels the page shows as
   * marks ("10...Qe6?"), so the coach knows the game so far and never has to ask for it.
   */
  private movesSoFar(): { from: string; moves: string } {
    const tree = this.session.state.tree;
    const path = pathTo(tree, this.session.state.focus);
    const out: string[] = [];
    for (let i = 1; i < path.length; i++) {
      const before = path[i - 1]!.fen.split(' ');
      const white = before[1] !== 'b';
      const n = Number(before[5] ?? 1) || 1;
      const node = path[i]!;
      const mark = node.judged ? LABEL_MARK[node.judged.label] : '';
      out.push(`${white ? `${n}.` : i === 1 ? `${n}...` : ''}${node.san}${mark}`);
    }
    return { from: tree.rootFen === START_FEN ? 'the starting position' : tree.rootFen, moves: out.join(' ') };
  }

  /** The words kept for later at the owner's vocabulary level, each with the plain wording to use instead: so the coach does not spend a refused message finding out. */
  private keptForLater(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { concept } of this.concepts.deferredAt(this.settings.get<VocabularyLevel>('coach.vocabulary'))) out[concept.name] = concept.plain ?? '';
    return out;
  }

  /** What the page says under the board about the move that led here: the same label and words the owner is reading. */
  private boardShows(): string | undefined {
    const tree = this.session.state.tree;
    const node = tree.nodes[this.session.state.focus];
    if (!node?.san || !node.parent || !node.judged) return undefined;
    const mover = tree.nodes[node.parent]!.fen.split(' ')[1] === 'b' ? 'black' : 'white';
    return judgedText(node.san, node.judged, mover);
  }

  /** The owner's level for the coach: from their own games once enough are analysed (the band is a rough guide), else what they told us. */
  private ownerLevel(): string {
    const band = this.library.profile().band;
    return band ? `a beginner; by their own games they play like the ${band.band} band` : 'beginner, about 500';
  }

  private payload(kind: CoachEvent['kind'], packet: FactPacket | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const s = this.session.state;
    const demo = s.layer === 'demo' && s.demo ? { showing: s.demo.label, lines: s.demo.lines.map((l) => ({ id: l.id, label: l.label, moves: l.moves.map((m) => m.san + m.mark).join(' ') })) } : undefined;
    return {
      event: kind,
      seq: s.seq,
      mode: s.mode,
      ...extra,
      ladder: { rungsGiven: this.ladder.level, misses: this.ladder.misses },
      askFirst: this.settings.get<boolean>('coach.askFirst'),
      owner: { level: this.ownerLevel(), vocabulary: this.settings.get<string>('coach.vocabulary'), sayInPlainWords: this.keptForLater() },
      budget: this.budget(),
      ownerIsLookingAt: s.layer === 'demo' ? 'your demo board' : 'their own board',
      ownerDrew: this.ownerDrew(),
      gameSoFar: this.movesSoFar(),
      boardShows: this.boardShows(),
      demo,
      ...(packet ? { facts: packetForCoach(packet) } : {}),
    };
  }

  private async afterBoardChange(_what: 'move') {
    const s = this.session;
    const seq = s.state.seq;
    const stop = this.blocked();
    if (stop) {
      this.resetLadder();
      return this.sayBlocked(stop);
    }
    const wasExercise = this.ladder.active;
    let packet: FactPacket;
    try {
      packet = await this.focusPacket();
    } catch (e) {
      this.log(`facts failed: ${(e as Error).message}`);
      return;
    }
    if (seq !== s.state.seq) return; // the board moved on while the engine was thinking
    const last = s.lastMove();
    const forCoach = async (): Promise<FactPacket | null> => {
      try {
        const deep = await this.focusPacket(true);
        return seq === s.state.seq ? deep : null;
      } catch {
        return null;
      }
    };
    const r = this.replay;
    // a move played from the position of a replay's moment is a try at it, whatever the ladder says
    const replayTry = !!r && r.phase === 'asking' && s.state.game?.id === r.gameId && s.focusNode().parent === r.node;
    if ((wasExercise || replayTry) && last?.by === 'owner') {
      // the coach asked for a move and this is the owner's answer
      const correct = !!packet.graded && (packet.graded.isBest || packet.graded.cls === 'ok');
      const misses = this.ladder.misses + (correct ? 0 : 1);
      this.ladder = { seq, active: false, level: this.ladder.level, misses };
      this.ladderMoved();
      this.db.logEvent('answer', { san: last.san, correct, hintLevel: this.ladder.level, misses });
      const canAnswer = true; // they have tried: explaining is now right
      const deep = await forCoach();
      if (!deep) return;
      packet = deep;
      const giveAnswerNow = misses >= this.settings.get<number>('coach.ladder.maxMisses');
      let review: Record<string, unknown> | undefined;
      if (replayTry && r) {
        if (correct) this.closeMoment('found');
        else if (giveAnswerNow) this.closeMoment('two_misses');
        else {
          // not it, and there are tries left: back to the position, the exercise still open
          s.nav(r.node);
          this.ladder = { seq: s.state.seq, active: true, level: this.ladder.level, misses };
          this.ladderMoved();
        }
        review = { ...this.replayContext(), theOwnerIsBackOnThePositionToTryAgain: !correct && !giveAnswerNow };
      }
      const ev: CoachEvent = { seq: s.state.seq, kind: 'owner_reply', payload: this.payload('owner_reply', packet, { reply: { move: last.san, correct, misses, giveAnswerNow, citeForTheirMove: packet.graded?.factId ?? null }, ...(review ? { review } : {}) }), needsReply: true, canAnswer };
      return this.dispatch(ev, packet, 'move');
    }
    this.resetLadder();
    const decision = wakeOnMove(this.settings.get<Verbosity>('coach.verbosity.analysis'), packet);
    if (!decision.wake || !this.coach.isOn) return;
    const deep = await forCoach();
    if (!deep) return;
    packet = deep;
    const ev: CoachEvent = { seq, kind: 'owner_move', payload: this.payload('owner_move', packet, { why: decision.reason, movedBy: last?.by ?? 'owner' }), needsReply: false, canAnswer: !this.settings.get<boolean>('coach.askFirst') || !!packet.over };
    this.dispatch(ev, packet, 'move');
  }

  /**
   * The owner moved a piece on the coach's board (feature A18). A move the coach's lines already
   * have just steps along them. Anything else is an alternative: the engine judges it and plays
   * the replies (the owner supplies one move, never a line: D33), it is added as a side line
   * marked as the owner's, and the coach is told so it can explain it.
   */
  private async ownerMovesOnDemo(client: Client, from: string, to: string, promotion?: string) {
    const s = this.session;
    const demo = s.state.demo;
    const refuse = (text: string) => client.send({ type: 'toast', level: 'error', text });
    if (!demo) return refuse('There is nothing on the coach\'s board.');
    const stop = this.blocked();
    if (stop) return refuse(stop);
    const fen = demoFen(demo);
    const pos = mustPosition(fen);
    const move = anyToMove(pos, `${from}${to}${promotion ? (promotion[0] === 'k' ? 'n' : promotion[0]) : ''}`);
    if (!move) return refuse('That move is not legal there.');
    const info = describeMove(pos, move);
    const exercise = this.ladder.active;
    const cursor = { ...demo.cursor };
    const shown = cursor.line ? demo.lines.find((l) => l.id === cursor.line) : undefined;
    const lessonMove = shown ? shown.moves[cursor.ply]?.san : demo.lines.find((l) => !l.parent)?.moves[0]?.san;

    if (s.demoFollow(info.san)) {
      // the lesson's own move: nothing to explain, unless the coach had asked the owner to find it
      if (!exercise) return;
      this.ladder = { ...this.ladder, active: false };
      this.ladderMoved();
      try {
        const cm = await this.facts.checkMove(fen, info.san, this.you());
        if (!cm.legal || s.state.demo !== demo) return;
        this.db.logEvent('answer', { san: info.san, correct: true, hintLevel: this.ladder.level, misses: this.ladder.misses, onCoachBoard: true });
        const facts = cm.facts.map((f) => ({ id: f.id, type: f.type, text: f.text }));
        const ev: CoachEvent = {
          seq: s.state.seq,
          kind: 'owner_reply',
          payload: this.payload('owner_reply', null, { reply: { move: info.san, correct: true, misses: this.ladder.misses, onYourBoard: true, itIsTheMoveOfYourLine: true }, facts: { facts } }),
          needsReply: true,
          canAnswer: true,
          scriptedFacts: [cm.factId],
        };
        this.dispatchFacts(ev);
      } catch (e) {
        this.log(`facts failed: ${(e as Error).message}`);
      }
      return;
    }

    let r: LineResult;
    try {
      r = await this.facts.engineLine({ baseFen: fen, you: this.you(), what: 'move', move: info.san, maxPlies: this.settings.get<number>('coach.lineMaxPlies') });
    } catch (e) {
      this.log(`engine line failed: ${(e as Error).message}`);
      return refuse('The chess engine is not answering, so that move could not be checked.');
    }
    if (!r.ok) return refuse(r.reason);
    // the owner (or the coach) went somewhere else while the engine was working
    if (s.state.demo !== demo || s.state.layer !== 'demo' || demo.cursor.line !== cursor.line || demo.cursor.ply !== cursor.ply) return;
    const moves = this.demoMoves(r);
    moves[0]!.alt = true;
    const line = s.addDemoLine(
      { label: lessonMove ? `Your alternative: ${info.san}` : `Your move: ${info.san}`, baseFen: r.baseFen, moves, parent: cursor.line ? { line: cursor.line, ply: cursor.ply } : undefined, verdict: r.verdict, checkedBy: r.source.text, kind: 'alt' },
      { byOwner: true },
    );
    const good = !!r.firstJudged && ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced'].includes(r.firstJudged.label);
    this.db.logEvent('demo_try', { san: info.san, insteadOf: lessonMove ?? null, label: r.firstJudged?.label, exercise });
    void this.labelDemoLine(demo.id, line.id);

    const facts = r.facts.map((f) => ({ id: f.id, type: f.type, text: f.text }));
    const scriptedFacts = r.facts.filter((f) => f.type !== 'line').slice(0, 2).map((f) => f.id);
    const tried = { move: info.san, insteadOf: lessonMove ?? null, line: line.id, shown: r.moves.map((m, i) => m + r.marks[i]).join(' '), engineVerdict: r.summary, cite: r.id };
    const seq = s.state.seq;
    if (exercise) {
      const misses = this.ladder.misses + (good ? 0 : 1);
      this.ladder = { seq, active: false, level: this.ladder.level, misses };
      this.ladderMoved();
      this.db.logEvent('answer', { san: info.san, correct: good, hintLevel: this.ladder.level, misses, onCoachBoard: true });
      const reply = { move: info.san, correct: good, misses, giveAnswerNow: misses >= this.settings.get<number>('coach.ladder.maxMisses'), onYourBoard: true };
      return this.dispatchFacts({ seq, kind: 'owner_reply', payload: this.payload('owner_reply', null, { reply, tried, facts: { facts } }), needsReply: true, canAnswer: true, scriptedFacts });
    }
    this.resetLadder();
    if (!this.settings.get<boolean>('coach.commentOnTries')) return;
    this.dispatchFacts({ seq, kind: 'owner_tries', payload: this.payload('owner_tries', null, { tried, facts: { facts } }), needsReply: true, canAnswer: true, scriptedFacts });
  }

  /** A line the engine built, as the moves the coach's board shows. */
  private demoMoves(r: Extract<LineResult, { ok: true }>): DemoMove[] {
    return r.moves.map((san, i) => {
      const before = mustPosition(r.fens[i]!);
      const info = describeMove(before, anyToMove(before, san)!);
      return { san, from: info.from, to: info.to, fen: r.fens[i + 1]!, by: before.turn, mark: r.marks[i]!, ...(i === 0 && r.firstJudged ? { judged: r.firstJudged } : {}) };
    });
  }

  private ownerMessage(text: string) {
    const m = this.session.addMessage({ seq: this.session.state.seq, from: 'owner', text, segments: [{ type: 'text', text }] });
    this.broadcast({ type: 'coach_msg', message: m });
  }

  private async ownerAsked(raw: string) {
    const text = raw.trim().slice(0, 1000);
    if (!text) return;
    // an answer to "did you look at their reply?" (WP 5.7): the owner's own word for that moment's step
    const tag = this.tagAsks.get(text);
    if (tag) {
      this.ownerMessage(text);
      for (const [k, v] of this.tagAsks) if (v.gameId === tag.gameId && v.ply === tag.ply) this.tagAsks.delete(k);
      return this.setOwnerTag(tag.gameId, tag.ply, tag.step, 'asked') ? this.systemSay(`Noted: ${STEP_NAME[tag.step].toLowerCase()}. The report and your journal say so now.`) : this.systemSay('That game is not open any more: open it to say which it was.');
    }
    // on the Openings tab the question is about the board there: the walked repertoire, or the card (D12)
    if (this.openingSet()) return this.askOpeningCoach(text);
    // on the safety check, the threat or a won game: about that board (D105)
    const od = this.otherDrill();
    if (od) return this.askOtherDrill(od, text);
    this.ownerMessage(text);
    const stop = this.blocked();
    if (stop) return this.systemSay(stop);
    const seq = this.session.state.seq;
    let packet: FactPacket;
    try {
      packet = await this.focusPacket(true);
    } catch {
      return this.systemSay('The chess engine is not answering, so I cannot check anything right now.');
    }
    const wantsMove = asksForMove(text) && this.session.state.layer === 'owner';
    if (wantsMove && this.ladder.seq !== seq) this.resetLadder();
    const askFirst = this.settings.get<boolean>('coach.askFirst');
    const canAnswer = !wantsMove || !askFirst || this.ladder.level > 0 || this.ladder.misses > 0;
    this.db.logEvent('ask', { text, wantsMove });
    const ev: CoachEvent = {
      seq,
      kind: 'owner_question',
      payload: this.payload('owner_question', packet, { ownerSaid: text, ownerAsksForAMove: wantsMove, youMayGiveTheMove: canAnswer }),
      needsReply: true,
      canAnswer,
      ownerText: text,
    };
    this.dispatch(ev, packet, 'question', true);
  }

  private async ownerChip(chip: Chip) {
    this.ownerMessage(CHIP_LABEL[chip]);
    const stop = this.blocked();
    if (stop) return this.systemSay(stop);
    const seq = this.session.state.seq;
    if (this.ladder.seq !== seq) this.resetLadder();
    let packet: FactPacket;
    try {
      packet = await this.focusPacket(true);
    } catch {
      return this.systemSay('The chess engine is not answering, so I cannot check anything right now.');
    }
    this.db.logEvent('chip', { chip, level: this.ladder.level });
    const kind = chip === 'hint' ? 'hint_request' : chip;
    const next = chip === 'hint' ? (['question', 'nudge', 'arrow', 'answer'] as const)[Math.min(3, this.ladder.level)] : chip === 'why' ? 'explain' : 'answer';
    const canAnswer = chip !== 'hint' || this.ladder.level >= 3 || !this.settings.get<boolean>('coach.askFirst');
    // 'Show me' is a request to see moves played, not to hear about them: the event says which tool that is
    const extra = chip === 'show_me' ? { giveNow: next, firstCall: 'play_line (the line is the answer: arrows alone are not what was asked for)' } : { giveNow: next };
    const asking = this.replay?.phase === 'asking';
    const ev: CoachEvent = { seq, kind, payload: this.payload(kind, packet, this.replay ? { ...extra, review: this.replayContext() } : extra), needsReply: true, canAnswer };
    this.dispatch(ev, packet, chip, false);
    // a chip that gives the answer ends the search for this moment
    if (asking && (chip === 'tell_me' || chip === 'show_me' || (chip === 'hint' && next === 'answer'))) this.closeMoment(chip === 'hint' ? 'hints' : 'told');
  }

  // ------------------------------------------------------------ the sparring coach (WP 7.7)

  /** The game as the sparring coach is told about it: what it may say is in it. */
  private gameForCoach(g: NonNullable<ReturnType<PlayController['sparState']>>): Record<string, unknown> {
    return {
      against: g.bot,
      ownerPlays: g.you,
      playing: g.playing,
      ownersTurn: g.yourTurn,
      ownersMoveNumber: g.ownerMoveNo,
      // during a game the owner's moves are theirs alone
      youMayNameTheOwnersMoves: false,
      theirLastMove: g.lastMove?.san ?? null,
      routineQuestionNow: g.prompt ?? null,
      miniGame: g.mini ? `${g.mini.name}: ${g.mini.goal}` : null,
      takebacks: g.takebacks,
      helpsAsked: g.helps,
      result: g.result?.text ?? null,
    };
  }

  /**
   * The engine-style bots' moves (WP 7.8): Stockfish with a short search (more nodes for a stronger
   * bot), its top lines weighed by how much each gives up; the bot's own sampling picks among them.
   */
  private engineBot(): MoveSource {
    return {
      state: 'ready',
      probabilities: async (req) => {
        const r = playLine(req.startFen, req.moves);
        const fen = r.fens.at(-1) ?? req.startFen;
        const nodes = engineBotNodes(req.selfElo);
        const res = await this.engine.analyse({ fen, nodes, multipv: 4 });
        const best = res.lines[0];
        if (!best) return [];
        const weights = res.lines.filter((l) => l.pv[0]).map((l) => ({ uci: l.pv[0]!, w: Math.exp(-(winChance(best.score) - winChance(l.score)) / 4) }));
        const total = weights.reduce((sum, x) => sum + x.w, 0);
        return weights.map((x) => ({ uci: x.uci, p: x.w / total }));
      },
      stop: () => {},
    };
  }

  /** The facts of the game's position, with their last move judged. */
  private gamePacket(g: NonNullable<ReturnType<PlayController['sparState']>>): Promise<FactPacket> {
    return this.facts.packet({ fen: g.fen, you: g.you, deep: true, lastMove: g.lastMove ? { san: g.lastMove.san, by: 'opponent', fenBefore: g.lastMove.fenBefore } : undefined });
  }

  private sparPayload(kind: CoachEvent['kind'], seq: number, g: NonNullable<ReturnType<PlayController['sparState']>>, packet: FactPacket | null, extra: Record<string, unknown>): Record<string, unknown> {
    return {
      event: kind,
      seq,
      mode: 'play',
      game: this.gameForCoach(g),
      ...extra,
      owner: { level: this.ownerLevel(), vocabulary: this.settings.get<string>('coach.vocabulary'), sayInPlainWords: this.keptForLater() },
      budget: this.budget(),
      ...(packet ? { facts: packetForCoach(packet) } : {}),
    };
  }

  /**
   * Something in a game against a bot that the sparring coach may speak to (COACH §6.4), at the
   * verbosity the owner chose: silent says nothing unasked; key moments agrees a focus, voices the
   * routine when the fading overlay would, asks after a blunder and gives one line at the end;
   * every move voices the routine before each of the owner's moves.
   */
  private async onSpar(e: SparEvent) {
    if (!this.coach.isOn || this.mode !== 'play') return;
    const verbosity = this.settings.get<string>('coach.verbosity.spar');
    if (verbosity === 'silent') return;
    const g = this.play.sparState();
    if (!g) return;
    if (e.kind === 'turn' && verbosity !== 'every_move' && !g.prompt) return;
    const seq = ++this.sparSeq;
    const top = this.library.profile().steps[0];
    if (e.kind === 'start') {
      const focus = top ? { habit: top.name, askBeforeEachMove: routinePrompt(1, top.step) } : { habit: null, askBeforeEachMove: routinePrompt(1) };
      return this.coach.submit({ seq, kind: 'spar_start', payload: this.sparPayload('spar_start', seq, g, null, { focus }), needsReply: false, canAnswer: false });
    }
    if (e.kind === 'end') return this.coach.submit({ seq, kind: 'spar_end', payload: this.sparPayload('spar_end', seq, g, null, {}), needsReply: false, canAnswer: true });
    const packet = await this.gamePacket(g);
    if (seq !== this.sparSeq) return;
    if (e.kind === 'blunder') return this.coach.submit({ seq, kind: 'spar_blunder', payload: this.sparPayload('spar_blunder', seq, g, packet, { theMoveDid: e.what, askAbout: e.question }), needsReply: false, canAnswer: false });
    return this.coach.submit({ seq, kind: 'spar_turn', payload: this.sparPayload('spar_turn', seq, g, packet, { routineQuestion: g.prompt ?? routinePrompt(g.ownerMoveNo, top?.step) }), needsReply: false, canAnswer: false });
  }

  /** The owner asks the coach during the game: a question or a nudge about the routine, counted like a hint. */
  private async askSparCoach(client: Client) {
    const g0 = this.play.sparState();
    if (!g0?.playing || !g0.yourTurn) return;
    if (!this.coach.isOn) return client.send({ type: 'toast', level: 'info', text: 'The coach is off. Start it from the coach panel on the analysis board.' });
    this.play.noteHelp();
    const g = this.play.sparState()!;
    const seq = ++this.sparSeq;
    const packet = await this.gamePacket(g);
    if (seq !== this.sparSeq) return;
    const question = g.prompt ?? routinePrompt(g.ownerMoveNo, this.library.profile().steps[0]?.step);
    this.coach.submit({ seq, kind: 'spar_ask', payload: this.sparPayload('spar_ask', seq, g, packet, { giveNow: g.helps <= 1 ? 'question' : 'nudge' }), needsReply: true, canAnswer: false, scripted: { kind: 'question', text: question } });
  }

  // ------------------------------------------------------------ the drill coach (WP 6.11)

  /** The puzzle as the drill coach is told about it: what it may and may not say is in it. */
  private puzzleForCoach(d: DrillState): Record<string, unknown> {
    const hidden = !this.ideaMayBeNamed(d);
    const setWords = d.set.kind === 'mixed' ? 'mixed, the theme hidden from the owner' : d.set.kind === 'theme' ? `one theme: ${themeName(d.set.theme)}` : d.set.kind === 'due' ? 'puzzles due again today' : d.set.kind === 'woodpecker' ? 'a Woodpecker round' : "from the owner's own games";
    return {
      task: d.task,
      set: setWords,
      ownerPlays: d.you,
      solving: d.solving,
      // while solving, the moves are the owner's to find; in a mixed set the idea too
      youMayNameTheMoves: !d.solving,
      youMayNameTheIdea: !hidden,
      ideas: hidden ? (d.set.kind === 'mixed' ? 'hidden until the owner has answered' : 'the owner knows these ideas: let them find this one without its name') : d.themes.map(themeName),
      newToTheOwner: !hidden && d.stage?.stage === 'example' ? themeName(d.stage.motif) : null,
      hintsGiven: d.hints,
      misses: d.misses,
      lastMove: d.lastMove ? `${d.lastMove.san} (theirs)` : null,
    };
  }

  /**
   * A puzzle's ideas as facts the coach can cite by name. They are checked content (the puzzle went
   * through the gates; a game puzzle's themes come from the motif detectors on the engine's line).
   */
  private ideaFacts(themes: string[], solverFen: string, solution: string[]): { idea: string; cite: string }[] {
    // a mating idea says in how many of the owner's moves the solution mates, when the board confirms it ends in checkmate
    const end = playLine(solverFen, solution);
    const mateIn = end.ok && mustPosition(end.fens.at(-1)!).isCheckmate() ? Math.ceil(solution.length / 2) : undefined;
    const facts = this.facts.addFacts((nextId) =>
      themes.map((t) => {
        const mating = IDEA_FACT[t] === 'mate_in' && mateIn !== undefined;
        return { id: nextId(), type: mating ? 'mate_in' : IDEA_FACT[t] === 'mate_in' ? 'line' : (IDEA_FACT[t] ?? 'line'), text: `The idea of this puzzle: ${themeName(t).toLowerCase()}${mating ? `; it ends in checkmate in ${mateIn}` : ''}.`, data: { baseFen: solverFen, line: solution, motif: t, ...(mating ? { mateIn } : {}) } };
      }),
    );
    return facts.map((f) => ({ idea: themeName(String(f.data.motif)), cite: f.id }));
  }

  /**
   * May the coach name the puzzle's idea now? Once the puzzle is over, yes. While the owner solves:
   * never in a mixed set; in a themed set, its theme is named already; otherwise as the guidance does
   * (6.9): while the idea is new or still being learnt, not once the owner knows it.
   */
  private ideaMayBeNamed(d: DrillState): boolean {
    if (!d.solving) return true;
    if (d.set.kind === 'mixed') return false;
    if (d.set.kind === 'theme') return true;
    return !d.stage || guidanceFor(d.stage.stage).nameIt;
  }

  /** The facts of the puzzle board, with their last move judged. */
  private drillPacket(d: DrillState): Promise<FactPacket> {
    return this.facts.packet({ fen: d.fen, you: d.you, deep: true, lastMove: d.lastMove ? { san: d.lastMove.san, by: 'opponent', fenBefore: d.lastMove.fenBefore } : undefined });
  }

  private drillPayload(kind: CoachEvent['kind'], seq: number, d: DrillState | null, packet: FactPacket | null, extra: Record<string, unknown>): Record<string, unknown> {
    return {
      event: kind,
      seq,
      mode: 'puzzles',
      ...(d ? { puzzle: this.puzzleForCoach(d) } : {}),
      ...extra,
      owner: { level: this.ownerLevel(), vocabulary: this.settings.get<string>('coach.vocabulary'), sayInPlainWords: this.keptForLater() },
      budget: this.budget(),
      ...(packet ? { facts: packetForCoach(packet) } : {}),
    };
  }

  /**
   * Something happened in the puzzle player that the drill coach may speak to (COACH §6.3). It is
   * woken only on the Puzzles tab, with the coach on, and never during a speed run. A puzzle solved
   * alone wakes it only now and then (a word of praise); otherwise correct means quiet.
   */
  private async onDrill(e: DrillEvent) {
    if (!this.coach.isOn || this.mode !== 'puzzles' || this.speed.active || this.replay) return;
    const d = this.puzzles.drillState();
    if (e.kind !== 'end' && !d) return;
    if (e.kind === 'done' && e.how === 'solved' && e.clean && !e.example) {
      this.cleanSolves++;
      if (this.cleanSolves % 3 !== 0) return;
    }
    const seq = ++this.drillSeq;
    this.drillFor = d?.id ?? this.drillFor;
    const packet = d ? await this.drillPacket(d) : null;
    if (seq !== this.drillSeq) return;
    if (e.kind === 'miss') {
      const tried = await this.facts.checkMove(e.fenBefore, e.san, d!.you);
      if (seq !== this.drillSeq) return;
      const theMoveTried = tried.legal ? { move: tried.san, verdict: plainText(tried.verdict), cite: tried.factId } : null;
      const ideas = this.ideaMayBeNamed(d!) ? this.ideaFacts(d!.themes, d!.solverFen, d!.solution) : undefined;
      return this.coach.submit({ seq, kind: 'drill_miss', payload: this.drillPayload('drill_miss', seq, d, packet, { theMoveTried, ...(ideas ? { ideas } : {}) }), needsReply: false, canAnswer: false });
    }
    if (e.kind === 'done') {
      // why the solution works: the engine's verdict on its first move, from the solver's first position
      const sol = await this.facts.checkMove(d!.solverFen, d!.solution[0]!, d!.you);
      if (seq !== this.drillSeq) return;
      const solution = sol.legal ? { firstMove: sol.san, verdict: plainText(sol.verdict), cite: sol.factId, wholeLine: d!.solution.join(' ') } : { wholeLine: d!.solution.join(' ') };
      const ideas = this.ideaFacts(d!.themes, d!.solverFen, d!.solution);
      const how = e.example ? 'shown as a worked example, before the owner tried' : e.how === 'shown' ? 'the answer was shown' : e.clean ? 'solved alone, first try' : 'solved, with help';
      const kind = e.example ? 'drill_example' : 'drill_done';
      return this.coach.submit({ seq, kind, payload: this.drillPayload(kind, seq, d, packet, { how, praiseNow: e.how === 'solved' && e.clean, solution, ideas }), needsReply: false, canAnswer: true });
    }
    // the end of a sitting: what went well and what comes back when, counted by code
    return this.coach.submit({ seq, kind: 'drill_end', payload: this.drillPayload('drill_end', seq, null, null, { sitting: this.sittingSummary(e.attempts) }), needsReply: false, canAnswer: true });
  }

  /** Is the opening drill what the Puzzles tab is showing? (its coach is `coach-opening`) */
  private openingSet(): boolean {
    return this.mode === 'openings' || (this.mode === 'puzzles' && this.puzzles.view.set.kind === 'openings');
  }

  /**
   * The Openings tab's repertoires to walk (D9): every repertoire's positions from its lines not in
   * quarantine, the replies' shares at the owner's level from the explorer's kept answers (no call),
   * and the gaps the last gate run found.
   */
  private repBrowser(): RepBrowserView {
    const repertoires: RepBrowserView['repertoires'] = [];
    for (const r of this.db.repertoires()) {
      const items = this.db.repertoireItems<RepLine>(r.id);
      const shown = items.filter((x) => x.status !== 'quarantined' && x.status !== 'draft');
      const positions = browserPositions(
        shown.map((x) => ({ body: x.body, waiting: x.status !== 'live' })),
        this.db.repTexts(r.id),
      ) as RepBrowserView['repertoires'][number]['positions'];
      const report = this.db.repertoire(r.id)?.report as { coverage?: { fen: string; covered: number; missing: { san: string; share: number }[]; ok: boolean }[] } | undefined;
      for (const c of report?.coverage ?? []) {
        const at = positions[positionKey(c.fen)];
        if (at && !c.ok) at.gap = { covered: c.covered, missing: c.missing };
      }
      for (const [key, at] of Object.entries(positions)) {
        if (!at.replies?.length) continue;
        const fen = `${key} 0 1`;
        const kept = this.explorer.cached(this.explorerQuery('level', fen));
        const t = kept ? readExplorer(fen, kept) : null;
        if (t?.games) at.shares = Object.fromEntries(t.rows.map((row) => [row.uci, row.share]));
      }
      // built from the book: how many of the masters' games played each move (the grounding, shown with the move),
      // and why each reply is prepared (the book, the owner's level, the outline)
      const stored = this.db.repertoire(r.id);
      const plan = stored?.plan as BookPlan | null | undefined;
      const outline = plan?.kind === 'book' ? outlineFiles(this.outlinesDir).find((o) => o.id === plan.outline.id)?.outline : undefined;
      if (plan?.kind === 'book') {
        for (const [key, p] of this.db.repBook<BuildPosition>(r.id)) {
          const at = positions[key];
          if (!at) continue;
          if (p.book) at.book = Object.fromEntries(p.book.moves.map((m) => [m.uci, m.games]));
          for (const reply of at.replies ?? []) {
            const why = p.required?.find((q) => q.uci === reply.uci)?.why;
            if (why?.length) reply.from = [...why];
          }
        }
      }
      // where each move of mine comes from (D13): the outline's, the masters' past it, or a repertoire with no book behind it
      const builtBy: MoveFrom = plan?.kind === 'book' ? 'book' : stored?.source.startsWith('generated:') ? 'built' : 'imported';
      for (const [key, at] of Object.entries(positions)) {
        if (at.mine) at.mine.from = outline?.mine.get(key)?.uci === at.mine.uci ? 'outline' : at.mine.from === 'game' ? 'game' : builtBy;
        if (builtBy !== 'book') for (const reply of at.replies ?? []) if (!reply.from?.includes('game')) reply.from = [builtBy];
      }
      // its chapters, in teaching order: each starts where the outline's chapter does, or where its lines part
      const byChapter = new Map<string, { lines: RepLine[]; live: number; waiting: number; order: number }>();
      for (const x of shown) {
        if (!x.body.chapter) continue;
        const c = byChapter.get(x.body.chapter) ?? { lines: [], live: 0, waiting: 0, order: Infinity };
        c.lines.push(x.body);
        if (x.status === 'live') c.live++;
        else c.waiting++;
        c.order = Math.min(c.order, x.body.order ?? x.id);
        byChapter.set(x.body.chapter, c);
      }
      const chapters = [...byChapter.entries()]
        .sort((a, b) => a[1].order - b[1].order)
        .map(([name, c]) => {
          const first = c.lines[0]!;
          const where = outline ? chapterOf(first, outline) : undefined;
          const ply = where ? where.ply : commonMoves(c.lines);
          return { name, moves: first.moves.slice(0, Math.max(1, ply)), lines: c.lines.length, live: c.live, waiting: c.waiting, added: where?.auto || undefined };
        });
      repertoires.push({
        chapters: chapters.length ? chapters : undefined,
        book: plan?.kind === 'book' ? { minGames: plan.minGames } : undefined,
        origin: { kind: builtBy, outline: outline ? { by: outline.listBy ?? 'owner' } : undefined },
        id: r.id,
        name: r.name,
        colour: r.colour,
        startFen: items[0]?.body.startFen ?? START_FEN,
        lines: items.length,
        live: items.filter((x) => x.status === 'live').length,
        waiting: items.filter((x) => x.status === 'machine-verified').length,
        quarantined: items.filter((x) => x.status === 'quarantined').length,
        positions,
      });
    }
    return { repertoires };
  }

  private sendRepBrowser() {
    if (this.clients.size) this.broadcast({ type: 'repbrowser', view: this.repBrowser() });
  }

  /**
   * The position the owner has walked to on the Openings tab (D12), with what the coach is told about it:
   * the repertoire's move there with its written words, or the replies it prepares. Nothing is hidden: the
   * walk shows every move, so the coach may name them.
   */
  private walkNow(): {
    repertoire: { id: number; name: string };
    you: Color;
    fen: string;
    line: string;
    last?: { san: string; baseFen: string };
    mine?: { san: string; why?: string; idea?: string; punish?: boolean };
    replies: string[];
  } | null {
    if (this.mode !== 'openings' || !this.openingWalk) return null;
    const rep = this.db.repertoire(this.openingWalk.repertoire);
    if (!rep) return null;
    const items = this.db.repertoireItems<RepLine>(rep.id).filter((x) => x.status !== 'quarantined' && x.status !== 'draft');
    const start = items[0]?.body.startFen ?? START_FEN;
    const r = playLine(start, this.openingWalk.moves);
    if (!r.ok) return null;
    const fen = r.fens.at(-1)!;
    const at = browserPositions(
      items.map((x) => ({ body: x.body, waiting: x.status !== 'live' })),
      this.db.repTexts(rep.id),
    )[positionKey(fen)];
    const sans = r.infos.map((i) => i.san);
    return {
      repertoire: { id: rep.id, name: rep.name },
      you: rep.colour as Color,
      fen,
      line: sans.length ? lineText(start, sans) : 'the starting position',
      last: sans.length ? { san: sans.at(-1)!, baseFen: r.fens.at(-2)! } : undefined,
      mine: at?.mine ? { san: at.mine.san, why: at.mine.why, idea: at.mine.idea, punish: at.mine.punish } : undefined,
      replies: (at?.replies ?? []).map((x) => x.san),
    };
  }

  /**
   * The safety check, "what's the threat?" or a won game being played out on the Puzzles tab (WP 6.11's
   * open item, D105): its board, the owner's side, whether it is still open (then nothing that gives it
   * away may be said), and what the drill coach is told about it.
   */
  private otherDrill(): { kind: 'safety' | 'threat' | 'convert'; id: number; fen: string; you: Color; open: boolean; noVerdict: boolean; hidden?: string[]; also?: string[]; brief: Record<string, unknown> } | null {
    if (this.mode !== 'puzzles') return null;
    const k = this.puzzles.view.set?.kind;
    if (k === 'safety') {
      const v = this.safety.view;
      if (v.status === 'idle' || v.id === undefined) return null;
      const listing = v.status === 'asking' && v.list?.stage === 'listing';
      const c = v.candidates.map((x) => x.san);
      // what the owner is looking for is the opponent's replies after each candidate, not the candidates
      // themselves (the question names them): those replies are what may not be named while it is open
      const replies = c.flatMap((san) => {
        const after = playLine(v.fen, [san]);
        const pos = after.ok ? parsePosition(after.fens[1]!) : null;
        return pos ? legalMoves(pos).map((x) => x.san) : [];
      });
      return {
        kind: 'safety',
        id: v.id,
        fen: listing ? v.list!.fen : v.fen,
        you: v.you,
        open: v.status === 'asking',
        noVerdict: v.status === 'asking',
        hidden: replies,
        // while listing, the question's own board (before the move asked about) is in front of them too: that move may be named
        also: listing ? [v.fen] : [],
        brief: {
          drill: 'the safety check: is a move safe? (safe: it loses nothing by force and allows no mate)',
          question: v.question === 'is_safe' ? `is ${c[0]} safe?` : `which of ${c[0]} and ${c[1]} is not safe?`,
          now: listing ? `the board shows the position after ${c[0]}: the owner makes each of their checks, captures${v.list?.threats ? ' and threats' : ''}, one at a time` : v.status === 'asking' ? 'the owner is about to rule' : 'answered: the verdicts are out',
          found: v.list?.found.map((r) => r.san) ?? [],
          result: v.result ?? null,
        },
      };
    }
    if (k === 'threat') {
      const v = this.threat.view;
      if (v.status === 'idle' || v.id === undefined) return null;
      const open = v.status === 'naming' || v.status === 'defending';
      return {
        kind: 'threat',
        id: v.id,
        fen: v.fen,
        you: v.you,
        open,
        noVerdict: false,
        brief: {
          drill: "what's the threat? First the owner names their threat by making it (the board shows the position with the turn passed), then finds a move that deals with it",
          now: v.status === 'naming' ? "the owner is naming the opponent's threat" : v.status === 'defending' ? 'the owner is finding a move that deals with the threat' : 'over',
          threat: v.threat && v.status !== 'naming' ? { move: v.threat.san, what: v.threat.what } : null,
          result: v.result ?? null,
        },
      };
    }
    if (k === 'convert') {
      const v = this.convert.view;
      if (v.status === 'idle' || v.id === undefined) return null;
      return {
        kind: 'convert',
        id: v.id,
        fen: v.fen,
        you: v.you,
        open: v.status === 'playing',
        noVerdict: false,
        brief: { drill: 'win the won game: the owner plays a clearly won position out against the engine', now: v.status === 'playing' ? 'the owner is playing: the moves are theirs to find' : 'over', movesSoFar: v.moves.map((m) => m.san).join(' ') || 'none yet', movesLeft: v.status === 'playing' ? v.movesLeft : undefined, result: v.result ?? null },
      };
    }
    return null;
  }

  /** The owner asks the drill coach about the safety check, the threat or the won game in front of them (D105): help, never the answer while it is open. */
  private async askOtherDrill(od: NonNullable<ReturnType<App['otherDrill']>>, text: string) {
    const said = this.session.addMessage({ seq: this.drillSeq, from: 'owner', text, segments: [{ type: 'text', text }], drill: od.id });
    this.broadcast({ type: 'coach_msg', message: said });
    if (!this.coach.isOn) return this.systemSay('The coach is off: start it with the button above, then ask again.', { drill: od.id });
    const seq = ++this.drillSeq;
    this.drillFor = od.id;
    let packet: FactPacket;
    try {
      packet = await this.facts.packet({ fen: od.fen, you: od.you, deep: true });
    } catch {
      return this.systemSay('The chess engine is not answering, so I cannot check anything right now.', { drill: od.id });
    }
    if (seq !== this.drillSeq) return;
    this.db.logEvent('ask', { text, drill: od.kind, open: od.open });
    const payload = {
      event: 'drill_question',
      seq,
      mode: 'puzzles',
      drill: od.kind,
      ownerSaid: text,
      ownerAsksForAMove: asksForMove(text),
      youMayGiveTheAnswer: !od.open,
      about: od.brief,
      owner: { level: this.ownerLevel(), vocabulary: this.settings.get<string>('coach.vocabulary'), sayInPlainWords: this.keptForLater() },
      budget: this.budget(),
      facts: packetForCoach(packet),
    };
    this.coach.submit({ seq, kind: 'drill_question', payload, needsReply: true, canAnswer: !od.open, ownerText: text, scripted: { kind: 'question', text: DRILL_ASK_SCRIPT[od.kind] } });
  }

  /** Who played the move from this position: the owner or their opponent. */
  private moverOf(baseFen: string, you: Color): 'owner' | 'opponent' {
    return baseFen.split(' ')[1] === (you === 'white' ? 'w' : 'b') ? 'owner' : 'opponent';
  }

  /** Where a message of the opening coach's conversation is shown: beside the walked board, or with the card. */
  private openingTags(): { walk?: boolean; drill?: number } {
    if (this.walkNow()) return { walk: true };
    return this.openingSet() && this.drillFor !== null ? { drill: this.drillFor } : {};
  }

  /** The walked position as the opening coach is told about it. */
  private walkForCoach(w: NonNullable<ReturnType<App['walkNow']>>): Record<string, unknown> {
    const toMove = w.fen.split(' ')[1] === (w.you === 'white' ? 'w' : 'b') ? 'the owner' : 'the opponent';
    return {
      what: 'the owner is walking their repertoire on the Openings tab: every move is shown, nothing is being recalled, so you may name any move',
      repertoire: w.repertoire.name,
      reachedBy: w.line,
      ownerPlays: w.you,
      toMove,
      theRepertoireMove: w.mine?.san ?? null,
      theWrittenWhy: w.mine?.why ?? null,
      theOpponentsIdea: w.mine?.idea ?? null,
      punishesTheirMistake: w.mine?.punish ?? false,
      repliesPrepared: w.replies,
      endOfTheLine: !w.mine && !w.replies.length,
    };
  }

  /** The opening card on the drill board, with what the coach's words are checked against: its position, the owner's side, and the position after the move once it is out. */
  private openingNow(): { card: OpeningCard; fen: string; after?: string; asking: boolean; last?: { san: string; baseFen: string } } | null {
    // walking the repertoire, no card is in play
    if (!this.openingSet() || (this.mode === 'openings' && this.openingWalk)) return null;
    const card = this.openings.current();
    const v = this.openings.view;
    if (!card || v.status === 'idle') return null;
    const r = playLine(card.startFen, card.line);
    const last = r.ok && card.line.length ? { san: card.line.at(-1)!, baseFen: r.fens.at(-2)! } : undefined;
    return { card, fen: card.fen, after: v.after, asking: v.status === 'ask', last };
  }

  /** The card for the coach: how the position was reached, the move (hidden while the owner is recalling it), its written words, the replies prepared. */
  private openingForCoach(o: NonNullable<ReturnType<App['openingNow']>>): Record<string, unknown> {
    const v = this.openings.view;
    return {
      repertoire: v.repertoire,
      reachedBy: lineText(o.card.startFen, o.card.line),
      ownerPlays: o.card.colour,
      status: { learn: 'a new card: the move is shown, the owner plays it', ask: 'the owner is recalling the move', wrong: 'the owner played another move; the repertoire move is shown', why: 'the owner played the move; asked why', right: 'done' }[v.status as 'learn'] ?? v.status,
      theRepertoireMove: o.asking ? '(hidden: the owner is recalling it; do not name it)' : o.card.move.san,
      theWrittenWhy: o.asking ? null : (o.card.why ?? null),
      theOpponentsIdea: o.card.idea ?? null,
      repliesPrepared: o.card.replies.map((r) => r.san),
      punishesTheirMistake: o.card.punish ?? false,
      // a card of the trap pack: what it is called and what they hope for, once the move is out (before, it would be a hint)
      trap: o.card.trap ? (o.asking ? { kind: o.card.trap.kind } : { name: o.card.trap.name, kind: o.card.trap.kind, theyHopeFor: o.card.trap.hope ?? null }) : null,
    };
  }

  /**
   * Something in the opening drill the opening coach may speak to (COACH §6.5). A new card wakes it
   * only when no words are written for the move (then it explains the purpose from the facts, D4); a
   * miss and the owner's own words for the why always do. The written why and idea passed V3 already.
   */
  private async onOpening(e: OpeningEvent) {
    if (!this.coach.isOn || !this.openingSet() || this.replay) return;
    const o = this.openingNow();
    if (!o) return;
    if (e.kind === 'opening_new' && o.card.why) return;
    const seq = ++this.drillSeq;
    this.drillFor = this.openings.view.id ?? null;
    const packet = await this.facts.packet({ fen: o.fen, you: o.card.colour, deep: true, lastMove: o.last ? { san: o.last.san, by: 'opponent', fenBefore: o.last.baseFen } : undefined });
    const mine = await this.facts.checkMove(o.fen, o.card.move.san, o.card.colour);
    if (seq !== this.drillSeq) return;
    const theRepertoireMove = mine.legal ? { move: mine.san, verdict: plainText(mine.verdict), cite: mine.factId, facts: mine.facts.map((f) => ({ id: f.id, type: f.type, text: f.text })) } : null;
    let extra: Record<string, unknown> = { theRepertoireMove };
    if (e.kind === 'opening_miss') {
      const tried = await this.facts.checkMove(o.fen, e.played, o.card.colour);
      if (seq !== this.drillSeq) return;
      extra = { ...extra, theMoveTried: tried.legal ? { move: tried.san, verdict: plainText(tried.verdict), cite: tried.factId } : null };
    }
    if (e.kind === 'opening_why') extra = { ...extra, ownersWords: e.words, theWrittenWhy: o.card.why ?? null, ...(o.card.trap?.kind === 'avoid' ? { theQuestionWas: 'what they were hoping the owner would play', theWrittenIdea: o.card.idea ?? null } : {}) };
    // a trap to avoid: the engine's verdict on the move they hope for, so the coach can say what it would have cost
    if (o.card.trap?.kind === 'avoid' && o.card.trap.hope && !o.asking) {
      const hope = await this.facts.checkMove(o.fen, o.card.trap.hope, o.card.colour);
      if (seq !== this.drillSeq) return;
      if (hope.legal) extra = { ...extra, theMoveTheyHopeFor: { move: hope.san, verdict: plainText(hope.verdict), cite: hope.factId } };
    }
    const payload = {
      event: e.kind,
      seq,
      mode: 'openings',
      card: this.openingForCoach(o),
      ...extra,
      owner: { level: this.ownerLevel(), vocabulary: this.settings.get<string>('coach.vocabulary'), sayInPlainWords: this.keptForLater() },
      budget: this.budget(),
      facts: packetForCoach(packet),
    };
    this.coach.submit({ seq, kind: e.kind, payload, needsReply: false, canAnswer: true });
  }

  /** The go on the Endgames tab as the coach is handed it (COACH §6.9). */
  private endgameForCoach(eg: EndgameCoachState): Record<string, unknown> {
    return {
      ending: eg.position.topic,
      position: eg.position.random ? 'a new position, made at random and checked by the tablebases' : eg.position.name,
      goal: { mate: 'give mate', promote: 'queen the pawn and keep the win', draw: 'hold the draw' }[eg.position.goal],
      task: eg.position.task,
      // the topic's words and the position's idea are content: checked before they were ever shown
      theTopic: eg.position.about || null,
      theIdea: eg.position.idea ?? null,
      ownerPlays: eg.you,
      status: eg.playing ? 'the owner is playing: the moves are theirs to find' : 'over',
      movesSoFar: eg.moves.join(' ') || 'none yet',
      movesLeft: eg.playing ? eg.movesLeft : undefined,
      result: eg.result ? { outcome: eg.result.outcome, whatThePageSays: eg.result.text, theMoveThatKeptIt: eg.result.better ?? null } : null,
    };
  }

  /**
   * The end of a go on the Endgames tab, for the endgame coach (COACH §6.9). The goal reached gets a
   * word; the owner's move that let it go gets why, from the engine's verdicts on it and on the move
   * that kept it, and the facts of the position it led to (a stalemate is a game-over fact there).
   */
  private async onEndgame(e: EndgameEvent) {
    if (!this.coach.isOn || this.mode !== 'endgames' || this.replay) return;
    const eg = this.endgames.coachState();
    if (!eg) return;
    const seq = ++this.drillSeq;
    this.drillFor = eg.id;
    const brief = (r: Awaited<ReturnType<FactService['checkMove']>> | null) => (r?.legal ? { move: r.san, verdict: plainText(r.verdict), cite: r.factId, facts: r.facts.map((f) => ({ id: f.id, type: f.type, text: f.text })) } : null);
    let extra: Record<string, unknown>;
    if (e.slip) {
      const slip = await this.facts.checkMove(e.slip.fenBefore, e.slip.san, eg.you);
      const kept = e.better ? await this.facts.checkMove(e.slip.fenBefore, e.better, eg.you) : null;
      const after = await this.facts.packet({ fen: e.slip.fenAfter, you: eg.you, deep: false });
      if (seq !== this.drillSeq) return;
      extra = { theSlip: brief(slip), theMoveThatKeptIt: brief(kept), afterTheSlip: packetForCoach(after) };
    } else {
      const end = await this.facts.packet({ fen: eg.fen, you: eg.you, deep: false });
      // the move that reached the goal, with its verdict: the coach cites it when it names the move
      const last = eg.ownersLast?.san ? await this.facts.checkMove(eg.ownersLast.fenBefore, eg.ownersLast.san, eg.you) : null;
      if (seq !== this.drillSeq) return;
      extra = { yourLastMove: brief(last), facts: packetForCoach(end) };
    }
    const payload = {
      event: 'endgame_over',
      seq,
      mode: 'endgames',
      outcome: e.outcome,
      go: this.endgameForCoach(eg),
      ...extra,
      owner: { level: this.ownerLevel(), vocabulary: this.settings.get<string>('coach.vocabulary'), sayInPlainWords: this.keptForLater() },
      budget: this.budget(),
    };
    this.coach.submit({ seq, kind: 'endgame_over', payload, needsReply: false, canAnswer: true });
  }

  /**
   * The owner asks the opening coach something on the Openings tab (D12, COACH §6.5): about the position
   * they walked to in their repertoire (every move is shown there, so the coach may name any), or about
   * the card in front of them (while they recall its move, the coach may not name it). The coach answers
   * from the position's checked facts and the engine's verdict on the repertoire move; if it cannot, the
   * app says that verdict itself (or, while the move is being recalled, a question that names no move).
   */
  private async askOpeningCoach(text: string) {
    const walk = this.walkNow();
    const card = walk ? null : this.openingNow();
    const tags = walk ? { walk: true } : card ? { drill: this.openings.view.id ?? undefined } : {};
    const said = this.session.addMessage({ seq: this.drillSeq, from: 'owner', text, segments: [{ type: 'text', text }], ...tags });
    this.broadcast({ type: 'coach_msg', message: said });
    if (!walk && !card) return this.systemSay('Walk to a position of your repertoire, or start a card, and ask about it there.', tags);
    if (!this.coach.isOn) return this.systemSay('The coach is off: start it with the button above, then ask again.', tags);
    const seq = ++this.drillSeq;
    if (card) this.drillFor = this.openings.view.id ?? null;
    const fen = walk ? walk.fen : card!.fen;
    const you = walk ? walk.you : card!.card.colour;
    const last = walk ? walk.last : card!.last;
    let packet: FactPacket;
    try {
      packet = await this.facts.packet({ fen, you, deep: true, lastMove: last ? { san: last.san, by: this.moverOf(last.baseFen, you), fenBefore: last.baseFen } : undefined });
    } catch {
      return this.systemSay('The chess engine is not answering, so I cannot check anything right now.', tags);
    }
    // the repertoire move here, judged by the engine: what the coach cites when it explains the move
    const moveHere = walk ? walk.mine?.san : card!.card.move.san;
    const mine = moveHere ? await this.facts.checkMove(fen, moveHere, you) : null;
    if (seq !== this.drillSeq) return;
    const hidden = !!card?.asking;
    const canAnswer = !hidden;
    this.db.logEvent('ask', { text, opening: walk ? 'walk' : 'card', hidden });
    const payload = {
      event: 'opening_question',
      seq,
      mode: 'openings',
      ownerSaid: text,
      ownerAsksForAMove: asksForMove(text),
      youMayNameTheRepertoireMove: canAnswer,
      ...(walk ? { walk: this.walkForCoach(walk) } : { card: this.openingForCoach(card!) }),
      theRepertoireMove: mine?.legal && !hidden ? { move: mine.san, verdict: plainText(mine.verdict), cite: mine.factId, facts: mine.facts.map((f) => ({ id: f.id, type: f.type, text: f.text })) } : null,
      owner: { level: this.ownerLevel(), vocabulary: this.settings.get<string>('coach.vocabulary'), sayInPlainWords: this.keptForLater() },
      budget: this.budget(),
      facts: packetForCoach(packet),
    };
    // if the coach cannot answer: the engine's verdict on the repertoire move here (or, with the opponent to
    // move on the walk, on the move that led here); while the move is being recalled, a question naming none
    const sayInstead = !hidden && mine?.legal && mine.factId ? [mine.factId] : walk && packet.lastVerdict?.factId ? [packet.lastVerdict.factId] : undefined;
    this.coach.submit({
      seq,
      kind: 'opening_question',
      payload,
      needsReply: true,
      canAnswer,
      ownerText: text,
      ...(sayInstead ? { scriptedFacts: sayInstead } : { scripted: { kind: 'question' as const, text: OPENING_ASK_SCRIPT } }),
    });
  }

  /** The owner asks the endgame coach for help while playing: a question first, then a nudge; never the move (COACH §6.9). */
  private async askEndgameCoach(client: Client) {
    const v = this.endgames.view;
    const eg = this.endgames.coachState();
    if (!eg || !eg.playing || v.busy || !v.yourTurn) return;
    if (!this.coach.isOn) return client.send({ type: 'toast', level: 'info', text: 'The coach is off. Start it from the coach panel on the analysis board, or use Show the idea.' });
    this.endgames.noteHelp();
    const seq = ++this.drillSeq;
    this.drillFor = eg.id;
    const packet = await this.facts.packet({ fen: eg.fen, you: eg.you, deep: true, lastMove: eg.lastMove ? { san: eg.lastMove.san, by: 'opponent', fenBefore: eg.lastMove.baseFen } : undefined });
    if (seq !== this.drillSeq) return;
    const giveNow = (this.endgames.view.asked ?? 1) <= 1 ? 'question' : 'nudge';
    const payload = {
      event: 'endgame_ask',
      seq,
      mode: 'endgames',
      giveNow,
      go: this.endgameForCoach(eg),
      owner: { level: this.ownerLevel(), vocabulary: this.settings.get<string>('coach.vocabulary'), sayInPlainWords: this.keptForLater() },
      budget: this.budget(),
      facts: packetForCoach(packet),
    };
    this.coach.submit({ seq, kind: 'endgame_ask', payload, needsReply: true, canAnswer: false, scripted: { kind: 'question', text: ENDGAME_ASK_SCRIPT } });
  }

  /** The owner asks the coach for help on the puzzle: a rung of the hint ladder, in the coach's words. */
  private async askDrillCoach(client: Client) {
    const d = this.puzzles.drillState();
    if (!d || !d.solving) return;
    if (!this.coach.isOn) return client.send({ type: 'toast', level: 'info', text: 'The coach is off. Start it from the coach panel, or use Hint.' });
    this.puzzles.noteHelp();
    const now = this.puzzles.drillState() ?? d;
    const seq = ++this.drillSeq;
    this.drillFor = now.id;
    const packet = await this.drillPacket(now);
    if (seq !== this.drillSeq) return;
    // the ladder without its last rung: the answer is the app's to show
    const giveNow = now.hints <= 1 ? 'question' : 'nudge';
    const ideas = this.ideaMayBeNamed(now) ? this.ideaFacts(now.themes, now.solverFen, now.solution) : undefined;
    this.coach.submit({ seq, kind: 'drill_ask', payload: this.drillPayload('drill_ask', seq, now, packet, { giveNow, ...(ideas ? { ideas } : {}) }), needsReply: true, canAnswer: false, scripted: { kind: 'question', text: this.puzzleWords['hint.question'] } });
  }

  /** A sitting in numbers and words: how the puzzles went, the ideas met, and when they come back. */
  private sittingSummary(ids: number[]): Record<string, unknown> {
    let alone = 0;
    let helped = 0;
    let shown = 0;
    const ideas = new Set<string>();
    const ideaCites: { idea: string; cite: string }[] = [];
    const back = new Map<string, number>();
    const now = Date.now();
    for (const id of ids) {
      const last = this.db.attemptsOf(id).at(-1);
      if (!last) continue;
      if (last.result === 'shown') shown++;
      else if (last.hints === 0 && last.misses === 0) alone++;
      else helped++;
      const item = this.db.getContent(id);
      const themes = (item?.body.themes ?? []).filter((t) => !NOT_A_THEME.has(t) && !ideas.has(themeName(t)));
      for (const t of themes) ideas.add(themeName(t));
      const start = item ? solverStart(item.body) : null;
      if (item && start?.ok && themes.length) ideaCites.push(...this.ideaFacts(themes, start.fen, item.body.solution));
      const card = this.db.getCard(id);
      if (card) {
        const days = Math.max(1, Math.round((Date.parse(card.dueAt) - now) / 86_400_000));
        const when = days === 1 ? 'tomorrow' : days < 14 ? `in ${days} days` : `in about ${Math.round(days / 7)} weeks`;
        back.set(when, (back.get(when) ?? 0) + 1);
      }
    }
    return { puzzles: ids.length, solvedAlone: alone, solvedWithHelp: helped, shown, ideasMet: ideaCites, comesBack: [...back].map(([when, n]) => `${n} ${n === 1 ? 'comes' : 'come'} back ${when}`) };
  }

  /** Send the event to the coach, or let the scripted fallback answer when the coach is off. */
  private dispatch(ev: CoachEvent, packet: FactPacket, ask: ScriptedAsk, autoStart = false) {
    if (!this.coach.isOn && autoStart) this.coach.start();
    if (this.coach.isOn) return this.coach.submit(ev);
    if (!ev.needsReply) return;
    if (ev.scripted) return this.speakEventScript(ev);
    if (ask === 'show_me' && !packet.over) void this.showScripted(packet);
    else this.speakScripted(ask, packet);
  }

  /** "Show me" with the coach off: the engine plays its best line on the coach's board, and the checked facts say what it shows. */
  private async showScripted(packet: FactPacket) {
    const seq = this.session.state.seq;
    try {
      const r = await this.facts.engineLine({ baseFen: packet.fen, you: this.you(), what: 'best', maxPlies: this.settings.get<number>('coach.lineMaxPlies') });
      if (seq !== this.session.state.seq) return;
      if (!r.ok) return this.speakScripted('show_me', packet);
      this.putLineOnDemo(r, 'Best play', { fen: packet.fen, onDemo: false }, 'best');
      const main = r.facts.find((f) => f.type !== 'line');
      this.speakFacts([...(main ? [main.id] : []), r.id]);
      this.advanceLadder('answer', undefined, false);
    } catch (e) {
      this.log(`show me failed: ${(e as Error).message}`);
      if (seq === this.session.state.seq) this.speakScripted('show_me', packet);
    }
  }

  /** Put a line the engine built onto the coach's board, play it out for the owner, and have its moves labelled. */
  private putLineOnDemo(r: Extract<LineResult, { ok: true }>, label: string, base: { fen: string; onDemo: boolean; parent?: { line: string; ply: number } }, kind: NonNullable<DemoLine['kind']>): DemoLine {
    const s = this.session;
    if (!base.onDemo) {
      const demo = s.state.demo;
      if (!demo || demo.baseFen !== base.fen || s.state.layer !== 'demo') s.openDemo(label, base.fen);
    }
    const moves = this.demoMoves(r);
    // a threat line starts from the same position with the other side to move
    const line = s.addDemoLine({ label, baseFen: r.baseFen, moves, parent: base.parent, verdict: r.verdict, checkedBy: r.source.text, kind });
    s.demoGoto(line.id, moves.length);
    this.broadcast({ type: 'play_demo', demo: s.state.demo!.id, line: line.id, fromPly: 0, speedMs: this.settings.get<number>('coach.demoSpeedMs') });
    void this.labelDemoLine(s.state.demo!.id, line.id);
    return line;
  }

  /** The same, for an event that carries its own facts (a move tried on the coach's board). */
  private dispatchFacts(ev: CoachEvent) {
    if (this.coach.isOn) return this.coach.submit(ev);
    this.speakFacts(ev.scriptedFacts ?? []);
  }

  private scriptedAskFor(event: CoachEvent): ScriptedAsk {
    return event.kind === 'owner_question' ? 'question' : event.kind === 'hint_request' ? 'hint' : event.kind === 'owner_reply' || event.kind === 'owner_move' ? 'move' : (event.kind as ScriptedAsk);
  }

  private onTurnEnd(turn: Turn, how: 'done' | 'error' | 'timeout' | 'crash') {
    if (turn.fallbackSpoke || turn.accepted > 0 || !turn.event.needsReply) return;
    // the owner has moved on (each board counts its own events: the analysis board, the drills, the game)
    if (this.stale(turn.event.seq)) return;
    // the coach did not manage to answer: the scripted fallback does, from the same facts
    this.log(`coach turn ended (${how}) without a message; the scripted fallback answers`);
    turn.fallbackSpoke = true;
    if (turn.event.kind === 'owner_question' || turn.event.kind === 'opening_question' || turn.event.kind === 'drill_question') this.systemSay(how === 'done' ? 'The coach did not get an answer out. Here is what the board says for certain:' : 'The coach was interrupted. Here is what the board says for certain:', turn.event.kind === 'opening_question' ? this.openingTags() : turn.event.kind === 'drill_question' && this.drillFor !== null ? { drill: this.drillFor } : {});
    if (turn.event.scripted) return this.speakEventScript(turn.event);
    if (turn.event.scriptedFacts) return this.speakFacts(turn.event.scriptedFacts);
    // the analysis board's own scripted answers are about the analysis board
    if (DRILL_MODES.has(this.mode) || this.mode === 'play') return;
    const ask = this.scriptedAskFor(turn.event);
    const seq = this.session.state.seq;
    void this.focusPacket(true)
      .then((p) => {
        // only if the owner is still on the same position
        if (seq === this.session.state.seq) this.speakScripted(ask, p);
      })
      .catch(() => {});
  }

  private speakScripted(ask: ScriptedAsk, packet: FactPacket) {
    const s = scripted(ask, packet, this.ladder.level, this.templates);
    if (s.shapes?.length) this.session.setCoachShapes(s.shapes);
    this.deliver({ kind: s.kind, text: s.text, claims: s.claims, expect: s.expect, source: 'scripted', fen: packet.fen });
    this.advanceLadder(s.kind, s.expect, !!s.shapes?.length);
  }

  /** An event that brings its own words for the scripted coach (a moment of a game review): said as they are. */
  private speakEventScript(ev: CoachEvent) {
    const sc = ev.scripted!;
    this.deliver({ kind: sc.kind, text: sc.text, claims: sc.claims ?? [], expect: sc.expect, source: 'scripted', fen: DRILL_MODES.has(this.mode) || this.mode === 'play' ? this.boardFen() : this.session.focusFen() });
    this.advanceLadder(sc.kind, sc.expect, false);
    const seq = this.session.state.seq;
    if (sc.thenShowBest) {
      void this.focusPacket(true)
        .then((p) => (seq === this.session.state.seq && !p.over ? this.showScripted(p) : undefined))
        .catch(() => {});
    }
  }

  /** The scripted coach on a move the engine has just judged: it says the checked facts as they are. */
  private speakFacts(ids: string[]) {
    const facts = ids.map((id) => this.facts.fact(id)).filter((f): f is Fact => !!f);
    if (!facts.length) return;
    this.deliver({ kind: 'explain', text: facts.map((f) => f.text).join(' '), claims: facts.map((f) => f.id), source: 'scripted', fen: this.boardFen() });
  }

  /** The position on the board the coach is speaking beside: the tab's own board when it has one, else the analysis board. */
  private boardFen(): string {
    const endgame = this.mode === 'endgames' ? this.endgames.coachState() : null;
    if (endgame) return endgame.fen;
    const opening = this.openingNow();
    if (opening) return opening.fen;
    const walk = this.walkNow();
    if (walk) return walk.fen;
    const od = this.otherDrill();
    if (od) return od.fen;
    const drill = this.mode === 'puzzles' ? this.puzzles.drillState() : null;
    if (drill) return drill.fen;
    const spar = this.mode === 'play' ? this.play.sparState() : null;
    if (spar) return spar.fen;
    return this.session.visibleFen();
  }

  /** A line from the app itself; `tags` shows it beside the board it is about (a card, the walked repertoire). */
  private systemSay(text: string, tags: { walk?: boolean; drill?: number } = {}) {
    const m = this.session.addMessage({ seq: this.session.state.seq, from: 'system', text, segments: [{ type: 'text', text }], ...tags });
    this.broadcast({ type: 'coach_msg', message: m });
  }

  private advanceLadder(kind: SayKind, expect: string | undefined, drewArrow: boolean) {
    const seq = this.session.state.seq;
    if (this.ladder.seq !== seq) this.resetLadder();
    if (kind === 'question') this.ladder.level = Math.max(this.ladder.level, 1);
    else if (kind === 'nudge') this.ladder.level = Math.max(this.ladder.level, drewArrow ? 3 : 2);
    else if (kind === 'answer') this.ladder.level = 3;
    // the owner can answer on either board: their own, or the coach's (A18)
    if (expect === 'move') this.ladder.active = true;
    if (kind === 'answer' || kind === 'explain') this.ladder.active = false;
    this.ladderMoved();
  }

  /** Put a checked message into the thread and onto the page. Returns the validator's problems if it fails. */
  private deliver(m: { kind: SayKind; text: string; claims: string[]; expect?: string; choices?: string[]; source: 'coach' | 'scripted'; fen: string; turn?: Turn }): { ok: boolean; problems: string[]; message?: CoachMessage } {
    const explainish = m.kind === 'explain' || m.kind === 'answer' || m.kind === 'summary' || m.kind === 'idea' || m.kind === 'general';
    const b = this.budget();
    const drill = this.mode === 'puzzles' ? this.puzzles.drillState() : null;
    const spar = this.mode === 'play' ? this.play.sparState() : null;
    const opening = this.openingNow();
    const walk = opening ? null : this.walkNow();
    const endgame = this.mode === 'endgames' ? this.endgames.coachState() : null;
    // the safety check, the threat or a won game (D105): its board and side, in place of the puzzle's
    const od = drill ? null : this.otherDrill();
    // In a replay the app itself handed the coach the fact for what the game move cost. A message that names that
    // move is checked against that fact whether or not the coach remembered to list it: the claim is still checked.
    const rm = this.replay && this.replay.phase !== 'finished' ? this.replay.moments[this.replay.index] : undefined;
    const momentFact = rm?.factId && this.facts.fact(rm.factId) ? rm.factId : undefined;
    const claims = m.source === 'coach' && rm && momentFact && !m.claims.includes(momentFact) && m.text.includes(rm.san.replace(/[+#]/g, '')) ? [...m.claims, momentFact] : m.claims;
    const verdict = validateSay(
      { kind: m.kind, text: m.text, claims },
      {
        fen: m.fen,
        // while a demo is showing, the owner still has their own board (and the demo's start) in mind
        alsoFens: endgame ? (endgame.slip ? [endgame.slip.fenBefore] : endgame.lastMove ? [endgame.lastMove.baseFen] : []) : opening ? (opening.after ? [opening.after] : []) : walk ? (walk.last ? [walk.last.baseFen] : []) : od ? (od.also ?? []) : drill ? [drill.solverFen] : spar ? (spar.lastMove ? [spar.lastMove.fenBefore] : []) : this.session.state.layer === 'demo' && this.session.state.demo ? [this.session.focusFen(), this.session.state.demo.baseFen] : [],
        you: endgame ? endgame.you : opening ? opening.card.colour : walk ? walk.you : od ? od.you : drill ? drill.you : spar ? spar.you : this.you(),
        fact: this.facts.fact,
        budgetSentences: m.source === 'scripted' ? 12 : explainish ? b.explain : b.short,
        // the walk shows every move: nothing there is the owner's to find
        canAnswer: endgame ? !endgame.playing : opening ? !opening.asking : walk ? true : od ? !od.open : drill ? !drill.solving : spar ? !spar.playing : m.turn ? m.turn.event.canAnswer || this.ladder.level > 0 : true,
        numbersOn: this.settings.get<boolean>('display.numbers'),
        vocabulary: this.settings.get<VocabularyLevel>('coach.vocabulary'),
        ladder: this.concepts,
        ownerText: m.turn?.event.ownerText,
        // the move that led to the position on the owner's board: the coach may name it
        lastMove: (() => {
          if (endgame) return endgame.lastMove;
          if (opening) return opening.last;
          if (walk) return walk.last;
          if (drill) return drill.lastMove ? { san: drill.lastMove.san, baseFen: drill.lastMove.fenBefore } : undefined;
          if (spar) return spar.lastMove ? { san: spar.lastMove.san, baseFen: spar.lastMove.fenBefore } : undefined;
          const node = this.session.focusNode();
          const parent = node.parent ? this.session.state.tree.nodes[node.parent] : undefined;
          return this.session.state.layer === 'owner' && node.san && parent ? { san: node.san, baseFen: parent.fen } : undefined;
        })(),
      },
    );
    // the scripted templates are written against the facts; only their tokens need the board's word
    let problems = m.source === 'scripted' ? verdict.problems.filter((p) => p.rule === 'R1' || p.rule === 'R2') : verdict.problems;
    // length is about style, not truth: one sentence over is let through, and a message that is
    // only too long is never bounced twice (small models count sentences badly)
    const limit = explainish ? b.explain : b.short;
    if (m.source === 'coach' && problems.length && problems.every((p) => p.rule === 'R6') && m.text.trim() && (verdict.sentences <= limit + 1 || (m.turn?.rejects ?? 0) >= 1) && verdict.sentences <= limit + 3) {
      problems = [];
    }
    // a replay's open moment (B4): the better move is the owner's to find. The coach may not name it, in any kind of message
    const moment = this.replay?.phase === 'asking' ? this.replay.moments[this.replay.index] : undefined;
    if (moment && m.source === 'coach') {
      const plain = (san: string) => san.replace(/[+#!?]/g, '');
      const answers = new Set([moment.best, moment.teach?.move].filter((x): x is string => !!x).map(plain));
      const gaveAway = verdict.tokens.some((t) => t.kind === 'move' && answers.has(plain(t.san)));
      if (gaveAway || m.kind === 'answer') problems = [...problems, { rule: 'R7', message: 'The owner is still looking for the better move here: do not name it, and do not give the answer yet. Ask about the step that was skipped, or give a nudge that names no move.' }];
    }
    // a puzzle the owner is still solving (COACH §6.3): its moves are theirs to find, and in a mixed set so is its idea
    if (drill?.solving && m.source === 'coach') {
      const plain = (san: string) => san.replace(/[+#!?]/g, '');
      const answers = new Set([...drill.solution.filter((_, i) => i % 2 === 0), ...Object.values(drill.accepted).flat()].map(plain));
      if (verdict.tokens.some((t) => t.kind === 'move' && answers.has(plain(t.san))) || m.kind === 'answer') problems = [...problems, { rule: 'R7', message: 'The owner is still solving this puzzle: do not name its moves or give the answer. Ask about a step of the routine instead (their checks, captures and threats).' }];
      if (!this.ideaMayBeNamed(drill)) {
        const names = drill.themes.flatMap((t) => [themeName(t), t]).map((x) => x.toLowerCase());
        const said = names.find((n) => n.length > 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(m.text));
        if (said) problems = [...problems, { rule: 'R7', message: drill.set.kind === 'mixed' ? `This is a mixed set: the idea is hidden until the owner has answered. Do not name it ("${said}") or hint at it.` : `The owner knows this idea: let them find it without its name ("${said}"). Ask about the routine instead.` }];
      }
    }
    // an endgame being played (COACH §6.9): the moves are the owner's to find; the coach names none they could play, and gives no answer
    if (endgame?.playing && m.source === 'coach') {
      const pos = parsePosition(endgame.fen);
      const plain = (san: string) => san.replace(/[+#!?]/g, '');
      const mine = new Set(pos && pos.turn === endgame.you ? legalMoves(pos).map((x) => plain(x.san)) : []);
      if (verdict.tokens.some((t) => t.kind === 'move' && mine.has(plain(t.san))) || m.kind === 'answer') problems = [...problems, { rule: 'R7', message: 'The owner is playing this ending: do not name or suggest a move they could play, and do not give the answer. Ask a question or give a nudge about the idea instead (the squares their king has, where your king should go).' }];
    }
    // an opening card the owner is recalling (COACH §6.5): the repertoire move is theirs to find, whatever they ask
    if (opening?.asking && m.source === 'coach') {
      const plain = (san: string) => san.replace(/[+#!?]/g, '');
      if (verdict.tokens.some((t) => t.kind === 'move' && plain(t.san) === plain(opening.card.move.san)) || m.kind === 'answer') problems = [...problems, { rule: 'R7', message: 'The owner is recalling the repertoire move: do not name it or give the answer. Answer their question about the position, or give a nudge that names no move of theirs.' }];
    }
    // the safety check, the threat or a won game still open (D105): no move on the board that is the owner's to find
    // (their replies to list, the threat to name, the move to play), no answer, and while ruling no verdict on a move
    if (od?.open && m.source === 'coach') {
      const pos = parsePosition(od.fen);
      const plain = (san: string) => san.replace(/[+#!?]/g, '');
      const toFind = new Set((od.hidden ?? (pos ? legalMoves(pos).map((x) => x.san) : [])).map(plain));
      if (verdict.tokens.some((t) => t.kind === 'move' && toFind.has(plain(t.san))) || m.kind === 'answer') problems = [...problems, { rule: 'R7', message: 'The owner is still working this out: do not name a move on the board they are looking for, and do not give the answer. Ask a question about the routine, or give a nudge that names no move.' }];
      if (od.noVerdict && /\b(un)?safe\b|\bloses?\b|\bblunder|\bmistake|\bhang(s|ing)?\b/i.test(m.text)) problems = [...problems, { rule: 'R7', message: 'The owner has not ruled yet: do not say whether a move is safe or what it loses. Ask about their checks, captures and threats instead.' }];
    }
    // a game in progress (COACH §6.4): the coach never suggests a move the owner could play, and never gives the answer
    if (spar?.playing && m.source === 'coach') {
      const pos = parsePosition(spar.fen);
      const plain = (san: string) => san.replace(/[+#!?]/g, '');
      const mine = new Set(pos && pos.turn === spar.you ? legalMoves(pos).map((x) => plain(x.san)) : []);
      if (verdict.tokens.some((t) => t.kind === 'move' && mine.has(plain(t.san))) || m.kind === 'answer') problems = [...problems, { rule: 'R7', message: 'During a game the owner chooses their own moves: do not name or suggest a move they could play, and do not give an answer. Ask about the routine instead (their threat, checks and captures, the blunder check).' }];
    }
    const ok = problems.length === 0;
    this.db.saveCoachMessage({ runId: this.coach.currentRun, seq: this.session.state.seq, source: m.source, kind: m.kind, text: m.text, claims, ok, problems });
    if (!ok) return { ok, problems: problems.map((p) => p.message) };
    const cited = claims.map((id) => this.facts.fact(id)).filter((f): f is Fact => !!f);
    const sources = [...new Set(cited.map((f) => f.data.source).filter((x): x is string => typeof x === 'string'))];
    const checked = sources.length ? sources.join('; ') : cited.length ? 'Checked on the board' : undefined;
    const message = this.session.addMessage({
      checked,
      walk: walk ? true : undefined,
      drill: drill ? drill.id : !walk && DRILL_MODES.has(this.mode) && this.drillFor !== null ? this.drillFor : undefined,
      spar: spar ? spar.gameNo : undefined,
      seq: drill || DRILL_MODES.has(this.mode) ? this.drillSeq : spar ? this.sparSeq : this.session.state.seq,
      from: 'coach',
      source: m.source,
      kind: m.kind,
      text: verdict.plain,
      segments: verdict.segments,
      expect: (m.expect as CoachMessage['expect']) ?? 'none',
      choices: m.choices,
    });
    this.broadcast({ type: 'coach_msg', message });
    return { ok, problems: [], message };
  }

  // ------------------------------------------------------------ the coach's tools

  private stale(seq: number): ToolResult | null {
    const cur = DRILL_MODES.has(this.mode) ? this.drillSeq : this.mode === 'play' ? this.sparSeq : this.session.state.seq;
    if (seq === cur) return null;
    return { ok: false, stale: true, problems: [`stale: the board has moved on (seq ${cur}, you answered seq ${seq}). Drop this and wait for the next event.`] };
  }

  private baseFor(from: string | undefined): { ok: true; fen: string; parent?: { line: string; ply: number }; onDemo: boolean } | { ok: false; reason: string } {
    const s = this.session;
    const demo = s.state.demo;
    if (!from || from === 'focus') return { ok: true, fen: s.focusFen(), onDemo: false };
    if (from === 'demo') {
      if (!demo || s.state.layer !== 'demo') return { ok: false, reason: 'nothing is on your demo board. Use from "focus", or show_position first.' };
      return { ok: true, fen: demoFen(demo), parent: demo.cursor.line ? { line: demo.cursor.line, ply: demo.cursor.ply } : undefined, onDemo: true };
    }
    const at = this.lineAt(from);
    if (!at.ok) return at;
    return { ok: true, fen: at.ply === 0 ? at.line.baseFen : at.line.moves[at.ply - 1]!.fen, parent: { line: at.line.id, ply: at.ply }, onDemo: true };
  }

  /** "L3:2" → line L3 after two of its moves. */
  private lineAt(text: string): { ok: true; line: DemoLine; ply: number } | { ok: false; reason: string } {
    const demo = this.session.state.demo;
    const m = /^(L\d+):(\d+)$/.exec(text.trim());
    if (!m || !demo) return { ok: false, reason: 'give "focus", "demo", or a line and move count like "L3:2".' };
    const line = demo.lines.find((l) => l.id === m[1]);
    const ply = Number(m[2]);
    if (!line) return { ok: false, reason: `there is no line ${m[1]}. Lines: ${demo.lines.map((l) => l.id).join(', ') || 'none'}.` };
    if (ply < 0 || ply > line.moves.length) return { ok: false, reason: `line ${line.id} has ${line.moves.length} moves; "${text}" is out of range.` };
    return { ok: true, line, ply };
  }

  readonly tools: CoachTools = {
    get_state: async () => {
      if (this.mode === 'play') {
        const g = this.play.sparState();
        if (!g) return { seq: this.sparSeq, mode: 'play', game: null, note: 'No game is being played. Say nothing.' };
        return { seq: this.sparSeq, mode: 'play', fen: g.fen, ownerPlays: g.you, game: this.gameForCoach(g) };
      }
      if (this.openingSet()) {
        const w = this.walkNow();
        if (w) return { seq: this.drillSeq, mode: 'openings', fen: w.fen, ownerPlays: w.you, walk: this.walkForCoach(w) };
        const o = this.openingNow();
        if (!o) return { seq: this.drillSeq, mode: 'openings', card: null, note: 'No opening card is on the board. Say nothing.' };
        return { seq: this.drillSeq, mode: 'openings', fen: o.asking || !o.after ? o.fen : o.after, ownerPlays: o.card.colour, card: this.openingForCoach(o) };
      }
      if (this.mode === 'endgames') {
        const eg = this.endgames.coachState();
        if (!eg) return { seq: this.drillSeq, mode: 'endgames', go: null, note: 'No ending is being played. Say nothing.' };
        return { seq: this.drillSeq, mode: 'endgames', fen: eg.fen, ownerPlays: eg.you, go: this.endgameForCoach(eg) };
      }
      if (this.mode === 'puzzles') {
        const od = this.otherDrill();
        if (od) return { seq: this.drillSeq, mode: 'puzzles', fen: od.fen, ownerPlays: od.you, drill: od.kind, about: od.brief, youMayGiveTheAnswer: !od.open };
        const d = this.puzzles.drillState();
        if (!d) return { seq: this.drillSeq, mode: 'puzzles', puzzle: null, note: 'No puzzle is on the board. Say nothing.' };
        const pos = mustPosition(d.fen);
        return { seq: this.drillSeq, mode: 'puzzles', fen: d.fen, toMove: pos.turn === d.you ? 'the owner' : 'the opponent', ownerPlays: d.you, puzzle: this.puzzleForCoach(d) };
      }
      const s = this.session.state;
      const fen = this.session.visibleFen();
      const pos = mustPosition(fen);
      const last = this.session.lastMove();
      return {
        seq: s.seq,
        mode: s.mode,
        layer: s.layer === 'demo' ? 'demo (the owner is looking at your demo board)' : 'owner (their own board)',
        fen,
        toMove: pos.turn === this.you() ? 'the owner' : 'the opponent',
        ownerPlays: this.you(),
        lastMoveOnOwnersBoard: last ? `${last.san} (${last.by})` : null,
        gameSoFar: this.movesSoFar(),
        boardShows: this.boardShows() ?? null,
        ladder: { rungsGiven: this.ladder.level, misses: this.ladder.misses },
        verbosity: this.settings.get<string>('coach.verbosity.analysis'),
        ownerDrew: this.ownerDrew() ?? null,
        fairPlay: this.blocked() ? `${this.blocked()} Say only that, as kind "general": nothing about the position.` : null,
        demo: s.demo
          ? {
              showing: s.demo.label,
              at: s.demo.cursor.line ? `${s.demo.cursor.line}:${s.demo.cursor.ply}` : 'the base position',
              lines: s.demo.lines.map((l) => ({ id: l.id, label: l.label, moves: l.moves.map((m) => m.san + m.mark).join(' '), branchesFrom: l.parent ? `${l.parent.line}:${l.parent.ply}` : 'the base position', ownersOwnTry: l.kind === 'alt' || undefined })),
            }
          : null,
      };
    },

    get_facts: async ({ target }) => {
      const stop = this.blocked();
      if (stop) return { ok: false, problems: [stop] };
      if (target === 'demo') {
        const demo = this.session.state.demo;
        if (!demo || this.session.state.layer !== 'demo') return { ok: false, problems: ['nothing is on your demo board'] };
        const p = await this.facts.packet({ fen: demoFen(demo), you: this.you(), deep: true });
        return { ok: true, facts: packetForCoach(p) };
      }
      if (this.mode === 'endgames') {
        const eg = this.endgames.coachState();
        if (!eg) return { ok: false, problems: ['no ending is being played'] };
        return { ok: true, facts: packetForCoach(await this.facts.packet({ fen: eg.fen, you: eg.you, deep: true, lastMove: eg.lastMove ? { san: eg.lastMove.san, by: eg.playing ? 'opponent' : 'owner', fenBefore: eg.lastMove.baseFen } : undefined })) };
      }
      if (this.openingSet()) {
        const w = this.walkNow();
        if (w) return { ok: true, facts: packetForCoach(await this.facts.packet({ fen: w.fen, you: w.you, deep: true, lastMove: w.last ? { san: w.last.san, by: this.moverOf(w.last.baseFen, w.you), fenBefore: w.last.baseFen } : undefined })) };
        const o = this.openingNow();
        if (!o) return { ok: false, problems: ['no opening card is on the board'] };
        return { ok: true, facts: packetForCoach(await this.facts.packet({ fen: o.fen, you: o.card.colour, deep: true, lastMove: o.last ? { san: o.last.san, by: 'opponent', fenBefore: o.last.baseFen } : undefined })) };
      }
      if (this.mode === 'puzzles') {
        const od = this.otherDrill();
        if (od) return { ok: true, facts: packetForCoach(await this.facts.packet({ fen: od.fen, you: od.you, deep: true })) };
        const d = this.puzzles.drillState();
        if (!d) return { ok: false, problems: ['no puzzle is on the board'] };
        return { ok: true, facts: packetForCoach(await this.drillPacket(d)) };
      }
      if (this.mode === 'play') {
        const g = this.play.sparState();
        if (!g) return { ok: false, problems: ['no game is being played'] };
        return { ok: true, facts: packetForCoach(await this.gamePacket(g)) };
      }
      return { ok: true, facts: packetForCoach(await this.focusPacket(true)) };
    },

    // what the owner can practise (H6): live puzzles from their games, and the database's themes at their level
    find_content: async ({ theme }) => {
      const fromGames = this.db
        .listContent({ status: 'live', type: 'puzzle_game', limit: 200 })
        .filter((x) => !theme || x.body.themes.includes(theme))
        .slice(0, 20)
        .map((x) => ({ id: x.id, kind: x.body.kind, from: x.source, themes: x.body.themes.map(themeName) }));
      const view = this.puzzles.view;
      return {
        ok: true,
        puzzlesFromYourGames: fromGames,
        databaseThemesAtYourLevel: view.catalogue ? view.catalogue.filter((t) => !theme || t.theme === theme).slice(0, 15).map((t) => `${t.name} (${t.count})`) : 'the Lichess puzzle database is not installed',
        puzzleLevel: view.level,
        howToUseIt: 'Suggest practice in words; the owner starts it on the Puzzles tab. Never name a puzzle\'s answer.',
      };
    },

    // what the app knows about the owner from their own games (H5): counted by code, in plain lines
    owner_profile: async () => {
      const game = this.session.state.game;
      const own = game && !this.ownPending() ? this.db.getSelfReview(game.id) : undefined;
      const report = game && !this.ownPending() ? this.db.getReport(game.id) : undefined;
      return {
        ok: true,
        profile: profileInWords(this.library.profile()),
        habitsTheReviewsKeepComingBackTo: this.db.journal().slice(0, 3).map((j) => `${STEP_HABIT[j.step]} (in ${j.games} ${j.games === 1 ? 'game' : 'games'})`),
        // how well the owner knows each tactical idea, from their puzzles (G7): how much to explain
        ideasFromPuzzles: this.motifs().slice(0, 8).map((x) => `${themeName(x.motif)}: ${STAGE_WORDS[x.stage]} (${x.alone} of the last ${x.recent} solved alone)`),
        thisGame: game ? { ownersOwnNotes: own?.notes || null, ownersNoteForNextTime: report?.note || null, takeaways: report?.report.takeaways.map((t) => t.text) ?? [] } : null,
        howToUseIt: 'To choose what to dwell on and how much to explain: show a new idea, ask about a known one. Do not read the numbers out.',
      };
    },

    check_move: async ({ move, from }) => {
      const stop = this.blocked();
      if (stop) return { ok: false, problems: [stop] };
      if (this.mode === 'play') return { ok: false, problems: ['During a game against a bot no move is judged out loud: the owner thinks for themselves. Talk about the routine with say.'] };
      const drill = this.mode === 'puzzles' ? this.puzzles.drillState() : null;
      // on the Puzzles tab a move is judged on the puzzle board; while the owner is solving, a move of the solution is not to be judged out loud
      if (drill?.solving && drill.solution.some((s, i) => i % 2 === 0 && s.replace(/[+#]/g, '') === move.replace(/[+#]/g, ''))) return { ok: false, problems: ['The owner is still solving this puzzle: do not check or name the move they are looking for.'] };
      // in the opening drill a move is judged in the card's position; while the owner recalls the move, the card's own move is not
      const opening = this.openingNow();
      if (opening?.asking && opening.card.move.san.replace(/[+#]/g, '') === move.replace(/[+#]/g, '')) return { ok: false, problems: ['The owner is recalling this move: do not check or name it.'] };
      const endgame = this.mode === 'endgames' ? this.endgames.coachState() : null;
      const egFen = endgame ? (endgame.playing ? endgame.fen : (endgame.slip?.fenBefore ?? endgame.lastMove?.baseFen ?? endgame.fen)) : undefined;
      const base = egFen ? ({ ok: true, fen: egFen } as const) : opening ? ({ ok: true, fen: opening.fen } as const) : drill ? ({ ok: true, fen: drill.fen } as const) : this.baseFor(from);
      if (!base.ok) return { ok: false, problems: [base.reason] };
      const r = await this.facts.checkMove(base.fen, move, endgame ? endgame.you : opening ? opening.card.colour : drill ? drill.you : this.you());
      if (!r.legal) return { ok: true, legal: false, reason: r.reason, cite: r.factId, howToSayIt: `Give this reason and no other, and put ${r.factId ?? 'the id in cite'} in claims: then you may write the move as plain ${move}.`, legalMoves: r.legalMoves };
      // the verdict in a few words, as the board's label has it: never "good" for a move that costs something or passes a chance over
      const g = r.grade;
      const quality = g.isBest
        ? 'the strongest move'
        : r.class === 'blunder'
          ? 'a serious mistake'
          : r.class === 'mistake'
            ? 'a mistake'
            : r.class === 'inaccuracy'
              ? 'an inaccuracy: playable, not the best'
              : g.missed
                ? 'playable, but it passes a chance over'
                : g.playedDelta < 0
                  ? 'playable'
                  : 'a good move';
      return { ok: true, legal: true, move: r.san, quality, checkedBy: r.facts[0]?.data.source, facts: r.facts.map((f) => ({ id: f.id, type: f.type, text: f.text })), cite: r.factId };
    },

    say: async (a) => {
      const turn = this.coach.currentTurn;
      const st = this.stale(a.seq);
      if (st) return st;
      if (!turn) return { ok: false, problems: ['no event is open: wait for the next event'] };
      if (turn.fallbackSpoke) return { ok: false, problems: ['this event has already been answered; stop'] };
      const max = this.settings.get<number>('coach.messagesPerTurn');
      if (turn.accepted >= max) return { ok: false, problems: [`you have sent ${max} messages for this event, which is the limit. Stop here.`] };
      const kind = a.kind as SayKind;
      const res = this.deliver({ kind, text: a.text, claims: a.claims ?? [], expect: a.expect, choices: a.choices, source: 'coach', fen: this.boardFen(), turn });
      if (turn.accepted === 0 && turn.rejects === 0) this.coach.noteFirstTry(res.ok);
      if (res.ok) {
        turn.accepted++;
        // the hint ladder belongs to the analysis board
        const elsewhere = (this.mode === 'puzzles' && (this.puzzles.drillState() || this.otherDrill())) || (this.mode === 'play' && this.play.sparState()) || this.openingNow() || this.walkNow() || (this.mode === 'endgames' && this.endgames.coachState());
        if (!elsewhere) this.advanceLadder(kind, a.expect, false);
        return { ok: true, id: res.message!.id, messagesLeft: max - turn.accepted };
      }
      turn.rejects++;
      const attemptsLeft = Math.max(0, 3 - turn.rejects);
      if (attemptsLeft === 0 && turn.accepted === 0 && turn.event.needsReply) {
        // after repeated rejects the scripted fallback speaks, so the owner is never left waiting
        turn.fallbackSpoke = true;
        if (turn.event.kind === 'owner_question') this.systemSay("The coach's answer did not pass the fact check, so it was held back. Here is what the board says for certain:");
        if (turn.event.scriptedFacts) this.speakFacts(turn.event.scriptedFacts);
        else this.speakScripted(this.scriptedAskFor(turn.event), await this.focusPacket(true));
        return { ok: false, problems: res.problems, attemptsLeft: 0, note: 'The scripted fallback has answered the owner instead. Stop for this event.' };
      }
      return { ok: false, problems: res.problems, attemptsLeft };
    },

    annotate: async (a) => {
      if (this.mode === 'puzzles' || this.mode === 'play') return { ok: false, problems: [NOT_ON_PUZZLES] };
      const st = this.stale(a.seq);
      if (st) return st;
      const stop = this.blocked();
      if (stop) return { ok: false, problems: [stop] };
      let ids = a.facts ?? [];
      let picked: Fact[] = [];
      if (a.show) {
        // a whole category, worked out by code for the board that is showing: the coach names no square
        const packet = await this.visiblePacket();
        if (this.stale(a.seq)) return this.stale(a.seq)!;
        picked = factsToShow(a.show as ShowWhat, packet);
        if (!picked.length) {
          const quiet = packet.facts.find((f) => f.type === 'quiet' && f.data.side === (a.show === 'targets' ? 'theirs' : 'mine'));
          return { ok: true, drawn: 0, note: `There is nothing of that kind to show on this board.${quiet ? ` ${quiet.text} (to say so, cite ${quiet.id})` : ''}`, facts: quiet ? [{ id: quiet.id, type: quiet.type, text: quiet.text }] : [] };
        }
        ids = picked.map((f) => f.id);
      }
      if (!ids.length) {
        if (a.clear) this.session.setCoachShapes([]);
        return a.clear ? { ok: true } : { ok: false, problems: ['give the ids of the facts to draw, e.g. facts: ["P7.F4"], or show: "threats" | "targets" | "attacks"'] };
      }
      const visible = mustPosition(this.session.visibleFen());
      const shapes: Shape[] = [];
      const skipped: string[] = [];
      for (const id of ids) {
        const fact = this.facts.fact(id);
        if (!fact) {
          skipped.push(`${id}: there is no such fact`);
          continue;
        }
        const got = shapesForFact(fact, visible, this.you());
        if (!got.length) skipped.push(`${id}: a ${fact.type} fact has nothing to draw on the board that is showing`);
        shapes.push(...got);
      }
      if (!shapes.length) return { ok: false, problems: skipped };
      const seen = new Set<string>();
      const unique = shapes.filter((x) => {
        const k = `${x.from}${x.to ?? ''}${x.style}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
      this.session.setCoachShapes(unique);
      // an arrow is the third rung of the hint ladder, but only when the owner asked for a hint
      if (this.coach.currentTurn?.event.kind === 'hint_request' && unique.some((x) => x.to)) this.advanceLadder('nudge', undefined, true);
      const out: ToolResult = { ok: true, drawn: unique.length };
      if (a.show) out.facts = picked.map((f) => ({ id: f.id, type: f.type, text: f.text }));
      if (skipped.length && !a.show) out.skipped = skipped;
      return out;
    },

    show_position: async (a) => {
      if (this.mode === 'puzzles' || this.mode === 'play') return { ok: false, problems: [NOT_ON_PUZZLES] };
      const st = this.stale(a.seq);
      if (st) return st;
      if (a.restore) {
        this.session.closeDemo();
        return { ok: true, showing: "the owner's own board" };
      }
      if (a.at) {
        // step your own demo board to a moment of a line you have shown
        const demo = this.session.state.demo;
        if (!demo) return { ok: false, problems: ['nothing is on your demo board yet: use play_line or show_position with moves or a fen first'] };
        if (a.at.trim() === 'base') this.session.demoGoto(null, 0);
        else {
          const at = this.lineAt(a.at);
          if (!at.ok) return { ok: false, problems: [at.reason] };
          this.session.demoGoto(at.line.id, at.ply);
        }
        const p = await this.facts.packet({ fen: demoFen(demo), you: this.you(), deep: true });
        return { ok: true, showing: demo.label, at: a.at.trim(), note: 'The owner now sees that moment on your demo board. Bare tokens refer to it.', facts: packetForCoach(p) };
      }
      let fen: string | null = null;
      let way: string[] = [];
      if (a.fen) fen = parsePosition(a.fen) ? a.fen : null;
      else if (a.moves) {
        const r = playLine(START_FEN, a.moves);
        if (!r.ok) return { ok: false, problems: [`move ${r.at + 1} (${r.move}) is not legal from the starting position. Legal there: ${r.legal.slice(0, 30).join(', ')}`] };
        fen = r.fens.at(-1)!;
        way = r.fens;
      }
      if (!fen) return { ok: false, problems: ['give a valid fen, moves from the starting position, or at: "L3:2"'] };
      // fair play (H10): not a position from a game the owner is still playing, and nothing while they are looking at one
      const shown = this.library.guard(way.length ? way : [fen]);
      const stop = this.blocked() ?? (shown ? guardText(shown) : null);
      if (stop) return { ok: false, problems: [stop] };
      const demo = this.session.openDemo(a.label ?? 'A position', fen);
      void this.gaugeDemoBase(demo.id);
      const p = await this.facts.packet({ fen, you: this.you(), deep: true });
      return { ok: true, showing: a.label ?? 'A position', note: 'The owner now sees this position on your demo board and may try moves on it. Bare tokens refer to it.', facts: packetForCoach(p) };
    },

    play_line: async (a) => {
      if (this.mode === 'puzzles' || this.mode === 'play') return { ok: false, problems: [NOT_ON_PUZZLES] };
      const st = this.stale(a.seq);
      if (st) return st;
      const s = this.session;
      if (s.state.mode === 'spar') return { ok: false, problems: ['lines are not shown during a live game'] };
      // a replay's open moment: the engine's best line is the answer the owner is looking for
      if (this.replay?.phase === 'asking' && a.what === 'best') return { ok: false, problems: ['The owner is still looking for the better move here: do not show it yet. Ask about the step that was skipped, or give a nudge that names no move.'] };
      const stop = this.blocked();
      if (stop) return { ok: false, problems: [stop] };
      if (a.what === 'move' && !a.move) return { ok: false, problems: ['with what "move", give the one move to try, e.g. move: "Nxe5"'] };
      const base = this.baseFor(a.from);
      if (!base.ok) return { ok: false, problems: [base.reason] };
      // the engine builds the line: the coach names at most its first move
      const r = await this.facts.engineLine({ baseFen: base.fen, you: this.you(), what: a.what, move: a.move, maxPlies: this.settings.get<number>('coach.lineMaxPlies') });
      if (!r.ok) return { ok: false, problems: [r.reason], facts: r.facts?.map((f) => ({ id: f.id, type: f.type, text: f.text })) };
      if (this.stale(a.seq)) return this.stale(a.seq)!;
      // the title is the coach's words above the engine's line: it may not name a move the line does not start with, or the wrong side's threat
      const firstBy = mustPosition(r.baseFen).turn === this.you() ? 'you' : 'they';
      const titleWrong = a.label ? lineTitleProblems(a.label, { moves: r.moves, firstBy }) : [];
      if (titleWrong.length) {
        return {
          ok: false,
          problems: [
            ...titleWrong.map((p) => `Nothing was shown: ${p}.`),
            'Give a title that says what this line is, or leave the title out and the page names it.' +
              (a.what === 'threat' ? ` What "threat" shows is what the side not to move would play with a free move; the best play of the side to move (${firstBy === 'you' ? 'theirs' : 'yours'} here) is what "best".` : ''),
          ],
        };
      }
      const label = a.label ?? (a.what === 'threat' ? (firstBy === 'you' ? 'Your threat' : 'Their threat') : a.what === 'best' ? 'Best play' : `If ${r.moves[0]}`);
      const line = this.putLineOnDemo(r, label, base, a.what);
      this.db.logEvent('play_line', { what: a.what, line: r.moves, marks: r.marks });
      return {
        ok: true,
        line: line.id,
        shown: r.moves.map((m, i) => m + r.marks[i]).join(' '),
        result: r.summary,
        checkedBy: r.source.text,
        facts: r.facts.map((f) => ({ id: f.id, type: f.type, text: f.text })),
        cite: r.id,
        note: `The owner is watching this on your demo board, with the engine's verdict printed beside it. Bare tokens now refer to the line's last position. For a subline use from "${line.id}:<moves played>".`,
      };
    },
  };
}

function sameGauge(a: TreeNode['gauge'], b: TreeNode['gauge']): boolean {
  return !!a && !!b && a.white === b.white && a.mate === b.mate && a.cp === b.cp && a.over === b.over;
}

function sameJudged(a: TreeNode['judged'], b: TreeNode['judged']): boolean {
  return !!a && !!b && a.label === b.label && a.why === b.why && a.best === b.best && a.sure === b.sure;
}

/**
 * The facts behind "show me the threats / the targets / everything that is attacked": picked by
 * code from the packet of the board that is showing, never from squares the coach supplies.
 */
export function factsToShow(what: ShowWhat, p: FactPacket): Fact[] {
  const you = p.you;
  const d = (f: Fact) => f.data as Record<string, any>;
  const pick = (test: (f: Fact) => boolean) => p.facts.filter(test).slice(0, 8);
  if (what === 'threats') {
    // what the other side is doing to the owner: pieces that can be taken, a check, a pin, the threat itself
    return pick((f) => (f.type === 'hangs' && d(f).side === 'mine') || (f.type === 'check' && d(f).side === you) || (f.type === 'pin' && d(f).pinned?.color === you) || (!!p.threat && f.id === p.threat.factId));
  }
  if (what === 'targets') {
    // the owner's chances: their pieces that can be taken, a pin on them, the owner's own threat, a fork
    return pick((f) => (f.type === 'hangs' && d(f).side === 'theirs') || (f.type === 'check' && d(f).side !== you) || (f.type === 'pin' && d(f).pinned?.color !== you) || (f.type === 'threat' && d(f).side === you) || (f.type === 'fork' && d(f).side === you));
  }
  return pick((f) => f.type === 'attack' || f.type === 'hangs');
}

/**
 * What to draw for a fact: arrows and squares come from the fact's own data, never from the model.
 * A move is drawn only when its piece really stands on that square on the board that is showing.
 * A square on its own is drawn as a box: red for a piece of the owner's in danger, amber for a target.
 */
export function shapesForFact(fact: Fact, visible: ReturnType<typeof mustPosition>, you: Color): Shape[] {
  const out: Shape[] = [];
  const d = fact.data as Record<string, any>;
  const stands = (ref: { square: string; role: string; color: string } | undefined) => {
    if (!ref) return false;
    const sq = parseSquare(ref.square);
    const piece = sq === undefined ? undefined : visible.board.get(sq);
    return !!piece && piece.role === ref.role && piece.color === ref.color;
  };
  const moveArrow = (san: unknown, baseFen: unknown, style?: ShapeStyle) => {
    if (typeof san !== 'string') return;
    const pos = typeof baseFen === 'string' ? parsePosition(baseFen) : visible;
    const m = pos ? anyToMove(pos, san) : null;
    if (!pos || !m) return;
    const info = describeMove(pos, m);
    if (!stands({ square: info.from, role: info.role, color: info.color })) return;
    out.push({ from: info.from, to: info.to, style: style ?? (info.color === you ? 'move' : 'threat') });
  };
  const fenAfterFirst = () => {
    if (typeof d.baseFen !== 'string' || !Array.isArray(d.line) || !d.line[0]) return undefined;
    const r = playLine(d.baseFen, [d.line[0]]);
    return r.ok ? r.fens[1] : undefined;
  };
  switch (fact.type) {
    case 'hangs':
    case 'attack': {
      const mine = d.piece?.color === you;
      for (const a of (d.attackers ?? []).slice(0, 2)) if (stands(a) && stands(d.piece)) out.push({ from: a.square, to: d.piece.square, style: mine ? 'threat' : 'move' });
      if (fact.type === 'hangs' && stands(d.piece)) out.push({ from: d.piece.square, style: mine ? 'danger' : 'target' });
      break;
    }
    case 'pin':
      if (stands(d.by) && stands(d.pinned)) {
        out.push({ from: d.by.square, to: d.pinned.square, style: 'threat' });
        out.push({ from: d.pinned.square, style: d.pinned.color === you ? 'danger' : 'target' });
      }
      break;
    case 'check': {
      const king = visible.board.kingOf(d.side);
      if (king === undefined) break;
      let drew = false;
      for (const c of d.checkers ?? []) {
        if (!stands(c)) continue;
        out.push({ from: c.square, to: makeSquare(king), style: 'threat' });
        drew = true;
      }
      if (drew) out.push({ from: makeSquare(king), style: d.side === you ? 'danger' : 'target' });
      break;
    }
    case 'castling':
      if (d.move) moveArrow(d.move, d.baseFen);
      for (const b of d.blockers ?? []) if (stands(b)) out.push({ from: b.square, style: 'target' });
      break;
    case 'fork':
      moveArrow(d.move, d.baseFen);
      for (const t of d.targets ?? []) out.push({ from: t.square, style: 'target' });
      break;
    case 'material':
    case 'opening':
    case 'quiet':
    case 'game_over':
    case 'cct':
    case 'illegal':
      break;
    default: {
      // a fact about a move: the move itself, and for a mistake the reply that punishes it
      moveArrow(d.move ?? d.line?.[0], d.baseFen);
      const bad = d.verdictForYou === 'bad' || fact.type === 'unsafe' || fact.type === 'loses_material';
      if ((bad || fact.type === 'graded') && d.line?.[1]) moveArrow(d.line[1], fenAfterFirst());
      break;
    }
  }
  return out;
}

function validSquare(sq: string): boolean {
  return /^[a-h][1-8]$/.test(sq);
}
