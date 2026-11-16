# Landscape of Chess Training Apps and AI Chess Coaches: Teaching Quality (as of Nov 2026)

Scope note: researched 2026-11-13. Sources are a mix of primary help docs (Chess.com support, Aimchess, Noctie, Maia paper/GitHub), press (GamesBeat), vendor-authored comparison blogs (Chessvia, KingChess, Chessiverse; flagged), independent reviews and forums (labelled as user sentiment). Several primary pages (Lichess blog, maiachess.com, one Lichess blog post) returned 403/429 and could only be used via search summaries; those are flagged. Feature sets and prices change often, so check dates.

---

## 1. Chess.com: Game Review, Coach, Lessons, Puzzles, Insights: how they teach and what critics say

### Takeaway
Chess.com's Game Review is the most-used "teaching" surface. It grades every move with rating-adjusted labels from an Expected Points model, adds a Coach persona that now produces LLM-generated commentary (since late 2025), and offers a "Retry" loop at key moments. That is closer to "ask first" than raw engine output. Critics' main points: the labels and accuracy score are black-box and misleading for beginners, explanations lean on the immediate tactic, and every review is single-game with no memory across games.

### Cited Findings
**Move classifications (primary doc)**
- Classification V2 uses an **Expected Points Model**. It estimates winning chances "where 1.00 is always winning, 0.00 is always losing, and 0.50 is even" from the player's **rating and the engine evaluation**, and labels a move by expected points lost. — [Chess.com Help: How are moves classified?](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)
- Thresholds (expected points lost): Best 0.00; Excellent 0.00–0.02; Good 0.02–0.05; Inaccuracy 0.05–0.10; Mistake 0.10–0.20; Blunder 0.20–1.00. — [Chess.com Help](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)
- **Great** = moves "critical to the outcome of the game" (losing→equal, equal→winning, or the only good move), and they are "more generous for new players." **Brilliant** = "when you find a good piece sacrifice," on the conditions that you are not in a bad position afterwards and were not already completely winning. The sacrifice definition is also more generous for newer players. **Miss** = "when you fail to capitalize on your opponent's mistake," and the eval thresholds for winning/equal/losing vary by rating. No numeric rating bands are published. — [Chess.com Help](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)
- There are ten labels in total: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder. The quick game-over summary uses faster analysis, so labels (e.g. Brilliant) can change in the full review, and web vs app settings can give different labels for the same move. — [Chess.com Help: How does Game Review work?](https://support.chess.com/en/articles/8584089-how-does-game-review-work)

**Game Review flow and Coach (primary doc)**
- Game Review shows a game graph with a one-line Coach summary, plus an Accuracy score (0–100, "how accurately you played according to the engine's evaluations") and a per-game "Game Rating" estimate. The Coach can read feedback aloud. "Next" jumps between **key moves**. The first key move is usually the last book move, and its speech bubble shows the opening name, how often you've played it, your results, and a **suggested course**. — [Chess.com Help: Game Review](https://support.chess.com/en/articles/8584089-how-does-game-review-work)
- At mistakes, buttons reveal engine ideas ("Show Fork", "Show Lost Piece", "Show Checkmate", "Show Idea", "Best"). **Retry** replays the position so you can look for the best move. If you choose wrong, "the Coach will provide feedback on your selected move." Game Review also has a "Skills" points system and a "Show Course Recommendations" setting. — [Chess.com Help: Game Review](https://support.chess.com/en/articles/8584089-how-does-game-review-work)
- App doc: after tapping Retry you can request a **hint**. If your retry is also a blunder, the coach gives feedback to guide you. — [Chess.com Help: Game Review on the app](https://support.chess.com/en/articles/10328363-how-do-i-use-game-review-on-the-app) (via search summary)
- Free members get Accuracy, classifications and Self Analysis. "Unlimited Game Review and some advanced analysis features require a Premium membership," and Diamond adds deeper cloud engine options. — [Chess.com Help: Game Review](https://support.chess.com/en/articles/8584089-how-does-game-review-work). A 2026 third-party guide says Basic gets one full review a day — [Kingdom of Chess / search summary](https://kingdomofchess.com/blog/best-chess-coaching-platforms-with-ai-analysis). Chess.com's feature guide (search snippet) lists "Move Explanations" at 1/day for free members — [Chess.com features guide](https://www.chess.com/article/view/chesscom-features). Tier details have shifted over time.

**Coach personas and LLM generation**
- In Nov 2025 Chess.com launched celebrity coaches (Carlsen, Nakamura, Rozman, Rensch, Anna Cramling, the Botez sisters; "Coach David" is the default). Their avatars appear in Game Review, Puzzles, Lessons and **Play Coach**. Voices use ElevenLabs TTS/voice cloning with a dialogue tree for automated answers. The article states "The team reviews what the LLM produces for accuracy", and PM Gabe Jacobs: "We have internal review and feedback systems to keep the quality high." Chess.com's own chess tech analyzes each move to supply data to the coaching. — [GamesBeat, 4 Nov 2025](https://gamesbeat.com/chess-com-will-let-you-choose-your-ai-coach-based-on-celebrity-voices/)
- Third-party sources disagree on whether the Coach is scripted or LLM-driven. One calls it scripted; others call the explanations LLM-generated. — [search summary across 2026 comparison blogs](https://www.kingchess.io/blog/best-ai-chess-coach/). The GamesBeat piece above is the most direct evidence for LLM generation.

**Play Coach (live teaching while playing)**
- Plays "roughly your level", comments move by move, flags ideas and mistakes in real time, has a **Hint** button and **take-back** (a "branching training drill"), and offers four coach personas. Strengths: instant feedback before the position is lost, the take-back loop resembles a human coach, and it is less intimidating. Weaknesses: **no memory across games** (can't notice a recurring back-rank weakness "four times in thirty games"), **hint dependence is untracked**, **no prioritization** of which weakness costs the most rating, and it is "a feedback tool, not a curriculum." Basic gets 1 Coach game/month and unlimited needs Gold+. — [MyChessPlan review (2026; promotes its own paid plan, so a conflict of interest)](https://mychessplan.com/chesscom-play-coach-review-2026-adult-improvers-coach-audit/)
- Vendor comparison: Play Coach / Dr. Wolf are "one-way" (you can't push back with follow-up questions). Dr. Wolf is described as scripted and capped around 1300–1500 blitz. — [Chessvia blog, Sep 2026 (vendor-authored)](https://www.chessvia.ai/blog/best-ai-chess-coach)
- Dr. Wolf began as a standalone "friendly, patient and witty" coaching app for beginners/intermediates and later joined Chess.com. When you blunder it points out the error, "maybe offers up a pointer or two, and asks if you want to give it another shot." — [Chess.com News: Dr. Wolf joins Chess.com](https://www.chess.com/news/view/dr-wolf-joins-chess-com); [PopSci](https://www.popsci.com/technology/artificial-intelligence-chess-program/)

**Criticism of accuracy/labels for beginners**
- The accuracy formula is not public. It is described as a Chess.com trade secret based on "CAPS2". — [SayChess Substack](https://saychess.substack.com/p/what-chess-players-need-to-know-about-chesscoms-accuracy-score)
- User sentiment (forums): a move 0.1 pawns worse than the engine's top choice gets "confidently" labelled an inaccuracy, and "excellent"/"good" are "somewhat misleading terms because they aren't excellent or good moves, in the way the words are commonly used." — [Chess.com forum: "the accuracy rating on here is a joke"](https://www.chess.com/forum/view/general/the-accuracy-rating-on-here-is-a-joke). There are complaints that the per-game estimated rating is misleading because one game can't estimate a rating. — [Chess.com forum](https://www.chess.com/forum/view/general/how-is-the-estimated-elo-from-the-game-reviews-so-inaccurate). Other threads complain that one Miss costs a large share of accuracy — [forum: "1 miss means 73 accuracy"](https://www.chess.com/forum/view/game-analysis/game-review-1-miss-means-73-accuracy)
- Critique (via video summary, weak source): Game Review explanations focus on the immediate tactical implication (e.g. "attacks a piece") and overlook deeper strategic goals. It also questions accuracy scores for beginner moves that were logical for their level. — [Recapio summary of a GothamChess video](https://recapio.com/digest/how-by-gothamchess-1)
- A Lichess blog titled "Why engine accuracy isn't as useful as it seems, at least for sub-2000 players" exists (403 on fetch, content not verified). — [Lichess blog, TheCommandalorian](https://lichess.org/@/TheCommandalorian/blog/why-engine-accuracy-isnt-as-useful-as-it-seems-at-least-for-sub-2000-players/keTtDKGu)
- Reviewers say Game Review "lives and dies with that one game" (no cross-game memory), and one calls the commentary generic at lower ratings. — [search summary of 2026 comparison articles incl. KingChess](https://www.kingchess.io/blog/best-ai-chess-coach/); KingChess: convenient for quick checks but does not connect mistakes across games — [KingChess, Aug–Oct 2026 (vendor-authored)](https://www.kingchess.io/blog/best-ai-chess-coach/)

### Inferences
- The Expected-Points + rating-adjustment design shows that labels are meant to be motivational ("Great/Brilliant" made easier for beginners) as well as diagnostic. That mix of praise inflation and pass/fail thresholds is what beginners find confusing. A Socratic coach should prefer plain-language consequences ("this lost your knight") over labels, or explain what a label means in terms of winning chances.
- Retry plus hint plus feedback on wrong tries is the closest thing in the mainstream to "ask first, then explain". It is position-local, though, and its feedback comes from engine ideas (fork / lost piece / checkmate). It does not diagnose *why* the player missed it (e.g. didn't check the opponent's threats).
- Chess.com already links Game Review to courses ("suggested course" at the opening key move, course recommendations). That review → curriculum link is a pattern worth copying with better personalization.

### Gaps
- I did not fetch primary docs for Chess.com **Lessons**, **Puzzle Rush / rated puzzles**, or **Insights**, so their pedagogical mechanics (e.g. puzzle rating system, Insights metrics) are uncited here.
- No published numeric rating bands for how much "generosity" applies to Great/Brilliant/Miss.
- Could not confirm current free-tier limits authoritatively (one review/day vs other numbers). They have changed over time.
- No independent study of whether Game Review/Retry improves ratings.

---

## 2. Lichess: Learn from your mistakes, puzzle themes/dashboard, opening explorer (plus Learn, Practice, Studies)

### Takeaway
Lichess's "Learn from your mistakes" (LFYM) is the canonical free "ask first" feature. After computer analysis it walks you through your errors one at a time and asks you to find a better move, revealing the answer only on request. Its known weaknesses: it explains nothing about *why*, it covers only a subset of errors, and it works on one game at a time. The puzzle dashboard (themes, strengths/improvement areas) and the rating-bucketed opening explorer are strong level-adaptation primitives.

### Cited Findings
- LFYM: after you request computer analysis, a "Learn from your mistakes" button appears. It walks you through your mistakes, asks you to find a better move for each, and reveals the best move only if you ask. It works on imported games, and you can review the opponent's mistakes by flipping the board. — [Lichess blog: Learn from your mistakes (via search summary; page returned 403)](https://lichess.org/@/lichess/blog/learn-from-your-mistakes/WFvLpiQA)
- User reports (forum, labelled sentiment): selection is based on winning chances, not just centipawn loss. It does not include every inaccuracy/mistake/blunder (counts differ from the analysis summary). It requires prior analysis. Users say the engine tells you the better move **without explaining why**, and one suggests disabling suggestion arrows during the exercise. — [Lichess forum: how LFYM works](https://lichess.org/forum/lichess-feedback/how-works-learn-from-your-mistakes-because); [Lichess forum: LFYM](https://lichess.org/forum/game-analysis/learn-from-your-mistakes)
- Signals of demand for cross-game features: forum threads titled "love learn from your mistakes, can it be implemented to use all my games" and "personalized puzzles: turning game analysis into active growth". — [Lichess forum](https://lichess.org/forum/lichess-feedback/love-learn-from-your-mistakes-can-it-be-implemented-to-use-all-my-games); [Lichess forum](https://lichess.org/forum/lichess-feedback/personalized-puzzles--turning-game-analysis-into-active-growth)
- **Puzzle Dashboard**: aggregated puzzle performance globally and by tactical theme over a selectable time window. "Improvement Areas" shows the themes you perform worst at and lets you **replay just the puzzles you failed** in those categories. Strengths/weaknesses come with per-theme performance ratings, the radar chart shows up to 9 themes, and puzzle length isn't shown. — [Lichess blog: Puzzles' secret level](https://lichess.org/@/TotalNoob69/blog/did-you-know-lichess-can-do-this-puzzles-secret-level/IUdwFwph); [Lichess forum: puzzle dashboard](https://lichess.org/forum/general-chess-discussion/puzzle-dashboard-2); [Lila API docs (mintlify mirror)](https://mintlify.wiki/lichess-org/lila/api/puzzles/dashboard)
- **Opening explorer**: the Lichess-games database can be filtered by **rating bucket** (UI options 400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500) and by **speed** (ultraBullet…correspondence). — [Lichess opening page UI (via search)](https://fp.lichess.org/opening/Reti_Opening/Nf3_d5_c4_c6); [lila-openingexplorer GitHub](https://github.com/lichess-org/lila-openingexplorer). A **Personal Opening Explorer** shows a player's own move/result stats. — [Lichess blog: Personal Opening Explorer](https://lichess.org/blog/YXMPxxMAACEAy3g4/announcing-the-personal-opening-explorer)
- An analysis of how opening moves score across rating ranges shows that what "works" differs by rating band. — [Lichess blog jk_182](https://lichess.org/@/jk_182/blog/how-well-do-different-opening-moves-score-across-rating-ranges/JUtaqwSn) (title/topic only; not fetched)
- Vendor claim: Lichess offers free Stockfish 18 server analysis (~40 games/day), but it "shows the evaluation and move but explains little of the reasoning." — [Chessvia blog (vendor-authored)](https://www.chessvia.ai/blog/best-ai-chess-coach). KingChess: Lichess "leaves pattern-finding and follow-up to the user." — [KingChess (vendor-authored)](https://www.kingchess.io/blog/best-ai-chess-coach/)

### Inferences
- LFYM's "you can do better — try again — reveal only on request" loop maps almost exactly onto the user's desired Socratic pattern. What's missing is the explanation layer and a diagnosis of the thinking error. A new coach can copy the loop and add graded hints (question → nudge → concept → move) before any engine line.
- Opening explorer at the 400–1200 buckets lets a coach show "what players at your level actually play" and prepare against the opponent's real replies, rather than master theory.
- The Puzzle Dashboard's theme-level weakness tracking plus "replay failed puzzles" is a ready model for "puzzles from own mistakes", but Lichess does not link it to the player's *games*.

### Gaps
- Could not fetch the official LFYM blog (403), so exact selection thresholds and the post date are not verified (search results suggest a ~2016 origin).
- Did not research Lichess **Learn** (rules/basics tutorial), **Practice** (endgame/checkmate practice vs. the engine), or **Studies** (interactive chapters, which can include "guess the move" interactive lessons) from primary sources. These are uncited here.
- Lichess puzzle rating system (Glicko-2) not verified from a primary source in this session.

---

## 3. Chessable MoveTrainer: spaced repetition for repertoires and courses

### Takeaway
MoveTrainer quizzes you on course moves at expanding intervals (wrong answers come back sooner). It is effective for memorising lines, but serious users and coaches repeatedly criticise it for review-debt overload, memorising without understanding, and poor handling of persistently difficult moves. Chessable is now part of Chess.com, whose help centre hosts its support docs.

### Cited Findings
- Chess.com's help centre hosts Chessable support ("When will the variations be ready for my review?": "MoveTrainer® uses spaced repetition to help you learn effectively"). The visible text did not give interval rules. — [Chess.com Help (Chessable)](https://support.chess.com/en/articles/10319267-when-will-the-variations-be-ready-for-my-review)
- Chessable 3.0 announcement: "Customized puzzles, streamlined opening training", and PRO lets you "track difficult moves you have trouble remembering." — [Chess.com News: Announcing Chessable 3.0](https://www.chess.com/news/view/announcing-chessable-3)
- Schedule behaviour (user/blog): wrong cards are reviewed more often, and as the deck grows, old cards come up less often. Each correct review delays the next one further. — [Zwischenzug: spaced repetition](https://zwischenzug.substack.com/p/spaced-repetition); [Lichess forum: chessable](https://lichess.org/forum/general-chess-discussion/chessable-2)
- A developer of a rival tool (Reddit, sentiment) claims Chessable "just asks you again right away" after a miss, so difficult moves "take a really really long time to drill in" because you can keep failing them daily, unlike Anki, where a missed card goes to the back of the stack. — [r/chess thread (mirror)](https://lr.sudovanilla.org/r/chess/comments/vw5uie/i_made_a_website_to_help_you_create_and_memorize)
- Workload: it is "difficult and time consuming to cover a lot of ground in MoveTrainer without getting way behind in the review prompts." — [Chess.com forum: MoveTrainer vs video series](https://www.chess.com/forum/view/chess-openings/learning-with-movetrainer-vs-a-video-series)
- Misuse critique: many players "do not use the spaced repetition tool correctly and waste their time and (potentially) money". Recommended all-or-nothing: either commit to memorising a variation or don't enter it into SRS at all. — [Lichess blog: How to use Chessable when studying openings](https://bn.lichess.org/@/mainsequence/blog/how-to-use-chessable-when-studying-openings/o1tKSyfA)
- "Doing something once" vs "knowing it": a blogger who quit online opening trainers argues they confuse the two. — [Smithy blog, Jan 2024](https://smithyq.blogspot.com/2024/01/why-i-stopped-using-online-opening.html). Coach Junta Ikeda lists "10 pitfalls" of learning openings on Chessable (not fetched). — [Juntaikeda Substack](https://juntaikeda.substack.com/p/3-lifetime-repertoires-the-10-pitfalls)
- "Some parts of chess work well with spaced repetition and others don't." SRS is seen either as the key to learning everything or as "a crutch that leads to shallow understanding." — [Zwischenzug: how to use Chessable](https://zwischenzug.substack.com/p/how-to-use-chessable); [search summary](https://chessentials.com/chessable-honest-review/)
- A third-party review notes configurable schedule options and a default 60 s think time. — [Chessentials honest review (via search summary)](https://chessentials.com/chessable-honest-review/)

### Inferences
- For a 500-rated adult, line-memorisation drills should be short (few moves deep) and paired with "why" prompts (what does this move threaten/prevent?), so drilling tests understanding and not just recall. That directly addresses the main criticism.
- A better difficult-move policy (e.g. re-queue within session, then shorter interval, plus a concept explanation after N failures) is an easy differentiator, since Chessable's handling draws complaints.
- Drilling against *the moves opponents at your rating actually play* (via the Lichess explorer buckets, or Noctie-style opponent replies) keeps repertoires small and relevant.

### Gaps
- **No official documentation found for "Quick mode"** or the "short & sweet" course versions. Could not confirm their current behaviour.
- **Exact MoveTrainer intervals unconfirmed.** Search summaries mentioned a third-party guide claiming roughly 4 h → 1 day → 3 days → 1 week, but I could not tie it to a specific verifiable page or to current Chessable behaviour.
- Whether Chessable's algorithm is SM-2-derived (a community claim) is unverified.

---

## 4. AI coaches and explainers: Aimchess, DecodeChess, Noctie, Chessvia, Chessiverse/Maia, Dr. Wolf, LLM coaches

### Takeaway
The market splits into (a) **analytics from your games** (Aimchess), (b) **natural-language explainers** (DecodeChess, Chessvia, Chess.com Coach), (c) **human-like sparring bots** (Maia, Chessiverse, Noctie), and (d) **LLM + engine "coaches"** (many 2025–26 startups and open-source projects). None combines Socratic dialogue, cross-game memory, and an adaptive curriculum well. LLMs alone hallucinate pieces, moves and evaluations. The consensus design is "engine computes the truth, LLM only phrases it, plus automated verification."

### Cited Findings
**Aimchess (analytics + personalised drills; primary page)**
- Scores your recent games in six areas: tactics, endgame, advantage capitalization, resourcefulness, time management, opening performance. It compares you with players at your rating and looks at games in aggregate rather than move by move. Drills built from your games: **Advantage Capitalization Trainer** (positions from games you lost after a big advantage), **Blunder Preventer** (pick which of two moves is a blunder), **Retry Mistakes**, **Opening Improver**, visualization, plus Intuition Trainer, Defender, Time Trainer, Blindfold Tactics, Checkmate Patterns. There is a **weekly personalised study plan**. Free: one 40-game report/month, one daily training session. Premium $7.99/mo or $57.99/yr (last 1,000 games, coach data-sharing, multi-account incl. Lichess). The footer shows "Copyright © 2021 Coachevnik" (page may be stale). — [aimchess.com](https://aimchess.com/)
- Critique: "reports rather than a conversational coach", with only partial explanations. — [Chessvia blog (vendor)](https://www.chessvia.ai/blog/best-ai-chess-coach). Vendor claims Chess.com owns Aimchess (not independently verified here). — [Chessvia blog](https://www.chessvia.ai/blog/best-ai-chess-coach)

**DecodeChess (explainer)**
- Sits on Stockfish NNUE and explains moves in plain language, aimed at players up to ~2000. Some find it intimidating, so it suits analytical learners more than absolute beginners. 1 decode/day free. — [search summary of aitoolsbakery / chessvia comparisons](https://aitoolsbakery.com/blog/best-ai-chess-coach-apps/)
- Structured written breakdowns (Threats, Plans, Concepts). Unlimited $8.25/mo or $84/yr. Weaknesses: text-only, **no follow-up dialogue, no persistent memory**, and "visible development has been quiet since about 2023." — [Chessvia blog, Sep 2026 (vendor)](https://www.chessvia.ai/blog/best-ai-chess-coach)

**Noctie (human-like sparring + training; primary page)**
- 25 levels (~400–2800), human-style openings, mistakes and move timing, trained on human games. It offers a rating test, an opening trainer against typical human replies (or your imported repertoire), **puzzles generated from your mistakes after each game with spaced repetition**, endgame/positional lessons, and takeback + hint after mistakes. Every move gets a colour-coded grade (Excellent … Blunder) "judged the way a human would, not an engine." €14/mo or €96/yr. — [noctie.ai](https://noctie.ai/)
- Critique: it flags bad moves and shows what went wrong but **"leaves the reasoning to you"**, with no voice and no back-and-forth. — [Chessvia blog (vendor)](https://www.chessvia.ai/blog/best-ai-chess-coach). It "won't replace … the tailored wisdom of a Grandmaster coach". It is a sparring partner more than a full coach. — [Declom review](https://declom.com/noctie.ai/); [Chesscore review](https://chesscore.io/blog/noctie-ai-chess-review)

**Chessvia (LLM chat coach; vendor self-description)**
- Real-time in-game text coaching, plus follow-up questions about your imported Chess.com/Lichess games. Answers are "grounded in a Stockfish evaluation of the actual position" (LLM not named). Two-way voice and **persistent memory are early access, not shipped**. $7–19/mo. — [Chessvia blog, 7 Sep 2026 (vendor-authored)](https://www.chessvia.ai/blog/best-ai-chess-coach)

**Maia / Maia-2 / Maia-3 (human-like models)**
- Maia-2 (NeurIPS 2024, U. Toronto CSSLab) is a single model for all skill levels. It uses "skill-aware attention" that combines player strength with the position, and it is the most accurate human-move predictor, ~2 pp better than the original Maia. — [arXiv 2409.20553](https://arxiv.org/html/2409.20553v2); [NeurIPS 2024 poster page](https://neurips.cc/virtual/2024/poster/94764)
- The GitHub repo recommends **Maia-3 for new projects**. Maia-2 is MIT-licensed and conditioned on both players' rating categories, "not a calibrated estimate of an individual player's strength." — [CSSLab/maia2 GitHub](https://github.com/CSSLab/maia2)
- Maia is "a human-like sparring partner, not a coach." — [KingChess (vendor)](https://www.kingchess.io/blog/best-ai-chess-coach/)

**Chessiverse (human-like bot zoo)**
- 600+ human-like bots of particular strengths and styles as of Nov 2025 — [Chess.com blog review by vitualis](https://www.chess.com/blog/vitualis/chessiverse-review-amazing-600-human-like-chess-ai-bots). The company claims 1,000+ bots in 2026, "Bots 4.0" rebuilt on Maia2, and PersonaPlay archetypes (Hunter, Guardian, Savage, Observer, Mediator). Pricing claims conflict ($9.99/mo vs "free"). — [Chessiverse press release](https://www.thailand-business-news.com/pr-news/chessiverse-releases-bots-4-0-a-complete-rebuild-on-maia2-neural-networks-delivering-the-most-human-like-chess-ai-yet); [Chessiverse PersonaPlay](https://chessiverse.com/personaplay); [Chessiverse compare page (self-published)](https://chessiverse.com/compare/best-chess-bots-online)

**LLM-based coaches and hallucination**
- ThinkFish (GPT-4o + Stockfish experiment): giving FEN before/after each move reduced hallucinations, but the model still invented "a knight on c6 that wasn't there." — [GitHub: ronaldsuwandi/thinkfish](https://github.com/ronaldsuwandi/thinkfish)
- Builder of a Stockfish + Claude + ElevenLabs coach: even with engine facts and a tool, the model "sometimes named moves that existed nowhere." The fix was **automated checks** for invented moves and lines that don't match the board. — [DEV: Stockfish calculates, Claude explains](https://dev.to/daniel_34e6cb821/how-i-built-a-virtual-chess-coach-stockfish-calculates-claude-explains-elevenlabs-speaks-2a0n)
- Open-source pattern: "finds your biggest mistakes in Chess.com games with Stockfish, then explains them using an LLM grounded in verified engine facts, with an automatic accuracy check." — [GitHub: alishaifthikhar/chess-coach](https://github.com/alishaifthikhar/chess-coach). An MCP coach does "personal weakness diagnosis and drills from your own blunders" with Lichess/Chess.com import. — [GitHub: chess-coach-mcp](https://github.com/parkseokjune/chess-coach-mcp). A coach with a "tilt detector that links frustration to mistakes". — [GitHub: aya31aidi/Chess-Coach](https://github.com/aya31aidi/Chess-Coach). A local-LLM coach is "told not to invent moves" and shows the user exactly what the model received (no error rates reported). — [DEV: offline coach](https://dev.to/shaurya_srivastava_027f4e/i-built-my-friend-a-free-offline-chess-coach-with-stockfish-and-a-local-llm-5a3h)
- "Slop" critique: LLMs are "spectacular at sounding like a chess coach and terrible at being one", with "the words … generated first and checked never". Examples: illegal moves, invented variations, praising "strong positional play" while down a rook, invented evaluations. Criteria for a good coach: truth computed first by engine + the user's games and only phrased by AI; every piece of advice shows its move/line/position; recurring mistakes are tracked and drilled across games. — [KingChess, 25 Aug 2026, updated 31 Oct 2026 (vendor-authored)](https://www.kingchess.io/blog/best-ai-chess-coach/)
- KingChess cites a Sept 2026 study in which the best general chatbot rated ~1,325 against weakened Stockfish, and some models attempted 5+ illegal moves per game. — [KingChess (secondary; primary study not verified)](https://www.kingchess.io/blog/best-ai-chess-coach/)
- A 2025 user report says a general chatbot hallucinated a diagnosis of why the user was losing games. — [Nick Vasquez Substack: The Peril and Promise](https://nickvasquezmd.substack.com/p/the-peril-and-promise) (excerpt truncated; claim incomplete)

### Inferences
- The defensible architecture for the user's coach: (1) Stockfish/engine (plus Maia for "what would a 500 play / what did you likely consider") computes facts; (2) the LLM gets only verified facts (FEN, legal moves, engine deltas, threats, material) and phrases Socratic questions; (3) a validator rejects any SAN/square/piece not legal or not present before display. Every serious builder converged on this.
- Maia is especially valuable for *pedagogy*, not just sparring: it can estimate which mistakes are "typical at 500" vs idiosyncratic, and which correct move is "findable" at the learner's level. That supports the user's rejection of deep engine lines.
- Noctie (puzzles from your mistakes + SRS + human-judged grades) and Aimchess (cross-game skill areas + weekly plan) each hold one piece of the desired product. Neither is conversational or Socratic.

### Gaps
- No independent, systematic evaluation of explanation accuracy for DecodeChess, Chess.com Coach, or Chessvia.
- Could not fetch maiachess.com (429), so current site features (e.g. any training/analysis UI on Maia-3) are unverified.
- No primary source found for "Coach Chester" or "ChessGPT" products mentioned in passing by comparison blogs. No review of "Chess Coach" custom GPTs specifically.
- Dr. Wolf's current status (standalone app still maintained vs folded into Play Coach) is unclear.

---

## 5. How products adapt to the learner's level

### Takeaway
Adaptation is mostly **rating-conditioned scoring** (Chess.com labels), **rating-matched opponents** (Maia/Noctie/Chessiverse/Play Coach), **rating-bucketed data** (Lichess explorer, Aimchess peer comparison) and **theme-level weakness tracking** (Lichess puzzle dashboard). No product adapts the *teaching style or curriculum sequence* to a diagnosed thinking weakness.

### Cited Findings
- Chess.com labels depend on rating: the expected-points model uses the player's rating, Great/Brilliant are "more generous for new players", and Miss thresholds vary by rating. — [Chess.com Help](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)
- Maia-2 conditions move prediction on skill level via skill-aware attention, one model for all levels. — [arXiv 2409.20553](https://arxiv.org/html/2409.20553v2). It is conditioned on rating categories, not calibrated to an individual. — [CSSLab/maia2](https://github.com/CSSLab/maia2)
- Noctie: 25 levels (~400–2800) plus a rating test. — [noctie.ai](https://noctie.ai/). Chess.com Play Coach plays "roughly your level". — [MyChessPlan](https://mychessplan.com/chesscom-play-coach-review-2026-adult-improvers-coach-audit/). In the GamesBeat description, players adjust the coach's strength. — [GamesBeat](https://gamesbeat.com/chess-com-will-let-you-choose-your-ai-coach-based-on-celebrity-voices/)
- Lichess explorer rating buckets 400–2500 and speed filters. — [Lichess opening page UI](https://fp.lichess.org/opening/Reti_Opening/Nf3_d5_c4_c6); [lila-openingexplorer](https://github.com/lichess-org/lila-openingexplorer)
- Aimchess compares your metrics with same-rated players. — [aimchess.com](https://aimchess.com/)
- Lichess Puzzle Dashboard surfaces worst themes ("Improvement Areas") with per-theme performance ratings and replay of failed puzzles. — [Lichess blog: Puzzles' secret level](https://lichess.org/@/TotalNoob69/blog/did-you-know-lichess-can-do-this-puzzles-secret-level/IUdwFwph)
- Chessable adapts review frequency to correctness (wrong → sooner). — [Zwischenzug](https://zwischenzug.substack.com/p/spaced-repetition)

### Inferences
- For a ~500 learner the useful adaptation signals are: puzzle theme performance, the frequency of specific error types across their own games, and Maia-predicted "findability" of the correct move. Rating alone is too coarse.
- Rating-generous praise (Chess.com) may help motivation but blurs diagnosis. A coach can separate "encouragement" from "assessment" explicitly.

### Gaps
- Didn't verify the Chess.com/Lichess puzzle rating systems (Glicko variants) or how puzzle difficulty is chosen, from primary docs.
- No evidence found on whether rating-matched human-like bots improve learning faster than standard engines at reduced strength.

---

## 6. Gamification and habit features: learning vs engagement

### Takeaway
Rigorous evidence is thin. The best causal study (a large RCT on an online maths platform in Peru, Dec 2025) found that highlighting streaks **raised usage and modestly raised test scores** (0.13–0.17 SD among test-takers). Most other "evidence" concerns engagement/retention, not learning, and Khan Academy retired streaks over motivation concerns.

### Cited Findings
- Aulagnon, Cristia, Cueto & Malamud, "Streaks to Success?": an RCT targeting ~60,000 students on the Conecta Ideas maths platform (weekly 30 exercises). Highlighting streaks increased platform use, being more effective on the intensive margin (frequency), while personalised reminders did better on the extensive margin. Published in *Economics of Education Review*, Dec 2025. — [NBER w34173](https://www.nber.org/papers/w34173); [GRADE](https://grade.org.pe/en/publicaciones/streaks-to-success-the-effects-of-highlighting-streaks-on-student-effort-and-learning/)
- Learning effect: endline test scores rose by 0.13–0.17 SD (among students who took the endline test), and differences vs other treatment arms were not significant. — [IDB Research Insights](https://publications.iadb.org/publications/english/document/Research-Insights-How-Can-Behavioral-Nudges-Be-Leveraged-to-Boost-Student-Effort-and-Achievement.pdf); [NBER](https://www.nber.org/papers/w34173)
- The same paper notes **Khan Academy retired its streak feature** over worries it could hurt motivation in some circumstances, and that causal evidence on streaks is limited. — [Northwestern IPR WP-26-05 (draft)](https://www.ipr.northwestern.edu/our-work/working-papers/2026/wp-26-05.html)
- A 2018 conference study (secondary summary) found streaks beat badges for making learning a regular activity, while badges gave a one-time boost. — [Intellum: Badges or Streaks](https://employees.intellum.com/student/page/902688-badges-or-streaks-which-one-is-more-impactful)
- Critical commentary: a "streak plateau" of high-frequency, low-depth engagement. — [UX case study](https://jiwonvyoo.github.io/portfolio/case/duolingo/duo.html). Engagement metrics are "partially aligned with learning outcomes but diverge significantly at the edges." — [DEV Community](https://dev.to/pocket_linguist/why-duolingos-gamification-works-and-when-it-doesnt-1d4) (opinion)
- In chess specifically, Game Review has a "Skills" points system that can be hidden. — [Chess.com Help](https://support.chess.com/en/articles/8584089-how-does-game-review-work). Chessable review debt is a known demotivator. — [Chess.com forum](https://www.chess.com/forum/view/chess-openings/learning-with-movetrainer-vs-a-video-series)

### Inferences
- A daily streak tied to a *meaningful* minimum unit (e.g. one "own-mistake" puzzle solved with explanation, or one game reviewed Socratically) is supported by the evidence. Gamifying volume (puzzle counts, rush scores) risks the high-frequency/low-depth pattern.
- An SRS backlog cap or "debt forgiveness" avoids the Chessable overload failure mode.

### Gaps
- No chess-specific study found on whether streaks, Puzzle Rush, leagues, or badges improve rating or skill.
- Did not research Chess.com leagues/Puzzle Rush engagement data.

---

## 7. Gaps no current product fills for an adult beginner wanting a real coach

### Takeaway
Across reviewers (including vendors critiquing rivals), the consistent gaps are: **memory across games**, **prioritisation** of the costliest weakness, **diagnosis of the thinking process** (why the move was missed, not just which move was better), **two-way Socratic dialogue grounded in verified facts**, and **an adaptive curriculum** that connects reviews, puzzles, openings and lessons. Partial solutions exist piecemeal (Aimchess cross-game stats, Noctie mistake-puzzles with SRS, LFYM ask-first loop, Chess.com review→course links), but nothing integrates them.

### Cited Findings
- Play Coach/Game Review: no cross-game memory, no prioritisation, untracked hint dependence, "a feedback tool, not a curriculum." — [MyChessPlan](https://mychessplan.com/chesscom-play-coach-review-2026-adult-improvers-coach-audit/)
- Single-game review "lives and dies with that one game", and the commentary is generic at lower ratings. — [KingChess (vendor)](https://www.kingchess.io/blog/best-ai-chess-coach/)
- LFYM gives the better move "without explaining why". — [Lichess forum](https://lichess.org/forum/lichess-feedback/how-works-learn-from-your-mistakes-because)
- DecodeChess has no follow-up dialogue or memory. Noctie leaves the reasoning to you. Aimchess gives reports, not conversation. Chessvia's persistent memory and two-way voice are not shipped. — [Chessvia blog (vendor)](https://www.chessvia.ai/blog/best-ai-chess-coach)
- Chess.com explanations focus on the immediate tactic and miss strategic goals. — [Recapio/GothamChess summary (weak)](https://recapio.com/digest/how-by-gothamchess-1)
- Spaced repetition risks shallow, memorised-not-understood repertoires. — [Zwischenzug](https://zwischenzug.substack.com/p/how-to-use-chessable); [Smithy blog](https://smithyq.blogspot.com/2024/01/why-i-stopped-using-online-opening.html)
- LLM coaches hallucinate without engine grounding plus verification. — [ThinkFish](https://github.com/ronaldsuwandi/thinkfish); [DEV Claude coach](https://dev.to/daniel_34e6cb821/how-i-built-a-virtual-chess-coach-stockfish-calculates-claude-explains-elevenlabs-speaks-2a0n)
- User demand for LFYM across *all* games and for personalised puzzles from analysis. — [Lichess forum](https://lichess.org/forum/lichess-feedback/love-learn-from-your-mistakes-can-it-be-implemented-to-use-all-my-games); [Lichess forum](https://lichess.org/forum/lichess-feedback/personalized-puzzles--turning-game-analysis-into-active-growth)

### Inferences
- **Opportunity map for the user's coach:** (1) Ask-first review modelled on LFYM/Retry, with graded Socratic hints and *no engine lines unless requested*. (2) A thought-process diagnosis taxonomy (e.g. "didn't check opponent's checks/captures/threats", "hung piece after move", "missed own tactic", "time trouble") applied across all imported games, with frequency counts → the costliest habit first. (3) Mistake positions → personal puzzle deck with SRS (Noctie/Aimchess pattern) that tests *concepts* (asks "what's the threat?" before "find the move"). (4) Small repertoire drilled against moves 400–1200 players actually play (Lichess explorer buckets / Maia), with "why" questions per move. (5) A curriculum that sequences lessons from the diagnosed weaknesses and re-checks them in new games. (6) LLM restricted to phrasing verified facts, with a move/square validator.
- "Ask first" requires tracking hint usage. Hint dependence is a named, untracked risk in Play Coach, so the coach should log how much help each solve needed and fold that into SRS scheduling.
- Beginner-friendly feedback should translate engine deltas into consequences ("you lose the bishop in 2 moves") and principles, and avoid accuracy percentages and fine-grained labels that critics call misleading.

### Gaps
- No product found that explicitly diagnoses thought process (blunder-check habits, candidate-move discipline). This is a gap in the market, but also a gap in evidence about how well it can be automated.
- No independent learning-outcome studies (rating gains) for any AI coach product. All claims of effectiveness are vendor or anecdotal.
- Titled-coach critiques of these apps were mostly unavailable in fetchable form. Most critique here comes from vendor blogs, forums, and one adult-improver review site.
