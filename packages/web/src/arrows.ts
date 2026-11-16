// An arrow for a knight's move, bent like the move itself (two squares, then one), the way
// Chess.com draws it. The board library draws every arrow as one straight line, which for a
// knight cuts across the squares and pieces in between.

export type ArrowLook = { color: string; opacity: number; lineWidth: number };

/** Is this the geometry of a knight's move: one square one way, two the other? */
export function isKnightHop(from: string, to: string): boolean {
  const dx = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const dy = Math.abs(Number(from[1]) - Number(to[1]));
  return dx * dy === 2;
}

const r = (n: number) => Math.round(n * 100) / 100;

/**
 * The corner and the end of the bent arrow, in the units of the board library's custom drawings:
 * a 100 by 100 box that sits on the starting square, x to the right and y down the screen.
 * The long side is drawn first, then the short one.
 */
export function knightArrowPoints(from: string, to: string, orientation: 'white' | 'black'): { corner: [number, number]; end: [number, number] } {
  const flip = orientation === 'white' ? 1 : -1;
  const dx = (to.charCodeAt(0) - from.charCodeAt(0)) * flip;
  const dy = (Number(from[1]) - Number(to[1])) * flip; // a higher rank is further up the screen for White
  const end: [number, number] = [50 + 100 * dx, 50 + 100 * dy];
  const corner: [number, number] = Math.abs(dx) === 2 ? [end[0], 50] : [50, end[1]];
  return { corner, end };
}

/** The drawing itself: a shaft with one corner and an arrowhead, sized like the library's own arrows. */
export function knightArrowSvg(from: string, to: string, orientation: 'white' | 'black', look: ArrowLook): string {
  const { corner, end } = knightArrowPoints(from, to, orientation);
  const w = (look.lineWidth / 64) * 100;
  // the short side's direction, and the head on its end: three widths long, four wide, tip on the square's centre
  const ux = Math.sign(end[0] - corner[0]);
  const uy = Math.sign(end[1] - corner[1]);
  const base: [number, number] = [end[0] - ux * 3 * w, end[1] - uy * 3 * w];
  const px = -uy * 2 * w;
  const py = ux * 2 * w;
  const shaft = `M50 50L${r(corner[0])} ${r(corner[1])}L${r(base[0])} ${r(base[1])}`;
  const head = `M${r(end[0])} ${r(end[1])}L${r(base[0] + px)} ${r(base[1] + py)}L${r(base[0] - px)} ${r(base[1] - py)}Z`;
  return `<g opacity="${look.opacity}"><path d="${shaft}" fill="none" stroke="${look.color}" stroke-width="${r(w)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${head}" fill="${look.color}"/></g>`;
}
