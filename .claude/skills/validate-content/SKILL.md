---
name: validate-content
description: Build-time skill for a terminal session (not the live coach) - runs the content gates (V1-V7) over puzzles or a repertoire PGN and summarises, in plain words, what failed, why, and what the owner can do about it. Use when asked to check, validate or gate content.
---
# validate-content: run the gates and say what failed

**For:** puzzles (a JSON file or a stored item) and repertoires (a PGN for one side). Nothing the owner
studies from is used until it has passed its gates (CONTENT §1, §5). This skill runs them and reports.

## Steps

1. Pick the command:
   - puzzles: `npm run content:validate -- <file.json or id>` (`--save` keeps them);
   - a repertoire PGN: `npm run content:validate -- --repertoire <white|black> <file.pgn>` (`--save`
     keeps it as a repertoire in the app, where *Game → Review content…* shows it).
   Engine work and, for a repertoire, paced calls to the Lichess explorer: mains power, a few minutes.
2. Summarise the output for the owner, in this order:
   - how many items or lines passed, how many are in quarantine;
   - each quarantined one: the line or puzzle, the gate in words (legality, the engine's verdict,
     the words, what players at their level play, two moves for one position, the envelope, the second
     opinion), and the exact move or sentence the gate names;
   - the gaps V4 flagged (replies common at the owner's level with no answer): these are lines
     missing, not lines wrong;
   - what the owner can do: on *Game → Review content…*, fix a line from the board, drop it, or
     accept it with a note; approve the rest after the spot check.
3. Report the gates' words as they are. Don't add a chess judgement of your own to them, and don't
   call anything "fine" that a gate quarantined.

## Don't

- Don't put course or book material (`data/courses/`) through a command that saves outside `data/`,
  and never commit or publish it (a hard rule).
- Don't change a threshold to make something pass; a changed threshold is a decision for TRACKER,
  and re-validation (WP 8.11) runs over everything when one changes.
