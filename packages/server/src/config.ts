// Paths and ports. Everything can be overridden from the environment; the defaults are this
// machine's Phase 1 installs (CLAUDE.md, "Machine").

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
// the secrets (the Lichess token) live in .env, put there through the secret box; they are only ever sent to the site they belong to
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  /* no .env: no token, and everything public still works */
}

export const config = {
  repoRoot: REPO_ROOT,
  dataDir: process.env.CHESS_COACH_DATA ?? path.join(REPO_ROOT, 'data'),
  port: Number(process.env.PORT ?? 5174),
  host: '127.0.0.1',
  stockfish: process.env.STOCKFISH ?? 'C:/Tools/Stockfish/stockfish-windows-x86-64-universal.exe',
  syzygy: process.env.SYZYGY ?? 'C:/Tools/Syzygy',
  /** `bench` node count of the official sf_19 build: the engine's fingerprint (decision D31) */
  expectedBench: 2497913,
  claude: process.env.CLAUDE_BIN ?? path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
  openingsDir: path.join(REPO_ROOT, 'data', 'datasets', 'openings'),
  /** Maia-3 for the bots (decisions D20, D30): the venv's Python by full path, and the pinned weights */
  /** the owner's Lichess token, for what needs it (a private study; the explorer): read when needed, never shown */
  lichessToken: () => process.env.LICHESS_TOKEN || undefined,
  maiaPython: process.env.MAIA_PYTHON ?? 'C:/Tools/Maia3/venv/Scripts/python.exe',
  maiaModels: process.env.MAIA_MODELS ?? 'C:/Tools/Maia3/models',
  maiaSidecar: path.join(REPO_ROOT, 'tools', 'maia_sidecar.py'),
  rosterFile: path.join(REPO_ROOT, 'content', 'bots.json'),
  ladderFile: path.join(REPO_ROOT, 'content', 'concept-ladder.json'),
};
