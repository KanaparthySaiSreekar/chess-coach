// The page in a real browser (ARCHITECTURE §17: "Playwright, one happy path per phase").
// A real server is started here around an App with a scripted coach and a stand-in bot, on a free
// port and a throwaway data folder, and Chrome is driven against the built page.
//
//   npm run test:page        (builds the page first; needs Stockfish and Chrome; on AC power)

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gateV1Convert, gateV1Safety, gateV1Threat, legalMoves, mustPosition, playLine, speechChunks, spokenMessage, type ConvertItem, type RepLine, type SafetyItem, type ServerMsg, type ThreatItem } from '@chess-coach/core';
import { App } from '../../server/src/app.ts';
import type { MoveSource } from '../../server/src/bots/service.ts';
import type { CoachTransport, TransportEvents } from '../../server/src/coach/transport.ts';
import { config } from '../../server/src/config.ts';
import { serve, type Served } from '../../server/src/http.ts';
import { wavBytes, type VoiceEngines } from '../../server/src/voice.ts';
import { fakeSites, ongoingCc } from '../../server/test/fake-sites.ts';
import { TEST_REPERTOIRE } from '../../core/test/fixtures/repertoire.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A coach process the test scripts: for each event it gets, it runs the next queued step.
type Step = (app: App, event: Record<string, any>) => Promise<void>;
class ScriptedCoach implements CoachTransport {
  running = false;
  steps: Step[] = [];
  app!: App;
  events: TransportEvents;
  constructor(events: TransportEvents) {
    this.events = events;
  }
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
  }
  send(text: string) {
    const event = JSON.parse(text);
    const step = this.steps.shift();
    void (async () => {
      await sleep(5);
      if (step) await step(this.app, event);
      this.events.result({ isError: false, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, apiMs: 1 });
    })();
  }
}

// stand-ins for the voice (A20, A21): a short silence for every sentence, and the owner always heard saying "Hint."
const voiceHeard: number[] = [];
const fakeVoice: VoiceEngines = {
  loadSpeaker: async () => ({ speak: async () => ({ samples: new Float32Array(2400), rate: 24000 }) }),
  loadListener: async () => ({
    listen: async (samples) => {
      voiceHeard.push(samples.length);
      return ' Hint. ';
    },
  }),
};

// a stand-in for Maia: always the first legal move
const firstMoveBot: MoveSource = {
  state: 'ready',
  probabilities: async (req) => {
    const r = playLine(req.startFen, req.moves);
    if (!r.ok) throw new Error('bad history');
    return [{ uci: legalMoves(mustPosition(r.fens.at(-1)!))[0]!.uci, p: 1 }];
  },
  stop: () => {},
};

describe('the page in a browser', () => {
  let dir: string;
  let app: App;
  let coach: ScriptedCoach | undefined;
  let served: Served;
  let browser: Browser;
  let page: Page;
  const errors: string[] = [];
  const quiet = { send: (_m: ServerMsg) => {} };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-page-'));
    // the fake microphone's recording: a second of quiet, a second of a voice-like tone, quiet again
    const mic = new Float32Array(48000 * 4.5);
    for (let i = 48000; i < 96000; i++) mic[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 48000) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / 48000));
    writeFileSync(path.join(dir, 'mic.wav'), wavBytes(mic, 48000));
    app = new App({
      repoRoot: config.repoRoot,
      dataDir: dir,
      stockfish: config.stockfish,
      syzygy: config.syzygy,
      claudePath: 'unused',
      openingsDir: config.openingsDir,
      mcpUrl: 'http://127.0.0.1:1/mcp',
      cloud: null,
      botSource: firstMoveBot,
      botNoDelay: true,
      sites: fakeSites().http,
      lichessToken: () => 'page-test-token',
      powerProbe: async () => true,
      voice: { dir: path.join(dir, 'voice'), engines: fakeVoice, checkFiles: false },
      makeTransport: (events) => {
        coach = new ScriptedCoach(events);
        coach.app = app;
        return coach;
      },
    });
    app.engine.signature = 'page-test';
    served = await serve(app, { host: '127.0.0.1', port: 0, webDist: path.join(config.repoRoot, 'packages', 'web', 'dist') });
    // a fake microphone that plays mic.wav, and sound allowed without a click (the voice, A20, A21)
    browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(dir, 'mic.wav')}%noloop`, '--autoplay-policy=no-user-gesture-required'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', permissions: ['microphone'] });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    // count the server's answers to a move (a board's state, a refusal), so that a drag can wait for its answer
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      const kinds = new Set(['state', 'toast', 'game', 'puzzle', 'endgame', 'opening', 'safety', 'threat', 'convert', 'speed']);
      const w = window as unknown as { ccAnswers?: number };
      class Counted extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener('message', (e) => {
            try {
              if (kinds.has((JSON.parse(String(e.data)) as { type: string }).type)) w.ccAnswers = (w.ccAnswers ?? 0) + 1;
            } catch {
              /* not JSON */
            }
          });
        }
      }
      window.WebSocket = Counted;
    });
    await page.goto(served.url);
    await page.waitForSelector('.board piece', { timeout: 20_000 });
  });

  afterAll(async () => {
    await browser?.close();
    await served?.close();
    await app?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // every test starts from a clean analysis board, the coach off, no dialog open
  beforeEach(async () => {
    await page.keyboard.press('Escape');
    await app.onClientMessage(quiet, { type: 'coach', action: 'stop' });
    await app.onClientMessage(quiet, { type: 'mode', mode: 'analysis' });
    await app.onClientMessage(quiet, { type: 'new' });
    await app.onClientMessage(quiet, { type: 'clear_thread' });
    await app.onClientMessage(quiet, { type: 'preset', id: 'default' });
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 0);
  });

  /** Drag a piece from one square to another on the board that is showing (White at the bottom). */
  const drag = async (from: string, to: string, board = '.board') => {
    const box = (await page.locator(board).first().boundingBox())!;
    const sq = box.width / 8;
    const xy = (s: string): [number, number] => [box.x + (s.charCodeAt(0) - 97 + 0.5) * sq, box.y + (7 - (Number(s[1]) - 1) + 0.5) * sq];
    const [x1, y1] = xy(from);
    const [x2, y2] = xy(to);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
    await page.mouse.move(x2, y2, { steps: 4 });
    const before = await answers();
    await page.mouse.up();
    // the next drag waits for the server's answer to this one: on a slow, hot laptop the page could otherwise still be showing
    // the turn before, and the next piece would not move (seen 2026-11-25). A drop that sends nothing waits out the timeout.
    await expect.poll(answers, { timeout: 1500, interval: 25 }).toBeGreaterThan(before).catch(() => {});
  };
  /** How many answers to a move (a board's state, a refusal) the page has had from the server. */
  const answers = () => page.evaluate(() => (window as unknown as { ccAnswers?: number }).ccAnswers ?? 0);
  /** Press one square of the board that is showing. */
  const press = async (square: string, board = '.board') => {
    const box = (await page.locator(board).first().boundingBox())!;
    const sq = box.width / 8;
    await page.mouse.click(box.x + (square.charCodeAt(0) - 97 + 0.5) * sq, box.y + (7 - (Number(square[1]) - 1) + 0.5) * sq);
  };
  const moves = async () => (await page.locator('.moves-scroll .san').allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
  const focusFen = () => app.session.focusFen();
  const menu = async (name: string, item: string | RegExp) => {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };

  // ------------------------------------------------------------ Phase 3

  it('plays moves, steps back and branches into a side line (WP 3.7)', async () => {
    await drag('e2', 'e4');
    await drag('e7', 'e5');
    await drag('g1', 'f3');
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 3);
    expect(focusFen()).toContain('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b');
    // an illegal move is refused and the piece goes back
    await drag('a7', 'a4');
    await sleep(300);
    expect(await moves()).toHaveLength(3);
    // back one move, then a different move: a side line, the main line kept
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('.moves-scroll .san.current')?.textContent?.includes('e5'));
    await drag('f1', 'c4');
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 4);
    const tree = app.session.state.tree;
    const e5 = Object.values(tree.nodes).find((n) => n.san === 'e5')!;
    expect(e5.children.map((c) => tree.nodes[c]!.san)).toEqual(['Nf3', 'Bc4']);
    // Home and End walk the main line
    await page.keyboard.press('Home');
    await page.waitForFunction(() => !document.querySelector('.moves-scroll .san.current'));
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.moves-scroll .san.current')?.textContent?.includes('f3'));
  });

  it('pastes a PGN, steps through it, and switches the engine lines on and off (WP 3.8)', async () => {
    await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
    await page.locator('.modal textarea').fill('[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 (3... Nf6 4. Ng5) 4. c3 1-0');
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 9);
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.moves-scroll .san.current')?.textContent?.includes('c3'));
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(focusFen()).toContain('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b');
    // engine lines are hidden until switched on (Phase 3, done-when 3)
    expect(await page.locator('.pane-section.engine').count()).toBe(0);
    await page.getByRole('button', { name: 'View' }).click();
    await page.getByRole('switch', { name: 'Engine lines' }).click();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pane-section.engine', { timeout: 20_000 });
    await page.getByRole('button', { name: 'View' }).click();
    await page.getByRole('switch', { name: 'Engine lines' }).click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.pane-section.engine'));
    // a PGN that says the game is still being played is refused (fair play)
    await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
    await page.locator('.modal textarea').fill('[Result "*"]\n\n1. d4 d5 *');
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.waitForSelector('.toast.error');
    expect(await page.locator('.toast.error').innerText()).toMatch(/still in progress/);
    expect(await moves()).toHaveLength(9);
  });

  it('sets up a position in the board editor and sends it to the analysis board (WP 3.8, I2)', async () => {
    await menu('Game', 'Set up a position…');
    await page.waitForSelector('.layout.editor');
    const state = page.locator('.setup-state');
    expect(await state.innerText()).toMatch(/A legal position, white to move/);
    // an empty board is not a position, and says why; the button is off
    await page.getByRole('button', { name: 'Clear the board' }).click();
    await expect.poll(() => state.innerText()).toMatch(/board is empty/);
    expect(await page.getByRole('button', { name: 'Analyse this position' }).isDisabled()).toBe(true);
    // place the two kings and a white rook by picking a piece and pressing squares
    await page.getByRole('button', { name: 'white king' }).click();
    await press('e1');
    await expect.poll(() => state.innerText()).toMatch(/exactly one king/);
    await page.getByRole('button', { name: 'black king' }).click();
    await press('e8');
    await page.getByRole('button', { name: 'white rook' }).click();
    await press('a1');
    await press('h1');
    await expect.poll(() => state.innerText()).toMatch(/A legal position, white to move/);
    expect(await page.locator('#ed-fen').inputValue()).toBe('4k3/8/8/8/8/8/8/R3K2R w - - 0 1');
    // castling is offered only where the king and that rook stand on their first squares
    expect(await page.getByRole('checkbox', { name: 'White, short (O-O)' }).isEnabled()).toBe(true);
    expect(await page.getByRole('checkbox', { name: 'Black, short (O-O)' }).isEnabled()).toBe(false);
    await page.getByRole('checkbox', { name: 'White, short (O-O)' }).check();
    expect(await page.locator('#ed-fen').inputValue()).toBe('4k3/8/8/8/8/8/8/R3K2R w K - 0 1');
    // pressing the same piece again takes it off; the eraser clears a square
    await press('h1');
    await expect.poll(() => page.locator('#ed-fen').inputValue()).toBe('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    await page.getByRole('button', { name: 'Erase' }).click();
    await press('a1');
    await expect.poll(() => page.locator('#ed-fen').inputValue()).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    // a pasted FEN loads; the side that is not to move may not be in check
    await page.locator('#ed-fen').fill('4k3/8/8/8/8/8/8/4RK2 w - - 0 1');
    await expect.poll(() => state.innerText()).toMatch(/not to move is in check/);
    await page.getByRole('radio', { name: 'Black' }).click();
    await expect.poll(() => state.innerText()).toMatch(/A legal position, black to move/);
    await page.getByRole('button', { name: 'Analyse this position' }).click();
    await page.waitForFunction(() => !document.querySelector('.layout.editor'));
    expect(focusFen()).toBe('4k3/8/8/8/8/8/8/4RK2 b - - 0 1');
    expect(app.session.state.tree.rootFen).toBe('4k3/8/8/8/8/8/8/4RK2 b - - 0 1');
    // only a legal move can be played from it: the king must leave the e-file
    await drag('e8', 'e7');
    await sleep(300);
    expect(await moves()).toHaveLength(0);
    await drag('e8', 'd7');
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 1);
    // Escape leaves the editor without changing anything
    await menu('Game', 'Set up a position…');
    await page.waitForSelector('.layout.editor');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.layout.editor'));
    expect(await moves()).toHaveLength(1);
  });

  it('switches modes, resets the board and toggles from the View menu (WP 3.10)', async () => {
    await drag('e2', 'e4');
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 1);
    // the View menu's switches are the same settings as the settings window
    await page.getByRole('button', { name: 'View' }).click();
    const bar = page.getByRole('switch', { name: 'Eval bar' });
    expect(await bar.getAttribute('aria-checked')).toBe('true');
    await bar.click();
    await page.waitForFunction(() => !document.querySelector('.board-pair.with-bar'));
    await bar.click();
    await page.waitForSelector('.board-pair.with-bar');
    await page.keyboard.press('Escape');
    // to the bots and back: the analysis board is kept
    await page.getByRole('tab', { name: 'Play a bot' }).click();
    await page.waitForSelector('.layout.play');
    await page.getByRole('tab', { name: 'Analysis board' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 1);
    // reset, from the dialog
    await page.getByRole('button', { name: 'Reset board' }).click();
    await page.getByRole('dialog', { name: 'Reset the board' }).getByRole('button', { name: 'Reset to the starting position' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 0);
  });

  it('the View menu scrolls to its last setting in a short window, every row at its full height', async () => {
    await page.setViewportSize({ width: 1280, height: 620 });
    try {
      await page.getByRole('button', { name: 'View' }).click();
      const menu = page.locator('.view-menu');
      await menu.waitFor();
      // the owner's report: the groups were squeezed to fit and clipped, so there was nothing to scroll
      const sizes = await menu.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, clipped: [...el.querySelectorAll('.group')].filter((g) => g.scrollHeight > g.clientHeight + 1).length, swatchesOut: [...el.querySelectorAll('.swatch')].filter((s) => s.getBoundingClientRect().right > el.getBoundingClientRect().right).length }));
      expect(sizes.clipped).toBe(0);
      expect(sizes.swatchesOut).toBe(0);
      expect(sizes.scroll).toBeGreaterThan(sizes.client);
      const box = (await menu.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 3000);
      await expect.poll(() => menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await expect.poll(() => page.getByRole('button', { name: 'All settings…' }).evaluate((b) => b.getBoundingClientRect().bottom <= b.closest('.view-menu')!.getBoundingClientRect().bottom + 1)).toBe(true);
      await page.keyboard.press('Escape');
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });

  it('keeps the keyboard inside a dialog and moves through a menu with the arrow keys (WP 3.11)', async () => {
    // the Game menu: Down moves through it, Escape closes it and gives the focus back
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    const firstItem = await page.evaluate(() => document.activeElement?.textContent);
    expect(firstItem).toMatch(/Load a PGN or FEN/);
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/Set up a position/);
    await page.keyboard.press('End');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/Settings/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
    expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/Game/);
    // the settings window: Ctrl+comma opens it, Tab never leaves it, Escape closes it
    await page.keyboard.press('Control+,');
    await page.waitForSelector('.modal.settings');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.modal.settings'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.modal.settings'));
    // light and dark are both there (the Appearance setting)
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.appearance', value: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.appearance', value: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    // another piece set changes the pictures on the board (I9)
    const knight = () => page.evaluate(() => getComputedStyle(document.querySelector('.board piece.knight.white')!).backgroundImage);
    const classic = await knight();
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.pieceSet', value: 'merida' });
    await page.waitForFunction(() => document.documentElement.dataset.pieces === 'merida');
    const merida = await knight();
    expect(merida).toMatch(/^url\(/);
    expect(merida).not.toBe(classic);
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.pieceSet', value: 'cburnett' });
    await page.waitForFunction(() => !document.documentElement.dataset.pieces);
    expect(await knight()).toBe(classic);
  });

  it("keeps the owner's drawings with the position (WP 3.2)", async () => {
    await drag('e2', 'e4');
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 1);
    // a right-button drag draws an arrow
    const box = (await page.locator('.board').boundingBox())!;
    const sq = box.width / 8;
    const xy = (s: string): [number, number] => [box.x + (s.charCodeAt(0) - 97 + 0.5) * sq, box.y + (7 - (Number(s[1]) - 1) + 0.5) * sq];
    await page.mouse.move(...xy('d7'));
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(...xy('d5'), { steps: 5 });
    await page.mouse.up({ button: 'right' });
    await expect.poll(() => app.session.focusNode().drawings).toEqual([{ from: 'd7', to: 'd5', color: 'green' }]);
    // it is gone on another position and back on this one, and it is in the exported PGN
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => app.session.state.shapes.owner).toEqual([]);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => app.session.state.shapes.owner).toHaveLength(1);
    await page.waitForFunction(() => document.querySelectorAll('.cg-shapes g line').length >= 1);
    expect(app.session.pgn()).toContain('[%cal Gd7d5]');
    await menu('Game', 'Clear my drawings on this position');
    await expect.poll(() => app.session.focusNode().drawings).toBeUndefined();
  });

  // ------------------------------------------------------------ Phase 4

  it('labels a move, shows what it loses, and draws the better move in green (WP 4.11, 4.13)', async () => {
    await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
    await page.locator('.modal textarea').fill('[Result "1-0"]\n\n1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O Nxe4 5.Re1 Nd6 6.Bf1 f6 7.d4 Nc4 8.Bd3 d6 9.Bxc4 Qe7 10.a4 Qe6 1-0');
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.keyboard.press('End');
    await page.waitForSelector('.verdict', { timeout: 30_000 });
    await expect.poll(() => page.locator('.verdict').innerText(), { timeout: 30_000 }).toMatch(/e6 is a (mistake|blunder): it loses a queen for a bishop\./);
    expect(await page.locator('.verdict .better-move').innerText()).toMatch(/\w/);
    // the better move is on the board as a green arrow, in its own brush
    await page.waitForFunction(() => !!document.querySelector('.cg-shapes g[cgHash*="better"], .cg-shapes line[stroke="#58a81c"], .cg-custom-svgs path[stroke="#58a81c"]'), undefined, { timeout: 30_000 });
    // switching the setting off takes the arrow away and leaves the sentence
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.betterMoveArrow', value: false });
    await page.waitForFunction(() => !document.querySelector('.cg-shapes line[stroke="#58a81c"], .cg-custom-svgs path[stroke="#58a81c"]'));
    expect(await page.locator('.verdict').innerText()).toMatch(/was best/);
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.betterMoveArrow', value: true });
    // a knight's best move is drawn bent like the move: a path with a corner, not a straight line
    await app.onClientMessage(quiet, { type: 'new' });
    await drag('e2', 'e4');
    await drag('e7', 'e5');
    await page.waitForFunction(() => !!document.querySelector('.cg-custom-svgs path[stroke="#6f4bd8"]'), undefined, { timeout: 30_000 });
    const d = await page.locator('.cg-custom-svgs path[stroke="#6f4bd8"]').first().getAttribute('d');
    expect(d).toMatch(/^M50 50L50 -150L/);
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.knightArrows', value: 'straight' });
    await page.waitForFunction(() => !document.querySelector('.cg-custom-svgs path[stroke="#6f4bd8"]'));
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.knightArrows', value: 'bent' });
  });

  it('starts the coach from the page, shows its checked message with a clickable move, and answers a chip with the coach off (WP 4.7, 4.8)', async () => {
    await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
    await page.locator('.modal textarea').fill('[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. Nxe5 Qd4 1-0');
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await page.keyboard.press('End');
    await page.getByRole('button', { name: 'Start coach' }).click();
    await page.waitForSelector('.coach-state');
    // the scripted coach reads the facts and says one true thing, citing the fact
    const said: any = {};
    await expect.poll(() => !!coach).toBe(true);
    coach!.steps.push(async (a, ev) => {
      const hangs = ev.facts.facts.find((f: any) => f.type === 'hangs' && /knight/.test(f.text));
      said.fact = hangs;
      said.result = await a.tools.say({ seq: ev.seq, kind: 'explain', text: `Your knight {pc:Ne5} can be taken for free.`, claims: [hangs.id] });
    });
    await page.getByRole('textbox', { name: /Ask the coach/ }).fill('why is my knight in danger?');
    await page.keyboard.press('Enter');
    await expect.poll(() => said.result?.ok, { timeout: 40_000 }).toBe(true);
    await page.waitForSelector('.msg-coach');
    expect(await page.locator('.thread').innerText()).toMatch(/Your knight .* can be taken for free/);
    // an invented claim never reaches the page
    coach!.steps.push(async (a, ev) => {
      said.bad = await a.tools.say({ seq: ev.seq, kind: 'explain', text: 'Play {m:Qh5}: it wins a rook.', claims: [] });
    });
    await page.getByRole('textbox', { name: /Ask the coach/ }).fill('what should I do?');
    await page.keyboard.press('Enter');
    await expect.poll(() => said.bad?.ok, { timeout: 40_000 }).toBe(false);
    expect(await page.locator('.thread').innerText()).not.toMatch(/wins a rook/);
    // with the coach off, a chip is still answered from the same facts
    await page.getByRole('button', { name: 'Stop coach' }).click();
    await page.getByRole('button', { name: 'Start coach' }).waitFor();
    const before = await page.locator('.msg-coach').count();
    await page.getByRole('group', { name: 'Quick replies' }).getByRole('button').first().click();
    await expect.poll(() => page.locator('.msg-coach').count(), { timeout: 30_000 }).toBeGreaterThan(before);
  });

  it('the voice: text by default; switched on, a spoken "hint" is the Hint button and the reply is read out in words (A20, A21)', async () => {
    const spoken: string[] = [];
    const onRequest = (r: { url: () => string; postData: () => string | null }) => {
      if (r.url().endsWith('/api/voice/speak')) spoken.push((JSON.parse(r.postData() ?? '{}') as { text: string }).text);
    };
    page.on('request', onRequest);
    try {
      // text is the default: no microphone, the speaker off
      expect(await page.locator('.mic').count()).toBe(0);
      expect(await page.getByRole('switch', { name: 'The coach speaks aloud' }).first().getAttribute('aria-checked')).toBe('false');
      // both switched on from the View menu
      await page.getByRole('button', { name: /View/ }).click();
      await page.locator('.view-menu .quick-row', { hasText: 'The coach speaks aloud' }).getByRole('switch').click();
      await page.locator('.view-menu .quick-row', { hasText: 'Talk instead of typing' }).getByRole('switch').click();
      await page.keyboard.press('Escape');
      await page.waitForSelector('.mic');
      // a position with something to find
      await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
      await page.locator('.modal textarea').fill('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. Nxe5 Qd4');
      await page.getByRole('button', { name: 'Load', exact: true }).click();
      await page.keyboard.press('End');
      // the microphone: it opens, hears the recording, closes by itself at the pause, and the words are the Hint button
      const heardBefore = voiceHeard.length;
      await page.locator('.mic').click();
      await page.waitForSelector('.voice-caption');
      await expect.poll(() => voiceHeard.length, { timeout: 30_000 }).toBe(heardBefore + 1);
      // what was sent: the recording at 16 kHz, from about the first second to the pause after the tone
      expect(voiceHeard.at(-1)!).toBeGreaterThan(16000 * 2);
      await expect.poll(() => page.locator('.msg-owner').last().innerText(), { timeout: 30_000 }).toBe('Hint');
      await expect.poll(() => app.session.thread.filter((m) => m.from === 'coach').length, { timeout: 30_000 }).toBeGreaterThan(0);
      // the reply (from the facts, the coach is off) is read out: its first sentence, moves in words
      const reply = app.session.thread.filter((m) => m.from === 'coach').at(-1)!;
      await expect.poll(() => spoken.length, { timeout: 30_000 }).toBeGreaterThan(0);
      expect(spoken[0]).toBe(speechChunks(spokenMessage(reply))[0]);
      expect(await page.locator('.mic').count()).toBe(1);
      expect(await page.locator('.voice-caption').count()).toBe(0);
      // the speaker in the coach's head switches the voice off again
      await page.getByRole('switch', { name: 'The coach speaks aloud' }).first().click();
      await expect.poll(() => app.settings.get('voice.speak')).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      page.off('request', onRequest);
      await app.onClientMessage(quiet, { type: 'setting', key: 'voice.speak', value: false });
      await app.onClientMessage(quiet, { type: 'setting', key: 'voice.listen', value: false });
    }
  });

  // ------------------------------------------------------------ Phase 7

  it('plays a game against a bot with a clock, and the finished game goes to the library and the analysis board (WP 7.3)', async () => {
    await page.getByRole('tab', { name: 'Play a bot' }).click();
    await page.waitForSelector('.layout.play');
    await page.locator('.bot').first().click();
    // no clock by default; a rapid one when asked
    await expect.poll(() => page.locator('.time-controls .chip.on').innerText()).toBe('No clock');
    await page.locator('.time-controls .chip', { hasText: '10 + 5' }).click();
    await expect.poll(() => page.locator('.time-controls .chip.on').innerText()).toBe('10 + 5');
    await page.getByRole('button', { name: /^Play / }).click();
    await expect.poll(() => app.play.game.status).toBe('playing');
    expect(app.play.game.time).toEqual({ base: 600, inc: 5 });
    await expect.poll(() => page.locator('.play-side .clock').count()).toBe(2);
    expect(await page.locator('.your-clock .clock').innerText()).toMatch(/^(10:00|9:5\d)$/);
    const you = app.play.game.you;
    if (you === 'black') await expect.poll(() => Object.keys(app.play.game.tree.nodes).length).toBeGreaterThan(1);
    // one move each: the bot answers
    const n = Object.keys(app.play.game.tree.nodes).length;
    await drag(you === 'white' ? 'e2' : 'e7', you === 'white' ? 'e4' : 'e5');
    await expect.poll(() => Object.keys(app.play.game.tree.nodes).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(n + 1);
    // nothing from the engine is shown during a game
    expect(await page.locator('.evalbar, .verdict').count()).toBe(0);
    await page.getByRole('button', { name: 'Resign' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect.poll(() => app.play.game.status).toBe('over');
    // the finished game is in the library, with the owner's side and its clock
    const saved = app.db.getGame(app.play.game.libraryId!)!;
    expect(saved).toMatchObject({ you, outcome: 'loss', timeControl: '10+5' });
    await page.getByRole('button', { name: /Review/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length >= 1);
    expect(app.mode).toBe('analysis');
    expect(app.session.state.game?.id).toBe(saved.id);
    await app.onClientMessage(quiet, { type: 'setting', key: 'play.timeControl', value: 'untimed' });
    await app.onClientMessage(quiet, { type: 'library', action: 'remove', id: saved.id });
  });

  it('a mini-game: picked, its position and goal shown, played against a bot, and finished (WP 7.6)', async () => {
    await page.getByRole('tab', { name: 'Play a bot' }).click();
    await page.waitForSelector('.layout.play');
    if (app.play.game.status !== 'idle') await app.onClientMessage(quiet, { type: 'game', action: 'new' });
    await page.locator('.mini', { hasText: 'Queen against pawns' }).click();
    await expect.poll(() => page.locator('.play-side').innerText()).toMatch(/Goal: Take every pawn before one becomes a queen\./);
    // the board shows the mini-game's position: eight black pawns, a white queen
    await expect.poll(() => page.locator('.layout.play .board piece.pawn.black').count()).toBe(8);
    expect(await page.locator('.layout.play .board piece.queen.white').count()).toBe(1);
    await page.getByRole('button', { name: /^Play it against / }).click();
    await expect.poll(() => app.play.game.mini?.id).toBe('queen-vs-pawns');
    await expect.poll(() => page.locator('.play-side').innerText()).toMatch(/Queen against pawns\. Take every pawn/);
    // a move: the queen takes a pawn; the bot answers
    await drag('d1', 'd7');
    await expect.poll(() => Object.keys(app.play.game.tree.nodes).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: 'Resign' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect.poll(() => app.play.game.status).toBe('over');
    // not one of the owner's games: it stays out of the library
    expect(app.play.game.libraryId).toBeUndefined();
    await expect.poll(() => page.getByRole('button', { name: 'Play it again' }).count()).toBe(1);
    await app.onClientMessage(quiet, { type: 'game', action: 'new' });
  });

  // ------------------------------------------------------------ Phase 5

  it("fetches the owner's games, lists them, opens one, and refuses a game in progress (WP 5.1, 5.2)", async () => {
    await app.onClientMessage(quiet, { type: 'setting', key: 'puzzles.fromGames', value: false });
    // no standing fair-play banner on the analysis board (the owner asked for its room back): the guard works without it
    expect(await page.locator('.layout:not(.games) .pane-left .notice').count()).toBe(0);
    await page.getByRole('tab', { name: 'My games' }).click();
    await page.waitForSelector('.layout.games');
    expect(await page.locator('.games-empty').count()).toBe(1);
    for (const [label, name] of [['Lichess', 'OwnerLichess'], ['Chess.com', 'OwnerChessCom']] as const) {
      const box = page.getByLabel(label, { exact: true });
      await box.fill(name);
      await box.press('Enter');
    }
    await page.getByRole('button', { name: 'Fetch new games' }).click();
    await expect.poll(() => page.locator('.game-row').count(), { timeout: 15_000 }).toBe(7);
    await expect.poll(() => page.locator('.games-head').innerText()).toMatch(/7 games · won 5, lost 1, drew 1/);
    await expect.poll(() => page.locator('.accounts').innerText()).toMatch(/2 games in progress/);
    await page.getByRole('radio', { name: 'Lost' }).click();
    await expect.poll(() => page.locator('.game-row').count()).toBe(1);
    // open it: the analysis board, the owner's side at the bottom, the game named above the moves
    await page.locator('.game-open').first().click();
    await page.waitForSelector('.board piece');
    await expect.poll(() => app.mode).toBe('analysis');
    expect(app.session.state.orientation).toBe('black');
    await expect.poll(() => page.locator('.opening').first().innerText()).toMatch(/1-0\s*rival_a – OwnerChessCom/);
    expect(await page.locator('.pane-left .notice').count()).toBe(0);
    // first the owner's own review (WP 5.5): nothing from the engine is on the page while it lasts
    await page.waitForSelector('.own-review');
    await page.keyboard.press('End');
    await expect.poll(() => page.locator('.own-review .btn').first().isEnabled()).toBe(true);
    await page.getByRole('button', { name: 'Mark this move as a turning point' }).click();
    await expect.poll(() => page.locator('.own-marks li').count()).toBe(1);
    expect(await page.locator('.moment, .verdict').count()).toBe(0);
    expect(await page.locator('.caption-held').innerText()).toMatch(/going through this game yourself first/);
    // the opening explorer keeps to the same gate (WP 8.2)
    await expect.poll(() => page.locator('.explorer').innerText()).toMatch(/going through this game yourself first/);
    expect(await page.locator('.explorer .ex-row').count()).toBe(0);
    await page.getByLabel('Your thoughts on the game').fill('I lost the thread in the middlegame.');
    await page.getByRole('button', { name: "Done: show the engine's view" }).click();
    // then the engine's view: its key moments appear under the moves, the first turning point marked (WP 5.3)
    await expect.poll(() => page.locator('.moment').count(), { timeout: 90_000 }).toBeGreaterThan(0);
    expect(await page.locator('.own-notes').innerText()).toMatch(/I lost the thread/);
    expect(await page.locator('.moment').count()).toBeLessThanOrEqual(3);
    expect(await page.locator('.moment-first').count()).toBe(1);
    expect(await page.locator('.moments-numbers').innerText()).toMatch(/^Your \d+ moves:/);
    await page.locator('.moment').first().click();
    await expect.poll(() => page.locator('.moment.current').count()).toBe(1);
    await expect.poll(() => page.locator('.verdict').innerText()).toMatch(/blunder|mistake|misses/i);
    // the written report (WP 5.7): takeaways from the game, the owner's own word for a tag, a note for next time
    await app.onClientMessage(quiet, { type: 'setting', key: 'review.chart', value: true });
    await page.locator('.report-open').click();
    await page.waitForSelector('.report');
    // the chart is an option; pointing at it reads out the move and how the game stood, in words
    await page.locator('.report-chart').scrollIntoViewIfNeeded();
    await page.locator('.report-chart').hover({ position: { x: 40, y: 40 } });
    await expect.poll(() => page.locator('.report-chart-tip').innerText()).toMatch(/(You are (winning|better|worse|losing)|About even)\s+\d+\.+ \S+/);
    expect(await page.locator('.report-chart-tip').innerText()).not.toMatch(/%/);
    expect(await page.locator('.report-takeaways li').count()).toBeGreaterThan(0);
    expect(await page.locator('.report-takeaways li').count()).toBeLessThanOrEqual(4);
    await page.locator('.report-moment select').first().selectOption('time');
    await expect.poll(() => app.review?.moments[0]?.stepBy).toBe('owner');
    await expect.poll(() => page.locator('.report-moment').first().innerText()).toMatch(/Your own word for it/);
    await page.getByLabel('A note for next time').fill('Check their last move first.');
    // Escape closes the report, like every other dialog (and the note is saved as the box loses the focus)
    await page.keyboard.press('Escape');
    await expect.poll(() => app.review?.ownerNote).toBe('Check their last move first.');
    expect(await page.locator('.report').count()).toBe(0);
    // going through them with the coach (WP 5.6): the position before the first mistake goes on the board, and
    // the coach asks about it or shows it (this coach says nothing, so the scripted one speaks)
    const focusBefore = app.session.state.focus;
    const said = await page.locator('.msg-coach').count();
    await page.getByRole('button', { name: /^Go through (it|them) with the coach$/ }).click();
    await page.waitForSelector('.replay-bar');
    await expect.poll(() => page.locator('.replay-bar').innerText()).toMatch(/Moment 1 of \d/);
    await expect.poll(() => page.locator('.msg-coach').count(), { timeout: 30_000 }).toBeGreaterThan(said);
    expect(app.session.state.focus).not.toBe(focusBefore);
    expect(app.review?.replay).toMatchObject({ index: 0 });
    // the moment in hand cannot be clicked through to its answer
    expect(await page.locator('.moment').first().isDisabled()).toBe(app.review!.replay!.phase === 'asking');
    await page.locator('.replay-bar').getByRole('button', { name: 'Stop' }).click();
    await expect.poll(() => page.locator('.replay-bar').count()).toBe(0);
    expect(app.review?.replay).toBeUndefined();
    // the position of a Daily game in progress, pasted into the Load dialog: refused, and the board is left as it was
    const before = app.session.state.seq;
    await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
    await page.locator('.modal textarea').fill(ongoingCc.games[1]!.fen);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect.poll(() => page.locator('.toast').innerText()).toMatch(/game in progress on Chess\.com/);
    expect(app.session.state.seq).toBe(before);
    // and the game itself, pasted on the Games screen
    await page.getByRole('tab', { name: 'My games' }).click();
    // the profile (WP 5.8): four figures from the games the engine has been through, and the journal beside them
    await expect.poll(() => page.locator('.profile-tile').count()).toBe(4);
    expect(await page.locator('.profile').innerText()).toMatch(/From 1 analysed game/);
    expect(await page.locator('.profile-value').first().innerText()).toMatch(/^\d/);
    expect(await page.locator('.journal li').count()).toBeGreaterThan(0);
    await page.getByLabel('A PGN, or a link to a game').fill(ongoingCc.games[1]!.pgn);
    await page.getByRole('button', { name: 'Add and open' }).click();
    await expect.poll(() => page.locator('.toast').innerText()).toMatch(/still in progress/);
    await page.getByRole('radio', { name: 'All' }).click();
    expect(await page.locator('.game-row').count()).toBe(7);
  });

  // ------------------------------------------------------------ Phase 6

  it('solves a puzzle on its own board: a miss, a hint, the right moves, and the next one (WP 6.2)', async () => {
    await app.onClientMessage(quiet, { type: 'setting', key: 'content.gateNodes', value: 500_000 });
    const puzzle = (source: string, body: Record<string, unknown>) => app.content.submit({ type: 'puzzle_game', status: 'draft', source, licence: 'own', level: '400–700', gates: [], body: { themes: [], kind: 'mistake', ...body } as never });
    const first = await puzzle('game:900#11', { fen: '1r4k1/5ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1', setup: 'Ra8', solution: ['Rd8+', 'Rxd8', 'Rxd8#'], themes: ['backRankMate'] });
    const second = await puzzle('game:900#21', { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['Rd8#'], themes: ['mateIn1'] });
    expect([first.status, second.status]).toEqual(['live', 'live']);
    await page.getByRole('tab', { name: /^Puzzles/ }).click();
    await page.waitForSelector('.layout.puzzles .board piece');
    // their set-up move is played in front of the owner, then it is the owner's move
    await expect.poll(() => page.locator('.layout.puzzles .turn').innerText(), { timeout: 10_000 }).toMatch(/Your move/);
    expect(await page.locator('.puzzle-task').innerText()).toMatch(/Find the better move/);
    expect(await page.locator('.puzzle-line').innerText()).toMatch(/a8/);
    // nothing from the engine is on the screen while the owner is looking
    expect(await page.locator('.evalbar, .verdict, .puzzle-themes').count()).toBe(0);
    // the idea is new to the owner (WP 6.9): it is named, and a worked example is offered before they try
    expect(await page.locator('.puzzle-guide p').innerText()).toBe('A new idea for you: Back-rank mate. Try it yourself, or watch how it works first.');
    expect(await page.getByRole('button', { name: 'Show me how it works' }).count()).toBe(1);
    // a miss: the piece goes back, and the app says what the move runs into
    await drag('h2', 'h3');
    await expect.poll(() => page.locator('.puzzle-says.wrong').innerText(), { timeout: 20_000 }).toMatch(/^Not that one\. h3/);
    expect(app.puzzles.view.moves).toHaveLength(1);
    // once tried, the example is no longer offered; the idea stays named
    expect(await page.locator('.puzzle-guide p').innerText()).toBe('Look for: Back-rank mate.');
    expect(await page.getByRole('button', { name: 'Show me how it works' }).count()).toBe(0);
    await page.getByRole('button', { name: 'Hint', exact: true }).click();
    await expect.poll(() => page.locator('.puzzle-says.hint').innerText()).toMatch(/checks, your captures/);
    expect(await page.locator('.puzzle-tally').innerText()).toBe('1 hint · 1 miss');
    // the right move, their reply, and the mate
    await drag('d2', 'd8');
    await expect.poll(() => app.puzzles.view.moves.length, { timeout: 10_000 }).toBe(3);
    await expect.poll(() => page.locator('.layout.puzzles .turn').innerText()).toMatch(/Your move/);
    await drag('d1', 'd8');
    await expect.poll(() => page.locator('.puzzle-says.good').innerText(), { timeout: 20_000 }).toMatch(/^Solved\./);
    expect(await page.locator('.puzzle-themes').innerText()).toMatch(/Back-rank mate/);
    // on to the next one, and its answer on request
    await page.getByRole('button', { name: 'Next puzzle' }).click();
    await expect.poll(() => app.puzzles.view.id).toBe(second.id);
    await page.getByRole('button', { name: 'Show the answer' }).click();
    await expect.poll(() => page.locator('.puzzle-says.answer').innerText(), { timeout: 20_000 }).toMatch(/^The answer is on the board\./);
    expect(app.db.attemptsOf(first.id)).toMatchObject([{ result: 'solved', hints: 1, misses: 1 }]);
    expect(app.db.attemptsOf(second.id)).toMatchObject([{ result: 'shown' }]);
    await app.onClientMessage(quiet, { type: 'puzzle', action: 'close' });
  });

  it('asks whether a move is safe, says nothing until the owner answers, then gives each verdict (WP 6.6)', async () => {
    // the position before 3...Nf6 in the Scholar's Mate
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    const nf6 = { san: 'Nf6', safe: false, why: 'Nf6 allows checkmate with Qxf7#.' };
    const g6 = { san: 'g6', safe: true, why: 'g6 blocks the queen.' };
    const save = (key: string, body: SafetyItem) => app.db.saveContent(key, { type: 'safety', status: 'live', source: 'game:901#6', licence: 'own', level: '400–700', gates: [gateV1Safety(body), { gate: 'V6', result: 'pass' }], body } as never);
    const first = save('game:901#6|safety|is_safe|Nf6', { fen, question: 'is_safe', candidates: [nf6], played: 'Nf6' });
    const second = save('game:901#6|safety|which_loses|Nf6,g6', { fen, question: 'which_loses', candidates: [nf6, g6], played: 'Nf6' });
    // checks and captures here; their threats are asked in an engine test of their own (D104)
    await app.onClientMessage(quiet, { type: 'setting', key: 'safety.listThreats', value: false });
    app.safety.refresh();
    await page.getByRole('tab', { name: /^Puzzles/ }).click();
    await page.locator('.puzzle-set', { hasText: 'Safety check' }).click();
    await expect.poll(() => page.locator('.puzzle-task').innerText(), { timeout: 10_000 }).toMatch(/You are thinking of\s*f6\. Before you decide: what can they do after it\?/);
    expect(app.safety.view.id).toBe(first);
    // nothing on the screen says which move is safe while the owner is deciding
    expect(await page.locator('.safety-verdict, .puzzle-says, .evalbar').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Not safe', exact: true }).count()).toBe(0);
    // the listing step: the board is the position after Nf6, drawn with Black (the owner) at the bottom,
    // and the owner makes White's checks and captures; every piece goes back
    const mirror = (sq: string) => String.fromCharCode(201 - sq.charCodeAt(0)) + String(9 - Number(sq[1]));
    await drag(mirror('c4'), mirror('f7'));
    await expect.poll(() => page.locator('.puzzle-says.good').innerText()).toMatch(/xf7\+ is a capture with check\.$/);
    await expect.poll(() => page.locator('.layout.puzzles .board piece:not(.ghost)').count()).toBe(32);
    await drag(mirror('h5'), mirror('h6'));
    await expect.poll(() => page.locator('.puzzle-says.wrong').innerText()).toMatch(/h6 is neither a check nor a capture\.$/);
    expect(await page.locator('.safety-found').innerText()).toMatch(/^Found:\s*\S*xf7\+$/);
    await page.getByRole('button', { name: "That's all" }).click();
    await expect.poll(() => page.locator('.safety-tally').innerText()).toMatch(/^You found 1 of 4\. Missed:/);
    await page.getByRole('button', { name: 'Not safe', exact: true }).click();
    await expect.poll(() => page.locator('.puzzle-says.good').innerText()).toBe('Right.');
    expect(await page.locator('.safety-verdict').allInnerTexts()).toEqual(['Not safe: Nf6 allows checkmate with Qxf7#.']);
    expect(await page.locator('.puzzle-tally').innerText()).toMatch(/In your game you played\s*f6\./);
    // the second: which of the two loses material? A wrong pick, and both verdicts
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => page.locator('.puzzle-task').innerText()).toMatch(/which one is not safe\?/);
    expect(app.safety.view.id).toBe(second);
    await page.locator('.play-actions .btn', { hasText: 'g6' }).click();
    await expect.poll(() => page.locator('.puzzle-says.wrong').innerText()).toBe('Not quite.');
    expect(await page.locator('.safety-verdict').allInnerTexts()).toEqual(['Not safe: Nf6 allows checkmate with Qxf7#.', 'Safe: g6 blocks the queen.']);
    expect(app.db.attemptsOf(first)).toMatchObject([{ result: 'solved', hints: 3 }]);
    expect(app.db.attemptsOf(second)).toMatchObject([{ result: 'shown', misses: 1 }]);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => page.locator('.layout.puzzles').innerText()).toMatch(/Nothing more to check today\./);
    await app.onClientMessage(quiet, { type: 'safety', action: 'close' });
    await app.onClientMessage(quiet, { type: 'puzzle', action: 'close' });
    await app.onClientMessage(quiet, { type: 'setting', key: 'safety.listThreats', value: true });
  });

  it("names their threat on a board with the turn passed, then finds a move that deals with it (WP 6.7)", async () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    const body: ThreatItem = {
      fen,
      lastMove: { san: 'Bc4', from: 'f1', to: 'c4' },
      threat: { san: 'Qxf7#', from: 'h5', to: 'f7', mate: 1, delta: -1, what: 'it would be checkmate' },
      accepted: [],
      best: { san: 'g6', why: 'g6 blocks the queen.' },
      played: { san: 'Nf6', why: 'Nf6 allows checkmate with Qxf7#.' },
    };
    const id = app.db.saveContent('game:902#6|threat', { type: 'threat', status: 'live', source: 'game:902#6', licence: 'own', level: '400–700', gates: [gateV1Threat(body), { gate: 'V6', result: 'pass' }], body } as never);
    app.threat.refresh();
    await page.getByRole('tab', { name: /^Puzzles/ }).click();
    await page.locator('.puzzle-set', { hasText: "What's the threat?" }).click();
    await expect.poll(() => page.locator('.puzzle-task').innerText(), { timeout: 10_000 }).toBe('What is their threat? Make the move they would play if it were their turn.');
    expect(app.threat.view.id).toBe(id);
    expect(await page.locator('.layout.puzzles .turn').innerText()).toMatch(/If it were White's move: make their threat/);
    expect(await page.locator('.safety-verdict, .puzzle-says').count()).toBe(0);
    await page.getByRole('button', { name: 'Hint', exact: true }).click();
    await expect.poll(() => page.locator('.puzzle-says.hint').innerText()).toMatch(/^Look at their last move, Bc4\./);
    // the owner is Black, so the board is drawn with Black at the bottom; they make White's threat
    const mirror = (sq: string) => String.fromCharCode(201 - sq.charCodeAt(0)) + String(9 - Number(sq[1]));
    await drag(mirror('h5'), mirror('f7'));
    await expect.poll(() => page.locator('.puzzle-says.good').innerText(), { timeout: 20_000 }).toBe('Yes: that is their threat.');
    expect(await page.locator('.puzzle-task').innerText()).toBe('Now find a move that deals with it.');
    expect(await page.locator('.safety-verdict').innerText()).toMatch(/^Their threat:\s*\S*xf7#, it would be checkmate\.$/);
    expect(await page.locator('.layout.puzzles .turn').innerText()).toMatch(/You are Black, to move/);
    await expect.poll(() => page.locator('.layout.puzzles .board piece:not(.ghost)').count()).toBe(32);
    // the owner's own move, judged by the engine
    await drag(mirror('g7'), mirror('g6'));
    await expect.poll(() => app.threat.view.status, { timeout: 30_000 }).toBe('solved');
    await expect.poll(() => page.locator('.puzzle-says.good').innerText()).toMatch(/^g6 /);
    expect(await page.locator('.puzzle-task').innerText()).toBe('Right: that deals with it.');
    expect(await page.locator('.puzzle-tally').innerText()).toMatch(/^In your game you played\s*\S*f6: Nf6 allows checkmate with Qxf7#\.$/);
    expect(app.db.attemptsOf(id)).toMatchObject([{ result: 'solved', hints: 1, misses: 0 }]);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => page.locator('.layout.puzzles').innerText()).toMatch(/Nothing more to look at today\./);
    await app.onClientMessage(quiet, { type: 'threat', action: 'close' });
    await app.onClientMessage(quiet, { type: 'puzzle', action: 'close' });
  });

  it('plays a won position out against the engine until it is mate (WP 6.8)', async () => {
    const body: ConvertItem = { fen: '7k/8/6K1/8/8/8/Q7/8 w - - 0 1', chances: 100, game: { outcome: 'draw', played: 'Qb2', threw: 'Qb2' } };
    const id = app.db.saveContent('game:903#40|convert', { type: 'convert', status: 'live', source: 'game:903#40', licence: 'own', level: '400–700', gates: [gateV1Convert(body), { gate: 'V6', result: 'pass' }], body } as never);
    app.convert.refresh();
    await page.getByRole('tab', { name: /^Puzzles/ }).click();
    await page.locator('.puzzle-set', { hasText: 'Win the won game' }).click();
    await expect.poll(() => page.locator('.puzzle-task').innerText(), { timeout: 10_000 }).toBe('You are clearly winning here. Win it: the engine defends.');
    expect(app.convert.view.id).toBe(id);
    expect(await page.locator('.puzzle-side').innerText()).toMatch(/In your game you played\s*\S*b2 here, which gave the win away; the game was drawn\./);
    expect(await page.locator('.puzzle-tally').innerText()).toBe('40 of your moves left');
    // nothing from the engine while the owner plays
    expect(await page.locator('.evalbar, .puzzle-says').count()).toBe(0);
    await drag('a2', 'a8');
    await expect.poll(() => page.locator('.puzzle-says.good').innerText(), { timeout: 20_000 }).toBe('Checkmate: you won it.');
    expect(await page.locator('.puzzle-task').innerText()).toBe('Well played.');
    expect(await page.locator('.convert-moves').innerText()).toMatch(/a8#/);
    expect(app.db.attemptsOf(id)).toMatchObject([{ result: 'solved' }]);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => page.locator('.layout.puzzles').innerText()).toMatch(/Nothing more to play today\./);
    await app.onClientMessage(quiet, { type: 'convert', action: 'close' });
    await app.onClientMessage(quiet, { type: 'puzzle', action: 'close' });
  });

  it('the optional modes are off until switched on; then their sets appear (WP 6.10)', async () => {
    await page.getByRole('tab', { name: /^Puzzles/ }).click();
    await expect.poll(() => page.locator('.puzzle-sets').innerText()).toMatch(/Woodpecker rounds and speed runs are off: they can be switched on in Settings, under Puzzles\./);
    expect(await page.locator('.puzzle-set', { hasText: /^Streak/ }).count()).toBe(0);
    await app.onClientMessage(quiet, { type: 'setting', key: 'puzzles.speedModes', value: true });
    await app.onClientMessage(quiet, { type: 'setting', key: 'puzzles.woodpecker', value: true });
    await expect.poll(() => page.locator('.puzzle-set', { hasText: 'Timed run' }).count()).toBe(1);
    expect(await page.locator('.puzzle-set', { hasText: 'Woodpecker' }).count()).toBe(1);
    // a speed run needs the puzzle database, which this test app does not have: it says so
    await page.locator('.puzzle-set', { hasText: /^Streak/ }).click();
    await expect.poll(() => page.locator('.puzzle-side').innerText()).toMatch(/Speed runs use the Lichess puzzle database/);
    expect(app.speed.active).toBe(false);
    // Woodpecker needs puzzles already met
    await page.locator('.puzzle-set', { hasText: 'Woodpecker' }).click();
    await expect.poll(() => page.locator('.puzzle-side').innerText()).toMatch(/solve at least five first|Round \d+ is done|Woodpecker/);
    await app.onClientMessage(quiet, { type: 'setting', key: 'puzzles.speedModes', value: false });
    await app.onClientMessage(quiet, { type: 'setting', key: 'puzzles.woodpecker', value: false });
    await expect.poll(() => page.locator('.puzzle-set', { hasText: 'Woodpecker' }).count()).toBe(0);
    await app.onClientMessage(quiet, { type: 'speed', action: 'close' });
    await app.onClientMessage(quiet, { type: 'puzzle', action: 'close' });
  });

  it('the drill coach: asked on a puzzle, it answers beside the puzzle, not in the analysis thread (WP 6.11)', async () => {
    const id = app.db.saveContent('game:904#11', { type: 'puzzle_game', status: 'live', source: 'game:904#11', licence: 'own', level: '400–700', gates: [], body: { fen: '1r4k1/5ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1', setup: 'Ra8', solution: ['Rd8+', 'Rxd8', 'Rxd8#'], themes: ['backRankMate'], kind: 'mistake' } } as never);
    await app.onClientMessage(quiet, { type: 'coach', action: 'start' });
    await page.getByRole('tab', { name: /^Puzzles/ }).click();
    await page.locator('.puzzle-set', { hasText: 'From my games' }).click();
    await expect.poll(() => app.puzzles.view.id, { timeout: 10_000 }).toBe(id);
    await expect.poll(() => app.puzzles.view.yourTurn, { timeout: 10_000 }).toBe(true);
    coach!.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'drill_ask', giveNow: 'question', puzzle: { solving: true } });
      const r = await a.tools.say({ seq: ev.seq, kind: 'question', expect: 'move', text: 'What are all your checks here?' });
      expect(r.ok).toBe(true);
    });
    await page.getByRole('button', { name: 'Ask the coach' }).click();
    await expect.poll(() => page.locator('.drill-thread').innerText(), { timeout: 20_000 }).toMatch(/What are all your checks here\?/);
    // asking counts as a hint
    expect(app.puzzles.view.hints).toBe(1);
    // the analysis board's thread does not show it
    await app.onClientMessage(quiet, { type: 'puzzle', action: 'close' });
    await page.getByRole('tab', { name: 'Analysis board' }).click();
    await page.waitForSelector('.layout:not(.puzzles) .board piece');
    expect(await page.locator('.thread').innerText()).not.toMatch(/What are all your checks here/);
    await app.onClientMessage(quiet, { type: 'coach', action: 'stop' });
  });

  it('a study: imported, a chapter opened on the board, a move added and saved back (WP 8.1)', async () => {
    await menu('Game', 'Studies…');
    await page.getByLabel('Import a PGN or a Lichess study').fill('[Event "Openings: Italian"]\n[ChapterName "Italian"]\n[Orientation "white"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 { Aims at f7. } *\n\n[Event "Openings: Against e4"]\n[ChapterName "Against e4"]\n[Orientation "black"]\n\n1. e4 e5 *');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect.poll(() => page.locator('.study-list').innerText()).toMatch(/Openings[\s\S]*Italian[\s\S]*Against e4/);
    // the Black chapter: on the board, Black at the bottom
    await page.locator('.study-chapters .chip', { hasText: 'Against e4' }).click();
    await expect.poll(() => moves()).toEqual(['e4', 'e5']);
    expect(app.session.state.orientation).toBe('black');
    // a move added on the board, saved back into the chapter
    await app.onClientMessage(quiet, { type: 'nav', to: 'end' });
    await app.onClientMessage(quiet, { type: 'move', from: 'g1', to: 'f3' });
    // the knight is drawn as a piece (figurine notation), so the text reads f3
    await expect.poll(() => moves()).toEqual(['e4', 'e5', 'f3']);
    await menu('Game', 'Studies…');
    await expect.poll(() => page.locator('.study-open').innerText()).toMatch(/On the board:\s*Openings · Against e4/);
    await page.getByRole('button', { name: 'Save the board to this chapter' }).click();
    await expect.poll(() => app.db.chapter(app.studies.view().open!.chapter)!.pgn).toMatch(/1\. e4 e5 2\. Nf3/);
    await page.keyboard.press('Escape');
    await app.onClientMessage(quiet, { type: 'study', action: 'remove', study: app.studies.view().studies[0]!.id });
  });

  it('the opening explorer: players at my level, the masters, my own games, and a move played from it (WP 8.2)', async () => {
    const pane = page.locator('.explorer');
    const rows = async () => (await pane.locator('.ex-row .ex-move').allInnerTexts()).map((t) => t.trim());
    if (app.session.state.orientation !== 'white') await app.onClientMessage(quiet, { type: 'flip' }); // an earlier test left Black at the bottom
    // the start, at the owner's level (no band yet: under 1200), from the recorded answer
    await expect.poll(() => pane.innerText()).toMatch(/players rated under 1200, rapid, classical and daily/);
    await expect.poll(() => rows()).toContain('e4');
    expect((await rows())[0]).toBe('e4');
    expect(await pane.locator('.ex-bar').first().getAttribute('aria-label')).toMatch(/^White won \d+%, \d+% drawn, Black won \d+%$/);
    expect(await pane.innerText()).toMatch(/[\d,]+ games reached this position/);
    // the masters (asked at Lichess's pace: three seconds after the last call)
    await pane.getByRole('radio', { name: 'Masters' }).click();
    await expect.poll(() => pane.innerText(), { timeout: 10_000 }).toMatch(/Masters’ games/);
    await expect.poll(() => rows(), { timeout: 10_000 }).toEqual(expect.arrayContaining(['e4', 'd4']));
    // the owner's own games, as the side at the bottom (White): what they played first
    await pane.getByRole('radio', { name: 'My games' }).click();
    await expect.poll(() => pane.innerText()).toMatch(/Your games as White/);
    await expect.poll(() => pane.innerText()).toMatch(/Your moves here/);
    expect((await rows()).length).toBeGreaterThan(0);
    // back to the owner's level; a click on a move plays it on the board, and the explorer follows
    await pane.getByRole('radio', { name: 'My level' }).click();
    await expect.poll(() => rows()).toContain('e4');
    await pane.locator('.ex-row', { has: page.locator('.ex-move', { hasText: /^e4$/ }) }).click();
    await expect.poll(() => moves()).toEqual(['e4']);
    await expect.poll(() => rows(), { timeout: 10_000 }).toEqual(expect.arrayContaining(['e5', 'd5']));
    expect((await rows())[0]).toBe('e5');
    expect(await page.locator('.opening').first().innerText()).toMatch(/King's Pawn Game/); // the name is above the moves, not repeated in the explorer
  });

  it('on a short window the moves keep their room under a long explorer table and the engine lines (seen 2026-11-17)', async () => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.engineLines', value: true });
    await app.onClientMessage(quiet, { type: 'setting', key: 'explorer.source', value: 'level' });
    try {
      await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
      await page.locator('.modal textarea').fill('[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. cxb5 axb5 13. Nc3 Bb7 14. Bg5 b4 15. Nb1 h6 16. Bh4 c5 17. dxe5 Nxe4 18. Bxe7 Qxe7 19. exd6 Qf6 20. Nbd2 1-0');
      await page.getByRole('button', { name: 'Load', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.moves-scroll .san').length === 39);
      // after 1.e4, where the explorer has its long table
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => page.locator('.explorer .ex-row').count(), { timeout: 10_000 }).toBeGreaterThan(5);
      await page.waitForSelector('.pane-section.engine', { timeout: 20_000 });
      const box = await page.locator('.board-side').evaluate((pane) => {
        const r = (sel: string) => pane.querySelector(sel)?.getBoundingClientRect();
        const ex = pane.querySelector('.explorer')!;
        return {
          moves: r('.moves-scroll')!.height,
          actionsBottom: r('.moves-actions')?.bottom,
          labelTop: r('.label-all')?.top,
          paneBottom: pane.getBoundingClientRect().bottom,
          explorerBottom: ex.getBoundingClientRect().bottom,
          explorerScrolls: ex.scrollHeight > ex.clientHeight,
        };
      });
      expect(box.moves).toBeGreaterThanOrEqual(100); // the moves are not squeezed to nothing
      if (box.actionsBottom !== undefined && box.labelTop !== undefined) expect(box.labelTop).toBeGreaterThanOrEqual(box.actionsBottom - 1); // "Delete from here" no longer runs over "Label every move"
      expect(box.explorerBottom).toBeLessThanOrEqual(box.paneBottom + 1); // the explorer stays inside the pane
      expect(box.explorerScrolls).toBe(true); // and its table scrolls there instead
    } finally {
      await app.onClientMessage(quiet, { type: 'setting', key: 'display.engineLines', value: false });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });

  it("the review screen: a repertoire's quarantined lines shown at the failing move, one fixed from the board, one dropped, one accepted with a note, the rest approved after the spot check (WP 8.4)", async () => {
    // quicker budgets than the app's for the test; the gates themselves are the app's
    await app.onClientMessage(quiet, { type: 'setting', key: 'content.gateNodes', value: 1_000_000 });
    await app.onClientMessage(quiet, { type: 'setting', key: 'repertoire.secondNodes', value: 2_000_000 });
    const report = await app.repertoires.importPgn(TEST_REPERTOIRE, { name: 'Test White', colour: 'white', source: 'file:test-repertoire.pgn#1', licence: 'own', level: '400–700' });
    expect(report.quarantined).toBe(3);
    await menu('Game', 'Review content…');
    const sheet = page.locator('.content-sheet');
    const row = (text: string) => sheet.locator('.content-item', { hasText: text });
    await expect.poll(() => sheet.locator('.rep-card').innerText()).toMatch(/Test White[\s\S]*3 waiting for you[\s\S]*3 in quarantine/);
    expect(await sheet.locator('.rep-gaps').innerText()).toMatch(/After 1\.e4: [\d.]+% covered; no answer to d5/);
    // in quarantine: the three bad lines, each with its reason in words
    await sheet.getByLabel('Type').selectOption('repertoire');
    await expect.poll(() => sheet.locator('.content-item').count()).toBe(3);
    expect(await row('2.Ke3').innerText()).toMatch(/V1 Legality: 2\.Ke3 is not a legal move after 1\.e4 Nc6/);
    expect(await row('2.Bxa6').innerText()).toMatch(/V2 Engine soundness: .*Bxa6 is not sound \(you lose a bishop/);
    expect(await row('3.Bc4').innerText()).toMatch(/V5 Consistency: after 1\.e4 d6 2\.Nf3 e5 this line plays 3\.Bc4/);
    // the gate filter
    await sheet.getByLabel('Gate').selectOption('V1');
    await expect.poll(() => sheet.locator('.content-item').count()).toBe(1);
    await sheet.getByLabel('Gate').selectOption('any');
    // drop the illegal line
    await row('2.Ke3').getByRole('button', { name: 'Drop' }).click();
    await row('2.Ke3').getByRole('button', { name: 'Yes' }).click();
    await expect.poll(() => sheet.locator('.content-item').count()).toBe(2);
    // accept the transposition against its gate, with a note
    await row('3.Bc4').getByRole('button', { name: 'Accept with a note…' }).click();
    await row('3.Bc4').getByLabel('Why you accept it').fill('Against 1...d6 I play Bc4 on purpose.');
    await row('3.Bc4').getByRole('button', { name: 'Accept', exact: true }).click();
    await expect.poll(() => sheet.locator('.content-item').count()).toBe(1);
    // the unsound line on the board, at the move that failed; another move played there; the line fixed and checked again
    await row('2.Bxa6').getByRole('button', { name: 'Show on the board' }).click();
    await expect.poll(() => page.locator('.content-sheet').count()).toBe(0);
    await expect.poll(() => moves()).toEqual(['e4', 'a6']);
    expect(app.session.state.orientation).toBe('white');
    await app.onClientMessage(quiet, { type: 'move', from: 'd2', to: 'd4' });
    await expect.poll(() => moves()).toEqual(['e4', 'a6', 'd4']);
    await menu('Game', 'Review content…');
    await sheet.getByLabel('Type').selectOption('repertoire');
    await row('2.Bxa6').getByRole('button', { name: "Use the board's moves" }).click();
    await expect.poll(() => page.locator('.toast').innerText(), { timeout: 90_000 }).toMatch(/The new line passed its gates/);
    await expect.poll(() => sheet.locator('.content-item').count()).toBe(0);
    // waiting: the three sound lines and the fixed one; the spot check, then one approval for all
    await sheet.getByRole('radio', { name: /Waiting for you/ }).click();
    await expect.poll(() => sheet.locator('.content-item').count()).toBe(4);
    expect(await sheet.locator('.content-item', { hasText: '1.e4 a6 2.d4' }).count()).toBe(1);
    expect(await sheet.locator('.rep-sample li').count()).toBe(1);
    await sheet.getByRole('button', { name: 'Approve the 4 waiting lines' }).click();
    await expect.poll(() => sheet.locator('.content-item').count()).toBe(0);
    await sheet.getByRole('radio', { name: /^Live/ }).click();
    await expect.poll(() => sheet.locator('.content-item').count()).toBe(5);
    expect(await row('3.Bc4').innerText()).toMatch(/Your note: Against 1\.\.\.d6 I play Bc4 on purpose\./);
    // every decision is in the log
    const logged = app.db.recentEvents('content_decision', 20).map((e) => (JSON.parse(e.data) as { action: string }).action);
    expect(logged.sort()).toEqual(['accept', 'approve_all', 'drop', 'fix']);
    // a repertoire pasted into the import form (WP 8.7): checked in the background, its card appears when the gates are done
    await sheet.locator('.rep-import summary').click();
    await sheet.getByRole('radio', { name: 'For Black' }).click();
    await sheet.getByLabel('Its name').fill('Black, pasted');
    await sheet.getByLabel('A PGN or a Lichess study link').fill('[Orientation "black"]\n\n1. e4 e5 2. Nf3 Nc6 *');
    await sheet.getByRole('button', { name: 'Check and import' }).click();
    await expect.poll(() => page.locator('.toast').innerText()).toMatch(/Checking 1 line for Black/);
    await expect.poll(() => sheet.locator('.rep-card', { hasText: 'Black, pasted' }).innerText(), { timeout: 90_000 }).toMatch(/for Black · 1 line[\s\S]*1 waiting for you/);
    await page.keyboard.press('Escape');
    await app.onClientMessage(quiet, { type: 'setting', key: 'content.gateNodes', value: 5_000_000 });
    await app.onClientMessage(quiet, { type: 'setting', key: 'repertoire.secondNodes', value: 20_000_000 });
  });

  it('the Openings tab: a repertoire walked move by move, its replies and gaps (D9)', async () => {
    // the review screen test approved the test repertoire's lines for White
    await page.getByRole('tab', { name: /^Openings/ }).click();
    await expect.poll(() => app.mode).toBe('openings');
    await expect.poll(() => page.locator('.rep-pick', { hasText: 'Test White' }).count()).toBe(1);
    await page.locator('.rep-pick', { hasText: 'Test White' }).click();
    const walk = page.locator('.rep-walk');
    await expect.poll(() => walk.innerText()).toMatch(/Start[\s\S]*Your move\s*e4/i);
    // where the move comes from (D13): an imported repertoire says so, on the move and beside the chapters
    expect(await walk.locator('.tag').allInnerTexts()).toContain('Imported');
    expect(await page.locator('.rep-origin').innerText()).toMatch(/Imported by you[\s\S]*Words:/);
    await walk.getByRole('button', { name: 'Play it' }).click();
    // their replies prepared after 1.e4, the most played at the owner's level first (the recorded explorer answer)
    // (1...d6 is there too: the review test accepted that line with a note)
    await expect.poll(() => walk.locator('.rep-reply-move').allInnerTexts()).toEqual(['e5', 'c5', 'd6', 'a6']);
    expect(await walk.locator('.rep-reply-share').allInnerTexts()).toEqual(['65%', '5%', expect.stringMatching(/^\d+%$/), '–']);
    expect(await walk.innerText()).toMatch(/Not prepared: d5/);
    await walk.locator('.rep-reply', { hasText: /^e5/ }).click();
    await expect.poll(() => walk.innerText()).toMatch(/1\.\s*e4\s*e5[\s\S]*Your move\s*f3/i);
    // the moves walked are steps back: the first one goes back to 1.e4
    await walk.locator('.crumb').nth(1).click();
    await expect.poll(() => walk.innerText()).toMatch(/What they play/i);
    await walk.locator('.rep-reply', { hasText: /^e5/ }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(() => walk.innerText()).toMatch(/What they play/i);
  });

  it('the coach on the Openings tab: started there, it sees the walked board and answers beside it, not in the analysis thread (D12)', async () => {
    await page.getByRole('tab', { name: /^Openings/ }).click();
    await page.locator('.rep-pick', { hasText: 'Test White' }).click();
    const walk = page.locator('.rep-walk');
    await walk.getByRole('button', { name: 'Play it' }).click();
    await walk.locator('.rep-reply', { hasText: /^e5/ }).click();
    await expect.poll(() => walk.innerText()).toMatch(/1\.\s*e4\s*e5[\s\S]*Your move\s*f3/i);
    const box = page.locator('.opening-coach');
    await box.getByRole('button', { name: 'Start coach' }).click();
    await expect.poll(() => box.innerText()).toMatch(/Sees this position/);
    await expect.poll(() => !!coach).toBe(true);
    coach!.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'opening_question', walk: { reachedBy: '1.e4 e5', theRepertoireMove: 'Nf3' } });
      const r = await a.tools.say({ seq: ev.seq, kind: 'explain', text: '{m:Nf3} develops your knight.', claims: [ev.theRepertoireMove.cite] });
      expect(r.ok).toBe(true);
    });
    // a suggestion asks it in one click
    await box.getByRole('button', { name: 'Why is this move played?' }).click();
    await expect.poll(() => box.locator('.msg-coach').innerText(), { timeout: 20_000 }).toMatch(/develops your knight/);
    expect(await box.locator('.msg-owner').innerText()).toBe('Why is this move played?');
    // the analysis board's thread does not show it
    await page.getByRole('tab', { name: 'Analysis board' }).click();
    await page.waitForSelector('.layout:not(.puzzles) .board piece');
    expect(await page.locator('.thread').innerText()).not.toMatch(/develops your knight/);
    await app.onClientMessage(quiet, { type: 'coach', action: 'stop' });
  });

  it('the opening drill: a new card shown on the board and played, the replies prepared after it, then the next card (WP 8.8)', async () => {
    // the review screen test approved the test repertoire's lines: they are the cards; the drill is the Openings tab's Practice
    await page.getByRole('tab', { name: /^Openings/ }).click();
    await page.getByRole('radio', { name: 'Practice' }).click();
    const card = page.locator('.opening-card');
    await expect.poll(() => card.innerText()).toMatch(/A new position: here you play the move shown/);
    const first = app.openings.view;
    expect(first.status).toBe('learn');
    expect(first.you).toBe('white');
    // the move is drawn on the board; a different move is put back
    await drag('a2', 'a3');
    await expect.poll(() => app.openings.view.tries).toBeGreaterThan(first.tries);
    expect(app.openings.view.status).toBe('learn');
    await drag(first.move!.from, first.move!.to);
    await expect.poll(() => app.openings.view.status).toBe('right');
    await expect.poll(() => card.innerText()).toMatch(/^Right\./m);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => app.openings.view.id).not.toBe(first.id);
    expect(['learn', 'ask']).toContain(app.openings.view.status);
    await app.onClientMessage(quiet, { type: 'opening', action: 'close' });
  });

  it('chapters: approved one at a time, walked to on the Openings tab, drilled alone; then the repertoire removed (D11, WP 8.13–8.15)', async () => {
    await app.onClientMessage(quiet, { type: 'setting', key: 'content.gateNodes', value: 1_000_000 });
    await app.onClientMessage(quiet, { type: 'setting', key: 'repertoire.secondNodes', value: 2_000_000 });
    const pgn = '[Event "Two: Against 1...d5"]\n[ChapterName "Against 1...d5"]\n[Orientation "white"]\n\n1. Nf3 d5 2. b3 Nf6 3. Bb2 *\n\n[Event "Two: Against 1...Nf6"]\n[ChapterName "Against 1...Nf6"]\n[Orientation "white"]\n\n1. Nf3 Nf6 2. b3 g6 3. Bb2 *';
    const report = await app.repertoires.importPgn(pgn, { name: 'Two chapters', colour: 'white', source: 'file:two.pgn#1', licence: 'own', level: '400–700' });
    expect(report.quarantined).toBe(0);
    const id = report.id;
    // the review screen: the chapters, and one of them approved
    await menu('Game', 'Review content…');
    const card = page.locator('.content-sheet .rep-card', { hasText: 'Two chapters' });
    await card.locator('.rep-chapters summary').click();
    await expect.poll(() => card.locator('.rep-chapters tbody tr').count()).toBe(2);
    await card.locator('.rep-chapters tr', { hasText: 'Against 1...d5' }).getByRole('button', { name: 'Approve this chapter' }).click();
    await expect.poll(() => card.locator('.rep-counts').innerText()).toMatch(/1 live[\s\S]*1 waiting for you/);
    await page.keyboard.press('Escape');
    // the Openings tab: the chapters listed; a click walks to where one starts
    await page.getByRole('tab', { name: /^Openings/ }).click();
    await page.getByRole('radio', { name: 'Repertoire' }).click();
    await page.locator('.rep-pick', { hasText: 'Two chapters' }).click();
    const chapters = page.locator('.rep-chapter-list');
    await expect.poll(() => chapters.innerText()).toMatch(/Against 1\.\.\.d5[\s\S]*Against 1\.\.\.Nf6/);
    await chapters.locator('.rep-pick', { hasText: 'Against 1...Nf6' }).click();
    await expect.poll(() => page.locator('.rep-walk').innerText()).toMatch(/1\.\s*f3\s*f6[\s\S]*Chapter\s*Against 1\.\.\.Nf6[\s\S]*Your move\s*b3/i);
    // the drill kept to the approved chapter: its first new card
    await page.getByRole('radio', { name: 'Practice' }).click();
    const scope = page.getByLabel('What to practise');
    await expect.poll(() => scope.locator('option').allInnerTexts()).toContain('Against 1...d5 · 3 new');
    await scope.selectOption(`${id}|Against 1...d5`);
    await expect.poll(() => app.openings.view.scope).toEqual({ repertoire: id, chapters: ['Against 1...d5'] });
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(() => app.openings.view.status).toBe('learn');
    expect(app.openings.view).toMatchObject({ repertoire: 'Two chapters', chapter: 'Against 1...d5', move: { san: 'Nf3' } });
    await expect.poll(() => page.locator('.under-board .turn').innerText()).toMatch(/Two chapters\s*· Against 1\.\.\.d5/);
    await app.onClientMessage(quiet, { type: 'opening', action: 'scope', repertoire: null });
    // removed for good, from the review screen, logged
    await menu('Game', 'Review content…');
    await card.getByRole('button', { name: 'Remove this repertoire…' }).click();
    await card.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => page.locator('.content-sheet .rep-card', { hasText: 'Two chapters' }).count()).toBe(0);
    expect(app.db.repertoire(id)).toBeUndefined();
    expect(app.db.recentEvents('repertoire_removed', 1)).toHaveLength(1);
    await page.keyboard.press('Escape');
    await app.onClientMessage(quiet, { type: 'setting', key: 'content.gateNodes', value: 5_000_000 });
    await app.onClientMessage(quiet, { type: 'setting', key: 'repertoire.secondNodes', value: 20_000_000 });
  });

  it('the Endgames tab: the ladder, a position played against the tablebases, the move that kept it (F2)', async () => {
    // at server start the pack is gated after the engine check; here it is run by hand, on a small budget
    await app.onClientMessage(quiet, { type: 'setting', key: 'content.gateNodes', value: 1_000_000 });
    await app.checkEndgames();
    await app.onClientMessage(quiet, { type: 'setting', key: 'content.gateNodes', value: 5_000_000 });
    await page.getByRole('tab', { name: /^Endgames/ }).click();
    await expect.poll(() => app.mode).toBe('endgames');
    await expect.poll(() => page.locator('.eg-pick:not(.eg-random)').count()).toBe(13);
    expect((await page.locator('.eg-topic-name').allTextContents())[0]).toBe('Queen and king against king');
    await page.locator('.eg-pick', { hasText: 'Their king in the corner' }).click();
    const side = page.locator('.eg-side');
    await expect.poll(() => side.innerText()).toMatch(/Queen and king against king · Their king in the corner[\s\S]*White to play: give mate\./);
    // Qc7 is stalemate: the go ends there, with the move that kept the win
    await drag('c5', 'c7');
    await expect.poll(() => page.locator('.puzzle-says').innerText()).toBe('Qc7 lets the win go: stalemate.');
    expect(await side.innerText()).toMatch(/The move that kept it:/);
    await page.getByRole('button', { name: 'Try that move again' }).click();
    await expect.poll(() => app.endgames.view.status).toBe('playing');
    expect(app.endgames.view.fen).toBe('k7/8/1K6/2Q5/8/8/8/8 w - - 0 1');
    // the page too: the verdict gone, the queen back on c5 (the server is ahead of the page; seen 2026-11-25)
    await expect.poll(() => page.locator('.puzzle-says').count()).toBe(0);
    await drag('c5', 'c8');
    await expect.poll(() => page.locator('.puzzle-says').innerText()).toBe('Checkmate. Well played.');
    // ticked on the ladder
    await expect.poll(() => page.locator('.eg-pick', { hasText: 'Their king in the corner' }).locator('.eg-mark.solved').count()).toBe(1);
    // a new position for the rook mate (PLAN 9.3): made at random, checked by the tablebases, then played
    expect(await page.locator('.eg-random').count()).toBe(3);
    await page.locator('.eg-topic', { hasText: 'Rook and king against king' }).locator('.eg-random').click();
    await expect.poll(() => app.endgames.view.position?.random).toBe('rook');
    expect(app.endgames.view).toMatchObject({ status: 'playing', you: 'white' });
    await expect.poll(() => side.innerText()).toMatch(/Rook and king against king · A new position[\s\S]*White to play: give mate\./);
    // no idea is written for a random start, and the coach is off: neither button is offered
    expect(await page.getByRole('button', { name: 'Show the idea' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Ask the coach' }).count()).toBe(0);
    await app.onClientMessage(quiet, { type: 'endgame', action: 'close' });
  });

  it('a game against the repertoire: where it left, what the repertoire plays there; results per line on My games (WP 8.10)', async () => {
    // the review screen test approved the test repertoire for White (1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 …)
    await page.getByRole('tab', { name: /^My games/ }).click();
    await page.getByLabel('A PGN, or a link to a game').fill('[White "OwnerLichess"]\n[Black "rival_rep"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O 1-0');
    await page.getByRole('button', { name: 'Add and open' }).click();
    await expect.poll(() => app.mode).toBe('analysis');
    const note = page.locator('.rep-game');
    await expect.poll(() => note.innerText()).toMatch(/You left it at 4\.\s*xc6: your repertoire plays\s*a4 here\./);
    expect(await note.innerText()).toMatch(/Line: 1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4/);
    // the move it left at, on the board
    await note.getByRole('button', { name: 'Go to the move' }).click();
    await expect.poll(() => app.session.state.tree.nodes[app.session.state.focus]!.fen).toBe('r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4');
    // My games: the results per line
    await page.getByRole('tab', { name: /^My games/ }).click();
    await expect.poll(() => page.locator('.rep-stats').innerText()).toMatch(/Your openings[\s\S]*you left it \d+ times?[\s\S]*1\.e4 e5 2\.Nf3 Nc6 3\.Bb5 a6 4\.Ba4[\s\S]*as White: \d+ games?, won \d+/);

    // a game where they left it: their move, and the engine's after it, added to the repertoire through every gate
    // (the engine speaks on a new game only after the owner's own review, D56: off for this one)
    await app.onClientMessage(quiet, { type: 'setting', key: 'review.ownFirst', value: false });
    await page.getByLabel('A PGN, or a link to a game').fill('[White "OwnerLichess"]\n[Black "rival_add"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 f6 3. Nxe5 1-0');
    await page.getByRole('button', { name: 'Add and open' }).click();
    await expect.poll(() => app.mode).toBe('analysis');
    await expect.poll(() => note.innerText(), { timeout: 30_000 }).toMatch(/They left it at 2\.\.\.\s*f6[\s\S]*Next time, the engine's move after theirs is/);
    const gameId = app.session.state.game!.id;
    await note.getByRole('button', { name: 'Add to my repertoire' }).click();
    await expect.poll(() => page.locator('.toast').allInnerTexts(), { timeout: 240_000 }).toContainEqual(expect.stringMatching(/^Added/));
    const rep = app.db.repertoires().find((r) => r.name === 'Test White')!.id;
    const added = app.db.repertoireItems<RepLine>(rep).find((x) => x.body.added);
    expect(added!.body.moves.slice(0, 4)).toEqual(['e4', 'e5', 'Nf3', 'f6']);
    expect(added!.body.moves).toHaveLength(5);
    expect(added!.body.added!.game).toBe(gameId);
    // it waits for the owner (or is held back with its reason): never live by itself
    expect(['machine-verified', 'quarantined']).toContain(added!.status);
    await app.onClientMessage(quiet, { type: 'setting', key: 'review.ownFirst', value: true });
  }, 360_000);

  it('the material beside the board: the pieces each side has taken, +N for the side ahead, and off as a setting (I17)', async () => {
    if (app.session.state.orientation !== 'white') await app.onClientMessage(quiet, { type: 'flip' });
    for (const [from, to] of [['e2', 'e4'], ['d7', 'd5'], ['e4', 'd5']] as const) await app.onClientMessage(quiet, { type: 'move', from, to });
    const white = page.locator('.material-strip.white');
    await expect.poll(() => white.getAttribute('aria-label')).toBe('White has taken 1 piece, and is 1 point ahead');
    expect(await white.locator('.material-plus').innerText()).toBe('+1');
    expect(await page.locator('.material-strip.black').getAttribute('aria-label')).toBe('Black has taken nothing');
    // White's strip is at the bottom, beside White's side of the board
    const boardBox = (await page.locator('.board').first().boundingBox())!;
    expect((await white.boundingBox())!.y).toBeGreaterThan(boardBox.y + boardBox.height - 2);
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.material', value: 'off' });
    await expect.poll(() => page.locator('.material-strip').count()).toBe(0);
    await app.onClientMessage(quiet, { type: 'setting', key: 'display.material', value: 'captured' });
  });

  it('never logged an error in the browser console', () => {
    expect(errors).toEqual([]);
  });
});
