import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamAvScanner } from './clamav-scanner.js';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** clamd falso que implementa o INSTREAM e reconhece a assinatura de teste EICAR. */
const fakeClamd = (
  reply?: string,
): Promise<{ server: Server; port: number; received: () => Buffer }> =>
  new Promise((resolve) => {
    let payload = Buffer.alloc(0);
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        const command = 'zINSTREAM\0';
        if (buffer.length < command.length) return;
        let offset = command.length;
        const parts: Buffer[] = [];
        while (offset + 4 <= buffer.length) {
          const size = buffer.readUInt32BE(offset);
          if (size === 0) {
            payload = Buffer.concat(parts);
            const infected = payload.toString().includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
            socket.end(reply ?? (infected ? 'stream: Eicar-Signature FOUND\0' : 'stream: OK\0'));
            return;
          }
          if (offset + 4 + size > buffer.length) return;
          parts.push(buffer.subarray(offset + 4, offset + 4 + size));
          offset += 4 + size;
        }
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port, received: () => payload }),
    );
  });

let server: Server | undefined;
afterEach(() => server?.close());

describe('ClamAvScanner', () => {
  it('streams the content in chunks and reports a clean file', async () => {
    const clamd = await fakeClamd();
    server = clamd.server;
    const content = new Uint8Array(200 * 1024).fill(7);
    await expect(new ClamAvScanner('127.0.0.1', clamd.port).scan(content)).resolves.toEqual({
      clean: true,
    });
    expect(clamd.received().length).toBe(content.length);
  });

  it('reports the signature of an infected file (EICAR test string)', async () => {
    const clamd = await fakeClamd();
    server = clamd.server;
    await expect(
      new ClamAvScanner('127.0.0.1', clamd.port).scan(Buffer.from(EICAR)),
    ).resolves.toEqual({
      clean: false,
      signature: 'Eicar-Signature',
    });
  });

  it('fails (so the job retries) on unexpected replies or when clamd is unreachable', async () => {
    const clamd = await fakeClamd('INSTREAM size limit exceeded. ERROR\0');
    server = clamd.server;
    await expect(new ClamAvScanner('127.0.0.1', clamd.port).scan(Buffer.from('x'))).rejects.toThrow(
      'inesperada',
    );
    await expect(new ClamAvScanner('127.0.0.1', 1, 500).scan(Buffer.from('x'))).rejects.toThrow();
  });
});
