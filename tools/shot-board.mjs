// Development aid: load a game or a position on the analysis board of a running server and save a
// picture of the board (with its arrows, boxes and badge) and of the line under it.
//   URL=http://127.0.0.1:5184/ OUT=some/folder node tools/shot-board.mjs "<PGN or FEN>" <name> [keys…]
// `keys` are pressed after loading, one by one (ArrowLeft, Home, End…), to step to the move wanted.
// WAIT= how long to let the engine settle before the picture (ms, default 2500).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5174/';
const out = process.env.OUT ?? 'data/shots';
const [text, name = 'board', ...keys] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) }, colorScheme: process.env.SCHEME ?? 'dark', deviceScaleFactor: 1.5 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(url);
await page.waitForSelector('.board piece', { timeout: 15000 });
await page.getByRole('tab', { name: 'Analysis board' }).click();
await sleep(200);
if (await page.getByRole('button', { name: 'Back to my board' }).count()) await page.getByRole('button', { name: 'Back to my board' }).click();
if (text) {
  await page.getByRole('button', { name: 'Load PGN / FEN' }).click();
  await page.locator('.modal textarea').fill(text);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await sleep(300);
  await page.keyboard.press('End');
}
for (const key of keys) {
  await sleep(250);
  await page.keyboard.press(key);
}
await sleep(Number(process.env.WAIT ?? 2500));
await page.locator('.board-stack').screenshot({ path: `${out}/${name}.png` });
console.log('caption:', (await page.locator('.caption').first().innerText().catch(() => '(none)')).replace(/\s+/g, ' '));
console.log('saved', `${out}/${name}.png`);
if (errors.length) console.log('console errors:', errors.slice(0, 5));
await browser.close();
