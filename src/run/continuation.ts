import { nextPendingDecisionIndex, nextPendingIndex } from './chain.js';
import {
  continuationDirectiveSchema,
  type ContinuationDirective,
} from './protocol-schemas.js';
import type { ReuseAssessment } from './reuse-assessment.js';
import {
  runV30ReadSchema,
  sessionStateV30ReadSchema,
  type CommandRun,
  type GateRegistry,
  type RunV30,
  type SessionState,
  type SessionStateV30,
} from './schemas.js';
import { SessionStore } from './store.js';
import { stableJsonUtf8 } from './transition-receipts.js';
import {
  v3BriefCommand,
  v3CheckNext,
  v3DecideNext,
  v3RunNext,
  v3SessionCompleteNext,
} from './v3/continuation-v3.js';

const SAFE_AUTO_REVIEW_REASONS = new Set(['QUALITY_MEDIUM']);

export interface InspectContinuationOptions {
  runId?: string | null;
}

export interface LifecycleNext {
  command: string | null;
  reason: string;
}

function acceptedReviewReceipt(
  session: SessionState,
  run: CommandRun,
  assessment: ReuseAssessment,
): boolean {
  return session.requests.some(item => {
    if (item.type !== 'transition' || !('outcome' in item)
      || item.outcome.operation !== 'accept-reuse' || item.outcome.status !== 'applied') return false;
    const acceptance = item.outcome.result.acceptance;
    if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)) return false;
    const raw = acceptance as Record<string, unknown>;
    return raw.run_id === run.run_id
      && raw.assessment_hash === assessment.assessment_hash
      && raw.artifact_id === assessment.source_fence.artifact_id
      && stableJsonUtf8(raw.source_fence) === stableJsonUtf8(assessment.source_fence);
  });
}

export function reuseAcceptanceStatus(
  session: SessionState,
  run: CommandRun,
  assessment: ReuseAssessment,
): NonNullable<ContinuationDirective['assessment']>['acceptance_status'] {
  if (assessment.decision === 'REUSE') return 'not_required';
  if (assessment.decision === 'REVIEW') {
    return acceptedReviewReceipt(session, run, assessment) ? 'accepted' : 'pending_review';
  }
  return 'invalidated';
}

function assessmentProjection(
  session: SessionState,
  run: CommandRun,
  assessment: ReuseAssessment,
): NonNullable<ContinuationDirective['assessment']> {
  return {
    assessment_hash: assessment.assessment_hash,
    artifact_id: assessment.source_fence.artifact_id,
    decision: assessment.decision,
    reason_codes: assessment.reason_codes,
    acceptance_status: reuseAcceptanceStatus(session, run, assessment),
  };
}

function safeAutoReview(assessment: ReuseAssessment): boolean {
  return assessment.decision === 'REVIEW'
    && assessment.reason_codes.length > 0
    && assessment.reason_codes.every(code => SAFE_AUTO_REVIEW_REASONS.has(code))
    && assessment.source_fence.producer_status === 'sealed'
    && assessment.source_fence.artifact_status === 'sealed'
    && assessment.source_fence.producer_run_hash !== null
    && assessment.source_fence.artifact_hash !== null
    && assessment.source_fence.observed_artifact_hash === assessment.source_fence.artifact_hash
    && assessment.source_fence.artifact_registry_revision !== null;
}

function recommendationsFor(store: SessionStore, session: SessionState): ContinuationDirective['recommendations'] {
  if (!session.latest_completed_run_id) return [];
  try {
    return store.readRun(session.session_id, session.latest_completed_run_id).handoff?.next ?? [];
  } catch {
    return [];
  }
}

function directive(
  session: SessionState,
  input: Omit<ContinuationDirective, 'schema_version' | 'auto_mode' | 'session_id'>,
): ContinuationDirective {
  return continuationDirectiveSchema.parse({
    schema_version: 'run-continuation/1.0',
    auto_mode: session.orchestration.auto_mode,
    session_id: session.session_id,
    ...input,
  });
}

function v3Directive(
  sessionId: string,
  input: Omit<ContinuationDirective, 'schema_version' | 'auto_mode' | 'session_id'>,
): ContinuationDirective {
  return continuationDirectiveSchema.parse({
    schema_version: 'run-continuation/1.0',
    auto_mode: false,
    session_id: sessionId,
    ...input,
  });
}

function unresolvedV3DecisionRef(session: SessionStateV30): string | null {
  for (const step of session.chain) {
    if (step.status !== 'completed' || step.decision_ref === null) continue;
    const decision = session.decisions.find(item => item.decision_id === step.decision_ref);
    if (!decision || decision.status === 'open' || decision.status === 'escalated') {
      return step.decision_ref;
    }
  }
  return null;
}

function readV30SessionReadonly(store: SessionStore, sessionId: string): SessionStateV30 {
  const record = store.readSessionRecordReadOnly(sessionId);
  if (record.schema_version !== 'session/3.0') {
    throw new Error(`Session ${sessionId} uses ${record.schema_version}; session/3.0 is required`);
  }
  const parsed = sessionStateV30ReadSchema.parse(record);
  return parsed.status === 'paused' ? { ...parsed, status: 'open' } : parsed as SessionStateV30;
}

function readV30RunReadonly(store: SessionStore, sessionId: string, runId: string): RunV30 {
  const run = store.readRunRecordReadOnly(sessionId, runId);
  if (run.schema_version !== 'run/3.0') {
    throw new Error(`Run ${runId} uses ${run.schema_version}; run/3.0 is required`);
  }
  return runV30ReadSchema.parse(run);
}

function inspectV3SessionContinuation(
  store: SessionStore,
  sessionId: string,
  options: InspectContinuationOptions,
): ContinuationDirective {
  const session = readV30SessionReadonly(store, sessionId);

  if (session.status === 'completed' || session.status === 'archived' || session.status === 'failed') {
    return v3Directive(sessionId, {
      action: 'stop',
      authority: 'user_required',
      reason_code: 'SESSION_TERMINAL',
      command: null,
      reason: `Session is ${session.status}; no lifecycle command may resume it`,
      preconditions: [],
      run_id: null,
      assessment: null,
      recommendations: [],
    });
  }

  const activeRunIds = [...new Set(session.active_run_ids)];
  const runId = options.runId ?? (activeRunIds.length === 1 ? activeRunIds[0] : null);

  if (options.runId || activeRunIds.length === 1) {
    const id = runId!;
    try {
      const run = readV30RunReadonly(store, sessionId, id);
      if (run.status === 'blocked' || run.status === 'failed') {
        const next = v3CheckNext({
          sessionId,
          runId: id,
          reason: 're-attach the same Run and repair its blocking condition; do not allocate a duplicate Run',
        });
        return v3Directive(sessionId, {
          action: 'repair_run',
          authority: 'automatic',
          reason_code: run.status === 'blocked' ? 'RUN_GATES_BLOCKING' : 'RUN_FAILED',
          command: next.next.command,
          reason: next.next.reason,
          preconditions: [
            `run_already_created=${id}`,
            'use only canonical v3 Session/Run locators',
            'do not call run create or allocate another Run',
          ],
          run_id: id,
          assessment: null,
          recommendations: [],
        });
      }
      if (run.status === 'running' || run.status === 'pending') {
        return v3Directive(sessionId, {
          action: 'load_run',
          authority: 'automatic',
          reason_code: 'RUN_ACTIVE',
          command: v3BriefCommand(sessionId, id),
          reason: 'load the active Run Resume Packet and continue its lifecycle',
          preconditions: [
            `run_already_created=${id}`,
            'load this exact Run brief before domain execution',
            'do not call run create or allocate another Run',
          ],
          run_id: id,
          assessment: null,
          recommendations: [],
        });
      }
    } catch {
      return v3Directive(sessionId, {
        action: 'stop',
        authority: 'user_required',
        reason_code: 'RUN_NOT_FOUND',
        command: `maestro session status --session ${sessionId} --json`,
        reason: `Session points at missing Run ${id}; authority must be repaired before continuing`,
        preconditions: ['re-read Session status', 'do not allocate a replacement Run implicitly'],
        run_id: id,
        assessment: null,
        recommendations: [],
      });
    }
  }

  if (activeRunIds.length > 1) {
    return v3Directive(sessionId, {
      action: 'stop',
      authority: 'user_required',
      reason_code: 'RUN_AMBIGUOUS',
      command: `maestro session resume-view --session ${sessionId} --json`,
      reason: `Session has multiple active Runs: ${[...activeRunIds].sort().join(', ')}`,
      preconditions: ['inspect session resume-view', 'choose one Run explicitly'],
      run_id: null,
      assessment: null,
      recommendations: [],
    });
  }

  const gateId = unresolvedV3DecisionRef(session);
  if (gateId) {
    const next = v3DecideNext({
      sessionId,
      pointId: gateId,
      orchestrationRevision: session.orchestration_revision,
      reason: 'the next chain node is a decision; evaluate it without allocating a Run',
    });
    return v3Directive(sessionId, {
      action: 'evaluate_decision',
      authority: 'automatic',
      reason_code: 'DECISION_REQUIRED',
      command: next.next.command,
      reason: next.next.reason,
      preconditions: [
        `decision_point=${gateId}`,
        'decision remains pending',
        'do not allocate an execution Run for a decision node',
      ],
      run_id: null,
      assessment: null,
      recommendations: [],
    });
  }

  if (session.chain.some(step => step.status === 'pending')) {
    const next = v3RunNext({
      sessionId,
      orchestrationRevision: session.orchestration_revision,
      reason: 'a confirmed pending chain step is ready for explicit allocation',
    });
    return v3Directive(sessionId, {
      action: 'dispatch_next',
      authority: 'automatic',
      reason_code: 'MORE_STEPS',
      command: next.next.command,
      reason: next.next.reason,
      preconditions: [
        'session_status=open',
        'active_run_ids empty or already terminal',
        'no earlier pending decision',
      ],
      run_id: null,
      assessment: null,
      recommendations: [],
    });
  }

  const next = v3SessionCompleteNext({
    sessionId,
    orchestrationRevision: session.orchestration_revision,
    reason: 'all chain steps are terminal; complete the Session',
  });
  return v3Directive(sessionId, {
    action: 'seal_session',
    authority: 'automatic',
    reason_code: 'CHAIN_COMPLETE',
    command: next.next.command,
    reason: next.next.reason,
    preconditions: ['all Runs are sealed', 'all decision points are terminal'],
    run_id: null,
    assessment: null,
    recommendations: [],
  });
}

function assessmentIsBlocking(
  assessment: ReuseAssessment,
  run: CommandRun,
  gates: GateRegistry,
): boolean {
  return run.gate_ids.some(gateId => {
    const gate = gates.gates[gateId];
    if (!gate || gate.scope !== 'entry' || !gate.blocking || gate.check.type !== 'artifact') {
      return false;
    }
    return gate.check.kind === assessment.consumer.kind
      && (gate.check.alias ?? null) === assessment.consumer.alias;
  });
}

function activeRunDirective(
  session: SessionState,
  run: CommandRun,
  gates: GateRegistry,
): ContinuationDirective {
  const assessments = run.input.reuse_assessments as ReuseAssessment[];
  const blockingAssessments = assessments.filter(item => assessmentIsBlocking(item, run, gates));
  const pendingReview = blockingAssessments.find(item => (
    item.decision === 'REVIEW'
    && reuseAcceptanceStatus(session, run, item) === 'pending_review'
  ));
  const acceptedReview = blockingAssessments.find(item => (
    item.decision === 'REVIEW'
    && reuseAcceptanceStatus(session, run, item) === 'accepted'
  ));
  const invalid = blockingAssessments.find(
    item => item.decision === 'REJECT' || item.decision === 'CONFLICT',
  );

  if (run.status === 'blocked' && invalid) {
    return directive(session, {
      action: 'stop',
      authority: 'user_required',
      reason_code: `REUSE_${invalid.decision}`,
      command: null,
      reason: `${invalid.decision} reuse assessment blocks this Run and cannot be accepted`,
      preconditions: ['resolve the conflicting or rejected upstream artifact without bypassing its source fence'],
      run_id: run.run_id,
      assessment: assessmentProjection(session, run, invalid),
      recommendations: [],
    });
  }

  if (run.status === 'blocked' && pendingReview) {
    return directive(session, {
      action: 'accept_reuse',
      authority: safeAutoReview(pendingReview) ? 'auto_mode_only' : 'user_required',
      reason_code: pendingReview.reason_codes.join('+'),
      command: null,
      reason: 'entry gate requires an audited acceptance of this exact REVIEW assessment before execution',
      preconditions: [
        're-read the exact assessment and current source fence',
        'provide actor, reason, evidence, request id, and current Session revisions',
        'after acceptance, reload the same Run brief before continuing',
      ],
      run_id: run.run_id,
      assessment: assessmentProjection(session, run, pendingReview),
      recommendations: [],
    });
  }

  if (run.status === 'blocked' || run.status === 'failed') {
    return directive(session, {
      action: 'repair_run',
      authority: 'automatic',
      reason_code: run.status === 'blocked' ? 'RUN_GATES_BLOCKING' : 'RUN_FAILED',
      command: `maestro run brief ${run.run_id} --session ${session.session_id} --json`,
      reason: 're-attach the same Run and repair its blocking condition; do not allocate a duplicate Run',
      preconditions: [
        `run_already_created=${run.run_id}`,
        `execute_command=${run.command.name}`,
        `execute_args=${JSON.stringify(run.input.args)}`,
        `session_goal=${JSON.stringify(session.intent)}`,
        'load this exact Run brief before repair',
        'use only canonical upstream from this Run birth/brief packet',
        'do not call run create or allocate another Run',
        'respect the chain retry budget',
      ],
      run_id: run.run_id,
      assessment: acceptedReview ? assessmentProjection(session, run, acceptedReview) : null,
      recommendations: [],
    });
  }

  if (run.status === 'running' || run.status === 'created') {
    return directive(session, {
      action: 'load_run',
      authority: 'automatic',
      reason_code: 'RUN_ACTIVE',
      command: `maestro run brief ${run.run_id} --session ${session.session_id} --json`,
      reason: 'load the active Run Resume Packet and continue its lifecycle',
      preconditions: [
        `run_already_created=${run.run_id}`,
        `execute_command=${run.command.name}`,
        `execute_args=${JSON.stringify(run.input.args)}`,
        `session_goal=${JSON.stringify(session.intent)}`,
        'load this exact Run brief before domain execution',
        'use only canonical upstream from this Run birth/brief packet; never reconstruct upstream from search or mtime',
        'do not call run create or allocate another Run',
        'do not end the turn while this Run is unsealed and an automatic continuation remains',
      ],
      run_id: run.run_id,
      assessment: acceptedReview ? assessmentProjection(session, run, acceptedReview) : null,
      recommendations: [],
    });
  }

  return directive(session, {
    action: 'dispatch_next',
    authority: 'automatic',
    reason_code: 'RUN_SEALED',
    command: `maestro run next --session ${session.session_id} --json`,
    reason: 'the active Run is terminal; reconcile it and advance the chain',
    preconditions: ['session_status=running'],
    run_id: run.run_id,
    assessment: null,
    recommendations: [],
  });
}

export function inspectSessionContinuation(
  projectRoot: string,
  sessionId: string,
  options: InspectContinuationOptions = {},
): ContinuationDirective {
  const store = new SessionStore(projectRoot);
  const record = store.readSessionRecordReadOnly(sessionId);
  if (record.schema_version === 'session/3.0') {
    return inspectV3SessionContinuation(store, sessionId, options);
  }
  const bundle = store.readBundle(sessionId);
  const session = bundle.session;

  if (session.status === 'sealed' || session.status === 'archived' || session.status === 'failed') {
    return directive(session, {
      action: recommendationsFor(store, session).length > 0 ? 'offer_recommendations' : 'stop',
      authority: 'user_required',
      reason_code: 'SESSION_TERMINAL',
      command: null,
      reason: `Session is ${session.status}; no lifecycle command may resume it`,
      preconditions: [],
      run_id: null,
      assessment: null,
      recommendations: recommendationsFor(store, session),
    });
  }

  if (session.status === 'paused') {
    return directive(session, {
      action: 'recover_session',
      authority: 'user_required',
      reason_code: 'SESSION_PAUSED',
      command: null,
      reason: 'paused Session requires audited blocker resolution and explicit resume',
      preconditions: ['resolve every named blocker', 'record actor, reason, and evidence', 'resume before dispatching another Run'],
      run_id: session.active_run_id,
      assessment: null,
      recommendations: [],
    });
  }

  const runId = options.runId ?? session.active_run_id;
  if (runId) {
    try {
      return activeRunDirective(session, store.readRun(sessionId, runId), bundle.gates);
    } catch {
      return directive(session, {
        action: 'stop',
        authority: 'user_required',
        reason_code: 'RUN_NOT_FOUND',
        command: null,
        reason: `Session points at missing Run ${runId}; authority must be repaired before continuing`,
        preconditions: ['re-read Session status', 'do not allocate a replacement Run implicitly'],
        run_id: runId,
        assessment: null,
        recommendations: [],
      });
    }
  }

  const nextExecution = nextPendingIndex(session, true);
  const nextDecision = nextPendingDecisionIndex(session);
  if (nextDecision !== null && (nextExecution === null || nextDecision < nextExecution)) {
    const decisionRef = session.orchestration.chain[nextDecision].decision_ref;
    return directive(session, {
      action: 'evaluate_decision',
      authority: 'automatic',
      reason_code: 'DECISION_REQUIRED',
      command: `maestro run next --session ${sessionId} --json`,
      reason: 'the next chain node is a decision; surface its card and evaluate it without allocating a Run',
      preconditions: [
        `decision_point=${decisionRef ?? session.orchestration.chain[nextDecision].step_id}`,
        'decision remains pending',
        'call run next now to load the canonical decision card',
        'do not allocate an execution Run for a decision node',
        'after run decide succeeds, execute its returned automatic continuation in the same turn',
      ],
      run_id: null,
      assessment: null,
      recommendations: [],
    });
  }

  if (nextExecution !== null) {
    return directive(session, {
      action: 'dispatch_next',
      authority: 'automatic',
      reason_code: 'MORE_STEPS',
      command: `maestro run next --session ${sessionId} --json`,
      reason: 'a confirmed pending chain step is ready for explicit allocation',
      preconditions: [
        'session_status=running',
        'active_run_id=null',
        'no earlier pending decision',
        'execute run next immediately; do not stop after recommending it',
        'after allocation, obey the returned run_already_created identity and load its exact brief in the same turn',
      ],
      run_id: null,
      assessment: null,
      recommendations: [],
    });
  }

  return directive(session, {
    action: 'seal_session',
    authority: 'automatic',
    reason_code: 'CHAIN_COMPLETE',
    command: `maestro run seal-session ${sessionId} --json`,
    reason: 'all chain steps are terminal; validate goals and gates, then seal the Session',
    preconditions: ['all Runs are sealed', 'all decision points are terminal', 'all goals and Session gates are complete'],
    run_id: null,
    assessment: null,
    recommendations: recommendationsFor(store, session),
  });
}

export function continuationAfterBrief(
  projectRoot: string,
  sessionId: string,
  runId: string,
  next: LifecycleNext,
): ContinuationDirective {
  const current = inspectSessionContinuation(projectRoot, sessionId, { runId });
  if (current.action !== 'load_run') return current;
  return continuationDirectiveSchema.parse({
    ...current,
    action: 'execute_run',
    reason_code: 'RUN_BRIEF_LOADED',
    command: next.command,
    reason: 'Resume Packet is loaded; execute the Run instructions, then perform the suggested lifecycle check',
  });
}

export function continuationAfterCheck(
  projectRoot: string,
  sessionId: string,
  runId: string,
  clean: boolean,
  next: LifecycleNext,
): ContinuationDirective {
  const current = inspectSessionContinuation(projectRoot, sessionId, { runId });
  if (current.action === 'accept_reuse' || current.action === 'stop') return current;
  return continuationDirectiveSchema.parse({
    ...current,
    action: clean ? 'execute_run' : 'repair_run',
    authority: 'automatic',
    reason_code: clean ? 'RUN_READY_TO_COMPLETE' : 'RUN_GATES_BLOCKING',
    command: next.command,
    reason: next.reason,
    preconditions: clean
      ? [
          'work through the finish checklist',
          'stage Run knowledge and record explicit knowledge relations',
          'choose an honest completion verdict',
        ]
      : ['repair the same Run', 're-run check until blocking gates and scan errors are clear'],
  });
}

export function continuationAfterDecide(
  projectRoot: string,
  sessionId: string,
  pointId: string,
  verdict: 'proceed' | 'fix' | 'escalate',
  retry: { count: number; max: number; exhausted: boolean } | null,
): ContinuationDirective {
  if (verdict !== 'fix') return inspectSessionContinuation(projectRoot, sessionId);
  const store = new SessionStore(projectRoot);
  const record = store.readSessionRecordReadOnly(sessionId);
  if (record.schema_version === 'session/3.0') {
    return v3Directive(sessionId, {
      action: 'repair_chain',
      authority: 'user_required',
      reason_code: retry?.exhausted ? 'DECISION_RETRY_EXHAUSTED' : 'DECISION_FIX_REQUIRED',
      command: null,
      reason: retry?.exhausted
        ? `decision ${pointId} exhausted its retry budget; escalation or an explicitly approved repair is required`
        : `decision ${pointId} requested a fix; evidence-backed repair must occur before this decision is evaluated again`,
      preconditions: [
        `decision_point=${pointId}`,
        `decision_retry=${retry ? `${retry.count}/${retry.max}` : 'unknown'}`,
        'do not repeat run decide without new repair evidence',
        'do not bypass or directly mark the decision passed',
      ],
      run_id: null,
      assessment: null,
      recommendations: [],
    });
  }
  const session = store.readBundle(sessionId).session;
  return directive(session, {
    action: 'repair_chain',
    authority: 'user_required',
    reason_code: retry?.exhausted ? 'DECISION_RETRY_EXHAUSTED' : 'DECISION_FIX_REQUIRED',
    command: null,
    reason: retry?.exhausted
      ? `decision ${pointId} exhausted its retry budget; escalation or an explicitly approved repair is required`
      : `decision ${pointId} requested a fix; evidence-backed repair must occur before this decision is evaluated again`,
    preconditions: [
      `decision_point=${pointId}`,
      `decision_retry=${retry ? `${retry.count}/${retry.max}` : 'unknown'}`,
      'do not repeat run decide without new repair evidence',
      'a repair Skill must produce any pending-tail change as chain-proposal/1.0',
      'do not bypass or directly mark the decision passed',
    ],
    run_id: null,
    assessment: null,
    recommendations: [],
  });
}

export function continuationForNextFailure(
  projectRoot: string,
  sessionId: string | undefined,
  reasonCode: string,
  message: string,
): ContinuationDirective | null {
  if (!sessionId) return null;
  if (reasonCode === 'DECISION_REQUIRED') {
    try {
      const current = inspectSessionContinuation(projectRoot, sessionId);
      if (current.action !== 'evaluate_decision') return current;
      return continuationDirectiveSchema.parse({
        ...current,
        reason_code: 'DECISION_CARD_READY',
        command: null,
        reason: 'the canonical decision card is already present in this run next response; evaluate it now',
        preconditions: current.preconditions
          .filter(item => item !== 'call run next now to load the canonical decision card')
          .concat([
            'do not call run next again for this decision card',
            'dispatch one read-only evaluator, then call run decide with its verdict and confidence',
          ]),
      });
    } catch {
      return null;
    }
  }
  if (reasonCode !== 'COMMAND_CONTENT_MISSING' && reasonCode !== 'ARGUMENT_REQUIRED') {
    try {
      return inspectSessionContinuation(projectRoot, sessionId);
    } catch {
      return null;
    }
  }
  const store = new SessionStore(projectRoot);
  const record = store.readSessionRecordReadOnly(sessionId);
  if (record.schema_version === 'session/3.0') {
    return v3Directive(sessionId, {
      action: 'repair_chain',
      authority: 'user_required',
      reason_code: reasonCode,
      command: null,
      reason: message,
      preconditions: [
        'repair or replace the invalid pending chain step',
        'validate command content and required arguments before retrying run next',
      ],
      run_id: null,
      assessment: null,
      recommendations: [],
    });
  }
  const session = store.readBundle(sessionId).session;
  return directive(session, {
    action: 'repair_chain',
    authority: 'user_required',
    reason_code: reasonCode,
    command: null,
    reason: message,
    preconditions: [
      'repair or replace the invalid pending chain step',
      'validate command content and required arguments before retrying run next',
    ],
    run_id: null,
    assessment: null,
    recommendations: [],
  });
}

export function renderContinuationCard(value: ContinuationDirective): string {
  const lines = [
    '## Canonical Run Continuation',
    `Session: ${value.session_id} | Action: ${value.action} | Authority: ${value.authority} | Auto: ${value.auto_mode}`,
    `Reason: ${value.reason_code} — ${value.reason}`,
    `Command: ${value.command ?? '(requires audited decision)'}`,
  ];
  if (value.assessment) {
    lines.push(
      `Reuse: ${value.assessment.decision}/${value.assessment.acceptance_status} `
      + `${value.assessment.assessment_hash}`,
    );
  }
  if (value.preconditions.length > 0) {
    lines.push('Strict preconditions:');
    for (const condition of value.preconditions) lines.push(`- ${condition}`);
  }
  lines.push(
    'Loop rule: execute deterministic automatic actions immediately; `suggest_only` means the CLI is passive, not that the turn should end.',
    'End the turn only for user_required authority, a terminal Session, or an external blocker.',
  );
  return lines.join('\n');
}
