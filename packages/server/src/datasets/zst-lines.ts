// Reads a Lichess database file (`*.csv.zst`) line by line without unpacking it to disk.
//
// Those files are written by a parallel compressor: many zstd frames one after another, each
// preceded by a small "skippable" frame that holds the size of the frame that follows. Node's
// streaming decompressor stops at the first skippable frame ("Unknown frame descriptor"), so the
// frames are read one at a time here. Each unpacks to about 32 MB.

import { closeSync, openSync, readSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 0xfd2fb528;
const isSkippable = (magic: number) => magic >>> 4 === 0x184d2a5;

/** The unpacked frames of the file, in order. */
export function* zstFrames(file: string): Generator<Buffer> {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(12);
    let at = 0;
    for (;;) {
      const got = readSync(fd, head, 0, 12, at);
      if (got < 4) return;
      const magic = head.readUInt32LE(0);
      if (isSkippable(magic) && got >= 12 && head.readUInt32LE(4) === 4) {
        // the parallel format: the skippable frame's four bytes are the size of the next frame
        const size = head.readUInt32LE(8);
        const frame = Buffer.alloc(size);
        if (readSync(fd, frame, 0, size, at + 12) < size) throw new Error('the file ends in the middle of a frame');
        yield zstdDecompressSync(frame);
        at += 12 + size;
      } else if (isSkippable(magic)) {
        at += 8 + head.readUInt32LE(4); // some other skippable frame: nothing to unpack
      } else if (magic === ZSTD_MAGIC) {
        throw new Error('this file is one plain zstd stream, not the framed format the Lichess database uses');
      } else {
        throw new Error('not a zstd file');
      }
    }
  } finally {
    closeSync(fd);
  }
}

/** The lines of the file, in order. A line cut in two by a frame boundary is put back together. */
export function* zstLines(file: string): Generator<string> {
  let rest = '';
  for (const frame of zstFrames(file)) {
    const text = rest + frame.toString('utf8');
    const lines = text.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) yield line.endsWith('\r') ? line.slice(0, -1) : line;
  }
  if (rest) yield rest;
}
