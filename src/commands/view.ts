// ---------------------------------------------------------------------------
// `maestro view` — launch the dashboard kanban board
//
// If the server is already running, opens browser (reports current workspace).
// If not, spawns the dashboard server and opens browser.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 3001;
const HEALTH_TIMEOUT_MS = 1000;
const STARTUP_POLL_MS = 500;
const STARTUP_MAX_WAIT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDashboardDir(): string {
  return resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'dashboard');
}

interface HealthResponse {
  status: string;
  workspace?: string;
}

async function checkHealth(host: string, port: number): Promise<HealthResponse | null> {
  // Always probe localhost — even if binding 0.0.0.0, localhost will respond
  const probeHost = (host === '0.0.0.0' || host === '::') ? '127.0.0.1' : host;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`http://${probeHost}:${port}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      return await res.json() as HealthResponse;
    }
    return { status: 'up' };
  } catch {
    return null;
  }
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch {
    console.error(`  Could not open browser. Open manually: ${url}`);
  }
}

async function waitForServer(host: string, port: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < STARTUP_MAX_WAIT_MS) {
    if (await checkHealth(host, port)) return true;
    await new Promise(r => setTimeout(r, STARTUP_POLL_MS));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerViewCommand(program: Command): void {
  program
    .command('view')
    .description('Launch the maestro dashboard kanban board')
    .option('-p, --port <port>', 'Dashboard port', String(DEFAULT_PORT))
    .option('--host <host>', 'Bind host', '127.0.0.1')
    .option('--path <dir>', 'Path to maestro workspace root containing .workflow/ (hot-switches running server without restart)')
    .option('--no-browser', 'Do not open browser')
    .option('--dev', 'Use Vite dev server with HMR (hot reload)')
    .action(async (opts: { port: string; host: string; path?: string; browser: boolean; dev?: boolean }) => {
      const port = parseInt(opts.port, 10) || DEFAULT_PORT;
      const host = opts.host;
      const browserHost = (host === '0.0.0.0' || host === '::') ? 'localhost' : host;
      const workDir = resolve(opts.path ?? process.cwd());
      const workflowRoot = join(workDir, '.workflow');
      const dashboardDir = getDashboardDir();

      console.error('');
      console.error('  Maestro Dashboard');
      console.error('');

      // ------------------------------------------------------------------
      // Dev mode: use `npm run dev` (Vite HMR + tsx --watch backend)
      // ------------------------------------------------------------------
      if (opts.dev) {
        const vitePort = port + 1732; // Vite dev server on a separate port (e.g. 5173)
        const url = `http://${browserHost}:${vitePort}`;

        // Check if already running
        const health = await checkHealth(host, port);
        if (health) {
          console.error(`  Server already running on port ${port}`);
          if (opts.browser) openBrowser(url);
          console.error('');
          return;
        }

        console.error(`  Starting dashboard (dev + HMR) ...`);
        console.error(`  Backend: port ${port}  |  Vite: port ${vitePort}`);
        console.error(`  Workspace: ${workflowRoot}`);
        console.error('');

        const env = {
          ...process.env,
          PORT: String(port),
          HOST: host,
          WORKFLOW_ROOT: workflowRoot,
        };

        // Spawn: concurrently runs Vite dev server + tsx backend
        const child = spawn('npm', ['run', 'dev'], {
          cwd: dashboardDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        });
        child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
        child.stdout?.on('data', (d: Buffer) => process.stderr.write(d));

        // Wait for backend to be ready
        const ready = await waitForServer(host, port);
        if (!ready) {
          console.error('  Warning: Backend server did not respond in time.');
        }

        if (opts.browser) {
          console.error(`  Opening ${url}`);
          openBrowser(url);
        }

        console.error(`  Dashboard (dev) running at ${url}`);
        console.error(`  HMR enabled — changes auto-reload in browser`);
        console.error('');

        // Keep the process alive (don't unref in dev mode)
        process.on('SIGINT', () => {
          child.kill('SIGTERM');
          process.exit(0);
        });
        return;
      }

      // ------------------------------------------------------------------
      // Production mode (existing behavior)
      // ------------------------------------------------------------------
      const url = `http://${browserHost}:${port}`;

      // Check if server is already running
      const health = await checkHealth(host, port);
      if (health) {
        console.error(`  Server already running on port ${port}`);
        if (health.workspace) {
          console.error(`  Workspace: ${health.workspace}`);
        }

        const currentWorkspace = health.workspace ?? '';
        const normalizedCurrent = currentWorkspace.replace(/[\\/]+$/, '').toLowerCase();
        const normalizedRequested = workflowRoot.replace(/[\\/]+$/, '').toLowerCase();

        if (opts.path && normalizedCurrent !== normalizedRequested) {
          // Hot-switch workspace via API
          try {
            const res = await fetch(`http://${host}:${port}/api/workspace`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: workflowRoot }),
            });
            if (!res.ok) {
              const text = await res.text().catch(() => res.statusText);
              console.error(`  Error: Failed to switch workspace — ${text}`);
              process.exit(1);
            }
            console.error(`  Workspace switched to ${workflowRoot}`);
          } catch (err) {
            console.error(`  Error: Failed to switch workspace — ${(err as Error).message}`);
            process.exit(1);
          }
        }

        if (opts.browser) {
          console.error(`  Opening ${url}`);
          openBrowser(url);
        }
        console.error('');
        return;
      }

      // Spawn dashboard server
      const serverEntry = join(dashboardDir, 'dist-server', 'server', 'index.js');
      const hasBuild = existsSync(serverEntry)
        && existsSync(join(dashboardDir, 'dist', 'index.html'));

      const env = {
        ...process.env,
        PORT: String(port),
        HOST: host,
        WORKFLOW_ROOT: workflowRoot,
      };

      if (!hasBuild) {
        const tsEntry = join(dashboardDir, 'src', 'server', 'index.ts');
        if (!existsSync(tsEntry)) {
          console.error(`  Error: Dashboard not found at ${dashboardDir}`);
          console.error('  Run `cd dashboard && npm run build` first.');
          process.exit(1);
        }

        console.error(`  Starting dashboard (dev) on port ${port}...`);
        console.error(`  Workspace: ${workflowRoot}`);
        const child = spawn('npx', ['tsx', tsEntry], {
          cwd: dashboardDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
          shell: true,
        });
        child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
        child.stdout?.on('data', (d: Buffer) => process.stderr.write(d));
        child.unref();
      } else {
        console.error(`  Starting dashboard on port ${port}...`);
        console.error(`  Workspace: ${workflowRoot}`);
        const child = spawn(process.execPath, [serverEntry], {
          cwd: dashboardDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
        child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
        child.stdout?.on('data', (d: Buffer) => process.stderr.write(d));
        child.unref();
      }

      const ready = await waitForServer(host, port);
      if (!ready) {
        console.error('  Warning: Server did not respond in time.');
      }

      if (opts.browser) {
        console.error(`  Opening ${url}`);
        openBrowser(url);
      }

      console.error(`  Dashboard running at ${url}`);
      console.error('');
    });
}
