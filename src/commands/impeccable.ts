/**
 * Impeccable Command — CLI for design tool utilities.
 *
 * Subcommands: load-context, detect-csp, search,
 * critique (slug|write|latest|trend),
 * live, live-server, live-poll, live-inject, live-wrap, live-accept,
 * live-complete, live-resume, live-status
 */

import type { Command } from 'commander';

export function registerImpeccableCommand(program: Command): void {
  const cmd = program
    .command('impeccable')
    .description('Impeccable design tool utilities');

  // ── load-context ────────────────────────────────────────────────────
  cmd
    .command('load-context')
    .description('Load PRODUCT.md and DESIGN.md context')
    .action(async () => {
      const { loadContext } = await import('../tools/impeccable/load-context.js');
      const result = loadContext(process.cwd());
      console.log(JSON.stringify(result, null, 2));
    });

  // ── detect-csp ──────────────────────────────────────────────────────
  cmd
    .command('detect-csp')
    .description('Detect Content-Security-Policy signals in project')
    .action(async () => {
      const { detectCsp } = await import('../tools/impeccable/detect-csp.js');
      const result = detectCsp(process.cwd());
      console.log(JSON.stringify(result, null, 2));
    });

  // ── search ──────────────────────────────────────────────────────────
  cmd
    .command('search <query>')
    .description('Search UI/UX design knowledge base (BM25 + CSV)')
    .option('-d, --domain <domain>', 'Search domain (style|color|chart|landing|product|ux|typography|icons|react|web|google-fonts)')
    .option('-s, --stack <stack>', 'Stack-specific search (react|nextjs|vue|svelte|astro|swiftui|react-native|flutter|html-tailwind|shadcn)')
    .option('-n, --max-results <n>', 'Max results (default: 3)')
    .option('--design-system', 'Generate complete design system recommendation')
    .option('-p, --project-name <name>', 'Project name for design system output')
    .option('-f, --format <fmt>', 'Output format: ascii|markdown (default: ascii)')
    .option('--persist', 'Save design system to MASTER.md')
    .option('--page <page>', 'Page-specific override file')
    .option('-o, --output-dir <dir>', 'Output directory for persisted files')
    .action(async (query: string, opts: Record<string, string | boolean | undefined>) => {
      const { spawnSync } = await import('node:child_process');
      const { resolve, join } = await import('node:path');
      const { existsSync } = await import('node:fs');

      // Resolve script path: project-local → installed
      const candidates = [
        resolve(process.cwd(), 'workflows/impeccable/ui-search/search.py'),
        join(process.env.HOME || process.env.USERPROFILE || '', '.maestro/workflows/impeccable/ui-search/search.py'),
      ];
      const scriptPath = candidates.find(p => existsSync(p));
      if (!scriptPath) {
        process.stderr.write('ui-search scripts not found. Expected at workflows/impeccable/ui-search/search.py\n');
        process.exit(1);
      }

      // Resolve Python binary
      const pythonBin = ['python', 'python3'].find(bin => {
        const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'pipe', shell: true });
        return r.status === 0;
      });
      if (!pythonBin) {
        process.stderr.write('Python not found. Install Python 3 to use ui-search.\n');
        process.exit(1);
      }

      // Build args
      const args = [scriptPath, query];
      if (opts.domain) { args.push('-d', String(opts.domain)); }
      if (opts.stack) { args.push('-s', String(opts.stack)); }
      if (opts.maxResults) { args.push('-n', String(opts.maxResults)); }
      if (opts.designSystem) { args.push('--design-system'); }
      if (opts.projectName) { args.push('-p', String(opts.projectName)); }
      if (opts.format) { args.push('-f', String(opts.format)); }
      if (opts.persist) { args.push('--persist'); }
      if (opts.page) { args.push('--page', String(opts.page)); }
      if (opts.outputDir) { args.push('-o', String(opts.outputDir)); }

      const result = spawnSync(pythonBin, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      if (result.stdout) { process.stdout.write(result.stdout); }
      if (result.stderr) { process.stderr.write(result.stderr); }
      process.exit(result.status ?? 1);
    });

  // ── critique ────────────────────────────────────────────────────────
  const critique = cmd
    .command('critique')
    .description('Critique snapshot persistence');

  critique
    .command('slug <target>')
    .description('Derive a stable slug from a resolved target')
    .action(async (target: string) => {
      const { slugFromTarget } = await import('../tools/impeccable/critique-storage.js');
      const slug = slugFromTarget(target);
      if (!slug) { process.stderr.write('no stable slug for input\n'); process.exit(1); }
      process.stdout.write(`${slug}\n`);
    });

  critique
    .command('write <slug> [bodyFile]')
    .description('Write a critique snapshot')
    .action(async (slug: string, bodyFile?: string) => {
      const { writeSnapshot } = await import('../tools/impeccable/critique-storage.js');
      const { readFileSync } = await import('node:fs');
      const raw = bodyFile ? readFileSync(bodyFile, 'utf-8') : '';
      let meta: Record<string, unknown> = {};
      const metaArg = process.env.IMPECCABLE_CRITIQUE_META;
      if (metaArg) {
        try { meta = JSON.parse(metaArg); } catch { /* ignore */ }
      }
      const out = writeSnapshot({ slug, meta: meta as import('../tools/impeccable/critique-storage.js').SnapshotMeta, body: raw });
      process.stdout.write(`${out}\n`);
    });

  critique
    .command('latest <slug>')
    .description('Read the latest critique snapshot')
    .action(async (slug: string) => {
      const { readLatestSnapshot } = await import('../tools/impeccable/critique-storage.js');
      const latest = readLatestSnapshot(slug);
      if (!latest) { process.exit(2); }
      process.stdout.write(latest.body);
    });

  critique
    .command('trend <slug> [limit]')
    .description('Read trend data for a slug')
    .action(async (slug: string, limit?: string) => {
      const { readTrend } = await import('../tools/impeccable/critique-storage.js');
      const rows = readTrend(slug, { limit: limit ? Number(limit) : 5 });
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    });

  // ── live ────────────────────────────────────────────────────────────
  cmd
    .command('live')
    .description('Bootstrap live variant mode')
    .action(async () => {
      const { bootstrapCli } = await import('../tools/impeccable/live/bootstrap.js');
      await bootstrapCli();
    });

  // ── live-server ─────────────────────────────────────────────────────
  cmd
    .command('live-server [action]')
    .description('Start/stop live mode server (action: start|stop)')
    .option('--background', 'Start detached, print JSON, exit')
    .option('--port <port>', 'Use specific port')
    .action(async (action?: string, opts?: { background?: boolean; port?: string }) => {
      const { serverCli } = await import('../tools/impeccable/live/server.js');
      await serverCli(action, opts);
    });

  // ── live-poll ───────────────────────────────────────────────────────
  cmd
    .command('live-poll')
    .description('Agent poll client for live mode')
    .option('--timeout <ms>', 'Custom timeout', '600000')
    .option('--reply <id>', 'Reply to event ID')
    .option('--status <status>', 'Reply status (done|error)')
    .option('--message <msg>', 'Reply message')
    .action(async (opts) => {
      const { pollCli } = await import('../tools/impeccable/live/poll.js');
      await pollCli(opts);
    });

  // ── live-inject ─────────────────────────────────────────────────────
  cmd
    .command('live-inject')
    .description('Inject/remove live mode script tag')
    .option('--port <port>', 'Insert script tag at given port')
    .option('--remove', 'Remove the script tag')
    .option('--check', 'Check if config exists and is valid')
    .action(async (opts) => {
      const { injectCli } = await import('../tools/impeccable/live/inject.js');
      await injectCli(opts);
    });

  // ── live-wrap ───────────────────────────────────────────────────────
  cmd
    .command('live-wrap')
    .description('Wrap element with variant scaffolding')
    .requiredOption('--id <id>', 'Session ID')
    .requiredOption('--count <n>', 'Number of variants', (v) => parseInt(v, 10))
    .option('--element-id <id>', 'HTML id attribute')
    .option('--classes <classes>', 'Comma-separated CSS class names')
    .option('--tag <tag>', 'Tag name')
    .option('--query <text>', 'Raw text fallback')
    .option('--file <path>', 'Explicit source file')
    .option('--text <text>', 'Picked element textContent')
    .action(async (opts) => {
      const { wrapCli } = await import('../tools/impeccable/live/wrap.js');
      await wrapCli(opts);
    });

  // ── live-accept ─────────────────────────────────────────────────────
  cmd
    .command('live-accept')
    .description('Accept/discard variant session')
    .requiredOption('--id <id>', 'Session ID')
    .option('--variant <n>', 'Accept variant N', (v) => parseInt(v, 10))
    .option('--discard', 'Remove variants, restore original')
    .option('--param-values <json>', 'User knob positions for carbonize cleanup')
    .action(async (opts) => {
      const { acceptCli } = await import('../tools/impeccable/live/accept.js');
      await acceptCli(opts);
    });

  // ── live-complete ───────────────────────────────────────────────────
  cmd
    .command('live-complete')
    .description('Mark session as complete')
    .requiredOption('--id <id>', 'Session ID')
    .option('--discarded', 'Mark session as discarded')
    .option('--error [message]', 'Mark session as agent error')
    .action(async (opts) => {
      const { completeCli } = await import('../tools/impeccable/live/complete.js');
      await completeCli(opts);
    });

  // ── live-resume ─────────────────────────────────────────────────────
  cmd
    .command('live-resume')
    .description('Recover next agent action from session journal')
    .option('--id <id>', 'Session ID')
    .action(async (opts) => {
      const { resumeCli } = await import('../tools/impeccable/live/resume.js');
      await resumeCli(opts);
    });

  // ── live-status ─────────────────────────────────────────────────────
  cmd
    .command('live-status')
    .description('Show live mode status')
    .action(async () => {
      const { statusCli } = await import('../tools/impeccable/live/status.js');
      await statusCli();
    });
}
