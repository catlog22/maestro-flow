import { describe, expect, it } from 'vitest';

import {
  createContractSnapshot,
  hashCommandContract,
  parseCommandContract,
} from './contract.js';
import {
  contractSnapshotSchema,
  creationDecisionSchema,
  creationProvenanceSchema,
  guidanceSnapshotSchema,
  sessionProvenanceSchema,
} from './protocol-schemas.js';

const hash = `sha256:${'a'.repeat(64)}`;

function validV2() {
  return {
    contract_version: 2,
    consumes: [{ kind: 'plan', alias: 'current-plan', required: true, require_status: 'sealed', schema: 'plan/1.0' }],
    produces: [{ kind: 'result', path: 'outputs/result.json', alias: 'result', role: 'primary', required: true, schema: 'result/1.0' }],
    gates: { entry: [], exit: [] },
  };
}

describe('command-contract/2.0', () => {
  it('enables canonical role/required/schema only through contract_version: 2', () => {
    const contract = parseCommandContract(validV2());
    expect(contract).toMatchObject({
      contract_version: 2,
      schema_version: 'command-contract/2.0',
      produces: [{ primary: true, role: 'primary', required: true, schema: 'result/1.0' }],
    });
    expect(createContractSnapshot(contract)).toMatchObject({
      schema_version: 'contract-snapshot/1.0',
      contract_version: 'command-contract/2.0',
    });
  });

  it('fails closed on synonyms, duplicates, traversal and multiple required primary outputs', () => {
    expect(() => parseCommandContract({ ...validV2(), contract_version: 3 })).toThrow(/Unsupported/);
    expect(() => parseCommandContract({
      ...validV2(),
      produces: [{ ...validV2().produces[0], primary: true }],
    })).toThrow();
    expect(() => parseCommandContract({
      ...validV2(),
      produces: [validV2().produces[0], { ...validV2().produces[0], kind: 'other' }],
    })).toThrow(/duplicate contract alias|duplicate output path|multiple required primary/);
    expect(() => parseCommandContract({
      ...validV2(),
      produces: [{ ...validV2().produces[0], path: 'outputs/../session.json' }],
    })).toThrow(/outputs/);
    expect(() => parseCommandContract({
      ...validV2(),
      produces: [
        validV2().produces[0],
        { kind: 'report', path: 'outputs/report.json', alias: 'report', role: 'primary', required: true, schema: 'report/1.0' },
      ],
    })).toThrow(/multiple required primary/);
  });

  it('keeps v1 behavior and surfaces ignored semantic-looking fields as warnings', () => {
    const v1 = parseCommandContract({
      consumes: [{ kind: 'plan', optional: false, schema: 'plan/9.0' }],
      produces: [{ kind: 'result', primary: true, role: 'evidence', required: true, schema: 'result/9.0' }],
    });
    expect(v1.contract_version).toBe(1);
    expect(v1.produces[0]).toMatchObject({ primary: true, role: 'primary', required: false });
    expect(v1.compatibility_warnings).toHaveLength(5);
  });

  it('hashes normalized UTF-8 snapshots with stable object keys and semantic array order', () => {
    const a = parseCommandContract(validV2());
    const reordered = parseCommandContract({
      gates: { exit: [], entry: [] },
      produces: [{ schema: 'result/1.0', required: true, role: 'primary', alias: 'result', path: 'outputs/result.json', kind: 'result' }],
      consumes: [{ schema: 'plan/1.0', require_status: 'sealed', required: true, alias: 'current-plan', kind: 'plan' }],
      contract_version: 2,
    });
    expect(hashCommandContract(a)).toBe(hashCommandContract(reordered));
    const reversed = parseCommandContract({ ...validV2(), consumes: [...validV2().consumes, { kind: 'spec', required: false }] });
    const reversedOrder = parseCommandContract({ ...validV2(), consumes: [...reversed.consumes].reverse() });
    expect(hashCommandContract(reversed)).not.toBe(hashCommandContract(reversedOrder));
  });
});

describe('snapshot and creation authority schemas', () => {
  it('parses contract/guidance snapshots and creation decision/provenance', () => {
    const snapshot = createContractSnapshot(parseCommandContract(validV2()), '2026-07-19T00:00:00.000Z');
    expect(contractSnapshotSchema.parse(snapshot).snapshot_hash).toMatch(/^sha256:/);
    expect(guidanceSnapshotSchema.parse({
      schema_version: 'guidance-snapshot/1.0', source_path: 'commands/demo.md', content_hash: hash,
      resolved_prompt_hash: hash, prepare_hash: null, workflow_hash: hash, run_mode_hash: null,
    }).workflow_hash).toBe(hash);
    expect(creationDecisionSchema.parse({
      schema_version: 'creation-decision/1.0', decision_id: 'dec-1', request_id: null,
      mode: 'explicit-create', authority: 'explicit-command', decided_at: '2026-07-19T00:00:00.000Z',
      session_identity_revision: 1, session_activity_revision: 0, confirmation_token_hash: null,
    }).mode).toBe('explicit-create');
    expect(creationProvenanceSchema.parse({
      schema_version: 'creation-provenance/1.0', provenance: 'native-v2', source_workspace_id: null,
      source_session_id: null, source_run_id: null, imported_artifact_hashes: [],
    }).provenance).toBe('native-v2');
    expect(sessionProvenanceSchema.parse({
      source: 'native', forked_from: null, imported_from: [], created_by: 'test',
    }).created_by).toBe('test');
  });

  it('rejects malformed snapshot/provenance hashes', () => {
    const snapshot = createContractSnapshot(parseCommandContract(validV2()));
    expect(() => contractSnapshotSchema.parse({ ...snapshot, snapshot_hash: 'bad' })).toThrow();
    expect(() => creationProvenanceSchema.parse({
      schema_version: 'creation-provenance/1.0', provenance: 'import', source_workspace_id: 'bad',
      source_session_id: 's', source_run_id: 'r', imported_artifact_hashes: [],
    })).toThrow();
    expect(() => guidanceSnapshotSchema.parse({
      schema_version: 'guidance-snapshot/1.0', source_path: 'demo.md', content_hash: 'bad',
      resolved_prompt_hash: hash, prepare_hash: null, workflow_hash: null, run_mode_hash: null,
    })).toThrow();
    expect(() => creationDecisionSchema.parse({
      schema_version: 'creation-decision/1.0', decision_id: 'dec-1', request_id: null,
      mode: 'automatic-reuse', authority: 'explicit-command', decided_at: 'now',
      session_identity_revision: 1, session_activity_revision: 1, confirmation_token_hash: null,
    })).toThrow();
    expect(() => sessionProvenanceSchema.parse({
      source: 'native', forked_from: null, imported_from: [], created_by: '',
    })).toThrow();
  });
});
