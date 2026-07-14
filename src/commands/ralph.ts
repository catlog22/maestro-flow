// ---------------------------------------------------------------------------
// `maestro ralph` — Ralph step loader & standard session driver.
//
// Subcommands:
//   skills     List effective commands + skills (global + project, project wins)
//   check      Run health check against current ralph session
//   session    Show current ralph session summary
//   next       Load next pending step, create standard Run, print prompt
//   complete   Mark current step done / concerns / retry / blocked
//   retry      Sugar for `complete <idx> --status NEEDS_RETRY`
//   ledger     Verification ledger interface
//
// Data contract: drives `.workflow/sessions/{id}/session.json` (engine=ralph)
//                + `ralph-meta.json` for orchestration extensions.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';

// Lazy module loader — keeps cold start cheap and isolates ralph-only deps.
async function loadSkillsCmd() {
  return (await import('../ralph/cmd-skills.js')).runSkills;
}
async function loadCheckCmd() {
  return (await import('../ralph/cmd-check.js')).runCheck;
}
async function loadSessionCmd() {
  return (await import('../ralph/cmd-session.js')).runSession;
}
async function loadNextCmd() {
  return (await import('../ralph/cmd-next.js')).runNext;
}
async function loadCompleteCmd() {
  return (await import('../ralph/cmd-complete.js')).runComplete;
}
async function loadLedgerCmd() {
  return (await import('../ralph/cmd-ledger.js')).runLedger;
}

const VALID_STATUSES = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_RETRY', 'BLOCKED'] as const;
export type RalphCompletionStatus = typeof VALID_STATUSES[number];

export function registerRalphCommand(program: Command): void {
  const ralph = program
    .command('ralph')
    .description('Ralph step loader & standard session driver');

  // ── skills ──────────────────────────────────────────────────────────────
  ralph
    .command('skills')
    .description('List effective commands + skills (project overrides global)')
    .option('--json', 'Machine-readable output (single JSON line per entry)')
    .option('--quiet', 'Suppress decorative output (for ralph build consumption)')
    .option('--platform <platform>', 'Filter by platform: claude | codex | agent | agy (recommended)')
    .action(async (opts: { json?: boolean; quiet?: boolean; platform?: string }) => {
      const run = await loadSkillsCmd();
      const platform = opts.platform as ('claude' | 'codex' | 'agent' | 'agy' | undefined);
      const code = await run({ json: !!opts.json, quiet: !!opts.quiet, platform });
      process.exit(code);
    });

  // ── check ───────────────────────────────────────────────────────────────
  ralph
    .command('check')
    .description('Health-check the current ralph session')
    .option('--session <id>', 'Session id (default: latest ralph-engine session)')
    .option('--json', 'Output findings as JSON')
    .action(async (opts: { session?: string; json?: boolean }) => {
      const run = await loadCheckCmd();
      const code = await run({ sessionId: opts.session, json: !!opts.json });
      process.exit(code);
    });

  // ── session ─────────────────────────────────────────────────────────────
  ralph
    .command('session')
    .description('Show current ralph session summary')
    .option('--session <id>', 'Session id (default: latest ralph-engine session)')
    .action(async (opts: { session?: string }) => {
      const run = await loadSessionCmd();
      const code = await run({ sessionId: opts.session });
      process.exit(code);
    });

  // ── next ────────────────────────────────────────────────────────────────
  ralph
    .command('next')
    .description('Load next pending step, create standard Run, print prompt')
    .option('--session <id>', 'Session id (default: latest ralph-engine session)')
    .option('--execution-owner <owner>', 'Claim execution ownership')
    .option('--owner-epoch <epoch>', 'Epoch for lease ownership', Number.parseInt)
    .option('--lease-id <id>', 'Lease identifier for concurrency safety')
    .action(async (opts: { session?: string; executionOwner?: string; ownerEpoch?: number; leaseId?: string }) => {
      const run = await loadNextCmd();
      const code = await run({
        sessionId: opts.session,
        executionOwner: opts.executionOwner,
        ownerEpoch: opts.ownerEpoch,
        leaseId: opts.leaseId,
      });
      process.exit(code);
    });

  // ── complete ────────────────────────────────────────────────────────────
  ralph
    .command('complete <index>')
    .description('Mark step at <index> complete with a STATUS verdict')
    .requiredOption('--status <status>', `One of: ${VALID_STATUSES.join('|')}`)
    .option('--evidence <path>', 'Artifact path / output excerpt (repeatable)', collect, [] as string[])
    .option('--concerns <text>', 'Concerns text (with DONE_WITH_CONCERNS)')
    .option('--reason <text>', 'Reason (with BLOCKED)')
    .option('--summary <text>', 'One-sentence summary of what this step accomplished')
    .option('--decisions <text>', 'Key decision made (repeatable)', collect, [] as string[])
    .option('--caveats <text>', 'Warnings/notes for downstream steps')
    .option('--deferred <text>', 'Deferred work item (repeatable)', collect, [] as string[])
    .option('--session <id>', 'Session id (default: latest ralph-engine session)')
    .option('--execution-owner <owner>', 'Execution owner of the lease')
    .option('--owner-epoch <epoch>', 'Epoch of the lease owner', Number.parseInt)
    .option('--lease-id <id>', 'Lease ID for concurrency check')
    .option('--expected-skill <name>', 'Verify the active step runs this command name')
    .option('--expected-step-index <idx>', 'Verify the active step index', Number.parseInt)
    .action(async (indexArg: string, opts: {
      status: string;
      evidence: string[];
      concerns?: string;
      reason?: string;
      summary?: string;
      decisions?: string[];
      caveats?: string;
      deferred?: string[];
      session?: string;
      executionOwner?: string;
      ownerEpoch?: number;
      leaseId?: string;
      expectedSkill?: string;
      expectedStepIndex?: number;
    }) => {
      const status = opts.status.toUpperCase() as RalphCompletionStatus;
      if (!(VALID_STATUSES as readonly string[]).includes(status)) {
        console.error(`[ralph complete] --status must be one of: ${VALID_STATUSES.join(', ')} (got "${opts.status}")`);
        process.exit(2);
      }
      const index = Number.parseInt(indexArg, 10);
      if (!Number.isFinite(index) || index < 0) {
        console.error(`[ralph complete] <index> must be a non-negative integer (got "${indexArg}")`);
        process.exit(2);
      }
      const run = await loadCompleteCmd();
      const code = await run({
        sessionId: opts.session,
        index,
        status,
        evidence: opts.evidence,
        concerns: opts.concerns,
        reason: opts.reason,
        summary: opts.summary,
        decisions: opts.decisions,
        caveats: opts.caveats,
        deferred: opts.deferred,
        executionOwner: opts.executionOwner,
        ownerEpoch: opts.ownerEpoch,
        leaseId: opts.leaseId,
        expectedSkill: opts.expectedSkill,
        expectedStepIndex: opts.expectedStepIndex,
      });
      process.exit(code);
    });

  // ── retry ───────────────────────────────────────────────────────────────
  ralph
    .command('retry <index>')
    .description('Sugar: mark step at <index> as NEEDS_RETRY')
    .option('--session <id>', 'Session id (default: latest ralph-engine session)')
    .option('--execution-owner <owner>', 'Execution owner of the lease')
    .option('--owner-epoch <epoch>', 'Epoch of the lease owner', Number.parseInt)
    .option('--lease-id <id>', 'Lease ID for concurrency check')
    .action(async (indexArg: string, opts: {
      session?: string;
      executionOwner?: string;
      ownerEpoch?: number;
      leaseId?: string;
    }) => {
      const index = Number.parseInt(indexArg, 10);
      if (!Number.isFinite(index) || index < 0) {
        console.error(`[ralph retry] <index> must be a non-negative integer (got "${indexArg}")`);
        process.exit(2);
      }
      const run = await loadCompleteCmd();
      const code = await run({
        sessionId: opts.session,
        index,
        status: 'NEEDS_RETRY',
        evidence: [],
        executionOwner: opts.executionOwner,
        ownerEpoch: opts.ownerEpoch,
        leaseId: opts.leaseId,
      });
      process.exit(code);
    });

  // ── ledger ──────────────────────────────────────────────────────────────
  ralph
    .command('ledger')
    .description('Verification ledger interface for re-use and caching of verification findings')
    .option('--session <id>', 'Session id (required)')
    .option('--action <action>', 'Action: query | add')
    .option('--authority <auth>', 'Authority (e.g. "execute-gate", "drift-check")')
    .option('--dimension <dim>', 'Verification dimension (e.g. "quality", "structure")')
    .option('--subject <path>', 'Subject file paths or IDs (repeatable)', collect, [] as string[])
    .option('--verdict <ver>', 'Verdict (pass | fail | other)')
    .option('--confidence <conf>', 'Confidence (high | medium | low)', 'medium')
    .option('--concerns <txt>', 'Concerns text')
    .option('--risk-ceiling <risk>', 'Risk ceiling (low | medium | high)', 'low')
    .action(async (opts: {
      session?: string;
      action?: string;
      authority?: string;
      dimension?: string;
      subject?: string[];
      verdict?: string;
      confidence?: string;
      concerns?: string;
      riskCeiling?: string;
    }) => {
      if (!opts.session) {
        console.error('[ralph ledger] error: --session <id> is required');
        process.exit(2);
      }
      if (opts.action !== 'query' && opts.action !== 'add') {
        console.error('[ralph ledger] error: --action must be "query" or "add"');
        process.exit(2);
      }
      if (!opts.authority || !opts.dimension) {
        console.error('[ralph ledger] error: --authority and --dimension are required');
        process.exit(2);
      }
      const run = await loadLedgerCmd();
      const code = await run({
        sessionId: opts.session,
        action: opts.action as 'query' | 'add',
        authority: opts.authority,
        dimension: opts.dimension,
        subjects: opts.subject ?? [],
        verdict: opts.verdict,
        confidence: opts.confidence as 'high' | 'medium' | 'low',
        concerns: opts.concerns,
        riskCeiling: opts.riskCeiling as 'low' | 'medium' | 'high',
      });
      process.exit(code);
    });
}

function collect(value: string, prior: string[]): string[] {
  return prior.concat(value);
}
