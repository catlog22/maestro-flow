/**
 * CLI entry point: prepare everything needed to enter the live variant poll loop.
 *
 * Does (all in one command):
 *   1. Check .impeccable/live/config.json (returns config_missing if first-ever run)
 *   2. Start the live server in the background (or reuse a running one)
 *   3. Inject the browser script tag into the project's entry file
 *   4. Read PRODUCT.md / DESIGN.md for project context
 *   5. Print a single JSON blob with everything the agent needs
 *
 * After this, the agent's only remaining steps are:
 *   - Open the project's live dev/preview URL in the browser (optional)
 *   - Enter the poll loop: maestro impeccable live-poll
 *
 * Converted from live.mjs to TypeScript.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadContext } from '../load-context.js';
import { readLiveServerInfo } from '../paths.js';
import { injectCli, resolveFiles } from './inject.js';
import type { LiveConfig } from './inject.js';

// ---------------------------------------------------------------------------
// Drift-heal scan
// ---------------------------------------------------------------------------

const SCAN_ROOTS = ['public', 'src', 'app', 'pages'];
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.astro',
  '.turbo', '.vercel', '.cache', 'coverage', 'dist', 'build',
]);

interface DriftResult {
  orphans: string[];
  orphanCount: number;
  hint: string;
}

function scanForDrift(rootDir: string, resolvedFiles: string[], config: LiveConfig): DriftResult | null {
  const resolvedSet = new Set(resolvedFiles.map((f) => f.split(path.sep).join('/')));

  // Files matching the user's `exclude` globs are intentional omissions,
  // not drift. Compile them to regexes so the orphan list stays signal.
  const userExcludeRegexes = (Array.isArray(config.exclude) ? config.exclude : [])
    .map((p: string) => globToRegex(p));
  const isUserExcluded = (rel: string) => userExcludeRegexes.some((re: RegExp) => re.test(rel));

  const orphans: string[] = [];

  const walk = (dir: string, relBase: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), rel);
      } else if (e.isFile() && e.name.endsWith('.html')) {
        if (resolvedSet.has(rel)) continue;
        if (isUserExcluded(rel)) continue;
        orphans.push(rel);
      }
    }
  };

  for (const root of SCAN_ROOTS) {
    const abs = path.join(rootDir, root);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      walk(abs, root);
    }
  }

  if (orphans.length === 0) return null;
  const capped = orphans.slice(0, 20);
  return {
    orphans: capped,
    orphanCount: orphans.length,
    hint: `${orphans.length} HTML file(s) exist but aren't in config.files. Consider adding them, or use a glob pattern like "public/**/*.html".`,
  };
}

/**
 * Same glob-to-regex mapping used by inject.ts. Kept inline here
 * to avoid circular imports. The two must stay in sync.
 */
function globToRegex(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 3; }
        else { re += '.*'; i += 2; }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse(out: string): Record<string, unknown> | null {
  try { return JSON.parse(String(out).trim()); } catch { return null; }
}

interface ServerInfo {
  pid: number;
  port: number;
  token: string;
}

/**
 * Return server info for the running live server, starting one if needed.
 */
async function ensureServerRunning(): Promise<ServerInfo | null> {
  // Try to reuse an existing server
  try {
    const record = readLiveServerInfo(process.cwd());
    const existing = record?.info;
    if (existing && existing.pid) {
      try {
        process.kill(existing.pid, 0); // throws if dead
        return existing;
      } catch { /* stale PID file — the server script will clean it up */ }
    }
  } catch { /* no PID file */ }

  // Start a new server via serverCli in background mode
  try {
    const { serverCli } = await import('./server.js');

    // Capture output by temporarily replacing console.log
    let captured = '';
    const origLog = console.log;
    console.log = (...args: unknown[]) => { captured += args.map(String).join(' ') + '\n'; };

    try {
      await serverCli(undefined, { background: true });
    } catch {
      // background mode spawns a child and exits; errors are printed to stderr
    }

    console.log = origLog;

    const parsed = safeParse(captured.trim());
    if (parsed && parsed.port && parsed.token) {
      return parsed as unknown as ServerInfo;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function bootstrapCli(): Promise<void> {
  // 1. Check config (fail fast if missing — no point starting anything else)
  let checkResult: Record<string, unknown> | null = null;

  // Capture injectCli --check output
  let checkCaptured = '';
  const origLog = console.log;
  console.log = (...args: unknown[]) => { checkCaptured += args.map(String).join(' '); };
  try {
    await injectCli({ check: true });
  } catch {
    // injectCli may exit(1) for missing config — that's expected
  }
  console.log = origLog;
  checkResult = safeParse(checkCaptured);

  if (!checkResult || !checkResult.ok) {
    console.log(JSON.stringify(checkResult || { ok: false, error: 'check_failed', raw: checkCaptured }));
    process.exit(0);
  }

  // 2. Start server (or reuse existing)
  const serverInfo = await ensureServerRunning();
  if (!serverInfo) {
    console.log(JSON.stringify({ ok: false, error: 'server_start_failed' }));
    process.exit(1);
  }

  // 3. Inject the script tag at the current port
  let injectCaptured = '';
  console.log = (...args: unknown[]) => { injectCaptured += args.map(String).join(' '); };
  try {
    await injectCli({ port: String(serverInfo.port) });
  } catch {
    // injectCli exits(1) on failure
  }
  console.log = origLog;

  const injectResult = safeParse(injectCaptured);
  if (!injectResult || !injectResult.ok) {
    console.log(JSON.stringify({
      ok: false,
      error: 'inject_failed',
      detail: injectResult || injectCaptured,
      serverPort: serverInfo.port,
    }));
    process.exit(1);
  }

  // 4. Load PRODUCT.md + DESIGN.md context (auto-migrates legacy .impeccable.md)
  const ctx = loadContext(process.cwd());

  // 5. Compute drift-heal: compare resolved inject targets against the
  //    project's HTML files. Orphans are HTML files not covered by config.
  //    Warning only — the agent decides whether to act.
  const config = checkResult.config as LiveConfig;
  const resolvedFiles = resolveFiles(process.cwd(), config);
  const drift = scanForDrift(process.cwd(), resolvedFiles, config);

  // 6. Emit everything the agent needs
  console.log(JSON.stringify({
    ok: true,
    serverPort: serverInfo.port,
    serverToken: serverInfo.token,
    pageFiles: resolvedFiles,
    configDrift: drift,
    hasProduct: ctx.hasProduct,
    product: ctx.product,
    productPath: ctx.productPath,
    hasDesign: ctx.hasDesign,
    design: ctx.design,
    designPath: ctx.designPath,
    migrated: ctx.migrated,
  }, null, 2));
}
