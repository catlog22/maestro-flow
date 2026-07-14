// ---------------------------------------------------------------------------
// `maestro ralph session` — show current ralph session summary.
// Now reads from standard `.workflow/sessions/` + ralph-meta.json.
// ---------------------------------------------------------------------------

import {
  resolveRalphSession,
  activeStepIndex,
  workflowRoot,
} from './session-adapter.js';

export interface SessionCmdOptions {
  sessionId?: string;
}

export async function runSession(opts: SessionCmdOptions): Promise<number> {
  const projectRoot = workflowRoot();
  const resolved = resolveRalphSession(projectRoot, opts.sessionId);
  if (!resolved) {
    if (opts.sessionId) {
      console.error(`[ralph session] not found: ${opts.sessionId}`);
    } else {
      console.error('[ralph session] no ralph sessions found in .workflow/sessions/');
      console.error('                use /maestro-ralph "<intent>" to create one');
    }
    return 1;
  }

  const { sessionId, bundle, meta } = resolved;
  const session = bundle.session;
  const chain = session.orchestration.chain;
  const completed = chain.filter(s => s.status === 'completed' || s.status === 'sealed').length;
  const total = chain.length;
  const active = activeStepIndex(session);

  console.log(`session:           ${sessionId}`);
  console.log(`status:            ${session.status}`);
  console.log(`engine:            ${session.orchestration.engine}`);
  console.log(`lifecycle:         ${meta.lifecycle_position}`);
  console.log(`phase:             ${meta.phase ?? '(n/a)'}${meta.phase_is_new ? ' (new)' : ''}`);
  console.log(`milestone:         ${meta.milestone || '(n/a)'}`);
  console.log(`quality_mode:      ${session.orchestration.quality_mode}`);
  console.log(`planning_mode:     ${meta.planning_mode ?? '(n/a)'}`);
  console.log(`progress:          ${completed}/${total}`);
  console.log(`active_step:       ${active === null ? '(idle)' : active}`);

  if (active !== null) {
    const step = chain[active];
    const detail = meta.step_details?.[step.step_id];
    console.log('');
    console.log(`  ▸ step ${active}: ${step.decision_ref ? `◆ ${step.decision_ref}` : step.command}`);
    console.log(`    status:  ${step.status}`);
    if (step.run_id) console.log(`    run_id:  ${step.run_id}`);
    if (detail?.stage) console.log(`    stage:   ${detail.stage}`);
  }

  if (meta.task_decomposition && meta.task_decomposition.length > 0) {
    const done = meta.task_decomposition.filter(g => g.status === 'done').length;
    console.log('');
    console.log(`  sub-goals: ${done}/${meta.task_decomposition.length}`);
    for (const g of meta.task_decomposition) {
      const mark = g.status === 'done' ? '[x]' : '[ ]';
      console.log(`    ${mark} ${g.id}: ${g.goal}`);
    }
  }

  return 0;
}
