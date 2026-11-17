// Development aid: the README's screen recordings, pictures and banner, taken from the running page.
//   URL=http://127.0.0.1:5184/ FFMPEG=<ffmpeg.exe> node tools/readme-media.mjs tour     docs/media/<scene>.gif and tour.mp4
//   URL=http://127.0.0.1:5184/ node tools/readme-media.mjs stills                       docs/media/games.png, settings.png, light.png
//   URL=http://127.0.0.1:5184/ node tools/readme-media.mjs banner                       docs/media/banner.png
// Point it at a second server with its own data folder (CLAUDE.md, "Run it"), never at the owner's:
// it resets the board, adds a game, plays a bot, starts the live coach (uses the plan) and changes a
// few settings of that server (the computer's load and the engine's lines are hidden, so the moves
// keep their room on a page this small; the explorer is closed for the review).
// On AC power. Run `tour` before `stills`: the stills show the game the tour reviewed.
//   SCENES=coach,review,bots,puzzles,openings,endgames   only these scenes, in this order
//   WORK=<folder>   where the frames are kept (default: data/readme-frames); OUT=<folder> (default: docs/media)
//   GIF_WIDTH=1120  GIF_FPS=20  H=860 (the page's height in the film)
// The film is the real page. A drawn cursor follows the mouse the script moves, a caption strip sits
// under the page, and the waits (the coach thinking, the engine going through a game) are cut out.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import WebSocket from 'ws';

const url = process.env.URL ?? 'http://127.0.0.1:5184/';
const out = path.resolve(process.env.OUT ?? 'docs/media');
const work = path.resolve(process.env.WORK ?? 'data/readme-frames');
const ffmpeg = process.env.FFMPEG;
const W = 1280;
const H = Number(process.env.H ?? 860);
const STRIP = 56; // the caption strip under the page
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] ?? 'tour';
mkdirSync(out, { recursive: true });

// The position the coach scene starts from: an Exchange Ruy Lopez where the knight on e5 and the pawn on e4 are both attacked.
const GAME = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. Nxe5 Qd4';
// The game the review scene goes through: two of the app's own 700-rated Maia bots (tools/label-audit.ts
// plays games the same way), so it has a beginner's mistakes in it and is nobody's real game.
const REVIEW_GAME = `[Event "Bot game"]
[Date "2026.11.17"]
[White "Maia 700"]
[Black "Maia 700"]
[Result "0-1"]

1. e4 e5 2. Nf3 f6 3. d4 d6 4. dxe5 dxe5 5. Bb5+ c6 6. Ba4 b5 7. Bb3 Bg4 8. h3 Bxf3 9. gxf3 Nd7 10. f4 Nc5 11. Nc3 Qa5 12. Bd2 O-O-O 13. Be6+ Nxe6 14. a3 Qb6 15. Qg4 Kb8 16. Qxe6 Bc5 17. O-O Nh6 18. Rad1 Rhe8 19. Qb3 exf4 20. Bxf4+ Ka8 21. Rxd8+ Rxd8 22. Nxb5 cxb5 23. Qd5+ Rxd5 24. exd5 Nf5 25. Rd1 a5 26. d6 Bxd6 27. Bxd6 Nxd6 28. Rxd6 Qxd6 29. c4 bxc4 30. Kf1 Qe5 31. Kg2 Qxb2 32. Kg3 Qxa3+ 33. f3 c3 34. Kg4 c2 35. f4 c1=Q 36. Kf5 Qd6 37. Ke4 Qcxf4# 0-1`;

// Two more games of the same kind, so the profile and the takeaway journal in the pictures are counted from three.
const MORE_GAMES = [
  `[Event "Bot game"]
[Date "2026.11.16"]
[White "Maia 700"]
[Black "Maia 700"]
[Result "1-0"]

1. e4 e5 2. d3 Nf6 3. Ne2 d6 4. Be3 Be6 5. g4 Be7 6. Bh3 O-O 7. O-O Nc6 8. Nbc3 Qe8 9. a3 Rd8 10. b4 b5 11. Nxb5 Ra8 12. Nxc7 Qc8 13. Nxa8 Qxa8 14. Qd2 Bxg4 15. Bxg4 Nxg4 16. f3 Nxe3 17. Qxe3 Qd8 18. d4 Bg5 19. f4 exf4 20. Nxf4 Re8 21. c3 Bxf4 22. Rxf4 Qg5+ 23. Kf1 d5 24. Re1 dxe4 25. Rxe4 Rxe4 26. Qxe4 Qg6 27. Qe8# 1-0`,
  `[Event "Bot game"]
[Date "2026.11.15"]
[White "Maia 700"]
[Black "Maia 700"]
[Result "1-0"]

1. c4 Nf6 2. Nc3 d5 3. cxd5 e6 4. g3 exd5 5. Bg2 c6 6. d4 Bb4 7. Bd2 Bg4 8. Qa4 b5 9. Qd1 Ne4 10. Nxe4 dxe4 11. Bxb4 Nd7 12. Rc1 Bf5 13. Nh3 Nf6 14. Rxc6 Nd5 15. Rc5 h5 16. Nf4 Nxb4 17. Rxf5 g5 18. Rxg5 Qxg5 19. Bxe4 Rd8 20. a3 O-O 21. axb4 Rfe8 22. f3 f5 23. Bd3 Qe7 24. Bxb5 Rxd4 25. Bxe8 Qxb4+ 26. Kf2 Qd2 27. Qb3+ Kh7 28. g4 Rxf4 29. Qb7+ Kh6 30. Qb8 hxg4 31. h3 g3+ 32. Kxg3 Qd4 33. h4 Qh8 34. Kxf4 Qxe8 35. Qxe8 Kg7 36. Qe7+ Kh6 37. Rd1 Kg6 38. Qxa7 Kh6 39. Rd5 Kh5 40. Rxf5+ Kxh4 41. Qh7# 1-0`,
];

const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true });

/** Change a setting of the server the page is on, as the page's own Settings window does. */
async function setSetting(key, value) {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello' }));
  await sleep(250);
  ws.send(JSON.stringify({ type: 'setting', key, value }));
  await sleep(350);
  ws.close();
}

/** A page of the app on the analysis board. `film` adds the drawn cursor and the caption strip. */
async function open({ film = false, scale = 1, scheme = 'dark', height = H } = {}) {
  const context = await browser.newContext({ viewport: { width: W, height: film ? height + STRIP : height }, deviceScaleFactor: scale, colorScheme: scheme });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForSelector('[role=tab]', { timeout: 15000 }); // the page opens on the tab it was left on
  await page.getByRole('tab', { name: 'Analysis board' }).click();
  await page.waitForSelector('.board piece', { timeout: 15000 });
  if (film) {
    await page.addStyleTag({
      content: `
      #root { height: calc(100% - ${STRIP}px) !important; }
      #film-caption { position: fixed; left: 0; right: 0; bottom: 0; height: ${STRIP}px; z-index: 9998; display: flex; align-items: center; justify-content: center; gap: 14px;
        background: #101012; border-top: 1px solid rgba(255, 255, 255, 0.1); color: #f5f5f7; font: 400 21px/1 var(--font-book); letter-spacing: -0.01em; }
      #film-caption b { font: 650 11.5px/1 var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; color: #241500; background: #f2ab3c; padding: 6px 9px 5px; border-radius: 6px; }
      #film-cursor { position: fixed; left: 0; top: 0; z-index: 9999; pointer-events: none; width: 22px; height: 30px; margin: -2px 0 0 -3px; filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.55)); }
      #film-cursor.down { scale: 0.86; }
      .film-ring { position: fixed; z-index: 9997; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgba(90, 169, 255, 0.95); animation: film-ring 420ms ease-out forwards; }
      @keyframes film-ring { from { transform: scale(0.35); opacity: 1; } to { transform: scale(1.25); opacity: 0; } }`,
    });
    await page.evaluate(() => {
      const strip = document.createElement('div');
      strip.id = 'film-caption';
      strip.innerHTML = '<b></b><span></span>';
      document.body.append(strip);
      const cursor = document.createElement('div');
      cursor.id = 'film-cursor';
      cursor.innerHTML = '<svg viewBox="0 0 22 30" width="22" height="30"><path d="M3 2 L3 22.5 L8.2 17.8 L11.6 25.8 L15 24.3 L11.6 16.6 L18.6 16.6 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.body.append(cursor);
      const at = (e) => (cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`);
      window.addEventListener('mousemove', at, true);
      window.addEventListener(
        'mousedown',
        (e) => {
          at(e);
          cursor.classList.add('down');
          const ring = document.createElement('div');
          ring.className = 'film-ring';
          ring.style.left = `${e.clientX}px`;
          ring.style.top = `${e.clientY}px`;
          document.body.append(ring);
          setTimeout(() => ring.remove(), 500);
        },
        true,
      );
      window.addEventListener('mouseup', () => cursor.classList.remove('down'), true);
    });
  }
  return { context, page, errors };
}

/** The hands: a mouse that glides, clicks and drags like a person's. */
function hands(page) {
  let at = { x: W * 0.55, y: H * 0.6 };
  const glide = async (x, y, ms) => {
    const from = at;
    const dist = Math.hypot(x - from.x, y - from.y);
    const time = ms ?? Math.min(850, Math.max(260, 200 + dist * 0.8));
    const n = Math.max(8, Math.round(time / 16));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await sleep(time / n);
    }
    at = { x, y };
  };
  const centre = async (target) => {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox();
    if (!box) throw new Error(`nothing to point at: ${target}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const press = async () => {
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
  };
  const square = async (sq, flipped) => {
    const box = await page.locator('.board').first().boundingBox();
    const size = box.width / 8;
    let f = sq.charCodeAt(0) - 97;
    let r = Number(sq[1]) - 1;
    if (flipped) [f, r] = [7 - f, 7 - r];
    return { x: box.x + (f + 0.5) * size, y: box.y + (7 - r + 0.5) * size };
  };
  return {
    async park(x = W * 0.5, y = H * 0.93) {
      await glide(x, y);
    },
    /** After work done off the film with the page's own clicks: the mouse back where the film left it. */
    async back() {
      await page.mouse.move(at.x, at.y);
      await page.evaluate(() => document.activeElement?.blur?.()); // no focus ring left from a menu
    },
    async click(target, { before = 150, after = 350 } = {}) {
      const p = await centre(target);
      await glide(p.x, p.y);
      await sleep(before);
      await press();
      await sleep(after);
    },
    /** Type a line into a box, letter by letter, and send it with Enter. */
    async type(target, text) {
      const p = await centre(target);
      await glide(p.x, p.y);
      await sleep(120);
      await press();
      await sleep(250);
      await page.keyboard.type(text, { delay: 42 });
      await sleep(450);
      await page.keyboard.press('Enter');
    },
    async move(from, to, { flipped = false, after = 500 } = {}) {
      const a = await square(from, flipped);
      const b = await square(to, flipped);
      await glide(a.x, a.y);
      await sleep(140);
      await page.mouse.down();
      await sleep(90);
      await glide(b.x, b.y, 420);
      await sleep(90);
      await page.mouse.up();
      await sleep(after);
    },
  };
}

/** The film: every frame the page paints, with the time it arrived. Waits are cut out afterwards, and each scene is also a film of its own. */
async function recorder(context, page) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  const cuts = [];
  const marks = [];
  let on = false;
  const now = () => Date.now() / 1000;
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (!on) return;
    const file = `f${String(frames.length).padStart(5, '0')}.png`;
    writeFileSync(path.join(work, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: now() });
  });
  return {
    async start() {
      on = true;
      await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    },
    scene(name) {
      marks.push({ name, t: now() });
    },
    /** Wait for something slow, keeping `keep` ms of the wait's start and `tail` ms before its end. */
    async cutWait(what, { keep = 700, tail = 120 } = {}) {
      const t0 = now();
      const result = await what();
      const t1 = now();
      if (t1 - t0 > (keep + tail) / 1000 + 0.2) cuts.push([t0 + keep / 1000, t1 - tail / 1000]);
      return result;
    },
    /** Leave everything from now until the returned function is called out of the film. */
    pause() {
      const t0 = now();
      // the last thing done off the film (a new caption) is painted before the film goes on
      return async () => {
        await sleep(350);
        cuts.push([t0, now()]);
      };
    },
    async stop() {
      await sleep(250);
      on = false;
      await cdp.send('Page.stopScreencast').catch(() => {});
      const end = now();
      // the film's clock: real time with the cuts taken out; the picture showing when a cut ends is kept
      const cutBefore = (t) => cuts.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(t, b) - a), 0);
      const cutAround = (t) => cuts.find(([a, b]) => t > a && t < b);
      const kept = [];
      let held = null;
      for (const f of frames) {
        if (cutAround(f.t)) {
          held = f;
          continue;
        }
        if (held) {
          const b = cutAround(held.t)[1];
          if (b < f.t) kept.push({ file: held.file, at: b - cutBefore(b) });
          held = null;
        }
        kept.push({ file: f.file, at: f.t - cutBefore(f.t) });
      }
      const films = [{ name: 'tour', from: kept[0].at, to: end - cutBefore(end) }];
      marks.forEach((m, i) => films.push({ name: m.name, from: m.t - cutBefore(m.t), to: i + 1 < marks.length ? marks[i + 1].t - cutBefore(marks[i + 1].t) : end - cutBefore(end) }));
      for (const film of films) {
        const mine = kept.filter((f) => f.at >= film.from && f.at < film.to);
        if (!mine.length) continue;
        // a scene opens on the picture that was showing when it began
        const before = kept.findLast((f) => f.at < film.from);
        if (before && mine[0].at - film.from > 0.05) mine.unshift({ file: before.file, at: film.from });
        const lines = [];
        mine.forEach((f, i) => {
          const next = i + 1 < mine.length ? mine[i + 1].at : film.to;
          lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.at).toFixed(4)}`);
        });
        lines.push(`file '${mine.at(-1).file}'`);
        writeFileSync(path.join(work, `${film.name}.txt`), lines.join('\n'));
        film.seconds = film.to - mine[0].at;
      }
      return { frames: frames.length, kept: kept.length, films };
    },
  };
}

function encode(films) {
  if (!ffmpeg) {
    console.log(`the frames are in ${work}; set FFMPEG=<path to ffmpeg> to make the GIFs and the MP4`);
    return;
  }
  const run = (list, args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, ...args], { cwd: work, stdio: 'inherit' });
  const width = Number(process.env.GIF_WIDTH ?? 1120);
  const fps = process.env.GIF_FPS ?? '20';
  for (const film of films) {
    if (film.seconds === undefined) continue;
    if (film.name === 'tour') run('tour.txt', ['-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', path.join(out, 'tour.mp4')]);
    else run(`${film.name}.txt`, ['-filter_complex', `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', path.join(out, `${film.name}.gif`)]);
    console.log(`  ${film.name.padEnd(9)} ${film.seconds.toFixed(1).padStart(5)} s`);
  }
}

// ---------------------------------------------------------------- the page, as a person uses it

async function freshBoard(page) {
  await page.getByRole('tab', { name: 'Analysis board' }).click();
  await sleep(200);
  if (await page.getByRole('button', { name: 'Back to my board' }).count()) await page.getByRole('button', { name: 'Back to my board' }).click();
  await page.getByRole('button', { name: 'Reset board' }).click();
  await sleep(200);
  const dialog = page.getByRole('dialog', { name: 'Reset the board' });
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Reset to the starting position' }).click();
  await sleep(400);
  // an empty conversation, so the coach's pane opens on its suggestions
  await page.getByRole('button', { name: 'Game', exact: true }).click();
  const clear = page.getByRole('menuitem', { name: 'Clear the conversation' });
  if ((await clear.count()) && (await clear.isEnabled())) await clear.click();
  else await page.keyboard.press('Escape');
  await sleep(300);
}
async function loadGame(page, pgn) {
  await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
  await page.locator('.modal textarea').fill(pgn);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await sleep(300);
  await page.keyboard.press('End');
  await sleep(300);
}
const settle = async (page, ms = 2500) => {
  await page.waitForSelector('.busy', { state: 'detached', timeout: 60000 }).catch(() => {});
  await sleep(ms);
};
/** Out of a game against a bot, back on the roster (nothing happens when no game is on). */
async function leaveGame(page) {
  await page.getByRole('tab', { name: 'Play a bot' }).click();
  await sleep(500);
  if (await page.getByRole('button', { name: 'Resign' }).count()) {
    await page.getByRole('button', { name: 'Resign' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await sleep(400);
  }
  if (await page.getByRole('button', { name: 'Choose another bot' }).count()) await page.getByRole('button', { name: 'Choose another bot' }).click();
  await sleep(400);
}
/** Where every scene opens: no game against a bot going on, the analysis board at the starting position. */
async function home(page) {
  await leaveGame(page);
  await freshBoard(page);
}
/** My games without the rows whose text has `what` in it. */
async function removeGames(page, what) {
  await page.getByRole('tab', { name: 'My games' }).click();
  await sleep(500);
  for (let i = 0; i < 12; i++) {
    const row = page.locator('.game-row', { hasText: what }).first();
    if (!(await row.count())) break;
    await row.getByRole('button', { name: 'Remove this game from the list' }).click();
    await row.getByRole('button', { name: 'Yes' }).click();
    await sleep(400);
  }
}
const coachBubbles = (page) => page.locator('.msg-coach .bubble:not(.typing)').count();
const coachSpoke = (page, before, timeout = 120000) => page.waitForFunction((n) => document.querySelectorAll('.msg-coach .bubble:not(.typing)').length > n, before, { timeout });
/** The coach running and ready (the page starts it; the first start takes a few seconds). */
async function coachOn(page) {
  if (await page.getByRole('button', { name: 'Start coach' }).count()) await page.getByRole('button', { name: 'Start coach' }).click();
  await page.waitForFunction(() => /Ready/.test(document.querySelector('.coach-state')?.textContent ?? ''), null, { timeout: 120000 });
}

const scenes = {
  // a move is labelled; the coach asks about it, then says why, on the board, and plays the line out
  async coach({ page, hand, film, caption }) {
    const resume = film.pause();
    await freshBoard(page);
    await loadGame(page, GAME);
    await coachOn(page);
    await settle(page, 1500);
    await hand.park(W * 0.5, H * 0.5);
    await caption('Analysis board', 'Play a move. The engine labels it and says why, in plain words.');
    await hand.back();
    await resume();
    await sleep(1500);
    let said = await coachBubbles(page);
    await hand.move('e5', 'f7');
    await film.cutWait(() => page.waitForSelector('.verdict', { timeout: 30000 }), { keep: 500 });
    await hand.park(W * 0.56, H * 0.9);
    await sleep(1800);
    // with the coach on, a blunder brings a question from it; if it stays quiet, the owner asks
    await caption('The coach', 'The coach asks before it tells: a question first, to get you looking.');
    const asked = await film.cutWait(() => coachSpoke(page, said, 30000).then(() => true, () => false), { keep: 900 });
    if (!asked) {
      await hand.click(page.locator('.suggestion', { hasText: 'Why was my last move bad?' }));
      await film.cutWait(() => coachSpoke(page, said), { keep: 1100 });
    }
    await hand.park(W * 0.6, H * 0.62);
    await sleep(5000);
    if (asked) {
      await caption('Just tell me', 'Ask for the answer and it explains. Stockfish checks every statement before you see it.');
      said = await coachBubbles(page);
      await hand.click(page.getByRole('button', { name: 'Just tell me', exact: true }));
      await film.cutWait(() => coachSpoke(page, said), { keep: 1100 });
      await hand.park(W * 0.6, H * 0.62);
      await sleep(6000);
    }
    await caption('Ask anything', 'Ask in your own words. It plays the line out on its own board, so you see the reason.');
    said = await coachBubbles(page);
    await hand.type(page.getByLabel('Ask the coach'), 'Show me how I lose the knight');
    await film.cutWait(() => page.waitForSelector('.demo-bar', { timeout: 120000 }), { keep: 1100 });
    await hand.park(W * 0.6, H * 0.62);
    await film.cutWait(() => coachSpoke(page, said).catch(() => {}), { keep: 2500, tail: 300 });
    await sleep(6000);
  },

  // a finished game: the owner's own look first, the key moments, the coach's questions, the report
  async review({ page, hand, film, caption }) {
    const resume = film.pause();
    await page.getByRole('tab', { name: 'Analysis board' }).click();
    if (await page.getByRole('button', { name: 'Back to my board' }).count()) await page.getByRole('button', { name: 'Back to my board' }).click();
    await setSetting('explorer.show', false); // room for the moves and the key moments
    await leaveGame(page);
    await removeGames(page, 'Pip'); // games this script resigned on an earlier run
    await removeGames(page, 'Maia 700');
    await page.getByLabel('A PGN, or a link to a game').fill(REVIEW_GAME);
    await page.getByRole('button', { name: 'Add and open' }).click();
    await page.waitForSelector('.own-review', { timeout: 30000 });
    await page.getByRole('tab', { name: 'Analysis board' }).click();
    await freshBoard(page);
    await caption('Game review', 'Your finished games. You look first: where do you think it turned?');
    await hand.back();
    await resume();
    await sleep(700);
    await hand.click(page.getByRole('tab', { name: 'My games' }));
    await sleep(1500);
    await hand.click(page.locator('.game-row', { hasText: 'Maia 700' }).locator('.game-open'));
    await page.waitForSelector('.own-review', { timeout: 30000 });
    await sleep(2000);
    await hand.click(page.locator('.moves-scroll .san', { hasText: 'e6+' }).first());
    await sleep(900);
    await hand.click(page.getByRole('button', { name: 'Mark this move as a turning point' }));
    await sleep(900);
    await hand.click(page.getByRole('button', { name: "Done: show the engine's view" }));
    await caption('Key moments', 'Then the engine: one to three key moments and the step that was skipped, never a wall of lines.');
    await film.cutWait(() => page.waitForSelector('.moment', { timeout: 240000 }), { keep: 1200, tail: 200 });
    await hand.park(W * 0.56, H * 0.9);
    await sleep(4200);
    await caption('The coach', 'The coach goes through them with you. It asks before it tells.');
    const said = await coachBubbles(page);
    await hand.click(page.locator('.replay-start'));
    await film.cutWait(() => coachSpoke(page, said), { keep: 1100 });
    await hand.park(W * 0.6, H * 0.66);
    await sleep(6000);
    await caption('The report', 'Each game ends in a short report: what went well, and the habit to take into the next one.');
    await hand.click(page.locator('.report-open'));
    await page.waitForSelector('.report');
    await hand.park(W * 0.82, H * 0.5);
    await sleep(5500);
    const resume2 = film.pause();
    await page.keyboard.press('Escape');
    await page.locator('.replay-bar .link').click().catch(() => {});
    await setSetting('explorer.show', true);
    await sleep(500);
    await resume2();
  },

  // a game against a bot that plays like a person of its rating, with the sparring coach beside it
  async bots({ page, hand, film, caption }) {
    const resume = film.pause();
    await home(page);
    await caption('Play a bot', 'Eighteen Maia-3 bots, rated 600 to 2600, play the moves real people of that rating play.');
    await hand.back();
    await resume();
    await sleep(600);
    await hand.click(page.getByRole('tab', { name: 'Play a bot' }));
    await sleep(1700);
    await hand.click(page.locator('.bot', { hasText: 'Pip' }));
    await sleep(900);
    await hand.click(page.getByRole('button', { name: /^Play / }));
    await film.cutWait(() => page.getByRole('button', { name: 'Resign' }).waitFor({ timeout: 90000 }), { keep: 500 });
    await sleep(700);
    let plies = 0;
    for (const [a, b] of [['e2', 'e4'], ['g1', 'f3'], ['f1', 'c4']]) {
      await hand.move(a, b, { after: 150 });
      plies += 2;
      const want = plies;
      await film.cutWait(() => page.waitForFunction((n) => document.querySelectorAll('.moves-scroll .san').length >= n && !document.querySelector('.thinking-dots'), want, { timeout: 60000 }), { keep: 900, tail: 250 });
      await sleep(900);
    }
    await hand.park(W * 0.62, H * 0.72);
    await sleep(2600);
  },

  // a themed puzzle, and the hint ladder
  async puzzles({ page, hand, film, caption }) {
    const resume = film.pause();
    await home(page);
    await caption('Puzzles', 'Puzzles at your level and from your own mistakes. Hints climb a ladder: question, nudge, arrow, answer.');
    await hand.back();
    await resume();
    await sleep(600);
    await hand.click(page.getByRole('tab', { name: /^Puzzles/ }));
    await sleep(1400);
    await hand.click(page.locator('.puzzle-themes-list .chip', { hasText: process.env.THEME ?? 'Fork' }));
    await film.cutWait(() => page.waitForFunction(() => /Your move/.test(document.querySelector('.layout.puzzles .turn')?.textContent ?? ''), null, { timeout: 30000 }), { keep: 1500, tail: 300 });
    await sleep(1800);
    for (const name of ['Hint', 'Another hint', 'Show me where']) {
      await hand.click(page.getByRole('button', { name, exact: true }));
      await sleep(2200);
    }
    await hand.click(page.getByRole('button', { name: 'Show the answer' }));
    await page.waitForFunction(() => /answer is on the board\. \S/.test(document.querySelector('.puzzle-says')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
    await hand.park(W * 0.62, H * 0.72);
    await sleep(4200);
  },

  // the repertoire, walked move by move: a line where every move of the owner's has its why written
  async openings({ page, hand, film, caption }) {
    const resume = film.pause();
    await home(page);
    await caption('Openings', 'A repertoire built from the masters’ games, with the why behind your moves.');
    await hand.back();
    await resume();
    await sleep(600);
    await hand.click(page.getByRole('tab', { name: 'Openings' }));
    await sleep(2000);
    for (const reply of ['b6', 'b7', 'f6']) {
      await hand.click(page.getByRole('button', { name: 'Play it' }));
      await sleep(1300);
      const row = page.locator('.rep-reply', { has: page.locator('.rep-reply-move', { hasText: reply }) }).first();
      if (!(await row.count())) break;
      await hand.click(row);
      await sleep(2600);
    }
    await sleep(1800);
  },

  // an ending played out against the engine
  async endgames({ page, hand, film, caption }) {
    const resume = film.pause();
    await home(page);
    await caption('Endgames', 'The endings every player needs, played out against the engine. The tablebases judge every move.');
    await hand.back();
    await resume();
    await sleep(600);
    await hand.click(page.getByRole('tab', { name: 'Endgames' }));
    await sleep(1600);
    await hand.click(page.locator('.eg-pick', { hasText: 'Run with the pawn' }));
    const yourTurn = (keep) => film.cutWait(() => page.waitForFunction(() => /You (are|were)/.test(document.querySelector('.endgames-tab .turn')?.textContent ?? ''), null, { timeout: 30000 }), { keep, tail: 250 });
    await yourTurn(600);
    await sleep(2200);
    for (const [a, b] of [['a5', 'a6'], ['a6', 'a7'], ['a7', 'a8']]) {
      await hand.move(a, b, { after: 250 });
      if (await page.locator('.promo').count()) await hand.click(page.locator('.promo button').first());
      await sleep(300);
      await yourTurn(900);
      await sleep(700);
    }
    await hand.park(W * 0.62, H * 0.72);
    await film.cutWait(() => page.waitForSelector('.drill-thread', { timeout: 60000 }).catch(() => {}), { keep: 1500, tail: 300 });
    await sleep(4500);
  },
};

// ---------------------------------------------------------------- run

/** The quiet page of the film and the pictures: what is hidden leaves the moves their room at this size. */
async function quietPage() {
  await setSetting('display.systemStats', false);
  await setSetting('display.engineLines', false);
}

if (mode === 'tour') {
  await quietPage();
  const { context, page, errors } = await open({ film: true });
  const hand = hands(page);
  const film = await recorder(context, page);
  const caption = (tag, text) =>
    page.evaluate(
      ([t, s]) => {
        document.querySelector('#film-caption b').textContent = t;
        document.querySelector('#film-caption span').textContent = s;
      },
      [tag, text],
    );
  const wanted = (process.env.SCENES ?? Object.keys(scenes).join(',')).split(',');
  await film.start();
  for (const name of wanted) {
    console.log('scene:', name);
    film.scene(name);
    await scenes[name]({ page, hand, film, caption });
  }
  const made = await film.stop();
  // leave the server as it was found: no game on, the coach off, my own board
  await leaveGame(page);
  await page.getByRole('tab', { name: 'Analysis board' }).click();
  await sleep(500);
  if (await page.getByRole('button', { name: 'Back to my board' }).count()) await page.getByRole('button', { name: 'Back to my board' }).click();
  if (await page.getByRole('button', { name: 'Stop coach' }).count()) await page.getByRole('button', { name: 'Stop coach' }).click();
  await sleep(500);
  console.log(`${made.frames} frames, ${made.kept} kept`);
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
  await context.close();
  encode(made.films);
}

if (mode === 'stills') {
  await quietPage();
  const { context, page } = await open({ scale: 2 });
  // My games: the profile and the takeaway journal, counted from three reviewed games (the one the
  // tour went through and two more of the same kind)
  await removeGames(page, 'Pip');
  if ((await page.locator('.game-row', { hasText: 'Maia 700' }).count()) < 3) {
    for (const pgn of MORE_GAMES) {
      await page.getByRole('tab', { name: 'My games' }).click();
      await page.getByLabel('A PGN, or a link to a game').fill(pgn);
      await page.getByRole('button', { name: 'Add and open' }).click();
      await page.waitForSelector('.own-review', { timeout: 30000 });
      await page.getByRole('button', { name: 'Skip' }).click();
      await page.waitForSelector('.moments-numbers', { timeout: 240000 });
      await sleep(500);
    }
  }
  // every game has been through the engine before the picture
  const rows = await page.locator('.game-row', { hasText: 'Maia 700' }).count();
  for (let i = 0; i < rows; i++) {
    await page.getByRole('tab', { name: 'My games' }).click();
    await sleep(400);
    if (!(await page.locator('.game-row', { hasText: 'Maia 700' }).nth(i).locator('.game-new').count())) continue;
    await page.locator('.game-row', { hasText: 'Maia 700' }).nth(i).locator('.game-open').click();
    await page.waitForSelector('.own-review, .moments', { timeout: 30000 });
    if (await page.locator('.own-review').count()) await page.getByRole('button', { name: 'Skip' }).click();
    await page.waitForSelector('.moments-numbers', { timeout: 240000 });
  }
  await page.getByRole('tab', { name: 'My games' }).click();
  await sleep(800);
  await page.screenshot({ path: path.join(out, 'games.png') });
  // the settings window, by itself
  await page.getByRole('tab', { name: 'Analysis board' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await sleep(600);
  const sheet = await page.locator('.settings').first().boundingBox();
  await page.locator('.settings').first().screenshot({ path: path.join(out, 'settings.png') });
  await page.keyboard.press('Escape');
  await freshBoard(page);
  await context.close();
  // the same page in light mode, with another board and other pieces
  const before = { 'display.boardTheme': 'blue', 'display.pieceSet': 'merida' };
  await setSetting('display.boardTheme', 'brown');
  await setSetting('display.pieceSet', 'cburnett');
  const light = await open({ scale: 2, scheme: 'light' });
  await freshBoard(light.page);
  await loadGame(light.page, `${GAME} 6. Nxf7 Qxe4+ 7. Qe2 Qxe2+ 8. Kxe2 Kxf7`);
  await light.page.getByRole('button', { name: 'Label every move' }).click();
  await settle(light.page, 1500);
  for (let i = 0; i < 5; i++) await light.page.keyboard.press('ArrowLeft');
  await settle(light.page, 2500);
  await light.page.evaluate(() => document.activeElement?.blur?.()); // no focus ring on the button just pressed
  // the moves, the explorer and the board, cut to the shape of the settings window so the two sit side by side
  await light.page.screenshot({ path: path.join(out, 'light.png'), clip: { x: 0, y: 52, width: 860, height: Math.round((860 * sheet.height) / sheet.width) } });
  await freshBoard(light.page);
  await light.context.close();
  for (const [key, value] of Object.entries(before)) await setSetting(key, value);
  console.log('saved games.png, settings.png and light.png in', out);
}

if (mode === 'banner') {
  // the banner is drawn inside the app's own page, so it has the app's fonts and its mark
  const { context, page } = await open({ scale: 2, height: 340 });
  await page.evaluate(() => {
    const mark = document.querySelector('.mark').cloneNode(true);
    const banner = document.createElement('div');
    banner.id = 'banner';
    banner.innerHTML = `
      <div class="b-board"></div>
      <div class="b-text">
        <div class="b-title"></div>
        <p class="b-line">A personal chess coach on a web page. It asks before it tells,<br>and Stockfish checks every word it says.</p>
        <p class="b-tags"><span>Game review</span><span>Openings</span><span>Puzzles</span><span>Bots</span><span>Endgames</span></p>
      </div>`;
    banner.querySelector('.b-title').append(mark, 'Chess Coach');
    document.body.append(banner);
  });
  await page.addStyleTag({
    content: `
    html, body { background: transparent !important; }
    #root { display: none; }
    #banner { position: fixed; inset: 0; overflow: hidden; border-radius: 22px; color: #f5f5f7; display: flex; align-items: center;
      background: radial-gradient(900px 420px at 0% 0%, rgba(242, 171, 60, 0.2), transparent 62%), radial-gradient(760px 460px at 100% 100%, rgba(10, 132, 255, 0.22), transparent 64%), #151517; }
    #banner .b-board { position: absolute; right: -70px; top: -120px; width: 620px; height: 620px; transform: rotate(-12deg); border-radius: 14px;
      background: repeating-conic-gradient(#8ca2ad 0% 25%, #dee3e6 0% 50%) 0 0 / 155px 155px; opacity: 0.2;
      -webkit-mask-image: linear-gradient(to left, #000 20%, transparent 92%); mask-image: linear-gradient(to left, #000 20%, transparent 92%); }
    #banner .b-text { position: relative; padding: 0 64px; }
    #banner .b-title { display: flex; align-items: center; gap: 22px; font: 600 82px/1 var(--font-book); letter-spacing: -0.025em; }
    #banner .mark { width: 84px; height: 84px; border-radius: 21px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(0, 0, 0, 0.25); }
    #banner .b-line { margin: 26px 0 0; font: 400 23px/1.45 var(--font-ui); color: rgba(245, 245, 247, 0.74); letter-spacing: -0.012em; }
    #banner .b-tags { margin: 26px 0 0; display: flex; gap: 10px; }
    #banner .b-tags span { font: 600 13px/1 var(--font-ui); letter-spacing: 0.02em; color: #f2ab3c; background: rgba(242, 171, 60, 0.13); border: 1px solid rgba(242, 171, 60, 0.36); padding: 8px 12px; border-radius: 999px; }`,
  });
  await sleep(600);
  await page.screenshot({ path: path.join(out, 'banner.png'), omitBackground: true });
  await context.close();
  console.log('saved', path.join(out, 'banner.png'));
}
await browser.close();
