// ---------------------------------------------------------------------------
// `maestro brain` — outer-loop scheduling engine (the TS half of maestro-brain).
//
// Subcommands:
//   init         Create a brain session + ledger.json
//   derive       Print decision-input snapshot (cursor, stop eval, router signals)
//   decide       Run the A_DECIDE engine for a reconciled round-signal
//   review-plan  Enforce review tier (L2 floor) + reviewer != implementer
//   await        Suspend until a child session reaches a terminal state
//   status       Session summary
//
// Data contract: `.workflow/.brain/brain-*/ledger.json`. Mirrors `maestro ralph`.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';

// Lazy module loaders — keep cold start cheap and isolate brain-only deps.
async function loadInitCmd() {
  return (await import('../brain/cmd-brain.js')).runInit;
}
async function loadDeriveCmd() {
  return (await import('../brain/cmd-brain.js')).runDerive;
}
async function loadDecideCmd() {
  return (await import('../brain/cmd-brain.js')).runDecide;
}
async function loadReviewPlanCmd() {
  return (await import('../brain/cmd-brain.js')).runReviewPlan;
}
async function loadAwaitCmd() {
  return (await import('../brain/cmd-brain.js')).runAwait;
}
async function loadStatusCmd() {
  return (await import('../brain/cmd-brain.js')).runStatus;
}

export function registerBrainCommand(program: Command): void {
  const brain = program
    .command('brain')
    .description('maestro-brain outer-loop engine (state-derive / stop-predicate / decide)');

  // ── init ──────────────────────────────────────────────────────────────────
  brain
    .command('init <intent>')
    .description('Create a brain session + ledger.json')
    .option('-y, --yes', 'Autonomous mode (no human escalation; full-chain + continue)')
    .option('--max-rounds <n>', 'Safety backstop round cap (default 30)')
    .action(async (intent: string, opts: { yes?: boolean; maxRounds?: string }) => {
      const maxRounds = opts.maxRounds != null ? Number.parseInt(opts.maxRounds, 10) : undefined;
      if (maxRounds != null && (!Number.isFinite(maxRounds) || maxRounds < 1)) {
        console.error('[brain init] --max-rounds must be an integer >= 1');
        process.exit(2);
      }
      const run = await loadInitCmd();
      process.exit(run({ intent, autonomous: !!opts.yes, maxRounds }));
    });

  // ── derive ────────────────────────────────────────────────────────────────
  brain
    .command('derive')
    .description('Print the per-round decision inputs (cursor, stop predicate, router signals)')
    .option('--session <id>', 'Brain session id (default: latest)')
    .option('--json', 'Machine-readable output')
    .action(async (opts: { session?: string; json?: boolean }) => {
      const run = await loadDeriveCmd();
      process.exit(run({ sessionId: opts.session, json: !!opts.json }));
    });

  // ── decide ────────────────────────────────────────────────────────────────
  brain
    .command('decide')
    .description('Run A_DECIDE for a reconciled round signal')
    .option('--session <id>', 'Brain session id (default: latest)')
    .option('--signal <s>', 'ok | result-problem | roadmap-problem:<issue> | unfixable-external', 'ok')
    .option('--commit', 'Persist: apply the convergence bump + append the round to the ledger')
    .option('--json', 'Machine-readable output')
    .action(async (opts: { session?: string; signal?: string; commit?: boolean; json?: boolean }) => {
      const run = await loadDecideCmd();
      process.exit(run({ sessionId: opts.session, signal: opts.signal, commit: !!opts.commit, json: !!opts.json }));
    });

  // ── review-plan ─────────────────────────────────────────────────────────────
  brain
    .command('review-plan')
    .description('Enforce review tier (invariant#7 L2-floor) + reviewer!=implementer (invariant#4)')
    .option('--difficulty <d>', 'trivial | normal | hard', 'normal')
    .option('--self-reported', 'child self-reported success')
    .option('--code-changed', 'the round changed code')
    .option('--critical', 'critical path / low confidence / auto hard-signal')
    .option('--tier <t>', 'force L1|L2|L3 (still honors the L2 floor)')
    .option('--impl-cli <c>', 'the implementer CLI', 'claude')
    .option('--clis <list>', 'comma-separated available CLIs', 'claude')
    .option('--json', 'Machine-readable output')
    .action(async (opts: { difficulty?: string; selfReported?: boolean; codeChanged?: boolean; critical?: boolean; tier?: string; implCli?: string; clis?: string; json?: boolean }) => {
      const run = await loadReviewPlanCmd();
      const code = await run({
        difficulty: (opts.difficulty as 'trivial' | 'normal' | 'hard') ?? 'normal',
        selfReported: !!opts.selfReported, codeChanged: !!opts.codeChanged, critical: !!opts.critical,
        forcedTier: opts.tier as ('L1' | 'L2' | 'L3' | undefined),
        implCli: opts.implCli ?? 'claude', clis: (opts.clis ?? 'claude').split(',').map(s => s.trim()).filter(Boolean),
        json: !!opts.json,
      });
      process.exit(code);
    });

  // ── await ───────────────────────────────────────────────────────────────────
  brain
    .command('await <statusPath>')
    .description('SUSPEND until a child ralph/odyssey session reaches a terminal state (event-driven)')
    .requiredOption('--kind <kind>', 'ralph | odyssey')
    .option('--timeout-min <n>', 'Hard deadline in minutes (default 10)')
    .option('--json', 'Machine-readable output')
    .action(async (statusPath: string, opts: { kind: string; timeoutMin?: string; json?: boolean }) => {
      if (opts.kind !== 'ralph' && opts.kind !== 'odyssey') {
        console.error('[brain await] --kind must be ralph | odyssey');
        process.exit(2);
      }
      const timeoutMin = opts.timeoutMin != null ? Number.parseInt(opts.timeoutMin, 10) : undefined;
      const run = await loadAwaitCmd();
      const code = await run({ statusPath, kind: opts.kind, timeoutMin, json: !!opts.json });
      process.exit(code);
    });

  // ── status ──────────────────────────────────────────────────────────────────
  brain
    .command('status')
    .description('Brain session summary')
    .option('--session <id>', 'Brain session id (default: latest)')
    .action(async (opts: { session?: string }) => {
      const run = await loadStatusCmd();
      process.exit(run({ sessionId: opts.session }));
    });
}
