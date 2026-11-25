# Chess Coach: project context

A personal chess coach for the owner. It's a web app with one live board that the owner and Claude both
see, and Claude coaches on that page using written playbooks, with Stockfish checking the facts. It
covers game review, opening repertoires, lessons and courses, puzzles made from the owner's own
mistakes, play against human-like bots, and progress tracking, plus the everyday toolkit of Lichess
and Chess.com (analysis board, explorer, studies).

**Status (2026-11-15): the board, the board editor, the coach chat, "Play a bot" and "My games" run** (`npm run dev` →
http://127.0.0.1:5173). **Phases 0–5 are `done`** (all six spikes passed; S6 with a second
transcription as its fallback, D49; the playbook harness measured on Haiku and Sonnet). **Phase 5
(import and review), as built:** the owner's finished games come in by their public name on each
site, typed on the *My games* tab (5.1, `core/games.ts`, `server/library.ts`); the fair-play guard
(5.2); the game analysis (5.3: a label for every move and one to three key moments,
`core/review.ts`); the mistake tags (5.4: the skipped step, `core/tags.ts`); the owner's own review
first (5.5: the engine and the coach stay silent on a game until the owner presses Done or Skip); the
Socratic replay (5.6: agent `coach-review`, playbook `review-game`, the state machine in
`App.replay`); the review report with its takeaway journal (5.7: `core/report.ts`, written by code
from the stored analysis); and the skill profile (5.8: `core/profile.ts`, the coach's tool
`owner_profile`). Phase 7 is `in progress`: built early
as a slice at the owner's request (D42), with open items listed in [TRACKER.md](TRACKER.md). The analysis board has an
eval bar, best-move arrows, Chess.com-style move labels and a green arrow for the move that should
have been played (all settings, on by default: D39, A19); the owner can try their own moves on the
coach's board (D41); 18 Maia-3 bots play from 600 to 2600 (D42). **A move's label is the worse of the
drop in winning chances and what the move gives away (D47): one function, `gradeMove`, decides it
for the board, the sentence under it and the coach's facts.** The page's look comes from the tokens
at the top of `packages/web/src/styles.css` and the shared controls in `ui.tsx`
([ARCHITECTURE §4.1](docs/ARCHITECTURE.md#41-the-look-of-the-page-i16-d44)); build new screens from those.
**The fair-play guard is code, not a promise** (`core/fairplay.ts`, `App.blocked`, D51): a position of a
game the owner is still playing is refused at the door and gets nothing from the engine or the coach on
the board; anything new that shows engine output must go through it. The same gate enforces "your own
review first" (D56).
**Phase 6 is done (2026-11-15):** the content envelope and gates V1, V2, V3 and V6 for puzzles (6.1: `core/content.ts`,
`server/content.ts`; nothing is used for practice unless it is `live`), the puzzle player (6.2: the *Puzzles*
tab, `server/puzzles.ts`), puzzles from the owner's games (6.3: `server/puzzle-maker.ts`), themed sets
from the Lichess database (6.4: `server/datasets/puzzle-db.ts`), the schedule (6.5: `core/schedule.ts`,
FSRS through `ts-fsrs`), the safety check (6.6: `core/safety.ts`, `server/safety.ts`), "what's the threat?" (6.7:
`core/threat.ts`, `server/threat.ts`) and win the won game (6.8: `core/convert.ts`,
`server/convert.ts`); the drills share `server/drill-deck.ts`. Motif mastery (6.9: `core/mastery.ts`)
sets each puzzle's guidance; the optional modes (6.10: Woodpecker, `server/speed.ts`) are off by default.
The drill coach (6.11: agent `coach-drill`, playbook `drill-session`) coaches the puzzle player when the coach is on.
Games against the bots have clocks (off by default) and draw offers, and finished ones go into *My games* (7.3).
After a blunder the game offers to take it back and asks what was missed (7.4); the routine is voiced before
the owner's moves, fading with their blunder rate (7.5: `core/routine.ts`).
Mini-games with few pieces (7.6: `content/minigames.json`, `core/minigame.ts`). With the coach on, the
*Play a bot* tab has the sparring coach (7.7: agent `coach-spar`, playbook `spar-commentary`).
When several moves are as good, the coach teaches the one players at the owner's level find most often (Maia, 7.8);
engine-style bots are an option. **Phase 7 is done (2026-11-15).**
**Phase 8 has begun:** studies (8.1: `core/study.ts`, `core/posgraph.ts`, `server/studies.ts`; *Game → Studies…*) and the
opening explorer under the moves (8.2: `core/explorer.ts`, `server/explorer.ts`; my level, masters, my games; Maia's guess
without a token). The Lichess token is read from `.env` by `config.lichessToken` when something needs it; the explorer is
called at most once every three seconds and every answer is kept (D45, D73). A repertoire PGN goes through its gates line by line
(8.3: `core/repertoire.ts`, `server/repertoire.ts`, `content:validate -- --repertoire <side> <file.pgn>`; D74), and the
review screen settles what failed (8.4: *Game → Review content…*, `server/content-desk.ts`; D75) and builds a starter
repertoire around the seed lines in the settings (8.5: `RepertoireService.buildStarter`; D76; the openings wait on Q18).
Each repertoire move's why and the opponent's idea are written from the checked facts with the `author-repertoire` skill and
`tools/author.ts`, and V3 checks every sentence (8.6; D77). A repertoire is imported from the page (8.7: a PGN, a Lichess study
link or one of the owner's studies; D78). The approved lines are drilled one position at a time under *Openings → Practice*
(8.8: `core/opening.ts`, `server/opening-drill.ts`; agent `coach-opening`, playbook `opening-drill`; D79), with the trap
pack among the cards (8.9: `content/traps.json`, `server/traps.ts`, gated at server start; D80). An opened game says
where it left the repertoire and who left it, and *My games* shows results per line (8.10: `core/repgames.ts`; D81). When
the engine or a threshold changes, live content is checked again (8.11: `server/revalidate.ts`; D82). **All Phase 8 work
packages are done; the phase's first done-criterion (a live White and Black starter) waits on the owner's openings (Q18)
and approval. Phase 9 starts after that.** The repertoire and its drill have their own *Openings* tab (D9, D85:
`core/repbrowser.ts`, `web/src/OpeningsTab.tsx`). **The Endgames tab is built early** (F2, PLAN 9.3, D84): `content/endgames.json` through
gates V1, V2, V3, V6, V8 (`core/endgame.ts`, `server/endgames.ts`), played against the engine with the Syzygy
tablebases judging every move, with random starts for the queen, rook and two-rook mates (D87) and its own coach
(agent `coach-endgame`, playbook `endgame-coaching`; D88). **White's opening is chosen (Q18, 2026-11-15): the Réti
with the Nimzo-Larsen setup, built from the book** (D10, D11; WP 8.12–8.16, D90–D99): the owner's outline
(`content/repertoires/reti-nimzo-larsen.json`, 27 chapters, moves only; where the masters' usual move leaves the 2.b3 setup, the owner chose: D97) and, past it, the Lichess masters' database: every move of
every line in at least 25 master games, the owner's moves the masters' most played that pass V2 and V7, up to 650 lines and 12 moves
deep (built 2026-11-16: 552 lines, all the book holds, none quarantined, its words written from the facts for 1,066 of 1,235 positions, waiting for the owner's approval; `core/outline.ts`, `core/repbuild.ts`, `server/book.ts`, `npm run content:build`); V4 checks a book repertoire against the same
book; chapters through the review screen, the Openings tab, the words and the drill (new cards a few a day); several repertoires per
side (a game is matched with the one it stayed in longest). **The coach sits beside the repertoire** (D12, WP 8.17): on the Openings tab
it sees the position the owner walks to, or the practice card, and answers any question there (`opening_question`; on a card being
recalled it never names the move). **Black's opening is chosen too (Q18, 2026-11-17): the Accelerated Dragon against 1.e4,
the King's Indian setup against everything else** (D102; `content/repertoires/kid-accelerated-dragon.json`, 45 chapters, the
outline drawn up by Claude from the owner's choices; built 2026-11-17: 648 lines, none quarantined, its words written from the
facts for 948 of 1,103 positions, waiting for the owner's approval; Q32). Every move says where it comes from and every word who wrote it (D13). The coach is also beside the safety,
threat and won-game drills (D105). The code is on `main`, pushed to a GitHub repository that is **public** since 2026-11-17 (D103, D106): every push is published.

## Run it

| Command | Does |
|---|---|
| `npm run dev` | The server (port 5174) and the page with hot reload (port 5173) |
| `npm run build` then `npm start` | The built page and the server together on port 5174 |
| `npm test` | Fast tests: no engine, no model |
| `npm run test:engine` | Tests against real Stockfish with a fake coach (AC power, about 15 s) |
| `npm run test:page` | Builds the page, then drives it in Chrome against a real server and Stockfish with a scripted coach (AC power, about 15 s) |
| `npm run typecheck` | TypeScript over all three packages |
| `npm run lint` · `npm run check:docs` · `npm run check` | The linter (oxlint) · every feature ID in exactly one phase and every doc link resolving · both plus the type check and the fast tests |
| `npm run test:coach` (`-- --model sonnet`, `--agent coach-review`, `coach-drill`, `coach-spar`, `coach-opening` or `coach-endgame`, `--only id,id`, `--list`) | The playbook harness: the live coach through its scenarios (30 for the analysis board, 14 for the Openings tab, 12 for the puzzles and the other drills, 10 each for the game review, games against the bots and the endgames), scored by code, saved in `coach/results/` (uses the plan; about 6 minutes; AC power) |
| `npm run content:install -- puzzles` | Build the local puzzle database from the downloaded Lichess CSV (once; about ten minutes; 1.5 GB) |
| `npm run content:validate -- <file.json or id>` (`--save`) | Run the content gates over puzzles and print the report: quarantined with the reason, or passed (engine work; AC power) |
| `node tools/author.ts list` · `chapters <id>` · `sheet <id> [file.json]` (`--chapter "<name>"`, `--missing`, `--depth N`) · `apply <id> <file.json>` (`--full`, `--by claude\|facts\|owner`: who wrote them, D13) | A repertoire's words (the `author-repertoire` skill): how far each chapter's words are; the worksheet of positions with their facts (one chapter, only those still without words); the words written into it kept and checked by V3 on the lines through them (every gate with `--full`) (engine work; AC power) |
| `npm run content:build -- --check` · `<outline id>` · `remove <id> --yes` | Repertoires from the book (D10, WP 8.12): the outlines in `content/repertoires/` checked; one built around the masters' games (every move in at least 25 of them, the engine on every move of mine; hours the first time at the explorer's pace, on AC power; Ctrl+C saves nothing and running it again replays what was kept); a repertoire removed (logged). The log of a long run: `data/logs/` |
| `npm run content:validate -- --repertoire <white or black> <file.pgn>` (`--save`) | A repertoire PGN through gates V1–V7, line by line: what is quarantined and why, the gaps at the owner's level, the spot-check sample (engine work and paced explorer calls; AC power) |
| `node tools/coach-probe.mjs "<moves>" "<question>"` | Ask the live coach from the terminal (uses the plan) |
| `node tools/coach-log.mjs 20` | The coach's last messages with the validator's verdicts |
| `node tools/shot.mjs tour` (also `bots`, `alt`, `basic`, `ui`, `editor`, `games`, `puzzles "<PGN>"`, `themes [name]`, `safety`, `threat [move]`, `convert [moves]`, `speed [streak|timed]`, `woodpecker`) | Drive the page in a real browser and save screenshots (`URL=`, `OUT=`) |
| `node tools/ws-probe.mjs '<json message>' …` | Send messages to the running server and print the board, the coach's lines and the labels |
| `node tools/label-line.ts "<moves>"` | Label every move of a line as the page does and print the numbers behind each label (for comparing with another site's review) |
| `node tools/label-audit.ts --games 14 --elo 700` | Play Maia games, label every move, and list the labels a person would not accept |
| `node tools/minigame-maia.ts` (`--games 6`, `--elos 600,1000,1500`, `--only <id>`, `--json <file>`) | Play the mini-games with Maia as the bot and Stockfish or a 600 Maia on the owner's side; how they end, the bot's labels, how sure Maia is (AC power; about 8 minutes) |
| `node tools/make-golden.ts` (`--engine` to search again) | Rebuild the golden fact packets of `core/test/fixtures/golden` after a deliberate change of wording |
| `node tools/tb-probe.ts "<FEN>"` · `node tools/sample-puzzles.ts` | Ask the tablebases about a position · rebuild the puzzle sample the motif tests use |
| `node tools/shot-board.mjs "<PGN or FEN>" <name>` | Load a game on the analysis board and save a picture of the board with its arrows (`URL=`, `OUT=`) |
| `node tools/readme-media.mjs tour` · `stills` · `banner` (`URL=`, `FFMPEG=<ffmpeg.exe>`, `SCENES=coach,review,…`) | The README's media in `docs/media/`: one recorded clip per feature and the whole tour as a video, the pictures, the banner. Drives the real page with the live coach, so point it at a second server with its own data folder, never the owner's (uses the plan; AC power; about 6 minutes) |

To try a change without touching the owner's board or data, run a second server on another port with
its own data folder: `npm run build`, then
`PORT=5184 CHESS_COACH_DATA=<some temp folder> node packages/server/src/index.ts --serve-web`, and
point the tools at it (`PORT=5184`, `URL=http://127.0.0.1:5184/`). `coach-probe` and `shot.mjs` reset
the board they are pointed at.

Code: `packages/core` (pure chess logic), `packages/server`, `packages/web`; the coach's agent and
skills in `.claude/`; the bot roster in `content/bots.json`, the mini-games in `content/minigames.json` and the trap pack in `content/traps.json`; the Maia sidecar in `tools/maia_sidecar.py`. TypeScript runs on Node directly (type stripping), so no `enum`, no parameter
properties, and imports carry the `.ts` extension.

## Start here

| File | What it holds |
|---|---|
| [TRACKER.md](TRACKER.md) | **The source of truth:** phases, open questions, owner to-dos, decisions log, session log |
| [docs/PLAN.md](docs/PLAN.md) | **The build plan:** Phases 1–12, work packages, the tests that say a phase is done |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is built: stack, the coach bridge, tools, fact packet, validator, data model |
| [docs/FEATURES.md](docs/FEATURES.md) | The feature catalogue (A–K), each feature with its phase; the owner's words; hard rules |
| [docs/COACH.md](docs/COACH.md) | The coach: agents, skills, one spec per playbook, the hint ladder, the test harness |
| [docs/CONTENT.md](docs/CONTENT.md) | Content sources, formats, and validation gates V1–V8 |
| [docs/LEARNING.md](docs/LEARNING.md) | How chess coaches teach and how people learn; the coaching follows this |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Engine-grounded coaching; the validation audit; how the coach reaches the page |
| [docs/REFERENCES.md](docs/REFERENCES.md) | Prior art, the Lichess open-source stack, Maia-3 |
| `reports/`, `research_notes/` | Full deep-research reports and their sourced notes (LEARNING.md is the working summary) |

## Working rules

- **The engine originates every move; the coach only explains (D33).** No tool, playbook or content may
  let the model supply a move, a reply, a line, an arrow, a verdict or a reason from its own head. Moves
  and verdicts come from Stockfish, graded Lichess's way and checked against Lichess's cloud analysis;
  reasons come from code. If a change needs the model to "know" chess, the design is wrong.
- **Follow the plan's order.** One work package per session, from [docs/PLAN.md](docs/PLAN.md). Don't
  start a phase before the one above it is `done`. Design choices come from
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); if the work shows one is wrong, change that doc and log
  a decision in TRACKER rather than drifting.
- **TRACKER.md wins** any disagreement. At the end of every session, update TRACKER (status, decisions,
  session log) and FEATURES (when features move).
- **New ideas still go through the catalogue.** The owner's ideas go into FEATURES §7 in their words,
  then get an ID. Claude's own ideas are marked *proposed* and need the owner's yes. **IDs never
  change.** A dropped feature becomes `parked`, with the reason.
- **Keep it, and make it an option.** The owner wants everything kept and selectable (decision D19).
  A new behaviour ships as a setting with a sensible default and a one-line reason, not as a fixed
  choice. Only the two hard rules below are never settings.
- **Nothing the owner studies from is unverified.** Content goes live only through the gates in
  [docs/CONTENT.md](docs/CONTENT.md).
- Questions to the owner go in TRACKER's open-questions table, so nothing gets lost between sessions.
- Tests come with the code. Before ending a session run `npm run check` (type check, lint, the docs
  check, the fast tests), and `npm run test:engine` and `npm run test:page` when the engine, the
  server or the page changed. A commit that contains `data/`, course files or `.env` is refused by the
  pre-commit guard (`tools/check-staged.mjs`).
- **Writing files from the shell:** a bash heredoc silently eats backslashes here (it broke three
  regexes in one session). Write code with the Write / Edit tools, never through `cat <<EOF` or
  `node - <<EOF`.

## The owner

- A beginner, about **500 on Chess.com**. The level is **dynamic**: estimated from their play and
  moved as they improve, never a fixed number.
- Plays on Lichess and Chess.com, mostly **Rapid and Classical / Daily**.
- Wants the coaching **on the web page**, not in the terminal: the page starts the coach itself.
- **The engine checks facts; it isn't the teacher.** The owner learns from how coaches teach, not
  from 25-move engine lines (decision D15).

## How the coach behaves (the playbooks in docs/COACH.md)

- **Ask first, then explain.** Hint ladder: question → nudge → arrow → answer with the reason.
- **Check before you say it.** A move, tactic or evaluation is stated only after the engine or the
  board confirms it. In the app that is enforced by the engine-first tools, the fact packet and the
  validator (built; see docs/ARCHITECTURE.md §6–§9). Chess analysis written in a terminal chat, outside
  the app, is still labelled *unverified*.
- **Beginner language.** No raw scores ("you lose a knight", not "−3.2"). At most 1–3 key moments per
  game. Keep coming back to the thinking routine: their threat → checks, captures, threats → two
  candidates → blunder check.
- **Habit before knowledge.** At 500 the job is the thinking routine and piece safety, not theory. The
  principles DP1–DP15 in [docs/LEARNING.md](docs/LEARNING.md) are the coaching rulebook.

## Hard rules

- **Fair play.** Never help with a game in progress, *including Daily games*. Both sites ban it. Only
  finished games are imported or reviewed.
- **Copyright.** Course files and books (`data/courses/`, gitignored) never get committed, uploaded or
  published, not even as a shared page.

## Machine

- HP Omen laptop: Ryzen 7 7840HS (8 cores / 16 threads, Zen 4), 15 GB RAM, RTX 4060 Laptop GPU,
  Windows 11 (MicroWin install).
- Node 26 and git are installed. **Python 3.14.10** is in `C:\Tools\Python\` for the Maia-3 bots (D20,
  D29). It is not on PATH: call it by full path, never the Microsoft Store alias.
- **Heavy engine work needs AC power.** On battery the CPU is held to about 45 W. Under sustained load it
  sits at 100 °C and its power limit decays to 55 W (`~/Omen Tuning/CLOCKING.md` §14), so long engine
  runs slow down over time. Engine searches are node-limited so results don't change with heat.
- Benchmarks run on this machine are also logged in `~/Omen Tuning/` (the home CLAUDE.md rule).
- Tools live in `C:\Tools\<Tool>\` (installed and checksum-verified in Phase 1):

  | Tool | Path | Check / numbers |
  |---|---|---|
  | Stockfish 19 | `C:\Tools\Stockfish\stockfish-windows-x86-64-universal.exe` | `bench` = **2,497,913** nodes; 1.65 M nps on 1 thread, 11.8–12.5 M on 16; runs `x86-64-avx512icl` |
  | Syzygy 3-4-5 | `C:\Tools\Syzygy\` | 290 files; set `SyzygyPath` to it |
  | Maia-3 | venv Python `C:\Tools\Maia3\venv\Scripts\python.exe -m maia3.uci --model maia3-5m --checkpoint-path C:\Tools\Maia3\models\maia3-5m.pt`, with `HF_HUB_OFFLINE=1` | `maia3@1e13597`; torch 2.15 + CUDA 13.2; 5M on CPU 33 ms/move, 23M 73 ms |
  | Datasets | `data/datasets/puzzles/`, `data/datasets/openings/` (gitignored) | 6,193,530 puzzles (installed into `puzzles.sqlite` 2026-11-15); 3,865 openings |
- The coach runs as a headless Claude Code session on the owner's plan login (decision D17).
- Secrets (the Lichess API token, `LICHESS_TOKEN`) go into `.env` through the secret box, never into
  chat or git. Lichess API docs: https://lichess.org/api (the explorer is on `explorer.lichess.org` and
  needs a token but no scopes).
- Licence: AGPL-3.0-or-later (decision D23).
