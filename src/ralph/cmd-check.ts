// ---------------------------------------------------------------------------
// `maestro ralph check` — health-check ralph status.json.
// Exit code: 0 if no E findings, 1 otherwise.
// ---------------------------------------------------------------------------

import { resolveSession, workflowRoot } from './status-store.js';
import { checkStatus, summarize } from './status-checker.js';
import type { CheckFinding } from './status-schema.js';

export interface CheckCmdOptions {
  sessionId?: string;
  json?: boolean;
}

export async function runCheck(opts: CheckCmdOptions): Promise<number> {
  const resolved = resolveSession(workflowRoot(), opts.sessionId);
  if (!resolved) {
    const msg = opts.sessionId
      ? `[ralph check] session not found: ${opts.sessionId}`
      : '[ralph check] no maestro-* / ralph-* sessions found in .workflow/.maestro/';
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
    } else {
      console.error(msg);
    }
    return 1;
  }

  const findings = checkStatus(resolved.data);
  const { errors, warnings } = summarize(findings);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: errors === 0,
      session_id: resolved.sessionId,
      errors, warnings,
      findings,
    }, null, 2) + '\n');
    return errors === 0 ? 0 : 1;
  }

  console.log(`session: ${resolved.sessionId}`);
  console.log(`status:  ${resolved.data.status}`);
  console.log(`steps:   ${resolved.data.steps.length}`);
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

/** Convenience for internal callers (ralph next prelude). */
export function hasErrors(findings: CheckFinding[]): boolean {
  return findings.some(f => f.level === 'E');
}
