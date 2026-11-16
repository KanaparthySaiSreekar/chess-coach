// The bent arrow for a knight's move (feature A19): geometry only, no browser needed.

import { describe, expect, it } from 'vitest';
import { isKnightHop, knightArrowPoints, knightArrowSvg } from '../src/arrows.ts';

describe("an arrow for a knight's move", () => {
  it('knows a knight hop from any other move', () => {
    expect(isKnightHop('g1', 'f3')).toBe(true);
    expect(isKnightHop('b8', 'd7')).toBe(true);
    expect(isKnightHop('e4', 'e5')).toBe(false);
    expect(isKnightHop('c1', 'g5')).toBe(false);
    expect(isKnightHop('a1', 'c3')).toBe(false);
  });

  it('goes along the long side first, then the short one', () => {
    // g1 to f3, White at the bottom: two squares up the screen, then one to the left
    expect(knightArrowPoints('g1', 'f3', 'white')).toEqual({ corner: [50, -150], end: [-50, -150] });
    // d6 to f7: two squares to the right, then one up
    expect(knightArrowPoints('d6', 'f7', 'white')).toEqual({ corner: [250, 50], end: [250, -50] });
  });

  it('turns with the board when Black is at the bottom', () => {
    expect(knightArrowPoints('g1', 'f3', 'black')).toEqual({ corner: [50, 250], end: [150, 250] });
  });

  it('draws a shaft with one corner and a head whose tip is the middle of the target square', () => {
    const svg = knightArrowSvg('g1', 'f3', 'white', { color: '#6f4bd8', opacity: 0.45, lineWidth: 12 });
    // the shaft starts in the middle of g1, turns above it, and stops where the head begins
    expect(svg).toContain('d="M50 50L50 -150L6.25 -150"');
    // the head: tip on f3's centre, three line-widths long and four wide
    expect(svg).toContain('d="M-50 -150L6.25 -187.5L6.25 -112.5Z"');
    expect(svg).toContain('stroke="#6f4bd8"');
    expect(svg).toContain('opacity="0.45"');
    expect(svg).toContain('stroke-width="18.75"');
  });
});
