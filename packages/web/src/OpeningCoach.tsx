// The coach on the Openings tab (feature D12; the owner, 2026-11-16: "coach would be there seeing my
// board and i can ask it any time"). Beside the repertoire being walked and beside the practice card:
// the coach sees that board, and the owner types a question whenever they like. The answers go through
// the same checks as on the analysis board; while a card asks for the move, the coach does not name it.
// It looks like the analysis board's coach pane (CoachPanel): the same head, thread and composer.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import type { CoachMessage } from '@chess-coach/core';
import { Message } from './CoachPanel.tsx';
import { send, setting, type Store } from './store.ts';
import { Mark } from './ui.tsx';
import { MicButton, SpeakToggle, VoiceCaption } from './Voice.tsx';
import { ownerTyped } from './audio.ts';

const STATE_TEXT: Record<string, string> = { off: 'Off', starting: 'Starting…', ready: 'Ready', thinking: 'Thinking…', retrying: 'Retrying…', error: 'Stopped' };

/** The same box beside the Puzzles tab's other drills (the safety check, the threat, a won game: D105). */
export { OpeningCoach as BoardCoach };

/** Ask the coach about the board in front of you; `send` it from anywhere on the tab (a button that asks a set question). */
export function askCoach(text: string) {
  send({ type: 'ask', text });
}

export function OpeningCoach({ s, shows, thread, suggestions = [], compact = false }: { s: Store; shows: string; thread: (m: CoachMessage) => boolean; suggestions?: string[]; compact?: boolean }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const messages = s.thread.filter(thread);
  const state = s.status?.state ?? 'off';
  const on = state !== 'off' && state !== 'error';
  const thinking = state === 'thinking' || state === 'starting' || state === 'retrying';
  const lastIsOwner = messages.at(-1)?.from === 'owner';
  useEffect(() => {
    if (!compact) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, thinking, compact]);

  const ask = (q: string, byVoice = false) => {
    const t = q.trim();
    if (!t) return;
    if (!byVoice) ownerTyped();
    askCoach(t);
    setText('');
  };
  // what the owner said out loud (A21): sent at once, or put in the box to check first
  const heard = (said: string) => {
    if (setting(s, 'voice.autoSend', true)) return ask(said, true);
    setText((t) => (t.trim() ? `${t.trim()} ${said}` : said));
    input.current?.focus();
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

  return (
    <section className={`opening-coach${compact ? ' compact' : ''}`} aria-label="Ask the coach">
      <div className="coach-head">
        <div className="coach-title">
          <span className={`dot dot-${state}`} aria-hidden="true" />
          <div className="coach-name">
            <h2>Coach</h2>
            <span className="coach-state" role="status">
              {on ? (thinking ? STATE_TEXT[state] : `Sees ${shows}`) : (STATE_TEXT[state] ?? state)}
            </span>
          </div>
          <button className={on ? 'btn small' : 'btn primary small'} onClick={() => send({ type: 'coach', action: on ? 'stop' : 'start' })}>
            {on ? 'Stop coach' : 'Start coach'}
          </button>
          <SpeakToggle />
        </div>
      </div>
      {!compact && (
        <div className="thread" aria-live="polite">
          {messages.length === 0 && (
            <div className="thread-empty">
              <p className="opening-coach-hint">{on ? `Ask anything about ${shows}: the coach checks every chess statement against the engine before you see it.` : `Start the coach to ask about ${shows}.`}</p>
              {on && suggestions.length > 0 && (
                <div className="suggestions">
                  {suggestions.map((q) => (
                    <button key={q} className="suggestion" onClick={() => ask(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m) => (
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
      )}
      <div className="composer">
        <VoiceCaption id="board" />
        <form className="ask" onSubmit={submit}>
          <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={compact ? 1 : 2} placeholder={`Ask the coach about ${shows}…`} aria-label="Ask the coach" maxLength={1000} />
          <MicButton id="board" heard={heard} />
          <button className="send" type="submit" disabled={!text.trim()} aria-label="Send" title="Send (Enter)">
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        </form>
      </div>
    </section>
  );
}
