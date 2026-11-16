#!/usr/bin/env bash
# Development aid: a fixed batch of questions for the live coach, for comparing models.
#   MODEL=haiku bash tools/coach-batch.sh
set -u
run() { MODEL=${MODEL:-haiku} SIDE=${SIDE:-white} node tools/coach-probe.mjs "$@" 2>&1 | grep -E "OWNER|COACH|SYSTEM|demo board|coach draws|no coach message" ; echo; }
echo "##### scholar's mate threat (owner is Black)"
SIDE=black run "e4 e5 Bc4 Nc6 Qh5" "what is white threatening?" "what if I play Nf6 to attack the queen?"
echo "##### legal's trap (owner is White)"
run "e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6" "can I take the pawn on e5? my knight is pinned to my queen" "but what if they take my queen?"
echo "##### italian, quiet (owner is White)"
run "e4 e5 Nf3 Nc6 Bc4 Bc5" "can I castle now, and is it a good idea?" "what's the plan here?" "what is a fork?"
echo "##### after hanging a knight (owner is White)"
run "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Ne6" "why was my last move bad?" "chip:show_me"
