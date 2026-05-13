/**
 * Canonical durable completion acknowledgement for Impeccable live sessions.
 */

import { createLiveSessionStore } from './session-store.js';
import { readLiveServerInfo } from '../paths.js';
import type { LiveServerInfo } from '../paths.js';

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

export interface CompleteOpts {
  id: string;
  discarded?: boolean;
  error?: string | boolean;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export async function completeCli(opts: CompleteOpts): Promise<void> {
  const store = createLiveSessionStore({ cwd: process.cwd(), sessionId: opts.id });

  const status =
    opts.discarded === true
      ? 'discarded'
      : opts.error
        ? 'agent_error'
        : 'complete';
  const message =
    typeof opts.error === 'string' ? opts.error : 'unknown error';

  const serverInfo = readServerInfo();
  const serverResult = serverInfo
    ? await completeThroughServer(serverInfo, {
        id: opts.id,
        status,
        message,
      })
    : null;

  if (serverResult?.ok) {
    const snapshot = store.getSnapshot(opts.id, { includeCompleted: true });
    console.log(
      JSON.stringify(
        { ok: true, id: opts.id, phase: snapshot?.phase || status, snapshot },
        null,
        2,
      ),
    );
    return;
  }

  const event =
    status === 'discarded'
      ? { type: 'discarded' as const, id: opts.id }
      : status === 'agent_error'
        ? { type: 'agent_error' as const, id: opts.id, message }
        : { type: 'complete' as const, id: opts.id };

  const snapshot = store.appendEvent(event);
  console.log(
    JSON.stringify({ ok: true, id: opts.id, phase: snapshot.phase, snapshot }, null, 2),
  );
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

function readServerInfo(): LiveServerInfo | null {
  return readLiveServerInfo(process.cwd())?.info || null;
}

interface ServerCompleteResult {
  ok?: boolean;
}

async function completeThroughServer(
  info: LiveServerInfo,
  args: { id: string; status: string; message: string },
): Promise<ServerCompleteResult | null> {
  const type =
    args.status === 'discarded'
      ? 'discarded'
      : args.status === 'agent_error'
        ? 'error'
        : 'complete';
  try {
    const res = await fetch(`http://localhost:${info.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: info.token, id: args.id, type, message: args.message }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ServerCompleteResult;
  } catch {
    return null;
  }
}
