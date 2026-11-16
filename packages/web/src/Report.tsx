// The written report of one game (features B10, G6, H8): what went well, two to four takeaways,
// how the last game's takeaways fared, the key moments with the step that was skipped (which the
// owner can put in their own words), a note for next time, and the winning-chances chart for
// those who switch it on. Every line comes from the server, which builds it from the stored
// analysis: nothing here is composed on the page.

import { useEffect, useState } from 'react';
import { LABEL_NAME, STEP_NAME, type Color, type ReviewView, type SkippedStep } from '@chess-coach/core';
import { San } from './San.tsx';
import { send, setting, type Store } from './store.ts';
import { Sheet } from './ui.tsx';

const STEPS: SkippedStep[] = ['missed_threat', 'no_safety_check', 'seemed_safe', 'missed_tactic', 'assumed_reply', 'missed_free_material', 'time', 'unknown'];

/** A reading in words: the report never shows a number the owner has not asked for. */
function standing(w: number): string {
  return w >= 90 ? 'You are winning' : w >= 65 ? 'You are better' : w > 35 ? 'About even' : w > 10 ? 'You are worse' : 'You are losing';
}

/**
 * The owner's winning chances after each move, as one line: up is better for them. One series, so
 * the heading names it and there is no legend; the key moments are dots on the line. Pointing at
 * the chart (or the arrow keys, when it has the focus) reads out the move and how the game stood;
 * the same is on the board for anyone who steps through the moves.
 */
function Chart({ points, you, marks, labels, numbers }: { points: (number | null)[]; you: Color; marks: number[]; labels: string[]; numbers: boolean }) {
  const [at, setAt] = useState<number | null>(null);
  const known = points
    .map((p, i) => (p === null ? null : { ply: i + 1, x: points.length > 1 ? i / (points.length - 1) : 0, w: you === 'white' ? p : 100 - p }))
    .filter((p): p is { ply: number; x: number; w: number } => !!p);
  if (known.length < 2) return null;
  const W = 600;
  const H = 96;
  const y = (w: number) => H - (w / 100) * H;
  const nearest = (fraction: number) => known.reduce((best, p, i) => (Math.abs(p.x - fraction) < Math.abs(known[best]!.x - fraction) ? i : best), 0);
  const here = at === null ? null : known[at]!;
  return (
    <div
      className="report-chart"
      tabIndex={0}
      role="img"
      aria-label={`Your winning chances through the game: higher is better for you. ${here ? `${labels[here.ply - 1] ?? ''}: ${standing(here.w)}` : 'Use the arrow keys to step through the moves.'}`}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        setAt(nearest((e.clientX - box.left) / box.width));
      }}
      onPointerLeave={() => setAt(null)}
      onFocus={() => setAt((cur) => cur ?? known.length - 1)}
      onBlur={() => setAt(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setAt((cur) => Math.max(0, Math.min(known.length - 1, (cur ?? known.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="report-chart-mid" />
        <polyline points={known.map((p) => `${(p.x * W).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ')} className="report-chart-line" />
        {here && <line x1={here.x * W} y1="0" x2={here.x * W} y2={H} className="report-chart-hair" />}
      </svg>
      {known
        .filter((p) => marks.includes(p.ply))
        .map((p) => (
          <i key={p.ply} className="report-chart-dot" style={{ left: `${p.x * 100}%`, top: `${(y(p.w) / H) * 100}%` }} />
        ))}
      {here && <i className="report-chart-dot here" style={{ left: `${here.x * 100}%`, top: `${(y(here.w) / H) * 100}%` }} />}
      {here && (
        <span className={`report-chart-tip${here.x > 0.6 ? ' left' : ''}`} style={here.x > 0.6 ? { right: `${(1 - here.x) * 100}%` } : { left: `${here.x * 100}%` }}>
          <b>
            {standing(here.w)}
            {numbers ? ` (${Math.round(here.w)}%)` : ''}
          </b>
          <span>{labels[here.ply - 1] ?? `move ${Math.ceil(here.ply / 2)}`}</span>
        </span>
      )}
    </div>
  );
}

export function ReportSheet({ s, review, onClose }: { s: Store; review: ReviewView; onClose: () => void }) {
  const st = s.state!;
  const report = review.report!;
  const figurine = setting(s, 'display.notation', 'figurine') === 'figurine';
  const [note, setNote] = useState(review.ownerNote ?? '');
  useEffect(() => setNote(review.ownerNote ?? ''), [review.gameId, review.ownerNote]);
  const you = st.game?.you ?? st.orientation;
  // however the dialog is closed (the button, Escape, a click outside), a note that was being typed is kept
  const saveNote = () => {
    if (note !== (review.ownerNote ?? '')) send({ type: 'review_note', text: note });
  };
  const close = () => {
    saveNote();
    onClose();
  };
  // each move of the game as it is written: "12... Nf6"
  const moveLabels: string[] = [];
  for (let id = st.tree.nodes[st.tree.root]?.children[0]; id; id = st.tree.nodes[id]?.children[0]) {
    const n = st.tree.nodes[id]!;
    moveLabels.push(`${Math.ceil(n.ply / 2)}${n.ply % 2 === 1 ? '.' : '...'} ${n.san ?? ''}`);
  }
  return (
    <Sheet label="Review of this game" onClose={close} className="report">
      <h2>Review of this game</h2>
      {st.game && (
        <p className="muted">
          {st.game.white} – {st.game.black} · {st.game.result === '1/2-1/2' ? '½-½' : st.game.result}
        </p>
      )}

      {report.positives.length > 0 && (
        <section>
          <h3>What went well</h3>
          {report.positives.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>
      )}

      <section>
        <h3>{report.takeaways.length === 1 ? 'The takeaway' : 'Takeaways'}</h3>
        {report.takeaways.length ? (
          <ol className="report-takeaways">
            {report.takeaways.map((t) => (
              <li key={t.step}>
                {t.text}
                {t.again && <span className="muted"> This one has come up in an earlier game too.</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">None: no slip in this game points at a step of the routine.</p>
        )}
      </section>

      {report.since.length > 0 && (
        <section>
          <h3>Since your last game</h3>
          <ul className="report-since">
            {report.since.map((x) => (
              <li key={x.step}>
                <b>{x.cameUpAgain ? 'Came up again:' : 'Did not come up this time:'}</b> {x.habit.charAt(0).toLowerCase() + x.habit.slice(1)}.
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.moments.length > 0 && (
        <section>
          <h3>The key moments, in your words</h3>
          <p className="muted">The step is the app's reading of the board. You were there: change it if it was something else.</p>
          {review.moments.map((m) => (
            <div className="report-moment" key={m.ply}>
              <span className="report-moment-move">
                {m.number} <San san={m.san} by={m.by} figurine={figurine} /> · {LABEL_NAME[m.label]}: {m.why}.
              </span>
              <label>
                <span className="muted">What was skipped</span>
                <select value={m.step ?? 'unknown'} onChange={(e) => send({ type: 'review_tag', ply: m.ply, step: e.target.value as SkippedStep })}>
                  {STEPS.map((step) => (
                    <option key={step} value={step}>
                      {STEP_NAME[step]}
                    </option>
                  ))}
                </select>
              </label>
              {m.stepBy === 'owner' && <span className="muted">Your own word for it.</span>}
            </div>
          ))}
        </section>
      )}

      {setting(s, 'review.chart', false) && review.chart && (
        <section>
          <h3>Your winning chances through the game</h3>
          <Chart points={review.chart} you={you} marks={review.moments.map((m) => m.ply)} labels={moveLabels} numbers={setting(s, 'display.numbers', false)} />
          <p className="muted">Higher is better for you; the dashed line is an even game. The dots are the key moments. Point at the line to see how the game stood after a move.</p>
        </section>
      )}

      <section>
        <h3>A note for next time</h3>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} placeholder="Anything you want to remember from this game" aria-label="A note for next time" />
      </section>

      <p className="report-closing">{report.closing}</p>
      <div className="modal-actions">
        <button className="btn primary" onClick={close}>
          Close
        </button>
      </div>
    </Sheet>
  );
}
