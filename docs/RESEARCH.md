# Chess Coach: How the coach should use the engine and skills

Research done 2026-11-13 because the owner asked how Claude can use the engine and skills to coach better.
These are findings, not designs: Phase 2 turns them into decisions. Sources are at the end.

**How sure:** the Stockfish 19 notes and the two GitHub repos were read directly. Everything else comes
from search results and abstracts, not full papers, so check anything before it's relied on in a
design.

**Re-checked 2026-11-13:** the claims the design leans on were verified against live sources; see
[§10](#10-validation-audit-2026-11-13). Corrections are made in place below and marked *(updated)*. The
findings became decisions in [TRACKER.md](../TRACKER.md) (D16–D28) and designs in
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. The engine thinks, Claude talks

Recent work agrees that a language model given only a FEN or PGN **invents moves, tactics and
evaluations**:
- *Hallucinations on the Board* (ACT-Eval) checks chess commentary by sending each checkable claim to
  engine and board-state tools.
- *Caïssa AI* checks LLM output against a symbolic rule engine.
- Several open-source "LLM + Stockfish" coaches feed the model verified engine facts, then run an
  automatic accuracy check on what it wrote.

**For us:** every checkable claim (move legality, material won or lost, threats, mates, the best move)
comes from a tool before the coach says it. Plans and ideas can't be fully checked by an engine, so
the coach says when something is its own judgement.

## 2. No raw scores for a beginner

The *Master Distillation* paper tells its teacher model to **avoid citing engine scores** and keep
explanations short and grounded. At 500 this matters even more: translate "−3.2" into "you lose a
knight" or "that allows mate in 2".

## 3. Use winning chances, not centipawns

Lichess turns the engine's centipawns into winning chances and scores moves on how much they drop:

- `Win% = 50 + 50 · (2 / (1 + e^(−0.00368208 · cp)) − 1)`
- Move accuracy: `103.1668 · e^(−0.04354 · (Win%before − Win%after)) − 3.1669`. Losing 10% of your
  winning chances is about 64% accuracy.
- Game accuracy is reportedly a harmonic mean of move accuracies (a forum claim, unofficial).

Why it matters: giving away 3 pawns when you're +10 changes nothing; giving them away at 0 decides the
game. Labels based on winning chances match what a beginner feels.

*(updated)* Lichess's cut-offs: a drop in winning chances of **0.1 = inaccuracy, 0.2 = mistake, 0.3 =
blunder** on its −1…+1 scale (5, 10 and 15 points of Win%). This is quoted from lila's `Advice.scala`
in forum posts; the file itself has moved (`modules/tree/…`) and wasn't read directly, so confirm it in
the source when the analysis pipeline is built (PLAN work package 5.3).

## 4. A beginner's thinking routine is the backbone

Coaching sources converge on one routine:
1. **What did their last move do?** What does it attack or threaten?
2. **My checks, captures, threats**, in that order.
3. **Two candidate moves**, not one.
4. **Blunder check:** after my move, what can they capture, check or threaten?

Below about 1000, the biggest single problem is **hanging pieces**: moving a piece to a square where it
can be taken.

**For us:**
- The Socratic questions (ask first, then explain) walk the owner through this routine.
- Every mistake in a review is tagged with **which step was skipped**.
- Those tags become the mistake patterns in G2 ("you skipped the blunder check in 6 of your last 10
  mistakes").

## 5. Sparring at 500 is the hardest engine problem

- Stockfish's built-in strength limit (`UCI_Elo`) goes **no lower than 1320**.
- `Skill Level 0` is roughly 1100 by one developer's measurement: still too strong for 400–500, and its
  strength drops off unevenly at the low end.
- chess_rocket gets lower by mixing a shallow search with random moves. That works, but it plays
  perfect moves and then random blunders, which isn't how a 500 player plays.
- **Maia / Maia-2** are neural nets trained on millions of human games to predict *what a player at a
  given rating would play*. Maia-2 covers all rating levels with one model. The original Maia bots ran
  1100–1900; Maia-2's real low end needs checking against 500.
- Maia can do more than spar: it can answer **"what do players at your level play here?"** That helps
  with realistic puzzles, trap warnings ("most 500s take this pawn, and it loses the queen") and
  repertoire choices.

*(updated)* **Maia-3 has replaced Maia-2.** CSSLab's Maia-2 page now says "Maia-3 is recommended for
new projects".
- `CSSLab/maia3`: AGPL-3.0; models of 5M, 23M and 79M parameters (5M is the one meant for CPUs); it
  ships a **UCI engine** with `Elo`, `SelfElo`, `OppoElo`, `Temperature` and `TopP` options and reports
  the likely human moves.
- It needs **Python**. No official browser or JavaScript build exists; community ONNX ports do, unchecked.
- Reported range: **600 to 2600 on the Lichess blitz scale** (from the Lichess announcement of
  maiachess.com, not from the repo; spike S4 measures the low end).

**Decided (D20):** install Python, use Maia-3, and offer one human-like bot per Elo step. Weakened
Stockfish stays only as a labelled option.

## 6. Spaced repetition

- There are no controlled studies of spaced repetition specifically for chess. The support comes from
  general memory research.
- It suits **discrete facts**, such as opening lines and puzzle patterns.
- Chessable-style drills have a known weakness: you drill **only your own moves** and gloss over the
  opponent's ideas. So drills here (D4) include each move's *why*, the opponent's common replies at the
  owner's level, and their threats.
- For tactics, the **Woodpecker method** (the same set, faster each round) is a popular complement (C6).
  The later coaching research found it suits players from about 1200; the owner keeps it as an option,
  off by default (D19).
- *(updated)* **Scheduler: FSRS**, the current open algorithm (`ts-fsrs`, MIT, Node ≥ 24), instead of
  the older SM-2 that chess_rocket uses. Its intervals expand on success, which is what the spacing
  research asks for.

## 7. Content we could use

- **Lichess puzzle database:** *(updated)* **6,193,530** puzzles, rated and theme-tagged (hanging
  piece, fork, mate-in-1…), **CC0**, a CSV last updated **2026-11-11**. Columns: `PuzzleId, FEN, Moves,
  Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags, DailyDate`. The FEN is
  the position *before* the opponent's move; the first move in `Moves` is the opponent's, and the
  solution starts with the second. Theme training at the owner's rating comes straight from it (C5).
- **How Lichess makes its puzzles** (`lichess-puzzler`, AGPL): a position is a candidate when the
  winning chances jump by more than 0.6 (on the −1…+1 scale); a solution move counts only if it beats
  the second-best by more than 0.7; a mate-in-one accepts every mating move. These are the rules for
  puzzles from the owner's own games ([CONTENT §6](CONTENT.md#6-puzzles)).
- **Lichess opening explorer:** *(updated)* it **now requires an OAuth token on every request** (host
  `explorer.lichess.org`). Rating buckets in the API are `0, 1000, 1200, 1400, 1600, 1800, 2000, 2200,
  2500`; the lowest covers 0–999 (the "400" seen on the site is only its label).
- **Lichess openings list (CC0):** names and ECO codes for opening identification (A7). chess_rocket
  builds its 3,627-opening database from it.

## 8. Stockfish 19 facts

- Released early September 2026, with the SFNNv16 network: **up to +44 Elo over Stockfish 18**.
- **Universal binaries:** one download detects the CPU's features at runtime and runs the best code.
  There's no AVX2 / AVX-512 build to choose for the Ryzen 7 7840HS.
- **Strict validation:** on an invalid FEN, position or UCI command it prints
  `info string CRITICAL ERROR …` and **ends the process immediately**. The coach must check every
  position before sending it, and cope with the engine restarting.
- Evaluation is neural-network only (the classical hand-written evaluation was removed in Stockfish 16).
  It gives no "king safety −0.4, mobility +0.2" breakdown, so explanations come from motif detection
  and engine lines (§1, H4).

## 9. Skills are the coach's playbooks

The reference projects keep their teaching method in written instructions (chess_rocket's CLAUDE.md
and SKILL.md). For us, each recurring coaching job becomes a playbook (H9):
- review a game
- explain a position
- drill session
- lesson
- course chapter
- sparring commentary
- daily plan

Every playbook enforces §1 (check before you say it) and §4 (the thinking routine), and pitches the
explanation at the owner's current level (G5).

*(updated)* The playbooks are specified in [COACH.md](COACH.md): one agent per mode, each loading a
shared core skill plus one playbook, with a test harness so a small model's behaviour can be measured.

## 10. Validation audit (2026-11-13)

The owner asked for the research to be validated before planning the build. Each load-bearing claim
was checked against a live source.

| Claim | Result | Checked against |
|---|---|---|
| Stockfish 19: `sf_19`, 5 Sep 2026, universal binaries, SFNNv16, up to +44 Elo, ends the process on invalid input | **Confirmed.** The Windows asset's name and size weren't re-checked (the asset list didn't load); verify at download | GitHub releases |
| claude-chess: MIT, own minimax, about 1200–1400 | **Confirmed** | its README |
| chess_rocket: GPL-3.0, 21 tools ("17+" in the README), dashboard refreshed by polling, SM-2, 284 puzzles | **Confirmed.** It is Python (FastMCP, python-chess) | its README |
| Blunder causes at 600 rapid: 36% missed threat, 27% never looked at the reply, 19% too fast, 1% low time; 62% free material taken; 29% forks found; 19.7% lost in the opening; 64% score after a +1 lead | **Confirmed.** The method page still isn't public; a "blunder" there is a loss of ≥ 150 cp | chessstats.gg |
| Southwick et al. 2026: 44,213 Chess.com players, 3.61× learning efficiency for deliberate practice | **Confirmed:** "Not All Practice Is Created Equal: Longitudinal Evidence From Over 40,000 Chess Players", *Psychological Science* 37(7), 514–523. Per-activity numbers remain unverified | journal listing |
| Learning-science effect sizes, the Maia and skill-compatibility papers, Lichess's Win% and accuracy formulas | **Consistent** with the published literature | — |
| Puzzle database: 6,057,356, updated 2026-07-29 | **Stale:** 6,193,530, updated 2026-11-11 | database.lichess.org |
| Explorer needs no login; filters "from 400" | **Wrong now:** a token is required; the lowest API bucket is `0` (0–999) | Lichess blog (via search), Lichess API spec |
| "Does Maia go down to 500?" | **Answered:** Maia-3, reported 600–2600 on the Lichess blitz scale | CSSLab repos, Lichess announcement |
| Lichess's inaccuracy / mistake / blunder cut-offs unknown | **Found:** 0.1 / 0.2 / 0.3 (forum quotes of the source; confirm at build) | Lichess forum |
| Chess.com lists ongoing Daily games | **Confirmed:** `/pub/player/{user}/games` and `/games/to-move`. Archives may refresh only every 12–24 h | Chess.com API page |
| Lichess export returns finished games only by default | **Confirmed:** `ongoing=false`, `finished=true` | Lichess API spec |
| The Reddit "17 chess tools" post | **Still unreadable:** blocked, the mirror is gone, and it isn't in search | — |
| A ChessBase conversion route exists | **No reliable open one.** `.cbv` is closed; `cbh2pgn` is limited. Export to PGN outside the app | search |

## 11. How the coach reaches the page

The owner wants their Claude Code session, on Haiku or Sonnet, to coach on the site itself. Claude
Code's docs were read on 2026-11-13.

| Route | How it works | State |
|---|---|---|
| **Headless session** | `claude -p --input-format stream-json --output-format stream-json` keeps a multi-turn session open: each event is written to its stdin; it acts through MCP tools. `--agent`, `--model`, `--mcp-config`, `--strict-mcp-config`, `--permission-mode` and `--allowedTools` shape it | Documented and stable. **Chosen (D17)** |
| **Channels** | An MCP server pushes events into a session that is open in a terminal; the session replies through a tool. The demo channel `fakechat` is exactly a chat page on localhost | Research preview. A custom channel needs `--dangerously-load-development-channels` and a confirm dialog on every start, and is ignored under `-p` |
| **A tool that waits for the next event** | The coach calls a blocking tool in a loop | Wrong pattern: MCP calls move to the background after 2 minutes, and idle calls time out |
| **Monitor tool** | A session watches a WebSocket and treats each message as an event | Possible in an open terminal session; not needed |

- **Billing:** with a plan login, `claude -p` and the Agent SDK still draw from the normal plan limits
  (Anthropic help centre, update of 7 Oct 2026). A move to separate monthly credits was announced for
  June 2026 and then **paused**; it could return. The design keeps the transport swappable.
- **Policy:** Anthropic doesn't allow offering a claude.ai login inside a product for other people.
  This is a personal tool on the owner's own login; if it is ever shared, each person brings their own.
- **Agents and skills:** an agent file sets the model, the allowed tools and the skills to preload,
  and `claude --agent <name>` runs the whole session as that agent. That is how the playbooks are
  "well sorted" ([COACH §5](COACH.md#5-agents)).
- **Small model, big job:** current prices make Haiku very cheap per turn; the risk is quality, not
  cost. So the model only phrases verified facts and every message is checked
  ([ARCHITECTURE §9](ARCHITECTURE.md#9-the-validator)).

---

## Sources

- Hallucinations on the Board: tool-augmented evaluation of LLM chess commentary: https://arxiv.org/pdf/2608.04240
- Grounded chess reasoning via Master Distillation: https://arxiv.org/pdf/2603.20510
- Caïssa AI, neuro-symbolic chess agent: https://link.springer.com/chapter/10.1007/978-3-032-02813-6_11
- LLM chess coach grounded in verified engine facts: https://github.com/alishaifthikhar/chess-coach
- "Engine thinks, LLM talks" prototype: https://github.com/dwrench07/ChessServer/pull/1
- Precompute board facts, don't trust FEN-only LLMs: https://github.com/imutkarsht/Chess_analyzer/issues/63
- Lichess accuracy: https://www.lichess.org/page/accuracy
- How to think during a chess game: https://lichess.org/@/NoelStuder/blog/how-to-think-during-a-chess-game/D0xfHpFc
- Not picking up forcing moves: https://lichess.org/@/HGabor/blog/typical-mistakes-nr-2-not-picking-up-forcing-moves/qFArPl7c
- A practical 3-step thinking process: https://chessfox.com/the-practical-3-step-thinking-process/
- Stockfish UCI options (UCI_Elo, Skill Level): https://github.com/official-stockfish/Stockfish/wiki/UCI-&-Commands
- Maia: https://github.com/CSSLab/maia-chess, https://www.maiachess.com/
- Maia-2 paper: https://arxiv.org/html/2409.20553v2
- Chessable MoveTrainer notes: https://notes.andymatuschak.org/zDr94hP6bG3jJYrdYy8B5hx
- Spaced repetition in chess: https://zwischenzug.substack.com/p/spaced-repetition
- Lichess open database (puzzles): https://database.lichess.org/
- Stockfish 19 release: https://stockfishchess.org/blog/2026/stockfish-19/
- Reference projects: see [REFERENCES.md](REFERENCES.md)

Added by the 2026-11-13 audit:

- Stockfish releases: https://github.com/official-stockfish/Stockfish/releases
- Maia-3: https://github.com/CSSLab/maia3 · Maia-2 (points to Maia-3): https://github.com/CSSLab/maia2
- Lichess database (puzzles, evaluations): https://database.lichess.org/
- Lichess puzzle generator: https://github.com/ornicar/lichess-puzzler
- Lichess API spec: https://github.com/lichess-org/api
- Explorer now needs a token: https://lichess.org/@/thibault/blog/the-opening-explorer-now-requires-authentication/FSWh9Zg3
- Chess.com published-data API: https://www.chess.com/news/view/published-data-api
- Blunder causes by rating: https://chessstats.gg/stats/lichess-rating-guide
- Southwick et al. 2026: https://journals.sagepub.com/doi/10.1177/09567976261452568
- FSRS for TypeScript: https://github.com/open-spaced-repetition/ts-fsrs
- Claude Code: headless mode https://code.claude.com/docs/en/headless · CLI reference
  https://code.claude.com/docs/en/cli-reference · channels https://code.claude.com/docs/en/channels and
  https://code.claude.com/docs/en/channels-reference · subagents https://code.claude.com/docs/en/sub-agents ·
  MCP https://code.claude.com/docs/en/mcp
- Agent SDK and plan usage: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
