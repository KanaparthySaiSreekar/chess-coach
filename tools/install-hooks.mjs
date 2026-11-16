// Point git at the project's own hooks (tools/git-hooks), so the pre-commit guard runs for every
// commit made here. Run by `npm install` (the "prepare" script). Outside a git checkout it does nothing.

import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', 'tools/git-hooks'], { stdio: 'ignore' });
} catch {
  // not a git checkout, or git is not installed: nothing to set up
}
