// ---------------------------------------------------------------------------
// `maestro ralph check` — health-check ralph session state.
// Now operates on standard `.workflow/sessions/` session.json + ralph-meta.json.
// Exit code: 0 if no E findings, 1 otherwise.
// ---------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolveRalphSession, workflowRoot, readMeta } from './session-adapter.js';
import { resolveStepContent } from '../run/contract.js';

export interface CheckCmdOptions {
  sessionId?: string;
  json?: boolean;
}

export interface CheckFinding {
  level: 'E' | 'W';
  code: string;
  message: string;
  step_index?: number;
}

export async function runCheck(opts: CheckCmdOptions): Promise<number> {
  const projectRoot = workflowRoot();
  const resolved = resolveRalphSession(projectRoot, opts.sessionId);
  if (!resolved) {
    const msg = opts.sessionId
      ? `[ralph check] session not found: ${opts.sessionId}`
      : '[ralph check] no ralph sessions found in .workflow/sessions/';
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
    } else {
      console.error(msg);
    }
    return 1;
  }

  const { sessionId, bundle, meta } = resolved;
  const session = bundle.session;
  const findings = checkSession(projectRoot, session, meta);
  const errors = findings.filter(f => f.level === 'E').length;
  const warnings = findings.filter(f => f.level === 'W').length;

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: errors === 0,
      session_id: sessionId,
      errors, warnings,
      findings,
    }, null, 2) + '\n');
    return errors === 0 ? 0 : 1;
  }

  console.log(`session: ${sessionId}`);
  console.log(`status:  ${session.status}`);
  console.log(`engine:  ${session.orchestration.engine}`);
  console.log(`chain:   ${session.orchestration.chain.length} steps`);
  console.log('');

  if (findings.length === 0) {
    console.log('  ✓ no issues found');
  } else {
    for (const f of findings) {
      const loc = f.step_index !== undefined ? ` [step ${f.step_index}]` : '';
      console.log(`  ${f.level === 'E' ? '✗' : '!'} ${f.code}${loc}: ${f.message}`);
    }
  }
  console.log('');
  console.log(`  summary: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);

  return errors === 0 ? 0 : 1;
}

function checkSession(
  projectRoot: string,
  session: import('../run/schemas.js').SessionState,
  meta: import('./session-adapter.js').RalphMeta,
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const chain = session.orchestration.chain;

  // 1. Engine must be 'ralph'
  if (session.orchestration.engine !== 'ralph') {
    findings.push({ level: 'W', code: 'W001', message: `engine is "${session.orchestration.engine}", expected "ralph"` });
  }

  // 2. Chain step consistency
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];

    // Verify step_id format
    if (!step.step_id) {
      findings.push({ level: 'E', code: 'E010', message: 'step has empty step_id', step_index: i });
    }

    // Verify command has content
    if (!step.decision_ref) {
      const content = resolveStepContent(projectRoot, step.command);
      if (!content.prepare && !content.workflow) {
        findings.push({
          level: 'E', code: 'E006',
          message: `command "${step.command}" has no prepare or workflow content`,
          step_index: i,
        });
      }
    }

    // Verify running step has run_id
    if (step.status === 'running' && !step.run_id) {
      findings.push({
        level: 'W', code: 'W005',
        message: 'step is running but has no run_id',
        step_index: i,
      });
    }

    // Verify completed step has details in meta
    if (step.status === 'completed' || step.status === 'sealed') {
      const detail = meta.step_details?.[step.step_id];
      if (!detail?.completion_summary) {
        findings.push({
          level: 'W', code: 'W006',
          message: 'completed step has no completion_summary in ralph-meta',
          step_index: i,
        });
      }
    }
  }

  // 3. Multiple running steps (should be at most 1)
  const runningSteps = chain.filter(s => s.status === 'running');
  if (runningSteps.length > 1) {
    findings.push({
      level: 'E', code: 'E008',
      message: `${runningSteps.length} steps are running simultaneously (expected ≤1)`,
    });
  }

  // 4. Decision points have matching chain entries
  for (const dp of session.orchestration.decision_points) {
    const hasChainEntry = chain.some(s => s.decision_ref === dp.point_id);
    if (!hasChainEntry) {
      findings.push({
        level: 'W', code: 'W008',
        message: `decision point "${dp.point_id}" has no matching chain step`,
      });
    }
  }

  return findings;
}

export function hasErrors(findings: CheckFinding[]): boolean {
  return findings.some(f => f.level === 'E');
}
