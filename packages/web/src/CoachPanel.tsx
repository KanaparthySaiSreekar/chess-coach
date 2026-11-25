// The coach pane (features A0, A10, A12, A13, A14): the conversation, the four quick replies,
// typed questions, the coach's status, and one options button that holds how often the coach
// speaks, which model it uses, its usage and "clear the conversation".

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Check, Eraser, SlidersHorizontal } from 'lucide-react';
import { spokenChip, type Chip, type CoachMessage, type ResolvedToken, type Segment } from '@chess-coach/core';
import { San, useFigurine } from './San.tsx';
import { send, setHover, setPeek, setting, stopAnim, useStore, type Store } from './store.ts';
import { Mark, Popover, Segmented } from './ui.tsx';
import { MicButton, ReplayButton, SpeakToggle, VoiceCaption, VoiceOptions } from './Voice.tsx';
import { ownerTyped } from './audio.ts';

const STATE_TEXT: Record<string, string> = {
  off: 'Off',
  starting: 'Starting…',
  ready: 'Ready',
  thinking: 'Thinking…',
  retrying: 'Retrying…',
  error: 'Stopped',
};

const KIND_LABEL: Partial<Record<NonNullable<CoachMessage['kind']>, string>> = { idea: "Coach's view", praise: 'Well done', summary: 'Summary', general: 'General chess knowledge' };

const SPEAKS: [string, string, string][] = [
  ['silent', 'Only when asked', 'Quiet until you ask something.'],
  ['key_moments', 'At key moments', 'Speaks up when a move matters.'],
  ['every_move', 'On every move', 'A comment after each move.'],
];
const MODELS: [string, string, string][] = [
  ['haiku', 'Haiku', 'Fast: answers in about a second.'],
  ['sonnet', 'Sonnet', 'Careful: explains more, takes longer.'],
  ['opus', 'Opus', 'Deepest: the slowest and the costliest.'],
];

const SUGGESTIONS = ['Show me the threats on the board', 'What should I play?', 'Why was my last move bad?', "What's the plan in this position?"];

function Token({ token }: { token: ResolvedToken }) {
  const figurine = useFigurine();
  if (token.kind === 'move') {
    return (
      <button
        className="tok tok-move"
        title="Click to see this move on the board"
        onMouseEnter={() => setHover([token.from, token.to])}
        onMouseLeave={() => setHover([])}
        onClick={() => {
          stopAnim();
          setPeek({ fen: token.fenAfter, from: token.from, to: token.to, san: token.san });
        }}
      >
        <San san={token.san} by={token.baseFen.split(' ')[1] === 'b' ? 'black' : 'white'} figurine={figurine} />
      </button>
    );
  }
  return (
    <span className="tok tok-square" onMouseEnter={() => setHover([token.square])} onMouseLeave={() => setHover([])}>
      {token.square}
    </span>
  );
}

function Body({ segments }: { segments: Segment[] }) {
  return <>{segments.map((s, i) => (s.type === 'text' ? <span key={i}>{s.text}</span> : <Token key={i} token={s.token} />))}</>;
}

/** One message of the coach, the owner or the app. Shared with the Puzzles tab (the drill coach, WP 6.11). */
export function Message({ m }: { m: CoachMessage }) {
  if (m.from === 'owner') {
    return (
      <div className="msg msg-owner">
        <div className="bubble">{m.text}</div>
      </div>
    );
  }
  if (m.from === 'system') return <div className="msg msg-system">{m.text}</div>;
  const label = m.kind ? KIND_LABEL[m.kind] : undefined;
  return (
    <div className={`msg msg-coach kind-${m.kind ?? 'explain'}`}>
      <Mark className="avatar" />
      <div className="bubble">
        <ReplayButton m={m} />
        {label && <div className="msg-label">{label}</div>}
        <Body segments={m.segments} />
        {m.kind === 'idea' && <div className="msg-note">An idea, not a checked fact.</div>}
        {m.kind === 'general' && <div className="msg-note">Not about this position, so not checked against the board.</div>}
        {m.source === 'scripted' && <div className="msg-note">From the checked facts (the coach did not write this).</div>}
        {m.checked && m.kind !== 'idea' && (
          <div className="msg-check" title={m.checked}>
            <Check size={13} strokeWidth={2.6} aria-hidden="true" />
            {m.checked.includes('Lichess') ? (m.checked.includes('agrees') ? 'Matches Lichess analysis' : 'Lichess analysis') : m.checked.startsWith('Checked on the board') ? 'Checked on the board' : 'Checked by Stockfish'}
          </div>
        )}
        {m.expect === 'move' && <div className="msg-note expect">Answer by playing your move on the board.</div>}
        {m.expect === 'choice' && m.choices?.length ? (
          <div className="choices">
            {m.choices.map((c) => (
              <button
                key={c}
                className="chip"
                onClick={() => {
                  ownerTyped();
                  send({ type: 'ask', text: c });
                }}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** How often the coach speaks, its model, its usage, and clearing the conversation: one button, out of the way. */
function Options({ s }: { s: Store }) {
  const st = s.status;
  const model = setting(s, 'coach.model.analysis', 'haiku');
  const verbosity = setting(s, 'coach.verbosity.analysis', 'key_moments');
  const u = st?.usage;
  const tokens = u ? u.inputTokens + u.outputTokens + u.cacheReadTokens : 0;
  return (
    <Popover label={<SlidersHorizontal size={16} strokeWidth={1.9} />} ariaLabel="Coach options" title="How the coach speaks, its model and its usage" buttonClass="icon-btn plain" align="end">
      {(close) => (
        <div className="coach-options">
          <h3>The coach speaks</h3>
          <div className="group" role="radiogroup" aria-label="The coach speaks">
            {SPEAKS.map(([value, name, about]) => (
              <button key={value} role="radio" aria-checked={verbosity === value} className="option-row" onClick={() => send({ type: 'setting', key: 'coach.verbosity.analysis', value })}>
                <span className="option-tick" aria-hidden="true">
                  {verbosity === value && <Check size={15} strokeWidth={2.4} />}
                </span>
                <span className="option-text">
                  <span className="option-name">{name}</span>
                  <span className="option-about">{about}</span>
                </span>
              </button>
            ))}
          </div>
          <h3>Model</h3>
          <Segmented className="wide" label="Coach model" value={model} options={MODELS.map(([value, name, about]) => ({ value, label: name, title: about }))} onChange={(value) => send({ type: 'setting', key: 'coach.model.analysis', value })} />
          <p className="option-note">{MODELS.find(([value]) => value === model)?.[2]}</p>
          <VoiceOptions s={s} />
          {u && u.turns > 0 && (
            <p className="option-note usage" title={`Checked messages accepted first time: ${st!.firstTry.ok} of ${st!.firstTry.total}.`}>
              This session: {u.turns} {u.turns === 1 ? 'turn' : 'turns'}, {tokens.toLocaleString()} tokens ({u.cacheReadTokens.toLocaleString()} of them cached).
            </p>
          )}
          <button
            className="btn quiet wide"
            disabled={s.thread.length === 0}
            onClick={() => {
              close();
              send({ type: 'clear_thread' });
            }}
          >
            <Eraser size={15} strokeWidth={1.9} aria-hidden="true" />
            Clear the conversation
          </button>
        </div>
      )}
    </Popover>
  );
}

function Header({ s }: { s: Store }) {
  const st = s.status;
  const state = st?.state ?? 'off';
  const on = state !== 'off' && state !== 'error';
  return (
    <div className="coach-head">
      <div className="coach-title">
        <span className={`dot dot-${state}`} aria-hidden="true" />
        <div className="coach-name">
          <h2>Coach</h2>
          <span className="coach-state" role="status">
            {STATE_TEXT[state] ?? state}
            {on && st?.model ? `, ${st.model.replace('claude-', '')}` : ''}
          </span>
        </div>
        <button className={on ? 'btn small' : 'btn primary small'} onClick={() => send({ type: 'coach', action: on ? 'stop' : 'start' })}>
          {on ? 'Stop coach' : 'Start coach'}
        </button>
        <SpeakToggle />
        <Options s={s} />
      </div>
      {st?.detail && <div className={`coach-detail${state === 'error' ? ' error' : ''}`}>{st.detail}</div>}
    </div>
  );
}

export function CoachPanel() {
  const s = useStore();
  // messages about a puzzle, a game against a bot or the walked repertoire are shown beside them, not here
  const thread = s.thread.filter((x) => x.drill === undefined && x.spar === undefined && !x.walk);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const thinking = s.status?.state === 'thinking' || s.status?.state === 'starting' || s.status?.state === 'retrying';
  const lastIsOwner = thread.at(-1)?.from === 'owner';

  const settled = useRef(false);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: settled.current ? 'smooth' : 'auto' });
    if (thread.length) settled.current = true;
  }, [thread.length, thinking]);

  const ask = (q: string, byVoice = false) => {
    const t = q.trim();
    if (!t) return;
    if (!byVoice) ownerTyped();
    send({ type: 'ask', text: t });
    setText('');
  };
  // what the owner said (A21): a quick reply said on its own is that button; anything else is a question, sent at once or put in the box to check
  const input = useRef<HTMLTextAreaElement>(null);
  const heard = (said: string) => {
    if (!setting(s, 'voice.autoSend', true)) {
      setText((t) => (t.trim() ? `${t.trim()} ${said}` : said));
      input.current?.focus();
      return;
    }
    const c = spokenChip(said);
    if (c) send({ type: 'chip', chip: c });
    else ask(said, true);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(text);
    }
  };
  const chip = (c: Chip) => {
    ownerTyped();
    send({ type: 'chip', chip: c });
  };

  return (
    <aside className="pane pane-right coach" aria-label="Coach">
      <Header s={s} />
      <div className="thread" aria-live="polite">
        {thread.length === 0 && (
          <div className="thread-empty">
            <p className="thread-empty-title">Ask anything about the position.</p>
            <p>The coach answers on the board: it draws the threats, plays out lines you can step through, and explains in plain words. Every chess statement is checked against the board before you see it.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((q) => (
                <button key={q} className="suggestion" onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {thread.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {thinking && lastIsOwner && (
          <div className="msg msg-coach">
            <Mark className="avatar" />
            <div className="bubble typing" aria-label="The coach is thinking">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="composer">
        <div className="chips" role="group" aria-label="Quick replies">
          <button className="chip" onClick={() => chip('hint')} title="The next small hint">
            Hint
          </button>
          <button className="chip" onClick={() => chip('tell_me')} title="Skip the hints: give me the answer">
            Just tell me
          </button>
          <button className="chip" onClick={() => chip('why')} title="Explain the last point">
            Why?
          </button>
          <button className="chip" onClick={() => chip('show_me')} title="Play it out on the board">
            Show me
          </button>
        </div>
        <VoiceCaption id="analysis" />
        <form className="ask" onSubmit={submit}>
          <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={2} placeholder={setting(s, 'voice.listen', false) ? 'Ask the coach, or press the microphone and ask out loud…' : 'Ask the coach about this position…'} aria-label="Ask the coach" maxLength={1000} />
          <MicButton id="analysis" heard={heard} />
          <button className="send" type="submit" disabled={!text.trim()} aria-label="Send" title="Send (Enter)">
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        </form>
      </div>
    </aside>
  );
}
