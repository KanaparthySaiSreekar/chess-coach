// The coach's voice and the owner's (features A20, A21; TRACKER D108; ARCHITECTURE §20).
//
// Kokoro-82M speaks the coach's words and Whisper small.en writes down what the owner says. Both run
// on this computer through ONNX Runtime (kokoro-js and transformers.js), from model files pinned here
// by revision and checksum and kept in C:\Tools\Voice\models (`npm run voice:install`, or the button
// on the page). Nothing is loaded until the owner switches a voice setting on, and at run time the
// models are read from disk only: nothing the coach says or the owner says leaves the machine.
//
// The engines can be swapped for stand-ins (the page tests); everything else here is the same code.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LISTEN_SAMPLE_RATE, tidyTranscript } from '@chess-coach/core';

export type ModelFile = { path: string; bytes: number; sha256: string };
export type ModelSpec = { repo: string; revision: string; licence: string; files: ModelFile[] };
export type VoicePart = 'speak' | 'listen';

/** The model files, pinned (checked against Hugging Face's own record of each file, 2026-11-25). */
export const VOICE_MODELS: Record<VoicePart, ModelSpec> = {
  speak: {
    repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
    licence: 'Apache-2.0',
    files: [
      { path: 'config.json', bytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
      { path: 'tokenizer.json', bytes: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
      { path: 'tokenizer_config.json', bytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
      { path: 'onnx/model.onnx', bytes: 325532232, sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb' },
    ],
  },
  listen: {
    repo: 'onnx-community/whisper-small.en',
    revision: '482fb8ba081b6e906f92efe103622316b2a0cc69',
    licence: 'MIT (OpenAI Whisper)',
    files: [
      { path: 'config.json', bytes: 2203, sha256: '8825c4174cb86f94d9fa67614942f8aa17bfbbdf2fae5426d4adfd0bc5893c43' },
      { path: 'generation_config.json', bytes: 1956, sha256: '5490747ca976d6b3765280a0697d66489020c2afa6e754244d9cd093e1639331' },
      { path: 'preprocessor_config.json', bytes: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
      { path: 'tokenizer.json', bytes: 2405679, sha256: '5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0' },
      { path: 'tokenizer_config.json', bytes: 282662, sha256: '93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c' },
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 92326170, sha256: 'dae677b93ca77f911d858238e277026fa8f95a94cb899ea443ec78ee62726edf' },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 156750076, sha256: '29132c41903c252d0f2b9e59ee1e7d75f7d0b64d37f3e36d1ecc4a1a1af62953' },
    ],
  },
};

/** Kokoro's male voices offered to the owner (the voice files ship inside kokoro-js). Michael is the default. */
export const VOICES = ['am_michael', 'am_fenrir', 'am_puck', 'bm_george', 'bm_fable'] as const;
export const DEFAULT_VOICE = 'am_michael';

/** Something that speaks: text in, mono samples out. */
export type Speaker = { speak(text: string, voice: string, speed: number): Promise<{ samples: Float32Array; rate: number }> };
/** Something that listens: 16 kHz mono samples in, the words out. */
export type Listener = { listen(samples16k: Float32Array): Promise<string> };
export type VoiceEngines = { loadSpeaker(dir: string): Promise<Speaker>; loadListener(dir: string): Promise<Listener> };

export type PartState = 'missing' | 'installed' | 'loading' | 'ready' | 'error';
export type VoiceStatus = {
  speak: PartState;
  listen: PartState;
  /** what went wrong, in plain words */
  detail?: string;
  /** a download under way: bytes done of all */
  install?: { done: number; total: number; error?: string };
  /** how big the download is, for the page's button */
  downloadBytes: number;
};

/** A request the voice cannot serve, with the HTTP status that says why. */
export class VoiceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const MAX_SPEAK_CHARS = 600;
export const LISTEN_RATE = LISTEN_SAMPLE_RATE;
export const MAX_LISTEN_SECONDS = 60;

/** Mono samples as a 16-bit WAV file. */
export function wavBytes(samples: Float32Array, rate: number): Buffer {
  const data = samples.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    b.writeInt16LE(v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), 44 + i * 2);
  }
  return b;
}

/** 16-bit little-endian samples (what the page sends) as floats. */
export function int16leToFloat(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2);
    out[i] = v / (v < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

// the real engines: loaded on first use, offline (local files only)
async function offline(dir: string) {
  const { env } = await import('@huggingface/transformers');
  env.localModelPath = dir;
  env.cacheDir = dir;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
}

export const ONNX_ENGINES: VoiceEngines = {
  async loadSpeaker(dir) {
    await offline(dir);
    const { KokoroTTS } = await import('kokoro-js');
    // fp32 on the processor: about five times faster than real time here; the quantised model was slower, and DirectML refuses this model
    const tts = await KokoroTTS.from_pretrained(VOICE_MODELS.speak.repo, { dtype: 'fp32', device: 'cpu' });
    return {
      async speak(text, voice, speed) {
        const audio = await tts.generate(text, { voice: voice as (typeof VOICES)[number], speed });
        return { samples: audio.audio, rate: audio.sampling_rate };
      },
    };
  },
  async loadListener(dir) {
    await offline(dir);
    const { pipeline: makePipeline } = await import('@huggingface/transformers');
    const asr = await makePipeline('automatic-speech-recognition', VOICE_MODELS.listen.repo, { dtype: 'q8', device: 'cpu' });
    return {
      async listen(samples) {
        const long = samples.length > 30 * LISTEN_RATE;
        const out = await asr(samples, long ? { chunk_length_s: 30, stride_length_s: 5 } : {});
        const one = Array.isArray(out) ? out[0] : out;
        return (one as { text?: string } | undefined)?.text ?? '';
      },
    };
  },
};

export type VoiceOptions = {
  /** where the model files live (C:\Tools\Voice\models) */
  dir: string;
  /** tests: stand-in engines */
  engines?: VoiceEngines;
  /** tests: the stand-in engines need no files on disk */
  checkFiles?: boolean;
  /** tests: other files to install (the pinned ones by default) */
  models?: Record<VoicePart, ModelSpec>;
  /** the download: the base of the model host, and the fetch to use */
  host?: string;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
};

export class VoiceService {
  private readonly o: Required<Pick<VoiceOptions, 'dir' | 'engines' | 'checkFiles' | 'host' | 'models'>> & VoiceOptions;
  private speaker: Promise<Speaker> | null = null;
  private listener: Promise<Listener> | null = null;
  private state: Record<VoicePart, 'idle' | 'loading' | 'ready' | 'error'> = { speak: 'idle', listen: 'idle' };
  private errors: Partial<Record<VoicePart, string>> = {};
  private speakChain: Promise<unknown> = Promise.resolve();
  private listenChain: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, Buffer>();
  private installing: { done: number; total: number; error?: string } | null = null;
  private installRun: Promise<void> | null = null;
  private log: (msg: string) => void;

  constructor(opts: VoiceOptions) {
    // an option passed as undefined (App passes its own options on) still gets its default
    this.o = { ...opts, engines: opts.engines ?? ONNX_ENGINES, checkFiles: opts.checkFiles ?? true, host: opts.host ?? 'https://huggingface.co', models: opts.models ?? VOICE_MODELS };
    this.log = opts.log ?? (() => {});
  }

  /** Every file of a part on disk at its pinned size (the checksums are checked when the files are installed). */
  installed(part: VoicePart): boolean {
    if (!this.o.checkFiles) return true;
    const spec = this.o.models[part];
    return spec.files.every((f) => {
      const file = path.join(this.o.dir, spec.repo, f.path);
      return existsSync(file) && statSync(file).size === f.bytes;
    });
  }

  private partState(part: VoicePart): PartState {
    const s = this.state[part];
    if (s === 'ready' || s === 'loading' || s === 'error') return s;
    return this.installed(part) ? 'installed' : 'missing';
  }

  status(): VoiceStatus {
    const detail = this.errors.speak ?? this.errors.listen;
    const missing = (['speak', 'listen'] as const).filter((p) => !this.installed(p));
    const downloadBytes = missing.flatMap((p) => this.o.models[p].files).reduce((n, f) => n + f.bytes, 0);
    return { speak: this.partState('speak'), listen: this.partState('listen'), ...(detail ? { detail } : {}), ...(this.installing ? { install: { ...this.installing } } : {}), downloadBytes };
  }

  private load(part: 'speak'): Promise<Speaker>;
  private load(part: 'listen'): Promise<Listener>;
  private load(part: VoicePart): Promise<Speaker | Listener> {
    const held = part === 'speak' ? this.speaker : this.listener;
    if (held) return held;
    if (!this.installed(part)) throw new VoiceError(409, part === 'speak' ? "The coach's voice is not installed on this computer yet." : 'The speech recogniser is not installed on this computer yet.');
    this.state[part] = 'loading';
    delete this.errors[part];
    const started = Date.now();
    const p = (part === 'speak' ? this.o.engines.loadSpeaker(this.o.dir) : this.o.engines.loadListener(this.o.dir)).then(
      (engine) => {
        this.state[part] = 'ready';
        this.log(`voice: ${part === 'speak' ? 'Kokoro' : 'Whisper'} loaded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        return engine;
      },
      (e: Error) => {
        this.state[part] = 'error';
        this.errors[part] = `${part === 'speak' ? "The coach's voice" : 'The speech recogniser'} could not be loaded: ${e.message}`;
        this.log(`voice: ${this.errors[part]}`);
        if (part === 'speak') this.speaker = null;
        else this.listener = null;
        throw new VoiceError(503, this.errors[part]!);
      },
    );
    if (part === 'speak') this.speaker = p as Promise<Speaker>;
    else this.listener = p as Promise<Listener>;
    return p;
  }

  /** Load a part in the background (the owner switched it on), so the first sentence is not slow. */
  warm(part: VoicePart) {
    if (!this.installed(part)) return;
    try {
      void (part === 'speak' ? this.load('speak') : this.load('listen')).catch(() => {});
    } catch {
      /* not installed: the page says so */
    }
  }

  /** The coach's words as a WAV file. The same words in the same voice come from memory the second time. */
  async speak(text: string, voice: string = DEFAULT_VOICE, speed = 1): Promise<Buffer> {
    const words = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!words) throw new VoiceError(400, 'Nothing to say.');
    if (words.length > MAX_SPEAK_CHARS) throw new VoiceError(400, `At most ${MAX_SPEAK_CHARS} characters at a time.`);
    const who = (VOICES as readonly string[]).includes(voice) ? voice : DEFAULT_VOICE;
    const pace = Number.isFinite(speed) ? Math.min(1.4, Math.max(0.7, speed)) : 1;
    const key = `${who}|${pace}|${words}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const engine = await this.load('speak');
    // one sentence at a time: the processor is shared with the engine
    const run = this.speakChain.then(async () => {
      const { samples, rate } = await engine.speak(words, who, pace);
      return wavBytes(samples, rate);
    });
    this.speakChain = run.catch(() => {});
    const wav = await run;
    this.cache.set(key, wav);
    while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    return wav;
  }

  /** What the owner said (16 kHz mono samples), tidied the chess way. */
  async listen(samples: Float32Array): Promise<string> {
    if (samples.length < LISTEN_RATE * 0.3) throw new VoiceError(400, 'Too short to be speech.');
    if (samples.length > LISTEN_RATE * MAX_LISTEN_SECONDS) throw new VoiceError(400, `At most ${MAX_LISTEN_SECONDS} seconds at a time.`);
    const engine = await this.load('listen');
    const run = this.listenChain.then(() => engine.listen(samples));
    this.listenChain = run.catch(() => {});
    return tidyTranscript(await run);
  }

  /**
   * Download the model files that are missing, each checked against its pinned size and checksum
   * before it is kept. Files already there are checked too; a wrong one is downloaded again.
   * One download at a time; `status().install` shows how far it is.
   */
  install(): Promise<void> {
    if (this.installRun) return this.installRun;
    const files = (['speak', 'listen'] as const).flatMap((part) => this.o.models[part].files.map((f) => ({ ...f, spec: this.o.models[part] })));
    this.installing = { done: 0, total: files.reduce((n, f) => n + f.bytes, 0) };
    const run = async () => {
      for (const f of files) {
        const dest = path.join(this.o.dir, f.spec.repo, f.path);
        if (existsSync(dest) && statSync(dest).size === f.bytes && (await sha256File(dest)) === f.sha256) {
          this.installing!.done += f.bytes;
          continue;
        }
        mkdirSync(path.dirname(dest), { recursive: true });
        const url = `${this.o.host}/${f.spec.repo}/resolve/${f.spec.revision}/${f.path}`;
        const res = await (this.o.fetch ?? fetch)(url);
        if (!res.ok || !res.body) throw new Error(`${f.spec.repo}/${f.path}: the download answered ${res.status}`);
        const part = `${dest}.part`;
        const hash = createHash('sha256');
        let bytes = 0;
        const counted = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
        counted.on('data', (chunk: Buffer) => {
          hash.update(chunk);
          bytes += chunk.length;
          this.installing!.done += chunk.length;
        });
        try {
          await pipeline(counted, createWriteStream(part));
        } catch (e) {
          rmSync(part, { force: true });
          throw e;
        }
        const sha = hash.digest('hex');
        if (bytes !== f.bytes || sha !== f.sha256) {
          rmSync(part, { force: true });
          throw new Error(`${f.spec.repo}/${f.path} did not match its checksum (${bytes} bytes, sha256 ${sha.slice(0, 12)}…): nothing was kept`);
        }
        renameSync(part, dest);
        this.log(`voice: ${f.spec.repo}/${f.path} downloaded and checked`);
      }
    };
    this.installRun = run().then(
      () => {
        this.installing = null;
        this.installRun = null;
        delete this.errors.speak;
        delete this.errors.listen;
      },
      (e: Error) => {
        this.installing = { ...this.installing!, error: e.message };
        this.installRun = null;
        this.log(`voice: install failed: ${e.message}`);
        throw e;
      },
    );
    return this.installRun;
  }
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}
