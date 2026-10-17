import { createConnection, type Socket } from 'node:net';

/**
 * Malware scanning with ClamAV's clamd over its INSTREAM protocol (TCP or a Unix socket).
 *
 * Fails closed: if clamd is unreachable, times out, or answers anything other than a clean or
 * infected verdict, `scan` throws and the upload is refused. A file is never stored unscanned when
 * scanning is configured.
 *
 * Protocol (clamd(8)): send `zINSTREAM\0`, then chunks of <4-byte big-endian length><bytes>, then a
 * zero-length chunk. clamd answers `stream: OK`, `stream: <signature> FOUND`, or `... ERROR`.
 */
export type ScanVerdict = 'clean' | 'infected';

export interface ClamdOptions {
  /** `host:port` or an absolute Unix socket path. */
  address: string;
  timeoutMs?: number;
  /** Must not exceed clamd's StreamMaxLength (set it in clamd.conf; see docs/deployment.md). */
  chunkBytes?: number;
}

export class ScannerUnavailableError extends Error {
  constructor(reason: string) {
    super(`Malware scanner unavailable: ${reason}`);
    this.name = 'ScannerUnavailableError';
  }
}

const MAX_REPLY_BYTES = 4096;

export class ClamdScanner {
  private readonly timeoutMs: number;
  private readonly chunkBytes: number;
  constructor(private readonly options: ClamdOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.chunkBytes = options.chunkBytes ?? 64 * 1024;
  }

  private connect(): Socket {
    const a = this.options.address;
    if (a.startsWith('/')) return createConnection({ path: a });
    const i = a.lastIndexOf(':');
    const host = i > 0 ? a.slice(0, i) : a;
    const port = i > 0 ? Number(a.slice(i + 1)) : 3310;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ScannerUnavailableError('bad address');
    return createConnection({ host, port });
  }

  /** Sends `zPING` and expects `PONG` (readiness checks). */
  async ping(): Promise<boolean> {
    try {
      return (await this.exchange([Buffer.from('zPING\0')])) === 'PONG';
    } catch {
      return false;
    }
  }

  async scan(data: Buffer): Promise<ScanVerdict> {
    const frames: Buffer[] = [Buffer.from('zINSTREAM\0')];
    for (let off = 0; off < data.length; off += this.chunkBytes) {
      const chunk = data.subarray(off, off + this.chunkBytes);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(chunk.length);
      frames.push(len, chunk);
    }
    frames.push(Buffer.alloc(4));
    const reply = await this.exchange(frames);
    if (/^stream: OK$/.test(reply)) return 'clean';
    if (/^stream: .+ FOUND$/.test(reply)) return 'infected';
    // "INSTREAM size limit exceeded. ERROR", "... ERROR", or anything unexpected.
    throw new ScannerUnavailableError(reply.endsWith('ERROR') ? 'scan error' : 'unexpected reply');
  }

  private exchange(frames: Buffer[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let socket: Socket;
      try {
        socket = this.connect();
      } catch (e) {
        reject(e instanceof ScannerUnavailableError ? e : new ScannerUnavailableError('connect failed'));
        return;
      }
      const parts: Buffer[] = [];
      let size = 0;
      let settled = false;
      const done = (err: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(value ?? '');
      };
      const timer = setTimeout(() => done(new ScannerUnavailableError('timeout')), this.timeoutMs);
      socket.on('error', () => done(new ScannerUnavailableError('connection error')));
      socket.on('data', (b: Buffer) => {
        size += b.length;
        if (size > MAX_REPLY_BYTES) return done(new ScannerUnavailableError('reply too large'));
        parts.push(b);
        // Replies to z-prefixed commands end with a NUL byte.
        if (b.includes(0)) done(null, Buffer.concat(parts).toString('utf8').split('\0')[0]?.trim() ?? '');
      });
      socket.on('end', () => {
        if (size === 0) done(new ScannerUnavailableError('closed without a reply'));
        else done(null, Buffer.concat(parts).toString('utf8').split('\0')[0]?.trim() ?? '');
      });
      socket.on('connect', () => {
        for (const f of frames) socket.write(f);
      });
    });
  }
}
