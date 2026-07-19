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
  it('uses exact SessionStore identity, integer scores, automatic=false, and preserves authority mtimes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-recall-')); roots.push(root);
    const store = new SessionStore(root);
    store.createSession('live', '修复 Unicode intent', { command: 'demo' });
    const sessionPath = join(store.sessionDir('live'), 'session.json');
    const before = statSync(sessionPath).mtimeMs;
    const result = await recallRuns(root, { command: 'demo', intent: '修复 Unicode intent', asOf: '2026-07-19T00:00:00.000Z' });
    expect(runRecallSchema.parse(result).recommendation).toMatchObject({ action: 'resume', automatic: false });
    expect(result.exact_candidates.map(item => item.session_id)).toEqual(['live']);
    expect(result.confirmation).toEqual({ required: false, issuance_command: '', allowed_actions: [] });
    expect(result.next.command).toBe('maestro run create demo --session live');
    expect(JSON.stringify(result)).not.toContain('recall-confirm resume');
    expect(result.historical_candidates.every(item => Number.isInteger(item.score_bp))).toBe(true);
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
    expect(result.recommendation).toMatchObject({ action: null, candidate_id: null, automatic: false, reason_codes: ['AMBIGUOUS_EXACT_MATCH'] });
    expect(result.confirmation).toEqual({ required: false, issuance_command: '', allowed_actions: [] });
    expect(result.next.command).toBeNull();
  });

  it('returns a fully specified exact-ID resume pointer for a paused Session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-recall-')); roots.push(root);
    const store = new SessionStore(root);
    store.createSession('paused', 'paused intent', { command: 'demo' });
    store.update('paused', draft => { draft.session.status = 'paused'; });
    const fence = store.readBundle('paused').session;
    const result = await recallRuns(root, { command: 'demo', intent: 'paused intent', asOf: '2026-07-19T00:00:00.000Z' });
    expect(result.next.command).toContain('maestro session resume --session paused');
    expect(result.next.command).toContain(`--expected-identity-revision ${fence.identity_revision}`);
    expect(result.next.command).toContain(`--expected-activity-revision ${fence.activity_revision}`);
    expect(result.next.command).not.toContain('recall-confirm');
  });
});
