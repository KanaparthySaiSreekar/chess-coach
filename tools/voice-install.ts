// Installs the coach's voice and the speech recogniser (features A20, A21; TRACKER D108), then checks
// them end to end: the voice says a sentence and the recogniser writes it back down.
//
//   npm run voice:install            download what is missing (about 580 MB), check every file, try both
//   npm run voice:install -- --check  only check the files on disk and try both
//
// The files go to C:\Tools\Voice\models (VOICE_MODELS in .env to change it), each one checked against
// the revision and checksum pinned in packages/server/src/voice.ts. The page's Settings → Voice has a
// button that runs the same download.

import { config } from '../packages/server/src/config.ts';
import { DEFAULT_VOICE, LISTEN_RATE, VOICE_MODELS, VoiceService } from '../packages/server/src/voice.ts';
import { resample } from '../packages/core/src/index.ts';

const checkOnly = process.argv.includes('--check');
const voice = new VoiceService({ dir: config.voiceModels, log: (m) => console.log(`  ${m}`) });
const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`;

console.log(`voice models: ${config.voiceModels}`);
for (const part of ['speak', 'listen'] as const) {
  const spec = VOICE_MODELS[part];
  console.log(`  ${part === 'speak' ? 'the voice     ' : 'the recogniser'} ${spec.repo}@${spec.revision.slice(0, 10)} (${spec.licence}): ${voice.installed(part) ? 'on disk' : 'missing'}`);
}

if (!checkOnly) {
  const t0 = Date.now();
  const tick = setInterval(() => {
    const s = voice.status().install;
    if (s) process.stdout.write(`\r  checking and downloading: ${mb(s.done)} of ${mb(s.total)}   `);
  }, 500);
  try {
    await voice.install();
  } catch (e) {
    clearInterval(tick);
    console.error(`\n  failed: ${(e as Error).message}`);
    process.exit(1);
  }
  clearInterval(tick);
  console.log(`\r  every file checked against its pinned checksum, in ${((Date.now() - t0) / 1000).toFixed(0)} s          `);
}

if (!voice.installed('speak') || !voice.installed('listen')) {
  console.error('  not installed: run `npm run voice:install`');
  process.exit(1);
}

// end to end: say a sentence with the default voice, write it back down
const sentence = 'Your knight on f3 is attacked twice, but only defended once.';
let t = Date.now();
const wav = await voice.speak(sentence, DEFAULT_VOICE, 1);
const rate = wav.readUInt32LE(24);
const samples = new Float32Array((wav.length - 44) / 2);
for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(44 + i * 2) / 0x8000;
console.log(`  said "${sentence}" (${(samples.length / rate).toFixed(1)} s of speech) in ${Date.now() - t} ms, the model loaded first`);
t = Date.now();
const heard = await voice.listen(resample(samples, rate, LISTEN_RATE));
console.log(`  heard back "${heard}" in ${Date.now() - t} ms, the model loaded first`);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
const missed = words(sentence).filter((w) => !words(heard).includes(w));
if (missed.length) {
  console.error(`  the recogniser missed: ${missed.join(', ')}`);
  process.exit(1);
}
console.log('  ok: the voice and the recogniser work on this computer');
