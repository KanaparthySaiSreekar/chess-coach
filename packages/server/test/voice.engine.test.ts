// The real voice and recogniser (A20, A21; D108), from C:\Tools\Voice\models: a coach's message is
// said with every male voice offered, and the recogniser writes the moves back down. Skipped when the
// models are not installed (`npm run voice:install`).

import { describe, expect, it } from 'vitest';
import { LISTEN_RATE, VOICES, VoiceService } from '../src/voice.ts';
import { config } from '../src/config.ts';
import { resample, spokenMessage, type Segment } from '@chess-coach/core';

const voice = new VoiceService({ dir: config.voiceModels });
const ready = voice.installed('speak') && voice.installed('listen');

const samplesOf = (wav: Buffer) => {
  const out = new Float32Array((wav.length - 44) / 2);
  for (let i = 0; i < out.length; i++) out[i] = wav.readInt16LE(44 + i * 2) / 0x8000;
  return { samples: out, rate: wav.readUInt32LE(24) };
};

describe.skipIf(!ready)('the voice on this computer', () => {
  it('says a coach message with its moves in words, and the recogniser hears them back, in every voice offered', async () => {
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const segments: Segment[] = [
      { type: 'text', text: 'After ' },
      { type: 'token', token: { kind: 'move', raw: '{m:Nxe5+}', san: 'Nxe5+', baseFen: START, fenAfter: START, from: 'f3', to: 'e5' } },
      { type: 'text', text: ' your rook on ' },
      { type: 'token', token: { kind: 'square', raw: '{sq:h8}', square: 'h8' } },
      { type: 'text', text: ' is lost.' },
    ];
    const text = spokenMessage({ from: 'coach', segments, text: '' });
    expect(text).toBe('After knight takes e5, check your rook on h8 is lost.');
    for (const v of VOICES) {
      const t0 = Date.now();
      const { samples, rate } = samplesOf(await voice.speak(text, v, 1));
      const seconds = samples.length / rate;
      const heard = (await voice.listen(resample(samples, rate, LISTEN_RATE))).toLowerCase();
      console.log(`${v}: ${seconds.toFixed(1)} s of speech, ${Date.now() - t0} ms to say and hear: "${heard}"`);
      expect(seconds).toBeGreaterThan(1.5);
      for (const word of ['knight', 'takes', 'e5', 'check', 'rook', 'h8']) expect(heard).toContain(word);
    }
  });
});
