# Chess Coach: Architecture

How the app is built. [FEATURES.md](FEATURES.md) says *what*; this says *how*; [PLAN.md](PLAN.md) says
*in what order*. The coach's behaviour is in [COACH.md](COACH.md) and the content rules in
[CONTENT.md](CONTENT.md). When this file and [TRACKER.md](../TRACKER.md) disagree, the tracker wins.

_Written 2026-11-13 (decisions D16–D28). Anything marked **confirm in S1…S6** is an assumption a
Phase 2 spike must prove before it is built on; see [§19](#19-what-the-spikes-must-confirm)._

_Updated 2026-11-14: S1–S3 confirmed and written in (§5, §9, §10); the engine-first rule (D33) and the
Lichess cross-check (D37) changed §3 rule 2, §4, §6, §7, §9, §10 and §12._

_Updated 2026-11-14 (second session, D39–D43): the eval bar, best-move arrows and move labels (§4, §8,
§10); the owner's moves on the coach's board (§4, §5.2); `annotate show` and `show_position at` (§6);
the bots as built (§11); presets and quick settings (§14)._

---

## 1. The shape of the system

One local web app for one person. Everything runs on the owner's laptop.

```
Browser page (React + chessground)
   │  WebSocket: board state, coach messages, arrows, events
   ▼
Node server ── BoardSession (the one shared board; lives here, not in Claude's memory)
   ├─ Engine service ── Stockfish 19 processes (UCI; queue, cache, auto-restart)
   ├─ Bots service ──── Maia-3 Python sidecar (moves + "what humans play here" probabilities)
   ├─ Fact builder ──── verified facts for a position or a move
   ├─ Coach director ── decides *when* the coach is woken
   ├─ Coach supervisor ─ spawns the headless Claude Code session; writes events to its stdin
   ├─ MCP endpoint ──── the coach's tools (localhost, per-run token)
   ├─ Validator ─────── checks every coach message against the board before the page sees it
   ├─ SQLite ────────── games, moments, puzzles, cards, repertoire, courses, profile, settings, events
   └─ Importers ─────── Lichess / Chess.com (finished games only) + fair-play guard
```

Three rules shape everything else:

1. **The app works with the coach off (D18).** Puzzles, drills, scheduling, grading and bots are
   ordinary code. The coach adds conversation on top.
2. **The engine and the board compute the truth; the model only phrases it (D15, D33).** The model
   never originates a move, a line, an arrow, a verdict or a reason: it asks the engine through its
   tools and explains what comes back. It is never trusted on a chess fact.
3. **State lives in the server and the database, never in the model's memory (H1).** A coach session
   can be killed and restarted at any moment without losing anything.

## 2. Repo layout

```
chess-coach/
  CLAUDE.md  TRACKER.md  LICENSE (AGPL-3.0-or-later)  package.json (npm workspaces)
  docs/                 the ground docs
  packages/
    core/               pure chess logic, no I/O: rules wrappers, win% maths, grading, attacks,
                        motifs, facts, validator, puzzle rules, SRS mapping, content gates
    server/             the Node process: HTTP + WebSocket + MCP, services, importers, database
    web/                the page: Vite + React + chessground
  coach/
    fixtures/           recorded events + checks for the playbook test harness
    templates/          scripted fallback messages
  .claude/
    agents/             coach-*.md (the live coach agents)
    skills/             coach-core, one playbook per mode, authoring skills
  content/              open content that may be committed: lessons, starter repertoire, trap pack,
                        concept ladder, bot roster; repertoires/ holds the outlines repertoires are
                        built from (the owner's moves only, WP 8.12)
  data/                 gitignored: SQLite file, datasets, the owner's games, courses, caches
  spikes/               Phase 2 throwaway code
  tools/                scripts: content validation, dataset install, doc checks, Maia sidecar
```

`core` has no file, network or process access, so all of it is unit-testable and the same code checks
live coach messages and stored content.

## 3. Stack and licences

| Layer | Choice | Licence | Why |
|---|---|---|---|
| Language | TypeScript on Node 26 (installed: v26.4.0) | — | One language for page, server and chess logic; Lichess's libraries are TypeScript |
| Page | Vite + React | MIT | Simple single-page app; no server rendering needed for a local tool |
| Board | `@lichess-org/chessground` | GPL-3.0-or-later | Lichess's own board: arrows, drag and click, touch, editor support, 10 KB |
| Rules, SAN, FEN, PGN | `chessops` | GPL-3.0-or-later | Lichess's rules library; chessground has no chess logic by design |
| Engine | Stockfish 19, official Windows build, as a child process over UCI | GPL-3.0 | Strongest engine; used unmodified |
| Human-like bots | Maia-3 (`CSSLab/maia3`) in a Python sidecar | AGPL-3.0 | Predicts what a human of a given rating plays (D20) |
| Database | SQLite through Node's built-in `node:sqlite` | public domain | No install, one file, easy backup. RC stability: all access goes through one module |
| Spaced repetition | `ts-fsrs` (FSRS) | MIT | Current open scheduler; expanding intervals; Node ≥ 24. Installed 2026-11-15: 6.0.0 (FSRS-7), with its one dependency `@open-spaced-repetition/srs-kit` |
| Coach tools | `@modelcontextprotocol/sdk`, Streamable HTTP on localhost | MIT | The standard way to give Claude Code tools |
| Coach runtime | Claude Code CLI, headless (`claude -p`) | Anthropic terms | The owner's own session and plan (D17) |
| HTTP + WebSocket | Fastify + `ws` | MIT | Small and well known |
| Tests | Vitest (unit), Playwright (page) | MIT | — |
| Data | Lichess puzzle database, Lichess openings list | CC0 | Free to use |

- **Project licence: AGPL-3.0-or-later (D23).** It is the only licence compatible with reusing code
  from lila, lichess-puzzler and Maia-3 alongside the GPL libraries. A private repo has no obligations;
  publishing or hosting it for others means publishing the source.
- Versions are pinned in `package-lock.json` when each dependency is first installed. This doc names
  no version it hasn't checked.
- Nothing is copied from chess_rocket (GPL, Python) or claude-chess (MIT, Python): ideas only.

## 4. The shared board and the page protocol

**BoardSession** is the single source of truth for what both sides see.

```ts
type Mode = 'analysis' | 'review' | 'drill' | 'opening' | 'spar' | 'lesson' | 'course' | 'session';

type BoardSession = {
  mode: Mode;
  tree: MoveTree;              // root FEN + moves, with variations
  focus: NodeId;               // the position both sides are looking at
  layer: 'owner' | 'demo';     // demo = the coach is showing something; the owner's place is kept
  demo?: Demo;                 // a base position + engine-built lines, each with sublines (D36)
  orientation: Color;          // the side the owner plays: "your pieces" in everything the coach says
  shapes: { owner: Shape[]; coach: Shape[] };   // arrows and highlights, kept apart
  activity?: ActivityState;    // the current mode's state machine (hint level, puzzle step, clock…)
  seq: number;                 // goes up when the owner's own board changes (move, navigation, load, flip)
};

type Demo = { id: number; label: string; baseFen: string; lines: DemoLine[]; cursor: { line: string | null; ply: number } };
type DemoLine = {
  id: string; label: string; baseFen: string; moves: DemoMove[];
  parent?: { line: string; ply: number };   // a subline branches after `ply` moves of another line
  verdict?: string;                         // the engine's verdict in words, written by code, shown beside the line
  checkedBy?: string;                       // Lichess's cloud analysis, or Stockfish on this computer
};
```

- It is saved to SQLite on every change, so a reload or a server restart resumes exactly.
- The coach never moves the owner's pieces on the `owner` layer. To show something it uses the `demo`
  layer; the page shows the coach's lines in the side panel, the line's position on the board, and
  "Back to my board". A line can be copied into the owner's own moves ("Add to my moves").
- `seq` does **not** move when the coach draws or shows a line, or when the owner steps through the
  coach's line: otherwise the coach's own reply would go stale.
- **The owner may move pieces on the demo layer too (A18, D41).** A move that is the next move of a
  line shown there (or of a side line that starts at that point) just steps along it. Any other move
  is the owner's *alternative*: the engine judges it and plays the replies (the owner supplied one
  move, never a line, so D33 holds), and it is added as a side line with `kind: 'alt'`, labelled
  "Your alternative: …". That is the owner's own action, so `seq` **does** move on, and anything the
  coach was still writing about the earlier position is refused as stale. The owner's own board
  (`tree`, `focus`) never changes from the demo layer.
- **What the engine adds is stored on the moves themselves.** A tree node and a demo move may carry
  `gauge` (the eval bar's reading after it: White's winning chances, a mate count, and centipawns
  that the page shows only when numbers are on) and `judged` (the move's label, §8). They are filled
  in after the fact by the server and saved with the board, so the move list keeps its labels;
  filling them in does not move `seq`. The best-move arrows are not stored: they go out as an
  `insight` message for the focus position.
- **Reset (I14):** `reset` to `start` (the normal starting position) or to `root` (the first position
  of what is loaded, moves cleared). Both drop the demo layer and all drawings.
- **Drawings stay with the position (D46).** A tree node may carry `drawings` (arrows and circles in
  Lichess's four colours), `nags` (the marks a PGN put on the move), `clock`, `emt` and `sourceEval`
  (kept so a PGN is exported as it came; the app never uses another source's evaluation for a
  verdict). What the owner draws on their own board is saved on the focus node and shown again when
  they return to it; in a PGN the drawings are Lichess's `[%cal …]` and `[%csl …]` tags. On the
  coach's board the owner's drawings are not saved. A setting (`display.keepDrawings`) turns the
  board back into a scratch pad.
- **The board editor (I2, D50).** `setup` carries a FEN made by the editor (or pasted into it).
  `checkSetup` in `core/setup.ts` decides whether chess allows the position and gives the reason in
  plain words; the page shows it at once and the server checks again before the board is replaced.
  Castling is kept only with the king on e1 / e8 and that rook in its corner (the rules library
  also knows Chess960; this app and its engine play standard chess), for a pasted FEN as well.
- **What the coach is told about the board (D48).** Every event and `get_state` carry `gameSoFar`
  (the moves from the first position to the focus, with the board's marks) and `boardShows` (the
  label and sentence under the board for the last move). The fact packet judges the last move
  whoever played it (`lastVerdict`), because the owner moves for both sides on this board.

**Page ⇄ server messages** (JSON over one WebSocket):

| Direction | Types |
|---|---|
| Page → server | `hello`, `move` (on either layer), `nav`, `shapes`, `ask` (typed text), `chip`, `coach` (start / stop), `setting`, `preset`, `settings_reset`, `load`, `setup` (a position from the board editor), `new`, `reset`, `label_all`, `flip`, `delete`, `promote`, `demo` (goto / close / adopt), `export`, `clear_thread`, `mode`, `game` (start / move / nav / resign / takeback / retry / new / analyse) |
| Server → page | `state` (full), `thread`, `coach_msg`, `coach_status`, `settings` (with the presets), `play_demo` (animate a line), `engine` (only when the owner switched lines on), `insight` (best-move arrows), `app` (which mode), `game`, `bots`, `busy`, `pgn`, `toast` |

The exact types are in `packages/core/src/protocol.ts`. `activity` messages arrive with the first
activity (Phase 5).

**Two top-level modes today** (`AppMode`): `analysis` (the shared board and the coach) and `play` (a
game against a bot, §11). A bot game has its own tree and its own saved record, so starting one never
touches the analysis board. The `Mode` type above stays the coach's per-activity mode.

The page checks moves with chessops for instant feedback; the server checks again and is the authority.

### 4.1 The look of the page (I16, D44)

The page is styled from one file of design tokens and built from one set of shared controls, so a
new screen looks like the rest without new CSS rules of its own.

- **Tokens** (`packages/web/src/styles.css`, the top of the file): surfaces (`--bg`, `--pane`,
  `--raised`, `--fill`), ink at three strengths, hairlines, blue (`--accent`: press here, you are
  here), amber (`--coach`), green and red, radii, two durations and one easing curve. Dark is the
  base; `:root[data-theme='light']` gives the same names other values. `index.html` sets
  `data-theme` before the first paint; `App.tsx` keeps it in step with the `display.appearance`
  setting and the system.
- **Shared controls** (`ui.tsx`): `Popover` (one open at a time, Escape returns the focus),
  `MenuList` (arrow keys, Home, End), `Segmented`, `Sheet` (a dialog that keeps Tab inside),
  `Transport` (the four step buttons) and `Mark`. Setting controls (`Control`, `Presets`) live in
  `Settings.tsx` and are reused by the *View* popover.
- **Rules:** flat panes divided by hairlines, never a card inside a card; translucent "glass" only
  on what floats (menus, the toast); one filled blue button per view; every icon-only button has a
  label for screen readers and a tooltip; text contrast at least 4.5:1 in both appearances; nothing
  is said by colour alone. `prefers-reduced-motion`, `prefers-reduced-transparency` and
  `prefers-contrast` are honoured.
- **Type and icons:** Inter for the interface and Newsreader for what the coach says (setting
  `display.coachFont`), both from `@fontsource-variable/*` and served by the app itself; icons from
  `lucide-react`. No font or icon service is called.
- **The board's size** comes from a container query on the middle pane: the smaller of its width
  and its height less the rows above and below the board (`--chrome`).

## 5. The coach bridge

The owner's choice (D17): **the page starts the coach.** No terminal.

### 5.1 Starting it

The supervisor spawns one Claude Code process per coach session. **Confirmed in spike S1** (D34):

```
claude -p --model <haiku|sonnet|opus>
       --input-format stream-json --output-format stream-json --verbose
       --mcp-config <generated file> --strict-mcp-config
       --tools "" --allowedTools "mcp__chess__*" --permission-mode dontAsk
       --system-prompt-file <composed prompt>
       --setting-sources project --disable-slash-commands --no-session-persistence
   env: CLAUDE_CODE_DISABLE_CLAUDE_MDS=1, and no CLAUDE* variables inherited
```

- **The prompt is composed by the supervisor** from `.claude/agents/coach-<mode>.md` (its body, its
  `skills:` list) and each `.claude/skills/<name>/SKILL.md`. The coach sees exactly that text.
- `--tools ""` removes every built-in tool; the only tools are the `chess` MCP server's.
- **Why not `--agent`:** it works under `-p`, but it loads the owner's personal skills (34) and plugins
  (15), and in the repo folder both CLAUDE.md files (the project's and the home folder's) are injected:
  7.2k tokens of context instead of 0.7k, and instructions that have nothing to do with coaching.
  The environment variable above is what keeps CLAUDE.md out.
- The generated MCP config points at this server only:
  `{"mcpServers":{"chess":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer <per-run token>"}}}}`
- It uses the owner's normal Claude Code login. **Never `--bare`**: bare mode ignores the plan login.
- On Windows the binary is `~/.local/bin/claude.exe`, spawned directly (no shell).

### 5.2 Talking to it

- **In:** one JSON line per event on stdin, a user message whose text is the event (shape
  `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`, confirmed in S1).
  Two events written back to back are answered in one turn, in order.
- **Out:** the coach acts only through tools. Plain assistant text on stdout is logged and **never
  shown on the page**; only a validated `say` reaches the owner.
- The supervisor reads stdout lines: `system/init` (are the tools connected, which model; it only
  arrives with the first message), `result` (usage → the usage meter; errors), `system/api_retry`
  (shown as "coach is retrying").
- Events from a process that has been replaced are ignored, so an old process can never end the new
  one's turn.

```ts
type CoachEvent = {
  seq: number;                 // the board seq this event is about
  kind: 'activity_start' | 'owner_move' | 'owner_reply' | 'owner_question' | 'owner_tries'
      | 'hint_request' | 'tell_me' | 'why' | 'show_me' | 'step' | 'activity_end' | 'resume';
      // owner_tries: the owner played a move of their own on the coach's board (A18). It carries
      // the engine's verdict and facts for that move instead of a position packet.
  mode: Mode;
  step?: string;               // where the activity's state machine is
  facts: FactPacket;           // §7: everything the coach may talk about
  ladder?: { level: 0 | 1 | 2 | 3; misses: number };
  owner: { band: string; vocabulary: 'core' | 'intro' | 'all'; verbosity: Verbosity };
  budget: { sentences: number };
  text?: string;               // what the owner typed: data, not instructions
};
```

### 5.3 When the coach is woken (the director)

The director is plain code. It decides *whether* an event goes to the coach at all, so a small model
never has to decide when to stay quiet.

| Verbosity (A10) | The coach is woken when |
|---|---|
| `silent` | The owner asks: a chip or a typed question |
| `key moments` | The owner's move drops winning chances by at least the *mistake* threshold in a live position · the owner missed a punishable blunder · the activity reaches a step that needs the coach · the owner asks · occasional process praise (rate-limited) |
| `every move` | Every owner move (plus all of the above) |

- **Debounce and merge:** if the owner acts again before an event is sent, the newer event replaces it.
- **Stale replies are dropped:** every tool call carries the `seq` it answers; if the board has moved
  on, the call is refused and the coach is told so.
- **Idle stop:** the session is stopped after a set idle time and restarted on the next event.
- Defaults per mode are settings ([§14](#14-settings-registry)).

### 5.4 Keeping it healthy

- Crash or exit → restart with backoff and send a `resume` event carrying the current state.
- **Rotation:** a new session on every mode change (each mode has its own agent) and after a set
  number of turns. Nothing depends on the conversation's memory.
- Usage per run is stored (`coach_runs`) and shown on the page (A13).
- `CoachTransport` is an interface with one implementation today (headless CLI). Two more are
  designed for, not built: terminal-attach through channels, and an API key. See
  [RESEARCH §11](RESEARCH.md#11-how-the-coach-reaches-the-page).
- Personal use only. Anthropic doesn't allow offering a claude.ai login inside a product for other
  people; if this app is ever shared, each person brings their own Claude Code or API key.

## 6. The coach's tools

Server name `chess`; eleven tools. Few on purpose: a small model uses a short list well.

**The rule that shapes them (D33): no tool takes a move list, a square or a judgement from the model.**
The coach may name one move ("what if X?"); the engine does the rest.

| Tool | Input | Returns | Notes |
|---|---|---|---|
| `get_state` | — | `seq`, mode, FEN, side to move, last move, layer, ladder, verbosity, the lines shown (and which are the owner's own tries), where the demo board stands, `ownerDrew` | H1 · built. `ownerDrew` lists what the owner drew; an arrow that is a legal move is named as that move **by the app** |
| `get_facts` | `target?: 'focus' \| 'demo'` | a [FactPacket](#7-the-fact-packet), deeper search | Usually already in the event · built |
| `say` | `seq`, `kind`, `text`, `claims?`, `expect?`, `choices?` | `{ok, id}` or `{ok: false, problems[], attemptsLeft}` | The only way to speak. Goes through the [validator](#9-the-validator) · built |
| `check_move` | `move`, `from?` | legal? · the engine's verdict · what it wins or loses in words · **why** (reasons from code) · what it was checked against · fact ids | The verdict on one move · built |
| `play_line` | `seq`, `what: 'best' \| 'move' \| 'threat'`, `move?`, `from?`, `label?` | the line the **engine** built, its verdict, fact ids | `best`: the engine's best play. `move`: the one named move, judged, then the engine's best replies. `threat`: what the other side does with a free move, or a "quiet" fact if there is none. `from`: `focus`, `demo`, or `L3:2` for a subline. Shown on the demo layer with the verdict printed beside it · built |
| `annotate` | `seq`, `facts[]` **or** `show: 'threats' \| 'targets' \| 'attacks'`, `clear?` | `{ok, drawn}`; with `show`, also the facts it drew | Draws **from facts**: the attacking line as an arrow and a **box** on the piece (red when the owner's piece is in danger, amber for a target) for a hangs / attack / pin / check / threat fact; the move for a move fact. A move is drawn only if its piece stands there on the board showing. `show` picks a whole category by code from the packet of the board that is showing: `threats` = what the other side is doing to the owner, `targets` = the owner's chances, `attacks` = every attacked piece. If there is nothing, it says so and hands back the `quiet` fact · built |
| `show_position` | `seq`, `fen?` or `moves?`, `label` · or `at: "L3:2" \| "base"` · or `restore: true` | the facts of the position shown | Enters the demo layer. `at` steps the coach's own board to a moment of a line already shown. Checked by the fair-play guard (Phase 5) · built |
| `owner_profile` | — | the skill profile in plain lines, the habits the journal keeps coming back to, the owner's notes on the game on the board | H5 · built (WP 5.8). Counted by code (`core/profile.ts`); for choosing what to dwell on, never for reading numbers out |
| `find_content` | `type: 'puzzle'`, `theme?` | the live puzzles from the owner's games and the database's themes at their level | H6 · built (WP 6.4). For suggesting practice in words; the owner starts it |
| `start_activity` | `type`, `params` | `{offered}` | The coach proposes; the page asks the owner to accept · Phase 5 |
| `record` | `type`, `data` | `{ok}` | H8. Text goes through the validator too · Phase 5 |

- `say.kind` is one of `question`, `nudge`, `answer`, `explain`, `praise`, `idea`, `summary`,
  `general`. The server moves the hint ladder from these; the coach doesn't keep count. `general` is
  chess knowledge that is not about the position; it may not point at the board, and the page labels
  it as not checked against the board (D38).
- `say.expect` tells the page what input to offer: `none`, `move` (the owner answers on the board),
  `choice` (chips from `choices`), `text`.
- The coach has **no** file, shell, web or other tools. Bots move by themselves; the coach only talks.
- Tools refuse when `seq` is stale, when the fair-play guard trips, or when the mode forbids it
  (for example `play_line` never touches a live sparring game).
- On the *Puzzles* tab (the drill coach, WP 6.11, TRACKER D69) `get_state`, `get_facts` and
  `check_move` answer about the puzzle board, `say` is checked against it, and `annotate`,
  `show_position` and `play_line` refuse: the puzzle player draws and plays on its own board.
  On the *Play a bot* tab (the sparring coach, WP 7.7) `get_state` and `get_facts` answer about the
  game, `check_move` and the board tools refuse, and `say` refuses any move the owner could play.
- After three rejected `say` calls for one event the scripted fallback answers and the event is closed.
  A message that is only too long is let through after one bounce: length is style, not truth.

## 7. The fact packet

What the model is allowed to talk about. Built by `core` plus the engine, never by the model.

```ts
type FactPacket = {
  id: string;                                  // "P1042"; facts are "P1042.F1", "P1042.F2"…
  fen: string; turn: Color; moveNumber: number; ownerSide: Color | null;
  material: { white: number; black: number; inWords: string };      // "you are up a knight"
  lastMove?: { san: string; by: 'owner' | 'opponent' | 'coach' };
  attacks: PieceUnderAttack[];                 // every attacked piece on the board, both sides
  hanging: { mine: PieceRef[]; theirs: PieceRef[] };                // loses material if captured
  cct: { mine: Cct; theirs: Cct };             // checks, captures, threats, as SAN lists
  threat?: ThreatFact;                         // what the opponent does if the owner passes
  engine: { best: EngineMove[]; mate?: number };                    // top 3, winning chances, line ≤ 4 plies
  graded?: GradedMove;                         // only when lastMove was the owner's (§8)
  motifs: MotifFact[];                         // fork, pin, skewer, discovered attack, back rank…
  skippedStep?: SkippedStep;                   // the LEARNING §4 tag, when graded is a mistake
  findable?: { move: string; reason: 'forcing' | 'simple' | 'popular_at_level'; humanShare?: number };
  opening?: { eco: string; name: string; inRepertoire?: boolean };
  tablebase?: { verdict: 'win' | 'draw' | 'loss' };
  facts: Fact[];                               // the flat list the validator checks claims against
};

type Fact = {
  id: string;
  type: 'hangs' | 'wins_material' | 'loses_material' | 'mate_in' | 'check' | 'fork' | 'pin' | 'skewer'
      | 'discovered' | 'back_rank' | 'removes_defender' | 'threat' | 'best_move' | 'only_move'
      | 'safe' | 'unsafe' | 'stalemate_risk' | 'opening' | 'tablebase';
  data: Record<string, unknown>;               // squares, pieces, moves, counts
  text: string;                                // a plain-English sentence for this fact
};
```

How each part is computed:

| Part | Method |
|---|---|
| `attacks`, `hanging` | Attack maps from chessops + static exchange evaluation (who wins a capture sequence on a square). Research: list every real attack for the model (Kim et al. 2024) |
| `cct` | Legal moves filtered into checks, captures, and moves that create a new attack on something worth more or undefended |
| `threat` | A "pass" search: give the opponent the move (when the side to move isn't in check) and see what the engine plays and wins |
| `engine` | Quick engine search, MultiPV 3, scores turned into winning chances |
| `graded` | [§8](#8-grading-moves) |
| `motifs` | Rule-based detectors on the position and the best line; ideas ported from lichess-puzzler's tagger (AGPL), checked against the puzzle database's own theme tags |
| `skippedStep` | Rules from the [LEARNING §4](LEARNING.md#4-how-a-good-coach-reviews-a-game) table: a threat existed and was ignored → *missed their threat*; the move itself hung something → *no safety check*; free material was there and not taken → *missed opportunity*; very fast move or low clock → *time*. "Looked and misjudged" and "assumed their reply" can't be seen by a machine: they come from the owner's self-review and answers |
| `findable` | Among moves within a small margin of the best, prefer forcing and simple ones; from Phase 7, rank by Maia-3's probability at the owner's level (H12). *As built (WP 5.4):* `findableMove` in `core/tags.ts`, returned by `check_move` and kept with each key moment (`Moment.teach`); the Maia ranking is open |
| `Fact.text` | A fixed sentence template per fact type. The scripted fallback speaks these directly; the model rephrases them |

The same builder serves live coaching, game review, puzzle explanations and content gate V3.

**Built so far, and what D33 added** (the types in the code are the reference: `packages/core/src/facts.ts`)

- Fact types in use: `material`, `check`, `attack`, `hangs`, `pin` (to the king, and to a more
  valuable piece), `threat` (theirs, and the owner's own), `mate_in`, `best_move`, `good_move`,
  `only_move`, `fork`, `castling`, `graded`, `wins_material`, `loses_material`, `safe`, `unsafe`,
  `line`, `opening`, `quiet`, `game_over`, `tablebase`.
- **Every fact text is written in the owner's voice** ("your knight", "their bishop") with tokens in
  it, so the scripted fallback can speak it as it is and the coach can copy from it.
- **Reasons come from code.** A move fact ends with "Why: …": it gives check, takes a piece, moves an
  attacked piece out of danger, protects a hanging piece, adds a defender, deals with the threat,
  attacks something new, develops, castles, takes the centre. The tags travel in `data.reasons`; the
  validator refuses a reason the board does not confirm.
- **A verdict travels with the fact:** `data.verdictForYou` is `good` or `bad` for the owner (a
  mistake by the opponent is good news), and `data.source` says what it was checked against.
- **`quiet` facts** are the only backing for "nothing is hanging" or "there is no threat".
- `castling` facts say whether each side can castle now and, if not, what is in the way.
- Two search budgets: the quiet check of every position (250k nodes) decides whether the director
  wakes the coach; whatever the coach speaks from is rebuilt with the deeper search (1M nodes).
- **The last move is judged whoever played it** (`lastVerdict`, D48): the owner moves for both sides
  on the analysis board. `graded` stays the owner's own move, and drives the hint ladder.
- **Exact endgame results (`tablebase`).** With five pieces or fewer the engine reads the Syzygy
  tablebases (`tbhits` in its output). `tablebaseResult` turns that into win / draw / loss for the
  side to move: a mate or a score of ±20000 is a tablebase win or loss, a score of zero a draw.
  The packet then carries a `tablebase` fact ("With best play from both sides, this position is a
  draw. That is exact…") and the eval bar reads "A draw with best play" instead of a lean.
- **Motifs of a line (`core/motifs.ts`).** `motifsOf(fen, moves, solver?)` names the tactics in a
  line of play: fork, pin, skewer, discovered attack, double check, back-rank mate, hanging piece,
  removed defender, trapped piece, mate in N. The definitions are those of Lichess's puzzle tagger,
  so a theme means here what it means in the puzzle database. **Measured against the database's
  own tags** (a fixed sample taken by `tools/sample-puzzles.ts`; 50 tagged and 50 untagged puzzles
  per theme, 11 themes): every tagged puzzle found, no false alarm. The same sample checks the
  exchange and mate-finding code on 100 positions it did not invent. The detectors tag lines; the
  sentences the coach may say about each motif are written when review needs them (Phase 5).
- **Golden files.** For 30 positions (`core/test/fixtures/golden`) the engine's lines are stored
  with what the coach is handed for each. The test rebuilds every packet from the stored lines,
  without an engine, and compares; `node tools/make-golden.ts` prints every sentence that changed
  and rewrites the file. A change to what the coach may say never goes by unread.

## 8. Grading moves

- **Winning chances, not centipawns (D25).** `Win% = 50 + 50 · (2 / (1 + e^(−0.00368208 · cp)) − 1)`
  (Lichess's formula); a forced mate is 100 or 0.
- **Drop** = winning chances after the best move − winning chances after the move played, from the
  mover's side.
- **Internal classes** (never shown as badges unless the owner switches them on, B9):

| Class | Default drop | Note |
|---|---|---|
| inaccuracy | ≥ 5 points | Lichess's 0.1 on its −1…+1 scale. Confirm against lila's `Advice.scala` when built |
| mistake | ≥ 10 points | Lichess's 0.2 |
| blunder | ≥ 15 points | Lichess's 0.3 |

- **A move is also judged by what it gives away (D47).** Winning chances stop moving once a game is
  decided: at 7% a queen given away costs four points and would pass as "good". So the class is
  **the worse of** what the drop says and what the move concretely costs:

| The move, compared with the best move | In a game still open | In a game already decided |
|---|---|---|
| gives away a piece or more (3 points and up) | blunder | mistake |
| gives away the exchange or two pawns (2) | mistake | inaccuracy |
| gives away a pawn (1) | inaccuracy | let through (labelled "good", never "excellent", with what went) |
| walks into a forced mate that could be avoided | blunder | blunder if the mate is in 1 or 2, otherwise mistake |

  "Decided" = the mover's chances were already 10 or less before the move (lost), or are still 90 or
  more after it (won). **Two signals must agree** before anything counts as given away, because
  the material count along an engine line is not proof by itself (the line may stop in the middle
  of an exchange, or the engine may be giving material back on purpose): (1) the engine's line
  after the move ends with less material than its line after the best move, and (2) the engine's
  score after the move is at least a pawn worse than after the best move (half a pawn when the
  mover was already lost: there the score moves less for each piece). In a hopeless position the
  score stops counting pieces altogether, so there the board itself also serves as the second
  signal: the reply simply takes a piece that the exchange on its square says is lost. A sound sacrifice shows (1)
  without (2) and is left alone. Nothing is held against a move when the best move loses as much
  (the label then says "material is lost whatever is played") or when every move is mated
  ("checkmate cannot be stopped here"). `gradeMove` in `core/facts.ts`; `GradeResult` carries
  `byChances`, `floor`, `decided`, `givenAway`, `missed`.
- A **chance passed over** is recorded the same way: the move gives nothing away, but the best move
  mates or wins a piece or more, and the engine's score agrees. In a game that is won either way
  the winning chances do not show it; the label is still "miss" for a piece or a mate in three or
  fewer.
- A **live move** is one played while the mover's winning chances were between 10 and 90, or one
  that took a won game (90 or more) below 90: throwing a win away is the turning point of a game
  (D57, `isLiveMove`). Only live moves count for blunder rates and key moments (our definition;
  chessstats.gg doesn't publish theirs).
- **What it lost, in words:** follow the engine's line after the move for a few plies until the
  captures stop, compare material with the line after the best move, and say it plainly: "loses the
  knight on f3", "loses a pawn", "allows mate in 2". If nothing concrete changes, say "gives up the
  advantage" and, at this level, usually don't make it a key moment.
- **Key moments (B3, DP5):** candidates are the owner's mistakes and blunders in live positions.
  Always take the **first** one (the first turning point), then fill up to the setting (default 3) by
  size of drop, preferring different skipped steps. One unpunished opponent blunder may take a slot.
  Moments are shown in game order.
  *As built (WP 5.3, `core/review.ts`):* `gradeGame` labels every move from one engine result per
  position (the score of a move that was not the engine's choice is the score of the position after
  it, seen from the mover); `pickMoments` applies the rule above. Until the skipped-step tags exist
  (WP 5.4) "different" means a different kind of loss: a mate, a piece, a pawn, a missed chance. A
  slip that cost nothing concrete is a moment only when there is nothing else. The server side
  (`server/review.ts`) runs the two passes; the second is `check_move` itself (D54).
- **Lichess's thresholds, confirmed in its source (2026-11-15):** `lila/modules/tree/src/main/Advice.scala`
  judges a drop in winning chances of 0.1 an inaccuracy, 0.2 a mistake and 0.3 a blunder on its
  −1…1 scale, which is 5, 10 and 15 points on ours; the formula is the one in
  `scalachess/core/src/main/scala/eval.scala` (`2 / (1 + exp(−0.00368208 · cp)) − 1`). Lichess's
  separate rules for a mate created or lost are replaced here by D47.
- All thresholds are settings with these defaults, and every change is logged (G10).

### 8.1 The eval bar (A6)

`Gauge = { white, mate?, cp?, over? }`: White's winning chances (0–100) from the engine's best line,
the same measure every verdict uses. The bar's light part is `white`. A forced mate shows "M3"; the
centipawn number shows only when engine numbers are switched on; otherwise the page gives the
reading in words ("White is clearly better"). `packages/core/src/labels.ts`.

### 8.2 Move labels (A17, D40)

The owner asked for labels "like how chess.com classifies its moves". The names are Chess.com's; the
grading underneath is Lichess's (winning chances, the thresholds above). Chess.com does not publish
its exact rules, so **these are this app's rules**, one per label, applied in this order by
`labelMove` in `core`:

| Label | Rule |
|---|---|
| Forced | The only legal move |
| Book | The position after the move is in the Lichess openings list (it is, or lies on the way to, a named opening). Decided before the engine is asked, as on Chess.com |
| Blunder · Mistake | Drop ≥ the blunder / mistake threshold, **or the move gives material away or walks into a mate** ([§8](#8-grading-moves), D47): the label always carries what was lost |
| Miss | A drop that size where nothing is lost and the position is still fine (≥ 40), but a forced mate or at least two points of material was there for the taking. Also, whatever the drop: nothing is lost, but a piece or more, or a mate in three or fewer, was passed over (D47) |
| Inaccuracy | Drop ≥ the inaccuracy threshold, or a pawn given away while the game is still open |
| Brilliant | The best move, or within the *excellent* margin of it, that **offers at least two points of material** (a piece left to be taken, a rook for a knight), with the mover still not worse after it, and the game not already won without it (the second-best move below 90) |
| Great | The best move when it is the **only** good one (the second-best drops by at least the blunder threshold), unless it is the obvious one: taking a free piece, mate, or one of very few ways out of check |
| Best | The engine's first choice |
| Excellent | Within the *excellent* margin (default 2 points) of the best |
| Good | Anything else below the inaccuracy threshold. A pawn given away in a decided game is "good" at most, and says so |

- A label carries a short reason in side-neutral words ("it loses a knight") and the engine's first
  choice when the move was not it. The page writes: "♞e6 is a blunder: it loses a knight. ♝b5+ was best."
- **Where the analysis comes from.** A quick search (250k nodes) labels a move the moment it is on
  the board. If the owner stays on the position (about half a second), it is judged again with the
  analysis the coach's verdicts rest on: the 1M-node search, checked against Lichess's cloud analysis
  when Lichess has the position (D37). That result replaces the quick one, and the bar and the
  arrows follow it.
- **A label never contradicts what the move costs (D47).** One function (`gradeMove`) decides the class;
  the label on the board, the sentence under it, the fact the coach is given and the verdict beside a
  line are all read from it. A fact never calls a move "good" or "safe" when it loses material:
  the strongest move that still costs a pawn is "the strongest move here, even though you lose a
  pawn", and a move after which material goes whatever is played is "playable: you lose material
  whatever you play here". `tools/label-line.ts` prints the labels and the numbers behind them for
  any line of moves; `tools/label-audit.ts` plays beginner-level games and lists every label a
  person would not accept (run 2026-11-14 on 14 games at 700 and 10 at 1500).
- **The move that should have been played is drawn on the board (A19).** A label carries `bestAt`
  (from and to squares of the engine's first choice). When the label is an inaccuracy, a mistake, a
  miss or a blunder, the page draws it as a green arrow from where the piece stood, and names it in
  the same green under the board. A setting (`display.betterMoveArrow`, on).
- **A label never disagrees with the coach.** Whenever a verdict on a move is handed to the coach
  (`check_move`, a line's first move, the graded last move), the label that verdict implies is
  remembered and wins over any other.
- Labels are shown by default at the owner's request (D39); B9's point stands in how the coach
  talks: it gives the consequence, not the badge.

### 8.3 Best-move arrows (A16)

The engine's first choice for the position on the owner's board, drawn as a pale arrow; a setting
allows two or three, and further arrows are drawn only for moves within the inaccuracy threshold of
the first. **They are held back while the coach is waiting for the owner to find a move** (the hint
ladder is open), and they step aside while the coach's own drawings are on the board. Nothing from
the engine is shown during a game against a bot.

## 9. The validator

Every `say` and every stored explanation passes these checks, in order. It is one function in `core`.

**Tokens.** The coach writes anything checkable as a token; the page renders tokens as clickable moves
and highlighted squares.

| Token | Means | Check |
|---|---|---|
| `{m:Nf3}` | a move in the focus position | legal there |
| `{m:Nf3@F2}` | a move in the position a fact's line reaches | legal there |
| `{sq:e4}` | a square | on the board |
| `{pc:Nf3}` | the knight on f3 | that piece is on that square |

**Rules**

| # | Rule | Reject when |
|---|---|---|
| R1 | No loose chess notation | Something that looks like a move or a square appears outside a token |
| R2 | Tokens are true | A move is illegal, or a piece isn't where the token says |
| R3 | Claims are backed | A claim word ("mate in 2", "wins the queen", "hangs", "fork", "pin", "best", "only move", "safe") has no matching fact id in `claims` |
| R4 | No engine numbers | Evaluations or centipawns appear (unless the owner switched numbers on) |
| R5 | Level vocabulary | A deferred concept from the concept ladder (H11) is used (unless the owner asked about it) |
| R6 | Length | More sentences than the event's budget |
| R7 | Ask before telling | Kind `answer` at ladder level 0 when the stop rules don't allow it |
| R8 | Fresh | `seq` is stale |

- R3 is a word-list check, deliberately simple: a list of claim phrases per fact type. It doesn't
  understand language; it stops the worst inventions. Spike S2: 20 of 20 planted errors caught, 0 of 20
  true messages blocked; the set is now a regression test.
- **What the word list cannot do, and what covers it (D33).** S2 passed, and the live coach still got
  Legal's trap wrong with sentences that were each literally true. The answer was not a longer word
  list but taking the chess away from the model (§6). The validator also gained:
  - piece words must match the board ("their knight on {sq:g4}" when g4 holds a bishop is refused), and
    so must "{pc:A} attacks / defends {pc:B}" and "moves to {sq:e4}";
  - a move named in a sentence that states something must be a move a cited fact is about;
  - a cited fact must be about the same piece, the same move, the same mate count and the same side
    coming out ahead as the sentence says;
  - **a conclusion may not contradict the verdict of the facts it cites** ("you lose your queen" drawn
    from a line that only happens if the opponent blunders). Refined 2026-11-14 after a live false
    alarm: the strongest move in a bad spot can still cost a pawn, and when a cited fact itself
    states that loss the sentence is allowed (a line that ends in mate does not count: the material
    in it is beside the point);
  - a reason given for a move ("{m:X} protects / stops / attacks / develops …") must be one the board
    or a cited fact confirms;
  - "nothing is hanging" and "no threat" need a `quiet` fact, and a `quiet` fact backs nothing else;
  - a move written with "x" must be a capture where it is read, so a move from one position cannot
    silently match a different move in another;
  - a bare square name in running text becomes a token by itself; a bare pawn move does not.
- A plan or an idea that can't be checked is allowed only as `kind: 'idea'`, and the page marks it as
  the coach's own judgement.
- On a reject the tool returns the problems and the coach retries. After two rejects the **scripted
  fallback** speaks from the same facts, so the owner is never left waiting.
- Every verdict is stored in `coach_messages`, which gives a running accuracy measure per playbook.

## 10. Engine service

- **Two pools** so the page stays quick while a game is analysed: `quick` (4 workers) for facts and
  `check_move`; `analysis` (6 workers) for game analysis and content gates. **Every worker is one
  single-threaded Stockfish process** (D35, spike S3): one thread from a clean hash (`ucinewgame` before
  each search) gives the same answer every time; speed comes from running workers side by side.
- **Always validate first.** Stockfish 19 ends its process on an invalid FEN or command, so every
  position and move is checked with chessops before it is sent. If it dies anyway: restart, re-send
  options, retry once, log.
- **Node-limited searches (D25).** Same position + same node count = same answer, on AC or battery,
  cool or throttled. Results are cached in `engine_cache` by position, limits and engine version.
- **Starting budgets** (to tune in S3 on this laptop):

| Use | Nodes | MultiPV |
|---|---|---|
| The quiet check of every position (does the director wake the coach?); the first reading for the eval bar, the arrows and the move label | 250k | 3 |
| Anything the coach states: `check_move`, the lines it shows, the packet it speaks from (D33); the confirmed bar, arrows and label once the owner stays on a position | 1M | 3 |
| "Label every move" of a loaded game (the `analysis` pool, six positions at a time) | 1M (250k on battery) | 3 |
| Game analysis, first pass, every ply (setting `review.passNodes`; the quick-check budget on battery) | 400k | 1 |
| Game analysis, second pass, candidate moments only: the same `check_move` as anything the coach states (D54), at most 12 moves a game | 1M | 3 |
| Content gate V2 | 5M | 3 |
| Content gate V7 (second opinion) | 20M | 3 |

- **Power:** heavy jobs check for AC power first; on battery they warn and use fewer threads (the CPU
  is held to about 45 W on battery and decays to 55 W when hot). Built for the first heavy job,
  "Label every move" (`engine/power.ts`, a `Win32_Battery` query): on battery it says so and uses
  the quick budget.
- **Lichess's cloud analysis as the reference (D37).** For anything the coach states, the server also
  asks `lichess.org/api/cloud-eval` for the position. When Lichess has it at depth 22 or more, its
  lines are the reference and the local search is the cross-check; when it does not, the local search
  stands alone and the page says so. Scores arrive from White's side and are turned to the side to
  move; castling arrives as king-takes-rook and is rewritten the engine's way. One request at a time,
  a 2.5 s timeout, a minute's pause after a 429, answers and misses cached in `lichess_cache`. No
  token. A setting (`engine.lichessCrossCheck`), on by default.
- **Tablebases:** if Syzygy 3-4-5 files are installed, Stockfish reads them (`SyzygyPath`); otherwise
  the Lichess tablebase API (`tablebase.lichess.org`) answers positions with ≤ 7 pieces.
- **Installed (Phase 1, 2026-11-13):** `C:\Tools\Stockfish\stockfish-windows-x86-64-universal.exe`
  (sf_19; it picks the `x86-64-avx512icl` path here). On startup the wrapper checks that `bench`
  reports **2,497,913** nodes; a different number means a different build, which invalidates
  `engine_cache`. Syzygy 3-4-5 is in `C:\Tools\Syzygy\` (290 files, SHA-256 checked). Measured on AC:
  1.65 M nodes/s on 1 thread, 11.8–12.5 M on 16. So 400k nodes is about 0.25 s on one thread, and the
  20M V7 budget is about 2 s on 16.
- **Measured in spike S3:** a 119-ply game, first pass in 7.8 s and both passes in 10.9 s on 6
  workers (35.1 s on one); a 300k-node check in 0.19–0.28 s; Stockfish does exit on an invalid FEN,
  and the worker is restarted and the job retried.

## 11. Bots service (Maia-3)

- A small Python sidecar (`tools/maia_sidecar.py`) loads the model once and answers JSON lines over
  stdio: `{id, fen?, moves[], self_elo, oppo_elo}` → `{id, moves: [{uci, p}]}` (every legal move with
  its probability), or `{id, error}`. The server starts it with the virtual environment's Python by
  absolute path. **Built 2026-11-14 (D42):** Maia-3's own modules expose what is needed (the model,
  the board tokenizer, the legal-move mask), so the sidecar asks the model directly and takes the
  softmax over the legal moves; the UCI engine it ships is not used. It is given the game's moves so
  the model sees the real earlier positions (its history input), not one position repeated. S4
  still has to measure how human the lowest bots are, and the speed on this path.
- **Installed (Phase 1, 2026-11-13):** Python 3.14.10 in `C:\Tools\Python\`; a venv in
  `C:\Tools\Maia3\venv\` with `torch 2.15.0+cu132` (CUDA works on the RTX 4060) and `maia3` from
  `CSSLab/maia3@1e13597`. The model weights are pinned files in `C:\Tools\Maia3\models\`
  (`maia3-5m.pt` at HF revision `b6559de`, `maia3-23m.pt` at `51a0145`, both SHA-256 checked;
  `SHA256SUMS` sits beside them). They are loaded with `--model <alias> --checkpoint-path <file>` and
  `HF_HUB_OFFLINE=1`, so starting a bot never touches the network and the weights never change silently.
- **Measured over UCI** (`go nodes 1`, through python-chess): 5M on CPU 33 ms per move; 23M on CPU 73 ms;
  both on the GPU about 31 ms. The UCI round trip is the floor, so the GPU gains nothing at this layer.
  S4 measures the sidecar path.
- **Watch the seed:** the shipped UCI engine samples with temperature 1.0 and a fixed `--seed 42`, so
  a fresh process fed the same positions plays the same moves (`seed_everything` at startup, then
  `torch.multinomial`). The sidecar samples by itself (above); if the UCI engine is used, pass a new
  seed per game.
- **A move** is sampled from Maia's probabilities with the bot's own temperature and top-p, then
  checked for legality.
- **Think time** is simulated (Maia-3 doesn't model time): a base for the time control, jitter, longer
  when the choice is close. A setting; can be switched off.
- **Roster** (`content/bots.json`): one bot per 100 Elo from 600 to 2000, then every 200 up to 2600,
  each with a name, a short style note, temperature and opening variety. Ratings are on Maia's own
  scale (Lichess blitz); the page says so and shows the Chess.com equivalent only as approximate.
- **Level-matched suggestion:** start near the owner's level and move ±100 after every few games by
  results. Results also feed the skill profile as one signal.
- **Other uses:** `humanShare(fen, elo)` ranks the findable move (H12) and stands in for the opening
  explorer when it is unavailable (D6, gate V4).
- **Engine-style bots** (weakened Stockfish) exist only as a labelled option, off by default: the
  owner asked for human-like opponents.

**Built so far (2026-11-14, D42), ahead of spike S4 at the owner's request**

- `bots/service.ts`: the sidecar's manager (starts on first use or when "Play a bot" is opened,
  restarts after a crash or a 20 s silence, never trusts a move from Python: `legalOnly` re-checks
  every move with chessops) and `sampleMove` (temperature and top-p over Maia's probabilities).
- `content/bots.json`: 18 bots, every 100 Elo from 600 to 2000, then 2200, 2400, 2600, each with a
  name and a band note. A setting scales the variety (steady · like a person · wild); another picks
  the 5M or 23M model.
- `play.ts`, the game loop: the owner's colour (or random), legality, the bot's move with a short,
  uneven pause (a setting), checkmate / stalemate / insufficient material / threefold repetition /
  fifty moves, resign, take back (counted), try again when Maia does not answer. The game is saved
  on every change and survives a restart. A late answer from the bot is dropped if the owner took a
  move back or resigned meanwhile.
- **During a game the engine and the coach are silent:** no eval bar, arrows or labels, and the
  director is not asked. A finished game goes to the analysis board with one click ("Review this
  game with the coach"); a game still in progress is refused there. This is a teaching choice (think
  first), not the fair-play rule: a bot game is not a rated game against a person.
- The level-matched suggestion as built: start at 600; two wins in the last three games against a
  bot move the suggestion one step up, three losses in a row one step down. Results are read from
  the `events` log (`bot_game`), which also keeps each game's PGN until the game library exists.
- **Not built yet:** clocks and time controls (I10), the undo offer (A8), the routine overlay (A9),
  mini-games (F6), `coach-spar`, `humanShare` for the findable move, and S4's measurements.

## 12. Importers, explorer, and the fair-play guard

| Source | Call | Notes |
|---|---|---|
| Lichess games | `GET lichess.org/api/games/user/{user}` as NDJSON with `since`, `perfType`, `clocks`, `opening`, `pgnInJson`, `sort=dateAsc` | Finished games only (Lichess's default). No login: a name is enough. One request at a time; a 429 is reported and the next sync tries again |
| Chess.com games | `GET api.chess.com/pub/player/{user}/games/archives` → each month's games | Serial requests; `If-None-Match` with the month's ETag; a month that ended more than three days ago is not asked for again. Archives can lag by hours: a pasted PGN or a link is the fallback |
| One game by its link | Lichess: `GET lichess.org/game/export/{id}`. Chess.com has no public call for one game: the link is looked up in the owner's months | Feature B8 |
| Opening explorer | `GET explorer.lichess.org/lichess?fen=…&speeds=rapid,classical,correspondence&ratings=0,1000` and `…/masters?fen=…` with `Authorization: Bearer <token>` | **Needs the owner's Lichess token.** Rating buckets are `0, 1000, 1200 … 2500`. Every answer is kept (`explorer_cache`, a month). One call at a time, every three seconds, only the newest position when the owner clicks faster (D45, D73). As built in WP 8.2: `server/explorer.ts`, `core/explorer.ts`; *my games* is counted locally from the library |
| Manual | Paste a PGN (one game or several) | Always available |
| Cloud analysis | `GET lichess.org/api/cloud-eval?fen=…&multiPv=3` | No token. The reference for verdicts when Lichess has the position ([§10](#10-engine-service), D37). Only the position is sent |

**As built (Phase 5, WP 5.1; 2026-11-15).** Three layers, so that the part that decides what a
game is can be tested without a network:

- `core/games.ts` reads what the sites send into one shape, `ImportedGame` (`fromLichess`,
  `fromChessCom`, `fromPgn`): players, ratings and rating changes, the owner's side, the result,
  how it ended, the speed, the time control in words, the moves and the PGN. It refuses with a
  reason: `unfinished`, `variant` (only standard chess from the normal start), `empty`,
  `unreadable`. A Lichess status or a Chess.com result code it has never seen is **not** taken
  for a finished game.
- `server/importers.ts` makes the requests (`Http` is one GET; the tests pass a stand-in that
  answers from recorded files). A generic client name; the only thing sent is the public name.
- `server/library.ts` (`GameLibrary`) syncs, stores and lists. It runs when the app opens, then
  every `import.everyMinutes` (when `import.auto` is on), and when the owner presses *Fetch new
  games*. Lichess is asked from the start time of the newest game seen, less six hours (a game
  that was still being played last time started before that one); Daily games are asked for over
  a fixed 180 days on every sync, because they start long before they end.
- Games are stored in `games`, keyed by `(site, site_id)`: importing twice adds nothing. A game
  with no site (a pasted PGN) gets an id made from its players, date, result and moves.
- **Settings** (group *Games*): `accounts.lichess`, `accounts.chesscom` (text, checked against the
  shape of a site name), `import.speeds` (Rapid, Classical, Daily · those and Blitz · every speed:
  feature B2), `import.casual`, `import.auto`, `import.monthsBack`, `import.everyMinutes`. Changing
  an account or what is imported starts the sync over, so nothing is missed.
- **The page:** the *My games* tab (`Games.tsx`): the two names, the fetch button, each account's
  count, last fetch, ratings and games in progress; a box to paste a PGN or a link; the list,
  newest first, filtered by result. A click puts the game on the analysis board with the owner's
  side facing them (`SessionState.game` names it above the move list).
- Requests use a generic client name; no personal details go in headers.

**Fair-play guard (H10, hard rule, not a setting).** Built in `core/fairplay.ts` (the rule) and
`GameLibrary` (the lists), and applied in `App` (WP 5.2):

1. Importers accept only games with a final result. A PGN whose result is `*`, or that has no
   result, is refused.
2. While the app is open it keeps a list of the owner's games in progress: Chess.com
   `/pub/player/{user}/games` (current Daily games, with position and moves) and Lichess's export
   with `ongoing=true&finished=false`. The list is read on every sync and again when it is five
   minutes old; it is kept in the database (`ongoing_games`), so it is there from the first second
   after a restart; a site that stops answering keeps its last list.
3. **What is off limits** (`guardPosition`, `guardPath`; positions are compared by where the
   pieces stand and whose move it is):
   - the position a game in progress stands in **now**, and anything played on from it (trying
     candidate moves is the help the rule forbids);
   - an **earlier** position of a game in progress, once that game is ten half-moves old (D51).
     The first five moves each belong to thousands of games; refusing them would stop the owner
     studying any opening they are also playing.
4. **At the door** (`guardTree`): a pasted PGN or FEN, a position set up in the editor, and the
   coach's `show_position` are refused when they are a game in progress: by its address on the
   site, by reaching the position it stands in now, or by ending on a position it has been through.
   A finished game that only shares its opening with a game in progress loads.
   The same gate holds the engine and the coach back while the owner goes through one of their
   games themselves (feature B7, `review.ownFirst`): one function, two reasons to stay silent.
5. **On the board** (`App.blocked`): whenever the position being looked at is off limits, however
   it got there (moves made by hand included), the engine and the coach say nothing about it: no
   eval bar, arrows, labels or engine lines; "Label every move" skips it; a question or a chip is
   answered by the app with the refusal, and the model is not asked; `get_facts`, `check_move`,
   `play_line`, `annotate` and `show_position` return the refusal. The sentence is the same
   everywhere (`guardText`).
6. If a list can't be fetched, or no name has been entered, the board shows a standing notice that
   games in progress can't be checked.
7. The rule is also written into `coach-core`, so the coach refuses in words when the owner tells
   it a game is still being played.

What the guard cannot see: a live (not Daily) game on Chess.com while it is being played, since
that list has Daily games only; and a game on an account whose name was not entered.

## 13. Data model

SQLite, one file under `data/`. Migrations are numbered SQL files. Main tables:

| Area | Tables |
|---|---|
| App | `settings`, `events` (append-only log of every answer, hint, setting change and session) |
| Board | `board_sessions` |
| Games | `games` (one row per finished game, keyed by the site and the site's id: players, ratings, the owner's side, result, how it ended, speed, time control, opening, the PGN), `ongoing_games` (the owner's games in progress, for the fair-play guard), `sync_state` (where each sync got to: built in migration 3, Phase 5), `game_reviews` (one row per analysed game, with its numbers), `game_plies` (per move: the label, the drop, live or not, White's winning chances), `moments` (the key moments): migration 4, WP 5.3 |
| Review | `moments` (key mistakes: position, drop, what was lost, skipped step, motifs), `self_reviews` (the owner's own review of a game: the moves they marked, their notes, or that they skipped it: built in WP 5.5), `reviews` (the written report of a game and the owner's note for next time), `takeaways` (one row per game and habit: the journal is a count over it): built in WP 5.7 |
| Content | `content_items` (the envelope: type, status, source, licence, gate results, with the item itself as its body: built in migration 5, WP 6.1; the owner's note when they accept an item against a gate: migration 12, WP 8.4; types `repertoire` (a line), `opening` (a drill card, one per position, WP 8.8), `trap` (WP 8.9) besides the puzzles and drills), `puzzles`, `lessons`, `lesson_progress` |
| Practice | `attempts` (every answer: solved or shown, hints, misses, time, and whether it was a second go: built in migration 6, WP 6.2), `cards` (FSRS state and due date per item: migration 7, WP 6.5). Motif mastery has no table: it is counted from `attempts` and each puzzle's themes when needed (WP 6.9, TRACKER D67) |
| Repertoire | `repertoires`, `rep_positions` (keyed by position, so transpositions merge), `rep_replies` (opponent moves with how often they're played), `studies`, `study_chapters` (the last two built in migration 9, WP 8.1: a chapter is its PGN, with its name and side). As built in WP 8.3 (migration 11): `repertoires` holds each repertoire and its latest gate report; its lines are `content_items` of type `repertoire` (one per line, D74). `rep_positions` (migration 13, WP 8.6) holds the words of each position of mine (the move, its why, the opponent's idea). The drills and the games are matched against graphs built from the live lines when needed (`core/opening.ts`, `core/repgames.ts`); the replies with how often they are played come from the explorer's kept answers (`explorer_cache`, migration 10), so `rep_replies` is not needed. Migration 14 (WP 8.12, D91–D93): `repertoires.plan` (how a repertoire was built from the book: its outline and hash, the book rule, the budget, the depth, what the build noted, its chapters) and `repertoires.outline` (one repertoire per outline, built again in place), and `rep_book` (per position of a book repertoire: the masters' games, the owner's level, the replies the rule asked for, my move with its games), so gate V4 checks against the same answers the build used. A line carries its `chapter`, its place in the teaching `order` and its `book` counts (the masters' games per move); a card its `chapters`, `order` and `book` |
| Courses | `courses`, `chapters`, `course_items` |
| Owner | `profile_snapshots` (the skill profile over time: not built, since the profile and its trend are counted from the analysed games each time, WP 5.8), `sessions` (study sessions and notes) |
| Coach | `coach_messages` (text, claims, verdict), `coach_runs` (agent, model, turns, usage) |
| Caches | `engine_cache`, `explorer_cache` |

- The `events` log starts in Phase 3, so progress tracking (G) has history by the time its screens exist.
- Backup = copy the one file. Export and restore are a Phase 12 feature.

## 14. Settings registry

The owner's rule (D19): keep everything, make it an option.

```ts
defineSetting({
  key: 'review.momentsPerGame', group: 'Review', type: 'number', default: 3, min: 1, max: 5,
  why: 'Coaches go deep on a few moments instead of listing every error (DP5).',
  source: 'research',          // 'research' | 'owner' | 'technical'
});
```

- Every feature registers its settings where it is built. The settings page (K1) lists whatever is
  registered, grouped, each with its *why*, so every option is reachable from Phase 3 onward.
- Every change is written to `settings` and to `events` (the self-experiment log, G10).
- Presets (K2) are named bundles of values. Built 2026-11-14 with the quick settings (K7): *Coach and
  engine* (how the app starts: bar, arrow and labels on), *Think first* (the research defaults: all
  three off), *Lichess-like*, *Quiet coach*. Applying one changes exactly its keys, each logged.
- A setting may carry `optionLabels` (what each choice is called on the page), `step`, and
  `advanced: true` for technical knobs, which the settings page keeps out of the way until asked.
- **Making it quick to use (K7):** a *View* menu in the top bar switches what the board shows without
  opening the settings page; the page itself has the presets on top, a search box, the groups as
  tabs, a *Changed* filter, switches and segmented buttons instead of drop-downs, steppers for
  numbers, and reset per setting, per group, or for everything.
- **Locked, never settings (D27):** the fair-play guard and the copyright rule.

## 15. Security and privacy

- The server listens on `127.0.0.1` only. Phone access (I11) is a later opt-in with a pairing code.
- The MCP endpoint needs the per-run token. The coach process has only the `chess` tools.
- Text from outside (PGN comments, course text, opponents' usernames, anything typed) is passed to
  the coach as data inside the event and never as instructions.
- Secrets (`LICHESS_TOKEN`) live in `.env`, entered through the secret box, never in chat or in git.
- `data/` is never served as static files. A pre-commit check blocks `data/`, `courses/` and `.env`.
- **Course material (D28):** only the item being studied is sent to the coach, for live explanation.
- No telemetry. Outside calls are only: Lichess, Chess.com, and the coach's model.

## 16. Performance budgets

| What | Target |
|---|---|
| A move showing on the board | < 50 ms |
| Quick facts for a position | < 500 ms |
| Coach's first message after an event (Haiku) | median < 4 s |
| Analysing a 60-move game (AC power) | < 90 s |
| A themed puzzle query against the 6M-puzzle table | < 100 ms |

## 17. Testing

| Layer | How |
|---|---|
| `core` | Unit tests with position fixtures: each motif detector, exchange evaluation, grading, the validator (true and planted-false messages), the puzzle rules on known games, each content gate |
| Server | Integration tests with a fake engine; a small tagged set runs against real Stockfish. The importers and the library run against a stand-in for the two sites that answers from recorded files (`server/test/fake-sites.ts`, fixtures in `core/test/fixtures/import` with every name replaced): no test touches the network |
| Coach | The playbook harness ([COACH §9](COACH.md#9-testing-the-playbooks)): recorded events through each agent, scored by fixed checks. Run on demand: it uses plan usage |
| Page | Playwright, one happy path per phase: `npm run test:page` builds the page and drives Chrome against the real server (`http.ts`) around an App with a scripted coach and a stand-in bot, on a free port and a throwaway data folder; it also fails if the browser console logged an error. A geometry test or two run without a browser (`packages/web/test`) |
| Docs | `npm run check:docs` (`tools/check-docs.mjs`): every feature ID sits in exactly one phase; links resolve |
| Repo | `npm run lint` (oxlint: typescript-eslint does not support TypeScript 7); the pre-commit guard (`tools/check-staged.mjs`, tested with a real `git commit` in a throwaway repository) |

Node-limited searches and the cache make engine-backed tests repeatable.

## 18. Risks and fallbacks

| Risk | Fallback |
|---|---|
| The paused plan to bill `claude -p` separately returns | Swap the transport: terminal-attach via channels, or an API key (Haiku is cheap) |
| Haiku gets chess wrong | It only phrases verified facts; the validator; the harness; the Sonnet switch (A14) |
| Maia-3 is unrealistic below 600, or slow on CPU | Measure in S4; larger model on the RTX 4060; extra sampling randomness for the lowest bots, labelled approximate |
| Explorer token or rate limits | Cache every answer; Maia probabilities as the offline stand-in |
| Chess.com archive lag | Manual PGN or game-link import |
| CPU at 100 °C, power decaying to 55 W | Node-limited searches, a background queue, the AC check |
| `node:sqlite` is still a release candidate | All access through one module; swapping the driver is one file |
| Stockfish exits on bad input | Validate first; auto-restart |
| A channel or CLI flag changes | The transport is one small module with its own spike test |

## 19. What the spikes must confirm

| Spike | Confirms |
|---|---|
| S1 | **Confirmed 2026-11-13.** The launch command on Windows; `--agent` under `-p` (works; replaced by a composed prompt, §5.1); the stdin message shape; tool calls over HTTP MCP; latency on Haiku (1.08 s) and Sonnet (1.54 s); stale-event handling |
| S2 | **Confirmed 2026-11-13, with a limit.** The rules catch planted errors without blocking true messages (20/20, 0/20). A word list cannot catch a false conclusion built from true sentences: hence D33 (§6, §9) |
| S3 | **Confirmed 2026-11-13.** The UCI wrapper, the node budgets on this laptop, crash recovery (§10) |
| S4 | **Confirmed 2026-11-14.** Through the sidecar: 20 ms a move for the 5M model on the CPU (23M: 37 ms; the GPU only helps the larger one). Maia-1200 scored 82% against Maia-600, about a 260-point gap rather than 600. Maia-600 blunders about as often as the published figures for 600-rated people (26 and 31 per 100 live moves in the opening and the endgame, against 32 and 34). The probabilities come straight from Maia-3's own modules (§11) |
| S5 | **Confirmed 2026-11-14.** 401 without the token; data for every beginner position at `ratings=0,1000`; about 160 ms a call. Refused (429) at one call a second; **one call every three seconds holds** (D45, §12) |
| S6 | **Confirmed 2026-11-14, with its fallback.** The two checks alone catch 79% of single slips; with a second independent transcription to compare against, 2,163 of 2,164 (D49, [CONTENT §9](CONTENT.md#9-courses-books-and-pdfs)) |

Each result is written into [TRACKER.md](../TRACKER.md) and, if it changes a design here, into this file.
