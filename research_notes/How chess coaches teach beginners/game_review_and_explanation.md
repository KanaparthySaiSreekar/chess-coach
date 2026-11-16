# How Human Chess Coaches Review Games and Explain Ideas (and How Engines Fit In)

Scope: how good coaches review a student's games, the questions they ask, how they diagnose the student's thought process, how they explain in human concepts, and how engines should act as a background checker. The target is an AI coach for a ~500 Chess.com adult beginner that uses Socratic "ask first, then explain" coaching, with Stockfish running silently.

Evidence labels used below:
- **[Opinion]**: a coach's or author's recommendation.
- **[Evidence]**: a study, think-aloud protocol data, or a measured result.
- **[Secondary]**: a blog or aggregator reporting someone else's view.

---

## 1. The game review process strong coaches use (self-analysis, then coach, then engine)

### Takeaway
Coaches agree on the order: (1) replay the game without an engine and write down what you thought during the game; (2) mark the critical or turning-point moments; (3) review with a coach or stronger player; (4) only then use the engine to confirm or refute your conclusions; (5) finish with 2–4 written takeaways. This is a strong consensus among practitioners, but it is opinion. I found no controlled study comparing engine-first and self-first review.

### Cited Findings
- **[Opinion] WGM Dina Belenkaya's sequence (Chess.com, July 2025):**
  - Step 1 is to turn off the engine and the game-review aids and replay the game slowly. Ask what you were thinking, why you chose each move, and what alternatives you considered.
  - Note where you slipped into "hope chess" instead of calculating, where you first felt uncomfortable, and what your middlegame plan was. If you can't say what your plan was, "that's already a red flag."
  - Find the "point of no return": "Not the final mistake that lost the game, but the first mistake that put you on the path to trouble."
  - Step 2 is review with a coach or stronger player. Step 3 brings in the engine "Not as your god, not as your guru, but as a sparring partner."
  - Analyze soon after the game, and analyze wins and draws too.
  - [Chess.com – How To Analyze Your Games](https://www.chess.com/article/view/how-to-analyze-your-chess-games)
- **[Opinion] Belenkaya's review priority order:** blunders → major strategic mistakes → recurring patterns → missed opportunities → opening errors that lead to poor middlegames. Her end-of-review checklist asks:
  - "What was my biggest mistake and why?"
  - "What skill gap does it reveal?"
  - "What should I study?"
  - "Did I follow basic principles?"
  - "Where could I have used CCA [Checks, Captures, Attacks] better?"
  - [Chess.com](https://www.chess.com/article/view/how-to-analyze-your-chess-games)
- **[Opinion] GM Roeland Pruijssers' 4-step method:**
  1. Replay the whole game without an engine, "try to recall what you were thinking during key moments," and mark critical moments: where your opening knowledge ran out, where the position turned, and where there was a major tactical continuation.
  2. Analyze the marked positions on a separate board. Check your tactics, look for a better plan, work out the opponent's plan, and write down your thoughts and variations.
  3. Compare your move, your evaluation and your lines with the engine's.
  4. Write "2-4 points" of practical takeaways per game in a personal training database, and revisit them later.
  - [Chess.com – GM Roeland Pruijssers](https://www.chess.com/blog/GMRoelandPruijssers/how-to-analyze-your-own-chess-games-correctly)
- **[Opinion] Pruijssers on the engine:**
  - Turning the engine on right after a game is "the biggest mistake most players make." Using it too early "prevents you from developing and challenging your own thinking process."
  - Fully analyze 1–3 serious games per week, about 20–40 minutes each. Blitz and rapid games are mainly useful for spotting tactical errors and opening issues.
  - The method "can be applied to players of almost any level."
  - [Chess.com – Pruijssers](https://www.chess.com/blog/GMRoelandPruijssers/how-to-analyze-your-own-chess-games-correctly)
- **[Opinion] Yusupov (a Dvoretsky pupil), *Training for the Tournament Player*:**
  - Analyzing your own games is "the main method by which a chessplayer can improve," and "it is impossible for a player to improve without having a critical understanding of his own games."
  - His four steps are: (1) find the turning points, where "the assessment of the position changed"; (2) search for the reasons for your mistakes ("Why do you do these things?"); (3) look for new possibilities ("What different plans or ideas existed... that you didn't see or didn't understand correctly?"); (4) review the opening critically.
  - The blogger notes these books target players rated 2000+.
  - [Secondary: Chess.com blog summarizing Yusupov/Dvoretsky](https://chess.com/blog/Chessmo/analyze-your-own-games)
- **[Secondary] Dvoretsky on self-annotation:** in that book, Dvoretsky annotates one of his own games and then critiques the annotations, pointing out common problems in self-annotated games. One problem is self-serving attribution: winners credit "diligent planning and brilliant artistry," while losers blame "chance happenings on the board." The blog gives no full list. [Chess.com blog](https://chess.com/blog/Chessmo/analyze-your-own-games)
- **[Secondary] Botvinnik:** he considered analysis of his own games one of the most important training methods. That included *publishing* the analysis to invite critical feedback, which forced objectivity. [SayChess – The Botvinnik Method](https://saychess.substack.com/p/the-botvinnik-method-for-chess-improvement)
- **[Secondary] Noël Studer (IM, coach):**
  - His Lichess guide recommends downloading your latest games into a Lichess Study and analyzing them there, and keeping a study for your White and Black openings. [Lichess – Noël Studer](https://lichess.org/@/NoelStuder/blog/how-to-get-the-most-out-of-our-beloved-lichess/8o1lUKXL)
  - A student's write-up of his course says he recommends looking only at the ±2 evaluation swings, then working out what idea the engine is pointing to. [Secondary: Substack](https://nickvasquezmd.substack.com/p/analyzing-our-games)

### Inferences
- Coaches converge on a sequence an AI coach can use directly:
  1. **Recall:** what were you thinking?
  2. **Find the turning point:** the *first* real mistake, not the final blunder.
  3. **Diagnose why** it happened.
  4. **Find the better idea**, together with the student.
  5. **Verify silently with the engine.**
  6. **Leave 1–3 takeaways.**
- For a 500 player, the "turning point" is almost always a hung piece or a missed opponent threat (see §3). Reviewing every move would overload a beginner. Pruijssers' "2-4 points" and Studer's "only big swings" both support a strict filter: review 1–3 moments per game, chosen from the largest eval swings.
- The "recall what you thought" step only works soon after the game, while memory is fresh. An app should prompt for review right after the game ends.

### Gaps
- I couldn't retrieve Noël Studer's own post "99% make this game analysis mistake" (Lichess returned HTTP 403). His exact protocol is known only secondhand.
- I didn't retrieve primary text from Dvoretsky (e.g., *School of Chess Excellence*), Kotov (*Think Like a Grandmaster*), or Aagaard on self-analysis. Aagaard's blog (blog.qualitychess.co.uk) failed with an SSL error.
- Heisman has books devoted to reviewing your own games (*The Improving Annotator*; *Reviewing Your Own Chess Games*). Their titles surfaced in search, but I didn't retrieve the content.
- I found no controlled study that measures whether self-first analysis improves rating more than engine-first review. The consensus is entirely expert opinion.

---

## 2. The questions a coach asks during review

### Takeaway
There is **no single canonical list**. Across coaches, the questions cluster into six families:
1. What did you think during the game?
2. What was the opponent threatening?
3. Which candidate moves did you consider, and why did you reject them?
4. Did you check that your move was safe?
5. What was your plan?
6. Where did you spend or lose time, or feel uncertain?

Heisman's work adds the most diagnostic question: *which step of the thinking process was skipped?* His starting point is "Why did you play that move?"

### Cited Findings
- **[Opinion] Belenkaya's self-questions:** what were you thinking; why did you choose this move; which alternatives did you consider; where did you start playing hope chess; where did you first feel uncomfortable; what was your middlegame plan. At the engine stage: "would I find this move in a game, and if not, why not?" [Chess.com](https://www.chess.com/article/view/how-to-analyze-your-chess-games)
- **[Opinion] Pruijssers' self-questions:**
  - "Where did/do I feel uncertain?"
  - "Which moves took me a lot of time?"
  - "When did the position take a turn?"
  - Did I see the tactics correctly?
  - Was my decision process efficient, even when no better move existed?
  - [Chess.com – Pruijssers](https://www.chess.com/blog/GMRoelandPruijssers/how-to-analyze-your-own-chess-games-correctly)
- **[Opinion] Yusupov:** "Why do you do these things?" and "What different plans or ideas existed... that you didn't see or didn't understand correctly?" [Chess.com blog](https://chess.com/blog/Chessmo/analyze-your-own-games)
- **[Opinion/Evidence] Heisman on finding the cause:**
  - When a student errs, the instructor should find the *cause*.
  - Students often say "I did not see it," which Heisman notes can mean several different things. For example, they never looked, or they looked but misjudged.
  - In one case, the student's stated purpose for 4...Nb4 (threatening a fork on c2) revealed that he never checked White's forcing reply 5.Qa4+, which forks the king and knight.
  - Heisman says many 1200–1700 players *believe* they check safety when they don't, so their thought process has to be examined directly to uncover this.
  - Sources: [Chess.com – Heisman, Checking for safety](https://www.chess.com/blog/danheisman/checking-for-safety-requires-more-than-using-tactical-vision); [Chess.com – Passive vs Basic Hope Chess](https://www.chess.com/article/view/passive-vs-basic-hope-chess)
- **[Evidence] Heisman's think-aloud method (*The Improving Chess Thinker*):**
  - Following Adriaan de Groot, Heisman had players verbalize their thinking ("protocols") on set middlegame positions, and recorded rating and time spent.
  - He collected hundreds of protocols from Class F up to Expert and beyond.
  - This is a diagnostic technique: you hear *how* the student searches, not just which move they chose.
  - [ChessCafe review of The Improving Chess Thinker](https://chesscafe.com/book-reviews/the-improving-chess-thinker/)

### Inferences
Below is a compiled question bank, assembled from the sources above (not a canonical list). It is ordered roughly as a coach would use it on one critical moment, and simplified for a 500 player:
1. "What was going on in the game here? What did you think your opponent's last move was trying to do?" (Tests whether they noticed the threat.)
2. "Which moves did you think about here?" (Tests candidate generation. Beginners often have only one.)
3. "Why did you pick this one?" (Heisman's "why"; reveals hope chess or hand-waving.)
4. "Before you played it, what could your opponent do back? Any checks, captures or attacks?" (Tests the safety check, CCA/CCT.)
5. "Is there anything on the board that isn't protected?" (Loose pieces, for both sides.)
6. "How much time did you spend here? Did you feel rushed?" (Time management.)
7. "If you could replay this moment, what would you look at first?" (Self-correction and transfer.)

Questions 4 and 5 are the highest-yield at 500, because most decisive errors at that level are safety errors (see §3).

### Gaps
- No primary source gives Heisman's exact list of post-game review questions. The "Why did you play that move?" framing is consistent with his writing as retrieved, but I didn't confirm the exact phrase in his text.
- I found no coach source quantifying how often "How much time did you spend?" changes the diagnosis.

---

## 3. Error taxonomies and tying a mistake to the skipped thinking step

### Takeaway
The most usable taxonomy for beginners is Heisman's, which is organized by **which step of the thinking process failed** rather than by chess content:
- **Flip Coin Chess:** ignoring the opponent's moves.
- **Basic Hope Chess:** not checking the opponent's forcing replies to your move.
- **Passive Hope Chess:** "looking" for danger instead of systematically checking for it.
- **Hand-waving:** choosing a move on general principle without concrete analysis.
- **Assuming the opponent will play a particular unforced move.**
- **Time misallocation.**

Heisman's key claim is that amateurs lose more often by making *unsafe moves* than by missing their own tactics. Aagaard's three questions (weaknesses, worst piece, opponent's idea) are a positional thinking aid for much stronger players. They are not an error taxonomy for beginners.

### Cited Findings
- **[Opinion/Evidence] Heisman's taxonomy:**
  - **Flip Coin Chess:** raw beginners barely track the opponent's moves and miss easy threats.
  - **Basic Hope Chess:** "consistently making moves without analyzing the opponent's possible forcing replies" (checks, captures, threats). He links it to advanced beginners and some lower intermediates.
  - **Passive Hope Chess:** the player believes they are checking but only scans for familiar patterns, and concludes a move is safe if everything "looked" safe. He places it at about 1200–1700.
  - **Real Chess:** consistently checking every candidate move for safety. Heisman says Real Chess alone won't make you strong, but Hope Chess will keep you from improving.
  - Sources: [Chess.com – Passive vs Basic Hope Chess](https://www.chess.com/article/view/passive-vs-basic-hope-chess); [Chess.com – Heisman](https://www.chess.com/blog/danheisman/checking-for-safety-requires-more-than-using-tactical-vision)
- **[Opinion] What decides amateur games:** most amateur (U2200) tactical mistakes come from the player's own unsafe moves. These are far more frequent than missing an easy offensive tactic, which usually requires the opponent to have made an unsafe move first. "Teaching them how to determine when their own moves are safe is just as important, or more." [Chess.com – Heisman](https://www.chess.com/blog/danheisman/checking-for-safety-requires-more-than-using-tactical-vision)
- **[Opinion] Tactical vision vs analysis:** tactical vision is "helpful and arguably necessary, but its clearly not sufficient"; "Your tactical vision should augment careful analysis." [Chess.com – Heisman](https://www.chess.com/blog/danheisman/checking-for-safety-requires-more-than-using-tactical-vision)
- **[Evidence, protocol-based] Other thinking errors in *The Improving Chess Thinker*:**
  - **"Hand-waving":** choosing a move on principle without concrete move-by-move analysis.
  - Assuming the opponent will make a particular unforced move.
  - Spending more time on unprofitable lines than on the move actually played.
  - Playing too fast or too slow.
  - Heisman also separates **tactical vision** (recognizing tactical patterns) from **board vision** (knowing where the pieces are and what they do).
  - Process basics: form an overall evaluation first, then look at captures, checks and threats.
  - The reviewer notes some of the lowest-rated players organized their thinking well, while some higher-rated players showed lower-level weaknesses. Rating and process quality are not perfectly coupled.
  - [ChessCafe review](https://chesscafe.com/book-reviews/the-improving-chess-thinker/)
- **[Secondary] Origin of the terms:** "Hope chess" vs "Real chess" comes from one of Heisman's first articles, "The Secrets to 'Real' Chess." [Lichess blog – TomEaton](https://lichess.org/@/TomEaton/blog/hope-chess/SxRLomNz). His book *Is Your Move Safe?* uses 150+ positions where moves look safe but aren't. [Mongoose Press](https://www.mongoosepress.com/catalog/books/move_safe.html)
- **[Secondary] A typical structured thought process (a "Chessplanner" document in the Heisman tradition):** threat scan → plan and candidate moves → analyze the consequences of each candidate → a "quick check for one-move disasters" (blunder check). Its stated purpose is to counter impulsivity. [Scribd – Chess Planner](https://www.scribd.com/doc/203244380/Chess-Planner). Low-reliability source; the fifth step was cut off in the source.
- **[Evidence] de Groot:** expert players consider a *smaller* number of candidate moves, in greater detail, than novices do. Stronger players differ mainly in pattern recognition ("many thousands of subtly different positions"), not in deeper calculation. Sources: [NYU master's thesis citing de Groot](https://www.cns.nyu.edu/malab/static/files/publications/2016%20Gianni%20Galbiati%20Masters%20thesis.pdf); [ChessCafe review](https://chesscafe.com/book-reviews/the-improving-chess-thinker/)
- **[Opinion] Aagaard's three questions (from *Positional Play*, Grandmaster Preparation series):**
  - The questions are "Where are the weaknesses?", "Which is the worst-placed piece?" and "What is the opponent's idea?" Wording varies slightly across summaries. Sources: [Chess.com blog – Aagaard's 3 questions](https://www.chess.com/blog/snits/jacob-aagaards-3-questions); [ChessChatter](https://chesschatter.substack.com/p/these-3-questions-will-help-you-play); [Quality Chess blog](https://blog.qualitychess.co.uk/?p=2646)
  - "Worst-placed piece" applies to both sides: improve your own worst piece, or keep the opponent's worst piece out of play. [Temposchlucker blog](https://temposchlucker.blogspot.com/2024/03/reshuffling-tree-of-scenarios.html)
  - A commenter argues that using the questions well takes real skill, and that a typical 1200 player may struggle to identify weaknesses. [ChessChatter comments](https://chesschatter.substack.com/p/these-3-questions-will-help-you-play/comments)
- **[Opinion] Belenkaya's CCA check:** before critical moves, check **C**hecks, **C**aptures and **A**ttacks, in that order. [Chess.com](https://www.chess.com/article/view/how-to-analyze-your-chess-games)

### Inferences
The table below maps each error to the skipped thinking step and a diagnostic question. I synthesized it from Heisman's categories; it is a design proposal, not a published taxonomy.

| Observed error (engine shows big eval drop) | Skipped step | Heisman label | Diagnostic question to ask first |
|---|---|---|---|
| Didn't respond to an opponent's direct threat | "What does the opponent's last move do?" | Flip Coin Chess / ignoring threats | "What was your opponent's last move trying to do?" |
| Own move hung a piece or allowed a fork or mate | Safety check of own candidate (CCT for opponent) | Basic Hope Chess | "After your move, what checks, captures or attacks did your opponent have?" |
| Student says "I looked and it seemed safe" | Systematic CCT; relied on a glance | Passive Hope Chess | "Walk me through each capture your opponent could make." |
| Played a "principled" move that fails tactically | Concrete analysis | Hand-waving | "What did you expect your opponent to do back?" |
| Line only worked if the opponent cooperated | Assumed an unforced reply | Assuming opponent's move | "What if they don't play that?" |
| Missed winning a free piece | Scan for opponent's loose pieces and own forcing moves | Missed opportunity (lower priority per Heisman) | "Were any of your opponent's pieces unprotected?" |
| Blunder in time trouble, or an instant move | Time allocation | Time management | "How long did you spend? Was it a moment to slow down?" |

- At ~500 Chess.com, the top two rows will dominate. The coach should show the student *why* the move was unsafe and anchor it in a repeatable habit: check every check, capture and threat before moving. It should not just say the move was bad.
- The "Knowledge vs thinking vs calculation vs evaluation" split is a useful frame. At 500, nearly all errors are "thinking process" (not looking) or "board vision" (not seeing what a piece attacks), not deep calculation or evaluation errors.
- Aagaard's three questions are too advanced as a *diagnostic* for 500. A simplified "worst piece" question ("Which of your pieces is doing nothing?") may still work for teaching development.

### Gaps
- I found no primary source for the specific Heisman phrases "Seeing the move but not playing it" or "reasonable vs real" mistakes. They may exist in his Novice Nook archive (chesscafe.com/author/danheisman) but weren't retrieved.
- I found no primary source for a formal four-way taxonomy (thinking / knowledge / calculation / evaluation errors) or for Dvoretsky's list of error types. Both are commonly referenced but unconfirmed here.
- Kotov's candidate-move / "tree of analysis" method wasn't retrieved.
- I found no data on the frequency of error types at Chess.com ~500 specifically. Heisman's claims concern "amateurs" and USCF class levels.

---

## 4. Explaining chess in human concepts, and what level suits a ~500 player

### Takeaway
Good explainers narrate *purpose* ("this knight heads to e5 because…") and principles rather than variations. Chernev's *Logical Chess: Move by Move* explains the reason for every move of 33 games and is pitched as the first book after the basics. Silman's imbalance books are rated intermediate-to-advanced: *The Amateur's Mind* is classed at about USCF 1300–1650 and *Reassess Your Chess* at 1650+. For a 500 player, the right concepts are piece safety, threats, development, king safety and simple piece activity. Pawn-structure plans (minority attack, isolated queen's pawn) and full imbalance analysis are too advanced.

### Cited Findings
- **[Secondary] Chernev:** *Logical Chess: Move by Move: Every Move Explained* covers 33 complete games and tells "the reason for every single move." One reviewer calls it the first book a player should read after learning the basics. Critics praise its lucid style. Other readers find the repetition tedious (re-explaining 1.e4) and call some principles "arbitrary." Sources: [McLeods Books listing](https://www.mcleodsbooks.co.nz/p/logical-chess-move-by-move); [New in Chess](https://newinchess.com/logical-chess-move-by-move); [Goodreads reviews](https://www.goodreads.com/book/show/40215160)
- **[Opinion] Heisman's level for Silman's books:** *The Amateur's Mind* is intermediate (USCF 1300–1650) and *Reassess Your Chess* is advanced (above USCF 1650). [Chess.com – review of The Amateur's Mind](https://www.chess.com/article/view/book-reveiw-the-amateurs-mind-turning-chess-misconceptions-into-chess-mastery-by-im-jeremy-silma)
- **[Opinion] Aagaard's positional questions** are hard for ~1200 players to apply (e.g., spotting weaknesses). [ChessChatter comments](https://chesschatter.substack.com/p/these-3-questions-will-help-you-play/comments)
- **[Evidence] AlphaZero learned human concepts:** McGrath et al. (PNAS 2022) found that human chess concepts (material, king safety, mobility and others, labeled using Stockfish's evaluation terms) can be linearly decoded from AlphaZero's network, even though it never saw human games. Material emerges early in training and declines in relative importance as concepts like king safety rise. The authors call their results "far from a complete understanding." Implication: engine strength does correlate with human-style concepts, so translating engine output into those concepts is not arbitrary. Sources: [PNAS/PMC – McGrath et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9704706); [arXiv 2111.09259](https://arxiv.org/abs/2111.09259v3); [ChessBase summary (mirror)](https://gwern.net/doc/www/en.chessbase.com/b8607948c97fe8c79e91a181aa86724277ee14d7.html)
- **[Evidence] Concept-guided LLM commentary (Kim et al. 2024, "Concept-guided Chess Commentary Generation and Evaluation"):**
  - Problem: expert-model outputs are accurate but hard for humans to interpret, while LLM commentary is fluent but prone to hallucination.
  - Method: compute concept scores before and after a move, prioritize the concepts that change most, and give the LLM (GPT-4o) the engine centipawn evals plus those prioritized concepts.
  - They also enumerate all existing attacks to prevent references to non-existent pieces or illegal moves.
  - Result: human judges and their automatic GCC-Eval metric rated the output more accurate, informative and fluent than GPT-4o alone or GPT-4o with engine evals.
  - [arXiv 2410.20811](https://arxiv.org/abs/2410.20811)
- **[Secondary/marketing] DecodeChess** is a commercial tool that turns Stockfish (NNUE) output into plain-language explanations. It covers threats, good moves, plans, "piece functionality" and tactical/strategic motifs, with a dedicated plans tab. I found no technical paper or independent evaluation. Sources: [DecodeChess FAQ](https://decodechess.com/?p=3409); [DecodeChess](https://decodechess.com/?p=3595)
- **[Evidence] Expert pattern recognition:** stronger players differ from weaker ones mainly by recognizing many thousands of positional patterns, not by calculating more. This argues for teaching recurring *patterns and concepts* rather than long variations. [ChessCafe review of Heisman / de Groot](https://chesscafe.com/book-reviews/the-improving-chess-thinker/)

### Inferences
- **Narration style to emulate (Chernev style):** one short sentence per move stating its *purpose* in plain words. Examples: "develops a piece toward the center," "attacks the undefended pawn," "gets the king to safety." Avoid long variations.
- **Concept ladder for a ~500 Chess.com adult** (my inference from the level classifications above; there is no source mapping concepts to Chess.com 500 directly):
  - **Core (use constantly):** hanging/undefended pieces; counting attackers vs defenders; checks, captures and threats (CCT/CCA); the opponent's threat; piece values and trades; basic mates (back rank, queen+king); forks, pins and skewers.
  - **Introduce (simple):** opening principles (develop knights and bishops, control the center, castle early, don't move the queen out too early or move the same piece twice without reason); king safety; "Which of your pieces is doing nothing?" (simplified worst piece); "active vs passive piece."
  - **Defer (too advanced):** Silman imbalances as a system; pawn-structure plans (minority attack, isolated pawn, hanging pawns); prophylaxis; "bad bishop" theory; space advantage; Steinitz/Nimzowitsch elements such as overprotection or blockade.
- **For the AI coach:** use Stockfish (and optionally engine-derived concept deltas, à la Kim et al. 2024) to pick *which* concept changed the most, then explain it in that concept's words. Never recite a principal variation (PV) to a 500 player. At most show 1–2 forcing moves that make the point visible, e.g., "If you play this, their bishop takes your knight for free."
- Hallucination risk is real (Kim et al.). Every factual claim the coach makes (e.g., "this piece is undefended," "this is a fork") should be verified against the engine and the board state. Their trick of enumerating all actual attacks is directly reusable.

### Gaps
- I didn't retrieve primary text from Silman (the imbalance list and his "thinking technique"), Seirawan (*Winning Chess* series), Nimzowitsch or Steinitz. From training knowledge only, *unverified this session*: Silman's *Reassess* method has the player list imbalances, pick a side of the board, imagine a "fantasy position," and only then calculate candidates.
- I didn't retrieve primary sources on how Levy Rozman or Daniel Naroditsky narrate speedrun games. Their narration style is undocumented here.
- I found no published mapping of chess concepts to Chess.com rapid ratings (e.g., 500). The level boundaries above are inferences from USCF-based book classifications.

---

## 5. The engine as a checker, not a teacher

### Takeaway
Coaches consistently treat the engine as a final verifier and "sparring partner":
- Analyze yourself first.
- Look only at large eval swings.
- Look for the *human idea* behind the engine's top 2–3 moves.
- Ask whether you could find the move over the board.
- Never read the eval bar or follow colored arrows passively.

Research supports the core concern. Strong engines are poor models of what humans play and understand, and human-aligned models (Maia, Maia-2) and skill-compatible agents exist precisely because of that gap.

### Cited Findings
- **[Opinion] Belenkaya's warnings:**
  - Don't copy engine moves without understanding them; doing so teaches you to imitate a machine.
  - Don't just read the eval bar, and interpret what a small number like +0.30 actually means.
  - An engine evaluation doesn't measure how playable a position is for a human under time pressure.
  - Passively watching arrows "isn't analysis. This is engine worship."
  - Recommended use: enter the lines you calculated in the game and check your judgment; explore the engine's top 2–3 moves and find the human idea behind each; ask "would I find this?"; ask the engine "why is this bad?"
  - [Chess.com](https://www.chess.com/article/view/how-to-analyze-your-chess-games)
- **[Opinion] Pruijssers:** focus on large evaluation swings. Small differences (about 0–0.5) may be subtle or may shift with deeper calculation, and automatic reviews are "often mistaken on subtle moves." [Chess.com – Pruijssers](https://www.chess.com/blog/GMRoelandPruijssers/how-to-analyze-your-own-chess-games-correctly)
- **[Secondary] Studer:** look only at ±2 swings, then work out what the engine is pointing to. [Substack](https://nickvasquezmd.substack.com/p/analyzing-our-games)
- **[Opinion] Blog advice:** try the position yourself first, hide the engine's variations, and compare your move with the engine's top choices to judge whether it is "a disastrous blunder or just another good move." Engines may treat two 0.00 moves as equal even when one is very hard for a human to find. [Zwischenzug – How to Talk to Engines](https://zwischenzug.substack.com/p/how-to-talk-to-engines)
- **[Evidence] Engines don't model humans (Maia, McIlroy-Young et al., KDD 2020):**
  - Existing engines, including an AlphaZero implementation (Leela), "do not predict human moves well."
  - Maia is Leela retrained on human games, with one model per rating band from 1100 to 1900. It reaches a top move-matching accuracy above 52%, and Maia 1900 predicts the exact move a 1900 human played more than half the time.
  - Even for "absolute howlers" (hanging a queen), Maia predicts the exact mistake more than 25% of the time.
  - Sources: [arXiv 2006.01855](https://arxiv.org/pdf/2006.01855); [Maia blog](https://maiachess.com/blog/introducing_maia)
- **[Evidence] Maia-2 (Tang et al., NeurIPS 2024):** a single skill-aware model across ratings that surpasses the original Maia by about 2 percentage points in move prediction. It is far more coherent across skill levels: it treats 27% of sampled positions monotonically across ratings, vs 1% for the original Maia. [arXiv 2409.20553](https://arxiv.org/pdf/2409.20553); [NeurIPS poster](https://nips.cc/virtual/2024/poster/94764)
- **[Evidence] Skill-compatible AI (Hamade et al., ICLR 2024):**
  - Engines that play near-optimal moves "prove to be inadequate partners" when weaker agents (modeled with Maia) must continue from the resulting positions.
  - Skill-compatible agents that steer toward positions a weaker partner can handle beat AlphaZero-based agents in collaborative frameworks, despite being weaker at conventional chess.
  - [arXiv 2405.05066](https://arxiv.org/abs/2405.05066)
- **[Evidence] Humans can learn from engine concepts, but with heavy curation (Schut et al., 2023; PNAS 2025):**
  - Novel concepts were extracted from AlphaZero's representations, filtered for "teachability" and novelty, and presented to four top grandmasters (current or former world champions) as puzzle prototypes.
  - All four improved on concept puzzles after the learning phase.
  - The authors frame this as a small-scale proof of concept.
  - Sources: [arXiv 2310.16410](https://arxiv.org/abs/2310.16410v1); [OATML Oxford](https://oatml.cs.ox.ac.uk/publications/202504_Schut_AZConcepts.html)
- **[Evidence] Engine output is accurate but hard to interpret:** this is the motivating problem of concept-guided commentary work. [Kim et al. 2024](https://arxiv.org/abs/2410.20811)

### Inferences
Engine-as-checker roles for the AI coach (synthesis):
1. **Pick the review moments:** the largest eval drops, with something like a ±2 threshold for a 500 player (Studer, Pruijssers).
2. **Fact-check every claim the coach makes:** hanging piece, threat, mate, whether the student's suggested move works.
3. **Validate the student's answers during Socratic questioning:** is their proposed move safe, and good enough?
4. **Pick the "human" better move:** prefer a simple, principled move near the top of the engine list over the engine's #1 when the eval gap is small. A Maia-style model at the student's rating can indicate which good moves are findable. This is an inference from Maia, Maia-2 and skill-compatibility research, not a tested coaching result.
5. **Never surface:** centipawn numbers, long principal variations, or "engine-only" moves (quiet, counterintuitive defensive resources) to a 500 player, unless as a one-line "a computer finds X, but the lesson here is Y."

Treat differences under ~0.5 as noise for coaching purposes; never call such a move a "mistake" to a beginner.

### Gaps
- I didn't retrieve primary quotes from Aagaard, Dvoretsky, Naroditsky or Rozman warning about engines ("engines make you lazy," "computer moves"). The search only surfaced secondhand Reddit recollections, which are excluded as unreliable.
- I found no user study measuring whether beginners learn more from engine-annotated review than from human-style concept explanations. The CCC paper evaluated commentary quality, not learning gains.
- Chess.com's and Lichess's own game-review classification schemes (Brilliant, Blunder, Miss, and so on) and their thresholds weren't researched.

---

## 6. Socratic questioning in coaching, and when to stop asking and just explain

### Takeaway
Chess coaching schools advocate question-based teaching, but I found no controlled chess study. The tutoring literature gives a concrete escalation ladder: **pump → hint → prompt → assertion**, from AutoTutor, and "frequent in human tutoring." It also warns, via the expertise-reversal effect, that novices learn better with more guidance and explicit explanation. For a 500 player: ask briefly, escalate quickly, and give the answer plainly after 1–2 failed attempts.

### Cited Findings
- **[Evidence/Design] AutoTutor's escalation (Graesser et al.):**
  - **Pump:** ask the student to propose the next step.
  - **Hint:** used only if the student fails to propose or execute a valid step. Hints are questions that lead toward the needed information.
  - **Prompt:** follows a failed hint and moves the student closer, without giving the answer away (e.g., asking for a single missing word).
  - **Assertion:** comes last and supplies the answer for the student to acknowledge.
  - This "expectation and misconception tailored" (EMT) dialogue compares student input against expected answer content.
  - The 2016 review notes these cycles "are frequent in human tutoring." Reported learning gains are about 0.3–0.8 SD vs reading controls; sources vary.
  - Sources: [arXiv 2402.09216 – AutoTutor meets LLMs](https://arxiv.org/pdf/2402.09216); AutoTutor-family review by Nye, Graesser & Hu in IJAIED. Search surfaced two IJAIED DOIs and I could not confirm which is the review: [DOI 10.1007/s40593-014-0029-5](https://www.doi.org/10.1007/S40593-014-0029-5); [DOI 10.1007/s40593-015-0086-4](https://link.springer.com/doi/10.1007/s40593-015-0086-4)
- **[Evidence/Design] LLM version of AutoTutor:** hints and prompts must not leak the answer, assertions must contain the answer, and the pump needs no LLM call. [arXiv 2402.09216](https://arxiv.org/pdf/2402.09216)
- **[Evidence] Expertise reversal effect:**
  - Rey & Buchwald (2011), 104 students: novices given additional explanatory text scored higher on retention and transfer, while the effect *reversed* for experts. The authors attribute this to cognitive load, not motivation. [PubMed 21443379](https://pubmed.ncbi.nlm.nih.gov/21443379/)
  - A related study found the reversal for transfer but not for retention. [Instructional Science 2012](https://dx.doi.org/10.1007/s11251-012-9237-2)
  - Exploratory (low-guidance) environments are "very cognitively demanding, especially for novice learners." This is from a Kalyuga review; the attribution to this TICL page comes from search and I did not fetch it. [TICL 2011](https://www.oldcitypublishing.com/journals/ticl-home/ticl-issue-contents/ticl-volume-9-number-1-2-2011/ticl-9-1-2-p-63-80/)
- **[Opinion/Promotional] Chess question-based teaching:**
  - A New York chess school says its coaches ask questions that make students notice what is happening in the position, rather than announcing the winning move. [US Chess Academy blog](https://www.uschessacademy.com/blog/question-based-chess-classes-nyc)
  - Chessity promotes questions over ready-made solutions. [Chessity blog](https://www.chessity.com/en/blog/546/Questions_that_help_you_think_the_secret_to_chess_success_)
  - Both are promotional, not evidence.
- **[Evidence] Diagnostic questioning reveals the process:** Heisman's think-aloud protocols show that asking a player to verbalize their search exposes process errors (hope chess, hand-waving) that the move alone hides. [ChessCafe review](https://chesscafe.com/book-reviews/the-improving-chess-thinker/)

### Inferences
Proposed "ask first, then explain" protocol for a 500 player (a design synthesis of the sources above):
1. **Diagnostic ask (one question):** "What was your opponent threatening here?" or "Why did you play this?" This step is cheap and gives the coach the student's thought process, which is the most valuable signal (Heisman).
2. **Pump:** "Look again. What could your opponent capture after your move?"
3. **Hint (focus attention):** "Look at your knight on c3. How many of their pieces attack it, and how many of yours defend it?"
4. **Prompt (near-answer):** "Their bishop can take something for free. Which piece?"
5. **Assertion (explain plainly):** state the answer, the concept, and the habit ("Before every move, check: can they capture anything for free?"). Then confirm understanding with a quick similar check.

**When to stop asking and explain** (inferred from expertise reversal and AutoTutor practice, not chess-tested):
- after 2 failed attempts;
- when the student signals frustration or says "just tell me";
- when the concept is new (never seen before), so there is nothing to retrieve, and a short worked explanation beats Socratic probing for novices;
- when the point needs calculation deeper than about 2 moves;
- when the session is already long (cognitive load).

Ask about the *student's own reasoning* (low load, high diagnostic value) more than about the *correct answer* (high load for novices). Limit to 1–3 critical moments per game, consistent with Pruijssers' 2–4 takeaways. Adults may prefer efficiency: offer a "show me" shortcut.

### Gaps
- I found no controlled study of Socratic vs direct-instruction chess coaching, and no chess-specific research on learner frustration thresholds.
- Not retrieved: VanLehn (2011) on human tutoring effect sizes; Koedinger & Aleven (2007) "assistance dilemma"; Chi's ICAP framework. These are likely relevant for calibrating when to give help.
- I found no source on adult vs child differences in tolerance for Socratic questioning in chess.
