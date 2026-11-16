// BoardSession: the one shared board (ARCHITECTURE §4, features A1 and H1). It lives here, in the
// server and the database, never in the model's memory, so the coach can be restarted at any time.

import {
  START_FEN,
  addMove,
  checkSetup,
  deleteNode,
  demoFen,
  exportPgn,
  gameStatus,
  importPgn,
  mainlineEnd,
  mustPosition,
  newTree,
  opposite,
  pathTo,
  positionKey,
  promote,
  type CoachMessage,
  type Color,
  type Demo,
  type DemoLine,
  type DemoMove,
  type MoveInfo,
  type NodeId,
  type SessionState,
  type Shape,
  type TreeNode,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import type { OpeningBook } from './openings.ts';

const SESSION_ID = 'main';

type Saved = { state: SessionState; thread: CoachMessage[]; counters: { msg: number; demo: number; line: number } };

export class BoardSession {
  state: SessionState;
  thread: CoachMessage[] = [];
  private counters = { msg: 0, demo: 0, line: 0 };
  /** the standing fair-play notice, while the owner's games in progress cannot be checked (set by the app) */
  private notice: string | undefined;
  private readonly db: Db;
  private readonly book: OpeningBook;
  /** called after every change: the app broadcasts the new state */
  onChange: () => void = () => {};

  constructor(db: Db, book: OpeningBook) {
    this.db = db;
    this.book = book;
    this.state = this.fresh(START_FEN, 'white');
    const saved = db.loadSession(SESSION_ID);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Saved;
        if (parsed.state?.tree?.nodes?.[parsed.state.focus]) {
          this.state = { ...parsed.state, notice: this.notice };
          this.state.shapes = { owner: this.savedShapes(), coach: this.state.shapes?.coach ?? [] };
          this.thread = parsed.thread ?? [];
          this.counters = parsed.counters ?? this.counters;
        }
      } catch {
        /* start fresh */
      }
    }
    this.refreshDerived();
  }

  private fresh(fen: string, orientation: Color): SessionState {
    const tree = newTree(fen);
    return { mode: 'analysis', tree, focus: tree.root, layer: 'owner', shapes: { owner: [], coach: [] }, orientation, seq: 1, notice: this.notice };
  }

  private refreshDerived() {
    const path = pathTo(this.state.tree, this.state.focus);
    this.state.opening = this.book.lookup(path.map((n) => n.fen));
    const status = gameStatus(mustPosition(this.focusFen()));
    this.state.over = status.over ? status.text : undefined;
  }

  private changed(bump: boolean) {
    if (bump) this.state.seq++;
    this.refreshDerived();
    this.save();
    this.onChange();
  }

  save() {
    const saved: Saved = { state: this.state, thread: this.thread.slice(-300), counters: this.counters };
    this.db.saveSession(SESSION_ID, JSON.stringify(saved));
  }

  // ------------------------------------------------------------ reading

  focusNode(): TreeNode {
    return this.state.tree.nodes[this.state.focus]!;
  }

  focusFen(): string {
    return this.focusNode().fen;
  }

  /** The drawings kept with the focus position, as the page draws them. None while the coach's board is showing. */
  private savedShapes(): Shape[] {
    if (this.state.layer === 'demo') return [];
    return (this.focusNode().drawings ?? []).map((d) => ({ from: d.from, to: d.to, style: 'owner' as const, color: d.color }));
  }

  /** The position on screen: the coach's layer when it is showing something, else the owner's board. */
  visibleFen(): string {
    return this.state.layer === 'demo' && this.state.demo ? demoFen(this.state.demo) : this.focusFen();
  }

  /** The move that led to the focus position, and who played it from the owner's point of view. */
  lastMove(): { san: string; by: 'owner' | 'opponent'; fenBefore: string } | undefined {
    const node = this.focusNode();
    if (!node.parent || !node.san) return undefined;
    const before = this.state.tree.nodes[node.parent]!;
    const mover = mustPosition(before.fen).turn;
    return { san: node.san, by: mover === this.state.orientation ? 'owner' : 'opponent', fenBefore: before.fen };
  }

  pgn(): string {
    return exportPgn(this.state.tree);
  }

  // ------------------------------------------------------------ the owner's actions (each moves seq on)

  move(from: string, to: string, promotion?: string): { ok: true; info: MoveInfo } | { ok: false; reason: string } {
    if (this.state.layer === 'demo') return { ok: false, reason: 'The coach is showing a position. Go back to your board to move.' };
    const r = addMove(this.state.tree, this.state.focus, `${from}${to}${promotion ? promotion[0] === 'k' ? 'n' : promotion[0] : ''}`);
    if (!r.ok) return r;
    this.state.focus = r.id;
    this.state.shapes = { owner: this.savedShapes(), coach: [] };
    this.db.logEvent('move', { san: r.info.san, fen: r.info.fenAfter });
    this.changed(true);
    return { ok: true, info: r.info };
  }

  nav(to: NodeId | 'start' | 'end' | 'prev' | 'next'): boolean {
    const tree = this.state.tree;
    const cur = this.focusNode();
    let target: NodeId | undefined;
    if (to === 'start') target = tree.root;
    else if (to === 'end') target = mainlineEnd(tree, cur.id);
    else if (to === 'prev') target = cur.parent ?? undefined;
    else if (to === 'next') target = cur.children[0];
    else target = tree.nodes[to] ? to : undefined;
    if (!target || target === this.state.focus) return false;
    this.state.focus = target;
    this.state.shapes = { owner: this.savedShapes(), coach: [] };
    this.changed(true);
    return true;
  }

  /** Show or clear the standing fair-play notice. */
  setNotice(text: string | undefined) {
    this.notice = text;
    if (this.state.notice === text) return;
    this.state = { ...this.state, notice: text };
    this.changed(false);
  }

  /** Put a PGN (or a bare FEN) on the board. `as` is set for a game from the owner's library: their side faces them, and the board says which game it is. */
  load(text: string, as?: { orientation: Color; game: NonNullable<SessionState['game']> }): { ok: true } | { ok: false; reason: string } {
    const r = importPgn(text);
    if (!r.ok) return r;
    if (r.result === '*' && r.games > 0 && Object.keys(r.tree.nodes).length > 1 && /\[\s*Result\s+"\*"\s*\]/.test(text)) {
      // a PGN that says the game is unfinished is refused (fair play, a hard rule)
      return { ok: false, reason: 'This PGN says the game is still in progress (Result "*"). Only finished games can be loaded.' };
    }
    this.state = { ...this.fresh(r.tree.rootFen, as?.orientation ?? this.state.orientation), tree: r.tree, focus: r.tree.root, seq: this.state.seq, game: as?.game };
    this.state.shapes.owner = this.savedShapes();
    this.db.logEvent('load', { nodes: Object.keys(r.tree.nodes).length, game: as?.game.id });
    this.changed(true);
    return { ok: true };
  }

  /** A position set up by hand in the board editor (feature I2). Refused, with the reason, when chess does not allow it. */
  setup(fen: string): { ok: true; fen: string } | { ok: false; reason: string } {
    const r = checkSetup(fen);
    if (!r.ok) return r;
    this.state = { ...this.fresh(r.fen, this.state.orientation), seq: this.state.seq };
    this.db.logEvent('setup', { fen: r.fen });
    this.changed(true);
    return { ok: true, fen: r.fen };
  }

  /**
   * Reset the whole position (feature I14). `start` = the normal starting position; `root` = the
   * first position of whatever is loaded (a set-up position stays), with every move cleared.
   */
  reset(to: 'start' | 'root' = 'start') {
    const fen = to === 'root' ? this.state.tree.rootFen : START_FEN;
    const cleared = Object.keys(this.state.tree.nodes).length - 1;
    this.state = { ...this.fresh(fen, this.state.orientation), seq: this.state.seq };
    this.db.logEvent('reset', { to, movesCleared: cleared });
    this.changed(true);
  }

  /** Save and tell the page, without moving seq on: the engine filled in a reading or a label. */
  touch() {
    this.changed(false);
  }

  /** Drop every move label (the grading thresholds changed, so they must be worked out again). */
  clearJudgements() {
    for (const node of Object.values(this.state.tree.nodes)) delete node.judged;
    for (const line of this.state.demo?.lines ?? []) for (const m of line.moves) delete m.judged;
    this.changed(false);
  }

  flip() {
    this.state.orientation = opposite(this.state.orientation);
    this.changed(true);
  }

  delete(id: NodeId) {
    const onPath = pathTo(this.state.tree, this.state.focus).some((n) => n.id === id);
    const parent = deleteNode(this.state.tree, id);
    if (!parent) return;
    if (onPath) {
      this.state.focus = parent;
      this.state.shapes = { owner: this.savedShapes(), coach: [] };
    }
    this.changed(onPath);
  }

  promote(id: NodeId) {
    if (promote(this.state.tree, id)) this.changed(false);
  }

  /**
   * What the owner has drawn on the board that is showing. On their own board the drawings are
   * kept with the position, so they are still there when the owner comes back to it and they go
   * into the exported PGN; on the coach's board they last until the board changes.
   */
  setOwnerShapes(shapes: Shape[], opts: { keep?: boolean } = {}) {
    this.state.shapes.owner = shapes.slice(0, 40);
    if (this.state.layer === 'owner' && opts.keep !== false) {
      const node = this.focusNode();
      const drawings = this.state.shapes.owner.map((s) => (s.to ? { from: s.from, to: s.to, color: s.color ?? ('green' as const) } : { from: s.from, color: s.color ?? ('green' as const) }));
      if (drawings.length) node.drawings = drawings;
      else delete node.drawings;
    }
    this.changed(false);
  }

  // ------------------------------------------------------------ the coach's layer (never moves seq)

  setCoachShapes(shapes: Shape[]) {
    this.state.shapes.coach = shapes.slice(0, 24);
    this.changed(false);
  }

  /** Start showing something on the coach's layer. The owner's place is kept. */
  openDemo(label: string, baseFen: string): Demo {
    const demo: Demo = { id: ++this.counters.demo, label, baseFen, lines: [], cursor: { line: null, ply: 0 } };
    this.state.demo = demo;
    this.state.layer = 'demo';
    this.state.shapes = { owner: [], coach: [] };
    this.changed(false);
    return demo;
  }

  /**
   * Add a line to the coach's layer. `byOwner`: the owner played its first move on the coach's
   * board (feature A18). That is the owner's own action, so seq moves on and an answer the coach
   * was still writing about the earlier position is refused as stale.
   */
  addDemoLine(
    line: { label: string; baseFen: string; moves: DemoMove[]; parent?: { line: string; ply: number }; verdict?: string; checkedBy?: string; kind?: DemoLine['kind'] },
    opts: { byOwner?: boolean } = {},
  ): DemoLine {
    const demo = this.state.demo!;
    const full: DemoLine = { id: `L${++this.counters.line}`, ...line };
    demo.lines.push(full);
    demo.cursor = { line: full.id, ply: opts.byOwner ? Math.min(1, full.moves.length) : 0 };
    this.state.layer = 'demo';
    this.state.shapes = { owner: [], coach: [] };
    this.changed(!!opts.byOwner);
    return full;
  }

  demoGoto(line: string | null, ply: number) {
    const demo = this.state.demo;
    if (!demo) return;
    if (line === null) demo.cursor = { line: null, ply: 0 };
    else {
      const l = demo.lines.find((x) => x.id === line);
      if (!l) return;
      demo.cursor = { line, ply: Math.max(0, Math.min(ply, l.moves.length)) };
    }
    this.state.layer = 'demo';
    this.state.shapes = { owner: [], coach: [] };
    this.changed(false);
  }

  /**
   * The owner played a move on the coach's board. If it is the next move of something already
   * shown there (the line itself, or a side line that starts at this point), step onto it and
   * say so; otherwise return null: the move is an alternative the engine has to judge.
   */
  demoFollow(san: string): { line: string; ply: number } | null {
    const demo = this.state.demo;
    if (!demo || this.state.layer !== 'demo') return null;
    const { line: lineId, ply } = demo.cursor;
    let hit: { line: string; ply: number } | null = null;
    if (lineId) {
      const line = demo.lines.find((l) => l.id === lineId);
      if (line?.moves[ply]?.san === san) hit = { line: line.id, ply: ply + 1 };
      const side = hit ? undefined : demo.lines.find((l) => l.parent?.line === lineId && l.parent.ply === ply && l.moves[0]?.san === san);
      if (side) hit = { line: side.id, ply: 1 };
    } else {
      const root = demo.lines.find((l) => !l.parent && l.baseFen === demo.baseFen && l.moves[0]?.san === san);
      if (root) hit = { line: root.id, ply: 1 };
    }
    if (hit) this.demoGoto(hit.line, hit.ply);
    return hit;
  }

  /** "Back to my board". The demo is kept so the owner can open it again from the thread. */
  closeDemo() {
    if (this.state.layer !== 'demo') return;
    this.state.layer = 'owner';
    this.state.shapes = { owner: this.savedShapes(), coach: [] };
    this.changed(false);
  }

  /** The SAN moves from a demo's base position to the end of one of its lines (through its parents). */
  demoPath(lineId: string, uptoPly?: number): { baseFen: string; sans: string[] } | null {
    const demo = this.state.demo;
    const line = demo?.lines.find((l) => l.id === lineId);
    if (!demo || !line) return null;
    const own = line.moves.slice(0, uptoPly ?? line.moves.length).map((m) => m.san);
    if (!line.parent) return { baseFen: line.baseFen, sans: own };
    const up = this.demoPath(line.parent.line, line.parent.ply);
    return up ? { baseFen: up.baseFen, sans: [...up.sans, ...own] } : null;
  }

  /** Copy one of the coach's lines into the owner's own move tree as a variation. */
  adoptDemoLine(lineId: string): boolean {
    const path = this.demoPath(lineId);
    if (!path) return false;
    const key = positionKey(path.baseFen);
    const start = Object.values(this.state.tree.nodes).find((n) => positionKey(n.fen) === key);
    if (!start) return false;
    let cur = start.id;
    for (const san of path.sans) {
      const r = addMove(this.state.tree, cur, san);
      if (!r.ok) break;
      cur = r.id;
    }
    this.state.layer = 'owner';
    this.state.focus = cur;
    this.state.shapes = { owner: this.savedShapes(), coach: [] };
    this.changed(true);
    return true;
  }

  // ------------------------------------------------------------ the conversation

  addMessage(m: Omit<CoachMessage, 'id' | 'at'>): CoachMessage {
    const full: CoachMessage = { ...m, id: ++this.counters.msg, at: new Date().toISOString() };
    this.thread.push(full);
    if (this.thread.length > 400) this.thread = this.thread.slice(-300);
    this.save();
    return full;
  }

  clearThread() {
    this.thread = [];
    this.save();
  }
}
