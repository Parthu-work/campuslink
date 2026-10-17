import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { ClamdScanner, ScannerUnavailableError } from '../src/lib/clamav.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { MemoryStorage } from '../src/lib/storage.js';
import { runInTenant } from '../src/lib/context.js';
import { loadEnv } from '../src/config/env.js';
import { makeTenant, type TestTenant } from './helpers.js';

/**
 * The EICAR anti-virus test file, assembled at runtime so this source file itself is never flagged
 * by a developer's own anti-virus. It is harmless by design (eicar.org).
 */
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');

type Reply = (stream: Buffer) => string | null;
const servers: Server[] = [];

/** A fake clamd: reassembles the INSTREAM chunks and answers with `reply(stream)`. */
async function fakeClamd(reply: Reply): Promise<{ address: string; received: () => Buffer | null }> {
  let last: Buffer | null = null;
  const server = createServer((socket: Socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.subarray(0, 6).toString() === 'zPING\0') return void socket.end('PONG\0');
      const head = 'zINSTREAM\0';
      if (buf.length < head.length) return;
      let off = head.length;
      const chunks: Buffer[] = [];
      while (off + 4 <= buf.length) {
        const len = buf.readUInt32BE(off);
        if (len === 0) {
          last = Buffer.concat(chunks);
          const r = reply(last);
          if (r !== null) socket.end(`${r}\0`);
          return;
        }
        if (off + 4 + len > buf.length) return; // wait for more bytes
        chunks.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { address: `127.0.0.1:${(server.address() as AddressInfo).port}`, received: () => last };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('ClamdScanner (INSTREAM protocol)', () => {
  it('streams the file in length-prefixed chunks and reports clean', async () => {
    const clamd = await fakeClamd(() => 'stream: OK');
    const data = Buffer.alloc(200_000, 7);
    const scanner = new ClamdScanner({ address: clamd.address, chunkBytes: 65_536 });
    expect(await scanner.scan(data)).toBe('clean');
    expect(clamd.received()?.equals(data)).toBe(true);
  });

  it('reports infected when clamd finds a signature', async () => {
    const clamd = await fakeClamd(() => 'stream: Eicar-Test-Signature FOUND');
    expect(await new ClamdScanner({ address: clamd.address }).scan(Buffer.from(EICAR))).toBe('infected');
  });

  it('fails closed on a size-limit error, an unexpected reply, a refused connection or a timeout', async () => {
    const tooBig = await fakeClamd(() => 'INSTREAM size limit exceeded. ERROR');
    await expect(new ClamdScanner({ address: tooBig.address }).scan(Buffer.from('x'))).rejects.toThrow(
      ScannerUnavailableError,
    );
    const odd = await fakeClamd(() => 'hello');
    await expect(new ClamdScanner({ address: odd.address }).scan(Buffer.from('x'))).rejects.toThrow(
      ScannerUnavailableError,
    );
    const silent = await fakeClamd(() => null);
    await expect(
      new ClamdScanner({ address: silent.address, timeoutMs: 200 }).scan(Buffer.from('x')),
    ).rejects.toThrow(/timeout/);
    // Nothing listens on port 1.
    await expect(new ClamdScanner({ address: '127.0.0.1:1' }).scan(Buffer.from('x'))).rejects.toThrow(
      ScannerUnavailableError,
    );
    expect(await new ClamdScanner({ address: '127.0.0.1:1' }).ping()).toBe(false);
  });

  it('answers ping for readiness', async () => {
    const clamd = await fakeClamd(() => 'stream: OK');
    expect(await new ClamdScanner({ address: clamd.address }).ping()).toBe(true);
  });
});

describe('uploads fail closed when the scanner is down', () => {
  let T: TestTenant;
  beforeAll(async () => {
    T = await makeTenant('clamavdown');
  });

  it('answers 503 and stores nothing', async () => {
    const storage = new MemoryStorage();
    const files = new FilesService(storage, new ClamdScanner({ address: '127.0.0.1:1' }));
    await runInTenant(T._id, async () => {
      await expect(
        files.storeImportSource('64b7f0000000000000000001', Buffer.from('roll,name'), 'text/csv'),
      ).rejects.toMatchObject({ status: 503 });
      expect(await FileModel.countDocuments({})).toBe(0);
    });
    expect(storage.blobs.size).toBe(0);
  });

  it('production refuses to start without a scanner', () => {
    const base = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_TICKET_SECRET: 'b'.repeat(40),
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    };
    expect(() => loadEnv(base)).toThrow(/MALWARE_SCANNER=clamav is required/);
    expect(loadEnv({ ...base, MALWARE_SCANNER: 'clamav' }).MALWARE_SCANNER).toBe('clamav');
  });
});

/** Real clamd (docker compose --profile clamav). Runs when CLAMAV_TEST_ADDRESS is set (CI sets it). */
describe.skipIf(!process.env.CLAMAV_TEST_ADDRESS)('real clamd', () => {
  const scanner = new ClamdScanner({ address: process.env.CLAMAV_TEST_ADDRESS ?? '' });
  it('detects the EICAR test file and passes a clean file', async () => {
    expect(await scanner.ping()).toBe(true);
    expect(await scanner.scan(Buffer.from(EICAR))).toBe('infected');
    expect(await scanner.scan(Buffer.from('roll,name\n1,Demo student'))).toBe('clean');
  });
  it('accepts a file at the largest upload size (25 MB reel)', async () => {
    expect(await scanner.scan(Buffer.alloc(25 * 1024 * 1024, 1))).toBe('clean');
  });
});
