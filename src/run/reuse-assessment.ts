import { createHash } from 'node:crypto';

export type ReuseDecision = 'REUSE' | 'REVIEW' | 'CONFLICT' | 'REJECT';

export type ProducerStatus = 'created' | 'running' | 'blocked' | 'failed' | 'completed' | 'sealed';
export type ArtifactStatus = 'draft' | 'sealed' | 'invalid' | 'superseded';
export type ContractDrift = 'none' | 'prompt_only' | 'compatible_output' | 'breaking' | 'unknown';
export type FreshnessStatus = 'fresh' | 'compatible' | 'stale' | 'unknown';
export type QualityStatus = 'high' | 'medium' | 'low' | 'unknown';
export type SupersessionStatus = 'current' | 'superseded' | 'unknown';

export type ReuseReasonCode =
  | 'PRODUCER_NOT_SEALED'
  | 'ARTIFACT_INVALID'
  | 'ARTIFACT_SUPERSEDED'
  | 'ARTIFACT_NOT_SEALED'
  | 'SOURCE_FENCE_INCOMPLETE'
  | 'ARTIFACT_HASH_UNVERIFIED'
  | 'ARTIFACT_HASH_MISMATCH'
  | 'ARTIFACT_SCHEMA_UNKNOWN'
  | 'ARTIFACT_SCHEMA_MISMATCH'
  | 'ARTIFACT_ROLE_MISMATCH'
  | 'CONTRACT_BREAKING_DRIFT'
  | 'CONTRACT_PROMPT_ONLY_DRIFT'
  | 'CONTRACT_COMPATIBLE_OUTPUT'
  | 'CONTRACT_COMPATIBILITY_UNKNOWN'
  | 'CONTRACT_HASH_MISMATCH'
  | 'FRESHNESS_COMPATIBLE'
  | 'FRESHNESS_STALE'
  | 'FRESHNESS_UNKNOWN'
  | 'QUALITY_LOW'
  | 'QUALITY_MEDIUM'
  | 'QUALITY_UNKNOWN'
  | 'SUPERSESSION_UNKNOWN'
  | 'SUPERSEDED_BY_NEWER_ARTIFACT'
  | 'SAME_ROLE_COMPARISON_UNKNOWN'
  | 'SAME_ROLE_CONFLICT'
  | 'REUSE_ELIGIBLE';

export interface ReuseCandidate {
  workspaceId: string;
  sessionId: string;
  producerRunId: string;
  producerRunHash: string | null;
  producerStatus: ProducerStatus;
  artifactId: string;
  artifactRole: string;
  artifactStatus: ArtifactStatus;
  artifactHash: string | null;
  observedArtifactHash: string | null;
  artifactSchema: string | null;
  artifactRegistryRevision: number | null;
}

export interface ReuseContractEvidence {
  producerHash: string | null;
  currentHash: string | null;
  drift: ContractDrift;
}

export interface ReuseQualityEvidence {
  status: QualityStatus;
  concernCodes: readonly string[];
}

export interface ReuseSupersessionEvidence {
  status: SupersessionStatus;
  supersedesArtifactIds: readonly string[];
  supersededByArtifactIds: readonly string[];
}

export interface SameRoleReuseCandidate {
  artifactId: string;
  artifactHash: string | null;
  eligible: boolean;
}

export interface ReuseConflictEvidence {
  sameRoleCandidates: readonly SameRoleReuseCandidate[];
}

export interface ReuseAssessmentInput {
  candidate: ReuseCandidate;
  consumer?: {
    kind: string;
    alias: string | null;
    schema: string | null;
    role: 'primary' | 'attachment' | 'evidence' | 'checkpoint' | null;
  };
  acceptedArtifactSchemas: readonly string[];
  acceptedArtifactRoles?: readonly string[];
  contract: ReuseContractEvidence;
  freshness: FreshnessStatus;
  quality: ReuseQualityEvidence;
  supersession: ReuseSupersessionEvidence;
  conflicts: ReuseConflictEvidence;
}

export interface ReuseSourceFence {
  schema_version: 'reuse-source-fence/1.0';
  workspace_id: string;
  session_id: string;
  producer_run_id: string;
  producer_run_hash: string | null;
  producer_status: ProducerStatus;
  artifact_id: string;
  artifact_role: string;
  artifact_status: ArtifactStatus;
  artifact_hash: string | null;
  observed_artifact_hash: string | null;
  artifact_schema: string | null;
  artifact_registry_revision: number | null;
  producer_contract_hash: string | null;
}

export interface ReuseAssessment {
  schema_version: 'reuse-assessment/1.0';
  decision: ReuseDecision;
  reason_codes: ReuseReasonCode[];
  consumer: {
    kind: string;
    alias: string | null;
    schema: string | null;
    role: 'primary' | 'attachment' | 'evidence' | 'checkpoint' | null;
  };
  source_fence: ReuseSourceFence;
  assessment_hash: string;
}

type Severity = 'reuse' | 'review' | 'conflict' | 'reject';

const SEVERITY_RANK: Record<Severity, number> = {
  reuse: 0,
  review: 1,
  conflict: 2,
  reject: 3,
};

const REASON_ORDER: readonly ReuseReasonCode[] = [
  'PRODUCER_NOT_SEALED',
  'ARTIFACT_INVALID',
  'ARTIFACT_SUPERSEDED',
  'ARTIFACT_NOT_SEALED',
  'SOURCE_FENCE_INCOMPLETE',
  'ARTIFACT_HASH_UNVERIFIED',
  'ARTIFACT_HASH_MISMATCH',
  'ARTIFACT_SCHEMA_UNKNOWN',
  'ARTIFACT_SCHEMA_MISMATCH',
  'ARTIFACT_ROLE_MISMATCH',
  'CONTRACT_BREAKING_DRIFT',
  'CONTRACT_PROMPT_ONLY_DRIFT',
  'CONTRACT_COMPATIBLE_OUTPUT',
  'CONTRACT_COMPATIBILITY_UNKNOWN',
  'CONTRACT_HASH_MISMATCH',
  'FRESHNESS_COMPATIBLE',
  'FRESHNESS_STALE',
  'FRESHNESS_UNKNOWN',
  'QUALITY_LOW',
  'QUALITY_MEDIUM',
  'QUALITY_UNKNOWN',
  'SUPERSESSION_UNKNOWN',
  'SUPERSEDED_BY_NEWER_ARTIFACT',
  'SAME_ROLE_COMPARISON_UNKNOWN',
  'SAME_ROLE_CONFLICT',
  'REUSE_ELIGIBLE',
];

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function normalizedSameRoleCandidates(
  candidates: readonly SameRoleReuseCandidate[],
): SameRoleReuseCandidate[] {
  const ordered = [...candidates].sort((left, right) => {
    const idOrder = compareStrings(left.artifactId, right.artifactId);
    if (idOrder !== 0) return idOrder;
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    return compareStrings(left.artifactHash ?? '', right.artifactHash ?? '');
  });
  const byId = new Map<string, SameRoleReuseCandidate>();
  for (const candidate of ordered) {
    if (!byId.has(candidate.artifactId)) byId.set(candidate.artifactId, candidate);
  }
  return [...byId.values()];
}

/**
 * Pure, read-only eligibility assessment. It neither copies artifacts nor
 * changes Session/Run state; callers separately decide how to act on the result.
 */
export function assessArtifactReuse(input: ReuseAssessmentInput): ReuseAssessment {
  const findings = new Map<ReuseReasonCode, Severity>();
  const add = (code: ReuseReasonCode, severity: Severity): void => {
    const current = findings.get(code);
    if (!current || SEVERITY_RANK[severity] > SEVERITY_RANK[current]) findings.set(code, severity);
  };

  if (input.candidate.producerStatus !== 'sealed') add('PRODUCER_NOT_SEALED', 'reject');
  if (input.candidate.artifactStatus === 'invalid') add('ARTIFACT_INVALID', 'reject');
  else if (input.candidate.artifactStatus === 'superseded') add('ARTIFACT_SUPERSEDED', 'reject');
  else if (input.candidate.artifactStatus !== 'sealed') add('ARTIFACT_NOT_SEALED', 'reject');
  if (input.candidate.producerRunHash === null
    || input.candidate.artifactRegistryRevision === null) add('SOURCE_FENCE_INCOMPLETE', 'review');

  if (input.candidate.artifactHash === null || input.candidate.observedArtifactHash === null) {
    add('ARTIFACT_HASH_UNVERIFIED', 'review');
  } else if (input.candidate.artifactHash !== input.candidate.observedArtifactHash) {
    add('ARTIFACT_HASH_MISMATCH', 'reject');
  }

  const acceptedSchemas = uniqueSorted(input.acceptedArtifactSchemas);
  if (input.candidate.artifactSchema === null || acceptedSchemas.length === 0) {
    add('ARTIFACT_SCHEMA_UNKNOWN', 'review');
  } else if (!acceptedSchemas.includes(input.candidate.artifactSchema)) {
    add('ARTIFACT_SCHEMA_MISMATCH', 'reject');
  }
  const acceptedRoles = uniqueSorted(input.acceptedArtifactRoles ?? []);
  if (acceptedRoles.length > 0 && !acceptedRoles.includes(input.candidate.artifactRole)) {
    add('ARTIFACT_ROLE_MISMATCH', 'reject');
  }

  if (input.contract.drift === 'breaking') add('CONTRACT_BREAKING_DRIFT', 'reject');
  else if (input.contract.drift === 'prompt_only') add('CONTRACT_PROMPT_ONLY_DRIFT', 'review');
  else if (input.contract.drift === 'compatible_output') add('CONTRACT_COMPATIBLE_OUTPUT', 'reuse');
  else if (input.contract.drift === 'unknown') add('CONTRACT_COMPATIBILITY_UNKNOWN', 'review');

  if (input.contract.producerHash === null || input.contract.currentHash === null) {
    add('CONTRACT_COMPATIBILITY_UNKNOWN', 'review');
  } else if (input.contract.producerHash !== input.contract.currentHash) {
    if (input.contract.drift !== 'compatible_output') {
      add('CONTRACT_HASH_MISMATCH', input.contract.drift === 'breaking' ? 'reject' : 'review');
    }
  }

  if (input.freshness === 'compatible') add('FRESHNESS_COMPATIBLE', 'reuse');
  else if (input.freshness === 'stale') add('FRESHNESS_STALE', 'reject');
  else if (input.freshness === 'unknown') add('FRESHNESS_UNKNOWN', 'review');

  if (input.quality.status === 'low') add('QUALITY_LOW', 'reject');
  else if (input.quality.status === 'medium') add('QUALITY_MEDIUM', 'review');
  else if (input.quality.status === 'unknown') add('QUALITY_UNKNOWN', 'review');

  const supersedesArtifactIds = uniqueSorted(input.supersession.supersedesArtifactIds);
  const supersededByArtifactIds = uniqueSorted(input.supersession.supersededByArtifactIds);
  if (input.supersession.status === 'unknown') add('SUPERSESSION_UNKNOWN', 'review');
  if (input.supersession.status === 'superseded' || supersededByArtifactIds.length > 0) {
    add('SUPERSEDED_BY_NEWER_ARTIFACT', 'reject');
  }

  const sameRoleCandidates = normalizedSameRoleCandidates(input.conflicts.sameRoleCandidates)
    .filter(candidate => candidate.artifactId !== input.candidate.artifactId && candidate.eligible);
  for (const candidate of sameRoleCandidates) {
    if (supersedesArtifactIds.includes(candidate.artifactId)
      || supersededByArtifactIds.includes(candidate.artifactId)) continue;
    if (candidate.artifactHash === null || input.candidate.artifactHash === null) {
      add('SAME_ROLE_COMPARISON_UNKNOWN', 'review');
    } else if (candidate.artifactHash !== input.candidate.artifactHash) {
      add('SAME_ROLE_CONFLICT', 'conflict');
    }
  }

  const hasNonReuseFinding = [...findings.values()].some(severity => severity !== 'reuse');
  if (!hasNonReuseFinding) add('REUSE_ELIGIBLE', 'reuse');

  const reasonCodes = REASON_ORDER.filter(code => findings.has(code));
  const highestSeverity = reasonCodes.reduce<Severity>((highest, code) => {
    const severity = findings.get(code) ?? 'reuse';
    return SEVERITY_RANK[severity] > SEVERITY_RANK[highest] ? severity : highest;
  }, 'reuse');
  const decision: ReuseDecision = highestSeverity === 'reject'
    ? 'REJECT'
    : highestSeverity === 'conflict'
      ? 'CONFLICT'
      : highestSeverity === 'review'
        ? 'REVIEW'
        : 'REUSE';

  const sourceFence: ReuseSourceFence = {
    schema_version: 'reuse-source-fence/1.0',
    workspace_id: input.candidate.workspaceId,
    session_id: input.candidate.sessionId,
    producer_run_id: input.candidate.producerRunId,
    producer_run_hash: input.candidate.producerRunHash,
    producer_status: input.candidate.producerStatus,
    artifact_id: input.candidate.artifactId,
    artifact_role: input.candidate.artifactRole,
    artifact_status: input.candidate.artifactStatus,
    artifact_hash: input.candidate.artifactHash,
    observed_artifact_hash: input.candidate.observedArtifactHash,
    artifact_schema: input.candidate.artifactSchema,
    artifact_registry_revision: input.candidate.artifactRegistryRevision,
    producer_contract_hash: input.contract.producerHash,
  };
  const consumer = input.consumer ?? {
    kind: input.candidate.artifactRole,
    alias: null,
    schema: acceptedSchemas[0] ?? null,
    role: null,
  };
  const normalizedEvidence = {
    accepted_artifact_schemas: acceptedSchemas,
    accepted_artifact_roles: acceptedRoles,
    contract: {
      producer_hash: input.contract.producerHash,
      current_hash: input.contract.currentHash,
      drift: input.contract.drift,
    },
    freshness: input.freshness,
    quality: {
      status: input.quality.status,
      concern_codes: uniqueSorted(input.quality.concernCodes),
    },
    supersession: {
      status: input.supersession.status,
      supersedes_artifact_ids: supersedesArtifactIds,
      superseded_by_artifact_ids: supersededByArtifactIds,
    },
    conflicts: {
      same_role_candidates: sameRoleCandidates,
    },
  };
  const assessmentHash = sha256(stableJson({
    schema_version: 'reuse-assessment/1.0',
    decision,
    reason_codes: reasonCodes,
    consumer,
    source_fence: sourceFence,
    evidence: normalizedEvidence,
  }));

  return {
    schema_version: 'reuse-assessment/1.0',
    decision,
    reason_codes: reasonCodes,
    consumer,
    source_fence: sourceFence,
    assessment_hash: assessmentHash,
  };
}
