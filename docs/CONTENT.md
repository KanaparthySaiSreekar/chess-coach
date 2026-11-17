# Chess Coach: Content and how it is validated

The owner learns and drills from this material, so **nothing reaches a drill or a lesson until it has
passed the gates below** (decision D21). This file covers what content exists, where it comes from, the
formats, the gates, and the routes for books, PDFs and ChessBase files.

_Written 2026-11-13. Thresholds are starting values; they are settings, and Phases 2 and 8 tune them._

---

## 1. The rule

Every content item has a status:

```
draft  →  machine-verified  →  owner-approved  →  live
                 │
                 └─ a gate fails → quarantined, with the reason and the exact move or sentence
```

- Only **live** items are used by drills, lessons, the coach and the daily plan.
- **Owner approval** is one click per item or per batch on the review screen ([§10](#10-the-review-screen)).
  It can be set to automatic per content type; by default it is automatic for Lichess database puzzles
  and for puzzles from the owner's own games, and manual for repertoires, lessons and courses.
- Nothing is ever "fixed" silently. A doubtful move is shown to the owner with its source.

## 2. Content types and sources

| Type | Comes from | Licence | Used by |
|---|---|---|---|
| Puzzles from the owner's games | The review pipeline ([§6](#6-puzzles)) | the owner's | C1, C2, C7, C8, C9 |
| Themed puzzles | Lichess puzzle database: 6,193,530 puzzles, rated and theme-tagged (as of 2026-11-11) | CC0 | C5, lessons |
| Opening names | Lichess openings list | CC0 | A7 |
| "What players at my level play" | Lichess opening explorer (needs the owner's token) + Maia-3 | Lichess API; answers cached locally | D6, gate V4 |
| Starter repertoire | Generated here ([§7](#7-repertoire)) | the project's | D1, D3, D4 |
| Imported repertoires | PGN files, Lichess studies | the author's; private use, not committed unless the owner wrote it | D2 |
| Repertoires from the book | The owner's outline (`content/repertoires/`, moves only) and the Lichess masters' database: over-the-board games, players 2200 and up; counts of games only, asked through the explorer ([§7](#7-repertoire)) | the project's (the outline: the owner's choice of moves) | D10, D11 |
| Black's repertoire from the book | An outline drawn up by Claude from the owner's choices (`content/repertoires/kid-accelerated-dragon.json`, `listBy: "claude"`), then the masters' database as above | the project's | D10, D11, D13 |
| Trap pack | Authored here, then gated | the project's | D8 |
| Lessons, model-game notes | Authored here to the curriculum ([§8](#8-lessons)) | the project's | F1, F5 |
| Endgame positions | Composed + tablebase verdicts | the project's | F2 |
| Courses and books | The owner's purchases | **copyrighted: stay in `data/courses/`, never committed, uploaded or published** | E |
| Bot roster | `content/bots.json` | the project's | F9 |

Not used as content: chess_rocket's puzzle sets (GPL), anything from Chessable (no export), Lichess
Learn / Practice text (its content licence hasn't been checked; ideas only).

### 2.1 Grounded or made (D13)

The owner studies from all of this, so what was **taken from a reference** is kept apart from what was
**made** (by code, by Claude, or by the engine), in the data and on the page (the owner, 2026-11-17: "it
has to be grounded"). Made things are never presented as if they came from a book; every made thing is
checked by the gates before it is used.

| What | Taken from a reference | Made, and by whom | Where the page says so |
|---|---|---|---|
| A book repertoire's moves past the outline | The Lichess masters' database: every move, both sides, in at least 25 games; the count is kept with the move | Which of the masters' moves is chosen: the most played that Stockfish passes (V2, V7) | The move's labels: *Masters' choice* and *N master games* |
| A book repertoire's outline moves | The owner's choice (the Réti: the owner's chapter list, from a course's headings, moves only) | Black's outline (2026-11-17): drawn up by **Claude** from the owner's choices (the King's Indian, the Accelerated Dragon, the King's Indian setup elsewhere), `listBy: "claude"`; every move in it checked against the masters' games | *Your outline* on the move; *Where it comes from* says whose chapter list it is |
| The opponent's replies | The masters' database (the book rule) and the Lichess explorer at the owner's level | Which are prepared: the reply rule (`repliesToPrepare`), code | The replies' table: master games and the owner's level; *your outline* / *your level* where that is why |
| Chapters | The outline's chapters | A chapter the book added (a move order the outline does not name): named by code from its moves and the Lichess openings list | *added by the book* in the chapter list |
| A move's why and the opponent's idea | Never from a course or a book | The app's own reasons (`moveReasons`, code) phrased by code (`facts`), or written by **Claude** from the same checked facts (`claude`), or the owner's (`owner`); every sentence through V3 | A line under the words: *Phrased by the app from the engine's checked facts* / *Written by Claude …* / *Your own words* |
| Imported repertoires | The owner's PGN or study | — | *Imported* |
| The starter repertoire | — | The engine and Maia around the seed lines (no book behind it) | *Engine-built* |
| Puzzles | The owner's games; the Lichess puzzle database | The engine's solution and the motif tags (code) | The puzzle set's name |
| Endgame positions, mini-games, the trap pack | Known positions and traps (named in the files) | Composed or chosen by Claude and checked: the tablebases (endgames), the engine and the masters' counts (traps) | The tab they are on |
| The coach's messages | — | Written live by the model; every chess statement checked against the engine's facts (the validator) | *Checked by Stockfish* / *Matches Lichess analysis*; *An idea, not a checked fact* for the rest |
| Opening names | The Lichess openings list | — | Beside the moves |

## 3. The envelope

Every item carries the same wrapper (`content_items`), which is gate V6:

| Field | Holds |
|---|---|
| `type`, `status` | As above |
| `source` | One of: site game id · puzzle id · file + page · URL · `generated` with model, date and playbook |
| `licence` | `cc0` · `own` · `project` · `private` · `public-domain` |
| `engine` | Engine version and node budget the gates ran with |
| `gates` | Result of each gate: pass / fail / not applicable, with details |
| `level` | The curriculum band it suits |

`private` items are never written anywhere outside `data/`.

## 4. Formats

**PGN in and out.** The app reads and writes standard PGN with:

- variations (nested), comments, and move marks (`!`, `?`, and the other NAGs);
- Lichess's arrow and circle tags inside comments (`[%cal Ge2e4]`, `[%csl Gd4]`), so a study exported
  from Lichess keeps its drawings, and ours open there;
- custom start positions (`[SetUp "1"]` + `[FEN "…"]`);
- several games in one file (one game = one chapter).

Lichess studies import by URL through the study export API. Opening-book formats such as Polyglot are
not supported.

**Inside the app**

| Thing | Shape |
|---|---|
| Puzzle | Start FEN · optional set-up move (the opponent's move that creates the puzzle, as Lichess stores it) · solution moves · other accepted answers · themes · rating · where it came from |
| Repertoire | A graph keyed by position (placement, side to move, castling, en passant), so transpositions meet. Each of *my* positions has one move, its one-sentence **why**, and the **opponent's idea**; each opponent position has the replies with how often they're played at the owner's level |
| Lesson | Steps in order ([§8](#8-lessons)) with machine-checkable assertions |
| Course | Course → chapters → items (text, position, line, quiz), each item with its source page |

## 5. The gates

| Gate | Checks | Starting threshold |
|---|---|---|
| **V1 Legality** | Every position is valid; every move is legal in order; the PGN survives export and re-import unchanged | exact |
| **V2 Engine soundness** | *Repertoire:* each of my moves keeps the position and loses no material by force. *Puzzles:* the solution is the only good move, or every good move is accepted. *Lessons and traps:* every stated fact is asserted by machine | My move drops ≤ 4 points of winning chances at 5M nodes · solution beats the second-best by ≥ 0.7 on Lichess's −1…+1 scale (their rule) · a mate-in-one accepts every mating move |
| **V3 Text claims** | Every explanation passes the same validator as live coach messages ([ARCHITECTURE §9](ARCHITECTURE.md#9-the-validator)) | all rules pass |
| **V4 Human reality** | The opponent replies covered are the ones players at the owner's level actually play | ≥ 85% of games covered at each opponent position; any uncovered reply with ≥ 5% share is flagged |
| **V5 Consistency** | No position with two different prescribed moves; no dangling or duplicate lines; depth within the level's cap | exact |
| **V6 Provenance** | The envelope is complete; private material is stored only under `data/` | exact |
| **V7 Second opinion** | A deeper, separate engine pass agrees; for PDFs the diagram equals the position reached by replaying the moves; a random sample goes to the owner | 20M nodes, no move reclassified as a mistake · diagrams match exactly · 10% sample |
| **V8 Teaching lint** | Level band set; vocabulary inside the concept ladder; worked example → matching problem present; length limits | all pass |

**Which gates apply**

| Type | V1 | V2 | V3 | V4 | V5 | V6 | V7 | V8 |
|---|---|---|---|---|---|---|---|---|
| Lichess database puzzle | ✓ | sample | — | — | — | ✓ | — | — |
| Puzzle from the owner's game | ✓ | ✓ | ✓ | — | — | ✓ | — | — |
| Safety-check item | ✓ | the verdicts are `check_move`'s | — | — | — | ✓ | — | — |
| Threat item | ✓ | the threat and the verdicts are the engine's | — | — | — | ✓ | — | — |
| Conversion drill | ✓ | the start rechecked as clearly winning; the play judged live | — | — | — | ✓ | — | — |
| Repertoire line | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Trap | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — |
| Lesson, model game | ✓ | ✓ | ✓ | — | — | ✓ | sample | ✓ |
| Endgame position | ✓ | tablebase | ✓ | — | — | ✓ | — | ✓ |
| Imported course or book | ✓ | notes only | — | — | ✓ | ✓ | ✓ | level check (E7) |

**As built for puzzles (WP 6.1).** V1 and V6 are in `core/content.ts`; V2 and V3 in
`server/content.ts`. V2 asks the engine for enough lines to see the first move that is not accepted,
at `content.gateNodes` (5M), and calls a move "as good as the solution" when it is within the 0.7
margin of winning chances **and** wins at least the same material once the captures have run their
course (TRACKER D61): the margin alone cannot tell moves apart in a game that is won whatever is
played. V3 checks the explanation as a coach message, against the facts of the solver's position
and of the solution's first move. A line that fails V1 is not given to the engine.

**As built for repertoires (WP 8.3, TRACKER D74).** `core/repertoire.ts` reads a PGN's lines as written
(an illegal move kept, so V1 names it) and holds V1, V5 and V4's arithmetic; `server/repertoire.ts`
runs them in the order V1 → V2 → V5 → V4 with V7 → V3, V6, one content item per line. V2 grades each
of my moves with the function behind the move labels: more than 4 points of winning chances lost, or
material given away by force, fails. V7 fails a move the 20M-node pass calls a mistake. V5 compares
only lines that passed V1 and V2, and fails the later of two lines that play different moves in one
position. V4 is a flag, not a failure (a gap is a line missing): it names each reply played in 5% of
games or more that has no answer, and the coverage where it is under 85%; the explorer's counts when
it has 20 games or more, else Maia's guess. A line deeper than the level's cap passes V5 with a note.

**V4 for a repertoire built from the book (WP 8.12, TRACKER D93).** Checked against the book the build
kept (`rep_book`): every move of the line, the owner's and the opponent's, must have been played in at
least `repertoire.bookMinGames` (25) of the masters' games, or the line **fails**, naming the move (it is
not book); and at every opponent's position within the build's depth, the replies the rule asked for must
all be answered by some line, or the line is flagged. The rule is the builder's own (`repliesToPrepare`),
so a reply left out on purpose (too rare in the book) is not a gap. A position the build never saw (a
line the owner fixed) is asked of the book then and kept.

**As built for endgame positions (F2, built early, TRACKER D84).** `content/endgames.json` holds the
topics in the ladder's order and the positions, each with its goal (`mate`, `promote` or `draw`) and a
short idea. V1 (`core/endgame.ts`): a legal position not already over, a known topic, five pieces at
most so the Syzygy 3-4-5 tablebases decide it exactly; the side to move is the owner's. V2: the
tablebase verdict for the side to move is the goal's (a win to mate or to queen, a draw to hold). V3:
the idea through the live validator against the position's facts (writing the pack, it refused "a
check along the back rank" in a rook mate where no fact backs a back-rank mate). V8: a level band, at
most three sentences, and a topic with a second position to practise on. V6 the envelope. A position is
gated again only when its entry, the engine or the budget changes; at server start, through the power
gate. They go live by themselves once they pass (`content.autoApproveEndgames`, on), like puzzles.

For an imported course the author's moves and words are kept as they are. If the engine disagrees
strongly with a recommended move, the item gets a visible note ("the engine prefers another move
here") and the owner decides; the transcription itself must be exact (V1, V7).

## 6. Puzzles

Plain code, no model needed (the owner's "normal logic").

**From the owner's games (C1, C2).** After a game is analysed:

| Kind | Made when |
|---|---|
| Mistake puzzle | The owner's move was a key moment and the better move passes V2 |
| Punish puzzle (C2) | The opponent blundered or left material free and the owner didn't take it |
| Threat puzzle (C8) | The board says the owner's slip left their threat unanswered: the task is to name the threat first (by making it), then deal with it |
| Safety-check item (C7) | The owner's move lost material or allowed a mate: shown as "is this move safe?" (about it, and about the engine's choice) and "which of these two is not safe?" |
| Conversion drill (C9) | The owner was clearly winning (80+ winning chances) and didn't win the game: played out against the engine from before the move that threw it |

The rules follow Lichess's own puzzle generator (lichess-puzzler, AGPL, re-implemented here):

- a candidate is a position where the winning chances jump (their trigger: more than 0.6 on the
  −1…+1 scale);
- each solution move must beat the second-best by more than 0.7; when it doesn't, the line stops there;
- a mate-in-one accepts any mating move;
- the line is trimmed so it ends on the solver's move.

A second, **teaching tier** covers what Lichess's rules skip but a 500 player needs: a piece that can
simply be taken. There every move that wins the same material is accepted.

*As built (WP 6.3, `server/puzzle-maker.ts`).* The candidates are the owner's costliest slips in
live positions (`puzzles.perGame`); a puzzle starts one move earlier, with the opponent's move as its
set-up move; at most three of the solver's moves. "The only good move" is the same test gate V2 uses
(TRACKER D61). A slip where several moves were as good makes no puzzle (D62); those go to the
safety-check trainer (C7).

**From the database (C5).** The CSV is loaded into SQLite once (theme and rating indexed). Sets are
drawn by theme and rating around the owner's level: one theme at a time first, then mixed with the
label hidden. Difficulty stays where most are solved.

**Scheduling (C4).** FSRS (`ts-fsrs`). The answer is mapped to its four grades:

| What happened | Grade |
|---|---|
| Wrong, or the answer was shown | Again |
| Right after an arrow | Hard |
| Right after a nudge, or right but slow | Hard or Good (setting) |
| Right, unaided | Good |
| Right, unaided and fast, twice running | Easy |

On review a motif card can bring **the same motif in a new position**. New cards per day and the
**backlog cap** are settings.

*As built (WP 6.5, `core/schedule.ts`).* `ts-fsrs` 6 (FSRS-7), with a miss always due the next day
and no gap under a day or over `puzzles.maxIntervalDays` (TRACKER D63). Cards are made for every
puzzle from the owner's games and for database puzzles that went wrong. "Right but slow" is not used
yet; "fast" is 20 seconds. The same motif in a new position is not built yet.

**The safety check (C7).** *As built (WP 6.6, `core/safety.ts`, `server/safety.ts`).* Made with
the puzzles of a game, from the owner's mistakes and blunders where the move played lost something.
Each slip gives three items: "is this move safe?" about the move played and about the engine's
choice, and "which of these two is not safe?" about both. Each verdict and its reason is
`check_move`'s, asked again when the item is made; the item is made only if the engine still finds
the move played unsafe and its choice safe. Gates V1 (a valid position, legal moves, exactly one
unsafe move in a pair, a reason for every move) and V6. With `safety.listFirst` on, the owner first
makes each of the opponent's checks and captures after the move (worked out by code), and the ones
missed are drawn before the ruling (TRACKER D64). Graded for the schedule as: right with nothing
missed → Good; right with replies missed → Hard; wrong → Again.

**"What's the threat?" (C8).** *As built (WP 6.7, `core/threat.ts`, `server/threat.ts`).* Made
with the puzzles of a game, from the owner's mistakes and blunders whose skipped step, on the
board, is "missed their threat". The threat is the engine's strongest move for the opponent with the
turn passed that wins a mate within three moves or at least a pawn once the captures are over; the
moves that do as much are kept as accepted answers. The item is made only when the engine's first
choice for the owner is safe and the move played was not. Gates V1 (a valid position whose turn can
be passed, every move legal where it is played, a real threat, a reason for every move) and V6. The
owner names the threat by making it (a move not stored is searched too), then plays a move that
loses nothing by force and allows no mate (TRACKER D65). Graded: shown → Again; with hints or misses
→ Hard; clean → Good.

**Win the won game (C9).** *As built (WP 6.8, `core/convert.ts`, `server/convert.ts`).* One drill
for a game the owner drew or lost after being clearly winning (80+ winning chances): the position
before the move that took them below 65, or their last clearly won position. The engine checks the
start again when the drill is made (still 80+, or the drill is quarantined). Gates V1 (a valid
position that is not over, clearly winning, the moves kept legal in it) and V6. Played against the
engine (`conversion.engineNodes`); it ends at mate (converted), at a move that throws the win (with
`check_move`'s verdict), at a draw, or at the move limit (kept) (TRACKER D66). Graded on the first go
only: converted → Good; kept → Hard; otherwise → Again.

## 7. Repertoire

"Validated perfect" is the bar: a repertoire is live only with a stored report showing V1–V7 passed.

**Four ways in, one set of gates**

| Route | How |
|---|---|
| Generated starter (D1) | The builder below |
| PGN file or Lichess study (D2) | Import → gates → quarantine anything that fails, line by line |
| Book or PDF | [§9](#9-courses-books-and-pdfs) → then as PGN |
| ChessBase | Export to PGN outside the app → then as PGN |

**The starter builder**

```
build(colour, seed lines, level):
  walk positions breadth-first down to the level's depth cap
    my move:
        take the seed's move if it has one and it is sound (V2);
        otherwise the sound move that players at this level find most often (Maia-3)
    opponent's move:
        take real replies in order of how often they're played at this level
        (explorer buckets 0–999 and 1000, Rapid + Classical; Maia-3 as a second source)
        until 85% of games are covered or a reply falls under 3%
        mark a reply "punish" when my best answer gains clearly
  write the why and the opponent's idea for each of my moves (authoring skill, from the facts)
  run V1–V7; anything that fails is quarantined with the reason
```

- **Depth cap by level (research default, a setting):** a few moves at 400–700, about 8–10 at
  700–1000, deeper only where the owner's games show gaps.
- **Seed lines** are the owner's choice (TRACKER Q18). The default offered is one simple setup per
  colour. No line is treated as correct until the gates have run on it.
- **As built (WP 8.5, TRACKER D76):** `RepertoireService.buildStarter`; the seeds are the settings
  `repertoire.seedWhite` and `repertoire.seedBlack`. Two refinements: replies are taken past 85% while
  one of 5% or more is left (V4 would name it), and a position reached in under 2% of games from the
  start is not prepared. The why and the opponent's idea come with WP 8.6.
- **As built (WP 8.9, TRACKER D80):** six traps in `content/traps.json`, gated by `server/traps.ts`
  (V2: the owner's move sound and the hoped-for move losing; V4: at least 100 games at the owner's
  level reach the position) and drilled as cards in the opening drill.
- **Trap pack (D8):** Scholar's Mate defence, early queen raids, f7 / f2 attacks, drilled as
  recognition puzzles; same gates.

**From the book (D10, D11; WP 8.12, TRACKER D91–D93).** The owner's outline (`content/repertoires/<id>.json`:
an id, a name, a colour and chapters, each a line of moves from the start, optionally `with` a later move
of the opponent's and a name) says which opening they play. `core/repbuild.ts` builds the rest:

```
buildFromBook(outline, rules):
  best first, by how often a game reaches the position in the masters' games
  (the outline's positions first, counted as reached in at least outlineReach %), until budget lines
    the opponent's position: not past depth of my moves; not where the book has under minGames games;
        once per position (a transposition is prepared once)
      replies: the book's, most played first, until bookCovered % of its games are answered and no reply
        of 5 % or more is left, never one under bookFloor %; the replies players at the owner's level
        make (85 % / 5 % / 3 %) when they are book too; the outline's moves; each in >= minGames games
    my move: the outline's where it names one, else the masters' most played move with >= minGames
        games that passes V2's and V7's rules (the engine); none: the reply before it is not prepared
  each line's chapter: the deepest outline chapter whose position it passes through (by position),
    else one named by its moves up to the opponent's first move off the outline, with the opening's name
  run V1-V7 (V4 against the same book); the lines wait for the owner's approval
```

The defaults (settings): `repertoire.bookMinGames` 25 (the owner's), `repertoire.outlineLines` 650,
`repertoire.buildDepth` 12 (the drill still stops at the owner's level), `repertoire.bookCovered` 90,
`repertoire.bookFloor` 1, `repertoire.outlineReach` 2. The book is the explorer's `masters` database at
its pace (D45), every answer kept; a question that cannot be answered stops the build (it is never read
as "the book ends here"), and running it again replays what was kept. Built again, the repertoire keeps
its id, words and drill history; lines no longer built are removed and logged.

**The words (WP 8.6, TRACKER D77):** the why of each of my moves and the opponent's idea are kept per
position (`rep_positions`), written from the facts with the `author-repertoire` skill
(`tools/author.ts`), and checked sentence by sentence by V3.

**As built (WP 8.8, TRACKER D79):** the cards are content items of type `opening` made from the live
lines (`core/opening.ts`), one per repertoire and position, down to the owner's depth. Since WP 8.14
(TRACKER D94): each card knows its chapters and its place in the teaching order; new cards come in that
order, `openings.newPerDay` (10) a day; the drill can be kept to one repertoire or chapter.

**What a drill card holds (D3, D4):** the position, my move, the why, the opponent's idea or threat,
and the common replies at the owner's level. One card per position, not per line, so a transposition
is learned once.

**In real games (B6, D5, D7):** each imported game is matched against the graph: where it left the
repertoire, who left it, and what to play next time; results are kept per line. As built (WP 8.10,
TRACKER D81): `core/repgames.ts` over the live lines only; after the opponent's new move the engine
gives the move for next time.

## 8. Lessons

Written offline with the `author-lesson` skill, in Yusupov's chapter shape, for the curriculum bands
in [LEARNING §7](LEARNING.md#7-curriculum-from-500-upward-moved-on-by-skill-not-rating).

```yaml
id: back-rank-mate-1
band: 400-700
motif: back_rank
needs: [mate-in-one]                 # lessons that come first
steps:
  - kind: worked_example             # shown, not asked (new motif)
    fen: 6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1
    line: [Ra8#]
    say: "The king is boxed in by its own pawns, so a check on the back rank is mate."
    assert:
      - { after: "Ra8#", is: checkmate }
  - kind: matching_problem           # same idea, the owner solves it
    from: { puzzle_theme: backRankMate, rating: [400, 800], count: 1 }
  - kind: theme_set
    from: { puzzle_theme: backRankMate, rating: [400, 900], count: 6 }
  - kind: mixed_set                  # labels hidden
    from: { puzzle_themes: [backRankMate, mateIn1, hangingPiece], rating: [400, 900], count: 8 }
```

*(The position above is an illustration of the format. Like every lesson it counts only once the
gates have checked it.)*

- Each `assert` is run by machine (gate V2): checkmate, stalemate, wins a named piece, is the only
  move, is a draw by tablebase.
- Each `say` goes through the validator against that step's position (V3) and the vocabulary and shape
  checks (V8).
- **Model games (F5):** a PGN with one sentence per move; each sentence's claims are checked the same
  way. **Mini-games (F6):** a start position, a goal, and which side the bot plays.

## 9. Courses, books and PDFs

Everything here stays in `data/courses/` (gitignored). A pre-commit check blocks it from git.

**PGN course (E1).** Import; each game becomes a chapter. Gates V1, V5, V6. Engine disagreements
become notes.

**PDF or ebook (E3).** Moves in print can't be trusted to a text scraper (the scan's own text layer
reads "1 R—R7" as "iR — R 7"), so:

1. Each page is rendered as an image in two overlapping halves at 280 dpi. A whole page in one
   image leaves a diagram square about 24 pixels wide, too small to tell a piece's colour.
2. **Two authoring sessions** (`import-course-pdf`), each without seeing the other's work, copy
   what is printed: the moves **in the book's own notation**, the author's comments, and for each
   diagram the position it shows. The model does not convert notation or work out a move: code
   resolves each printed move against the position (old books use descriptive notation, "Kt—KB3";
   `descriptive.ts`), and accepts it only when exactly one legal move fits.
3. **Compare:** the two transcriptions are compared move by move and square by square. Where they
   differ, at least one is wrong: the spot is listed with its page.
4. **V1:** every move is replayed; an illegal or ambiguous move, a move number out of order, or a
   printed "ch" or "mate" that is not true on the board stops that line and is listed with its page.
5. **V7 cross-check:** each later diagram's position must equal the position reached by replaying
   the moves to that point. A mismatch is listed with its page.
6. The owner settles each listed spot on the review screen with the page beside it: the
   differences, the failed checks, and whatever a session marked as a doubt.
7. Only then is the chapter studyable. The level check (E7) tags chapters above the owner's band.

**Measured in spike S6** (2026-11-14, 16 pages of a 1921 book: 189 moves, 8 diagrams; D49). Steps 4–5
alone caught 79% of 2,164 single slips planted one at a time, and only about half of those in a
diagram that starts an example, which has nothing to be compared with. With step 3 added: 2,163 of
2,164. The two transcriptions agreed on all 188 moves and all 512 diagram squares they share; the
checks then found three things that are the book's own (a queen printed in the wrong colour, an
ambiguous move, an impossible move). A move the book gives only in words, or not as one move ("K
moves"), is kept as text and listed.

**ChessBase (E2).** There is no reliable open converter: `.cbv` is a closed archive and the open
`cbh2pgn` script is limited. The route is to **export to PGN outside the app** (ChessBase itself, or
its free reader if it can save PGN: to be checked when the owner has such a file), then import the
PGN. Native ChessBase reading is not planned.

## 10. The review screen

Where the owner approves content and settles doubts (J4).

- A list of items by status, filterable by type and gate.
- For a quarantined item: the board at the failing move, the gate's reason in plain words, the source
  (page image for PDFs), and the choices: fix the move, drop the line, or accept with a note.
- For approval batches: the gate report and the random spot-check sample.
- Every decision is logged.

**As built (WP 8.4, TRACKER D75).** *Game → Review content…*: each repertoire's card (its counts, the
gaps at the owner's level, the spot-check sample, one button to approve its waiting lines), then the
items by status (in quarantine, waiting, live), type and gate. A quarantined repertoire line is shown
on the board up to the move that failed; the owner plays another move there and presses *Use the
board's moves*, and the repertoire's gates run again. *Accept with a note* needs the note, which stays
with the item. *Drop* removes it; the log keeps it as it was. Page images for PDFs come with Phase 10.

**Chapters and the book (WP 8.12, 8.13, 8.15; TRACKER D91–D95).** A repertoire built from the book
shows the rule it was built by and what the build noted; its chapters in teaching order with their
counts, each with *Approve this chapter*; the items filter by chapter, and a line says the fewest
masters' games behind any of its moves. The outlines in `content/repertoires/` are listed with
*Build it* (or *Build it again*) and *Stop* while it runs. *Remove this repertoire…* removes one with its
words and drill cards (logged whole first).

## 11. Re-validation

When Stockfish is upgraded or a threshold changes, V2 (and V7 for repertoires) run again over live
content. Items that now fail are quarantined and shown with what changed. Drill history is kept.

**As built (WP 8.11, TRACKER D82).** `server/revalidate.ts` keeps the basis the checks ran with
(engine, budgets, the 4-point rule, the grading thresholds); at server start and after such a setting
changes, a different basis sends the repertoires through their gates again and the live puzzles from
the owner's games through V2. A failure's reason ends "(re-checked after a change of …)". The trap pack
is gated again by its own version, which includes the same basis.

## 12. Commands

| Command | Does |
|---|---|
| `npm run content:validate -- <path or id>` | Runs the gates and prints the report (built, WP 6.1: `tools/content.ts`; `--save` also keeps the items). It exits with 2 when anything was quarantined |
| `npm run content:validate -- --repertoire <white or black> <file.pgn>` | A repertoire PGN through V1–V7, line by line: the quarantined lines with their reasons, the gaps V4 found, the spot-check sample (built, WP 8.3; `--save` keeps it as a repertoire). Engine work and paced explorer calls |
| `npm run content:install -- puzzles` | Loads the Lichess puzzle CSV into SQLite (built, WP 6.4: `tools/content-install.ts`; a file of its own, `data/datasets/puzzles/puzzles.sqlite`; `--min-plays N` leaves out puzzles few people have played) |
| `npm run content:install -- openings` | Loads the openings list |
| `npm run content:build -- --check` · `<outline id>` · `remove <id> --yes` | The outlines read and checked; a repertoire built from the book around one (built, WP 8.12: `tools/build-repertoire.ts`; hours the first time, on mains power; stopped, it saves nothing, and run again it replays what was kept); a repertoire removed |
| `npm run content:revalidate` | Re-runs V2 / V7 over live content |
