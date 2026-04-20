// ---------------------------------------------------------------------------
// normalizeTask — convert raw TASK JSON (from .task/*.json) into TaskCard shape.
// Shared between usePhaseTasks and useIssueTasks hooks.
// Raw files use task_id, top-level status, and lack the meta wrapper.
// ---------------------------------------------------------------------------

import type { TaskCard } from './types.js';

export function normalizeTask(raw: unknown): TaskCard {
  const r = raw as Record<string, unknown>;
  const id = (r.task_id ?? r.id ?? '') as string;
  const status = ((r.meta as Record<string, unknown>)?.status ?? r.status ?? 'pending') as string;
  const wave = ((r.meta as Record<string, unknown>)?.wave ?? r.wave ?? 0) as number;
  const convergence = r.convergence as Record<string, unknown> | undefined;

  return {
    id,
    title: (r.title ?? '') as string,
    description: (r.description ?? '') as string,
    type: (r.type ?? 'feature') as TaskCard['type'],
    priority: (r.priority ?? 'medium') as string,
    effort: (r.effort ?? '') as string,
    action: (r.action ?? '') as string,
    scope: (r.scope ?? '') as string,
    focus_paths: (r.focus_paths ?? []) as string[],
    depends_on: (r.depends_on ?? []) as string[],
    parallel_group: (r.parallel_group ?? null) as string | null,
    convergence: {
      criteria: (convergence?.criteria ?? []) as string[],
      verification: (convergence?.verification ?? '') as string,
      definition_of_done: (convergence?.definition_of_done ?? '') as string,
    },
    files: Array.isArray(r.files)
      ? r.files.map((f: unknown) =>
          typeof f === 'string'
            ? { path: f, action: '', target: '', change: '' }
            : (f as TaskCard['files'][number]),
        )
      : [],
    implementation: (r.implementation ?? []) as string[],
    test: {
      commands: [],
      unit: [],
      integration: [],
      success_metrics: [],
      ...((r.test ?? {}) as Record<string, unknown>),
    } as TaskCard['test'],
    reference: {
      pattern: '',
      files: (r.read_first ?? []) as string[],
      examples: null,
      ...((r.reference ?? {}) as Record<string, unknown>),
    } as TaskCard['reference'],
    rationale: {
      chosen_approach: '',
      decision_factors: [],
      tradeoffs: null,
      ...((r.rationale ?? {}) as Record<string, unknown>),
    } as TaskCard['rationale'],
    risks: (r.risks ?? []) as string[],
    code_skeleton: (r.code_skeleton ?? null) as string | null,
    doc_context: {
      affected_features: [],
      affected_components: [],
      affected_requirements: [],
      adr_ids: [],
      ...((r.doc_context ?? {}) as Record<string, unknown>),
    } as TaskCard['doc_context'],
    meta: {
      status: status as TaskCard['meta']['status'],
      estimated_time: (r.estimated_time ?? null) as string | null,
      risk: (r.risk ?? 'low') as string,
      autonomous: (r.autonomous ?? false) as boolean,
      checkpoint: (r.checkpoint ?? false) as boolean,
      wave,
      execution_group: (r.execution_group ?? null) as string | null,
      executor: (r.executor ?? '') as string,
    },
  };
}
