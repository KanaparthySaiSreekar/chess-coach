// The voice on the page (features A20, A21; TRACKER D108): the microphone button beside a chat box,
// the line that says what it is doing, the speaker switch in the coach's head, a message read out
// again, the voice chosen by ear, and the download of the natural voice. The work is in audio.ts.

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { Download, LoaderCircle, Mic, Play, Square, Volume2, VolumeX } from 'lucide-react';
import type { CoachMessage } from '@chess-coach/core';
import { send, setting, useStore, type Store } from './store.ts';
import { forgetListenAgain, hearVoice, installVoice, listenAgainWith, refreshVoiceStatus, speakMessage, startListening, stopListening, stopSpeaking, useVoice, type VoiceStatus } from './audio.ts';

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

/** Ask the server what it has installed, once, when a voice control first shows. */
function useVoiceStatus(): VoiceStatus | null {
  const v = useVoice();
  useEffect(() => {
    if (!v.status) void refreshVoiceStatus();
  }, [v.status]);
  return v.status;
}

/**
 * The microphone beside a chat box: press, ask out loud, pause. `heard` gets the words. Shown only
 * when "Talk to the coach" is on. `id` tells this button apart from the other chat boxes.
 */
export function MicButton({ id, heard, disabled }: { id: string; heard: (text: string) => void; disabled?: boolean }) {
  const s = useStore();
  const v = useVoice();
  const listen = setting(s, 'voice.listen', false);
  // the newest `heard`, and this button's own start, for the callbacks that outlive a render
  const latest = useRef(heard);
  const self = useRef<() => void>(() => {});
  useEffect(() => {
    latest.current = heard;
  });
  const begin = useCallback(() => {
    void startListening(id, (text) => {
      listenAgainWith(self.current);
      latest.current(text);
    });
  }, [id]);
  useEffect(() => {
    self.current = begin;
    return () => forgetListenAgain(begin);
  }, [begin]);
  if (!listen) return null;
  const phase = v.mic?.owner === id ? v.mic.phase : null;
  const busyElsewhere = !!v.mic && !phase;
  const label = phase === 'writing' ? 'Writing down what you said' : phase ? 'Stop listening and send' : 'Talk to the coach';
  return (
    <button
      type="button"
      className={`mic${phase ? ` mic-${phase}` : ''}`}
      style={{ '--level': phase ? v.level : 0 } as CSSProperties}
      aria-pressed={!!phase}
      aria-label={label}
      title={phase ? `${label} (or just pause)` : 'Talk to the coach: press, ask out loud, then pause'}
      disabled={disabled || busyElsewhere || phase === 'writing' || phase === 'starting'}
      onClick={() => (phase ? stopListening(true) : begin())}
    >
      {phase === 'writing' || phase === 'starting' ? <LoaderCircle className="spin" size={17} strokeWidth={2.2} /> : <Mic size={17} strokeWidth={2.2} />}
    </button>
  );
}

/** One line above the chat box while the microphone is open: what it is doing, or the words so far. */
export function VoiceCaption({ id }: { id: string }) {
  const v = useVoice();
  if (v.mic?.owner !== id) return null;
  const text = v.mic.phase === 'writing' ? 'Writing down what you said…' : v.interim ? `“${v.interim}”` : v.mic.phase === 'hearing' ? 'Listening… pause when you are done.' : v.mic.phase === 'starting' ? 'Opening the microphone…' : 'Listening… ask your question.';
  return (
    <div className="voice-caption" role="status" aria-live="polite">
      <span className={`voice-dot${v.mic.phase === 'hearing' ? ' on' : ''}`} aria-hidden="true" />
      <span>{text}</span>
      {v.mic.phase !== 'writing' && (
        <button className="link" onClick={() => stopListening(false)}>
          Cancel
        </button>
      )}
    </div>
  );
}

/**
 * The speaker in the coach's head: switches "The coach speaks aloud" on and off; while the coach is
 * talking it stops the talking instead (the setting stays on).
 */
export function SpeakToggle() {
  const s = useStore();
  const v = useVoice();
  const speak = setting(s, 'voice.speak', false);
  if (v.speaking) {
    return (
      <button className="icon-btn plain speaking" onClick={stopSpeaking} aria-label="Stop talking" title="Stop talking (the coach still speaks its next message)">
        <Square size={13} strokeWidth={2.6} fill="currentColor" />
      </button>
    );
  }
  return (
    <button
      className={`icon-btn plain${speak ? ' on' : ''}`}
      role="switch"
      aria-checked={speak}
      aria-label="The coach speaks aloud"
      title={speak ? 'The coach speaks aloud: on' : 'The coach speaks aloud: off (text only)'}
      onClick={() => send({ type: 'setting', key: 'voice.speak', value: !speak })}
    >
      {speak ? <Volume2 size={16} strokeWidth={1.9} /> : <VolumeX size={16} strokeWidth={1.9} />}
    </button>
  );
}

/** Read one coach message out again (shown when the coach speaks aloud). */
export function ReplayButton({ m }: { m: CoachMessage }) {
  const s = useStore();
  if (!setting(s, 'voice.speak', false) || m.from !== 'coach') return null;
  return (
    <button className="msg-replay" onClick={() => speakMessage(m)} aria-label="Read this out again" title="Read this out again">
      <Volume2 size={13} strokeWidth={2} />
    </button>
  );
}

/** The coach's voice, chosen by ear: the choices and a button that plays a sample. `compact`: the names only ("Michael (American)"), for a narrow menu. */
export function VoicePicker({ s, compact }: { s: Store; compact?: boolean }) {
  const def = s.settings.find((x) => x.key === 'voice.voice');
  if (!def) return null;
  const value = def.value as string;
  return (
    <div className="voice-picker">
      <select value={value} onChange={(e) => send({ type: 'setting', key: 'voice.voice', value: e.target.value })} aria-label={def.label}>
        {(def.options ?? []).map((o) => (
          <option key={o} value={o} title={def.optionLabels?.[o]}>
            {compact ? (def.optionLabels?.[o] ?? o).replace(/:.*\(/, ' (') : (def.optionLabels?.[o] ?? o)}
          </option>
        ))}
      </select>
      <button className="btn small" onClick={() => hearVoice(value)} title="Play a sample of this voice">
        <Play size={13} strokeWidth={2.2} aria-hidden="true" />
        Hear it
      </button>
    </div>
  );
}

/** Whether the natural voice and the recogniser are on this computer, and the button that downloads them. */
export function VoiceInstall({ compact }: { compact?: boolean }) {
  const status = useVoiceStatus();
  if (!status) return null;
  const missing = status.speak === 'missing' || status.listen === 'missing';
  const busy = status.install && !status.install.error;
  if (!missing && !busy && !status.detail) return compact ? null : <p className="voice-install ok">The natural voice and the recogniser are installed on this computer.</p>;
  return (
    <div className="voice-install">
      {busy ? (
        <>
          <span>
            Downloading and checking: {mb(status.install!.done)} of {mb(status.install!.total)}
          </span>
          <progress max={status.install!.total} value={status.install!.done} />
        </>
      ) : missing ? (
        <>
          <span>{compact ? `The natural voice is not on this computer yet (${mb(status.downloadBytes)}, once).` : `The natural voice and the recogniser are not on this computer yet: ${mb(status.downloadBytes)}, downloaded once from Hugging Face and checked file by file. Until then the browser's own voice and recogniser stand in.`}</span>
          <button className="btn small" onClick={() => void installVoice()}>
            <Download size={14} strokeWidth={2} aria-hidden="true" />
            Download
          </button>
          {status.install?.error && <span className="error-text">The last try stopped: {status.install.error}</span>}
        </>
      ) : (
        <span className="error-text">{status.detail}</span>
      )}
    </div>
  );
}

function Switch({ s, k, label }: { s: Store; k: string; label: string }) {
  const def = s.settings.find((x) => x.key === k);
  if (!def) return null;
  const value = def.value as boolean;
  return (
    <div className="quick-row" title={def.why}>
      <span>{label}</span>
      <button className={`toggle${value ? ' on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={() => send({ type: 'setting', key: k, value: !value })}>
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

/** The voice part of the coach's options: the two switches, the voice, and the download when it is missing. */
export function VoiceOptions({ s }: { s: Store }) {
  const speak = setting(s, 'voice.speak', false);
  const listen = setting(s, 'voice.listen', false);
  return (
    <>
      <h3>Voice</h3>
      <div className="group">
        <Switch s={s} k="voice.speak" label="Speak the coach's words" />
        <Switch s={s} k="voice.listen" label="Talk instead of typing" />
        {listen && <Switch s={s} k="voice.handsFree" label="Listen again after each answer" />}
      </div>
      {speak && <VoicePicker s={s} compact />}
      {(speak || listen) && <VoiceInstall compact />}
    </>
  );
}
