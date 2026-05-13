/**
 * CLI client for the live variant mode poll/reply protocol.
 *
 * Converted from live-poll.mjs to TypeScript.
 */

import { readLiveServerInfo } from '../paths.js';
import { completionAckForAcceptResult, completionTypeForAcceptResult } from './completion.js';
import type { AcceptResult, CompletionAck } from './completion.js';

// Node's built-in fetch (undici under the hood) enforces a 300s headers
// timeout that can't be lowered per-request. We cap each request below
// that ceiling and loop in `pollOnce` to synthesize a long poll without
// depending on the standalone undici package.
const PER_REQUEST_TIMEOUT_MS = 270_000;

export interface PollOpts {
  timeout?: string;
  reply?: string;
  status?: string;
  message?: string;
}

interface ReplyPayload {
  token: string;
  id: string;
  type: string;
  message?: string;
  file?: string;
  data?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventRecord = Record<string, any> & { _acceptResult?: AcceptResult; _completionAck?: CompletionAck };

function readServerInfo() {
  const record = readLiveServerInfo(process.cwd());
  if (!record) {
    console.error('No running live server found. Start one with: maestro impeccable live');
    process.exit(1);
  }
  return record.info;
}

export function buildPollReplyPayload(token: string, reply: { id: string; type: string; message?: string; file?: string; data?: Record<string, unknown> }): ReplyPayload {
  return { token, id: reply.id, type: reply.type, message: reply.message, file: reply.file, data: reply.data };
}

async function postReply(base: string, token: string, reply: { id: string; type: string; message?: string; file?: string; data?: Record<string, unknown> }): Promise<void> {
  const res = await fetch(`${base}/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPollReplyPayload(token, reply)),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) || res.statusText);
  }
}

export async function pollCli(opts: PollOpts = {}): Promise<void> {
  const info = readServerInfo();
  const base = `http://localhost:${info.port}`;

  // Reply mode: maestro impeccable live-poll --reply <id> <status> [--file path] [message]
  if (opts.reply) {
    const id = opts.reply;
    const status = opts.status || 'done';

    if (!id) {
      console.error('Usage: maestro impeccable live-poll --reply <id> --status <status> [--message msg]');
      process.exit(1);
    }

    try {
      await postReply(base, info.token, { id, type: status, message: opts.message });

      // Success — silent exit (agent doesn't need output for replies)
    } catch (err) {
      const error = err as Error & { cause?: { code?: string } };
      if (error.cause?.code === 'ECONNREFUSED') {
        console.error('Live server not running. Start one with: maestro impeccable live');
      } else {
        console.error('Reply failed:', error.message);
      }
      process.exit(1);
    }
    return;
  }

  // Poll mode: block until browser event. Default 10 min. Node's built-in
  // fetch enforces a 300s headers timeout, so we loop in slices under that
  // ceiling and keep re-polling until we get a real event or the user's
  // total timeout runs out.
  const totalTimeout = opts.timeout ? parseInt(opts.timeout, 10) : 600000;

  const deadline = Date.now() + totalTimeout;
  let event: EventRecord;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        event = { type: 'timeout' };
        break;
      }
      const slice = Math.min(remaining, PER_REQUEST_TIMEOUT_MS);
      const res = await fetch(`${base}/poll?token=${info.token}&timeout=${slice}`);

      if (res.status === 401) {
        console.error('Authentication failed. The server token may have changed.');
        console.error('Try restarting: maestro impeccable live-server stop && maestro impeccable live');
        process.exit(1);
      }

      if (!res.ok) {
        console.error(`Poll failed: ${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const next = await res.json() as EventRecord;
      // Server-side timeout means no browser event arrived in this slice.
      // Loop and re-poll until we get a real event or we hit the user's
      // total deadline.
      if (next?.type === 'timeout' && Date.now() < deadline) continue;
      event = next;
      break;
    }

    // Auto-handle accept/discard via direct function call
    if (event.type === 'accept' || event.type === 'discard') {
      try {
        // Dynamically import accept to avoid circular deps at module level
        const { acceptCli } = await import('./accept.js');

        // Build opts for acceptCli
        const acceptOpts: Record<string, unknown> = {
          id: event.id,
        };
        if (event.type === 'discard') {
          acceptOpts.discard = true;
        } else {
          acceptOpts.variant = parseInt(event.variantId, 10);
        }
        if (event.type === 'accept' && event.paramValues && Object.keys(event.paramValues).length > 0) {
          acceptOpts.paramValues = JSON.stringify(event.paramValues);
        }

        // acceptCli writes JSON to stdout; we capture it by temporarily
        // replacing console.log, then parse the result.
        let captured = '';
        const origLog = console.log;
        console.log = (...args: unknown[]) => {
          captured = args.map(String).join(' ');
        };
        try {
          await acceptCli(acceptOpts as unknown as Parameters<typeof acceptCli>[0]);
        } catch (err) {
          event._acceptResult = { handled: false, mode: 'error', error: (err as Error).message };
        }
        console.log = origLog;

        if (captured) {
          try {
            event._acceptResult = JSON.parse(captured.trim()) as AcceptResult;
          } catch {
            event._acceptResult = { handled: false, mode: 'error', error: 'Failed to parse accept output' };
          }
        }
      } catch (err) {
        event._acceptResult = { handled: false, mode: 'error', error: (err as Error).message };
      }

      const completionType = completionTypeForAcceptResult(event.type, event._acceptResult!);
      try {
        await postReply(base, info.token, {
          id: event.id,
          type: completionType,
          message: event._acceptResult?.error,
          file: event._acceptResult?.file,
          data: event._acceptResult?.carbonize === true ? { carbonize: true } : undefined,
        });
      } catch (err) {
        event._completionAck = { ok: false, type: completionType, error: (err as Error).message };
      }
      if (!event._completionAck) {
        event._completionAck = completionAckForAcceptResult(event.id, completionType, event._acceptResult!);
      }
    }

    // Second signal path: stderr banner in case the agent parses stdout
    // JSON but skips nested fields. One line is enough — the full checklist
    // is in reference/live.md.
    if (event._acceptResult?.carbonize === true) {
      process.stderr.write('\n\u26A0 Carbonize cleanup REQUIRED before next poll. After cleanup, run live-complete --id ' + event.id + '. See reference/live.md "Required after accept".\n\n');
    }

    // Print the event as JSON — the agent reads this from stdout
    console.log(JSON.stringify(event));
  } catch (err) {
    const error = err as Error & { cause?: { code?: string } };
    if (error.cause?.code === 'ECONNREFUSED') {
      console.error('Live server not running. Start one with: maestro impeccable live');
    } else {
      console.error('Poll failed:', error.message);
    }
    process.exit(1);
  }
}
