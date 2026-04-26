import { describe, it, expect } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import {
  writeTcpMessage,
  createTcpMessageReader,
  sendTcpRequest,
} from './tcp-helpers.js';

// ---------------------------------------------------------------------------
// createTcpMessageReader
// ---------------------------------------------------------------------------

describe('createTcpMessageReader', () => {
  it('decodes a single complete frame in one chunk', () => {
    const reader = createTcpMessageReader();
    const body = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    const frame = Buffer.concat([header, body]);

    const results = reader.feed(frame);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ hello: 'world' });
  });

  it('decodes multiple frames in a single chunk', () => {
    const reader = createTcpMessageReader();
    const frames: Buffer[] = [];
    for (let i = 0; i < 3; i++) {
      const body = Buffer.from(JSON.stringify({ n: i }), 'utf-8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);
      frames.push(Buffer.concat([header, body]));
    }
    const combined = Buffer.concat(frames);
    const results = reader.feed(combined);
    expect(results).toHaveLength(3);
    expect(results).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
  });

  it('reassembles a frame split across multiple chunks', () => {
    const reader = createTcpMessageReader();
    const body = Buffer.from(JSON.stringify({ split: true }), 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    const frame = Buffer.concat([header, body]);

    // Split in the middle
    const mid = Math.floor(frame.length / 2);
    const part1 = frame.subarray(0, mid);
    const part2 = frame.subarray(mid);

    const r1 = reader.feed(part1);
    expect(r1).toHaveLength(0);

    const r2 = reader.feed(part2);
    expect(r2).toHaveLength(1);
    expect(r2[0]).toEqual({ split: true });
  });

  it('handles partial header gracefully', () => {
    const reader = createTcpMessageReader();
    // Only 2 bytes of a 4-byte header
    const partial = Buffer.alloc(2);
    partial.writeUInt16BE(0, 0);
    const results = reader.feed(partial);
    expect(results).toHaveLength(0);
  });

  it('skips malformed JSON bodies', () => {
    const reader = createTcpMessageReader();
    const body = Buffer.from('not-json', 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    const frame = Buffer.concat([header, body]);

    const results = reader.feed(frame);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// writeTcpMessage + sendTcpRequest (integration with real TCP)
// ---------------------------------------------------------------------------

describe('writeTcpMessage + sendTcpRequest', () => {
  let server: Server;
  let serverPort: number;

  function startEchoServer(): Promise<void> {
    return new Promise((resolve) => {
      server = createServer((socket: Socket) => {
        const reader = createTcpMessageReader();
        socket.on('data', (chunk) => {
          const messages = reader.feed(chunk);
          for (const msg of messages) {
            // Echo back with an added field
            writeTcpMessage(socket, { echo: true, original: msg });
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  }

  it('sends a request and receives a response via TCP', async () => {
    await startEchoServer();
    try {
      const response = await sendTcpRequest({
        port: serverPort,
        payload: { test: 'data' },
        timeoutMs: 5000,
      });
      expect(response).toEqual({ echo: true, original: { test: 'data' } });
    } finally {
      server.close();
    }
  });

  it('rejects on connection refused', async () => {
    await expect(
      sendTcpRequest({
        port: 1, // unlikely to be listening
        payload: { test: 'fail' },
        timeoutMs: 2000,
      }),
    ).rejects.toThrow();
  });

  it('rejects on timeout', async () => {
    // Server that never responds
    const silentServer = createServer(() => { /* no response */ });
    await new Promise<void>((resolve) => {
      silentServer.listen(0, '127.0.0.1', resolve);
    });
    const addr = silentServer.address();
    const port = addr && typeof addr !== 'string' ? addr.port : 0;

    try {
      await expect(
        sendTcpRequest({
          port,
          payload: { test: 'timeout' },
          timeoutMs: 200,
        }),
      ).rejects.toThrow('timed out');
    } finally {
      silentServer.close();
    }
  });
});
