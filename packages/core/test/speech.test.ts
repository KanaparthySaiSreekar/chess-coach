import { describe, expect, it } from 'vitest';
import { Endpointer, fromInt16, resample, rms, speechChunks, spokenChip, spokenMessage, spokenMove, spokenProse, tidyTranscript, toInt16, type CoachMessage, type Segment } from '../src/index.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const move = (san: string, from: string, to: string): Segment => ({ type: 'token', token: { kind: 'move', raw: `{m:${san}}`, san, baseFen: START, fenAfter: START, from, to } });
const text = (t: string): Segment => ({ type: 'text', text: t });
const coach = (segments: Segment[], extra: Partial<CoachMessage> = {}): CoachMessage => ({ id: 1, at: '', seq: 1, from: 'coach', text: '', segments, ...extra });

describe('a move said aloud (A20)', () => {
  it('says pieces, captures, checks and mates the way a coach does', () => {
    expect(spokenMove('Nf3')).toBe('knight to f3');
    expect(spokenMove('Nxe5+')).toBe('knight takes e5, check');
    expect(spokenMove('Qxf7#')).toBe('queen takes f7, checkmate');
    expect(spokenMove('Rd8#')).toBe('rook to d8, checkmate');
    expect(spokenMove('Kh1')).toBe('king to h1');
    expect(spokenMove('Bb5!?')).toBe('bishop to b5');
  });

  it('says a pawn move by its square, a pawn capture as "pawn takes", and a promotion', () => {
    expect(spokenMove('e4')).toBe('e4');
    expect(spokenMove('exd5')).toBe('pawn takes d5');
    expect(spokenMove('e8=Q')).toBe('e8, promoting to a queen');
    expect(spokenMove('exd8=N+')).toBe('pawn takes d8, promoting to a knight, check');
  });

  it('says castling in words', () => {
    expect(spokenMove('O-O')).toBe('castles kingside');
    expect(spokenMove('O-O-O+')).toBe('castles queenside, check');
    expect(spokenMove('0-0')).toBe('castles kingside');
  });

  it('names the square a piece came from only when the SAN says which piece', () => {
    expect(spokenMove('Nbd7', 'b8')).toBe('knight from b8 to d7');
    expect(spokenMove('R1xe2', 'e1')).toBe('rook from e1 takes e2');
    expect(spokenMove('Nf3', 'g1')).toBe('knight to f3');
    // without the token's square, what the SAN says
    expect(spokenMove('Nbd7')).toBe('knight from b to d7');
  });

  it('leaves anything that is not a move alone', () => {
    expect(spokenMove('hello')).toBe('hello');
  });
});

describe("a coach message said aloud (A20)", () => {
  it('reads the bubble: text as written, move tokens in words, squares as written', () => {
    const m = coach([text('Play '), move('Nxe5+', 'f3', 'e5'), text(': it attacks the king and the rook on '), { type: 'token', token: { kind: 'square', raw: '{sq:h8}', square: 'h8' } }, text('.')]);
    expect(spokenMessage(m)).toBe('Play knight takes e5, check: it attacks the king and the rook on h8.');
  });

  it('says a piece token as the page shows it (its square)', () => {
    const m = coach([text('Your knight on '), { type: 'token', token: { kind: 'piece', raw: '{pc:Nf3}', square: 'f3', role: 'knight', color: 'white' } }, text(' is attacked twice.')]);
    expect(spokenMessage(m)).toBe('Your knight on f3 is attacked twice.');
  });

  it('speaks only the coach: the owner and the app are silent', () => {
    expect(spokenMessage({ from: 'owner', segments: [], text: 'Why?' })).toBe('');
    expect(spokenMessage({ from: 'system', segments: [], text: 'The coach stopped.' })).toBe('');
  });

  it('falls back to the text when there are no segments, tokens in words', () => {
    expect(spokenMessage({ from: 'coach', segments: [], text: 'After {m:Bxf7+} the king must move.' })).toBe('After bishop takes f7, check the king must move.');
  });

  it('tidies the spacing around punctuation', () => {
    const m = coach([text('Good. '), move('O-O', 'e1', 'g1'), text(' , and the king is safe .')]);
    expect(spokenMessage(m)).toBe('Good. castles kingside, and the king is safe.');
  });
});

describe('prose made ready for the voice', () => {
  it('drops markdown and move numbers, and says bare moves in words', () => {
    expect(spokenProse('**Careful**: after 11...Nxe7 you lose a pawn.')).toBe('Careful: after knight takes e7 you lose a pawn.');
    expect(spokenProse('The game went 1. e4 e5 2. Nf3.')).toBe('The game went e4 e5 knight to f3.');
    expect(spokenProse('Take with `exd5` first.')).toBe('Take with pawn takes d5 first.');
    expect(spokenProse('Check → mate.')).toBe('Check, then mate.');
  });

  it('leaves ordinary words that look a little like moves alone', () => {
    expect(spokenProse('Be careful, and keep an eye on b5.')).toBe('Be careful, and keep an eye on b5.');
  });
});

describe('cutting speech into sentences', () => {
  it('one sentence a piece, the first ready to speak on its own', () => {
    expect(speechChunks('Your knight is attacked twice and defended once, so it can be taken. What can you do about it? Find a safe square.')).toEqual([
      'Your knight is attacked twice and defended once, so it can be taken.',
      'What can you do about it? Find a safe square.',
    ]);
  });

  it('joins a very short sentence to the next, and does not split a decimal', () => {
    expect(speechChunks('Good. That keeps the pawn.')).toEqual(['Good. That keeps the pawn.']);
    expect(speechChunks('About 1.5 pawns. Fine.')).toEqual(['About 1.5 pawns. Fine.']);
  });

  it('cuts a long sentence at a comma, every piece within the limit', () => {
    const long = `${'The bishop on b5 pins the knight to the king, '.repeat(6)}and that is the point.`;
    const pieces = speechChunks(long, 120);
    expect(pieces.length).toBeGreaterThan(2);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(120);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' ').trim());
  });

  it('nothing to say, nothing to speak', () => {
    expect(speechChunks('   ')).toEqual([]);
  });
});

describe("the owner's words, tidied (A21)", () => {
  it('drops what is not speech', () => {
    expect(tidyTranscript(' [BLANK_AUDIO] ')).toBe('');
    expect(tidyTranscript('(coughs) Why is that bad?')).toBe('Why is that bad?');
    expect(tidyTranscript('...')).toBe('');
  });

  it('puts right chess words heard as everyday ones', () => {
    expect(tidyTranscript('Why did my night get taken?')).toBe('Why did my knight get taken?');
    expect(tidyTranscript('Night takes E5 check')).toBe('Knight takes e5 check');
    expect(tidyTranscript('Can my rock go to D8?')).toBe('Can my rook go to d8?');
    expect(tidyTranscript('is that check mate')).toBe('is that checkmate');
  });

  it('writes squares the chess way', () => {
    expect(tidyTranscript('What about E-5?')).toBe('What about e5?');
    expect(tidyTranscript('What about E five?')).toBe('What about e5?');
    expect(tidyTranscript('Bishop to C 4')).toBe('Bishop to c4');
    // an ordinary "a" stays a word
    expect(tidyTranscript('Is a four move combination there?')).toBe('Is a four move combination there?');
  });
});

describe('spoken quick replies (A21)', () => {
  it('the short phrases are the chips', () => {
    expect(spokenChip('Hint.')).toBe('hint');
    expect(spokenChip('Give me a hint')).toBe('hint');
    expect(spokenChip('Just tell me!')).toBe('tell_me');
    expect(spokenChip('Why?')).toBe('why');
    expect(spokenChip('Show me.')).toBe('show_me');
  });

  it('a question that only contains the words is a question', () => {
    expect(spokenChip('Why is my knight hanging?')).toBeNull();
    expect(spokenChip('Show me the threats on the board')).toBeNull();
  });
});

describe('microphone sums', () => {
  it('resamples 48 kHz to 16 kHz by averaging, and keeps a tone', () => {
    const tone = new Float32Array(48000).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
    const down = resample(tone, 48000, 16000);
    expect(down.length).toBe(16000);
    expect(rms(down)).toBeGreaterThan(0.65);
    expect(rms(down)).toBeLessThan(0.72);
    const flat = resample(new Float32Array(480).fill(0.5), 48000, 16000);
    expect([...flat].every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it('16-bit samples round-trip within one step', () => {
    const x = new Float32Array([-1, -0.5, 0, 0.25, 1, 1.5]);
    const back = fromInt16(toInt16(x));
    expect(back[0]).toBe(-1);
    expect(back[4]).toBe(1);
    expect(back[5]).toBe(1);
    expect(Math.abs(back[1]! + 0.5)).toBeLessThan(1 / 0x7fff);
  });
});

describe('when the owner has finished talking', () => {
  const run = (levels: number[], ms = 100) => {
    const e = new Endpointer();
    const states: string[] = [];
    for (const l of levels) states.push(e.push(l, ms));
    return states;
  };

  it('speech, then a long enough pause, ends the turn', () => {
    const states = run([...Array(5).fill(0.002), ...Array(10).fill(0.1), ...Array(15).fill(0.002)]);
    expect(states.slice(0, 5).every((s) => s === 'listening')).toBe(true);
    expect(states).toContain('speaking');
    expect(states.at(-1)).toBe('done');
    // a pause shorter than 1.4 s keeps listening
    expect(states.indexOf('done')).toBe(5 + 10 + 13);
  });

  it('a click is not speech, and silence stops listening after a while', () => {
    const states = run([0.002, 0.3, ...Array(90).fill(0.002)]);
    expect(states).not.toContain('speaking');
    expect(states.at(-1)).toBe('nothing');
  });

  it('a noisy room raises the bar, and speech still clears it', () => {
    const e = new Endpointer();
    for (let i = 0; i < 20; i++) e.push(0.015, 100);
    expect(e.threshold).toBeGreaterThan(0.04);
    expect(e.speaking).toBe(false);
    for (let i = 0; i < 3; i++) e.push(0.15, 100);
    expect(e.speaking).toBe(true);
  });

  it('talking from the moment the button is pressed still counts', () => {
    const states = run([...Array(20).fill(0.2), ...Array(15).fill(0.002)]);
    expect(states).toContain('speaking');
    expect(states.at(-1)).toBe('done');
  });

  it('the longest turn ends even while talking', () => {
    const states = run(Array(301).fill(0.2));
    expect(states.at(-1)).toBe('done');
  });
});
