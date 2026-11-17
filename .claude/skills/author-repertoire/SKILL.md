---
name: author-repertoire
description: Build-time skill for a terminal session (not the live coach) - writes the one-sentence why of each of the owner's repertoire moves and the opponent's idea, from the checked facts on the worksheet only, then runs gate V3 over every sentence. Use when asked to write, fill in or fix a repertoire's explanations.
---
# author-repertoire: the why of every move

**For:** a repertoire stored in the app (imported, built by the starter builder, or built from the book around an outline). Each position
where it is the owner's move gets, once: the **why** of the move played there, and, when the opponent
has just moved, the **opponent's idea**. The drill cards (WP 8.8) show them. CONTENT §7, COACH §8.

**The rule (D33):** you phrase what the facts say; you never supply a reason of your own. Every move,
every verdict and every reason on the worksheet comes from Stockfish or from the app's code. If the
facts give no reason, write less, or nothing: an empty idea is fine; an invented one is not.

## Steps

1. `node tools/author.ts list`: find the repertoire's id.
2. `node tools/author.ts sheet <id> work.json` (in the scratchpad, never in the repo): every position
   of the owner's once, with `line` (how it is reached), `move` (the owner's move there), `last` (the
   opponent's last move), and `facts`: the only things the words may state. Each fact's
   `Why: …` part is the app's own reason for that move.
3. Fill in `why` and `idea` in the file:
   - **why**: one sentence on the owner's move, built from the `Why:` of the fact about `move`:
     `"{m:Nf3} develops your knight and attacks the pawn on {sq:e5}."`
   - **idea**: one sentence on the opponent's last move, from the fact about `last`:
     `"Their move {m:a6} attacks your bishop on {sq:b5}."` Leave it `""` when that fact gives no reason,
     and at the first move of the game.
   - Moves and squares only as tokens: `{m:Nf3}`, `{sq:e5}`, `{pc:Nc6}`. Bare notation is refused (R1).
   - Beginner words, no numbers (no scores, no percentages). One sentence each; two at the most.
   - Claim words (fork, pin, threat, wins / loses material, hanging, best move, safe, mate…) only when
     a fact on that position's list says exactly that. The validator refuses them otherwise.
4. `node tools/author.ts apply <id> work.json`: the words are kept, and V3 checks every sentence like
   a live coach message, against the same facts, on the lines through those positions (`--full` runs
   every gate on every line). The words are recorded as **written by Claude** (D13: the page says who
   wrote them); words phrased word for word from the facts' "Why:" by a script go in with `--by facts`,
   the owner's own with `--by owner`.
5. Read what failed: `the why "{m:Nf3} forks…": …` names the sentence and the rule. Rewrite it from the
   facts and apply again, until it prints `Every sentence passed V3.`

## A big repertoire (built from the book, hundreds of lines: WP 8.13)

Work **chapter by chapter**, in the teaching order, and the drill's depth first:

1. `node tools/author.ts chapters <id>`: each chapter with how many of its positions have words.
2. `node tools/author.ts sheet <id> work.json --chapter "<name>" --missing --depth 5`: one chapter's
   positions still without words, down to the drill's depth (the moves the owner drills first). A
   position shared by chapters comes once, in the first chapter that reaches it.
3. Write and apply as above; then the next chapter. When every chapter is done to the drill's depth,
   go on without `--depth` (the deeper moves, drilled as the owner's level rises).

The facts are the same as for any repertoire: a line built from the book was played by masters, but
the words still come from the facts on the sheet only, never from what masters "usually" do.

## Don't

- Don't copy fact ids (`@P12.F3`) into the words; the sheet already strips them.
- Don't explain a move the line does not play, or say what the engine "prefers".
- Don't touch course or book material (`data/courses/`): it is never written into a repertoire's words,
  committed or published (a hard rule).
- Engine work: run it on mains power.
