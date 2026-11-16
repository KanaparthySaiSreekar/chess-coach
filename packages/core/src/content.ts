// Content and its gates (features J2, J3; CONTENT §1, §3, §5). Nothing the owner studies from is
// unverified: every item carries the same envelope, goes through the gates that apply to its
// type, and is used only when it is `live`. A gate that fails quarantines the item with the
// reason and the exact move or sentence.
//
// This file holds the envelope, the puzzle shape and the gates that need no engine (V1 legality,
// V6 provenance). The gates that do (V2 engine soundness, V3 text claims) run on the server.

import { anyToMove, describeMove, parsePosition } from './chess.ts';
import { exportPgn, importPgn, addMove, mainlineEnd, movesTo, newTree } from './tree.ts';

export type ContentType = 'puzzle_game' | 'puzzle_db' | 'safety' | 'threat' | 'convert' | 'repertoire' | 'opening' | 'trap' | 'lesson' | 'endgame' | 'course';
export type ContentStatus = 'draft' | 'machine-verified' | 'owner-approved' | 'live' | 'quarantined';
export type Licence = 'cc0' | 'own' | 'project' | 'private' | 'public-domain';
export type GateId = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8';

export type GateResult = {
  gate: GateId;
  /** 'flag': passed, with points for the owner to look at (a repertoire's gap: a line missing, not a wrong one) */
  result: 'pass' | 'fail' | 'n/a' | 'flag';
  /** the reason in plain words, with the exact move or sentence */
  detail?: string;
  /** for a line (a repertoire's): the index of the move the gate is about, so the review screen can show it on the board */
  at?: number;
};

/** Which gates apply to each type (CONTENT §5). A gate that is not listed is "not applicable". */
export const GATES_FOR: Record<ContentType, GateId[]> = {
  puzzle_db: ['V1', 'V6'],
  puzzle_game: ['V1', 'V2', 'V3', 'V6'],
  // a safety item's verdicts and reasons are the engine's checked facts as they are: V2 and V3 are what made it
  safety: ['V1', 'V6'],
  // likewise a threat item: the threat, the moves as strong, and the verdicts are the engine's
  threat: ['V1', 'V6'],
  // a drill's start is checked by the engine when it is made; the play is judged live, move by move
  convert: ['V1', 'V6'],
  repertoire: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'],
  // an opening drill card is made from live repertoire lines, which passed V1–V7: the card re-checks its move and its envelope
  opening: ['V1', 'V6'],
  // V4 for a trap: players at the owner's level really reach its position (TRAP_MIN_GAMES)
  trap: ['V1', 'V2', 'V3', 'V4', 'V6', 'V7'],
  lesson: ['V1', 'V2', 'V3', 'V6', 'V8'],
  endgame: ['V1', 'V2', 'V3', 'V6', 'V8'],
  course: ['V1', 'V5', 'V6', 'V7'],
};

/** The envelope every item carries (gate V6 checks that it is complete). */
export type ContentItem<T = unknown> = {
  id?: number;
  type: ContentType;
  status: ContentStatus;
  /** where it came from: `game:<id>#<ply>` · `puzzle:<id>` · `file:<path>#<page>` · a URL · `generated:<model>:<date>:<playbook>` */
  source: string;
  licence: Licence;
  /** the engine version and node budget the gates ran with */
  engine?: string;
  gates: GateResult[];
  /** the curriculum band it suits ("400–700") */
  level?: string;
  body: T;
  /** the owner's note when they accepted the item against a gate (the review screen, CONTENT §10) */
  note?: string;
};

export type PuzzleKind = 'mistake' | 'punish' | 'threat' | 'safety' | 'conversion' | 'theme';

export type Puzzle = {
  /** the position the puzzle starts from: before the set-up move when there is one, else the solver's position */
  fen: string;
  /** the opponent's move that creates the puzzle, as Lichess stores it */
  setup?: string;
  /** the solver's moves with the replies between them, the solver's first; it ends on a move of the solver's */
  solution: string[];
  /** other answers that are accepted, by the index of the solver's move in `solution` (0, 2, 4, …) */
  accepted?: Record<number, string[]>;
  themes: string[];
  rating?: number;
  kind: PuzzleKind;
  /** said when the puzzle is missed: written with tokens, as the coach writes ({m:Rd8#}, {sq:f7}) */
  explanation?: string;
};

// `study:<id>` is one of the owner's studies in the app (WP 8.7); `pasted:<date>` a PGN pasted on the page
const SOURCE = /^(?:game:\d+#\d+|puzzle:[A-Za-z0-9]+|file:[^#]+#[\w-]+|study:\d+|pasted:\d{4}-\d{2}-\d{2}|https?:\/\/\S+|generated:[^:]+:\d{4}-\d{2}-\d{2}:[^:]+)$/;
const LICENCES: Licence[] = ['cc0', 'own', 'project', 'private', 'public-domain'];

/** The position the solver faces, and whose move it is: after the set-up move when there is one. */
export function solverStart(p: Puzzle): { ok: true; fen: string } | { ok: false; reason: string } {
  const pos = parsePosition(p.fen);
  if (!pos) return { ok: false, reason: 'the starting position is not a valid position' };
  if (!p.setup) return { ok: true, fen: p.fen };
  const move = anyToMove(pos, p.setup);
  if (!move) return { ok: false, reason: `the set-up move (${p.setup}) is not legal in the starting position` };
  return { ok: true, fen: describeMove(pos, move).fenAfter };
}

/**
 * Gate V1, for a puzzle: the positions are valid, every move is legal in order (the accepted
 * answers too), the line ends on a move of the solver's, and it survives being written as PGN and
 * read back.
 */
export function gateV1Puzzle(p: Puzzle): GateResult {
  const fail = (detail: string): GateResult => ({ gate: 'V1', result: 'fail', detail });
  const start = solverStart(p);
  if (!start.ok) return fail(start.reason);
  if (!p.solution.length) return fail('the puzzle has no solution');
  if (p.solution.length % 2 === 0) return fail(`the line ends on the other side's move (${p.solution.at(-1)}): it must end on the solver's`);
  const tree = newTree(start.fen);
  let at = tree.root;
  const played: string[] = [];
  for (const [i, text] of p.solution.entries()) {
    const pos = parsePosition(tree.nodes[at]!.fen)!;
    for (const alt of i % 2 === 0 ? (p.accepted?.[i] ?? []) : []) {
      if (!anyToMove(pos, alt)) return fail(`the accepted answer ${alt} (in place of move ${i + 1}, ${text}) is not legal${played.length ? ` after ${played.join(' ')}` : ''}`);
    }
    const r = addMove(tree, at, text);
    if (!r.ok) return fail(`move ${i + 1} of the solution (${text}) is not legal${played.length ? ` after ${played.join(' ')}` : ' in the puzzle position'}`);
    at = r.id;
    played.push(r.info.san);
  }
  for (const key of Object.keys(p.accepted ?? {})) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= p.solution.length || i % 2 === 1) return fail(`accepted answers are listed for move ${i + 1}, which is not a move of the solver's`);
  }
  // PGN out and in again gives the same line
  const back = importPgn(exportPgn(tree));
  if (!back.ok || movesTo(back.tree, mainlineEnd(back.tree)).join(' ') !== played.join(' ') || back.tree.rootFen !== tree.rootFen) return fail('the line does not survive being written as PGN and read back');
  return { gate: 'V1', result: 'pass' };
}

/**
 * Gate V6: the envelope is complete, and private material is kept only under the data folder.
 * `storedUnderData` says where the item is (or is about to be) written.
 */
export function gateV6(item: ContentItem, opts: { storedUnderData: boolean; engineRan: boolean }): GateResult {
  const missing: string[] = [];
  if (!SOURCE.test(item.source ?? '')) missing.push(`the source ("${item.source ?? ''}") does not say where the item came from`);
  if (!LICENCES.includes(item.licence)) missing.push(`the licence ("${String(item.licence)}") is not one of ${LICENCES.join(', ')}`);
  if (!item.level) missing.push('the level band is not set');
  if (opts.engineRan && !item.engine) missing.push('the engine and node budget the gates ran with are not recorded');
  if (item.licence === 'private' && !opts.storedUnderData) missing.push('private material may be stored only under the data folder');
  return missing.length ? { gate: 'V6', result: 'fail', detail: missing.join('; ') } : { gate: 'V6', result: 'pass' };
}

/** The status the gates' results give an item: quarantined on any failure, else machine-verified. */
export function statusAfter(type: ContentType, gates: GateResult[]): 'quarantined' | 'machine-verified' {
  const needed = GATES_FOR[type];
  const failed = gates.some((g) => g.result === 'fail');
  const allRan = needed.every((id) => gates.some((g) => g.gate === id && g.result !== 'n/a'));
  return failed || !allRan ? 'quarantined' : 'machine-verified';
}

/** Why an item is in quarantine, in one line per failed gate. */
export function quarantineReasons(item: ContentItem): string[] {
  const names: Record<GateId, string> = { V1: 'Legality', V2: 'Engine soundness', V3: 'Text claims', V4: 'Human reality', V5: 'Consistency', V6: 'Provenance', V7: 'Second opinion', V8: 'Teaching lint' };
  const failed = item.gates.filter((g) => g.result === 'fail').map((g) => `${g.gate} ${names[g.gate]}: ${g.detail ?? 'failed'}`);
  // a gate left out because an earlier one failed says nothing new: only the failure is listed
  const missing = GATES_FOR[item.type]
    .filter((id) => !item.gates.some((g) => g.gate === id && g.result !== 'n/a'))
    .map((id) => ({ id, skipped: item.gates.find((g) => g.gate === id && g.result === 'n/a') }))
    .filter(({ skipped }) => !(failed.length && skipped?.detail?.startsWith('not run:')))
    .map(({ id, skipped }) => `${id} ${names[id]}: ${skipped?.detail && !skipped.detail.startsWith('not run:') ? skipped.detail : 'has not run'}`);
  return [...failed, ...missing];
}

/**
 * A stable key for a puzzle, so the same one made twice is one item. A puzzle from a game is one
 * item per slip and kind: when the engine builds it again (a deeper search, a newer engine) the
 * new line replaces the old one and the answers given to it stay with it.
 */
export function puzzleKey(p: Puzzle, source: string): string {
  if (source.startsWith('game:')) return `${source}|${p.kind}`;
  return `${source}|${p.fen.split(' ').slice(0, 4).join(' ')}|${p.setup ?? ''}|${p.solution.join(' ')}`;
}
