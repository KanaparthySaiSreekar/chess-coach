// Studies (feature I6; PLAN WP 8.1): the owner's annotated lines in chapters, and studies imported
// from a PGN or a Lichess study link. A chapter opens on the analysis board; the board, with its
// comments, marks and drawings, is saved back into it, or added as a new chapter.

import { chaptersFromPgn, lichessStudyId, studyToPgn, type Color, type StudiesView } from '@chess-coach/core';
import type { Db } from './db.ts';
import { lichessStudyPgn, realHttp, type Http } from './importers.ts';

export type StudyOptions = {
  db: Db;
  http?: Http;
  /** the owner's Lichess token, for a private study */
  token?: () => string | undefined;
  onChange: () => void;
};

export class StudyService {
  /** the chapter on the analysis board, while it is */
  private openChapter: { study: number; chapter: number } | null = null;
  private readonly o: StudyOptions;

  constructor(o: StudyOptions) {
    this.o = o;
  }

  view(): StudiesView {
    return { studies: this.o.db.studies(), ...(this.openChapter ? { open: this.openChapter } : {}) };
  }

  /** A PGN of one or more chapters, or a Lichess study link: a new study. */
  async importText(text: string): Promise<{ ok: true; study: number; chapters: number; skipped: string[] } | { ok: false; reason: string }> {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, reason: 'Paste a PGN, or a link to a Lichess study.' };
    const id = lichessStudyId(trimmed);
    let pgn = trimmed;
    let source = 'pgn';
    if (id) {
      try {
        pgn = await lichessStudyPgn(this.o.http ?? realHttp, id, this.o.token?.());
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
      source = `https://lichess.org/study/${id}`;
    }
    const read = chaptersFromPgn(pgn, 'My study');
    if (!read.chapters.length) return { ok: false, reason: read.skipped[0] ?? 'No chapter could be read from that.' };
    const study = this.o.db.addStudy(read.name, source);
    for (const c of read.chapters) this.o.db.addChapter(study, c);
    this.o.db.logEvent('study_import', { study, chapters: read.chapters.length, skipped: read.skipped.length, source: id ? 'lichess' : 'pgn' });
    this.o.onChange();
    return { ok: true, study, chapters: read.chapters.length, skipped: read.skipped };
  }

  /** A chapter to put on the board: it stays the open one until the board loads something else. */
  open(chapterId: number): { pgn: string; orientation: Color; name: string } | undefined {
    const c = this.o.db.chapter(chapterId);
    if (!c) return undefined;
    this.openChapter = { study: c.studyId, chapter: c.id };
    this.o.onChange();
    return { pgn: c.pgn, orientation: c.orientation, name: c.name };
  }

  /** The board, saved back into the chapter it came from. */
  saveOpen(pgn: string): boolean {
    if (!this.openChapter) return false;
    this.o.db.saveChapter(this.openChapter.chapter, pgn);
    this.o.onChange();
    return true;
  }

  /** The board as a new chapter: of the study given, or of a new study by that name. It becomes the open chapter. */
  add(pgn: string, orientation: Color, name: string, studyId?: number): number {
    const study = studyId !== undefined && this.o.db.studies().some((s) => s.id === studyId) ? studyId : this.o.db.addStudy(name.trim() || 'My study', 'own');
    const chapter = this.o.db.addChapter(study, { name: studyId !== undefined ? name.trim() || 'Chapter' : 'Chapter 1', orientation, pgn });
    this.openChapter = { study, chapter };
    this.o.onChange();
    return chapter;
  }

  /** The board has moved on to something that is not this chapter. */
  close() {
    if (!this.openChapter) return;
    this.openChapter = null;
    this.o.onChange();
  }

  remove(studyId: number): boolean {
    if (this.openChapter?.study === studyId) this.openChapter = null;
    const ok = this.o.db.removeStudy(studyId);
    this.o.onChange();
    return ok;
  }

  /** A whole study as one PGN, Lichess style. */
  export(studyId: number): string | undefined {
    const study = this.o.db.studies().find((s) => s.id === studyId);
    return study ? studyToPgn(study.name, this.o.db.studyChapters(studyId)) : undefined;
  }
}
