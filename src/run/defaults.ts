import type { ArtifactRegistry, EvidenceStore, GateRegistry, SessionState } from './schemas.js';
import type { IntentIdentity, SessionProvenance } from './protocol-schemas.js';

export function createSessionState(
  sessionId: string,
  intent: string,
  options: { intentIdentity?: IntentIdentity | null; provenance?: SessionProvenance } = {},
): SessionState {
  return {
    schema_version: 'session/1.2',
    session_id: sessionId,
    intent,
    intent_identity: options.intentIdentity ?? null,
    provenance: options.provenance ?? {
      source: 'native',
      forked_from: null,
      imported_from: [],
      created_by: 'session-store',
    },
    status: 'running',
    identity_revision: 1,
    activity_revision: 0,
    active_run_id: null,
    latest_completed_run_id: null,
    boundary_contract: {
      in_scope: [],
      out_of_scope: [],
      constraints: [],
      definition_of_done: '',
    },
    orchestration: {
      engine: 'manual',
      quality_mode: 'standard',
      auto_mode: false,
      chain: [],
      decision_points: [],
      position: null,
      decomposition: null,
      lease: null,
      executor: null,
    },
    requests: [],
    ralph_authority: null,
    lifecycle: {
      sealed_at: null,
      seal_summary: null,
      promoted_spec_ids: [],
      promoted_knowhow_ids: [],
      forked_from: null,
    },
    refs: { gates: 'gates.json', artifacts: 'artifacts.json', evidence: 'evidence.json' },
  };
}

export function createGateRegistry(): GateRegistry {
  return {
    schema_version: 'gates/1.0',
    revision: 0,
    gates: {},
    summary: { total: 0, passed: 0, blocked: 0, failed: 0, active_gate_ids: [], blocking_run_id: null },
  };
}

export function createArtifactRegistry(): ArtifactRegistry {
  return { schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {} };
}

export function createEvidenceStore(): EvidenceStore {
  return { schema_version: 'evidence/1.0', revision: 0, records: {} };
}
