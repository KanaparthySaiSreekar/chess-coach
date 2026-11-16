// The review screen (feature J4; CONTENT §10; PLAN WP 8.4): where the owner approves content and
// settles doubts. Nothing is studied from until it has passed its gates; here a quarantined item is
// shown at the move that failed, with the reason in plain words, and fixed, dropped or accepted with
// a note; what passed is approved, a repertoire's lines at once after the spot check.

import { useEffect, useMemo, useState } from 'react';
import type { Color, ContentRowView, GateId, OutlineView, RepertoireSummaryView } from '@chess-coach/core';
import { send, useStore } from './store.ts';
import { Segmented, Sheet } from './ui.tsx';

type Tab = 'quarantined' | 'machine-verified' | 'live';
const GATE_NAMES: Record<GateId, string> = { V1: 'Legality', V2: 'Engine soundness', V3: 'Text claims', V4: 'Human reality', V5: 'Consistency', V6: 'Provenance', V7: 'Second opinion', V8: 'Teaching lint' };
const TYPE_NAMES: Record<string, string> = {
  repertoire: 'Repertoire lines',
  puzzle_game: 'Puzzles from your games',
  puzzle_db: 'Lichess puzzles',
  safety: 'Safety checks',
  threat: "What's the threat?",
  convert: 'Won positions',
  trap: 'Traps',
  lesson: 'Lessons',
  endgame: 'Endgames',
  course: 'Courses',
};
const STEP_WORDS: Record<string, string> = { build: 'the positions to prepare', V1: 'legality', V2: 'the engine', V4: 'what players at your level reply', V7: 'the second opinion' };

function RepertoireCard({ r, onShow }: { r: RepertoireSummaryView; onShow: (id: number) => void }) {
  const [removing, setRemoving] = useState(false);
  const building = r.running?.step === 'build';
  return (
    <section className="rep-card" aria-label={`Repertoire ${r.name}`}>
      <header className="rep-head">
        <strong>{r.name}</strong>
        <span className="muted">
          for {r.colour === 'white' ? 'White' : 'Black'} · {r.lines} {r.lines === 1 ? 'line' : 'lines'}
        </span>
      </header>
      <p className="rep-counts">
        <span>{r.live} live</span>
        <span>{r.waiting} waiting for you</span>
        <span className={r.quarantined ? 'bad' : ''}>{r.quarantined} in quarantine</span>
        {r.flagged > 0 && <span>{r.flagged} with a gap</span>}
      </p>
      {r.built && (
        <p className="muted rep-built">
          Built from the masters' games on {r.built.at.slice(0, 10)}: every move played in at least {r.built.minGames} of them, up to {r.built.depth} of your moves
          {r.built.cut !== null ? `; positions met in under ${r.built.cut.toFixed(2)}% of games were left out to keep it to ${r.built.budget} lines` : ''}.
        </p>
      )}
      {r.running && (
        <p className="rep-running" role="status">
          {building ? `Building from the book: ${r.running.done} of up to ${r.running.total} lines so far` : `Checking ${STEP_WORDS[r.running.step] ?? r.running.step}: ${r.running.done} of ${r.running.total}`}
          {building && (
            <button className="btn small" onClick={() => send({ type: 'content', action: 'stop_build' })}>
              Stop
            </button>
          )}
        </p>
      )}
      {r.chapters && r.chapters.length > 0 && (
        <details className="rep-chapters">
          <summary>
            {r.chapters.length} chapters{r.chapters.some((c) => c.waiting) ? ': approve them one at a time' : ''}
          </summary>
          <table>
            <thead>
              <tr>
                <th>Chapter</th>
                <th>Lines</th>
                <th>Live</th>
                <th>Waiting</th>
                <th>Quarantine</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.chapters.map((c) => (
                <tr key={c.name}>
                  <td className="mono-line">{c.name}</td>
                  <td>{c.lines}</td>
                  <td>{c.live}</td>
                  <td>{c.waiting}</td>
                  <td className={c.quarantined ? 'bad' : ''}>{c.quarantined}</td>
                  <td>
                    {c.waiting > 0 && (
                      <button className="btn small" onClick={() => send({ type: 'content', action: 'approve_chapter', repertoire: r.id, chapter: c.name })}>
                        Approve this chapter
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {r.built && r.built.notes.length > 0 && (
        <details className="rep-notes">
          <summary>What the build noted ({r.built.notes.length})</summary>
          <ul>
            {r.built.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {r.gaps.length > 0 && (
        <div className="rep-gaps">
          <h4>{r.gaps.some((g) => g.source === 'book') ? 'Book replies with no answer prepared' : 'Replies at your level with no answer prepared'}</h4>
          <ul>
            {r.gaps.map((g) => (
              <li key={g.at}>
                After <strong>{g.at}</strong>: {g.covered}% covered{g.source === 'maia' ? " (Maia's guess)" : g.source === 'book' ? " (of the masters' games)" : ''}
                {g.missing.length > 0 && <>; no answer to {g.missing.map((m) => `${m.san} (${m.share}%)`).join(', ')}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.waiting > 0 && (
        <div className="rep-sample">
          <h4>Your spot check: look at {r.sample.length === 1 ? 'this line' : 'these lines'} before approving</h4>
          <ul>
            {r.sample.map((x) => (
              <li key={x.id}>
                <span className="mono-line">{x.line}</span>
                <button className="btn small" onClick={() => onShow(x.id)}>
                  Show on the board
                </button>
              </li>
            ))}
          </ul>
          <button className="btn primary" onClick={() => send({ type: 'content', action: 'approve_all', repertoire: r.id })}>
            Approve the {r.waiting} waiting {r.waiting === 1 ? 'line' : 'lines'}
          </button>
        </div>
      )}
      <div className="rep-remove">
        {removing ? (
          <span className="confirm-inline">
            Remove "{r.name}" for good, with its words and its drill cards?
            <button className="btn danger small" onClick={() => (send({ type: 'content', action: 'remove_repertoire', repertoire: r.id }), setRemoving(false))}>
              Remove
            </button>
            <button className="btn small" onClick={() => setRemoving(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button className="btn small" disabled={!!r.running} onClick={() => setRemoving(true)}>
            Remove this repertoire…
          </button>
        )}
      </div>
    </section>
  );
}

/** The outlines in content/repertoires/ (D10, WP 8.12): a repertoire built from the masters' games around the owner's moves. */
function Outlines({ outlines }: { outlines: OutlineView[] }) {
  if (!outlines.length) return null;
  return (
    <div className="rep-outlines">
      <h3>Repertoires from the book</h3>
      <p className="muted">Your moves, chapter by chapter; everything past them comes from the masters' games, every move checked by the engine. Hours the first time (Lichess is asked at its pace); built again, it keeps your approvals and words.</p>
      <ul>
        {outlines.map((o) => (
          <li key={o.id}>
            <strong>{o.name}</strong>{' '}
            <span className="muted">
              for {o.colour === 'white' ? 'White' : 'Black'} · {o.chapters} chapters{o.built ? ` · built ${o.built.slice(0, 10)}` : ''}
            </span>
            {o.problems.length > 0 ? (
              <span className="bad"> cannot be built: {o.problems[0]}</span>
            ) : (
              <button className="btn small" onClick={() => send({ type: 'content', action: 'build_outline', outline: o.id })}>
                {o.repertoire ? 'Build it again' : 'Build it'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemRow({ item, onShow }: { item: ContentRowView; onShow: (id: number) => void }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <li className={`content-item ${item.status}`}>
      <div className="content-title">
        <span className={item.type === 'repertoire' ? 'mono-line' : ''}>{item.title}</span>
        <span className="muted content-type">{item.chapter ?? TYPE_NAMES[item.type] ?? item.type}</span>
      </div>
      {item.book && item.book.length > 0 && <p className="muted content-book">In the masters' games: the fewest for any move of the line is {Math.min(...item.book).toLocaleString('en-US')} games.</p>}
      {item.reasons.length > 0 && (
        <ul className="content-reasons">
          {item.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {item.flags.length > 0 && (
        <ul className="content-flags">
          {item.flags.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {item.note && <p className="content-note">Your note: {item.note}</p>}
      <div className="content-actions">
        {(item.fixable || item.type === 'repertoire') && (
          <button className="btn small" onClick={() => onShow(item.id)}>
            Show on the board
          </button>
        )}
        {item.fixable && (
          <button className="btn small" onClick={() => send({ type: 'content', action: 'fix', id: item.id })} title="Replace the line with the moves on the board (play your move at the one that failed first); the gates run again">
            Use the board's moves
          </button>
        )}
        {item.status === 'machine-verified' && (
          <button className="btn small primary" onClick={() => send({ type: 'content', action: 'approve', id: item.id })}>
            Approve
          </button>
        )}
        {item.status === 'quarantined' &&
          (noting ? (
            <span className="content-accept">
              <input aria-label="Why you accept it" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you accept it" />
              <button className="btn small" disabled={!note.trim()} onClick={() => (send({ type: 'content', action: 'accept', id: item.id, note }), setNoting(false))}>
                Accept
              </button>
              <button className="btn small" onClick={() => setNoting(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn small" onClick={() => setNoting(true)}>
              Accept with a note…
            </button>
          ))}
        {confirm ? (
          <span className="confirm-inline">
            Drop it?
            <button className="btn danger small" onClick={() => (send({ type: 'content', action: 'drop', id: item.id }), setConfirm(false))}>
              Yes
            </button>
            <button className="btn small" onClick={() => setConfirm(false)}>
              No
            </button>
          </span>
        ) : (
          <button className="btn small" onClick={() => setConfirm(true)}>
            Drop
          </button>
        )}
      </div>
    </li>
  );
}

/** A repertoire in (D2, WP 8.7): a PGN pasted or read from a file, a Lichess study link, or one of the owner's studies. */
function ImportRepertoire() {
  const s = useStore();
  const [colour, setColour] = useState<Color>('white');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [study, setStudy] = useState('');
  const studies = s.studies?.studies ?? [];
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
  };
  return (
    <details className="rep-import">
      <summary>Import a repertoire</summary>
      <div className="rep-import-body">
        <Segmented value={colour} onChange={setColour} label="The side the repertoire is for" options={[{ value: 'white', label: 'For White' }, { value: 'black', label: 'For Black' }]} />
        <input aria-label="Its name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Its name" />
        <textarea aria-label="A PGN or a Lichess study link" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="A PGN (chapters for the other side are left out), or https://lichess.org/study/…" />
        <div className="rep-import-actions">
          <label className="btn small file-pick">
            Read a PGN file…
            <input type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain" onChange={(e) => void readFile(e.target.files?.[0])} />
          </label>
          <button className="btn small primary" disabled={!text.trim()} onClick={() => (send({ type: 'content', action: 'import', colour, name, text }), setText(''))}>
            Check and import
          </button>
        </div>
        {studies.length > 0 && (
          <div className="rep-import-actions">
            <select aria-label="One of your studies" value={study} onChange={(e) => setStudy(e.target.value)}>
              <option value="">Or one of your studies…</option>
              {studies.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button className="btn small" disabled={!study} onClick={() => send({ type: 'content', action: 'import', colour, name, study: Number(study) })}>
              Check and import the study
            </button>
          </div>
        )}
        <p className="muted">Every line goes through the gates; what fails waits here with the reason, and nothing goes live before you approve it.</p>
      </div>
    </details>
  );
}

export function ContentReviewDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const v = s.content;
  const [tab, setTab] = useState<Tab>('quarantined');
  const [type, setType] = useState('all');
  const [gate, setGate] = useState<'any' | GateId>('any');
  const [chapter, setChapter] = useState('');
  useEffect(() => send({ type: 'content', action: 'open' }), []);
  const items = useMemo(() => (v?.items ?? []).filter((i) => i.status === tab && (type === 'all' || i.type === type) && (gate === 'any' || i.gates.includes(gate)) && (!chapter || i.chapter === chapter)), [v, tab, type, gate, chapter]);
  const chapters = useMemo(() => [...new Set((v?.items ?? []).filter((i) => i.status === tab && i.chapter).map((i) => i.chapter!))], [v, tab]);
  const types = useMemo(() => [...new Set((v?.items ?? []).map((i) => i.type))], [v]);
  const gates = useMemo(() => [...new Set((v?.items ?? []).flatMap((i) => i.gates))].sort(), [v]);
  const show = (id: number) => {
    send({ type: 'content', action: 'show', id });
    onClose();
  };

  return (
    <Sheet label="Review content" onClose={onClose} className="content-sheet">
      <h2>Review content</h2>
      <p className="muted">Nothing you study from is used until it has passed its checks. Here you settle what did not pass, and approve what did.</p>
      {!v ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {v.repertoires.map((r) => (
            <RepertoireCard key={r.id} r={r} onShow={show} />
          ))}
          <Outlines outlines={v.outlines ?? []} />
          <div className="rep-build">
            <span className="muted">A starter repertoire, built around your openings in Settings → Repertoire. Nothing goes live before you approve it.</span>
            <span className="rep-build-actions">
              <button className="btn small" onClick={() => send({ type: 'content', action: 'build', colour: 'white' })}>
                Build one for White
              </button>
              <button className="btn small" onClick={() => send({ type: 'content', action: 'build', colour: 'black' })}>
                Build one for Black
              </button>
            </span>
          </div>
          <ImportRepertoire />
          <div className="content-filters">
            <Segmented
              value={tab}
              onChange={setTab}
              label="Which items"
              options={[
                { value: 'quarantined', label: `In quarantine (${v.counts.quarantined})` },
                { value: 'machine-verified', label: `Waiting for you (${v.counts.waiting})` },
                { value: 'live', label: `Live (${v.counts.live})` },
              ]}
            />
            <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">Every type</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {TYPE_NAMES[t] ?? t}
                </option>
              ))}
            </select>
            <select aria-label="Gate" value={gate} onChange={(e) => setGate(e.target.value as 'any' | GateId)}>
              <option value="any">Any gate</option>
              {gates.map((g) => (
                <option key={g} value={g}>
                  {g} {GATE_NAMES[g]}
                </option>
              ))}
            </select>
            {chapters.length > 0 && (
              <select aria-label="Chapter" value={chapter} onChange={(e) => setChapter(e.target.value)}>
                <option value="">Every chapter</option>
                {chapters.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>
          {items.length === 0 ? (
            <p className="muted content-empty">{tab === 'quarantined' ? 'Nothing in quarantine.' : tab === 'machine-verified' ? 'Nothing is waiting for you.' : 'Nothing live yet.'}</p>
          ) : (
            <ul className="content-list">
              {items.map((i) => (
                <ItemRow key={i.id} item={i} onShow={show} />
              ))}
            </ul>
          )}
        </>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}
