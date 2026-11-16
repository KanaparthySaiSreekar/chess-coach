// Studies (feature I6; PLAN WP 8.1): the owner's annotated lines in chapters. A chapter opens on the
// analysis board; the board, with its comments, marks and drawings, is saved back into it or added
// as a new chapter. A PGN or a Lichess study link comes in as a new study; a study goes out as PGN.

import { useState } from 'react';
import { send, useStore } from './store.ts';
import { Sheet } from './ui.tsx';

export function StudiesDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const v = s.studies;
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);
  const studies = v?.studies ?? [];
  const open = v?.open ? studies.find((x) => x.id === v.open!.study) : undefined;
  const openChapter = open?.chapters.find((c) => c.id === v?.open?.chapter);

  return (
    <Sheet label="Studies" onClose={onClose}>
      <h2>Studies</h2>
      {open && openChapter && (
        <div className="study-open">
          <span>
            On the board: <strong>{open.name}</strong> · {openChapter.name}
          </span>
          <button className="btn primary" onClick={() => send({ type: 'study', action: 'save' })}>
            Save the board to this chapter
          </button>
        </div>
      )}
      {studies.length === 0 ? (
        <p className="muted">No studies yet. Save the board as one, or import a PGN or a Lichess study below.</p>
      ) : (
        <ul className="study-list">
          {studies.map((st) => (
            <li key={st.id}>
              <div className="study-head">
                <strong>{st.name}</strong>
                <span className="muted">{st.source.startsWith('https://lichess.org/study/') ? 'from Lichess' : st.source === 'own' ? 'yours' : 'from a PGN'}</span>
              </div>
              <div className="study-chapters">
                {st.chapters.map((c) => (
                  <button
                    key={c.id}
                    className={`chip${v?.open?.chapter === c.id ? ' on' : ''}`}
                    onClick={() => {
                      send({ type: 'study', action: 'open', chapter: c.id });
                      onClose();
                    }}
                    title={`Open on the board (${c.orientation === 'black' ? 'Black' : 'White'} at the bottom)`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="study-actions">
                <button className="btn small" onClick={() => send({ type: 'study', action: 'add', study: st.id, name: `Chapter ${st.chapters.length + 1}` })}>
                  Add the board here
                </button>
                <button className="btn small" onClick={() => send({ type: 'study', action: 'export', study: st.id })}>
                  Export
                </button>
                {confirm === st.id ? (
                  <span className="confirm-inline">
                    Remove it?
                    <button className="btn danger small" onClick={() => (send({ type: 'study', action: 'remove', study: st.id }), setConfirm(null))}>
                      Yes
                    </button>
                    <button className="btn small" onClick={() => setConfirm(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button className="btn small" onClick={() => setConfirm(st.id)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="field">
        <label className="field-label" htmlFor="study-name">
          A new study from the board
        </label>
        <div className="study-new">
          <input id="study-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Its name" />
          <button className="btn" disabled={!name.trim()} onClick={() => (send({ type: 'study', action: 'add', name }), setName(''))}>
            Save as a new study
          </button>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="study-import">
          Import a PGN or a Lichess study
        </label>
        <textarea id="study-import" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://lichess.org/study/… or a PGN with one game per chapter" />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
        <button className="btn primary" disabled={!text.trim()} onClick={() => (send({ type: 'study', action: 'import', text }), setText(''))}>
          Import
        </button>
      </div>
    </Sheet>
  );
}
