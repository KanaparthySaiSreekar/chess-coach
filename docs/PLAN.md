# Chess Coach: Build plan

The order things get built in, phase by phase, with the features each phase delivers, its work
packages and the tests that say it is done. [FEATURES.md](FEATURES.md) defines the features,
[ARCHITECTURE.md](ARCHITECTURE.md) the design, [COACH.md](COACH.md) the coach and
[CONTENT.md](CONTENT.md) the content rules. Status lives in [TRACKER.md](../TRACKER.md).

_Written 2026-11-13 (decision D26). Every phase ends with an app the owner can use._

_2026-11-14: at the owner's request the board and the coach chat were built early, as a slice of
Phases 3 and 4 (D32). Which work packages are done, partial or open is in
[TRACKER.md](../TRACKER.md); the plan below is unchanged apart from the additions marked D33._

_2026-11-14, second session: the owner asked for the eval bar, best-move arrows, move labels, more
board control for the coach, trying their own moves on the coach's board, piece icons in moves, a
reset, a wired-up menu, easier settings, and the bots menu. New features A16, A17, A18, H20 joined
Phase 4 and I13, I14, I15, K7 joined Phase 3 (work packages 3.10 and 4.11–4.12 below); the bots
menu was built as an early slice of Phase 7 (D42), with spike S4 still open._

_2026-11-14, third session: the owner asked for a UI revamp. I16 (the look of the page and the
rearranged menus) joined Phase 3 as work package 3.11 (D44)._

_2026-11-14, fifth session: the owner found a queen hung in a lost position labelled "good". The
grading now also judges a move by what it gives away (D47), the coach is given the verdict on
either side's last move and what the board shows (D48), and A19 (the better move drawn on the
board, bent arrows for knight moves) joined Phase 4 as work package 4.13._

---

## How a build session works

1. Read `CLAUDE.md` → `TRACKER.md` → the work package below → the architecture sections it names.
2. Do **one work package** per session. Don't start a phase before the one above it is `done`.
3. Tests come with the code. A work package is finished when its tests pass and the page still works.
4. Every feature registers its settings ([ARCHITECTURE §14](ARCHITECTURE.md#14-settings-registry)) and
   logs to `events`.
5. If the work shows the design is wrong, change ARCHITECTURE.md and log a decision in TRACKER.
6. End by updating TRACKER (status, session log) and FEATURES (if a feature's status moved).
7. Heavy engine work runs on AC power. Benchmarks are also logged in `~/Omen Tuning/`.

| # | Phase | Home of features |
|---|---|---|
| 1 | Toolchain | — |
| 2 | Spikes | — |
| 3 | Foundation | A1, H1, I1, I2, I7, I9, I13, I14, I15, I16, I17, K1, K7 |
| 4 | Coach on the page | A0, A2, A3, A4, A6, A7, A10, A11, A12, A13, A14, A15, A16, A17, A18, A19, H2, H3, H4, H9, H11, H13, H14, H15, H16, H17, H18, H19, H20 |
| 5 | Import and review | B1, B2, B3, B4, B5, B7, B8, B9, B10, G1, G2, G5, G6, H5, H8, H10, H12 |
| 6 | Puzzles and drills | C1, C2, C3, C4, C5, C6, C7, C8, C9, G7, H6, I4, J2, J3, J6 |
| 7 | Sparring and bots | A5, A8, A9, F4, F6, F9, H7, I10 |
| 8 | Repertoire | B6, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, G3, I3, I6, J1, J4, J5, J7 |
| 9 | Lessons and curriculum | F1, F2, F5, F7, I5, I8 |
| 10 | Courses | E1, E2, E3, E4, E5, E6, E7, J8, J9 |
| 11 | Daily plan and progress | F3, F8, G4, G8, G9, G10, K2, K3, K4, K5, K6 |
| 12 | Parity polish | I11 |

I12 (online play against humans and the rest of the social side) is parked: decision D24.

---

## Phase 1: Toolchain

**Goal:** everything the app depends on is installed, verified and measured on this laptop.

**Features:** none (groundwork).

| WP | Scope | Check |
|---|---|---|
| 1.1 Stockfish 19 | Download the Windows universal build into its own empty folder; verify against the digest GitHub publishes; install to `C:\Tools\Stockfish\` | Answers `uci` / `isready`; reports the AVX-512 path on the Zen 4 CPU |
| 1.2 Python + Maia-3 | Python from python.org into `C:\Tools\Python\` (not the Store alias, not on PATH); a virtual environment in `C:\Tools\Maia3\`; install Maia-3 from a pinned commit of `CSSLab/maia3`; fetch the 5M and 23M models. Check which Python version Maia-3 supports before installing | The UCI engine answers; a move comes back at Elo 600 and at 1500 |
| 1.3 Datasets | `lichess_db_puzzle.csv.zst` and the openings list into `data/datasets/`; optional Syzygy 3-4-5 into `C:\Tools\Syzygy\` | Row count matches the site's figure; files outside git |
| 1.4 Accounts | The owner creates a Lichess API token (Q17), entered through the secret box into `.env`. Confirm `claude -p --model haiku` runs on the plan login | A test call to the explorer returns data; the headless call returns text |
| 1.5 Benchmarks | Stockfish `bench` at 1 and 16 threads, on AC; Maia moves per second on CPU | Numbers in TRACKER, CLAUDE.md and `~/Omen Tuning/PRE-CLEAN.md` |

**Done when** all five checks pass and the versions and paths are recorded.

---

## Phase 2: Spikes

**Goal:** prove the six risky assumptions with throwaway code in `spikes/` before anything is built on
them. One spike per session. Each ends with a short result in TRACKER.

**Features:** none (groundwork).

| Spike | Question | Method | Pass | If it fails |
|---|---|---|---|---|
| S1 Coach bridge | Can the page drive a headless coach quickly and reliably? | A script spawns the command in [ARCHITECTURE §5](ARCHITECTURE.md#5-the-coach-bridge) with a two-tool MCP server; sends 10 events; times each reply on Haiku and Sonnet; kills and restarts it; sends an event that goes stale | Median < 4 s on Haiku; no lost or misordered events; the stale reply is refused | Try the Agent SDK's streaming mode; then terminal-attach via channels |
| S2 Validator | Do the rules catch invented chess without blocking true sentences? | 40 hand-written coach messages on real positions: 20 true, 20 with a planted false move, piece or claim | ≥ 19 of 20 false caught; ≤ 1 of 20 true blocked | Tighten the token rule (no chess words outside tokens at all) |
| S3 Engine | Is the UCI wrapper fast and crash-proof here? | Analyse a 60-move game with the node budgets; feed an invalid position on purpose | < 90 s on AC; the process restarts and the queue continues | Lower budgets; fewer threads |
| S4 Maia | Is Maia-3 human-like at the bottom, and fast enough? | Sidecar returning probabilities; Maia-600 vs Maia-1200 over a set of games; blunder rate against the published 600-level figures; time per move on CPU (5M) and GPU (23M) | The stronger bot wins clearly; the weak bot blunders like a beginner; < 1 s per move | GPU model; more sampling randomness at the low end, labelled approximate |
| S5 Explorer | Does the explorer answer for beginner buckets with a token? | Call the start position and five common positions at `ratings=0,1000`; note limits | Data returned; a caching plan that stays inside the limits | Maia probabilities as the main source |
| S6 PDF | Can a book chapter be transcribed and checked exactly? | One public-domain chapter through the route in [CONTENT §9](CONTENT.md#9-courses-books-and-pdfs); plant three errors | All planted errors caught by the legality or diagram check | Smaller pages per pass; the owner confirms every diagram |

**Done when** every spike has a written result and any failure has a chosen fallback recorded as a
decision.

---

## Phase 3: Foundation

**Goal:** a working board on localhost with an analysis board and an editor, on the real architecture.

**Features:** A1, H1, I1, I2, I7, I9, I13, I14, I15, I16, I17, K1, K7

**Depends on:** Phases 1–2.

| WP | Scope | Tests |
|---|---|---|
| 3.1 Scaffold | npm workspaces (`core`, `server`, `web`); strict TypeScript; lint; Vitest; scripts `dev`, `test`, `build`, `check:docs`; `LICENSE`; `.gitignore` additions; a pre-commit check that blocks `data/`, `courses/`, `.env` | `npm test` runs; the pre-commit check refuses a file under `data/` |
| 3.2 `core`: chess basics | Wrappers over chessops: positions, SAN / UCI, FEN, PGN read and write with variations, comments and Lichess drawing tags; the move tree; the position key used for transpositions | Tricky PGNs round-trip (promotion, en passant, castling, checks, nested variations) |
| 3.3 `core`: winning chances | Centipawns and mates → winning chances; drop; classes from configurable thresholds ([ARCHITECTURE §8](ARCHITECTURE.md#8-grading-moves)) | Table-driven tests |
| 3.4 Database | The `node:sqlite` module, migrations, tables for this phase, the settings registry, the `events` log | Migrations apply to an empty file; a setting change lands in both tables |
| 3.5 Engine service | Process manager, two pools, queue, cache, validate-before-send, restart ([ARCHITECTURE §10](ARCHITECTURE.md#10-engine-service)) | Fake-engine tests; a tagged set against real Stockfish, including a forced crash |
| 3.6 Server | Fastify + WebSocket; BoardSession (moves, navigation, variations, saving); PGN import and export | State survives a server restart |
| 3.7 Page shell (A1, I9) | Layout: board, side panel, navigation; chessground wired to chessops; promotion; move list with variations; board and piece themes, sounds, coordinates, flip, click or drag | Playwright: play moves, go back, branch |
| 3.8 Analysis board and editor (I1, I2, I7) | Paste or upload PGN / FEN; set up a position; engine lines and the bar as switches, **off by default**, shown as winning chances and plain words unless numbers are switched on | Playwright: paste a PGN, step through, switch lines on and off |
| 3.9 Settings page (K1) | Lists every registered setting by group with its *why* | A new setting appears without page changes |
| 3.10 Menu, reset, icons, quick settings (I13, I14, I15, K7) | The mode picker and one menu wired to every action; "Reset board" (start, or the first position of what is loaded); piece icons in every list of moves; the *View* menu, presets, search, tabs, steppers and reset in the settings page | A preset changes exactly its keys; a reset keeps a set-up position when asked; Playwright: switch modes, reset, toggle from the *View* menu |
| 3.11 Look and layout (I16) | One set of design tokens (dark and light) and one set of shared controls (`ui.tsx`: popover, menu, segmented control, sheet, step buttons); a toolbar with the mode picker, the *Game* menu, the *View* switches and the settings button; three flat panes; a settings window with the groups down the side; the coach's options behind one button; self-hosted fonts and one icon set; `display.appearance` and `display.coachFont` | Driven in a browser in dark and light at 1440, 1000 and 600 wide; every old action still reachable; text contrast at least 4.5:1; keyboard: Tab stays inside a dialog, arrows move through a menu, Escape closes |

**Done when**

1. `npm run dev` opens the board; only legal moves can be played.
2. A PGN or FEN can be pasted, edited, navigated and exported unchanged.
3. Engine lines stay hidden until switched on.
4. Reloading the page or restarting the server returns to the same position.
5. All tests pass.

---

## Phase 4: Coach on the page

**Goal:** the owner starts the coach from the page and it coaches on the analysis board, truthfully.

**Features:** A0, A2, A3, A4, A6, A7, A10, A11, A12, A13, A14, A15, A16, A17, A18, A19, H2, H3, H4, H9, H11, H13, H14, H15, H16, H17, H18, H19, H20

**Depends on:** Phase 3; S1 and S2.

| WP | Scope | Tests |
|---|---|---|
| 4.1 `core`: attacks | Attack maps, exchange evaluation, hanging and under-defended lists, checks / captures / threats lists | 40 position fixtures |
| 4.2 `core`: motifs | Detectors: fork, pin, skewer, discovered attack, double check, back rank, hanging piece, removed defender, trapped piece | ≥ 90% agreement with the Lichess database's own tags on 50 sampled puzzles per theme |
| 4.3 Fact builder (H15, H19) | The packet in [ARCHITECTURE §7](ARCHITECTURE.md#7-the-fact-packet): pass search for threats, graded move, what-it-lost in words, fact sentences. **D33, D37:** checked reasons for every move; verdicts cross-checked with Lichess's cloud analysis | Golden files for 30 positions |
| 4.4 Validator (H13) and tokens | Rules R1–R8; the page renders tokens as clickable moves and squares | The S2 set, kept as a regression test |
| 4.5 MCP endpoint (H2, H3, H4, H18) | The eleven tools, the per-run token, per-mode refusals. **D33:** `play_line` asks the engine for the line (best play, "what if X", the threat) and `annotate` draws from facts; neither takes moves or squares from the model | Each tool: good call, bad call, stale `seq` |
| 4.6 Supervisor and director (H14, H16) | Transport, spawn, health, restart, rotation, usage; the wake rules; debounce and merge | A fake transport in tests; S1's script as an integration test |
| 4.7 Coach panel (A0, A10, A12, A13, A14) | Message thread, the four chips, typed questions, status, usage meter, verbosity and model selectors; the coach's arrows in their own colour (A2); the demo layer with "Back to my board" (A3) | Playwright with a fake coach |
| 4.8 Scripted fallback (A11) | Templates and selection ([COACH §7](COACH.md#7-the-scripted-fallback)) | Coach off: hint chips still work end to end |
| 4.9 Agent and skills (H9, H11) | `coach-analysis`, `coach-core`, `explain-position`; the concept ladder as data; the opening-name loader (A7); the eval bar hidden by default (A6) | The files load; a headless session lists exactly the chess tools |
| 4.10 Playbook harness (H17) | Fixtures, runner, checks, saved results ([COACH §9](COACH.md#9-testing-the-playbooks)) | 30 scenarios on Haiku and Sonnet; the pass bars in COACH §9 |
| 4.11 The engine on the board (A6, A16, A17) | The eval bar; best-move arrows, held back while the coach waits for a move; move labels by the rules in [ARCHITECTURE §8](ARCHITECTURE.md#82-move-labels-a17-d40), quick first and then from the checked analysis; "Label every move" | Table tests for every label; engine-backed: a blunder is labelled and says what it lost, an opening move is "book", the arrow disappears while a question is open, the label equals the verdict the coach was given |
| 4.12 Board control and the owner's own tries (A18, H20) | `annotate` with `show`; red and amber boxes; `show_position` with `at`; `ownerDrew`; moves on the coach's board (follow the line, or become "Your alternative"); the `owner_tries` event and its scripted fallback | Engine-backed: the alternative is a side line with the engine's verdict and replies, `seq` moves on, the owner's own board does not; with the coach off the verdict is still said |
| 4.13 Labels that match the consequence; the better move on the board (A17, A19; D47, D48) | The class of a move is the worse of the drop in winning chances and what the move gives away ([ARCHITECTURE §8](ARCHITECTURE.md#8-grading-moves)); facts never call a material-losing move good or safe; the last move is judged whoever played it; `get_state` and every event carry `gameSoFar` and `boardShows`; `bestAt` on a label and the green arrow; bent knight arrows; `tools/label-line.ts` and `tools/label-audit.ts` | Table tests for every row of the give-away table; the owner's game engine-backed: 10...Qe6 is a mistake on the board and in the coach's facts; the audit lists no label a person would not accept |

**Done when**

1. "Start coach" on the page brings the coach online without a terminal.
2. Moving a piece gets a question or an explanation with arrows, at the chosen verbosity (A4).
3. In the planted-error tests, no unverified claim reaches the page; and no move, line or arrow on
   the page was chosen by the model (D33).
4. With the coach off, hints and explanations still work from the scripted fallback.
5. Killing the coach process shows a status change and recovers by itself.
6. No engine numbers are visible unless the owner switches them on.
7. Every move on the board carries a label that agrees with what the coach says about it, and a move
   tried on the coach's board is judged and explained (A17, A18).

---

## Phase 5: Import and review

**Goal:** the owner's finished games come in, and one game can be reviewed the way a coach reviews.

**Features:** B1, B2, B3, B4, B5, B7, B8, B9, B10, G1, G2, G5, G6, H5, H8, H10, H12

**Depends on:** Phase 4; usernames (Q1, Q2).

| WP | Scope | Tests |
|---|---|---|
| 5.1 Importers (B1, B2, B8, G1) | Lichess and Chess.com as in [ARCHITECTURE §12](ARCHITECTURE.md#12-importers-explorer-and-the-fair-play-guard); manual PGN or link; sync on open and on a timer; ratings and results stored | Recorded API answers as fixtures; importing twice adds nothing |
| 5.2 Fair-play guard (H10) | Finished-only imports; the ongoing-games list; the position check on paste, set-up and `show_position`; the standing notice when the list can't be fetched | A fixture Daily game in progress is refused by every route |
| 5.3 Analysis pipeline (B3, B9) | Two-pass analysis per game; classes kept internal; live moves; the first turning point and up to N moments; confirm Lichess's thresholds in lila's source | Known games give the expected moments; same input gives the same output |
| 5.4 Tags (B5, H12) | The skipped-step tagger; motif tags; the findable move (forcing and simple first) | A fixture per row of the skipped-step table |
| 5.5 Own review first (B7) | After a sync, a prompt to go through the game with the engine off: mark moments, write thoughts | The engine's findings stay hidden until it is done or skipped |
| 5.6 Socratic replay (B4) | The review activity's state machine, the hint ladder with its stop rules, "show me", the hint log; agent `coach-review` and playbook `review-game` | Harness scenarios for each stop rule |
| 5.7 Report and journal (B10, G6, H8) | The review report: 2–4 takeaways, positive sandwich, the chart as an option; the takeaway journal; session notes | The report cites only validated facts |
| 5.8 Skill profile (G2, G5, H5) | Blunders per 100 live moves, hung pieces per game, opening-loss rate, conversion rate; skipped-step counts over time; the band estimate; `owner_profile` | Fixture games give known numbers |

**Done when**

1. With usernames entered, finished Rapid, Classical and Daily games import from both sites.
2. A Daily game still in progress is refused, with the reason shown.
3. One game runs: own review → 1–3 moments starting at the first turning point → hint-ladder replay
   → a report with 2–4 takeaways.
4. Each mistake carries its type and its skipped step, and the trend view counts them.
5. The profile shows the four process measures from real games.

---

## Phase 6: Puzzles and drills

**Goal:** mistakes turn into practice that comes back at the right time, with or without the coach.

**Features:** C1, C2, C3, C4, C5, C6, C7, C8, C9, G7, H6, I4, J2, J3, J6

**Depends on:** Phase 5.

| WP | Scope | Tests |
|---|---|---|
| 6.1 Content envelope and gates (J2, J3) | `content_items`; statuses; the gate runner and its command; gates V1, V2, V3, V6 ([CONTENT §5](CONTENT.md#5-the-gates)) | A puzzle with an illegal move, a second solution, or a false sentence is quarantined with the right reason |
| 6.2 Puzzle player | Multi-move solutions, accepted alternatives, retry, the hint ladder, explain-on-miss from the facts | Playwright |
| 6.3 Puzzles from games (C1, C2, C3) | The generator rules and the teaching tier ([CONTENT §6](CONTENT.md#6-puzzles)); theme tags from the motif detectors | Known games yield the expected puzzles |
| 6.4 Database puzzles (C5, H6, J6) | The installer (CSV → SQLite, indexed); themed sets at the owner's level; one theme, then mixed with labels hidden; `find_content` | A theme query under 100 ms; set difficulty tracks results |
| 6.5 Scheduler (C4) | FSRS cards; the grade mapping from hints and time; same motif in a new position; new-per-day and the backlog cap | Simulated histories: intervals grow on success, shrink on a miss; the cap holds |
| 6.6 Safety-check trainer (C7) | "Is this move safe?" and "which of these two blunders?" from the owner's games | Fixtures |
| 6.7 "What's the threat?" (C8) | Name the threat first, then find the move | Fixtures |
| 6.8 Win-the-won-game drills (C9) | Play out winning positions from the owner's games against Stockfish; success = converted | A scripted game passes and a thrown one fails |
| 6.9 Motif mastery (G7) | Accuracy, time and hint level per motif; the stage (example → partial → full → mixed) that fades guidance | Fixture histories give the expected stage |
| 6.10 Optional modes (C6, I4) | Woodpecker rounds; streak and timed modes; all off by default with their *why* shown | Switches work; the coach stays silent in speed modes |
| 6.11 `coach-drill` | Agent and `drill-session` playbook | 10+ harness scenarios |

**Done when**

1. After a reviewed game, its mistakes appear as due puzzles.
2. A solved puzzle comes back later; a missed one comes back sooner; the backlog never passes the cap.
3. Themed sets run at the owner's level from the local database.
4. The three new drill types (C7, C8, C9) run from the owner's own games.
5. Everything above works with the coach off.

---

## Phase 7: Sparring and bots

**Goal:** the owner can play a human-like opponent at any level, with the coach beside the board.

**Features:** A5, A8, A9, F4, F6, F9, H7, I10

**Depends on:** Phase 4; S4. (Phase 6 for C9's play-out code.)

_Built early at the owner's request (2026-11-14, D42): most of 7.1 and 7.2, and 7.3 without clocks.
S4 is still open, so how human the lowest bots are has not been measured; the page says so._

| WP | Scope | Tests |
|---|---|---|
| 7.1 Bots service (H7) | The Maia-3 sidecar and its manager ([ARCHITECTURE §11](ARCHITECTURE.md#11-bots-service-maia-3)); sampling; legality check; simulated think time | The sidecar restarts after a kill; never returns an illegal move |
| 7.2 Roster (F9) | `content/bots.json`: every 100 Elo from 600 to 2000, every 200 to 2600; names, style notes, variety; the picker; the level-matched suggestion | The roster loads; the suggestion moves with results |
| 7.3 Game loop (A5, F4, I10) | Clocks and time controls including untimed; resign, draw, takeback; the finished game goes to the review queue as a normal game | Playwright: a full game |
| 7.4 Undo offer (A8) | After a blunder in a learning game: offer the undo, ask what was missed; an undo counts as hint use | Fixture |
| 7.5 Routine overlay (A9) | Prompts for the thinking routine before moves, fading as the profile shows the habit | Prompt frequency follows the mastery fixture |
| 7.6 Mini-games (F6) | Custom starts and goals (pawn wars, queen vs pawns…) | One mini-game end to end |
| 7.7 `coach-spar` | Agent and `spar-commentary` playbook | 10+ harness scenarios, including "never suggests a move unasked" |
| 7.8 Upgrades | The findable move (H12) ranked by Maia's probabilities; engine-style bots as a labelled option | Fixtures |

**Done when**

1. Picking a bot starts a game with human-like moves and timing.
2. The roster covers 600 upward in 100-point steps.
3. A blunder brings the undo offer and the question.
4. The finished game appears in the review queue.
5. Bots play with the coach off.

---

## Phase 8: Repertoire

**Goal:** a validated repertoire the owner can drill, check against real games, and extend.

**Features:** B6, D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, G3, I3, I6, J1, J4, J5, J7

**Depends on:** Phases 5–6; S5; the owner's opening choices (Q18).

| WP | Scope | Tests |
|---|---|---|
| 8.1 Studies and formats (I6, J1) | The position-keyed graph; studies and chapters; PGN in and out with comments, marks and drawings; Lichess study import | A Lichess study round-trips |
| 8.2 Explorer (D6, I3) | The token client, caching, the explorer panel on the board (my level, masters, my games); Maia as the stand-in | Recorded answers as fixtures; no repeat calls for cached positions |
| 8.3 Repertoire gates (extends J2) | V4, V5, V7 ([CONTENT §5](CONTENT.md#5-the-gates)) | A PGN with one illegal move, one unsound move and one transposition conflict: exactly those three lines are quarantined |
| 8.4 Review screen (J4) | Approve, fix, drop; the gate report; the spot-check sample ([CONTENT §10](CONTENT.md#10-the-review-screen)) | Playwright |
| 8.5 Starter builder (D1) | The algorithm in [CONTENT §7](CONTENT.md#7-repertoire); depth cap by level | Deterministic output for a fixed seed and cache |
| 8.6 Authoring (J5) | Skills `author-repertoire` and `validate-content`; the why and the opponent's idea for every move | Every sentence passes V3 |
| 8.7 Import (D2) | PGN files and studies through the gates | Fixtures |
| 8.8 Drills (D3, D4) | One card per position; my move, the why, the opponent's idea and common replies; FSRS; agent `coach-opening` and playbook `opening-drill` | Harness scenarios; scheduler tests |
| 8.9 Trap pack (D8) | Scholar's Mate defence, early queen raids, f7 / f2 attacks as recognition puzzles | All pass the gates |
| 8.10 In real games (B6, D5, D7, G3) | Where each game left the repertoire, who left it, what to play next time; results per line | Fixture games |
| 8.11 Re-validation (J7) | Re-run V2 / V7 on an engine or threshold change; quarantine what now fails | A changed threshold quarantines a known borderline line |
| 8.12 From the book (D10) | An outline of the owner's moves per repertoire (`content/repertoires/`); the builder: every move in the masters' games (the book rule), my moves the masters' most played that pass V2 and V7, the replies the book and the owner's level play, the positions met most often first up to a line budget; V4 checks a book repertoire against the same book; `npm run content:build`; *Build it* on the review screen | Fast: the outline read and checked, the budget, the depth, the forced replies, the book rule, the same answers twice; engine: built twice the same, gated with no new search, built again in place |
| 8.13 Chapters (D11) | Chapters through the review screen (approve one at a time), the Openings tab (walk to one) and the words (a worksheet per chapter; applying words re-checks only those lines) | Engine: the chapters on the review screen; author tool by chapter |
| 8.14 Drilling a big repertoire (D11) | New cards a few a day in the teaching order; the drill kept to a repertoire or a chapter | New cards in order and per day; one chapter |
| 8.15 A collection per side (D10) | Several repertoires for one side: a game matched with the one it stayed in longest; a repertoire removed with its cards and words | Fixture games against two White repertoires; removal |
| 8.16 The Réti (D10, Q18) | The Réti / Nimzo-Larsen built from the book, its words written chapter by chapter, approved by the owner | Its report: every line V1–V7 passed, every move book |
| 8.17 The coach beside the repertoire (D12) | The Openings tab tells the server where the owner has walked; a question there goes to `coach-opening` with that position's facts and the engine's verdict on the repertoire move (`opening_question`); on a card being recalled the move stays hidden and a message naming it is refused; an *Ask the coach* box beside the walk and the card; the scripted fallback when the coach cannot answer | Engine: the walked position asked about, the answer beside the walk; on a card being recalled, naming the move refused; Playwright: asked from the walk, not in the analysis thread; harness: two scenarios |

**Done when**

1. A White and a Black repertoire are live, each with a stored report showing V1–V7 passed (White: the Réti from the book, 8.16; Black: waits on Q18).
2. Importing a PGN with one illegal or unsound move quarantines exactly that line, with the reason.
3. Drills schedule and every card shows the why and the opponent's idea.
4. A real game shows where it left the repertoire and what to do next time.
5. The explorer panel shows what players at the owner's level play.

---

## Phase 9: Lessons and curriculum

**Goal:** a taught path from the owner's level upward, moved along by evidence.

**Features:** F1, F2, F5, F7, I5, I8

**Depends on:** Phase 6.

| WP | Scope | Tests |
|---|---|---|
| 9.1 Lesson format and runner | The template in [CONTENT §8](CONTENT.md#8-lessons); machine assertions; gate V8 (extends J2); skill `author-lesson` (extends J5) | A lesson with a false assertion or deferred vocabulary is quarantined |
| 9.2 Band 400–700 content (F1) | The thinking routine, hanging pieces, counting, escaping check, mate in one, back-rank mate, double attack and fork, K+Q and K+R mates, stalemate traps, opening principles, Scholar's Mate defence | Every lesson live through the gates |
| 9.3 Endgame trainer (F2, I8) | Play key endgames against the engine in Silman's order; tablebase verdicts; stalemate and move-count warnings. **Built early at the owner's request (TRACKER D84, D87, D88):** the *Endgames* tab over fixed positions, random starts for the queen, rook and two-rook mates, and the endgame coach (`coach-endgame`, COACH §6.9); still to do here: the I8 warnings before the move, more topics | K+Q and K+R from random starts: a scripted correct line wins, a stalemating line is caught (built so far: every position through its gates against the tablebases; a stalemating move caught with the move that kept the win; a king outside the square caught; random K+Q and K+R starts checked by the tablebases and played to mate by the engine's line; in the browser, a position played, thrown, tried again and mated, and a random start) |
| 9.4 Model games (F5) | Short games, one sentence per move, optional guess-the-move | Every sentence passes V3 |
| 9.5 Vision drills (I5, F7) | Coordinates and board-vision drills; "two by two" visualisation, offered from about 800 | Playwright |
| 9.6 Curriculum engine | The band map, the "move on when" rules from [LEARNING §7](LEARNING.md#7-curriculum-from-500-upward-moved-on-by-skill-not-rating), suggestions from evidence only | Fixture profiles give the expected suggestion |
| 9.7 `coach-lesson` | Agent and `lesson` playbook | 10+ harness scenarios |
| 9.8 Band 700–1000 content | The next band's lessons | As 9.2 |

**Done when**

1. Every band 400–700 lesson is live through the gates.
2. A lesson runs worked example → matching problem → theme set → mixed set.
3. K+Q and K+R can be practised against the engine, with stalemate caught.
4. Moving up a band is suggested only when the profile shows the skills.

---

## Phase 10: Courses

**Goal:** the owner's own courses and books, studied on the board, transcribed exactly.

**Features:** E1, E2, E3, E4, E5, E6, E7, J8, J9

**Depends on:** Phase 8; S6; the owner's files (Q6).

| WP | Scope | Tests |
|---|---|---|
| 10.1 Course model and PGN import (E1) | Course → chapters → items; each PGN game a chapter | Fixtures |
| 10.2 PDF route (E3, J8) | Skill `import-course-pdf`; legality replay; the diagram cross-check; the doubts list on the review screen with the page beside it | The S6 chapter with planted errors: all caught |
| 10.3 ChessBase route (E2, J9) | The documented export-to-PGN steps; try the open converter on a real file when one exists | A converted file imports |
| 10.4 Study and quiz (E4, E5, E6) | Chapter study on the board; find-the-move quiz; completion per chapter; agent `coach-course` and playbook `course-chapter` | Harness scenarios, including "quotes only the current item" |
| 10.5 Level check (E7) | Tag chapters above the owner's band; suggest an order | Fixture |
| 10.6 Copyright guard | The pre-commit check and a test that nothing under `data/courses/` can be served or committed | The test fails if the guard is removed |

**Done when**

1. A PGN course imports as chapters and can be studied and quizzed, with progress kept.
2. A PDF chapter imports with every move legal and every diagram matching, or listed as a doubt.
3. `git status` never shows course content.

---

## Phase 11: Daily plan and progress

**Goal:** the coach leads a session step by step, and the owner can see what is improving.

**Features:** F3, F8, G4, G8, G9, G10, K2, K3, K4, K5, K6

**Depends on:** Phases 5–9; goal and time (Q3, Q4).

| WP | Scope | Tests |
|---|---|---|
| 11.1 Planner (F3) | From due cards, unreviewed games, the weakest habit and motif, band lessons, the time available and the play / study split: 2–3 session options | Fixture states give sensible, different options |
| 11.2 Guided session (F8) | The session runner; hand-overs between modes; agent `coach-host` and playbook `session-host`; notes for next time | Harness scenarios; Playwright through a short session |
| 11.3 Progress panel (G9) | Process measures first, rating second; forecasts as ranges | Fixture histories |
| 11.4 Guardrails (G8, G4) | The tilt guardrail on sync (two or more losses → suggest a break or a review); forgiving streaks tied to real work | Fixtures |
| 11.5 Self-experiment log (G10) | Setting changes beside results over time | A change shows with its date |
| 11.6 Settings (K2, K3, K4, K5, K6) | Presets; grouped pages for coach style, display, training mix and guardrails | Applying a preset changes exactly its keys |

**Done when**

1. "Start today's session" gives a coach-led sequence sized to the time available.
2. The progress panel shows the process measures and their trends from real data.
3. After two imported losses the guardrail suggests a break or a review.
4. A preset can be applied and undone, and every change is logged.

---

## Phase 12: Parity polish

**Goal:** close the gaps against the parity map in [FEATURES §4](FEATURES.md#4-feature-catalogue).

**Features:** I11

| WP | Scope |
|---|---|
| 12.1 Phone (I11) | A layout that works on a phone on the home network; opt-in network access with a pairing code (Q7) |
| 12.2 Backup | Export and restore of the database and settings |
| 12.3 Leftovers | Anything in the parity map not yet `done`; speed and polish |

**Done when** every row of the parity map is `done` or `parked` with a reason, and a backup restores
onto a clean copy.
