// ---------------------------------------------------------------------------
// TCP Helpers -- shared wire-protocol utilities for meeting room MCP
// ---------------------------------------------------------------------------
// Wire format: 4-byte big-endian length prefix + UTF-8 JSON body.
// All messages are newline-delimited JSON over TCP with length framing.
// ---------------------------------------------------------------------------

import { createConnection, type Socket } from 'node:net';

// ---------------------------------------------------------------------------
// Write: 4-byte big-endian length + UTF-8 JSON body
// ---------------------------------------------------------------------------

export function writeTcpMessage(socket: Socket, payload: unknown): boolean {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(header);
  return socket.write(body);
}

// ---------------------------------------------------------------------------
// Read: O(N) chunk-array reader that reassembles framed messages
// ---------------------------------------------------------------------------

export interface TcpMessageReader {
  /** Feed a raw TCP chunk. Returns zero or more decoded messages. */
  feed(chunk: Buffer): unknown[];
}

export function createTcpMessageReader(): TcpMessageReader {
  const chunks: Buffer[] = [];
  let totalLen = 0;

  return {
    feed(chunk: Buffer): unknown[] {
      chunks.push(chunk);
      totalLen += chunk.length;

      const results: unknown[] = [];

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Need at least 4 bytes for the length header
        if (totalLen < 4) break;

        // Peek at the length without consuming
        const headerBuf = peekBytes(chunks, 4);
        const bodyLen = headerBuf.readUInt32BE(0);
        const frameLen = 4 + bodyLen;

        if (totalLen < frameLen) break;

        // Consume the full frame
        const frameBuf = consumeBytes(chunks, frameLen);
        totalLen -= frameLen;

        const bodyStr = frameBuf.subarray(4).toString('utf-8');
        try {
          results.push(JSON.parse(bodyStr));
        } catch {
          // Malformed JSON -- skip frame
        }
      }

      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// sendTcpRequest: connect + write + read single response
// ---------------------------------------------------------------------------

export interface TcpRequestOptions {
  port: number;
  host?: string;
  payload: unknown;
  timeoutMs?: number;
}

export function sendTcpRequest(opts: TcpRequestOptions): Promise<unknown> {
  const { port, host = '127.0.0.1', payload, timeoutMs = 30_000 } = opts;

  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host }, () => {
      writeTcpMessage(socket, payload);
    });

    const reader = createTcpMessageReader();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`TCP request timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    socket.on('data', (chunk: Buffer) => {
      const messages = reader.feed(chunk);
      if (messages.length > 0 && !settled) {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(messages[0]);
      }
    });

    socket.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    socket.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('TCP connection closed before response'));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Peek at the first `n` bytes across chunk array without consuming */
function peekBytes(chunks: Buffer[], n: number): Buffer {
  if (chunks.length === 1 && chunks[0].length >= n) {
    return chunks[0].subarray(0, n);
  }
  const buf = Buffer.alloc(n);
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, n - offset);
    chunk.copy(buf, offset, 0, take);
    offset += take;
    if (offset >= n) break;
  }
  return buf;
}

/** Consume exactly `n` bytes from the chunk array, mutating it in-place */
function consumeBytes(chunks: Buffer[], n: number): Buffer {
  const buf = Buffer.alloc(n);
  let offset = 0;

  while (offset < n && chunks.length > 0) {
    const head = chunks[0];
    const need = n - offset;

    if (head.length <= need) {
      head.copy(buf, offset);
      offset += head.length;
      chunks.shift();
    } else {
      head.copy(buf, offset, 0, need);
      chunks[0] = head.subarray(need);
      offset += need;
    }
  }

  return buf;
}
