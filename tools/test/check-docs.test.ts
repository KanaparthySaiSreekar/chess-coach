import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs tool without type declarations
import { anchorsOf, checkFeatures, checkLinks, featuresIn, linksIn } from '../check-docs.mjs';
// @ts-expect-error a plain .mjs tool without type declarations
import { blocked } from '../check-staged.mjs';

const FEATURES = `
### A. Board

| ID | Feature | Source | Phase | Status |
|---|---|---|---|---|
| A1 | **Shared board.** | owner | 3 | agreed |
| A2 | Arrows | owner | 4 | agreed |

### I. Parity

| ID | Feature | On the sites | Source | Phase | Status |
|---|---|---|---|---|---|
| I4 | Puzzle modes | Streak | owner | 6 | agreed (optional) |
| I12 | Online play | Play | owner | — | parked: single-user (D24) |
`;

const PLAN = `
| # | Phase | Home of features |
|---|---|---|
| 3 | Foundation | A1 |
| 4 | Coach on the page | A2 |
| 6 | Puzzles | I4 |

## Phase 3: Foundation

**Features:** A1

## Phase 4: Coach on the page

**Features:** A2

## Phase 6: Puzzles

**Features:** I4
`;

describe('check:docs: features', () => {
  it('reads feature rows from tables whose columns differ', () => {
    expect(featuresIn(FEATURES)).toEqual([
      { id: 'A1', phase: '3', status: 'agreed' },
      { id: 'A2', phase: '4', status: 'agreed' },
      { id: 'I4', phase: '6', status: 'agreed (optional)' },
      { id: 'I12', phase: '—', status: 'parked: single-user (D24)' },
    ]);
  });

  it('passes when every feature sits in the one phase FEATURES names', () => {
    expect(checkFeatures(FEATURES, PLAN)).toEqual({ problems: [], count: 4 });
  });

  it('catches a feature in two phases, in none, in the wrong one, and one unknown to FEATURES', () => {
    const twice = PLAN.replace('| 4 | Coach on the page | A2 |', '| 4 | Coach on the page | A2, A1 |');
    expect(checkFeatures(FEATURES, twice).problems.join('\n')).toMatch(/A1 is in two phases/);
    const none = PLAN.replace('| 6 | Puzzles | I4 |', '| 6 | Puzzles | |');
    expect(checkFeatures(FEATURES, none).problems.join('\n')).toMatch(/I4 is in FEATURES \(phase 6\) but in no phase of PLAN/);
    const wrong = FEATURES.replace('| owner | 4 | agreed |', '| owner | 5 | agreed |');
    expect(checkFeatures(wrong, PLAN).problems.join('\n')).toMatch(/A2: FEATURES says phase 5, PLAN's table says phase 4/);
    const unknown = PLAN.replace('| 3 | Foundation | A1 |', '| 3 | Foundation | A1, Z9, B7 |');
    expect(checkFeatures(FEATURES, unknown).problems.join('\n')).toMatch(/B7 \(phase 3\) is not in FEATURES/);
  });

  it('catches a parked feature that still sits in a phase, and a Features line that drifted from the table', () => {
    const parkedInPlan = PLAN.replace('| 6 | Puzzles | I4 |', '| 6 | Puzzles | I4, I12 |');
    expect(checkFeatures(FEATURES, parkedInPlan).problems.join('\n')).toMatch(/I12 is parked in FEATURES but still sits in phase 6/);
    const drift = PLAN.replace('**Features:** A2', '**Features:** A2, A1');
    expect(checkFeatures(FEATURES, drift).problems.join('\n')).toMatch(/phase 4's "Features:" line \(A1, A2\) differs from the table \(A2\)/);
  });
});

describe('check:docs: links', () => {
  it('makes the anchors GitHub makes', () => {
    const a = anchorsOf('## 4.1 The look of the page (I16, D44)\n### 8.2 Move labels (A17, D40)\n## 7. The fact packet\n## Same\n## Same\n```\n## not a heading\n```\n## The `coach-core` skill');
    expect([...a]).toEqual(['41-the-look-of-the-page-i16-d44', '82-move-labels-a17-d40', '7-the-fact-packet', 'same', 'same-1', 'the-coach-core-skill']);
  });

  it('finds links to files and headings, and skips the web and code', () => {
    expect(linksIn('See [the plan](docs/PLAN.md#phase-2-spikes), [here](#top) and [Lichess](https://lichess.org/api).\n`[not](a-link.md)`').map((l: { target: string }) => l.target)).toEqual(['docs/PLAN.md#phase-2-spikes', '#top']);
  });

  it('reports a missing file and a missing heading, with the line', () => {
    const files: Record<string, string> = {
      '/r/A.md': '# A\n[ok](B.md#the-part)\n[gone](C.md)\n[no heading](B.md#nope)\n[self](#a)\n',
      '/r/B.md': '## The part\n',
    };
    const norm = (f: string) => f.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '');
    const r = checkLinks(['/r/A.md'], (f: string) => files[norm(f)]!, (f: string) => norm(f) in files);
    expect(r.checked).toBe(4);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toMatch(/A\.md:3: "C\.md" points at a file that does not exist/);
    expect(r.problems[1]).toMatch(/A\.md:4: "B\.md#nope" points at a heading that does not exist/);
  });
});

describe('the pre-commit guard', () => {
  it('refuses the owner\'s data, course files, secrets and databases', () => {
    const bad = blocked(['data/courses/book.pdf', 'packages/web/courses/x.pgn', '.env', '.env.local', 'packages/server/.env', 'x/games.cbh', 'backup/chess-coach.sqlite', 'data\\datasets\\puzzles.csv']);
    expect(bad.map((b: { path: string }) => b.path)).toEqual(['data/courses/book.pdf', 'packages/web/courses/x.pgn', '.env', '.env.local', 'packages/server/.env', 'x/games.cbh', 'backup/chess-coach.sqlite', 'data/datasets/puzzles.csv']);
  });

  it('lets the project\'s own files through', () => {
    expect(blocked(['packages/core/src/chess.ts', 'docs/PLAN.md', 'content/bots.json', '.env.example', 'tools/check-staged.mjs', 'spikes/s6-pdf/transcription.json', 'packages/web/src/database.ts'])).toEqual([]);
  });
});
