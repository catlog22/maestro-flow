// ---------------------------------------------------------------------------
// `maestro ralph session` — show current ralph session summary.
// ---------------------------------------------------------------------------

import { resolveSession, workflowRoot } from './status-store.js';

export interface SessionCmdOptions {
  sessionId?: string;
}

export async function runSession(opts: SessionCmdOptions): Promise<number> {
  const resolved = resolveSession(workflowRoot(), opts.sessionId);
  if (!resolved) {
    if (opts.sessionId) {
      console.error(`[ralph session] not found: ${opts.sessionId}`);
    } else {
      console.error('[ralph session] no maestro-* / ralph-* sessions found in .workflow/.maestro/');
      console.error('                use /maestro "<intent>" or /maestro-ralph "<intent>" to create one');
    }
    return 1;
  }

  const s = resolved.data;
  const completed = s.steps.filter(x => x.status === 'completed').length;
  const total = s.steps.length;
  const active = s.active_step_index;

  console.log(`session:           ${resolved.sessionId}`);
  console.log(`status:            ${s.status}`);
  console.log(`lifecycle:         ${s.lifecycle_position}`);
  console.log(`phase:             ${s.phase ?? '(n/a)'}${s.phase_is_new ? ' (new)' : ''}`);
  console.log(`milestone:         ${s.milestone || '(n/a)'}`);
  console.log(`quality_mode:      ${s.quality_mode ?? '(n/a)'}`);
  console.log(`planning_mode:     ${s.planning_mode ?? '(n/a)'}`);
  console.log(`protocol_version:  ${s.ralph_protocol_version ?? '0 (legacy)'}`);
  console.log(`progress:          ${completed}/${total}`);
  console.log(`active_step_index: ${active === null || active === undefined ? '(idle)' : active}`);

  if (active !== null && active !== undefined && s.steps[active]) {
    const step = s.steps[active];
    console.log('');
    console.log(`  ▸ step ${active}: ${step.decision ? `◆ ${step.decision}` : step.skill}`);
    console.log(`    status:  ${step.status}`);
    if (step.command_path) console.log(`    command: ${step.command_path}`);
    if (step.load?.loaded_at) console.log(`    loaded:  ${step.load.loaded_at} (req: ${step.load.required_files.length}, def: ${step.load.deferred_files.length})`);
  }

  if (s.task_decomposition && s.task_decomposition.length > 0) {
    const done = s.task_decomposition.filter(g => g.status === 'done').length;
    console.log('');
    console.log(`  sub-goals: ${done}/${s.task_decomposition.length}`);
    for (const g of s.task_decomposition) {
      const mark = g.status === 'done' ? '[x]' : '[ ]';
      console.log(`    ${mark} ${g.id}: ${g.goal}`);
    }
  }

  return 0;
}
