// The concept ladder (feature H11; LEARNING §5): which chess ideas the coach names at each
// vocabulary level. The ladder itself is data (content/concept-ladder.json): this module only
// checks it and answers questions about it. The validator's rule R5 and, later, the teaching
// lint for lessons (gate V8) read the same ladder.

export type VocabularyLevel = 'core' | 'intro' | 'all';
const LEVELS: readonly VocabularyLevel[] = ['core', 'intro', 'all'];

export type LadderConcept = {
  id: string;
  name: string;
  /** the column of the table in LEARNING §5 */
  use: 'constantly' | 'introduce' | 'defer';
  /** the lowest vocabulary level at which the coach may use the word */
  from: VocabularyLevel;
  /** how the word shows up in a sentence: regular expressions, case ignored. Needed for a deferred concept */
  words?: string[];
  /** the same idea in plain words: what the coach is told to say instead */
  plain?: string;
};
export type ConceptLadderFile = { about?: string; concepts: LadderConcept[] };

export type DeferredConcept = { concept: LadderConcept; patterns: RegExp[] };
export type ConceptLadder = {
  concepts: LadderConcept[];
  /** the concepts not yet allowed at a level, with their patterns ready to use */
  deferredAt: (level: VocabularyLevel) => DeferredConcept[];
};

/** Check the ladder file and get it ready. Throws, naming the concept, when something in it is wrong. */
export function compileLadder(file: ConceptLadderFile): ConceptLadder {
  if (!file || !Array.isArray(file.concepts)) throw new Error('the concept ladder has no "concepts" list');
  const seen = new Set<string>();
  const compiled: DeferredConcept[] = [];
  for (const c of file.concepts) {
    if (!c.id || !c.name) throw new Error('a concept in the ladder has no id or no name');
    if (seen.has(c.id)) throw new Error(`the concept "${c.id}" is in the ladder twice`);
    seen.add(c.id);
    if (!LEVELS.includes(c.from)) throw new Error(`the concept "${c.id}" has an unknown level: ${String(c.from)}`);
    if (!['constantly', 'introduce', 'defer'].includes(c.use)) throw new Error(`the concept "${c.id}" has an unknown use: ${String(c.use)}`);
    // a concept held back at some level must say how to spot it and what to say instead
    if (c.from !== 'core') {
      if (!c.words?.length) throw new Error(`the concept "${c.id}" is held back until "${c.from}" but has no words to spot it by`);
      if (!c.plain) throw new Error(`the concept "${c.id}" is held back but has no plain wording to use instead`);
    }
    const patterns: RegExp[] = [];
    for (const w of c.words ?? []) {
      try {
        patterns.push(new RegExp(w, 'i'));
      } catch {
        throw new Error(`the concept "${c.id}" has a pattern that is not a valid regular expression: ${w}`);
      }
    }
    compiled.push({ concept: c, patterns });
  }
  const rank = (level: VocabularyLevel) => LEVELS.indexOf(level);
  return {
    concepts: file.concepts,
    deferredAt: (level) => compiled.filter((d) => rank(d.concept.from) > rank(level)),
  };
}
