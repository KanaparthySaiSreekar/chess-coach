// The coach on the Openings tab (feature D12; the owner, 2026-11-16: "coach would be there seeing my
// board and i can ask it any time"). Beside the repertoire being walked and beside the practice card:
// the coach sees that board, and the owner types a question whenever they like. The answers go through
// the same checks as on the analysis board; while a card asks for the move, the coach does not name it.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import type { CoachMessage } from '@chess-coach/core';
import { Message } from './CoachPanel.tsx';
import { send, type Store } from './store.ts';
import { Mark } from './ui.tsx';

export function OpeningCoach({ s, shows, thread, suggestions = [], showThread = true }: { s: Store; shows: string; thread: (m: CoachMessage) => boolean; suggestions?: string[]; showThread?: boolean }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const messages = s.thread.filter(thread);
  const state = s.status?.state ?? 'off';
  const on = state !== 'off' && state !== 'error';
  const thinking = state === 'thinking' || state === 'starting' || state === 'retrying';
  const lastIsOwner = messages.at(-1)?.from === 'owner';
  useEffect(() => {
    if (showThread) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messages.length, thinking, showThread]);

  const ask = (q: string) => {
    const t = q.trim();
    if (!t) return;
    send({ type: 'ask', text: t });
    setText('');
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
    <section className="pane-section opening-coach" aria-label="Ask the coach">
      <header className="pane-head">
        <h2>Coach</h2>
        {on ? (
          <span className="muted opening-coach-state" role="status">
            {thinking ? 'Thinking…' : `Sees ${shows}`}
          </span>
        ) : (
          <button className="btn small primary" onClick={() => send({ type: 'coach', action: 'start' })}>
            Start coach
          </button>
        )}
      </header>
      {showThread && (
        <div className="drill-thread" aria-live="polite">
          {messages.length === 0 && on && suggestions.length > 0 && (
            <div className="suggestions">
              {suggestions.map((q) => (
                <button key={q} className="suggestion" onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
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
      <form className="ask" onSubmit={submit}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={2} placeholder={`Ask the coach about ${shows}…`} aria-label="Ask the coach" maxLength={1000} />
        <button className="send" type="submit" disabled={!text.trim()} aria-label="Send" title="Send (Enter)">
          <ArrowUp size={17} strokeWidth={2.4} />
        </button>
      </form>
    </section>
  );
}
