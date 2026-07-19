import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from './store.js';
import { recallRuns } from './recall.js';
import { runRecallSchema } from './protocol-schemas.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('read-only run recall', () => {
  it('uses command-independent Unicode topic identity and preserves authority mtimes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-recall-')); roots.push(root);
    const store = new SessionStore(root);
    store.createSession('live', '修复 Unicode intent', { command: 'demo' });
    const sessionPath = join(store.sessionDir('live'), 'session.json');
    const before = statSync(sessionPath).mtimeMs;
    const result = await recallRuns(root, { command: 'other-command', intent: '修复 Unicode intent', topic: '  修复 Unicode intent  ', asOf: '2026-07-19T00:00:00.000Z' });
    expect(runRecallSchema.parse(result).recommendation).toMatchObject({ action: null, automatic: false, reason_codes: ['READ_ONLY_TOPIC_MATCH'] });
    expect(result.exact_candidates.map(item => item.session_id)).toEqual(['live']);
    expect(result.topic_identity?.normalized).toBe('修复 unicode intent');
    expect(result.confirmation).toEqual({ required: false, issuance_command: '', allowed_actions: [] });
    expect(result.next.command).toBeNull();
    expect(result.historical_candidates).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/recall-confirm|maestro session resume|maestro run (?:fork|import|new)/);
    expect(statSync(sessionPath).mtimeMs).toBe(before);
  });

  it('rejects mutation-capable recommendation shapes', () => {
    expect(runRecallSchema.safeParse({ schema_version: 'run-recall/1.0', recommendation: { automatic: true } }).success).toBe(false);
  });

  it('keeps multiple exact live Sessions ambiguous and emits no confirmation mutation surface', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-recall-')); roots.push(root);
    const store = new SessionStore(root);
    store.createSession('a', 'same intent', { command: 'demo' });
    store.createSession('b', 'same intent', { command: 'demo' });
    const result = await recallRuns(root, { command: 'demo', intent: 'same intent', asOf: '2026-07-19T00:00:00.000Z' });
    expect(result.exact_candidates).toHaveLength(2);
    expect(result.recommendation).toMatchObject({ action: null, candidate_id: null, automatic: false, reason_codes: ['AMBIGUOUS_TOPIC_MATCH'] });
    expect(result.confirmation).toEqual({ required: false, issuance_command: '', allowed_actions: [] });
    expect(result.next.command).toBeNull();
  });

  it('does not select or emit a mutation pointer for a paused Session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-recall-')); roots.push(root);
    const store = new SessionStore(root);
    store.createSession('paused', 'paused intent', { command: 'demo' });
    store.update('paused', draft => { draft.session.status = 'paused'; });
    const result = await recallRuns(root, { command: 'demo', intent: 'paused intent', asOf: '2026-07-19T00:00:00.000Z' });
    expect(result.exact_candidates).toEqual([]);
    expect(result.recommendation.reason_codes).toEqual(['NO_RUNNING_TOPIC_MATCH']);
    expect(result.next.command).toBeNull();
    expect(JSON.stringify(result)).not.toContain('maestro session resume');
  });
});
