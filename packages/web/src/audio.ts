// The coach's voice and the owner's, on the page (features A20, A21; TRACKER D108; ARCHITECTURE §20).
//
// Speaking: every new coach message, when "The coach speaks aloud" is on, is turned into words
// (`spokenMessage`, moves said as a coach says them), cut into sentences, and played one after the
// other. Each sentence is made by the server's natural voice (Kokoro, on this computer) while the one
// before it plays, or by the browser's own voice when that is chosen or the natural one is not
// installed.
//
// Listening: the microphone button records until the owner pauses (`Endpointer`), and the server's
// recogniser (Whisper, on this computer) writes it down; or the browser's recogniser does, which in
// Chrome means Google's servers. What was said goes to the coach like a typed question.
//
// Nothing here touches the chess: what is spoken is what the message says, and what is heard is
// sent as the owner's words, through the same checks as typing.

import { useSyncExternalStore } from 'react';
import { Endpointer, LISTEN_SAMPLE_RATE, resample, rms, speechChunks, spokenMessage, tidyTranscript, toInt16, type CoachMessage } from '@chess-coach/core';
import { getStore, onCoachMessage, setting, subscribe, toast } from './store.ts';

export type PartState = 'missing' | 'installed' | 'loading' | 'ready' | 'error';
export type VoiceStatus = { speak: PartState; listen: PartState; detail?: string; install?: { done: number; total: number; error?: string }; downloadBytes: number };

export type VoiceView = {
  /** a coach message is being read out */
  speaking: boolean;
  /** the microphone: which button holds it, and what it is doing */
  mic: { owner: string; phase: 'starting' | 'listening' | 'hearing' | 'writing' } | null;
  /** how loud the owner is (0–1), for the button's ring */
  level: number;
  /** the browser's recogniser shows the words as they come */
  interim: string;
  /** what the server has installed and loaded */
  status: VoiceStatus | null;
};

let view: VoiceView = { speaking: false, mic: null, level: 0, interim: '', status: null };
const watchers = new Set<() => void>();
function update(patch: Partial<VoiceView>) {
  view = { ...view, ...patch };
  for (const w of watchers) w();
}
export function useVoice(): VoiceView {
  return useSyncExternalStore(
    (l) => {
      watchers.add(l);
      return () => watchers.delete(l);
    },
    () => view,
  );
}

const on = (key: string, fallback: boolean) => setting(getStore(), key, fallback);
const choice = (key: string, fallback: string) => setting(getStore(), key, fallback);
const noted = new Set<string>();
/** Say something once per page load (a fallback, a missing model). */
function noteOnce(key: string, level: 'info' | 'error', text: string) {
  if (noted.has(key)) return;
  noted.add(key);
  toast(level, text);
}

// ------------------------------------------------------------------ what the server has

export async function refreshVoiceStatus(): Promise<VoiceStatus | null> {
  try {
    const r = await fetch('/api/voice/status');
    if (!r.ok) return view.status;
    const status = (await r.json()) as VoiceStatus;
    update({ status });
    return status;
  } catch {
    return view.status;
  }
}

/** Download the models (Settings → Voice); the status shows how far it is. */
export async function installVoice() {
  try {
    const r = await fetch('/api/voice/install', { method: 'POST' });
    if (r.ok) update({ status: (await r.json()) as VoiceStatus });
  } catch {
    toast('error', 'Could not reach the server to start the download.');
  }
  const poll = setInterval(() => {
    void refreshVoiceStatus().then((s) => {
      if (!s?.install || s.install.error) clearInterval(poll);
      if (s?.install?.error) toast('error', `The download stopped: ${s.install.error}`);
      else if (s && !s.install && s.speak !== 'missing' && s.listen !== 'missing') toast('info', 'The voice is installed on this computer.');
    });
  }, 1000);
}

// ------------------------------------------------------------------ speaking

let queue: string[] = [];
let generation = 0;
let pumping = false;
let playing: HTMLAudioElement | null = null;
const made = new Map<string, Promise<Blob | null>>();

/** The natural voice's audio for one sentence (null: use the browser's voice instead). */
function natural(text: string, voice: string, speed: number): Promise<Blob | null> {
  const key = `${voice}|${speed}|${text}`;
  const hit = made.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const r = await fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice, speed }) });
      if (r.ok) return await r.blob();
      const why = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `the server answered ${r.status}`;
      if (r.status === 409) noteOnce('voice-missing', 'info', "The coach's natural voice is not installed yet (Settings → Voice → Download). The browser's voice speaks for now.");
      else noteOnce('voice-failed', 'error', `${why} The browser's voice speaks for now.`);
      return null;
    } catch {
      return null;
    }
  })();
  made.set(key, p);
  if (made.size > 40) made.delete(made.keys().next().value!);
  p.then((b) => b === null && made.delete(key));
  return p;
}

// the browser's voices: a male English one, the most natural first
const MALE_VOICES = [/Microsoft (Andrew|Brian|Guy|Christopher|Eric|Roger|Steffan|Davis|Tony).*Natural/i, /Microsoft (Ryan|Thomas|Liam|William).*Natural/i, /Google UK English Male/i, /\b(Daniel|Alex|Aaron|Arthur|Oliver|Fred|Rishi)\b/, /Microsoft (David|Mark|George|James|Richard)/i, /\bmale\b/i];
function browserVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  for (const re of MALE_VOICES) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices[0] ?? null;
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.getVoices(); // the list fills in on first ask

function sayInBrowser(text: string, speed: number, gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || gen !== generation) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = browserVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-US';
    u.rate = speed;
    u.pitch = 0.95;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

function play(blob: Blob, gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (gen !== generation) return resolve();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    playing = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      if (playing === audio) playing = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.onpause = done;
    audio.play().catch((e: Error) => {
      if (e.name === 'NotAllowedError') noteOnce('voice-autoplay', 'info', 'Click anywhere on the page once, and the coach can speak.');
      done();
    });
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  const gen = generation;
  update({ speaking: true });
  const where = choice('voice.speakWith', 'computer');
  const voice = choice('voice.voice', 'am_michael');
  const speed = setting(getStore(), 'voice.speed', 1);
  while (queue.length && gen === generation) {
    const sentence = queue.shift()!;
    const audio = where === 'computer' ? natural(sentence, voice, speed) : Promise.resolve(null);
    // the next sentence is made while this one plays
    if (where === 'computer' && queue[0]) void natural(queue[0], voice, speed);
    const blob = await audio;
    if (gen !== generation) break;
    if (blob) await play(blob, gen);
    else await sayInBrowser(sentence, speed, gen);
  }
  pumping = false;
  if (gen === generation) {
    update({ speaking: false });
    maybeListenAgain();
  } else if (queue.length) void pump();
}

function enqueue(text: string) {
  const pieces = speechChunks(text);
  if (!pieces.length) return;
  queue.push(...pieces);
  void pump();
}

/** Stop talking now: the sentence playing and everything queued. */
export function stopSpeaking() {
  generation++;
  queue = [];
  playing?.pause();
  playing = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (view.speaking) update({ speaking: false });
}

/** Read one message out, now (the speaker button on a message). */
export function speakMessage(m: CoachMessage) {
  stopSpeaking();
  enqueue(spokenMessage(m));
}

/** A sample of a voice, for choosing one by ear. */
export function hearVoice(voice: string) {
  stopSpeaking();
  const gen = generation;
  const speed = setting(getStore(), 'voice.speed', 1);
  void (async () => {
    const blob = choice('voice.speakWith', 'computer') === 'computer' ? await natural("Hello, I'm your coach. Before every move, take a moment to look for their threats first.", voice, speed) : null;
    if (gen !== generation) return;
    update({ speaking: true });
    if (blob) await play(blob, gen);
    else await sayInBrowser("Hello, I'm your coach. Before every move, take a moment to look for their threats first.", speed, gen);
    if (gen === generation) update({ speaking: false });
  })();
}

// ------------------------------------------------------------------ hands-free: listen again after the answer

let again: (() => void) | null = null;
let waitingForAnswer = false;
let answered = false;

function coachBusy() {
  const st = getStore().status?.state;
  return st === 'thinking' || st === 'starting' || st === 'retrying';
}

function maybeListenAgain() {
  if (!waitingForAnswer || !answered || view.speaking || view.mic || coachBusy() || !again) return;
  if (!on('voice.handsFree', false) || !on('voice.listen', false)) {
    waitingForAnswer = false;
    return;
  }
  waitingForAnswer = false;
  const go = again;
  setTimeout(() => {
    if (!view.mic && !view.speaking) go();
  }, 350);
}

onCoachMessage((m) => {
  if (m.from !== 'coach') return;
  answered = true;
  if (on('voice.speak', false)) enqueue(spokenMessage(m));
  else maybeListenAgain();
});
let wasSpeakOn: boolean | null = null;
subscribe(() => {
  // the coach finished its turn while nothing was being said
  maybeListenAgain();
  // voice switched off: stop at once
  const speak = on('voice.speak', false);
  if (wasSpeakOn && !speak) stopSpeaking();
  wasSpeakOn = speak;
});

/** The owner typed (or clicked) instead: stop talking, and no listening again by itself. */
export function ownerTyped() {
  stopSpeaking();
  waitingForAnswer = false;
}

// ------------------------------------------------------------------ listening

const WORKLET = `
class CcMic extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(2048); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('cc-mic', CcMic);
`;

type Take = { stop: (send: boolean) => void };
let take: Take | null = null;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
function browserRecogniser(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Open the microphone for one turn. `heard` gets the words (tidied), when there are any. The button
 * that asked is `owner`, so only it shows the microphone as open.
 */
export async function startListening(owner: string, heard: (text: string) => void) {
  if (take) return;
  stopSpeaking();
  const where = choice('voice.listenWith', 'computer');
  const status = where === 'computer' ? (view.status ?? (await refreshVoiceStatus())) : null;
  const useBrowser = where === 'browser' || status?.listen === 'missing';
  if (useBrowser && where === 'computer') {
    if (!browserRecogniser()) {
      toast('error', 'The speech recogniser is not installed yet: Settings → Voice → Download.');
      return;
    }
    noteOnce('listen-missing', 'info', "The recogniser is not installed on this computer yet (Settings → Voice → Download): the browser's is used for now, and Chrome sends your voice to Google for it.");
  }
  const said = (text: string) => {
    const t = tidyTranscript(text);
    if (!t) {
      toast('info', "I couldn't make out any words. Try again, a little closer to the microphone.");
      waitingForAnswer = false;
      return;
    }
    waitingForAnswer = on('voice.handsFree', false);
    answered = false;
    heard(t);
  };
  if (useBrowser) listenInBrowser(owner, said);
  else await record(owner, said);
}

/** Close the microphone: what was said so far is sent (or nothing, if nothing was said). */
export function stopListening(send = true) {
  take?.stop(send);
}

/** The listening again after an answer comes back to the button that last heard the owner. */
export function listenAgainWith(fn: () => void) {
  again = fn;
}
/** A button going away: it can no longer be the one that listens again. */
export function forgetListenAgain(fn: () => void) {
  if (again === fn) again = null;
}

function listenInBrowser(owner: string, said: (text: string) => void) {
  const R = browserRecogniser();
  if (!R) {
    toast('error', "This browser has no speech recogniser of its own: choose This computer under Settings → Voice.");
    return;
  }
  const rec = new R();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let final = '';
  let cancelled = false;
  update({ mic: { owner, phase: 'listening' }, interim: '', level: 0 });
  rec.onresult = (e) => {
    let interim = '';
    final = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) final += r[0]!.transcript;
      else interim += r[0]!.transcript;
    }
    update({ mic: { owner, phase: 'hearing' }, interim: (final + interim).trim() });
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('error', 'The microphone is blocked for this page: allow it in the address bar.');
    else if (e.error === 'network') toast('error', "The browser's recogniser needs the internet. Choose This computer under Settings → Voice to work offline.");
    else if (e.error === 'no-speech') toast('info', "I didn't hear anything.");
    cancelled = true;
  };
  rec.onend = () => {
    take = null;
    update({ mic: null, interim: '', level: 0 });
    if (!cancelled && final.trim()) said(final);
    else if (!cancelled) waitingForAnswer = false;
  };
  take = {
    stop: (send) => {
      cancelled = !send;
      if (send) rec.stop();
      else rec.abort();
    },
  };
  rec.start();
}

async function record(owner: string, said: (text: string) => void) {
  update({ mic: { owner, phase: 'starting' }, interim: '', level: 0 });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    update({ mic: null });
    waitingForAnswer = false;
    const name = (e as Error).name;
    toast('error', name === 'NotAllowedError' ? 'The microphone is blocked for this page: allow it in the address bar, then press the button again.' : name === 'NotFoundError' ? 'No microphone was found.' : `The microphone could not be opened: ${(e as Error).message}`);
    return;
  }
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  let node: AudioWorkletNode;
  try {
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'cc-mic');
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
    update({ mic: null });
    toast('error', `The microphone could not be read: ${(e as Error).message}`);
    return;
  } finally {
    URL.revokeObjectURL(url);
  }
  const source = ctx.createMediaStreamSource(stream);
  source.connect(node);
  node.connect(ctx.destination); // it writes nothing: silence, but the graph keeps it running
  const blocks: Float32Array[] = [];
  const ends = new Endpointer();
  let finished = false;
  update({ mic: { owner, phase: 'listening' } });

  const finish = async (send: boolean) => {
    if (finished) return;
    finished = true;
    take = null;
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    for (const t of stream.getTracks()) t.stop();
    const rate = ctx.sampleRate;
    void ctx.close();
    if (!send || !ends.speaking) {
      update({ mic: null, level: 0 });
      if (send) toast('info', "I didn't hear anything.");
      waitingForAnswer = false;
      return;
    }
    update({ mic: { owner, phase: 'writing' }, level: 0 });
    const all = new Float32Array(blocks.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of blocks) {
      all.set(b, at);
      at += b.length;
    }
    const pcm = toInt16(resample(all, rate, LISTEN_SAMPLE_RATE));
    try {
      const r = await fetch('/api/voice/listen', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm.buffer as ArrayBuffer });
      const body = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
      update({ mic: null });
      if (!r.ok) {
        toast('error', body.error ?? `The recogniser answered ${r.status}.`);
        waitingForAnswer = false;
        return;
      }
      said(body.text ?? '');
    } catch {
      update({ mic: null });
      toast('error', 'Could not reach the server to write down what you said.');
    }
  };

  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (finished) return;
    const block = e.data;
    blocks.push(block);
    const level = rms(block);
    const state = ends.push(level, (block.length / ctx.sampleRate) * 1000);
    const phase = state === 'speaking' ? 'hearing' : 'listening';
    if (view.mic?.phase !== phase || Math.abs(view.level - level) > 0.01) update({ mic: { owner, phase }, level: Math.min(1, level * 6) });
    if (state === 'done') void finish(true);
    else if (state === 'nothing') void finish(false).then(() => toast('info', "I didn't hear anything, so the microphone is closed."));
  };
  take = { stop: (send) => void finish(send) };
}
