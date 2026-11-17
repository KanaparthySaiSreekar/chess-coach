// The settings registry (ARCHITECTURE §14, features K1, K2, K7). The owner's rule (D19): keep
// everything, make it an option. Every behaviour registers a setting with a default and a one-line
// reason; every change is written to the database and to the events log.

import { seedProblems, type PresetView, type SettingValue } from '@chess-coach/core';
import type { Db } from './db.ts';

export type SettingType = 'boolean' | 'number' | 'choice' | 'text';
export type SettingDef = {
  key: string;
  group: string;
  label: string;
  type: SettingType;
  default: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** what each option is called on the page */
  optionLabels?: Record<string, string>;
  /** a technical knob: the settings page keeps it out of the way unless asked */
  advanced?: boolean;
  /** a text setting: what it must look like (an empty value is always allowed) */
  pattern?: RegExp;
  /** a text setting: what is wrong with a value, in plain words (null: nothing) */
  check?: (value: string) => string | null;
  why: string;
  source: 'research' | 'owner' | 'technical';
};

export const SETTINGS: SettingDef[] = [];
const byKey = new Map<string, SettingDef>();

export function defineSetting(def: SettingDef): SettingDef {
  if (byKey.has(def.key)) throw new Error(`setting defined twice: ${def.key}`);
  SETTINGS.push(def);
  byKey.set(def.key, def);
  return def;
}

const SPEAKS = { silent: 'Only when asked', key_moments: 'At key moments', every_move: 'On every move' };

// ---- what the board shows
defineSetting({ key: 'display.evalBar', group: 'Board', label: 'Eval bar', type: 'boolean', default: true, why: 'Shows who is better as a bar beside the board, in winning chances. On because you asked for it; the research default was hidden, and "Think first" turns it off in one click (A6, D39).', source: 'owner' });
defineSetting({ key: 'display.bestArrows', group: 'Board', label: 'Best-move arrows', type: 'boolean', default: true, why: "Draws the engine's first choice on the board. Held back while the coach is waiting for you to find a move (A16, D39).", source: 'owner' });
defineSetting({ key: 'display.bestArrowCount', group: 'Board', label: 'How many best moves to draw', type: 'number', min: 1, max: 3, step: 1, default: 1, why: 'One arrow keeps the board readable; two or three also show moves that are about as good.', source: 'owner' });
defineSetting({ key: 'display.moveLabels', group: 'Board', label: 'Move labels (best, good, mistake, blunder…)', type: 'boolean', default: true, why: 'Every move you look at gets a label the way Chess.com shows them, worked out by the engine with Lichess\'s grading (A17). The coach still tells you the plain consequence.', source: 'owner' });
defineSetting({ key: 'display.betterMoveArrow', group: 'Board', label: 'Show the move that should have been played', type: 'boolean', default: true, why: 'When a move is labelled an inaccuracy, a mistake, a miss or a blunder, a green arrow shows the better move from where the piece stood, as on Chess.com (A19).', source: 'owner' });
defineSetting({ key: 'display.knightArrows', group: 'Board', label: "Arrows for a knight's move", type: 'choice', options: ['bent', 'straight'], optionLabels: { bent: 'Bent, like the move', straight: 'Straight' }, default: 'bent', why: "A straight arrow for a knight cuts across the pieces in between; a bent one follows the knight's own path, as on Chess.com (A19).", source: 'owner' });
defineSetting({ key: 'display.material', group: 'Board', label: 'Captured pieces beside the board', type: 'choice', options: ['captured', 'difference', 'off'], optionLabels: { captured: 'Every piece taken, and +2 for the side ahead', difference: 'Only what one side is up', off: 'Off' }, default: 'captured', why: 'You asked for it: the pieces each side has taken on its edge of the board and +2 or +3 for the side ahead, as Chess.com shows it; or only the difference, as Lichess does (I17).', source: 'owner' });
defineSetting({ key: 'display.engineLines', group: 'Board', label: 'Engine lines', type: 'boolean', default: false, why: 'Hidden by default so you think first; the engine is the checker, not the teacher (D15).', source: 'research' });
defineSetting({ key: 'display.numbers', group: 'Board', label: 'Engine numbers', type: 'boolean', default: false, why: '"You lose a knight" teaches more than "-3.2" at this level.', source: 'research' });
defineSetting({ key: 'display.notation', group: 'Board', label: 'Moves written with', type: 'choice', options: ['figurine', 'letters'], optionLabels: { figurine: 'Piece icons', letters: 'Letters (N, Q)' }, default: 'figurine', why: 'A small picture of the piece is quicker to read than its letter (I13).', source: 'owner' });
defineSetting({ key: 'display.coordinates', group: 'Board', label: 'Board coordinates', type: 'boolean', default: true, why: "Coordinates make the coach's squares easy to find.", source: 'owner' });
defineSetting({ key: 'display.boardTheme', group: 'Board', label: 'Board colours', type: 'choice', options: ['brown', 'blue', 'green', 'grey', 'tournament', 'walnut', 'sand', 'olive', 'ice', 'slate', 'purple', 'coral', 'pink'], optionLabels: { brown: 'Brown', blue: 'Blue', green: 'Green', grey: 'Grey', tournament: 'Tournament green', walnut: 'Walnut', sand: 'Sand', olive: 'Olive', ice: 'Ice', slate: 'Slate', purple: 'Purple', coral: 'Coral', pink: 'Pink' }, default: 'brown', why: 'A matter of taste (I9).', source: 'owner' });
defineSetting({ key: 'display.pieceSet', group: 'Board', label: 'Pieces', type: 'choice', options: ['cburnett', 'merida', 'chessnut', 'mpchess', 'pirouetti', 'fantasy', 'spatial', 'celtic', 'papercut', 'totoy', 'firi', 'rhosgfx', 'pixel', 'shapes', 'kiwen-suwi', 'letter'], optionLabels: { cburnett: 'Classic', merida: 'Merida', chessnut: 'Chessnut', mpchess: 'MPChess', pirouetti: 'Pirouetti', fantasy: 'Fantasy', spatial: 'Spatial', celtic: 'Celtic', papercut: 'Papercut', totoy: 'Totoy', firi: 'Firi', rhosgfx: 'Rhos', pixel: 'Pixel', shapes: 'Shapes', 'kiwen-suwi': 'Kiwen Suwi', letter: 'Letters' }, default: 'cburnett', why: 'A matter of taste. Classic is the set Lichess and Wikipedia use; Merida is the one in most chess books (I9). Every set here is free to use under this project\'s licence.', source: 'owner' });
defineSetting({ key: 'display.sound', group: 'Board', label: 'Move sounds', type: 'boolean', default: true, why: "A click on each move helps you notice the coach's moves too.", source: 'owner' });
defineSetting({ key: 'display.keepDrawings', group: 'Board', label: 'Keep my arrows and circles with the position', type: 'boolean', default: true, why: 'What you draw stays on that position and goes into the exported PGN, the way a Lichess study keeps it; draw a shape again to remove it. Off: the board is a scratch pad, and a click on a piece wipes it (I6).', source: 'technical' });
// ---- repertoires and their gates (D1–D4, J2; CONTENT §5, §7; WP 8.3)
defineSetting({ key: 'repertoire.depth', group: 'Repertoire', label: 'How deep a repertoire goes', type: 'choice', options: ['auto', '4', '6', '8', '10', '12', '15'], optionLabels: { auto: 'By my level', '4': '4 of my moves', '6': '6 moves', '8': '8 moves', '10': '10 moves', '12': '12 moves', '15': '15 moves' }, default: 'auto', why: 'By your level: a few moves at 400–700, about 9 at 700–1000 (CONTENT §7). Lines go on as written; the drills stop here, and gaps further on are not counted.', source: 'research' });
defineSetting({ key: 'repertoire.maxDrop', group: 'Repertoire', label: 'A move of mine may lose at most (points of winning chances)', type: 'number', min: 1, max: 10, step: 1, default: 4, advanced: true, why: 'Gate V2: a repertoire move that loses more than this against the engine\'s choice, or gives material away, is quarantined (CONTENT §5).', source: 'research' });
defineSetting({ key: 'repertoire.secondNodes', group: 'Repertoire', label: 'Nodes for the second opinion', type: 'number', min: 2_000_000, max: 50_000_000, step: 1_000_000, default: 20_000_000, advanced: true, why: 'Gate V7: a deeper, separate search must not call any of your repertoire moves a mistake (CONTENT §5).', source: 'research' });
defineSetting({ key: 'repertoire.minCovered', group: 'Repertoire', label: "Share of my level's replies a repertoire should cover (%)", type: 'number', min: 50, max: 100, step: 5, default: 85, advanced: true, why: 'Gate V4: at each of the opponent\'s turns, the replies prepared should be the ones players at your level make in at least this share of games; a line with a gap is flagged, not dropped.', source: 'research' });
defineSetting({ key: 'repertoire.flagShare', group: 'Repertoire', label: 'Name a missing reply played this often (%)', type: 'number', min: 1, max: 20, step: 1, default: 5, advanced: true, why: 'Gate V4: a reply this common with no answer prepared is named on the review screen.', source: 'research' });
defineSetting({ key: 'repertoire.seedWhite', group: 'Repertoire', label: 'My openings as White (the starter is built around them)', type: 'text', default: '1. e4 e5 2. Nf3 Nc6 3. Bc4', check: (v) => seedProblems(v, 'white')[0] ?? null, why: 'The default offered until you choose (TRACKER Q18): one simple setup, the Italian Game, which aims at f7 and develops quickly. A PGN line; variations in brackets. Where your opponent leaves it, the builder picks the sound move players at your level find most often.', source: 'research' });
defineSetting({ key: 'repertoire.seedBlack', group: 'Repertoire', label: 'My openings as Black (the starter is built around them)', type: 'text', default: '1. e4 (1. d4 d5) 1... e5 2. Nf3 Nc6', check: (v) => seedProblems(v, 'black')[0] ?? null, why: 'The default offered until you choose (TRACKER Q18): answer 1.e4 with 1...e5 and 1.d4 with 1...d5, so the centre is shared and the pieces come out the classical way. A PGN line; variations in brackets.', source: 'research' });
defineSetting({ key: 'repertoire.minReach', group: 'Repertoire', label: 'Prepare positions reached in at least this share of games (%)', type: 'number', min: 0.5, max: 10, step: 0.5, default: 2, advanced: true, why: 'Counted from the start at your level: a position fewer than this share of your games would reach is left out, so a starter repertoire stays small enough to learn (a few dozen lines).', source: 'research' });
// a repertoire built from the book around an outline (D10, D11; WP 8.12, 8.14)
defineSetting({ key: 'repertoire.bookMinGames', group: 'Repertoire', label: 'A move is book when masters played it in at least … games', type: 'number', min: 5, max: 500, step: 5, default: 25, why: "Every move of a repertoire built from an outline, yours and your opponent's, must have been played in this many games of the Lichess masters' database, so no line rests on a move nobody plays; a line ends where the book does (owner's choice, 2026-11-15).", source: 'owner' });
defineSetting({ key: 'repertoire.outlineLines', group: 'Repertoire', label: 'A repertoire built from an outline has at most … lines', type: 'number', min: 50, max: 2000, step: 50, default: 650, why: 'About the size of the course the Réti outline follows (647 lines). The positions met most often in the masters\' games are prepared first, so a smaller number keeps the main lines and drops the rarest sidelines.', source: 'owner' });
defineSetting({ key: 'repertoire.buildDepth', group: 'Repertoire', label: 'Lines built from an outline go up to … of my moves', type: 'choice', options: ['8', '10', '12', '15'], optionLabels: { '8': '8 moves', '10': '10 moves', '12': '12 moves', '15': '15 moves' }, default: '12', why: 'Built and checked this deep once, so nothing has to be built again as you improve; the drill still stops at the depth for your level (How deep a repertoire goes) and goes deeper as your rating rises (owner\'s choice, 2026-11-15).', source: 'owner' });
defineSetting({ key: 'repertoire.bookCovered', group: 'Repertoire', label: "Share of the masters' replies a book repertoire answers (%)", type: 'number', min: 50, max: 100, step: 5, default: 90, advanced: true, why: "At each of your opponent's turns, the book's replies are prepared, most played first, until this share of the masters' games is answered; any reply played in 5% or more is answered too (the main line and its real sidelines).", source: 'research' });
defineSetting({ key: 'repertoire.bookFloor', group: 'Repertoire', label: "A book reply rarer than this is left out (% of the masters' games there)", type: 'number', min: 0.5, max: 10, step: 0.5, default: 1, advanced: true, why: 'A sideline played in under 1% of the games at a position is rare even among masters; it still has to pass the book rule to be prepared.', source: 'research' });
defineSetting({ key: 'repertoire.outlineReach', group: 'Repertoire', label: "An outline's chapter counts as met in at least this share of games (%)", type: 'number', min: 0.5, max: 10, step: 0.5, default: 2, advanced: true, why: 'The lines are prepared in the order they are met; a chapter you asked for (1...b5, say) is rare in the book, and without this floor it would get almost no lines.', source: 'research' });
defineSetting({ key: 'openings.newPerDay', group: 'Repertoire', label: 'New opening cards a day', type: 'number', min: 1, max: 50, step: 1, default: 10, why: 'A big repertoire comes in a few positions a day, chapter by chapter, so the reviews never pile up (spaced repetition works on small daily doses; DP13).', source: 'research' });
defineSetting({ key: 'openings.whyEvery', group: 'Repertoire', label: 'Ask "why this move?" every … right answers on a card', type: 'number', min: 0, max: 10, step: 1, default: 3, why: 'Knowing why a move is played is what lets you find it when the opponent leaves the book (D4); asked now and then, not every time, so the drill stays quick. 0 never asks.', source: 'research' });
defineSetting({ key: 'content.autoApproveEndgames', group: 'Repertoire', label: 'Endgame positions that pass every check go live by themselves', type: 'boolean', default: true, why: 'The endgame ladder is written for this app and checked by every gate, the tablebases first (each position is the win or the draw it says it is); like puzzles, it can go live without a separate yes (F2).', source: 'research' });
defineSetting({ key: 'content.autoApproveTraps', group: 'Repertoire', label: 'Traps that pass every check go live by themselves', type: 'boolean', default: true, why: 'The trap pack is a handful of positions written for this app and checked by every gate (the defence by the engine, the trap itself really losing, the words, how often players at your level meet it); like puzzles, it can go live without a separate yes (D8).', source: 'research' });
defineSetting({ key: 'repertoire.autoApprove', group: 'Repertoire', label: 'Lines that pass every gate go live by themselves', type: 'boolean', default: false, why: '"Validated perfect" is the bar for what you drill: lines that pass wait for your yes on the review screen, with one in ten put in front of you as a spot check (CONTENT §5, §10).', source: 'research' });
// ---- the opening explorer (I3, D6; WP 8.2)
defineSetting({ key: 'explorer.show', group: 'Explorer', label: 'Opening explorer on the analysis board', type: 'boolean', default: true, why: "What players at your level actually play from the position on the board, and how those games went (I3, D6). It counts games; it never says which move is good: that is the engine's job.", source: 'owner' });
defineSetting({ key: 'explorer.source', group: 'Explorer', label: 'The explorer shows', type: 'choice', options: ['level', 'masters', 'mine'], optionLabels: { level: 'Players at my level', masters: 'Masters', mine: 'My own games' }, default: 'level', why: 'What people at your level play is what you will meet over the board (D6); the masters and your own games are one click away on the panel.', source: 'owner' });
defineSetting({ key: 'explorer.ratings', group: 'Explorer', label: 'Players at my level means', type: 'choice', options: ['auto', '0', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'], optionLabels: { auto: 'Worked out from my play', '0': 'Rated under 1000', '1000': '1000–1199', '1200': '1200–1399', '1400': '1400–1599', '1600': '1600–1799', '1800': '1800–1999', '2000': '2000–2199', '2200': '2200–2499', '2500': '2500 and up' }, default: 'auto', why: "Worked out from your play: Lichess's rating band you play like and the one above it, where you are heading (under 1200 until enough of your games are analysed). Pick one band to see a different crowd.", source: 'research' });
defineSetting({ key: 'explorer.speeds', group: 'Explorer', label: 'Games counted', type: 'choice', options: ['yours', 'all'], optionLabels: { yours: 'Rapid, classical and daily', all: 'Every speed' }, default: 'yours', why: 'You play mostly rapid, classical and daily; in bullet and blitz people choose their openings differently.', source: 'owner' });
defineSetting({ key: 'explorer.maiaStandIn', group: 'Explorer', label: "Maia's guess when Lichess can't be asked", type: 'boolean', default: true, why: "With no token, no connection, or while Lichess asks for a pause, Maia's guess of what players at your level play is shown instead, marked as a guess with no games counted (D6). It starts Maia if it is not running.", source: 'research' });
// ---- how the page looks (I16)
defineSetting({ key: 'display.appearance', group: 'Appearance', label: 'Light or dark', type: 'choice', options: ['auto', 'light', 'dark'], optionLabels: { auto: 'Match system', light: 'Light', dark: 'Dark' }, default: 'auto', why: "Follows your computer's light or dark mode unless you pick one here (I16).", source: 'owner' });
defineSetting({ key: 'display.systemStats', group: 'Appearance', label: "The computer's load in the top bar", type: 'boolean', default: true, why: 'CPU, memory and GPU use beside Game and View, with the engines this app runs, so you can see what heavy work (a repertoire build, the bots) costs the laptop (I18). Sampled every three seconds while the page is open; nothing leaves the machine.', source: 'owner' });
defineSetting({ key: 'display.coachFont', group: 'Appearance', label: "The coach's words are set in", type: 'choice', options: ['book', 'plain'], optionLabels: { book: 'A book face', plain: 'The plain face' }, default: 'book', why: 'A book typeface sets what the coach says apart from the buttons around it, like the text of a chess book; the plain face matches the rest of the page (I16).', source: 'owner' });
// ---- coach
defineSetting({ key: 'coach.verbosity.analysis', group: 'Coach', label: 'The coach speaks', type: 'choice', options: ['silent', 'key_moments', 'every_move'], optionLabels: SPEAKS, default: 'key_moments', why: 'Speak when it matters instead of on every move, so each comment is worth reading (A10, DP5).', source: 'owner' });
defineSetting({ key: 'coach.askFirst', group: 'Coach', label: 'Ask first, then explain', type: 'boolean', default: true, why: 'Finding the idea yourself is what makes it stick; the coach still answers when you say "just tell me" (D10).', source: 'owner' });
defineSetting({ key: 'coach.commentOnTries', group: 'Coach', label: "Comment when you try a move on the coach's board", type: 'boolean', default: true, why: "Playing your own move on the coach's board is a question: the engine judges it and the coach explains it (A18).", source: 'owner' });
defineSetting({ key: 'coach.model.analysis', group: 'Coach', label: 'Coach model', type: 'choice', options: ['haiku', 'sonnet', 'opus'], optionLabels: { haiku: 'Haiku (fast)', sonnet: 'Sonnet (careful)', opus: 'Opus (deepest)' }, default: 'haiku', why: 'Haiku answers in about a second; Sonnet explains more carefully but costs more of the plan (A14).', source: 'owner' });
defineSetting({ key: 'coach.model.spar', group: 'Coach', label: 'Coach model for games against the bots', type: 'choice', options: ['haiku', 'sonnet', 'opus'], optionLabels: { haiku: 'Haiku (fast)', sonnet: 'Sonnet (careful)', opus: 'Opus (deepest)' }, default: 'haiku', why: 'During a game the coach says a line at a time, about the routine and never a move: Haiku is quick and enough (COACH §5).', source: 'research' });
defineSetting({ key: 'coach.verbosity.spar', group: 'Coach', label: 'The coach during a game against a bot', type: 'choice', options: ['silent', 'key_moments', 'every_move'], optionLabels: SPEAKS, default: 'key_moments', why: 'At key moments it agrees a focus at the start, voices the routine when the fading overlay would, asks what was missed after a blunder, and gives one line at the end; it never suggests a move (COACH §6.4).', source: 'owner' });
defineSetting({ key: 'coach.model.endgame', group: 'Coach', label: 'Coach model for the endgames', type: 'choice', options: ['haiku', 'sonnet', 'opus'], optionLabels: { haiku: 'Haiku (fast)', sonnet: 'Sonnet (careful)', opus: 'Opus (deepest)' }, default: 'haiku', why: 'On the Endgames tab the coach says a sentence or two: why a move let the win or the draw go, a word when you reach the goal, and a question when you ask for help (COACH §6.9).', source: 'research' });
defineSetting({ key: 'coach.model.opening', group: 'Coach', label: 'Coach model for the opening drill', type: 'choice', options: ['haiku', 'sonnet', 'opus'], optionLabels: { haiku: 'Haiku (fast)', sonnet: 'Sonnet (careful)', opus: 'Opus (deepest)' }, default: 'haiku', why: 'In the opening drill the coach says a sentence or two: why the repertoire move is played when you miss it, and whether your own words for the why have the idea (COACH §5).', source: 'research' });
defineSetting({ key: 'coach.model.drill', group: 'Coach', label: 'Coach model for puzzles', type: 'choice', options: ['haiku', 'sonnet', 'opus'], optionLabels: { haiku: 'Haiku (fast)', sonnet: 'Sonnet (careful)', opus: 'Opus (deepest)' }, default: 'haiku', why: 'On the Puzzles tab the coach says a sentence or two at a time: a question after a miss, the idea once a puzzle is over. Haiku is quick and enough for that (COACH §5).', source: 'research' });
defineSetting({ key: 'coach.model.review', group: 'Coach', label: 'Coach model for game reviews', type: 'choice', options: ['haiku', 'sonnet', 'opus'], optionLabels: { haiku: 'Haiku (fast)', sonnet: 'Sonnet (careful)', opus: 'Opus (deepest)' }, default: 'haiku', why: 'Measured on the ten review scenarios: Haiku passed all ten with more of its messages valid at the first try than Sonnet, at a fraction of the usage. Sonnet words things more fully; the chess comes from the engine either way (D58).', source: 'technical' });
defineSetting({ key: 'coach.vocabulary', group: 'Coach', label: 'Vocabulary level', type: 'choice', options: ['core', 'intro', 'all'], optionLabels: { core: 'Beginner', intro: 'Some theory', all: 'Everything' }, default: 'core', why: "Explanations use the concepts for the owner's level; harder ones wait unless asked about (H11).", source: 'research' });
defineSetting({ key: 'coach.ladder.maxMisses', group: 'Coach', label: 'Misses before the coach gives the answer', type: 'number', min: 1, max: 4, step: 1, default: 2, why: 'Tutoring research: after two misses more hints stop helping, so give the answer and the reason (DP4).', source: 'research' });
defineSetting({ key: 'coach.lineMaxPlies', group: 'Coach', label: 'Longest line the coach shows (half-moves)', type: 'number', min: 2, max: 16, step: 1, default: 8, why: 'At this level one or two forcing moves make the point; long engine lines do not teach (D15).', source: 'research' });
defineSetting({ key: 'coach.demoSpeedMs', group: 'Coach', label: "Speed of the coach's moves (ms per move)", type: 'number', min: 300, max: 3000, step: 100, default: 1100, why: 'Slow enough to follow each move as the coach plays it.', source: 'technical' });
defineSetting({ key: 'coach.sentences.short', group: 'Coach', label: 'Sentences in a question or a hint', type: 'number', min: 1, max: 5, step: 1, default: 2, advanced: true, why: 'One point per message keeps a hint a hint (DP5).', source: 'research' });
defineSetting({ key: 'coach.sentences.explain', group: 'Coach', label: 'Sentences in an explanation', type: 'number', min: 2, max: 8, step: 1, default: 4, advanced: true, why: 'Explanations give the purpose of a move in a few sentences, not an essay (LEARNING §5).', source: 'research' });
defineSetting({ key: 'coach.messagesPerTurn', group: 'Coach', label: 'Messages the coach may send per turn', type: 'number', min: 1, max: 6, step: 1, default: 3, advanced: true, why: 'Enough to explain, show a line and wrap up, without flooding the panel.', source: 'technical' });
defineSetting({ key: 'coach.idleStopMinutes', group: 'Coach', label: 'Stop the coach after this many idle minutes', type: 'number', min: 1, max: 120, step: 1, default: 15, advanced: true, why: 'An idle session holds nothing useful; it starts again on the next question.', source: 'technical' });
defineSetting({ key: 'coach.turnsPerSession', group: 'Coach', label: 'Coach turns before a fresh session', type: 'number', min: 5, max: 200, step: 5, default: 40, advanced: true, why: 'A fresh session keeps the context short and replies quick; nothing depends on its memory.', source: 'technical' });
// ---- games against bots
defineSetting({ key: 'play.thinkTime', group: 'Bots', label: 'Bots take a moment to move', type: 'boolean', default: true, why: 'An instant reply feels like a machine and rushes you; a short, uneven pause plays like a person (F9).', source: 'owner' });
defineSetting({ key: 'play.variety', group: 'Bots', label: 'How varied the bots play', type: 'choice', options: ['steady', 'human', 'wild'], optionLabels: { steady: 'Steady', human: 'Like a person', wild: 'Wild' }, default: 'human', why: '"Like a person" picks moves as often as real players of that rating do; "steady" sticks to the common ones; "wild" plays the rare ones more.', source: 'owner' });
defineSetting({ key: 'play.model', group: 'Bots', label: 'Maia model', type: 'choice', options: ['5m', '23m'], optionLabels: { '5m': 'Small (fast)', '23m': 'Large' }, default: '5m', advanced: true, why: 'Both answer in well under a second here; the small one loads faster.', source: 'technical' });
// ---- the owner's games (Phase 5)
const SITE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/;
defineSetting({ key: 'accounts.lichess', group: 'Games', label: 'Your name on Lichess', type: 'text', default: '', pattern: SITE_NAME, why: 'Your finished games are fetched from Lichess by this name, and your games in progress are checked so the app never helps with one (B1, H10). No password: games are public.', source: 'owner' });
defineSetting({ key: 'accounts.chesscom', group: 'Games', label: 'Your name on Chess.com', type: 'text', default: '', pattern: SITE_NAME, why: 'Your finished games are fetched from Chess.com by this name, and your Daily games in progress are checked so the app never helps with one (B1, H10). No password: games are public.', source: 'owner' });
defineSetting({ key: 'import.speeds', group: 'Games', label: 'Games to import', type: 'choice', options: ['slow', 'slow_blitz', 'all'], optionLabels: { slow: 'Rapid, Classical, Daily', slow_blitz: 'Those and Blitz', all: 'Every speed' }, default: 'slow', why: 'Slow games show how you think; in fast games most mistakes come from the clock (B2). Changing this fetches the games again.', source: 'owner' });
defineSetting({ key: 'import.casual', group: 'Games', label: 'Import unrated games too', type: 'boolean', default: true, why: 'A casual game teaches as much as a rated one. Changing this fetches the games again.', source: 'owner' });
defineSetting({ key: 'import.auto', group: 'Games', label: 'Fetch new games by itself', type: 'boolean', default: true, why: 'New games arrive when the app opens and every so often after that (B8). Off: only when you press Sync. Your games in progress are checked either way.', source: 'research' });
defineSetting({ key: 'import.monthsBack', group: 'Games', label: 'How far back to import (months)', type: 'number', min: 1, max: 120, step: 1, default: 12, why: 'A year of games is plenty to see your habits; older games show an older you. Changing this fetches the games again.', source: 'technical' });
defineSetting({ key: 'import.everyMinutes', group: 'Games', label: 'Minutes between fetches', type: 'number', min: 5, max: 720, step: 5, default: 30, advanced: true, why: "Often enough that a game you just finished is there when you look; rare enough to stay well inside the sites' limits.", source: 'technical' });
// ---- reviewing a game (Phase 5)
defineSetting({ key: 'review.momentsPerGame', group: 'Review', label: 'Key moments per game', type: 'number', min: 1, max: 5, step: 1, default: 3, why: 'Coaches go deep on a few moments instead of listing every error, starting from where the game first went wrong (B3, DP5).', source: 'research' });
defineSetting({ key: 'review.ownFirst', group: 'Review', label: 'Your own review first', type: 'boolean', default: true, why: 'Going through a game yourself before the engine speaks is what coaches agree on most: what were you thinking, and where do you think it turned? The engine and the coach stay silent on the game until you press Done or Skip (B7).', source: 'research' });
defineSetting({ key: 'review.auto', group: 'Review', label: 'Analyse a game when it is opened', type: 'boolean', default: true, why: 'Opening one of your games has the engine go through it once, so its key moments and labels are ready. Off: only when you ask. On battery, the engine setting for long jobs decides.', source: 'technical' });
defineSetting({ key: 'review.chart', group: 'Review', label: 'Winning-chances chart in the report', type: 'boolean', default: false, why: 'The takeaways are the report; the chart is a picture of where the game turned for those who like one (B10).', source: 'research' });
defineSetting({ key: 'review.maxDepthMoves', group: 'Review', label: 'Deepest point the coach asks you to find (your moves)', type: 'number', min: 1, max: 4, step: 1, default: 2, why: 'A point more than about two moves deep is shown as a worked example instead of asked for: searching for something out of reach teaches nothing (the stop rules, DP4).', source: 'research' });
defineSetting({ key: 'review.workedExampleWhenNew', group: 'Review', label: 'Show a tactic the first time instead of asking', type: 'boolean', default: true, why: 'Nobody finds a fork or a skewer they have never been shown. The first time one comes up in a review it is played out and explained; after that you are asked to find it (the stop rules, DP4).', source: 'research' });
defineSetting({ key: 'review.passNodes', group: 'Review', label: 'Nodes per position, first pass', type: 'number', min: 100_000, max: 2_000_000, step: 50_000, default: 400_000, advanced: true, why: 'A light look at every position finds where the game turned; the moments themselves are then judged with the deeper, checked analysis.', source: 'technical' });
// ---- puzzles (Phase 6)
defineSetting({ key: 'puzzles.fromGames', group: 'Puzzles', label: 'Make puzzles from my own games', type: 'boolean', default: true, why: 'Your own mistakes are the best puzzles there are: the positions come from games you cared about, and they are the mistakes you actually make (C1, C2).', source: 'owner' });
defineSetting({ key: 'puzzles.startLevel', group: 'Puzzles', label: 'Starting puzzle level for themed sets', type: 'number', min: 400, max: 2000, step: 50, default: 700, why: 'Where themed puzzles from the Lichess database start. From there the level follows your results, so that most puzzles are solved (C5).', source: 'owner' });
defineSetting({ key: 'puzzles.newPerDay', group: 'Puzzles', label: 'New puzzles from my games a day', type: 'number', min: 1, max: 50, step: 1, default: 10, why: 'New puzzles come in a few at a time, so the reviews they bring later stay manageable (C4).', source: 'research' });
defineSetting({ key: 'puzzles.reviewCap', group: 'Puzzles', label: 'Puzzles due again, at most a day', type: 'number', min: 5, max: 200, step: 5, default: 30, why: 'A pile of overdue reviews is the commonest reason people give up spaced practice (LEARNING DP13). Above this, the rest move to the following days.', source: 'research' });
defineSetting({ key: 'puzzles.maxIntervalDays', group: 'Puzzles', label: 'Longest gap before a puzzle comes back (days)', type: 'number', min: 14, max: 3650, step: 1, default: 180, advanced: true, why: 'Even a puzzle you know well comes back within this many days, so the pattern stays fresh.', source: 'technical' });
defineSetting({ key: 'puzzles.afterNudge', group: 'Puzzles', label: 'Solved after a nudge counts as', type: 'choice', options: ['hard', 'good'], optionLabels: { hard: 'Hard (comes back sooner)', good: 'Good' }, default: 'hard', advanced: true, why: 'A nudge points at the piece; whether that still counts as finding it yourself is a matter of taste (CONTENT §6).', source: 'research' });
defineSetting({ key: 'puzzles.perGame', group: 'Puzzles', label: 'Puzzles made from one game, at most', type: 'number', min: 1, max: 10, step: 1, default: 4, why: 'The costliest slips of a game make its puzzles; a handful keeps the queue about the moments that mattered.', source: 'technical' });
defineSetting({ key: 'puzzles.fadeGuidance', group: 'Puzzles', label: 'Guidance follows how well I know each idea', type: 'boolean', default: true, why: 'A new idea is shown before it is asked, and named while it is still new; once you know it, you find it yourself (worked examples first, then fading: DP3, DP9).', source: 'research' });
defineSetting({ key: 'puzzles.mixedKnownOnly', group: 'Puzzles', label: 'Mixed sets use only the ideas I already know', type: 'boolean', default: true, why: 'Mixing works for ideas you know; a new one is learnt on its own first. With fewer than three known ideas, every theme is used (LEARNING §3).', source: 'research' });
defineSetting({ key: 'play.engineBots', group: 'Play', label: 'Engine-style bots too', type: 'boolean', default: false, why: 'Stockfish held back to a short search plays computer chess: its mistakes are not the ones people make, so the human-like bots teach more. Here for variety (WP 7.8).', source: 'research' });
defineSetting({ key: 'coach.findableByMaia', group: 'Coach', label: 'Teach the move people at my level find', type: 'boolean', default: true, why: 'When several moves are as good, the one the coach teaches is the one players at your level play most often (Maia), when the bots are running; otherwise a forcing or simple one (feature H12).', source: 'research', advanced: true });
defineSetting({ key: 'play.routineOverlay', group: 'Play', label: 'The thinking routine before your moves', type: 'choice', options: ['auto', 'always', 'off'], optionLabels: { auto: 'Fading as the habit shows', always: 'Before every move', off: 'Off' }, default: 'auto', why: 'A short question before your move (their threat, your checks and captures, two candidates, the blunder check): before every move at first, less often as your blunders get rarer (feature A9, DP9).', source: 'research' });
defineSetting({ key: 'play.undoOffer', group: 'Play', label: 'Offer to take back a serious mistake', type: 'boolean', default: true, why: 'In a game against a bot, a blunder becomes a lesson: the game offers to take it back and asks what you missed. Taking it back counts like a hint (feature A8).', source: 'research' });
defineSetting({ key: 'play.timeControl', group: 'Play', label: 'Clock in games against the bots', type: 'choice', options: ['untimed', '10+0', '10+5', '15+10', '30+0', '30+20'], optionLabels: { untimed: 'No clock', '10+0': '10 minutes', '10+5': '10 minutes + 5 seconds', '15+10': '15 minutes + 10 seconds', '30+0': '30 minutes', '30+20': '30 minutes + 20 seconds' }, default: 'untimed', why: 'Slow games teach most at your level, so a game has no clock unless you want one; the choices are the rapid and classical games you play online (feature I10, DP14).', source: 'owner' });
defineSetting({ key: 'puzzles.woodpecker', group: 'Puzzles', label: 'Woodpecker rounds', type: 'boolean', default: false, why: 'The same set of puzzles again and again, faster each round. Built for players from about 1200; at your level spaced review works better, so it is off unless you want it (FEATURES C6).', source: 'owner' });
defineSetting({ key: 'puzzles.woodpeckerSize', group: 'Puzzles', label: 'Woodpecker: puzzles in a set', type: 'number', min: 5, max: 100, step: 5, default: 20, advanced: true, why: 'Made from puzzles you have met already; small enough to go round many times.', source: 'research' });
defineSetting({ key: 'puzzles.speedModes', group: 'Puzzles', label: 'Speed runs: streak and timed', type: 'boolean', default: false, why: 'At your level finding the right move matters more than finding it fast, so speed runs are off unless you want them. They are silent, and they do not move your schedule or your level (FEATURES I4).', source: 'owner' });
defineSetting({ key: 'puzzles.timedSeconds', group: 'Puzzles', label: 'Timed run: seconds', type: 'number', min: 60, max: 600, step: 30, default: 180, advanced: true, why: 'How long a timed run lasts; a wrong move costs ten seconds.', source: 'research' });
defineSetting({ key: 'safety.listFirst', group: 'Puzzles', label: 'Safety check: make their checks and captures first', type: 'boolean', default: true, why: 'Looking at what they can do after your move is the habit being trained; ruling the move safe or not comes after (feature C7).', source: 'research' });
defineSetting({ key: 'conversion.maxMoves', group: 'Puzzles', label: 'Win the won game: your moves before a drill stops', type: 'number', min: 10, max: 150, step: 5, default: 40, why: 'Long enough to finish most won positions; a drill that is still winning at the end counts as kept, not lost (feature C9).', source: 'research' });
defineSetting({ key: 'conversion.engineNodes', group: 'Puzzles', label: 'Win the won game: how hard the engine defends (nodes a move)', type: 'number', min: 50_000, max: 5_000_000, step: 50_000, default: 1_000_000, advanced: true, why: 'The engine defends the lost side with this much search a move; more is a tougher defender and slower replies.', source: 'research' });
// ---- content and its gates (Phase 6)
defineSetting({ key: 'content.autoApprovePuzzles', group: 'Content', label: 'Puzzles that pass every check go live by themselves', type: 'boolean', default: true, why: 'A puzzle from your own game or from the Lichess database is checked by the rules and the engine; nothing about it needs your eye. Off: each one waits for your approval (J3).', source: 'owner' });
defineSetting({ key: 'content.gateNodes', group: 'Content', label: 'Nodes for checking a puzzle or a repertoire line', type: 'number', min: 500_000, max: 20_000_000, step: 500_000, default: 5_000_000, advanced: true, why: 'A puzzle is studied many times, so it is checked more deeply than a move on the board: that the solution is the only good move, or that every good move is accepted.', source: 'technical' });
// ---- engine and grading
defineSetting({ key: 'engine.lichessCrossCheck', group: 'Engine', label: "Check verdicts against Lichess's cloud analysis", type: 'boolean', default: true, why: "When Lichess has analysed the position (usually far deeper than this laptop's search), its best moves are the reference and Stockfish here is the cross-check. Sends only the position to lichess.org (D33).", source: 'owner' });
defineSetting({ key: 'engine.onBattery', group: 'Engine', label: 'A long engine job on battery', type: 'choice', options: ['lighter', 'full', 'wait'], optionLabels: { lighter: 'Uses the quick search', full: 'Runs in full anyway', wait: 'Waits for mains power' }, default: 'lighter', why: "On battery this laptop's processor is held to about 45 W, so a whole game's analysis crawls and drains the battery. The quick search still labels every move; plug in and run it again for the deeper one.", source: 'technical' });
defineSetting({ key: 'engine.quickNodes', group: 'Engine', label: 'Nodes per quick check', type: 'number', min: 50_000, max: 2_000_000, step: 50_000, default: 250_000, advanced: true, why: 'About a fifth of a second here; node limits make answers repeat exactly (D25).', source: 'technical' });
defineSetting({ key: 'engine.verdictNodes', group: 'Engine', label: 'Nodes for anything stated to you', type: 'number', min: 200_000, max: 20_000_000, step: 100_000, default: 1_000_000, advanced: true, why: 'Verdicts on moves, move labels and every line the coach shows use a deeper search than the background check, because you learn from them (D33).', source: 'owner' });
defineSetting({ key: 'grading.excellent', group: 'Grading', label: 'Excellent: within this many points of the best move', type: 'number', min: 0.5, max: 4, step: 0.5, default: 2, advanced: true, why: 'A move this close to the best one is as good for every practical purpose.', source: 'technical' });
defineSetting({ key: 'grading.inaccuracy', group: 'Grading', label: 'Inaccuracy: drop in winning chances', type: 'number', min: 1, max: 30, step: 1, default: 5, advanced: true, why: "Lichess's threshold.", source: 'research' });
defineSetting({ key: 'grading.mistake', group: 'Grading', label: 'Mistake: drop in winning chances', type: 'number', min: 2, max: 40, step: 1, default: 10, advanced: true, why: "Lichess's threshold.", source: 'research' });
defineSetting({ key: 'grading.blunder', group: 'Grading', label: 'Blunder: drop in winning chances', type: 'number', min: 3, max: 60, step: 1, default: 15, advanced: true, why: "Lichess's threshold.", source: 'research' });

// ---- presets (feature K2): named bundles; applying one changes exactly its keys
export const PRESETS: PresetView[] = [
  {
    id: 'default',
    name: 'Coach and engine',
    about: 'The eval bar, the best-move arrow and move labels on; the coach speaks at key moments. How the app starts.',
    values: { 'display.evalBar': true, 'display.bestArrows': true, 'display.moveLabels': true, 'display.engineLines': false, 'display.numbers': false, 'coach.verbosity.analysis': 'key_moments', 'coach.askFirst': true },
  },
  {
    id: 'think_first',
    name: 'Think first',
    about: 'What the coaching research suggests: no bar, no arrows, no labels until you ask. You find the move, then the coach explains.',
    values: { 'display.evalBar': false, 'display.bestArrows': false, 'display.moveLabels': false, 'display.engineLines': false, 'display.numbers': false, 'coach.verbosity.analysis': 'key_moments', 'coach.askFirst': true },
  },
  {
    id: 'lichess',
    name: 'Lichess-like',
    about: 'Everything the engine knows on screen: bar, three arrows, labels, lines and numbers. The coach only speaks when asked.',
    values: { 'display.evalBar': true, 'display.bestArrows': true, 'display.bestArrowCount': 3, 'display.moveLabels': true, 'display.engineLines': true, 'display.numbers': true, 'coach.verbosity.analysis': 'silent', 'coach.askFirst': false },
  },
  {
    id: 'quiet',
    name: 'Quiet coach',
    about: 'The coach stays silent until you ask, and then answers straight away.',
    values: { 'coach.verbosity.analysis': 'silent', 'coach.askFirst': false },
  },
];

export class Settings {
  private readonly db: Db;
  private cache = new Map<string, SettingValue>();
  private listeners: ((key: string, value: unknown) => void)[] = [];

  constructor(db: Db) {
    this.db = db;
  }

  get<T extends SettingValue = SettingValue>(key: string): T {
    const def = byKey.get(key);
    if (!def) throw new Error(`unknown setting: ${key}`);
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const raw = this.db.getSettingRaw(key);
    let value = def.default;
    if (raw !== undefined) {
      try {
        const parsed = JSON.parse(raw);
        if (this.valid(def, parsed)) value = parsed;
      } catch {
        /* keep the default */
      }
    }
    this.cache.set(key, value);
    return value as T;
  }

  private valid(def: SettingDef, value: unknown): value is SettingValue {
    if (def.type === 'boolean') return typeof value === 'boolean';
    if (def.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (def.min === undefined || value >= def.min) && (def.max === undefined || value <= def.max);
    if (def.type === 'choice') return typeof value === 'string' && (def.options ?? []).includes(value);
    return typeof value === 'string' && value.length <= 200 && (value === '' || !def.pattern || def.pattern.test(value));
  }

  set(key: string, value: unknown): { ok: true; changed: boolean } | { ok: false; reason: string } {
    const def = byKey.get(key);
    if (!def) return { ok: false, reason: `unknown setting: ${key}` };
    if (!this.valid(def, value)) return { ok: false, reason: `not a valid value for ${key}` };
    const problem = typeof value === 'string' && value !== '' ? def.check?.(value) : null;
    if (problem) return { ok: false, reason: problem };
    const before = this.get(key);
    if (before === value) return { ok: true, changed: false };
    this.db.setSettingRaw(key, JSON.stringify(value));
    this.cache.set(key, value);
    this.db.logEvent('setting', { key, before, after: value });
    for (const l of this.listeners) l(key, value);
    return { ok: true, changed: true };
  }

  /** Apply a named bundle: exactly its keys change, each logged like any other change. */
  applyPreset(id: string): { ok: true; changed: string[] } | { ok: false; reason: string } {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return { ok: false, reason: `unknown preset: ${id}` };
    const changed: string[] = [];
    for (const [key, value] of Object.entries(preset.values)) {
      const r = this.set(key, value);
      if (r.ok && r.changed) changed.push(key);
    }
    this.db.logEvent('preset', { id, changed });
    return { ok: true, changed };
  }

  /** Put every setting (or every setting of one group) back to its default. */
  resetAll(group?: string): string[] {
    const changed: string[] = [];
    for (const def of SETTINGS) {
      if (group && def.group !== group) continue;
      const r = this.set(def.key, def.default);
      if (r.ok && r.changed) changed.push(def.key);
    }
    return changed;
  }

  onChange(fn: (key: string, value: unknown) => void) {
    this.listeners.push(fn);
  }

  /** Everything the settings page shows. */
  all(): (SettingDef & { value: SettingValue })[] {
    // the pattern is the server's own check: it does not travel to the page
    return SETTINGS.map(({ pattern: _pattern, ...d }) => ({ ...d, value: this.get(d.key) }));
  }
}
