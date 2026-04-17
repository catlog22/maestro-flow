// ---------------------------------------------------------------------------
// `maestro brainstorm-visualize` — control the HTML prototype visualizer server.
//
// The server (src/brainstorm-visualize/server.ts) runs as a detached Node
// process. Its lifecycle is tracked via Maestro's DelegateBrokerClient with
// a dedicated state file so visualizer jobs never collide with `maestro
// delegate`: server PID, URL, and session dirs live in broker job metadata,
// so `stop` / `status` / cross-process discovery come for free.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { DelegateBrokerClient } from '../async/index.js';
import { paths } from '../config/paths.js';

const __filename = fileURLToPath(import.meta.url);
// __filename: dist/src/commands/brainstorm-visualize.js
// Server entry lives at: dist/src/brainstorm-visualize/server.js
const SERVER_SCRIPT = resolve(dirname(__filename), '..', 'brainstorm-visualize', 'server.js');

const STARTUP_TIMEOUT_MS = 5000;

// Dedicated broker storage — isolates visualizer jobs from `maestro delegate`
// state so the two never collide in listings, event streams, or cancellation.
const VIZ_BROKER_STATE = join(paths.data, 'brainstorm-visualize', 'broker.json');
const VIZ_BROKER_DB = join(paths.data, 'brainstorm-visualize', 'broker.sqlite');

function createVizBroker(): DelegateBrokerClient {
  return new DelegateBrokerClient({ statePath: VIZ_BROKER_STATE, dbPath: VIZ_BROKER_DB });
}

interface ServerStartedInfo {
  type: 'server-started';
  port: number;
  host: string;
  url_host: string;
  url: string;
  screen_dir: string;
}

function generateExecId(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
  const hhmmss = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(16).slice(2, 6);
  return `viz-${hhmmss}-${rand}`;
}

function resolveServeDir(cwd: string, opts: StartOptions, execId: string): string {
  if (opts.dir) return resolve(opts.dir);
  const base = join(cwd, '.workflow', '.brainstorm-visualize');
  return opts.session ? join(base, opts.session) : join(base, execId);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number, force = false): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), force ? '/F' : '/T', '/T'], { stdio: 'ignore' }).on('error', () => {});
    } else {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    }
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

interface StartOptions {
  session?: string;
  dir?: string;
  host?: string;
  urlHost?: string;
  port?: string;
  cwd?: string;
  ownerPid?: string;
}

async function startServer(opts: StartOptions): Promise<void> {
  if (!existsSync(SERVER_SCRIPT)) {
    console.error(JSON.stringify({ error: `Visualizer server script not found at ${SERVER_SCRIPT}` }));
    process.exit(1);
  }

  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const execId = generateExecId();
  const serveDir = resolveServeDir(cwd, opts, execId);
  mkdirSync(serveDir, { recursive: true });
  // Log files live next to the serve dir (not inside — so they don't clutter listings).
  const logDir = opts.dir
    ? join(cwd, '.workflow', '.brainstorm-visualize', execId)
    : serveDir;
  mkdirSync(logDir, { recursive: true });

  const bindHost = opts.host ?? '127.0.0.1';
  const urlHost = opts.urlHost ?? (bindHost === '127.0.0.1' || bindHost === 'localhost' ? 'localhost' : bindHost);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BRAINSTORM_DIR: serveDir,
    BRAINSTORM_HOST: bindHost,
    BRAINSTORM_URL_HOST: urlHost,
    MAESTRO_EXEC_ID: execId,
  };
  if (opts.port) {
    env.BRAINSTORM_PORT = opts.port;
  }
  // Only bind lifecycle to an owner PID when the caller explicitly opts in.
  // The ephemeral CLI PID would be wrong — it exits the moment start returns.
  if (opts.ownerPid && /^[1-9]\d*$/.test(opts.ownerPid)) {
    env.BRAINSTORM_OWNER_PID = opts.ownerPid;
  }

  // Redirect child stdio to files in logDir so the server can keep writing
  // logs after the parent CLI exits (pipe-based capture would close when the
  // parent detaches and kill the server on the next write).
  const logPath = join(logDir, 'server.log');
  const errPath = join(logDir, 'server.err');
  const logFd = openSync(logPath, 'w');
  const errFd = openSync(errPath, 'w');

  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd,
    detached: true,
    stdio: ['ignore', logFd, errFd],
    env,
  });

  const broker = createVizBroker();
  const startedAt = new Date().toISOString();

  try {
    broker.publishEvent({
      jobId: execId,
      type: 'queued',
      status: 'queued',
      payload: { summary: 'brainstorm-visualizer queued' },
      jobMetadata: {
        kind: 'brainstorm-visualizer',
        workerPid: child.pid ?? null,
        serveDir,
        logDir,
        sessionId: opts.session ?? null,
        bindHost,
        urlHost,
      },
      now: startedAt,
    });
  } catch {
    // Broker publish is best-effort.
  }

  // Tail the log file until we see the `server-started` line, or timeout.
  const info = await waitForStartupLine(logPath, child, STARTUP_TIMEOUT_MS).catch((err: Error) => err);

  if (info instanceof Error || !info) {
    killProcess(child.pid ?? 0, true);
    try {
      broker.publishEvent({
        jobId: execId,
        type: 'failed',
        status: 'failed',
        payload: { summary: info instanceof Error ? info.message : 'Server failed to start' },
      });
    } catch { /* ignore */ }
    console.error(JSON.stringify({ error: info instanceof Error ? info.message : 'Server failed to start within 5s' }));
    process.exit(1);
  }

  try {
    broker.publishEvent({
      jobId: execId,
      type: 'running',
      status: 'running',
      payload: { summary: `visualizer listening on ${info.url}` },
      snapshot: {
        url: info.url,
        port: info.port,
        screen_dir: info.screen_dir,
        host: info.host,
        url_host: info.url_host,
      },
    });
  } catch { /* ignore */ }

  // Detach so the parent CLI can exit without waiting on the server.
  child.unref();

  console.log(JSON.stringify({
    execId,
    serveDir,
    logDir,
    ...info,
  }));
}

function waitForStartupLine(
  logPath: string,
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<ServerStartedInfo> {
  const pollIntervalMs = 50;
  return new Promise((resolveFn, rejectFn) => {
    const deadline = Date.now() + timeoutMs;
    let lastSize = 0;
    let settled = false;

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      rejectFn(new Error(`Server exited prematurely (code ${code ?? 'null'})`));
    };
    child.once('exit', onExit);

    const tick = () => {
      if (settled) return;
      try {
        const size = statSync(logPath).size;
        if (size > lastSize) {
          const content = readFileSync(logPath, 'utf-8');
          lastSize = size;
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed) as Partial<ServerStartedInfo>;
              if (msg.type === 'server-started' && msg.url && msg.screen_dir) {
                settled = true;
                child.off('exit', onExit);
                resolveFn(msg as ServerStartedInfo);
                return;
              }
            } catch {
              // non-JSON line — skip
            }
          }
        }
      } catch {
        // file not yet visible — keep polling
      }
      if (Date.now() >= deadline) {
        settled = true;
        child.off('exit', onExit);
        rejectFn(new Error(`Server did not emit server-started within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, pollIntervalMs);
    };
    setTimeout(tick, pollIntervalMs);
  });
}

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

interface StopOptions {
  cleanTmp?: boolean;
}

function stopServer(execId: string, opts: StopOptions): void {
  const broker = createVizBroker();
  const job = broker.getJob(execId);
  if (!job) {
    console.error(JSON.stringify({ error: `No visualizer job with execId: ${execId}` }));
    process.exit(1);
  }

  const metadata = job.metadata ?? {};
  const workerPid = typeof metadata.workerPid === 'number' ? metadata.workerPid : null;
  const logDir = typeof metadata.logDir === 'string' ? metadata.logDir : null;

  if (workerPid && isProcessAlive(workerPid)) {
    killProcess(workerPid, false);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && isProcessAlive(workerPid)) {
      // busy-wait with small sleep
      const end = Date.now() + 100;
      while (Date.now() < end) { /* spin */ }
    }
    if (isProcessAlive(workerPid)) {
      killProcess(workerPid, true);
    }
  }

  try {
    broker.publishEvent({
      jobId: execId,
      type: 'cancelled',
      status: 'cancelled',
      payload: { summary: 'visualizer stopped via brainstorm-visualize stop' },
    });
  } catch { /* ignore */ }

  // Only remove ephemeral log dirs (under /tmp). The serveDir may hold the
  // user's authored HTML — never auto-delete it.
  if (opts.cleanTmp && logDir && (logDir.startsWith('/tmp/') || logDir.startsWith('/var/tmp/'))) {
    try { rmSync(logDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(JSON.stringify({ status: 'stopped', execId, workerPid }));
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function statusServer(execId?: string): void {
  const broker = createVizBroker();
  if (execId) {
    const job = broker.getJob(execId);
    if (!job) {
      console.error(JSON.stringify({ error: `No visualizer job with execId: ${execId}` }));
      process.exit(1);
    }
    const metadata = job.metadata ?? {};
    const snapshot = job.latestSnapshot ?? {};
    const pid = typeof metadata.workerPid === 'number' ? metadata.workerPid : null;
    const alive = pid !== null ? isProcessAlive(pid) : null;
    console.log(JSON.stringify({
      execId,
      status: job.status,
      alive,
      url: snapshot.url ?? null,
      serveDir: metadata.serveDir ?? null,
      logDir: metadata.logDir ?? null,
      screen_dir: snapshot.screen_dir ?? null,
      workerPid: pid,
      updatedAt: job.updatedAt,
    }, null, 2));
    return;
  }

  // Without execId: broker has no kind-level filter, so caller must pass execId.
  // Print a hint.
  console.error(JSON.stringify({
    error: 'Pass an execId: maestro brainstorm-visualize status <execId>',
    hint: 'The execId is returned by `maestro brainstorm-visualize start`.',
  }));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBrainstormVisualizeCommand(program: Command): void {
  const root = program
    .command('brainstorm-visualize')
    .alias('bv')
    .description('Launch or control the brainstorm HTML prototype visualizer server');

  root
    .command('start')
    .description('Start the visualizer server (detached, broker-tracked)')
    .option('--dir <path>', 'Serve HTML files from this directory (e.g. .brainstorming/html-prototypes/)')
    .option('--session <id>', 'Fallback when --dir is absent: bind files under .workflow/.brainstorm-visualize/<id>/')
    .option('--host <host>', 'Bind host (default 127.0.0.1)', '127.0.0.1')
    .option('--url-host <host>', 'Hostname shown in returned URL')
    .option('--port <port>', 'Specific port (default: random high port)')
    .option('--owner-pid <pid>', 'Auto-shutdown when this PID dies (otherwise server relies on 30m idle timeout + explicit stop)')
    .option('--cd <dir>', 'Project working directory', process.cwd())
    .action(async (opts: StartOptions) => {
      await startServer(opts);
    });

  root
    .command('stop <execId>')
    .description('Stop a running visualizer server by execId')
    .option('--clean-tmp', 'Also remove ephemeral /tmp session dir', false)
    .action((execId: string, opts: StopOptions) => {
      stopServer(execId, opts);
    });

  root
    .command('status [execId]')
    .description('Show status of a visualizer server')
    .action((execId?: string) => {
      statusServer(execId);
    });
}
