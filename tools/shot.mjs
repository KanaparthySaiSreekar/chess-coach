// Development aid: drive the page in a real browser and save screenshots.
//   node tools/shot.mjs <script-name> [args]
//   URL=http://127.0.0.1:5184/ OUT=some/folder node tools/shot.mjs tour
// Scripts: basic · ask "<question>" [name] · settings · look [name] · tour · bots · alt · ui · editor · games [lichess] [chess.com]
// (games goes on through the review, the report, the profile and a puzzle made from the game)
// puzzles "<PGN>": paste a finished game, let the engine make puzzles from it, and solve one
// themes [name]: a themed set from the puzzle database · safety: go through the safety checks
// threat [move, e.g. g7g6]: name their threat (hints, then shown), then try a move
// convert [moves, e.g. d8h4 ...]: a win-the-won-game drill, with the owner's moves played in turn
// speed [streak|timed]: a speed run (switch puzzles.speedModes on first), stopped after a look · woodpecker: its panel
// W= and H= set the window size; SCHEME=light the system's light mode.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.env.URL ?? 'http://127.0.0.1:5174/';
const out = process.env.OUT ?? 'data/shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) }, colorScheme: process.env.SCHEME ?? 'dark' });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// drag a piece from one square to another on the board (white at the bottom unless flipped)
async function move(from, to, flipped = false) {
  const box = await page.locator('.board').boundingBox();
  const sq = box.width / 8;
  const xy = (s) => {
    let f = s.charCodeAt(0) - 97, r = Number(s[1]) - 1;
    if (flipped) { f = 7 - f; r = 7 - r; }
    return [box.x + (f + 0.5) * sq, box.y + (7 - r + 0.5) * sq];
  };
  const [x1, y1] = xy(from), [x2, y2] = xy(to);
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await page.mouse.move(x2, y2, { steps: 4 }); await page.mouse.up();
  await sleep(350);
}
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const text = async (sel) => (await page.locator(sel).first().innerText().catch(() => '(none)')).replace(/\s+/g, ' ');
// a clean analysis board: the starting position, nothing loaded
async function fresh() {
  await page.getByRole('tab', { name: 'Analysis board' }).click();
  await sleep(200);
  if (await page.getByRole('button', { name: 'Back to my board' }).count()) await page.getByRole('button', { name: 'Back to my board' }).click();
  await page.getByRole('button', { name: 'Reset board' }).click();
  await sleep(200);
  const dialog = page.getByRole('dialog', { name: 'Reset the board' });
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Reset to the starting position' }).click();
  await sleep(400);
}
async function load(pgn) {
  await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
  await page.locator('.modal textarea').fill(pgn);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await sleep(300);
  await page.keyboard.press('End');
  await sleep(300);
}
await page.goto(url);
await page.waitForSelector('.board piece', { timeout: 15000 });
const script = process.argv[2] ?? 'basic';
if (script === 'basic') {
  await fresh();
  await shot('01-start');
  for (const [a, b] of [['e2','e4'],['e7','e5'],['g1','f3'],['b8','c6'],['f1','b5'],['a7','a6'],['b5','c6'],['d7','c6'],['f3','e5'],['d8','d4']]) await move(a, b);
  await sleep(2500);
  await shot('02-moves');
  console.log('moves text:', await text('.moves-scroll'));
  console.log('opening:', await text('.opening'));
  console.log('turn:', await text('.turn'));
  console.log('caption:', await text('.caption'));
} else if (script === 'ask') {
  const q = process.argv[3] ?? "why is my knight in danger?";
  await page.getByLabel('Ask the coach').fill(q);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForSelector('.msg-coach .bubble:not(.typing)', { timeout: 60000 });
  await sleep(Number(process.env.SETTLE ?? 6000));
  await shot(process.argv[4] ?? '03-ask');
  console.log('thread:', (await page.locator('.thread').innerText()).replace(/\n+/g, ' | '));
  console.log('demo bar:', (await page.locator('.demo-bar').innerText().catch(() => '(none)')).replace(/\n+/g, ' | '));
  console.log('caption:', await text('.caption'));
} else if (script === 'settings') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await sleep(400);
  await shot('04-settings');
} else if (script === 'ui') {
  // the page's own furniture (I16): the Game menu, the View switches, the coach's options, the settings window
  await page.getByRole('button', { name: 'Game' }).click();
  await sleep(300);
  await shot('40-game-menu');
  console.log('game menu:', await text('.toolbar .menu'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await sleep(300);
  await shot('41-view');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Coach options' }).click();
  await sleep(300);
  await shot('42-coach-options');
  console.log('coach options:', await text('.coach-options'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await sleep(400);
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await sleep(300);
  await shot('43-settings-appearance');
  console.log('appearance settings:', await page.locator('.settings .setting').count());
  await page.keyboard.press('Escape');
} else if (script === 'look') {
  await sleep(500);
  await shot(process.argv[3] ?? 'look');
} else if (script === 'tour') {
  // the analysis board with the eval bar, the best-move arrow and the move labels
  await fresh();
  await load('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5 1-0');
  await move('g5', 'e6'); // drops the knight
  await page.waitForSelector('.verdict', { timeout: 20000 });
  await sleep(2500);
  await shot('10-blunder');
  console.log('caption:', await text('.caption'));
  console.log('evalbar:', await page.locator('.evalbar').getAttribute('aria-label'));
  console.log('moves:', await text('.moves-scroll'));
  await page.keyboard.press('ArrowLeft');
  await sleep(2500);
  await shot('11-best-arrow');
  console.log('caption (one back):', await text('.caption'));
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Label every move' }).click();
  await page.waitForSelector('.busy', { timeout: 10000 }).catch(() => {});
  await page.waitForSelector('.busy', { state: 'detached', timeout: 60000 }).catch(() => {});
  console.log('label every move took', Date.now() - t0, 'ms');
  await sleep(800);
  await shot('12-labelled');
  console.log('moves labelled:', await page.locator('.moves-scroll .badge').count(), 'badges');
  // the View menu and the main menu
  await page.getByRole('button', { name: 'View' }).click();
  await sleep(300);
  await shot('13-view-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Game' }).click();
  await sleep(300);
  await shot('14-main-menu');
  console.log('menu:', await text('.toolbar .menu'));
  await page.keyboard.press('Escape');
  // settings
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await sleep(400);
  await shot('15-settings');
  await page.getByLabel('Search settings').fill('arrow');
  await sleep(300);
  await shot('16-settings-search');
  console.log('settings found for "arrow":', await page.locator('.settings .setting').count());
  await page.keyboard.press('Escape');
  await sleep(200);
  // reset dialog
  await page.getByRole('button', { name: 'Reset board' }).click();
  await sleep(300);
  await shot('17-reset-dialog');
  await page.getByRole('button', { name: 'Cancel' }).click();
} else if (script === 'bots') {
  await page.getByRole('tab', { name: 'Play a bot' }).click();
  await sleep(600);
  if (await page.getByRole('button', { name: 'Choose another bot' }).count()) await page.getByRole('button', { name: 'Choose another bot' }).click();
  if (await page.getByRole('button', { name: 'Resign' }).count()) {
    await page.getByRole('button', { name: 'Resign' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await page.getByRole('button', { name: 'Choose another bot' }).click();
  }
  await sleep(500);
  await shot('20-bots-menu');
  console.log('bots:', await page.locator('.bot').count(), '· picked:', await text('.bot.picked'));
  await page.locator('.bot', { hasText: 'Pip' }).click();
  await page.getByRole('button', { name: /^Play / }).click();
  await sleep(600);
  for (const [a, b] of [['e2','e4'],['g1','f3'],['f1','c4']]) {
    await move(a, b);
    await page.waitForFunction(() => !document.querySelector('.thinking-dots'), null, { timeout: 60000 });
    await sleep(500);
  }
  await shot('21-bot-game');
  console.log('game moves:', await text('.moves-scroll'));
  console.log('status:', await text('.game-status'));
  await page.getByRole('button', { name: 'Resign' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await sleep(500);
  await shot('22-bot-game-over');
  console.log('result:', await text('.game-result'));
  await page.getByRole('button', { name: 'Review this game with the coach' }).click();
  await sleep(2500);
  await shot('23-review-on-analysis');
  console.log('mode now:', await text('.mode.current'), '· moves:', await text('.moves-scroll'));
} else if (script === 'alt') {
  // the coach shows a line; the owner plays a different move on the coach's board
  await fresh();
  await load('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. Nxe5 Qd4 1-0');
  await page.getByRole('button', { name: 'Show me', exact: true }).click();
  await page.waitForSelector('.demo-bar', { timeout: 60000 });
  await sleep(Number(process.env.SETTLE ?? 7000));
  await shot('30-coach-line');
  console.log('lines:', await text('.demo-lines'));
  await page.locator('.demo-steps .icon-btn').first().click(); // back to the start of the line
  await sleep(500);
  await move('f2', 'f4'); // not the line's move
  await page.waitForSelector('.demo-line.yours', { timeout: 30000 }).catch(async () => {
    await shot('31-alternative-FAILED');
    console.log('the alternative did not appear; toast:', await text('.toast'), '· errors:', errors.slice(0, 5));
  });
  await sleep(Number(process.env.SETTLE ?? 7000));
  await shot('31-alternative');
  console.log('lines after the try:', await text('.demo-lines'));
  console.log('caption:', await text('.caption'));
  console.log('thread:', (await page.locator('.thread').innerText()).replace(/\n+/g, ' | ').slice(-700));
} else if (script === 'editor') {
  // the board editor (I2): open it, drag a spare piece onto the board, pick a piece and press squares
  await fresh();
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Set up a position…' }).click();
  await page.waitForSelector('.layout.editor');
  await sleep(300);
  await shot('40-editor');
  const board = await page.locator('.board').boundingBox();
  const sq = board.width / 8;
  const at = (s) => [board.x + (s.charCodeAt(0) - 97 + 0.5) * sq, board.y + (7 - (Number(s[1]) - 1) + 0.5) * sq];
  const queen = await page.getByRole('button', { name: 'black queen' }).boundingBox();
  await page.mouse.move(queen.x + queen.width / 2, queen.y + queen.height / 2);
  await page.mouse.down();
  await page.mouse.move(...at('d5'), { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  await page.getByRole('button', { name: 'white knight' }).click();
  await page.mouse.click(...at('f5'));
  await page.mouse.click(...at('c4'));
  await sleep(300);
  await shot('41-editor-edited');
  console.log('state:', await text('.setup-state'));
  console.log('fen:', await page.locator('#ed-fen').inputValue());
  await page.keyboard.press('Escape');
} else if (script === 'games') {
  // the Games screen: enter the names given (point it at a server whose sites are stand-ins, or at
  // your own names), fetch, and open a game. Without names it shows the empty screen.
  const [lichess, chesscom] = process.argv.slice(3);
  await page.getByRole('tab', { name: 'My games' }).click();
  await sleep(400);
  await shot('50-games-empty');
  for (const [label, name] of [['Lichess', lichess], ['Chess.com', chesscom]]) {
    if (!name) continue;
    const box = page.getByLabel(label, { exact: true });
    await box.fill(name);
    await box.press('Enter');
    await sleep(300);
  }
  if (lichess || chesscom) {
    await page.getByRole('button', { name: 'Fetch new games' }).click();
    await page.waitForSelector('.game-row', { timeout: 20000 });
    await sleep(600);
  }
  await shot('51-games-list');
  console.log('accounts:', await text('.accounts'));
  console.log('head:', await text('.games-head'));
  console.log('rows:', await page.locator('.game-row').count(), '| first:', await text('.game-row'));
  await page.getByRole('radio', { name: 'Lost' }).click().catch(() => {});
  await sleep(200);
  await shot('52-games-lost');
  console.log('lost rows:', await page.locator('.game-row').count());
  // a lost game has the most to show; without one, the newest game
  if (!(await page.locator('.game-row').count())) await page.getByRole('radio', { name: 'All' }).click().catch(() => {});
  if (await page.locator('.game-row').count()) {
    await page.locator('.game-open').first().click();
    await page.waitForSelector('.board piece', { timeout: 15000 });
    await sleep(2500);
    await page.keyboard.press('End');
    await sleep(2500);
    await shot('53-game-opened');
    console.log('opened:', await text('.opening'), '| notice:', await text('.notice'));
    // the owner's own review comes first (when that setting is on): mark the move on the board, write a line, press Done
    if (await page.locator('.own-review').count()) {
      await page.getByRole('button', { name: 'Mark this move as a turning point' }).click().catch(() => {});
      await page.getByLabel('Your thoughts on the game').fill('I think it went wrong around here.');
      await sleep(400);
      await shot('54-own-review');
      console.log('own review:', await text('.own-review'), '| under the board:', await text('.caption-held'));
      await page.getByRole('button', { name: "Done: show the engine's view" }).click();
    }
    // the engine goes through the game: its key moments appear under the moves
    await page.waitForSelector('.moment, .moments-numbers', { timeout: 120000 }).catch(() => {});
    if (await page.locator('.moment').count()) {
      await page.locator('.moment').first().click();
      await sleep(2500);
    }
    await shot('55-key-moments');
    console.log('moments:', await text('.moments'));
    // the written report of the game
    if (await page.locator('.report-open').count()) {
      await page.locator('.report-open').click();
      await page.waitForSelector('.report');
      await sleep(300);
      await shot('56-report');
      console.log('report:', await text('.report'));
      // the chart is an option (Settings, Review): when it is on, point at it for the readout
      if (await page.locator('.report-chart').count()) {
        await page.locator('.report-chart').scrollIntoViewIfNeeded();
        const box = await page.locator('.report-chart').boundingBox();
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
        await sleep(300);
        await shot('57-report-chart');
      }
      await page.keyboard.press('Escape');
    }
    // back on the Games screen: the profile, counted from the games the engine has been through
    await page.getByRole('tab', { name: 'My games' }).click();
    await sleep(500);
    await shot('58-profile');
    console.log('profile:', await text('.profile'));
    // the puzzles made from the game that was opened: wait for them, then solve one
    await page.getByRole('tab', { name: 'Analysis board' }).click();
    await page.waitForSelector('button.moments-puzzles', { timeout: 240000 }).catch(() => {});
    if (await page.locator('button.moments-puzzles').count()) {
      console.log('puzzles:', await text('button.moments-puzzles'));
      await page.locator('button.moments-puzzles').click();
      await page.waitForSelector('.layout.puzzles .board piece');
      await page.waitForFunction(() => /Your move/.test(document.querySelector('.layout.puzzles .turn')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
      await sleep(400);
      await shot('59-puzzle');
      console.log('puzzle:', await text('.puzzle-side'), '| left:', await text('.layout.puzzles .pane-left'));
      await page.getByRole('button', { name: 'Hint', exact: true }).click();
      await sleep(300);
      await page.getByRole('button', { name: 'Another hint' }).click();
      await sleep(300);
      await page.getByRole('button', { name: 'Show me where' }).click();
      await sleep(400);
      await shot('60-puzzle-hints');
      await page.getByRole('button', { name: 'Show the answer' }).click();
      await page.waitForFunction(() => /answer is on the board\. \S/.test(document.querySelector('.puzzle-says')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
      await shot('61-puzzle-answer');
      console.log('answer:', await text('.puzzle-side'));
    } else console.log('puzzles: none came out of this game');
  }
}
if (script === 'puzzles') {
  // paste a finished game on the Games screen (argv[3]: its PGN), let the engine go through it,
  // and solve the puzzles made from it: a hint at each rung, then the answer
  const pgn = process.argv[3];
  if (!pgn) throw new Error('give the PGN of a finished game');
  await page.getByRole('tab', { name: 'My games' }).click();
  await page.getByLabel('A PGN, or a link to a game').fill(pgn);
  await page.getByRole('button', { name: 'Add and open' }).click();
  await page.waitForSelector('.own-review, .moments', { timeout: 30000 });
  if (await page.locator('.own-review').count()) await page.getByRole('button', { name: 'Skip' }).click();
  await page.waitForSelector('button.moments-puzzles', { timeout: 300000 });
  console.log('puzzles:', await text('button.moments-puzzles'));
  await page.locator('button.moments-puzzles').click();
  await page.waitForSelector('.layout.puzzles .board piece');
  await page.waitForFunction(() => /Your move/.test(document.querySelector('.layout.puzzles .turn')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  await sleep(400);
  await shot('70-puzzle');
  console.log('puzzle:', await text('.puzzle-side'), '| left:', await text('.layout.puzzles .pane-left'));
  for (const name of ['Hint', 'Another hint', 'Show me where']) {
    await page.getByRole('button', { name, exact: true }).click();
    await sleep(300);
  }
  await shot('71-puzzle-hints');
  console.log('hints:', await text('.puzzle-says'));
  await page.getByRole('button', { name: 'Show the answer' }).click();
  await page.waitForFunction(() => /answer is on the board\. \S/.test(document.querySelector('.puzzle-says')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  await sleep(900); // the board animates the rest of the line
  await shot('72-puzzle-answer');
  console.log('answer:', await text('.puzzle-side'));
}
if (script === 'themes') {
  // a themed set from the Lichess puzzle database (argv[3]: the theme's name on the page, default Fork)
  await page.getByRole('tab', { name: /^Puzzles/ }).click();
  await page.waitForSelector('.puzzle-sets');
  await sleep(500);
  await shot('80-puzzle-sets');
  console.log('sets:', await text('.puzzle-sets'));
  const chip = page.locator('.puzzle-themes-list .chip', { hasText: process.argv[3] ?? 'Fork' }).first();
  if (await chip.count()) {
    await chip.click();
    await page.waitForFunction(() => /Your move/.test(document.querySelector('.layout.puzzles .turn')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
    await sleep(500);
    await shot('81-themed-puzzle');
    console.log('puzzle:', await text('.puzzle-side'), '| from:', await text('.puzzle-from'));
  } else console.log('no theme chips: is the puzzle database installed?');
}
if (script === 'safety') {
  // the safety checks made from the games gone through: a question, its answer, and the next one
  await page.getByRole('tab', { name: /^Puzzles/ }).click();
  await page.waitForSelector('.puzzle-sets');
  await page.locator('.puzzle-set', { hasText: 'Safety check' }).click();
  await page.waitForSelector('.layout.puzzles .board piece');
  await sleep(500);
  console.log('left:', await text('.layout.puzzles .pane-left'));
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('.puzzle-task').count())) break;
    await shot(`9${i * 2}-safety-asking`);
    console.log('asks:', await text('.puzzle-task'));
    // the listing step, when it is on: say that is all at once, to see the ones missed
    if (await page.getByRole('button', { name: "That's all" }).count()) {
      await page.getByRole('button', { name: "That's all" }).click();
      await page.waitForSelector('.safety-tally');
      await sleep(400);
      await shot(`9${i * 2}-safety-listed`);
      console.log('listed:', await text('.safety-tally'));
    }
    // the first answer button: "Safe", or the first of the two moves
    await page.locator('.puzzle-side .play-actions .btn').first().click();
    await page.waitForSelector('.puzzle-says');
    await sleep(400);
    await shot(`9${i * 2 + 1}-safety-answered`);
    console.log('answered:', await text('.puzzle-side'));
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await sleep(500);
  }
  console.log('end:', await text('.puzzle-side'));
}
if (script === 'threat') {
  // "what's the threat?": the first position, a hint, their threat shown, then (argv[3], e.g. g7g6) a move of the owner's
  await page.getByRole('tab', { name: /^Puzzles/ }).click();
  await page.waitForSelector('.puzzle-sets');
  await page.locator('.puzzle-set', { hasText: "What's the threat?" }).click();
  await page.waitForSelector('.layout.puzzles .board piece');
  await sleep(500);
  if (!(await page.locator('.puzzle-task').count())) console.log('no position:', await text('.puzzle-side'));
  else {
    await shot('a0-threat-naming');
    console.log('asks:', await text('.puzzle-side'));
    await page.getByRole('button', { name: 'Hint', exact: true }).click();
    await page.getByRole('button', { name: 'Another hint', exact: true }).click();
    await sleep(400);
    await shot('a1-threat-hints');
    console.log('hints:', await text('.puzzle-says'));
    await page.getByRole('button', { name: 'Show their threat', exact: true }).click();
    await page.waitForFunction(() => /Now find a move/.test(document.querySelector('.puzzle-task')?.textContent ?? ''));
    await sleep(400);
    await shot('a2-threat-defending');
    console.log('defending:', await text('.puzzle-side'));
    const mv = process.argv[3];
    if (mv) {
      const flipped = /You are Black/.test(await text('.layout.puzzles .turn'));
      await move(mv.slice(0, 2), mv.slice(2, 4), flipped);
      await page.waitForFunction(() => !/Checking/.test(document.querySelector('.puzzle-side')?.textContent ?? ''), null, { timeout: 30000 });
      await sleep(600);
      await shot('a3-threat-after-move');
      console.log('after the move:', await text('.puzzle-side'));
    }
  }
}
if (script === 'convert') {
  // a win-the-won-game drill: the start, then each move given (argv[3...]) with the engine's replies
  await page.getByRole('tab', { name: /^Puzzles/ }).click();
  await page.waitForSelector('.puzzle-sets');
  await page.locator('.puzzle-set', { hasText: 'Win the won game' }).click();
  await page.waitForSelector('.layout.puzzles .board piece');
  await sleep(500);
  await shot('b0-convert-start');
  console.log('start:', await text('.puzzle-side'));
  const flipped = /You are Black/.test(await text('.layout.puzzles .turn'));
  for (const [i, mv] of process.argv.slice(3).entries()) {
    await move(mv.slice(0, 2), mv.slice(2, 4), flipped);
    await page.waitForFunction(() => !/thinking/.test(document.querySelector('.layout.puzzles .turn')?.textContent ?? ''), null, { timeout: 30000 });
    await sleep(500);
    await shot(`b${i + 1}-convert-after-${mv}`);
    console.log(`after ${mv}:`, await text('.puzzle-side'));
  }
}
if (script === 'speed') {
  const mode = process.argv[3] === 'timed' ? 'Timed run' : 'Streak';
  await page.getByRole('tab', { name: /^Puzzles/ }).click();
  await page.waitForSelector('.puzzle-sets');
  await page.locator('.puzzle-set', { hasText: mode }).click();
  await page.waitForSelector('.layout.puzzles .board piece');
  await sleep(1200);
  await shot('c0-speed-running');
  console.log('running:', await text('.puzzle-side'));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await sleep(500);
  await shot('c1-speed-over');
  console.log('over:', await text('.puzzle-side'));
}
if (script === 'woodpecker') {
  await page.getByRole('tab', { name: /^Puzzles/ }).click();
  await page.waitForSelector('.puzzle-sets');
  await page.locator('.puzzle-set', { hasText: 'Woodpecker' }).click();
  await sleep(800);
  await shot('d0-woodpecker');
  console.log('woodpecker:', await text('.puzzle-side'));
}
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 8));
await browser.close();
