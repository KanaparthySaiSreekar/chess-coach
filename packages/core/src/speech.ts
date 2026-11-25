// The coach's voice and the owner's (features A20, A21; TRACKER D108). Pure code, shared by the page
// and the server: what the coach's message sounds like said aloud (moves in words, as a coach says
// them), how it is cut into sentences so the first one starts quickly, what a transcript of the
// owner's voice is tidied into, which spoken words are a quick-reply chip, and the small audio sums
// the microphone needs (resampling, 16-bit samples, when the owner has stopped talking).
//
// Nothing here decides chess: a move is said exactly as the message shows it (its SAN and, when the
// SAN needs it to say which piece, the square the token says it came from).

import type { Chip, CoachMessage } from './protocol.ts';
import { plainText, type ResolvedToken } from './validator.ts';

const ROLE_WORD: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };

const SAN_RE = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?([QRBN]))?$/;

/**
 * One move in SAN as a coach says it aloud: "knight takes e5, check", "castles kingside", "e4",
 * "pawn takes d5, promoting to a queen". `from` is where the piece stood; it is said only when the SAN
 * itself names it (Nbd7: "knight from b8 to d7"). Anything that is not SAN comes back as it was.
 */
export function spokenMove(san: string, from?: string): string {
  const bare = san.trim().replace(/[!?]+$/, '');
  const mate = bare.endsWith('#');
  const check = !mate && bare.endsWith('+');
  const body = bare.replace(/[+#]+$/, '');
  const tail = mate ? ', checkmate' : check ? ', check' : '';
  if (/^[O0]-[O0]-[O0]$/.test(body)) return `castles queenside${tail}`;
  if (/^[O0]-[O0]$/.test(body)) return `castles kingside${tail}`;
  const m = SAN_RE.exec(body);
  if (!m) return bare;
  const [, piece, disFile, disRank, capture, to, promo] = m;
  let words: string;
  if (piece) {
    const which = disFile || disRank ? ` from ${from && /^[a-h][1-8]$/.test(from) ? from : `${disFile ?? ''}${disRank ?? ''}`}` : '';
    words = `${ROLE_WORD[piece]}${which} ${capture ? 'takes' : 'to'} ${to}`;
  } else {
    words = capture ? `pawn takes ${to}` : to!;
  }
  if (promo) words += `, promoting to a ${ROLE_WORD[promo]}`;
  return words + tail;
}

/** A token as the page shows it, said aloud: a move in words, a square (or a piece's square) as written. */
export function spokenToken(t: ResolvedToken): string {
  return t.kind === 'move' ? spokenMove(t.san, t.from) : t.square;
}

// a move written in plain prose (a move the owner asked about that cannot be played is left as text by the validator)
const PROSE_MOVE = /(^|[\s(“"'])(?:\d+\.(?:\.\.)?\s*)?((?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8]=?[QRBN]|[O0]-[O0](?:-[O0])?)[+#]?)(?=$|[\s.,;:!?)”"'])/g;

/** Plain prose made ready for the voice: moves in words, no markdown, no move numbers. */
export function spokenProse(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|`([^`]+)`/g, (_m, a, b, c, d) => a ?? b ?? c ?? d ?? '')
    .replace(/(^|\n)\s*(?:[-•]|#+)\s+/g, '$1')
    .replace(PROSE_MOVE, (_m, lead: string, san: string) => `${lead}${spokenMove(san)}`)
    .replace(/(^|\s)\d+\.(?:\.\.)?\s*(?=[a-h][1-8]\b)/g, '$1')
    .replace(/\s*(?:→|->)\s*/g, ', then ')
    .replace(/\s&\s/g, ' and ');
}

/**
 * A coach message as the words to speak: what its bubble says, with moves and squares in words, and
 * none of the notes or buttons around it. The owner's own lines and the app's are not spoken (empty).
 */
export function spokenMessage(m: Pick<CoachMessage, 'from' | 'segments' | 'text'>): string {
  if (m.from !== 'coach') return '';
  const raw = m.segments?.length ? m.segments.map((s) => (s.type === 'text' ? spokenProse(s.text) : spokenToken(s.token))).join('') : spokenProse(plainText(m.text));
  return raw.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/**
 * Cut words to speak into pieces the voice can start on quickly: one sentence each, a very short one
 * joined to the next, a long one cut at a comma or a semicolon. Each piece is at most `max` characters
 * unless a single word is longer.
 */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…]["')\]”]?)\s+/)
    .filter(Boolean);
  const pieces: string[] = [];
  for (const s of sentences) {
    let rest = s;
    while (rest.length > max) {
      const window = rest.slice(0, max);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '));
      const at = cut > max / 3 ? cut + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : max;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const out: string[] = [];
  for (const p of pieces) {
    const last = out.at(-1);
    if (last !== undefined && last.length < 40 && last.length + 1 + p.length <= max) out[out.length - 1] = `${last} ${p}`;
    else out.push(p);
  }
  return out;
}

const NUMBER_WORD: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8' };

/**
 * What the owner said, tidied for the chat box: sounds the recogniser writes down ("[BLANK_AUDIO]",
 * "(coughs)") dropped, chess words it hears as everyday ones put right ("night" → "knight", "rock" →
 * "rook"), and squares written the chess way ("E5", "E-5", "E five" → "e5"). Empty when nothing was said.
 */
export function tidyTranscript(text: string): string {
  let t = text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b([Nn])ight(s?)\b/g, (_m, n: string, s: string) => `${n === 'N' ? 'K' : 'k'}night${s}`);
  t = t.replace(/\b([Rr])ock(s?)\b/g, (_m, r: string, s: string) => `${r}ook${s}`);
  t = t.replace(/\b([Cc])heck mate\b/g, '$1heckmate');
  t = t.replace(/\b([A-H])[- ]?(one|two|three|four|five|six|seven|eight)\b/gi, (m, f: string, n: string) => (f === f.toUpperCase() ? `${f.toLowerCase()}${NUMBER_WORD[n.toLowerCase()]}` : m));
  t = t.replace(/\b([A-H])[- ]?([1-8])\b/g, (_m, f: string, r: string) => `${f.toLowerCase()}${r}`);
  t = t.replace(/\b([a-h])-([1-8])\b/g, '$1$2');
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}

const CHIP_WORDS: [Chip, string[]][] = [
  ['hint', ['hint', 'a hint', 'hint please', 'give me a hint', 'can i have a hint', 'can i get a hint', 'another hint']],
  ['tell_me', ['just tell me', 'tell me', 'just tell me the answer', 'tell me the answer', 'what is the answer', "what's the answer"]],
  ['why', ['why', 'why is that', 'but why']],
  ['show_me', ['show me', 'show me on the board', 'show me the line']],
];

/** Is what the owner said one of the quick replies (Hint, Just tell me, Why?, Show me)? Only the short phrases themselves count. */
export function spokenChip(text: string): Chip | null {
  const said = text
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [chip, words] of CHIP_WORDS) if (words.includes(said)) return chip;
  return null;
}

// ---------------------------------------------------------------- audio sums for the microphone

/** What the recogniser listens at: the page sends 16-bit mono samples at this rate. */
export const LISTEN_SAMPLE_RATE = 16000;

/** Resample mono audio (`from` Hz → `to` Hz). Going down, each output sample is the average of the input it covers, so nothing folds back. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples.slice();
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    if (ratio > 1) {
      const a = Math.floor(i * ratio);
      const b = Math.min(samples.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = a; j < b; j++) sum += samples[j]!;
      out[i] = sum / (b - a);
    } else {
      const p = i * ratio;
      const j = Math.floor(p);
      const next = samples[Math.min(j + 1, samples.length - 1)]!;
      out[i] = samples[j]! + (next - samples[j]!) * (p - j);
    }
  }
  return out;
}

/** Float samples (-1…1) as 16-bit integers, and back: half the bytes on the way to the server. */
export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

export function fromInt16(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! / (samples[i]! < 0 ? 0x8000 : 0x7fff);
  return out;
}

/** The loudness of a block of samples (root mean square). */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.sqrt(sum / samples.length);
}

export type EndpointerOptions = {
  /** silence after speech that ends the turn */
  silenceMs: number;
  /** nothing said for this long: stop listening */
  noSpeechMs: number;
  /** the longest turn */
  maxMs: number;
  /** speech shorter than this is a click or a breath, not a word */
  minSpeechMs: number;
  /** the quietest level that counts as speech, whatever the room's noise */
  minLevel: number;
  /** the first moments after the button is pressed only measure the room's noise */
  calibrateMs: number;
  /** the loudest a room's noise is taken to be: someone who starts talking at once is not mistaken for the room */
  maxFloor: number;
};

export const ENDPOINTER_DEFAULTS: EndpointerOptions = { silenceMs: 1400, noSpeechMs: 8000, maxMs: 30_000, minSpeechMs: 250, minLevel: 0.012, calibrateMs: 300, maxFloor: 0.02 };

/**
 * When has the owner finished talking? Fed the loudness of each block of the microphone, it answers
 * `listening` (nothing said yet), `speaking`, `done` (they spoke, then paused long enough, or the turn
 * is at its longest) or `nothing` (no speech in time). The room's own noise is measured in the first
 * moments, and learnt again whenever nobody speaks; speech must be well above it.
 */
export class Endpointer {
  private readonly o: EndpointerOptions;
  private elapsed = 0;
  private heard = 0;
  private silence = 0;
  private floor = 0;
  private floorMs = 0;
  speaking = false;

  constructor(options: Partial<EndpointerOptions> = {}) {
    this.o = { ...ENDPOINTER_DEFAULTS, ...options };
  }

  /** The level speech must pass now. */
  get threshold(): number {
    return Math.max(this.o.minLevel, Math.min(this.floor, this.o.maxFloor) * 3);
  }

  push(level: number, ms: number): 'listening' | 'speaking' | 'done' | 'nothing' {
    this.elapsed += ms;
    if (this.floorMs < this.o.calibrateMs) {
      // the room's noise: the quietest of the first blocks (a click or a breath there does not raise it)
      this.floor = this.floorMs === 0 ? level : Math.min(this.floor, level);
      this.floorMs += ms;
      return 'listening';
    }
    const loud = level > this.threshold;
    if (!loud && !this.speaking) this.floor = this.floor * 0.95 + level * 0.05;
    if (!this.speaking) {
      this.heard = loud ? this.heard + ms : Math.max(0, this.heard - ms / 2);
      if (this.heard >= this.o.minSpeechMs) this.speaking = true;
    } else {
      this.silence = loud ? 0 : this.silence + ms;
    }
    if (this.speaking && (this.silence >= this.o.silenceMs || this.elapsed >= this.o.maxMs)) return 'done';
    if (!this.speaking && this.elapsed >= Math.min(this.o.noSpeechMs, this.o.maxMs)) return 'nothing';
    return this.speaking ? 'speaking' : 'listening';
  }
}
