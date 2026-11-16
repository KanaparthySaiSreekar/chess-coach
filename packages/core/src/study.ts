// Studies (feature I6) and their formats (J1; PLAN WP 8.1): a study is chapters, each an annotated
// game tree with comments, marks and drawings. Lichess exports a study as one PGN with a game per
// chapter; the same shape goes out again, so a study round-trips.

import type { Color } from './chess.ts';
import { exportPgn, importPgn } from './tree.ts';

export type StudyChapter = { name: string; orientation: Color; pgn: string };

/** A Lichess study link (or its bare id) → its id; a chapter link gives the study's id too. */
export function lichessStudyId(text: string): string | null {
  const m = /(?:lichess\.org\/study\/)?\b([A-Za-z0-9]{8})(?:\/[A-Za-z0-9]{8})?\b/.exec(text.trim());
  return /lichess\.org\/study\//.test(text) && m ? m[1]! : null;
}

/** The PGN of several games split into one text each (a blank line before each [Event]). */
function splitGames(text: string): string[] {
  return text
    .trim()
    .split(/\r?\n\s*\r?\n(?=\[Event\s)/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const header = (pgn: string, name: string): string | undefined => new RegExp(`^\\[${name}\\s+"([^"]*)"\\]`, 'm').exec(pgn)?.[1];

/**
 * A study's PGN → its name and chapters. A chapter's name is its ChapterName header, or the part of
 * the Event after "Study name: "; its side is the Orientation header (White when there is none).
 * A chapter that cannot be read is left out and named in `skipped`.
 */
export function chaptersFromPgn(text: string, fallbackName = 'Study'): { name: string; chapters: StudyChapter[]; skipped: string[] } {
  const chapters: StudyChapter[] = [];
  const skipped: string[] = [];
  let studyName: string | undefined;
  for (const [i, game] of splitGames(text).entries()) {
    const event = header(game, 'Event');
    const named = header(game, 'StudyName') ?? (event && event.includes(': ') ? event.slice(0, event.indexOf(': ')) : undefined);
    studyName ??= named;
    const chapterName = header(game, 'ChapterName') ?? (event && event.includes(': ') ? event.slice(event.indexOf(': ') + 2) : event) ?? `Chapter ${i + 1}`;
    const read = importPgn(game);
    if (!read.ok) {
      skipped.push(`${chapterName}: ${read.reason}`);
      continue;
    }
    const orientation = (header(game, 'Orientation') ?? '').toLowerCase() === 'black' ? 'black' : 'white';
    chapters.push({ name: chapterName, orientation, pgn: game });
  }
  return { name: studyName ?? fallbackName, chapters, skipped };
}

/** A study's chapters as one PGN, Lichess style: each chapter a game, its name in the Event and ChapterName headers. */
export function studyToPgn(name: string, chapters: StudyChapter[]): string {
  return chapters
    .map((c) => {
      const read = importPgn(c.pgn);
      if (!read.ok) return '';
      const { Event: _e, StudyName: _s, ChapterName: _c, Orientation: _o, ...rest } = read.tree.headers ?? {};
      read.tree.headers = rest;
      return exportPgn(read.tree, { Event: `${name}: ${c.name}`, StudyName: name, ChapterName: c.name, Orientation: c.orientation });
    })
    .filter(Boolean)
    .join('\n\n');
}
