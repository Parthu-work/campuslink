/**
 * Minimal ISO-BMFF (MP4 / QuickTime) reader: duration and display size from the header, and
 * in-place metadata removal. Metadata boxes (udta, meta, XMP uuid) are renamed to `free` and their
 * payload zeroed, so every byte offset (stco/co64) stays valid without rewriting the file.
 */
interface Box {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

function* boxes(buf: Buffer, from: number, to: number): Generator<Box> {
  let off = from;
  while (off + 8 <= to) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let headerSize = 8;
    if (size === 1) {
      if (off + 16 > to) return;
      const big = buf.readBigUInt64BE(off + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return;
      size = Number(big);
      headerSize = 16;
    } else if (size === 0) {
      size = to - off;
    }
    if (size < headerSize || off + size > to) return;
    yield { type, start: off, headerSize, size };
    off += size;
  }
}

const child = (buf: Buffer, parent: Box, type: string) =>
  [...boxes(buf, parent.start + parent.headerSize, parent.start + parent.size)].find((b) => b.type === type);

export interface Mp4Info {
  brand: string;
  durationSec: number;
  width: number | null;
  height: number | null;
}

const BRANDS = /^(isom|iso[2-9]|mp41|mp42|avc1|qt {2}|M4V |mmp4|dash|f4v )$/;

export function readMp4(buf: Buffer): Mp4Info | null {
  const top = [...boxes(buf, 0, buf.length)];
  const ftyp = top[0]?.type === 'ftyp' ? top[0] : undefined;
  const moov = top.find((b) => b.type === 'moov');
  if (!ftyp || !moov || !top.some((b) => b.type === 'mdat')) return null;
  const brand = buf.toString('latin1', ftyp.start + 8, ftyp.start + 12);
  if (!BRANDS.test(brand)) return null;
  const mvhd = child(buf, moov, 'mvhd');
  if (!mvhd) return null;
  const p = mvhd.start + mvhd.headerSize;
  const version = buf.readUInt8(p);
  const timescale = version === 1 ? buf.readUInt32BE(p + 20) : buf.readUInt32BE(p + 12);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
  if (!timescale) return null;
  let width: number | null = null;
  let height: number | null = null;
  for (const trak of [...boxes(buf, moov.start + moov.headerSize, moov.start + moov.size)].filter(
    (b) => b.type === 'trak',
  )) {
    const tkhd = child(buf, trak, 'tkhd');
    if (!tkhd) continue;
    const end = tkhd.start + tkhd.size;
    const w = buf.readUInt32BE(end - 8) / 65536;
    const h = buf.readUInt32BE(end - 4) / 65536;
    if (w > 0 && h > 0) {
      width = Math.round(w);
      height = Math.round(h);
      break;
    }
  }
  return { brand, durationSec: duration / timescale, width, height };
}

const METADATA = new Set(['udta', 'meta', 'uuid', 'XMP_']);

/** A copy with metadata boxes neutralised (top level, moov, and each trak). */
export function stripMp4Metadata(input: Buffer): Buffer {
  const buf = Buffer.from(input);
  const neutralise = (b: Box) => {
    buf.write('free', b.start + 4, 'latin1');
    buf.fill(0, b.start + b.headerSize, b.start + b.size);
  };
  for (const b of boxes(buf, 0, buf.length)) {
    if (METADATA.has(b.type)) neutralise(b);
    if (b.type !== 'moov') continue;
    for (const m of boxes(buf, b.start + b.headerSize, b.start + b.size)) {
      if (METADATA.has(m.type)) neutralise(m);
      if (m.type === 'trak')
        for (const t of boxes(buf, m.start + m.headerSize, m.start + m.size))
          if (METADATA.has(t.type)) neutralise(t);
    }
  }
  return buf;
}
