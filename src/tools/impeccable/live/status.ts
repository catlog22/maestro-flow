/**
 * Print durable recovery status for Impeccable live sessions.
 */

import { createLiveSessionStore } from './session-store.js';
import { readLiveServerInfo } from '../paths.js';
import type { LiveServerInfo } from '../paths.js';
import type { LiveSnapshot } from './session-store.js';

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

function readServerInfo(): LiveServerInfo | null {
  return readLiveServerInfo(process.cwd())?.info || null;
}

interface ServerStatus {
  status?: string;
  port?: number;
  connectedClients?: number;
  pendingEvents?: number;
  activeSessions?: LiveSnapshot[];
}

async function fetchServerStatus(info: LiveServerInfo | null): Promise<ServerStatus | null> {
  if (!info) return null;
  try {
    const res = await fetch(`http://localhost:${info.port}/status?token=${info.token}`);
    if (!res.ok) return null;
    return (await res.json()) as ServerStatus;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export async function statusCli(): Promise<void> {
  const info = readServerInfo();
  const server = await fetchServerStatus(info);
  const store = createLiveSessionStore({ cwd: process.cwd() });
  const activeSessions = store.listActiveSessions();
  const payload = {
    liveServer: server
      ? {
          status: server.status,
          port: server.port,
          connectedClients: server.connectedClients,
          pendingEvents: server.pendingEvents,
        }
      : null,
    activeSessions: server?.activeSessions || activeSessions,
    recoveryHint: server
      ? 'Run live-poll.mjs to continue pending work, or live-complete.mjs --id <session> after manual cleanup.'
      : 'Start live-server.mjs to requeue pending durable events, then run live-poll.mjs.',
  };
  console.log(JSON.stringify(payload, null, 2));
}
