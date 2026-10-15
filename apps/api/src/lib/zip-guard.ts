/**
 * Zip-bomb pre-check for XLSX (a ZIP container) before any parser inflates it. Reads only the
 * central directory: sums declared uncompressed sizes and rejects absurd totals or ratios.
 */
export function assertSafeZip(
  buf: Buffer,
  opts = { maxTotal: 50 * 1024 * 1024, maxRatio: 100, maxEntries: 2000 },
): void {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid spreadsheet file');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries > opts.maxEntries || cdOffset >= buf.length)
    throw new Error('Spreadsheet structure is not supported');
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error('Spreadsheet structure is not supported');
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    // ZIP64 markers or ratio abuse
    if (compressed === 0xffffffff || uncompressed === 0xffffffff)
      throw new Error('Spreadsheet structure is not supported');
    if (compressed > 0 && uncompressed / compressed > opts.maxRatio)
      throw new Error('Spreadsheet expands too much to be safe');
    total += uncompressed;
    if (total > opts.maxTotal) throw new Error('Spreadsheet is too large once uncompressed');
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}
