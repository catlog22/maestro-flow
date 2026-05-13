/**
 * Impeccable Command — CLI for design tool utilities.
 *
 * Subcommands: load-context, detect-csp, critique (slug|write|latest|trend),
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
