// Development aid: load the page and print where each console error comes from (with a stack for
// SVG attribute errors, which the browser reports without one).
//   URL=http://127.0.0.1:5173/ node tools/console-trace.mjs
import { chromium } from 'playwright';
const url = process.env.URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await page.addInitScript(() => {
  const original = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (String(value).includes('NaN')) {
      const board = document.querySelector('cg-board');
      const r = board ? board.getBoundingClientRect() : null;
      console.warn(`NaN in ${name}="${value}" on <${this.tagName}>; board ${r ? `${r.width}x${r.height}` : 'missing'}; ${new Error().stack.split('\n').slice(2, 7).join(' | ')}`);
    }
    return original.call(this, name, value);
  };
});
page.on('console', (m) => {
  if (m.type() === 'error' || m.text().startsWith('NaN in')) console.log(`[${m.type()}] ${m.text().slice(0, 900)}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e}`));
await page.goto(url);
await page.waitForSelector('.board piece', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1500));
await browser.close();
