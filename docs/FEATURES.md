# Chess Coach: Features (the requirements deep dive)

What the coach should do, in the owner's words where possible. How it is built is in
[ARCHITECTURE.md](ARCHITECTURE.md); the order is in [PLAN.md](PLAN.md); status is in
[TRACKER.md](../TRACKER.md).

- **Source:** *owner* = the owner asked for it. *research* = proposed by Claude, the
  [references](REFERENCES.md) or the [research](RESEARCH.md), and **accepted by the owner on
  2026-11-13** (decision D19: "keep all and give us the ease of customization and options to select").
- **Phase:** the build phase that delivers it ([PLAN.md](PLAN.md)).
- **Status:** `agreed`, `agreed (optional)` = built but off by default, `parked` (with the reason). IDs
  never change; a dropped feature becomes `parked`.
- **Everything is an option.** Each behaviour ships as a setting whose default is the research's
  recommendation (group K). Only the two hard rules in §5 can't be switched off.

_Last updated: 2026-11-14 (A19 added; A17's rules changed, D47). Added A15, H18 and H19 from the owner's words (§7), and later the same day
A16, A17, A18, H20, I13, I14, I15 and K7 (§7, "the next addition"); A6 and B9 changed their defaults
at the owner's request (D39). What is built so far is tracked in [TRACKER.md](../TRACKER.md), phase by
phase._

---

## 1. The vision

> "I would have the chess board on web app which you can also see and you will have the skills and
> the chess engine to guide you to coach me and also the webapp with repertoire"
>
> "we need to gear you up too since you are gonna be the coach you need to have all the powers"
>
> "in the web itself i would like to yk see your coaching rather than me again coming to the terminal"
>
> "the final goals for the project is to have a webapp which will basically have the training things we
> mentioned in the research docs and also the live coach training me with each steps and there will
> also be drills and also can play with me and we will basically have all the things chess.com or
> lichess have"

A personal chess coach in a web app. The owner and Claude share one live board. Claude is the coach:
it uses Stockfish and written coaching playbooks to review the owner's games, build and drill opening
repertoires, teach lessons and courses, turn mistakes into puzzles, and lead study sessions. The owner
can play human-like bots at any level. **All of the coaching shows on the web page**, from a Claude
Code session the page starts itself. Around that sits the everyday toolkit of Lichess and Chess.com
(analysis board, explorer, puzzles, studies), built on Lichess's open source.

## 2. The owner (as of 2026-11-13)

| | |
|---|---|
| Level | Beginner, about **500 on Chess.com**. "Nothing like a fixed amount, it should be dynamic." The coach estimates the level from recent games and drill results and moves it as the owner improves. |
| Plays on | Lichess and Chess.com |
| Time controls | Rapid and Classical / Daily (the review looks at these first) |
| Course files | PGN, ChessBase, PDF / ebooks |
| Wants | Game review, repertoire drilling, courses, puzzles from mistakes, lessons, drills, play against bots, a coach that leads each step |

## 3. How the coach teaches

All nine points are agreed. The full behaviour spec is [COACH.md](COACH.md).

1. **Ask first, then explain** (owner's choice). Hints climb a ladder: a question ("what does their
   knight attack?") → a nudge (the area or the piece) → an arrow on the board → the answer with the reason.
2. **Pitched at a beginner.** Hanging pieces, checks / captures / threats, basic mates, opening
   principles. At most 1–3 key moments per game, never a wall of engine lines.
3. **No raw engine numbers.** "You lose a knight" or "that allows mate in 2", not "−3.2".
4. **The engine checks facts; it isn't the teacher** (decision D15). In the owner's words: "I can't
   really learn just by playing moves Stockfish plays, since it's just looking 25–30 moves ahead and it's
   not the organic way for me to learn." The teaching follows how human coaches teach and how people
   learn ([LEARNING.md](LEARNING.md)). Stockfish works in the background to keep every statement true:
   every move, tactic or evaluation the coach states is checked first, never recalled from memory
   ([research §1](RESEARCH.md#1-the-engine-thinks-claude-talks)). Since 2026-11-14 (D33) this goes
   further: the engine *originates* every move, line and verdict, checked against Lichess, and the
   coach only chooses what to explain and how to say it.
5. **One thinking routine, everywhere:** what did their last move threaten → my checks, captures,
   threats → two candidate moves → blunder check. Reviews, puzzles and sparring all come back to it
   ([research §4](RESEARCH.md#4-a-beginners-thinking-routine-is-the-backbone)).
6. **Three hats** (from chess_rocket): teacher (chess content), learning psychologist (pacing,
   what to review when), motivator (difficulty, encouragement, streaks).
7. **Ask about known things, show new things.** Questions are for the owner's own reasoning and for
   motifs already taught. A brand-new motif gets a worked example first, then a matching problem
   (expertise reversal, [LEARNING §3](LEARNING.md#3-how-people-learn-chess)).
8. **Stop rules for the hint ladder.** Give the answer after two misses, on "just tell me", when the
   idea is new, or when the point is deeper than about 2 moves. Close with one "why" prompt, and track
   how much hint help each answer needed ([LEARNING §4](LEARNING.md#4-how-a-good-coach-reviews-a-game)).
9. **Teach the habit before the knowledge.** At 500, games are lost to unchecked threats (36% of
   blunders) and unchecked replies (27%), not missing theory. Every mode trains the thinking routine
   in point 5 ([LEARNING](LEARNING.md)).

## 4. Feature catalogue

### A. The board and the coach on the web page

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| A0 | **Coach on the web page.** The coach's questions, hints, explanations and arrows appear on the page beside the board, and the owner replies there. The owner never has to go back to the terminal. *How (D17):* the page starts a headless Claude Code session and feeds it board events. | owner | 4 | agreed |
| A1 | **Shared live board.** The owner and the coach see the same position, moves, side to move and mode. | owner | 3 | agreed |
| A2 | The coach **draws arrows and highlights** for the threats, plans and squares it's talking about. | owner | 4 | agreed |
| A3 | The coach **sets up positions and lines** to show something, on its own layer so the owner's place is kept. | owner | 4 | agreed |
| A4 | The coach **watches and comments live** while the owner moves pieces during study. | owner | 4 | agreed |
| A5 | **Sparring games** against a bot at the owner's level, with the coach commenting as you play. Built 2026-11-15: the sparring coach (`coach-spar`), at the verbosity the owner chooses; it never suggests a move. | owner | 7 | agreed |
| A6 | **Eval bar** beside the board, in winning chances. The research default was *hidden, so the owner thinks before looking*; the owner asked for it (2026-11-14), so it is **on by default** and the *Think first* preset switches it off in one click (D39). Never shown during a game against a bot. | research → owner | 4 | agreed |
| A7 | **Live opening name** (name and ECO code) on the board. | research | 4 | agreed |
| A8 | After a blunder in a learning game, the coach **offers an undo** and asks what was missed. An undo counts as hint use. Built 2026-11-15 in games against the bots (a setting, on); the question comes from the skipped step. | research | 7 | agreed |
| A9 | **Routine overlay in sparring and drills.** The coach voices the thinking routine before moves at first, then drops the prompts as the habit sticks. Built 2026-11-15 in games against the bots, fading with the blunder rate (TRACKER D71); in the puzzle player too since 2026-11-17, before a puzzle's first move (`puzzles.routineOverlay`, D104). | research | 7 | agreed |
| A10 | **Coach verbosity:** silent / key moments / every move, set per mode ("every move or when required"). | owner | 4 | agreed |
| A11 | **Works with the coach off.** Scripted hints and explanations from the same verified facts, so puzzles and practice run on normal logic. | owner | 4 | agreed |
| A12 | **Coach panel:** the message thread, reply chips (Hint · Just tell me · Why? · Show me) and typed questions. | owner | 4 | agreed |
| A13 | **Start and stop the coach from the page**, with its status and a usage meter. | owner | 4 | agreed |
| A14 | **Model choice per mode** (Haiku or Sonnet). | owner | 4 | agreed |
| A15 | **Ask-the-coach chat that answers on the board.** The owner types any doubt; the coach answers by drawing the threat, having lines and sublines played out on its own board (stepped through move by move, with "Add to my moves"), and explaining in plain words. Each line carries the engine's verdict, printed by the app. | owner | 4 | agreed |
| A16 | **Best-move arrows.** The engine's first choice drawn on the board (one arrow by default, up to three). Held back while the coach is waiting for the owner to find a move, so "ask first" still means something. A setting, on by default (D39). | owner | 4 | agreed |
| A17 | **Move labels like Chess.com's:** brilliant, great, best, excellent, good, book, inaccuracy, mistake, miss, blunder, forced. Every move on the analysis board and on the coach's board gets one, as a badge on the square, a mark in the move list and a line under the board ("♞e6 is a blunder: it loses a knight. ♝b5+ was best."). Worked out by code from the engine's grading; the rules are in [ARCHITECTURE §8.2](ARCHITECTURE.md#82-move-labels-a17-d40). A setting, on by default (D39, D40). | owner | 4 | agreed |
| A18 | **Try your own move while the coach is explaining.** The owner can move pieces on the coach's board. A move that is not the lesson's becomes "Your alternative": the engine judges it and plays the replies, it is shown as a side line marked as the owner's, and the coach explains how it compares (D41). Works with the coach off too. | owner | 4 | agreed |
| A19 | **The better move, drawn on the board, and arrows shaped like the move.** When a move is labelled an inaccuracy, a mistake, a miss or a blunder, a green arrow shows what should have been played, from where the piece stood, and the line under the board names it in the same green ("♛e6 is a mistake: it loses a queen for a bishop. ♝g4 was best."). An arrow for a knight's move is bent like the move, not a straight line across the pieces in between. Both are settings. | owner | 4 | agreed |

### B. Game review

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| B1 | **Import finished games** from Lichess and Chess.com. Built 2026-11-15: the *My games* tab fetches them by your name on each site (no password: finished games are public), lists them newest first with the result, the opponent, the speed and the opening, and a click puts one on the analysis board with your side facing you. | owner | 5 | agreed |
| B2 | Rapid and Classical / Daily games first. A setting (`import.speeds`): those three, those and Blitz, or every speed; unrated games and how far back are settings too. | owner | 5 | agreed |
| B3 | Find the **1–3 key mistakes** in each game, chosen by the biggest drop in winning chances and **starting from the first turning point**, not the final blunder. Built 2026-11-15: opening one of your games has the engine go through it, and the moments are listed under the move list (*Key moments*); how many is a setting (`review.momentsPerGame`). | owner + research | 5 | agreed |
| B4 | **Socratic replay:** show the position before each mistake and let the owner look for the better move, with hints as in §3; the stop rules, a "show me" shortcut, and a log of the hint level each answer needed. Built 2026-11-15: *Go through them with the coach* under *Key moments*; the stop rules are settings (`coach.ladder.maxMisses`, `review.maxDepthMoves`, `review.workedExampleWhenNew`). | owner + research | 5 | agreed |
| B5 | **Tag every mistake** by type (hung piece, missed fork, missed mate…) *and* by which step of the thinking routine was skipped, using the skipped-step table in [LEARNING §4](LEARNING.md#4-how-a-good-coach-reviews-a-game). The tags feed G2. Built 2026-11-15 (`core/tags.ts`): every mistake of an analysed game is tagged and kept; the rules are in TRACKER D55. | owner + research | 5 | agreed |
| B6 | Show **where the owner left their repertoire** in each game (ties to D5). Built 2026-11-15: *Your repertoire* under an opened game (WP 8.10). | owner | 8 | agreed |
| B7 | **The owner's own review first,** engine off, prompted right after a game syncs: what were you thinking, what did you consider? Built 2026-11-15: a game you have not been through opens with the engine and the coach silent; you mark moves and write your thoughts, then *Done* or *Skip*. A setting (`review.ownFirst`, on; D56). | research | 5 | agreed |
| B8 | **New games sync automatically** when the app opens and every half hour after that (settings `import.auto`, `import.everyMinutes`). Chess.com's archive can lag by hours, so a manual PGN or link import is always there: paste a PGN (one game or several) or a link to a game. | research | 5 | agreed |
| B9 | **Plain consequences, not just a badge.** Whenever a mistake is shown, the owner gets what it cost in words ("this lost your knight"). The research wanted the Brilliant / Inaccuracy-style badges kept internal; the owner asked for them (A17), so they are on by default and remain a setting (D39). In a review the coach still picks 1–3 moments instead of walking every badge. | research → owner | 5 | agreed |
| B10 | A **review report** after each game: 2–4 written takeaways and a positive sandwich; the winning-chances chart is an option. Built 2026-11-15: *The report* under *Key moments*; the chart is the setting `review.chart`. | research | 5 | agreed |

### C. Puzzles and drills from my mistakes

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| C1 | The owner's **own mistakes become puzzles.** Built 2026-11-15: every game you go through gives puzzles where the position has one right answer, played on the *Puzzles* tab. | owner | 6 | agreed |
| C2 | **Opponent blunders the owner didn't punish** become puzzles too, including free material not taken. Built 2026-11-15 ("punish" puzzles; a piece two pieces can take accepts either capture). | research | 6 | agreed |
| C3 | Puzzles are **tagged by theme.** Built 2026-11-15, by the motif detectors; shown once a puzzle is over. | owner | 6 | agreed |
| C4 | Puzzles come back on a **spaced-repetition** schedule until they stick: expanding intervals, the same motif in new positions, hint level feeding the schedule, and a backlog cap. Built 2026-11-15 (FSRS; *Due today* on the *Puzzles* tab; new per day and the cap are settings); the same motif in a new position since 2026-11-17: every other time a puzzle from your games comes back, a puzzle of the Lichess database with its idea stands in for it (`puzzles.sameIdeaNew`, D104). | owner + research | 6 | agreed |
| C5 | **Theme training from the Lichess puzzle database** (6.2M puzzles, rated and themed, CC0) at the owner's level: one theme at a time first, then mixed with labels hidden; misses always explained. | research | 6 | agreed |
| C6 | **Woodpecker rounds:** solve the same puzzle set again and again, faster each round. The research suggests it from about 1200; the owner keeps it available. Built 2026-11-15, off by default (TRACKER D68). | research | 6 | agreed (optional) |
| C7 | **Safety-check trainer.** Show a candidate move; the owner lists the opponent's checks, captures and threats, then rules it safe or unsafe. Variant: which of these two moves blunders? Built 2026-11-15: from the slips of every game you go through; you make their checks and captures on the board, then rule (TRACKER D64); since 2026-11-17 their threats too, a threat being what the app's reasons call one: a quiet move after which something of yours can be won (`safety.listThreats`, D104). Since 2026-11-17 the coach is beside it: ask it anything, and it says nothing that gives an open one away (TRACKER D105). | research | 6 | agreed |
| C8 | **"What's the threat?" puzzles,** built from positions where the owner missed the opponent's threat. Name the threat before finding a move. Built 2026-11-15: you name it by making their move on a board where it is their turn, then find a move that deals with it (TRACKER D65). Since 2026-11-17 the coach is beside it: ask it anything, and it says nothing that gives an open one away (TRACKER D105). | research | 6 | agreed |
| C9 | **Win-the-won-game drills.** Positions from the owner's games where they were clearly winning and didn't convert, played out against the engine. Built 2026-11-15: one a game, played to mate against Stockfish; the move that gives the win away ends it, with the reason (TRACKER D66). The defender can be Maia at your level instead, the engine still judging the win (`conversion.defender`, 2026-11-17, D104). Since 2026-11-17 the coach is beside it: ask it anything, and it says nothing that gives an open one away (TRACKER D105). | research | 6 | agreed |

### D. Opening repertoire

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| D1 | **White and Black repertoires** that start simple and principle-based (one setup per colour, a few moves deep, plus the replies players at this level actually make) and get deeper as the owner improves. The depth is a setting. The starter builder is built (WP 8.5). White's opening is chosen (2026-11-15, Q18): the Réti with the Nimzo-Larsen setup, built from the book (D10); Black's waits on the owner. | owner + research | 8 | agreed |
| D2 | **Import repertoires** from PGN files, Lichess studies and courses; ChessBase by exporting to PGN first. Built 2026-11-15 for PGN files, Lichess studies and the owner's studies (WP 8.7); courses come with Phase 10. | owner | 8 | agreed |
| D3 | **Chessable-style spaced-repetition drills,** one card per position. Built 2026-11-15 (WP 8.8): *Openings → Practice* (D85). | owner | 8 | agreed |
| D4 | **Every move's idea is explained.** Drills also cover the opponent's common replies and threats, not just the owner's own moves ([research §6](RESEARCH.md#6-spaced-repetition)). | owner + research | 8 | agreed |
| D5 | **Spot deviations** in real games: where the owner or the opponent left the repertoire, and what to do next time. Built 2026-11-15 (WP 8.10); since 2026-11-17 an opponent's new move goes into the repertoire from the game's note, with the engine's move after it, through every gate (*Add to my repertoire*, D104). | owner | 8 | agreed |
| D6 | **What players at the owner's level actually play** in each line (Lichess explorer with the owner's token; Maia-3 as the stand-in). The explorer and the stand-in are built (WP 8.2); using them line by line comes with the repertoire (8.5, 8.8). | owner | 8 | agreed |
| D7 | **Results per line** (see G3). Built 2026-11-15: *Your openings* on *My games* (WP 8.10). | owner | 8 | agreed |
| D8 | **Opening trap pack.** Scholar's Mate defence, early queen raids and f7 / f2 attacks, drilled as recognition puzzles. Built 2026-11-15: six traps in the opening drill (WP 8.9). | research | 8 | agreed |
| D9 | **An Openings section of its own:** a tab for the repertoire and all its practice: browse each repertoire position by position with the why of every move and the replies prepared, build or import one, drill it, the trap pack, and how each line goes in your games. | owner | 8 | agreed |
| D10 | **A collection of rich repertoires, each grounded in the book.** A repertoire is built around an outline of the owner's moves (`content/repertoires/`, chapter by chapter): past them, every move of every line, theirs and the owner's, must have been played in the Lichess masters' database (at least 25 games, a setting), the owner's moves are the masters' most played that the engine passes (V2, V7), and the replies are the book's main lines and sidelines plus those common at the owner's level that are book too; about 650 lines, the positions met most often first, up to 12 moves deep. A side can hold several such repertoires; one can be removed. The first: the Réti with the Nimzo-Larsen setup (1.Nf3, 2.b3) for White. | owner | 8 | agreed |
| D11 | **Chapters.** A repertoire's lines are kept in chapters (the outline's, then the ones the book adds) in a teaching order: browsed, approved, given their words and drilled chapter by chapter; new cards come a few a day (a setting). | owner | 8 | agreed |
| D12 | **The coach beside the repertoire.** On the Openings tab the coach sees the board in front of the owner, the position they walked to in their repertoire or the practice card, and the owner can ask it anything at any time; it answers from that position's checked facts, and while a card asks for the move it never names it. A move the app has no written reason for is explained by the coach when asked. Built 2026-11-16 (WP 8.17). | owner | 8 | agreed |
| D13 | **Grounded or made, always said.** What comes from a reference is kept apart from what was made, on the page and in the data: each repertoire move says whether it is the owner's outline move, the masters' choice past it (with its count of master games), a reply players at the owner's level make, an import, or the engine-built starter's; a chapter list says whether it is the owner's or was drawn up by Claude from the owner's choices, and a chapter the book added says so; each move's words say who wrote them (the app's own reasons phrased by code, Claude from the checked facts, or the owner). Built 2026-11-17 (WP 8.18). | owner | 8 | agreed |

Every repertoire line is live only after the validation gates pass ([CONTENT.md](CONTENT.md), group J).

### E. Courses

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| E1 | Import **PGN** courses. | owner | 10 | agreed |
| E2 | Import **ChessBase** files. The formats are closed, so the route is: export to PGN outside the app, then import (J9). | owner | 10 | agreed |
| E3 | Import **PDF / ebook** courses: pages are transcribed, every move is replayed for legality, and each diagram is checked against the moves (J8). | owner | 10 | agreed |
| E4 | **Study chapter by chapter** on the board, with the coach explaining. | owner | 10 | agreed |
| E5 | **Find-the-move quiz mode** on course positions. | owner | 10 | agreed |
| E6 | **Completion tracking** per course and chapter. | owner | 10 | agreed |
| E7 | **Level check on imported courses.** Flags chapters above the owner's level and suggests an order ("addition before counting"). | research | 10 | agreed |

### F. Training

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| F1 | **Beginner lessons:** checkmate patterns, piece values, opening principles, simple endgames. They follow the curriculum bands; each runs worked example → matching problem → single-theme set → mixed set. | owner + research | 9 | agreed |
| F2 | **Endgame training:** play key endgames against the engine until you can win or hold them. Order: K+Q, then K+R (with stalemate traps), then the two-rook ladder, square of the pawn, opposition. Built early on 2026-11-15 at the owner's request as the *Endgames* tab (D84): the ladder above plus Lucena and Philidor, every move judged by the tablebases; random starts for the basic mates (D87) and a coach of its own (D88). | owner + research | 9 | agreed |
| F3 | **Daily study plan:** the coach picks today's mix of review, drills, puzzles and course work, and offers two or three choices. | owner + research | 11 | agreed |
| F4 | **Full practice games against the coach's bots** at the owner's level (overlaps A5). | owner | 7 | agreed |
| F5 | **Short model games, every move explained** (Chernev style, one sentence per move, matched to the level). | research | 9 | agreed |
| F6 | **Mini-games with few pieces** (pawn wars, queen vs pawns…) to practise one idea at a time. Built 2026-11-15: four, in `content/minigames.json`, on the *Play a bot* tab. How the bots play them was measured on 2026-11-17: as surely as whole games, and harder as the rating rises; two start positions do not practise their idea yet (TRACKER D105, Q31). | research | 7 | agreed |
| F7 | **"Two by two" visualisation drills** (from about 800): read two moves, picture them, then play them out. | research | 9 | agreed |
| F8 | **Guided session:** the coach leads a study session step by step ("the live coach training me with each steps"). | owner | 11 | agreed |
| F9 | **Bot roster:** a human-like bot for each Elo step, with names and styles ("multiple bots for each elo and they must be human like"). | owner | 7 | agreed |

### G. Progress tracking

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| G1 | **Ratings and results** from Lichess and Chess.com. Stored with every game (both ratings, the change, the result and how the game ended); *My games* shows your rating after the newest rated game of each speed and your wins, losses and draws. The trend over time comes with the progress screens (Phase 11). | owner | 5 | agreed |
| G2 | **Mistake-pattern trends:** are hung pieces getting rarer? Which skipped step costs most? Built 2026-11-15: the profile on *My games* counts each skipped step and, once there are enough games, says whether it and the four figures are better or worse lately. | owner | 5 | agreed |
| G3 | **Opening stats:** results per repertoire line, and where prep runs out. Built 2026-11-15 (WP 8.10). | owner | 8 | agreed |
| G4 | **Study habits:** time studied, drills due, courses completed, and forgiving streaks (freezes or weekly targets) tied to real work, not puzzle counts. | owner + research | 11 | agreed |
| G5 | **The dynamic level, as a skill profile:** blunders per 100 live moves, hung pieces per game, opening-loss rate, conversion rate, per-motif mastery; rating only as a cross-check. It drives difficulty and explanation depth. Built 2026-11-15 (`core/profile.ts`; the figures' definitions are TRACKER D60); per-motif mastery comes with the puzzles (Phase 6). | owner + research | 5 | agreed |
| G6 | **Session notes** and a running **takeaway journal** the coach revisits, so the next session picks up where this one ended. Built 2026-11-15: a note for next time with each game, the journal on *My games*, and each report says how the last game's takeaways fared. | research | 5 | agreed |
| G7 | **Per-motif mastery tracker.** Drives worked example → partial → full → mixed, and how much the coach explains. Built 2026-11-15: counted from your puzzles; sets each puzzle's guidance and what mixed sets mix; listed as *Your ideas* on the *Puzzles* tab (TRACKER D67). | research | 6 | agreed |
| G8 | **Tilt guardrail.** After synced losses, especially two or more, suggest a 30-minute break or a review instead of another game. | research | 11 | agreed |
| G9 | **Progress panel with ranges.** Process measures first, rating second; forecasts shown as a spread. | research | 11 | agreed |
| G10 | **Self-experiment log.** Records settings (spacing, puzzle mix, coach style) alongside results, so they get tuned from the owner's own data. | research | 11 | agreed |

### H. The coach's powers (Claude's toolkit)

The capabilities Claude needs to be a real coach. How they are delivered:
[ARCHITECTURE.md](ARCHITECTURE.md) §5–§9.

| ID | Power | What it covers | Phase |
|---|---|---|---|
| H1 | **See** | The live board: position, moves, side to move, current mode, the owner's last action. The board state lives outside Claude's memory, so a long session or a context reset never loses the game. | 3 |
| H2 | **Act** | Load positions and lines, draw arrows and highlights, put comments on the board, propose an activity (review / drill / sparring / lesson / course). | 4 |
| H3 | **Engine truth** | Analyse a position (top candidate moves), grade a move (best → blunder, and what it lost in plain words), find the opponent's threat, list legal moves. **Every move Claude mentions is checked as legal first.** | 4 |
| H4 | **Explain in words** | Spot motifs (hanging piece, fork, pin, skewer, back-rank mate), list every real attack on the board, name the opening, give endgame truth from tablebases. | 4 |
| H5 | **Know the owner** | Level estimate and its history, mistake patterns, repertoire, drills due, course progress, notes from past sessions. | 5 |
| H6 | **Content** | The owner's games, puzzles (their own plus the Lichess database), courses, a lessons curriculum, an openings list. | 6 |
| H7 | **Spar** | Human-like opponents at any level: Maia-3 bots, one per Elo step (D20). Stockfish's own strength setting stops at 1320, far above 500 ([research §5](RESEARCH.md#5-sparring-at-500-is-the-hardest-engine-problem)). "Play like this opponent" from their games stays a later idea. | 7 |
| H8 | **Write back** | Save takeaways, review reports and session notes; confirm mistake tags. Built: the owner confirms or changes a tag on the page (WP 5.7); when a tag is one the board cannot settle, the app asks which it was after the replay (TRACKER D105). | 5 |
| H9 | **Playbooks** | Written coaching routines, one per mode: explain a position, review a game, run a drill session, spar, drill openings, teach a lesson, study a chapter, host a session. Each enforces §3 ([COACH.md](COACH.md)). | 4 |
| H10 | **Guardrails** | Refuse positions from games still in progress (both sites list ongoing games, so this is checked), and keep course content local. Not a setting. Built 2026-11-15 for games in progress: refused when pasted, set up or shown by the coach, and the engine and the coach are silent on such a position however it reached the board; which positions count is decision D51 ([ARCHITECTURE §12](ARCHITECTURE.md#12-importers-explorer-and-the-fair-play-guard)). | 5 |
| H11 | **Concept ladder** | Limits explanation vocabulary to the owner's level ([LEARNING §5](LEARNING.md#5-explaining-in-human-words)). | 4 |
| H12 | **Findable-move selector** | When the gap is small, teach a simpler human move rather than the engine's first choice; ranked by Maia-3 once the bots exist (done 2026-11-15, WP 7.8: the move players at the owner's level play most often, when Maia is running). | 5 |
| H13 | **Claim validator** | Rejects any coach message whose move, square, piece or claim the board doesn't confirm. | 4 |
| H14 | **Coach director** | Plain code that decides when the coach is woken, from the mode, the verbosity and what just happened. | 4 |
| H15 | **Fact packet** | The verified facts for a position or move: the only thing the coach may talk about. | 4 |
| H16 | **Coach supervisor** | Starts, watches, restarts and rotates the coach's session; tracks usage. | 4 |
| H17 | **Playbook test harness** | Replays recorded events through each coach agent and scores rule-keeping, on Haiku and Sonnet. Built 2026-11-15: `npm run test:coach` (30 scenarios; results in `coach/results/`). | 4 |
| H18 | **Engine-first tools** | The engine and the rules code originate every move, line, arrow, verdict and reason. The coach names at most the one "what if" move the question is about; it never types a line, a reply or a square to draw. A conclusion that contradicts the engine's verdict, or a reason the board does not confirm, is refused (decision D33). | 4 |
| H19 | **Lichess cross-check** | Every verdict the coach states is checked against Lichess's cloud analysis when Lichess has the position; the deeper analysis is the reference, and the page shows which one a message rests on (decision D37). A setting. | 4 |
| H20 | **Full board control** | The coach can show a whole category at once (every threat against the owner as red boxes with the attacking lines as arrows; the owner's targets; every attacked piece), set up positions, step its own board to any moment of a line it has shown, and read what the owner does there: the moves they try (A18) and the arrows and circles they draw. It still names no square and no line: the app works the drawings out from facts (decisions D41, D43). | 4 |

All H rows: source *owner* ("you need to have all the powers") for H1–H10, *research* for H11–H12,
*owner + research* for H13–H17, *owner* for H18–H20. Status: agreed.

### I. Site parity ("all the things chess.com or lichess have")

| ID | Feature | On the sites | Source | Phase | Status |
|---|---|---|---|---|---|
| I1 | **Analysis board:** move tree with variations; engine lines and the bar as switches. | Analysis board | owner | 3 | agreed |
| I2 | **Board editor:** set up any position; paste a FEN. | Board editor | owner | 3 | agreed |
| I3 | **Opening explorer panel:** what my level plays, what masters play, my own games. Built 2026-11-15: under the moves on the analysis board (WP 8.2, D73). | Opening explorer | owner | 8 | agreed |
| I4 | **Puzzle modes:** streak and timed runs. Speed drills are secondary at this level, so they are off by default. Built 2026-11-15: silent, and kept out of the schedule and the level (TRACKER D68). | Puzzle Streak / Storm / Rush | owner | 6 | agreed (optional) |
| I5 | **Coordinates and board-vision drills.** | Coordinates trainer | owner | 9 | agreed |
| I6 | **Studies:** my own annotated lines in chapters, with arrows; the base for repertoires and courses. Built 2026-11-15: *Game → Studies…* on the analysis board. | Studies | owner | 8 | agreed |
| I7 | **Game library** with PGN import and export. | Library, import | owner | 3 | agreed |
| I8 | **Tablebase lookup** for positions with few pieces. | Tablebase | owner | 9 | agreed |
| I9 | **Board preferences:** themes, piece sets, sounds, coordinates, click or drag. The coordinates sit outside the board, in a gutter left of the ranks and under the files (the owner, 2026-11-17). | Preferences | owner | 3 | agreed |
| I10 | **Clocks and time controls** against bots. Built 2026-11-15: no clock by default; rapid and classical controls (TRACKER D70). | Play vs computer | owner | 7 | agreed |
| I11 | **Phone-friendly layout** on the home network (TRACKER Q7). | Mobile apps | owner | 12 | agreed |
| I12 | Online play against humans, tournaments, teams, chat, TV, variants. | — | — | — | parked: a single-user local app; the owner plays humans on the real sites (D24) |
| I13 | **Piece icons in moves:** ♘f3 instead of Nf3 in the move list, the coach's lines, the engine lines and the coach's messages. A setting (icons or letters). | Figurine notation | owner | 3 | agreed |
| I14 | **Reset the whole position** on the analysis board: back to the starting position, or clear the moves and keep the first position of what was loaded; optionally clear the conversation too. | Board reset | owner | 3 | agreed |
| I15 | **Menu and mode picker** wired to everything that exists: the modes as tabs (Analysis board · Play a bot), one *Game* menu with every action of the current mode, and a *View* menu for what the board shows and how the page looks. Each new mode and action is added here as it is built. | Site navigation | owner | 3 | agreed |
| I16 | **The look of the page, and where things live:** an Apple-style interface (quiet panes, one toolbar, the board as the picture); the menus, options and drop-downs rearranged (a *Game* menu, the *View* switches, a settings window with the groups down the side, the coach's options behind one button); light and dark as a setting; the coach's words in a book typeface, as a setting. Nothing was removed: every action and setting is still there. | Site design | owner | 3 | agreed |
| I17 | **Captured material beside the board:** the pieces each side has taken on its edge of the board, and +2 or +3 for the side ahead in material, as on Chess.com (or only the difference, as on Lichess, or off: a setting). Built 2026-11-15 on the analysis board and in games against the bots. | Analysis board, game screen | owner | 3 | agreed |
| I18 | **The computer's load in the top bar:** CPU, memory and GPU use beside *Game* and *View*, with the numbers behind them on press (the GPU's memory, heat and power; this app's server and its Stockfish engines). Sampled every three seconds while the page is open; nothing leaves the machine; a setting. Built 2026-11-17 (WP 3.12). | Site chrome | owner | 3 | agreed |

The rest of the two sites maps onto other groups: play vs computer and Play Coach → A5, F4, F9 ·
puzzles, themes and the puzzle dashboard → C5, G7 · Learn, Practice and lessons → F1, F2 · game review
and "learn from your mistakes" → B · insights → G · Chessable-style drilling and courses → D3, E.

### J. Content and validation

The owner: "those need to validated perfect cause i am gonna learn and practice based on that." Full
rules: [CONTENT.md](CONTENT.md).

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| J1 | **Formats:** PGN in and out with variations, comments and drawings; Lichess study import; a position-keyed repertoire so transpositions merge. Built 2026-11-15 (`core/study.ts`, `core/posgraph.ts`). | owner | 8 | agreed |
| J2 | **Validation gates V1–V8** with a stored report per item: legality, engine soundness, text claims, human reality, consistency, provenance, second opinion, teaching lint. Built so far (2026-11-15): V1, V2, V3 and V6 for puzzles, with `npm run content:validate`; V1–V7 for repertoire lines, line by line (WP 8.3), with `content:validate -- --repertoire`. | owner | 6 | agreed |
| J3 | **Provenance on every item** (source, licence, engine version) and the statuses draft → machine-verified → owner-approved → live. | owner | 6 | agreed |
| J4 | **Quarantine and review screen:** anything that fails is held back with the reason; the owner approves, fixes or drops it. Built 2026-11-15: *Game → Review content…* (WP 8.4). | owner | 8 | agreed |
| J5 | **Authoring playbooks** for build-time sessions: repertoire notes, lessons, content validation. Built 2026-11-15: `author-repertoire` and `validate-content` (WP 8.6); lessons come with Phase 9. | owner | 8 | agreed |
| J6 | **Dataset installers:** the Lichess puzzle database and the openings list into the local database. Built 2026-11-15: `npm run content:install -- puzzles`; the openings list is read as it is and needs none. | research | 6 | agreed |
| J7 | **Re-validation** when the engine or a threshold changes. Built 2026-11-15 (WP 8.11). | research | 8 | agreed |
| J8 | **PDF / ebook route:** transcribe → replay for legality → diagram cross-check → the owner settles each doubt. | owner | 10 | agreed |
| J9 | **ChessBase route:** export to PGN outside the app, then import. | owner | 10 | agreed |

### K. Settings and customization

The owner: "keep all and give us the ease of customization and options to select."

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| K1 | **Settings registry and page:** every behaviour is a setting with the research default and a one-line reason; every change is logged. | owner | 3 | agreed |
| K2 | **Presets:** Research defaults · Lichess-like · Quiet coach. | owner | 11 | agreed |
| K3 | **Coach style settings:** verbosity, ask-first or tell-first, hint-ladder limits, moments per game, models. | owner | 11 | agreed |
| K4 | **Display settings:** eval bar, move labels, engine numbers and lines, arrows. | owner | 11 | agreed |
| K5 | **Training-mix settings:** puzzle mix, new cards per day, backlog cap, repertoire depth, play / study split, the slow-game nudge. | owner | 11 | agreed |
| K6 | **Guardrail settings:** tilt guardrail, streak style, undo offer, routine overlay. | owner | 11 | agreed |
| K7 | **Customising without the chore:** a *View* menu for the everyday switches, one-click presets at the top of the settings page, a search box, the groups down the side of a settings window, a "Changed" filter, switches and steppers instead of drop-downs and typing, technical settings tucked away, reset per setting / group / everything. | owner | 3 | agreed |

The settings themselves arrive with their features from Phase 3 on (K1 lists whatever is
registered); Phase 11 adds the grouped pages. The first presets (K2) arrived early with K7.

## 4b. Proposed by the coaching research (2026-11-13)

From the deep research ([LEARNING.md](LEARNING.md), full report in `reports/`). **All of it was
accepted on 2026-11-13 (D19) and is merged into the tables above.** This section stays as the record
of what the research changed and why.

### Changes to existing features (applied)

| ID | Change | Why |
|---|---|---|
| B7 | Core: the owner's own review, engine off, prompted right after a game syncs | The strongest coaching consensus found (Belenkaya, Pruijssers, Ramirez) |
| B3 | Choose moments by the biggest drop in winning chances, **starting from the first turning point**, not the final blunder | Coaches look for the point where the game first went wrong |
| B4 | The stop rules (§3.8), a "show me" shortcut, and a log of hint level per answer | Tutoring research; hint dependence is a known weakness of Chess.com's coach |
| B5 | The **skipped-step table** ([LEARNING §4](LEARNING.md#4-how-a-good-coach-reviews-a-game)) as the tag set | Ties each mistake to the step that failed |
| B9 | Labels stay internal for picking moments; the owner sees plain consequences ("this lost your knight"), not Brilliant / Inaccuracy badges | Users find the labels misleading at low levels |
| B10 | **2–4 written takeaways** and a positive sandwich; the winning-chances chart is secondary | Pruijssers; Mattson |
| C2 | Explicitly includes **free material not taken** | Only 62% taken at 600 |
| C4 | **Expanding** intervals, the same motif in new positions, hint level feeds the schedule, **backlog cap** | Spacing research; Chessable backlog complaints |
| C5 | One theme at a time first, then **mixed with labels hidden**; difficulty where most are solved; misses always explained | Interleaving research |
| C6 | The research said park until about 1200. **The owner keeps it as an option, off by default** | Built for stronger players; its shrinking cycles run against the spacing evidence; Studer calls it unsuitable for beginners |
| D1/D3 | Starts scoped down at 500: one simple setup per colour, a few moves deep, plus the replies 400–1000 players actually make; deepens as the level rises; the depth is a setting | Opening theory barely matters below about 1100 |
| F1 | Lessons follow the curriculum bands; each runs worked example → matching problem → single-theme set → mixed set (Yusupov's chapter shape) | Curricula consensus |
| F2 | Order: K+Q, then K+R (with stalemate traps), then the two-rook ladder, square of the pawn, opposition | Silman's ladder |
| G4 | **Forgiving streaks** (freezes or weekly targets) tied to real work, not puzzle counts | Streak research cuts both ways |
| G5 | A skill profile: blunders per 100 live moves, hung pieces per game, opening-loss rate, conversion rate, per-motif mastery; rating only as a cross-check | Average centipawn loss misleads at low levels |
| G6 | Includes a running **takeaway journal** the coach revisits | Pruijssers |
| H3/H4 | Every real attack on the board is listed for the model, and a **validator** (H13) rejects any move, square or piece the board doesn't confirm | Kim et al. 2024; grounded LLM coaches still invented pieces |
| H7 | A human-like model: **Maia-3**, which reaches about 600 on its own scale (D20) | Engines are poor partners for weaker players |

### New features (now in the tables above)

A9, C7, C8, C9, D8, E7, F5, F6, F7, G7, G8, G9, G10, H11, H12.

## 5. Hard rules

These two are not settings (decision D27).

- **Fair play.** The coach never helps with a game in progress, *including Daily games*. Lichess and
  Chess.com both ban outside help, and an account can be closed for it. Only finished games are imported
  or reviewed.
- **Copyright.** Purchased courses and books stay on this machine. They are never committed, uploaded or
  published (not even as a shared page). During study, only the item on the board is shown to the coach
  (decision D28).

## 6. What we need

**From the owner:** see the open questions in [TRACKER.md](../TRACKER.md#open-questions)
(usernames, a Lichess API token, opening choices, goal, study time, courses, phone or not).

**Tools and data:**
- **Stockfish 19**, the latest (released 2026-09-05). The Windows universal build picks the best code
  for the CPU by itself. Installed in Phase 1.
- **Python + Maia-3** for the human-like bots (decision D20). Installed in Phase 1.
- **Lichess and Chess.com game archives** (finished games, no login needed).
- **The Lichess opening explorer**, which **needs the owner's Lichess API token** on every request, and
  endgame tablebases.
- **Content:** the Lichess puzzle database (6,193,530 puzzles as of 2026-11-11) and the Lichess
  openings list, both CC0.
- **Open source we build on:** chessground and chessops (the Lichess board and rules libraries), and
  ideas and rules from lila and lichess-puzzler. See [REFERENCES.md](REFERENCES.md).

**Answered since the first version:** the ChessBase route (E2), the PDF route (E3), the sparring
opponent (H7) and how Claude is connected (A0). Each is proven by a Phase 2 spike before it is built on.

## 7. The owner's ideas

Anything the owner wants goes here first, in their own words, then into the catalogue with an ID.

- "Install stockfish engine, the best one obviously" → Phase 1.
- "build repertoires for opening and many courses and ill probably get those files" → D, E.
- Coaching on the web page, not in the terminal → A0.
- "you need to have all the powers" → H.
- "not just stockfish… i cant really learn shit just by playing moves stock fish plays… look at guides
  and shit on how coaches teach and how people learn" → §3.4, D15, [LEARNING.md](LEARNING.md).
- **The direction (2026-11-13):** "the final goals for the project is to have a webapp which will
  basically have the training things we mentioned in the research docs and also the live coach training
  me with each steps and there will also be drills and also can play with me and we will basically have
  all the things chess.com or lichess have" → F8, F9, group I, D16.
- "since lichess is opensource we will try to get a lot of help from that and also since we need to
  have a chess engine we can build it out of stockfish which is open source" → D22, D23.
- "the coach im planing for using my claude code session with haiku or sonnet a small model… we need to
  figure a way my claude code session agent coach tells me shit on the site itself like every move or
  when requried" → A10, A13, A14, D17.
- "the skills for the coach needs to be well sorted out" → H9, H17, [COACH.md](COACH.md).
- "comint to the puzzles and other practices we can do a normal logic" → A11, D18.
- "repeteriors and opening drills those too we can try to find formats or generate with lines and books
  or pdfs - and those need to validated perfect cause i am gonna learn and practice based on that" →
  group J, D21, [CONTENT.md](CONTENT.md).
- "Keep all and give use the easy of customization and options to select - accept all" → group K, D19.
- "Install python and use it and have multiple bots for each elo and they must be human like" → F9, H7, D20.
- **Ask the coach, on the board (2026-11-13):** "since we are doing it as an agent have a chatbot where
  i ask the agent doubts and it expalins with interacting and moving the pieces which is the smart way
  showing threats ideas or lines or sublines or next moves and basically full coaching" → A15, D36.
- **The engine is the source of truth (2026-11-14):** "All the best moves and coach steps have to
  validated with the lichess best moves and reasoning - also the best moves come from the engine and
  then the coach explains and shit - if we give haiku that role it is gonna fail at any time cause at
  the end of the day its an agent where as an engine is grounded and perfect" → H18, H19, D33, D37.
- **The next addition (2026-11-14):** "The next addition would be continuing with the next phase where
  we build the eval bar and the best engine moves will be shown with arrows and also the coach will be
  able to show its lines like what its trying to teach when im conversing with it like show threats
  with red box and show attack lines with arrows and setup pieces and if i interact it can read and
  give its coaching etc and also basically have entire board control - also the menu and mode picker
  needs to be full hooked up with all the features we are adding and also make the customization less
  tiring ux wise and on the analysis board give an option to reset the entire position - also when I
  make a play on the analysis board or when the coach is teascing me - along with the eval bar -
  classify the move like how chess.com classifys its moves with good innacuracy or book or best great
  briliant or mistake and blunder or forced and when the coach is expaling i make another move but not
  the lesson its an alternative and etc also the lines show it with piece icon instead of N or Q and
  also we need the bots menu done too" → A6 (now on by default), A16, A17, A18, H20, I13, I14, I15,
  K7; the bots menu is F9 with A5 / F4 / H7, built early (D39–D43).
- **The UI revamp (2026-11-14):** "the features till now are fire but the UI is pure ass - fetch the
  best design skills and components and we need to rearrage the menu and options and drop downs as a
  part of the UI revamp - we have the getlayers mcp so you can get some components and please also
  get the apple design skill and revamp and upgrade the current UI of the web app" → I16, D44.
- **Labels that agree with common sense, and the better move on the board (2026-11-14):** "the knight
  arrow isnt L shape its like a awkward cross … if c4 is a blunder: it loses a knight. f7 was best.
  like this show the alterinative move on the board with a different colour line like what should
  have been done" and, about a queen hung in a lost position that the board called good: "this needs
  a major deep dive and fixing since the move labeling isnt perfect and i want it perfect and the
  coach feels wrong too cause its common sense that Qe6 is a mistake … we need to fix this and
  perfectly align our coach and the engine move labeling" → A19, A17 (the rules changed), D47, D48.
- **Captured material (2026-11-15):** "also so the material captured for white and black under the name
  or beside the board standard with +2 or +3 depending on the material" → I17.
- **More pieces and colours, readable menus (2026-11-15):** "Add more pieces designs and themes and also
  the drop down is all white until i hover fix all the menu items and drop downs" → I9 (eleven more piece
  sets, nine more board colours; every drop-down now in the page's colours).
- **The fair-play banner (2026-11-15):** "remove this we are wasting the screen realestate there" → the
  standing banner on the analysis board is gone; the guard itself is unchanged (D86).
- **Another site's labels (2026-11-15):** "https://taketaketake.com/ - this site has the move classification"
  → A17 (the labels); compared once one game's labels from there are in hand (TRACKER Q26).
- **Sections for openings and endgames (2026-11-15):** "also where is the Repertoire? like also we need seperate sections for endgame and openings practice in depth" → D9 (the Openings tab), F2 (the Endgames tab, built early: D84).
- **The Réti, course-sized (2026-11-15):** "Okay lets add an opening for learning and practice - Reti, Nimzovich-Larsen attack - here are some refernces and sources … this course says there are almost 647 trainable lines we are aiming that … please lets build the complete repertoire", with a course's chapter list (1...Nf6 2.b3 g6 with and without ...d5, 2...c5, 2...e6, 2...b6; 1...d5 2.b3 Bf5, Bg4, Nf6, c5, Nc6; 1...c5; 1...g6 2.e4; 1...d6 2.d4; 1...f5 2.b3; 1...Nc6; 1...b6 2.e4; 1...b5). Asked how: White's moves past the outline are the strong players' choice; Black's replies are the owner's level plus every reply the outline names; built 12 moves deep and drilled by level; "Lets explan our started collection - lets build each one perfectly so for now keep our reti and if you think italian opening is on this rich level keep it or else delete it" → **D10**, **D11**, Q18 answered for White (TRACKER D90).
- **Grounded in the book (2026-11-16):** "Listen the lines must be validated - convering every main line and sub line to what is there in the book not just something generated it must be having the grounding - please check online and get the vlaidted lines only" → D10 as built: every move of a line is in the Lichess masters' database (at least 25 games, the owner's choice; 2.b3 against 1...c5, 2.d4 against 1...Nc6 and 2.e4 against 1...b5, their answers), checked by the engine (TRACKER D91, D92).
- **The coach beside the repertoire (2026-11-16):** about the moves the app cannot give a reason for:
  "I mean coach would be there seeing my board and i can ask it any time so cool - have coach be there"
  → **D12** (TRACKER D98).
- **Black's openings (2026-11-17):** "Kings indian and sicilian"; asked which Sicilian, the Accelerated
  Dragon; asked what against White's other first moves, the King's Indian setup → Q18 answered for Black,
  built from the book like the Réti (TRACKER D102).
- **Grounded or made (2026-11-17):** "Also differentiate between what you created or generated vs what was
  taken as a reference like with grounding since its all book practice it has to be grounded" → **D13**
  (TRACKER D100).
- **The repertoire pane (2026-11-17):** about the Openings tab's walk ("Your move: f3 / Book: played in
  303,299 of the masters' games here. / Not approved yet … / Nf3 develops your knight. / Play it / Coach /
  Start coach"): "this isnt good looking or correctly done UI wise please fix it" → D9 redesigned with D13
  (TRACKER D100).
- **The computer's load (2026-11-17):** "Also in the site show the hardware insights like RAM used GPU used
  CPU used memeory shit beside Game, View and settings have this" → **I18** (TRACKER D101).
- **Coordinates (2026-11-17):** "The board lables like A B C D 1 2 3 4 move then outside the board cause its
  kinda not visible" → I9 (TRACKER D101).
- *(add more here)*
