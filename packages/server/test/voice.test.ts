// The voice service and its routes (A20, A21; D108) with stand-in engines: no model, no download.
// The real Kokoro and Whisper are tried by `npm run voice:install` and voice.engine.test.ts.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { voiceRoutes } from '../src/http.ts';
import { DEFAULT_VOICE, VOICE_MODELS, VoiceService, int16leToFloat, wavBytes, type ModelSpec, type VoiceEngines } from '../src/voice.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'cc-voice-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Stand-in engines that record what they were asked. */
function fakes(opts: { heard?: string; failLoad?: boolean; slowMs?: number } = {}) {
  const calls = { speak: [] as { text: string; voice: string; speed: number }[], listen: 0, loads: 0, running: 0, most: 0 };
  const engines: VoiceEngines = {
    loadSpeaker: async () => {
      calls.loads++;
      if (opts.failLoad) throw new Error('no such model');
      return {
        speak: async (text, voice, speed) => {
          calls.running++;
          calls.most = Math.max(calls.most, calls.running);
          await new Promise((r) => setTimeout(r, opts.slowMs ?? 1));
          calls.running--;
          calls.speak.push({ text, voice, speed });
          return { samples: new Float32Array(2400).fill(0.25), rate: 24000 };
        },
      };
    },
    loadListener: async () => ({
      listen: async () => {
        calls.listen++;
        return opts.heard ?? ' Why did my night get taken? ';
      },
    }),
  };
  return { engines, calls };
}

describe('the voice service', () => {
  it('says the models are missing until their files are on disk, and how big the download is', () => {
    const v = new VoiceService({ dir: tmp() });
    const s = v.status();
    expect(s.speak).toBe('missing');
    expect(s.listen).toBe('missing');
    const all = [...VOICE_MODELS.speak.files, ...VOICE_MODELS.listen.files].reduce((n, f) => n + f.bytes, 0);
    expect(s.downloadBytes).toBe(all);
    expect(all).toBeGreaterThan(550e6);
  });

  it('refuses to speak before the voice is installed', async () => {
    const v = new VoiceService({ dir: tmp() });
    await expect(v.speak('Hello.')).rejects.toMatchObject({ status: 409 });
  });

  it('options passed on as undefined keep their defaults (the way App passes them)', async () => {
    const v = new VoiceService({ dir: tmp(), engines: undefined, checkFiles: undefined, models: undefined });
    expect(v.status().speak).toBe('missing');
    await expect(v.speak('Hello.')).rejects.toMatchObject({ status: 409 });
  });

  it('speaks a WAV file, with the default voice for an unknown one and the pace kept in bounds', async () => {
    const { engines, calls } = fakes();
    const v = new VoiceService({ dir: tmp(), engines, checkFiles: false });
    const wav = await v.speak('  Knight takes e5,   check. ', 'not_a_voice', 3);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.length).toBe(44 + 2400 * 2);
    expect(calls.speak[0]).toEqual({ text: 'Knight takes e5, check.', voice: DEFAULT_VOICE, speed: 1.4 });
    expect(v.status().speak).toBe('ready');
  });

  it('the same words in the same voice come from memory', async () => {
    const { engines, calls } = fakes();
    const v = new VoiceService({ dir: tmp(), engines, checkFiles: false });
    const a = await v.speak('Good move.', 'am_fenrir', 1);
    const b = await v.speak('Good move.', 'am_fenrir', 1);
    await v.speak('Good move.', 'am_puck', 1);
    expect(b).toBe(a);
    expect(calls.speak.map((c) => c.voice)).toEqual(['am_fenrir', 'am_puck']);
    expect(calls.loads).toBe(1);
  });

  it('one sentence at a time, however many are asked for at once', async () => {
    const { engines, calls } = fakes({ slowMs: 15 });
    const v = new VoiceService({ dir: tmp(), engines, checkFiles: false });
    await Promise.all(['One.', 'Two.', 'Three.', 'Four.'].map((t) => v.speak(t)));
    expect(calls.most).toBe(1);
    expect(calls.speak.map((c) => c.text)).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
  });

  it('refuses nothing to say and too much at once', async () => {
    const v = new VoiceService({ dir: tmp(), ...fakes(), checkFiles: false });
    await expect(v.speak('   ')).rejects.toMatchObject({ status: 400 });
    await expect(v.speak('x'.repeat(601))).rejects.toMatchObject({ status: 400 });
  });

  it('a model that will not load is an error with the reason, and is tried again next time', async () => {
    const { engines, calls } = fakes({ failLoad: true });
    const v = new VoiceService({ dir: tmp(), engines, checkFiles: false });
    await expect(v.speak('Hello.')).rejects.toMatchObject({ status: 503 });
    expect(v.status().speak).toBe('error');
    expect(v.status().detail).toMatch(/could not be loaded: no such model/);
    await expect(v.speak('Hello.')).rejects.toMatchObject({ status: 503 });
    expect(calls.loads).toBe(2);
  });

  it("writes down what the owner said, tidied the chess way, and refuses a blip or a speech", async () => {
    const { engines, calls } = fakes();
    const v = new VoiceService({ dir: tmp(), engines, checkFiles: false });
    expect(await v.listen(new Float32Array(16000))).toBe('Why did my knight get taken?');
    await expect(v.listen(new Float32Array(1000))).rejects.toMatchObject({ status: 400 });
    await expect(v.listen(new Float32Array(16000 * 61))).rejects.toMatchObject({ status: 400 });
    expect(calls.listen).toBe(1);
  });

  it('warming loads the model once, before the first sentence', async () => {
    const { engines, calls } = fakes();
    const v = new VoiceService({ dir: tmp(), engines, checkFiles: false });
    v.warm('speak');
    v.warm('speak');
    await v.speak('Hello.');
    expect(calls.loads).toBe(1);
  });
});

describe('installing the models', () => {
  const content = { 'a.json': Buffer.from('{"ok":true}'), 'onnx/b.onnx': Buffer.alloc(70_000, 7) };
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const spec = (bad = false): Record<'speak' | 'listen', ModelSpec> => ({
    speak: { repo: 'test/speak', revision: 'abc123', licence: 'test', files: [{ path: 'a.json', bytes: content['a.json'].length, sha256: sha(content['a.json']) }] },
    listen: { repo: 'test/listen', revision: 'def456', licence: 'test', files: [{ path: 'onnx/b.onnx', bytes: content['onnx/b.onnx'].length, sha256: bad ? '0'.repeat(64) : sha(content['onnx/b.onnx']) }] },
  });
  const server = (asked: string[]) =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      asked.push(u);
      const file = u.split('/resolve/')[1]!.split('/').slice(1).join('/') as keyof typeof content;
      return new Response(content[file]);
    }) as typeof fetch;

  it('downloads each file from its pinned revision, keeps it when the checksum matches, and skips it next time', async () => {
    const dir = tmp();
    const asked: string[] = [];
    const v = new VoiceService({ dir, models: spec(), fetch: server(asked), host: 'https://models.test' });
    expect(v.status().speak).toBe('missing');
    await v.install();
    expect(asked).toEqual(['https://models.test/test/speak/resolve/abc123/a.json', 'https://models.test/test/listen/resolve/def456/onnx/b.onnx']);
    expect(readFileSync(path.join(dir, 'test/listen/onnx/b.onnx')).equals(content['onnx/b.onnx'])).toBe(true);
    expect(v.status()).toMatchObject({ speak: 'installed', listen: 'installed', downloadBytes: 0 });
    expect(v.status().install).toBeUndefined();
    await v.install();
    expect(asked.length).toBe(2);
  });

  it('a file that does not match its checksum is not kept, and the status says why', async () => {
    const dir = tmp();
    const v = new VoiceService({ dir, models: spec(true), fetch: server([]), host: 'https://models.test' });
    await expect(v.install()).rejects.toThrow(/did not match its checksum/);
    expect(existsSync(path.join(dir, 'test/listen/onnx/b.onnx'))).toBe(false);
    expect(readdirSync(path.join(dir, 'test/listen/onnx'))).toEqual([]);
    expect(v.status().listen).toBe('missing');
    expect(v.status().install?.error).toMatch(/checksum/);
  });
});

describe('the voice routes', () => {
  async function app(v: VoiceService) {
    const f = Fastify();
    voiceRoutes(f, v);
    await f.ready();
    return f;
  }

  it('speak answers with audio; a page from elsewhere is refused', async () => {
    const f = await app(new VoiceService({ dir: tmp(), ...fakes(), checkFiles: false }));
    const ok = await f.inject({ method: 'POST', url: '/api/voice/speak', payload: { text: 'Good move.', voice: 'am_michael', speed: 1 }, headers: { origin: 'http://127.0.0.1:5173' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('audio/wav');
    expect(ok.rawPayload.toString('ascii', 0, 4)).toBe('RIFF');
    const foreign = await f.inject({ method: 'POST', url: '/api/voice/speak', payload: { text: 'Good move.' }, headers: { origin: 'https://example.com' } });
    expect(foreign.statusCode).toBe(403);
    const empty = await f.inject({ method: 'POST', url: '/api/voice/speak', payload: { text: '' } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe('Nothing to say.');
  });

  it('listen takes 16-bit samples and answers with the words', async () => {
    const f = await app(new VoiceService({ dir: tmp(), ...fakes({ heard: 'Show me.' }), checkFiles: false }));
    const pcm = Buffer.alloc(16000 * 2);
    const r = await f.inject({ method: 'POST', url: '/api/voice/listen', payload: pcm, headers: { 'content-type': 'application/octet-stream' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ text: 'Show me.' });
    const json = await f.inject({ method: 'POST', url: '/api/voice/listen', payload: { samples: [] } });
    expect(json.statusCode).toBe(415);
  });

  it('status says what is installed, and a missing voice is a 409 with the reason', async () => {
    const f = await app(new VoiceService({ dir: tmp() }));
    expect((await f.inject({ url: '/api/voice/status' })).json()).toMatchObject({ speak: 'missing', listen: 'missing' });
    const r = await f.inject({ method: 'POST', url: '/api/voice/speak', payload: { text: 'Hello.' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/not installed/);
  });
});

describe('samples on the wire', () => {
  it('16-bit WAV out, 16-bit samples in', () => {
    const wav = wavBytes(new Float32Array([0, 1, -1, 0.5]), 24000);
    expect(wav.readInt16LE(44 + 2)).toBe(0x7fff);
    expect(wav.readInt16LE(44 + 4)).toBe(-0x8000);
    const back = int16leToFloat(wav.subarray(44));
    expect([...back].map((x) => Math.round(x * 100) / 100)).toEqual([0, 1, -1, 0.5]);
  });
});
