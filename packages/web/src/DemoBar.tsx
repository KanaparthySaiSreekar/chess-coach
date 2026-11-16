// The coach's layer (feature A3): what the coach is showing. Every line is built by the engine;
// the coach only asks for it. A slim header sits above the board (title, step controls, the way
// back); the lines and sublines, each with the engine's verdict, fill the left panel.
//
// The owner can move pieces on this board too (feature A18): a move that is not the line's own
// becomes "Your alternative", judged by the engine and shown as a side line of its own.

import { ChevronFirst, ChevronLeft, ChevronRight } from 'lucide-react';
import { LABEL_NAME, type Demo, type DemoLine, type MoveLabel } from '@chess-coach/core';
import { Badge, LABEL_LOOK } from './labels.tsx';
import { San } from './San.tsx';
import { send, stopAnim, type Anim } from './store.ts';

type View = { line: string | null; ply: number };
type Show = { figurine: boolean; labels: boolean };

const NOTABLE: ReadonlySet<MoveLabel> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

function numberFor(fenBefore: string, first: boolean): string {
  const parts = fenBefore.split(' ');
  const n = parts[5] ?? '1';
  if (parts[1] === 'w') return `${n}.`;
  return first ? `${n}…` : '';
}

export function demoView(demo: Demo, anim: Anim | null): View {
  // while a line is being played out, the page's own cursor leads; otherwise the server's
  return anim && anim.demo === demo.id ? { line: anim.line, ply: anim.ply } : demo.cursor;
}

function Line({ demo, line, depth, view, show }: { demo: Demo; line: DemoLine; depth: number; view: View; show: Show }) {
  const children = demo.lines.filter((l) => l.parent?.line === line.id);
  const goto = (ply: number) => {
    stopAnim();
    send({ type: 'demo', action: 'goto', line: line.id, ply });
  };
  const viaLichess = !!line.checkedBy?.includes('Lichess');
  const yours = line.kind === 'alt';
  return (
    <div className={`demo-line depth-${Math.min(depth, 3)}${view.line === line.id ? ' active' : ''}${yours ? ' yours' : ''}`}>
      <div className="demo-label">
        {yours && <span className="alt-tag">Your move</span>}
        {line.label}
      </div>
      <div className="demo-moves">
        {line.moves.map((m, i) => {
          const before = i === 0 ? line.baseFen : line.moves[i - 1]!.fen;
          const num = numberFor(before, i === 0);
          const current = view.line === line.id && view.ply === i + 1;
          const label = show.labels ? m.judged?.label : undefined;
          const notable = label && NOTABLE.has(label) ? label : undefined;
          // without labels, a mistake still shows as the usual "?" or "??"
          const mark = !show.labels || !m.judged ? m.mark : '';
          return (
            <span key={i} className="demo-move-wrap">
              {num && <span className="ply-num">{num}</span>}
              <button
                className={`san${current ? ' current' : ''}${mark ? ' weak' : ''}`}
                style={notable && !current ? { color: LABEL_LOOK[notable].color } : undefined}
                onClick={() => goto(i + 1)}
                title={label ? LABEL_NAME[label] : mark ? 'A mistake by the side that plays it' : undefined}
              >
                <San san={m.san} by={m.by} figurine={show.figurine} />
                {mark && <sup>{mark}</sup>}
                {notable && <Badge label={notable} small />}
              </button>
            </span>
          );
        })}
      </div>
      {line.verdict && (
        <div className="demo-verdict" title={line.checkedBy ?? "Written by the chess engine's check, not by the coach"}>
          <span className={`engine-tag${viaLichess ? ' lichess' : ''}`}>{viaLichess ? 'Lichess check' : 'Engine check'}</span> {line.verdict}
        </div>
      )}
      <button className="link adopt" onClick={() => send({ type: 'demo', action: 'adopt', line: line.id })} title="Copy this line into your own moves as a side line">
        Add to my moves
      </button>
      {children.map((c) => (
        <div key={c.id} className="demo-branch">
          <div className="demo-branch-at">
            after {c.parent!.ply > 0 ? <San san={line.moves[c.parent!.ply - 1]?.san ?? ''} by={line.moves[c.parent!.ply - 1]?.by ?? 'white'} figurine={show.figurine} /> : 'the start'}, instead:
          </div>
          <Line demo={demo} line={c} depth={depth + 1} view={view} show={show} />
        </div>
      ))}
    </div>
  );
}

/** The coach's lines and sublines, for the side panel. */
export function DemoLines({ demo, anim, figurine, labels }: { demo: Demo; anim: Anim | null; figurine: boolean; labels: boolean }) {
  const view = demoView(demo, anim);
  const roots = demo.lines.filter((l) => !l.parent);
  const show = { figurine, labels };
  return (
    <div className="demo-lines">
      {roots.length === 0 && <p className="muted empty">The coach set up this position to talk about it.</p>}
      {roots.map((l) => (
        <Line key={l.id} demo={demo} line={l} depth={0} view={view} show={show} />
      ))}
      <p className="demo-foot muted">
        Every move here was chosen by the chess engine, not by the coach. Want to try something else? Move a piece on the board: the engine judges your move and plays the replies.
      </p>
    </div>
  );
}

/** The slim bar above the board while the coach's layer is showing. */
export function DemoBar({ demo, anim }: { demo: Demo; anim: Anim | null }) {
  const view = demoView(demo, anim);
  const cur = view.line ? demo.lines.find((l) => l.id === view.line) : undefined;
  const step = (d: 1 | -1) => stepDemo(demo, view, d);
  const start = () => {
    stopAnim();
    send({ type: 'demo', action: 'goto', line: null, ply: 0 });
  };
  return (
    <div className="demo-bar" role="region" aria-label="The coach's board">
      <span className="demo-badge">Coach's board</span>
      <span className="demo-title">{cur?.label ?? demo.label}</span>
      <span className="demo-steps">
        <button className="icon-btn" onClick={start} title="Start of the line" aria-label="Start of the line">
          <ChevronFirst size={18} strokeWidth={2} />
        </button>
        <button className="icon-btn" onClick={() => step(-1)} title="Back one move (←)" aria-label="Back one move">
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <button className="icon-btn" onClick={() => step(1)} title="Forward one move (→)" aria-label="Forward one move">
          <ChevronRight size={18} strokeWidth={2} />
        </button>
      </span>
      <button className="btn primary small" onClick={() => send({ type: 'demo', action: 'close' })}>
        Back to my board
      </button>
    </div>
  );
}

/** Step the coach's board one move back or forward (the buttons above the board, and the arrow keys). */
export function stepDemo(demo: Demo, view: View, d: 1 | -1) {
  stopAnim();
  const cur = view.line ? demo.lines.find((l) => l.id === view.line) : undefined;
  if (!cur) {
    const first = demo.lines.find((l) => !l.parent);
    if (first && d > 0) send({ type: 'demo', action: 'goto', line: first.id, ply: 1 });
    return;
  }
  const next = view.ply + d;
  if (next < 0) return;
  if (next === 0 && cur.parent) return send({ type: 'demo', action: 'goto', line: cur.parent.line, ply: cur.parent.ply });
  if (next === 0) return send({ type: 'demo', action: 'goto', line: null, ply: 0 });
  send({ type: 'demo', action: 'goto', line: cur.id, ply: Math.min(next, cur.moves.length) });
}
