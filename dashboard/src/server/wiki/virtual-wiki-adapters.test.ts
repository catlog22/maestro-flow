import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCodexSessions } from './virtual-wiki-adapters.js';

const roots: string[] = [];

async function writeSession(
  codexRoot: string,
  name: string,
  rows: unknown[],
  modifiedAt: Date,
): Promise<void> {
  const directory = join(codexRoot, 'sessions', '2026', '09', '02');
  await mkdir(directory, { recursive: true });
  const file = join(directory, name);
  await writeFile(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  await utimes(file, modifiedAt, modifiedAt);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Codex session loading', () => {
  it('continues past invalid matching candidates until maxFiles valid entries are produced', async () => {
    const codexRoot = await mkdtemp(join(tmpdir(), 'codex-session-scan-'));
    roots.push(codexRoot);
    const project = 'D:/workspace/project';

    await writeSession(codexRoot, 'newest-invalid.jsonl', [
      { type: 'session_meta', payload: { id: 'invalid', cwd: project } },
    ], new Date('2026-09-02T03:00:00.000Z'));
    await writeSession(codexRoot, 'older-valid.jsonl', [
      { type: 'session_meta', timestamp: '2026-09-02T01:00:00.000Z', payload: { id: 'valid', cwd: project } },
      { type: 'event_msg', timestamp: '2026-09-02T01:01:00.000Z', payload: { type: 'user_message', message: 'Investigate Maestro Search startup latency' } },
    ], new Date('2026-09-02T02:00:00.000Z'));

    const entries = await loadCodexSessions(codexRoot, project, 365, 1);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'cdx-session-valid',
      sourceRef: 'valid',
      category: 'session',
    });
  });
});
