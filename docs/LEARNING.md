# Chess Coach: How coaches teach and how people learn

The coaching follows this doc, not the engine (decision D15). It condenses the deep research done on
2026-11-13:
- full report: [reports/How chess coaches teach beginners.md](../reports/How%20chess%20coaches%20teach%20beginners.md), about 8,100 words, every claim sourced;
- research notes: [research_notes/How chess coaches teach beginners/](../research_notes/How%20chess%20coaches%20teach%20beginners/).

Go to the report for sources; this page is the working summary.

**How sure:** almost nothing about *teaching chess* has been tested in controlled studies. What follows
is coach consensus, general learning science and correlational platform data. So the app should log
its own results and tune itself to the owner (principle DP12).

**Re-checked 2026-11-13:** the numbers in §2 and the main platform study were verified against their
sources ([RESEARCH §10](RESEARCH.md#10-validation-audit-2026-11-13)). **Accepted by the owner the same
day:** every proposal that came out of this research, each as a setting whose default is the
recommendation below (decision D19).

---

## The bottom line

**At 500, the thing to teach is a thinking habit, not more chess knowledge.** The Steps Method,
Heisman, ChessKid, Lichess Learn and the Chess.com band plans all start the same way:
- piece safety, and counting attackers against defenders;
- before every move, a scan of checks, captures and threats;
- basic mates;
- tactics one pattern at a time.

Opening theory, strategy and deeper endgames wait until about 1000–1400. **Stockfish picks the
moments and checks every sentence. It never teaches 25-move lines.**

## 1. Where a 500 player stands

- **Heisman's stages:**
  - *Flip-Coin Chess*: moving without serious thought.
  - *Hope Chess*: not checking what the opponent can do after your move.
  - *Real Chess*: checking the opponent's checks, captures and threats for every candidate, on every
    move.

  A 500 player sits between Flip-Coin and Basic Hope Chess, so the first goal is a habit.
- **Steps Method:** Step 1 (up to about 800) moving into Step 2 (up to about 1400).
- **ChessKid:** the "Queen" level: hanging pieces → counting → double attack → fork → pin → skewer →
  discovered attack → K+R mate. Planning comes much later.
- **Studer's filter:** "Am I trying to learn addition before learning to count?" Don't study material
  meant for a higher level.

## 2. Where 500-level games are actually lost

From Lichess rapid at 600 (figures confirmed on chessstats.gg on 2026-11-13; its method page is still
not public, so treat them as indicative; a "blunder" there is a move losing at least 150 centipawns):
- **36% of blunders come from missing the opponent's threat** and **27% from never looking at the
  reply**. Only **1%** come from low time.
- Free material was taken only **62%** of the time, and an available fork found only **29%** of the time.
- About **1 game in 5 is lost in the opening**, through hanging pieces and traps rather than missing
  theory.
- **46% of blunders at 400–600 happen in positions that were already winning**, so converting won
  games is a skill to train.
- **The causes barely change between 600 and 1000; only their frequency falls.** Getting to 1000 means
  making the same mistakes less often.

## 3. How people learn chess

- **Strength is mostly recognition.** Better players think of better candidate moves, and patterns are
  tied to specific squares. So teach the most common patterns (loose pieces, back-rank mates, knight
  forks, pins) in many positions.
- **A puzzle is retrieval practice.** Testing beats rereading (g = 0.50), and more so with feedback.
- **Spacing:** missed motifs return at *expanding* intervals, each time in a new position.
- **Mixing:** once a motif is known, mix themes and hide the label (g = 0.42, and higher for
  easily-confused motifs such as pin, skewer and discovered attack).
- **Worked examples first for anything new** (expertise reversal). Beginners learn a *new* idea better
  from a shown example; for *known* ideas, questions and retrieval work better. Guidance fades as
  mastery grows.
- **Feedback explains why** (elaborated feedback beats right/wrong). For a puzzle, give it immediately;
  for a game, review afterwards. A generic "why does this work?" prompt helps (self-explanation,
  g = 0.55).
- **Practice:** serious solo study is the strongest predictor of rating (r = .58 among tournament
  players; for adults aged 44+, only study time and books predicted it). The coach's power is in
  *directing* effortful study, not replacing it.
- **Lessons and reviews beat just playing.** Among 44,213 Chess.com players, activities aligned with
  deliberate practice were linked to **3.61× more learning per hour than playing games** (Southwick et
  al. 2026, "Not All Practice Is Created Equal", *Psychological Science* 37(7)). Puzzles were reported
  as the weakest of them; the per-activity numbers couldn't be verified.
- **Watch for "I checked":** players who *say* they checked often didn't (eye-tracking and Heisman's
  think-aloud work). Test the habit by what the owner does, not what they say.

## 4. How a good coach reviews a game

**The order:**
1. **Own review first, engine off,** soon after the game: what were you thinking, and what did you consider?
2. Find the **first turning point**, not the final blunder.
3. Ask **which step of the routine was skipped**.
4. Only then does the **engine confirm**.
5. Write **2–4 takeaways**.

Pruijssers calls engine-first "the biggest mistake most players make".

**The skipped-step table** (the tag set for B5; a design built from Heisman's categories, not a
published taxonomy):

| What the engine sees | Skipped step | Heisman label | Ask first |
|---|---|---|---|
| Didn't answer a direct threat | "What does their last move do?" | Flip-Coin | "What was your opponent's last move trying to do?" |
| Own move hung a piece / allowed a fork or mate | Safety check on own candidate | Basic Hope Chess | "After your move, what checks, captures or attacks did they have?" |
| "I looked and it seemed safe" | Systematic scan replaced by a glance | Passive Hope Chess | "Walk me through each capture they could make." |
| Principled-looking move fails tactically | Concrete analysis | Hand-waving | "What did you expect them to play back?" |
| Only works if the opponent cooperates | Assumed an unforced reply | Assuming the opponent's move | "What if they don't play that?" |
| Missed winning a free piece | Scan for their loose pieces | Missed opportunity | "Were any of their pieces unprotected?" |
| Instant move, or blunder in time trouble | Time allocation | Time management | "Was this a moment to slow down?" |

**The hint ladder** (from tutoring research: pump → hint → prompt → assertion) is our question → nudge →
arrow → answer.
- **Stop rules:** give the answer after **two misses**, when the owner says "just tell me", when the
  idea is **new** to them, or when the point is deeper than about **2 moves**.
- Close with one "why" prompt.
- **Track hint use:** relying on hints is a signal too.
- Tone: Mattson's "positive sandwich" (two positives around one learning point).

## 5. Explaining in human words

- Give **the purpose of each move in one sentence**, Chernev's *Logical Chess* style, not essays.
- **Concept ladder by level:**

| Use constantly at ~500 | Introduce simply | Defer until 1200+ |
|---|---|---|
| Hanging / undefended pieces; counting attackers vs defenders; checks, captures, threats; the opponent's threat; piece values and trades; back-rank and queen mates; forks, pins, skewers | Opening principles; king safety; "which of your pieces is doing nothing?"; active vs passive pieces; trade when ahead | Silman's imbalances as a system; pawn-structure plans; prophylaxis; good vs bad bishop; space |

**The engine's four jobs:**
1. **Choose the moments**, by the biggest drop in winning chances.
2. **Fact-check every claim.**
3. **Judge the owner's proposed moves** during questioning.
4. **Prefer a simple, findable move** when the gap is small (an inference from the Maia work).

No centipawns and no long lines on screen. At most 1–2 forcing moves to make a point visible.

**Language-model discipline:** grounded coaches that use GPT-4o, and one built on Claude, still invented
pieces and moves. The fix everyone converged on:
- The engine and the board compute the truth, and the model only phrases it.
- List every real attack on the board for the model (Kim et al. 2024).
- **A validator rejects any move, square or piece the board doesn't confirm.**

## 6. The adult learner

- **Tilt is real:** after a loss the next game is about **16 Elo weaker for players under 1200** (24
  after 5+ losses in a row). **A 30-minute break erases it.** After a loss, suggest a break or a review,
  not a rematch.
- **Motivation (self-determination theory):** competence, autonomy and relatedness. Offer choices.
  **Growth-mindset messages barely work** (d ≈ 0.02–0.05); concrete process praise is better ("you
  checked their captures every move this game").
- **Streaks cut both ways:** a large trial showed modest gains, yet Khan Academy dropped streaks.
  Use forgiving streaks tied to meaningful work (one game reviewed), and **cap the drill backlog**.
  Chessable users report backlogs as demotivating.
- **Pacing:**
  - Heisman's split is about 55% play and 45% study, "a rough approximation".
  - Decide whether an hour is for fun or for training.
  - Prefer short, fresh, protected sessions ("energy beats volume").
- **Slow games:**
  - At 600 rapid, games are lost to skipped checks, not the clock.
  - Classical and Daily games are the best practice ground. The routine is learned offline, because the
    coach never touches a live game.
- **Expectations as ranges:** an 800-rated adult studying 4 h/week gained a median **+194** in a year
  (25th–75th percentile: +51 to +483). Show progress as process measures first and forecast in ranges.

## 7. Curriculum from 500 upward (moved on by skill, not rating)

| Band (Chess.com rapid, approx.) | Thinking and safety | Tactics and patterns | Endgames | Openings | Move on when |
|---|---|---|---|---|---|
| **~400–700** | Their last move → checks, captures, threats → blunder check; "King CPR" (capture, block, run); hanging pieces; counting | Mate in 1, back-rank mate, double attack, fork | K+Q vs K, K+R vs K, stalemate traps | Principles; defend Scholar's Mate and early queen raids; one simple setup per colour | Hung pieces per game clearly falling; both basic mates from any start; fork and mate-in-1 reliable without hints |
| **~700–1000** | Routine extended to their forcing replies, one move deep | Pin, skewer, discovered attack, double check, removing the defender, mate in 2; mixed sets with labels hidden | Two-rook ladder; square of the pawn; opposition; trade when ahead | About 8–10 moves per line, drilled against what 400–1000 players play (D6) | Opening-loss and blunder rates near 1000-level figures; won games converted more often |
| **~1000–1300** | Systematic scan (cures Passive Hope Chess) | Calculate-then-commit; "two by two" visualisation | Key squares; simple pawn endings | Deepen only where games show gaps | Fewer than one decisive blunder in most games |
| **~1300–1500+** | Candidate moves and simple plans | Deeper calculation | Lucena, Philidor | A lean repertoire | — |

The "move on when" rules are design rules of thumb; no source publishes cut-offs.

## 8. The dynamic level is a profile, not a number

Average centipawn loss misleads at low levels. Use instead:
- **Main signals:** **blunders per 100 live moves** (moves while the game is still undecided) in
  Rapid, Classical and Daily games; hung pieces per game; the opening-loss rate; the conversion rate of
  won positions.
- **Patterns:** how often each skipped step shows up across games (B5 → G2), so the costliest habit is
  taught first.
- **Per-motif mastery:** accuracy, solve time and hint level. This drives the worked example → partial
  → full → mixed ladder, and how much the coach explains.
- **Rating:** a lagging cross-check only. Expect fits and plateaus, and say so up front.

## 9. Design principles

| # | Principle |
|---|---|
| DP1 | **Teach the habit before the knowledge.** One thinking routine runs through every mode. |
| DP2 | **Diagnose the skipped step, not the centipawns.** Tag each mistake by type *and* skipped step; the first question targets that step. |
| DP3 | **Ask about known things, show new things.** Ask about the owner's own reasoning and motifs already taught; give a worked example first for a brand-new motif. |
| DP4 | **Climb the hint ladder fast.** Answer after two misses, on "just tell me", or when the point is deeper than about 2 moves; then one "why" prompt. |
| DP5 | **Fewer moments, deeper.** 1–3 per game, starting from the first turning point; never call a difference under about 0.5 pawns a mistake. |
| DP6 | **The engine is a silent checker.** It picks moments, fact-checks claims and judges answers; no centipawns or long lines on screen. |
| DP7 | **Explain purpose in human words, pitched to the band** (the concept ladder). |
| DP8 | **Retrieval with explained feedback, spaced and then mixed** (expanding intervals, new positions, labels hidden later). |
| DP9 | **Fade guidance as mastery grows**, per motif. |
| DP10 | **Teach only what this level needs.** Move through bands on evidence of skill. |
| DP11 | **Self-review before the engine, soon after the game.** |
| DP12 | **Measure process; forecast in ranges.** The app is an experiment with one participant, so log its results and tune. |
| DP13 | **Protect the learner's state:** a tilt guardrail, forgiving streaks, a backlog cap, choice. |
| DP14 | **Play slow, review always.** Favour Classical and Daily games and a roughly 50/50 play/study split. |
| DP15 | **Never touch a live game.** |

## 10. Two tensions for the owner to decide

**Decided 2026-11-13 (D19):** both go with the research's suggestion as the *default*, and both are
settings the owner can change at any time. The repertoire starts tiny and deepens with the level; the
coach nudges toward slow games. The same decision keeps Woodpecker rounds available as an option even
though the research would wait until about 1200.

1. **Repertoire at 500.** The owner wants repertoire drilling, but the evidence says opening theory
   barely matters at this level. Self-determination theory says honour the choice. The suggested
   compromise: a *tiny* repertoire (one simple setup per colour, a few moves deep) built around safety
   in the opening and known traps, every move explained, and deepened as the level rises. This is Q15
   in the tracker.
2. **Rapid vs slow games.** Heisman warns that 10–30-minute games can slow improvement for low-rated
   players, while other coaches recommend 15|10. The research points to Classical and Daily games as
   the main practice ground, with Rapid kept for fun. This is Q16.

Proposed feature changes from this research are in [FEATURES.md §4b](FEATURES.md#4b-proposed-by-the-coaching-research-2026-11-13).
