# Chess Coach: References (prior art the owner shared)

The projects the owner pointed to on 2026-11-13: what each one is, what it gives its coach, and which
ideas we take. These are **feature ideas only**; nothing is copied. License notes are there in case
code is ever borrowed.

---

## claude-chess: https://github.com/yongqyu/claude-chess

**What it is:** a chess coaching skill for Claude Code. You play in the terminal, and after every move
Claude rates it, suggests better ones and explains its own move. **MIT license.**

- **Board:** a Unicode board in chat plus a coloured ANSI board in the terminal, with a win-probability bar.
- **Engine:** its own minimax search at depth 3, **not Stockfish**. The author puts it at about 1200–1400,
  easy for a strong player.
- **Coaching powers:**
  - Move ratings (brilliant / good / inaccuracy / mistake / blunder) with win-probability swings.
  - Persona opponents (Fischer, Tal, Petrosian, Carlsen), each with its own openings and voice. A
    persona can also be **extracted from your own games or any PGN**.
  - Detects 20 common openings.
  - An **ELO estimate** from play: `1800 − (avg centipawn loss × 6) − (blunder rate % × 40)`, smoothed
    over the last 5 games, which sets the auto difficulty.
  - A Markdown game review after each game: PGN, win-probability chart, annotated move table, blunder breakdown.
  - A persistent profile in `~/.chess_coach/`. The game state is saved after every move, so Claude
    can recover the position after losing context.
- **How it's built:** a skill over Python scripts (engine, coach, render, profile, review, persona, PGN adapter).

**Ideas we take:** move labels (B9), the rating estimate from play (G5), auto difficulty, review
reports (B10), board state that survives a context reset (H1), "play like this opponent" from a PGN
(H7).

## chess_rocket: https://github.com/suvojit-0x55aa/chess_rocket

**What it is:** an "adaptive chess tutor powered by Claude Code" that aims to take a learner from 0 to
about 1500. **GPL-3.0 license**: ideas are free to use, but copying its code would make ours GPL.

- **Board:** a web dashboard on localhost (refreshed by polling) with board, moves, eval bar, opening name
  and material.
- **Engine:** Stockfish over UCI. Below 1320 it mixes a depth-limited search with random moves; above that
  it uses Stockfish's `UCI_Elo`. **Auto difficulty** moves the target with accuracy: above 90% +100,
  80–90% +50, 65–80% no change, 50–65% −50, below 50% −100.
- **The coach's tools:** 21 tools over MCP (the README says "17+"):
  - game: `new_game`, `get_board`, `make_move`, `engine_move`, `undo_move`, `set_position`,
    `get_legal_moves`, `get_game_pgn`
  - analysis: `analyze_position`, `evaluate_move`, `set_difficulty`
  - openings: `identify_opening`, `search_openings`, `get_opening_details`, `suggest_opening`, `opening_quiz`
  - learning: `srs_add_card`, `create_srs_cards_from_game`, `generate_puzzles_from_game`, `save_session`,
    `srs_to_puzzles`
- **Learning:**
  - Spaced repetition (SM-2). A move losing more than 80 cp becomes a card automatically. Intervals run
    4h → 1d → 3d → 1w → 2w → 1mo.
  - 284 curated puzzles in nine sets, plus an optional Lichess puzzle import (~273 MB).
  - 3,627 openings from the Lichess list.
  - A blunder (300+ cp) triggers an intervention and an undo offer.
- **Tutor method:** three perspectives (GM teacher, learning psychologist, behavioural specialist), a
  three-phase curriculum, and session logs. Its CLAUDE.md and SKILL.md hold the teaching instructions.
- **Progress:** Elo, sessions, streak, wins / losses / draws, PGN auto-save, Markdown reports.

**Ideas we take:**
- The toolkit's shape (H1–H8), so the coach acts through tools instead of guessing.
- Auto difficulty by accuracy (G5).
- Undo offer after a blunder (A8).
- Mistakes become drill cards (C1, C4).
- Lichess puzzles and openings data (C5, A7).
- The three hats (FEATURES §3).
- Written playbooks (H9).

## Reddit: "I gave Claude 17 chess tools via MCP and it…"
https://www.reddit.com/r/ClaudeCode/comments/1rawjdj/i_gave_claude_17_chess_tools_via_mcp_and_it/

**Couldn't be read:** Reddit blocks automated fetching. It is most likely chess_rocket's launch post,
since the README also advertises "17+ MCP tools", but that's **unverified**. If it's a different
project, paste the post text into the chat and this entry gets updated.

Tried again on 2026-11-13: still blocked, a public mirror returned "not found", and a web search for
the title found other chess MCP projects but not this post. TRACKER Q13 stays open.

---

## The Lichess open-source stack (added 2026-11-13)

The owner: "since lichess is opensource we will try to get a lot of help from that." What exists, its
licence, and what we take. The project is licensed AGPL-3.0-or-later (decision D23) so any of it can
be reused.

| Project | What it is | Licence | What we take |
|---|---|---|---|
| [chessground](https://github.com/lichess-org/chessground) | Lichess's board: drag and click, arrows and circles, animations, touch, editor support; 10 KB; **no chess logic** | GPL-3.0-or-later | Used directly as the board (`@lichess-org/chessground`) |
| chessops | Lichess's rules library: legal moves, SAN, FEN, PGN | GPL-3.0-or-later | Used directly for all rules and parsing |
| [lila](https://github.com/lichess-org/lila) | The Lichess site itself | AGPL-3.0 | The winning-chances and accuracy maths; the inaccuracy / mistake / blunder cut-offs; the shape of "learn from your mistakes", studies and the analysis board |
| [lichess-puzzler](https://github.com/ornicar/lichess-puzzler) | How Lichess makes and tags its puzzles | AGPL-3.0 | The generator's rules and the theme tagger's ideas, re-implemented in TypeScript ([CONTENT §6](CONTENT.md#6-puzzles)) |
| [Lichess database](https://database.lichess.org/) | 6.2M puzzles; position evaluations; every rated game | CC0 | The puzzle CSV for themed training and lesson positions |
| chess-openings | Opening names and ECO codes | CC0 | Opening names on the board (A7) |
| [Lichess API](https://github.com/lichess-org/api) | Game export, studies, opening explorer, tablebase | — | Game import (no login); study import; explorer (**needs a token**); tablebase |
| lila-openingexplorer | The explorer's server | AGPL-3.0 | Used through the API, not self-hosted |

## Maia-3 (added 2026-11-13)

https://github.com/CSSLab/maia3 · AGPL-3.0 · University of Toronto CSSLab.

A family of models that predict the move **a human of a given rating would play**. It ships a UCI
engine (Python) with rating, temperature and top-p options. Reported to cover 600–2600 on the Lichess
blitz scale. It replaces Maia-2, whose own page now points to it.

**What we take:** the sparring bots, one per Elo step (F9, H7, decision D20); "what do players at your
level play here" as a stand-in for the explorer (D6); and the findable-move ranking (H12).

## Claude Code features the coach is built on (added 2026-11-13)

| Feature | Docs | Use |
|---|---|---|
| Headless mode with streaming JSON in and out | https://code.claude.com/docs/en/headless | The page starts and drives the coach (D17) |
| Agents (`--agent`, `.claude/agents/`) and preloaded skills | https://code.claude.com/docs/en/sub-agents | One coach agent per mode, each with its playbook |
| MCP servers | https://code.claude.com/docs/en/mcp | The coach's tools |
| Channels and the `fakechat` demo | https://code.claude.com/docs/en/channels | The alternative route (terminal-attach); a research preview, kept as a fallback |

Details and the comparison: [RESEARCH §11](RESEARCH.md#11-how-the-coach-reaches-the-page).

---

## What none of them does, and this project wants

- **One live board** that the owner and Claude share, with **the coaching on the web page** (A0, A1).
- **Game import** from Lichess and Chess.com, and reviews of the owner's real games (B).
- A **course and repertoire library** fed by PGN, ChessBase and PDF files (D, E).
- A sparring opponent that plays like a **500-rated human**, not a weakened engine (H7, research §5).
- A **fair-play guard** for games in progress (FEATURES §5).
- A **validator** between the model and the page, so nothing the board doesn't confirm is shown (H13).
- **Validation gates** on everything the owner studies from (group J).
