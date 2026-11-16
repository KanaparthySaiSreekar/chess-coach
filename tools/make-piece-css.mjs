// Writes packages/web/src/pieces/pieces.css from the piece sets in packages/web/src/pieces/<set>/.
// Each set is twelve SVG files named as Lichess names them (wK.svg … bP.svg). The default set
// (cburnett) comes with the board library and needs no rule here.
//
//   node tools/make-piece-css.mjs
//
// A set is chosen on the page by `data-pieces` on <html> (the setting display.pieceSet).

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'web', 'src', 'pieces');
const ROLE = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
const sets = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let css = `/* Written by tools/make-piece-css.mjs: do not edit. Other piece sets than the default one
   (feature I9). The pictures are in this folder; who drew them and under which licence is in NOTICE.md. */\n`;
for (const set of sets) {
  for (const color of ['w', 'b']) {
    for (const [letter, role] of Object.entries(ROLE)) {
      const file = `${color}${letter}.svg`;
      if (!existsSync(path.join(dir, set, file))) throw new Error(`${set} is missing ${file}`);
      css += `:root[data-pieces='${set}'] .cg-wrap piece.${role}.${color === 'w' ? 'white' : 'black'} {\n  background-image: url('./${set}/${file}');\n}\n`;
    }
  }
}
// previews for the settings, all sets side by side: a white knight in each set's drawing, whatever set the board uses
// (\`:root:root\` outranks the board's rule above, so a preview keeps its own set)
css += `\n/* previews: one knight per set, for picking a set in the settings */\n`;
for (const set of sets) css += `:root:root .cg-wrap.set-preview-${set} piece.knight.white {\n  background-image: url('./${set}/wN.svg');\n}\n`;
writeFileSync(path.join(dir, 'pieces.css'), css);
console.log(`pieces.css: ${sets.join(', ')}`);
