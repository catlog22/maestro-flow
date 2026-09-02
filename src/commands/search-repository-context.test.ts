import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../search/daemon-client.js', () => ({
  tryDaemonSearch: vi.fn(async () => null),
  spawnDaemon: vi.fn(async () => undefined),
  readDaemonInfo: vi.fn(() => null),
}));

import { initializeRepositoryIdentity } from '../repository/context.js';
import { runUnifiedSearch } from './search.js';

const originalCwd = process.cwd();
const roots: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRepository(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `maestro-search-${name}-`));
  roots.push(root);
  mkdirSync(join(root, '.workflow', 'knowhow'), { recursive: true });
  initializeRepositoryIdentity(root, { repoName: name });
  return root;
}

describe('search repository context', () => {
  it('uses the nearest root from nested cwd and drops cached linked entries after read revocation', async () => {
    const root = makeRepository('host');
    const linkedRoot = makeRepository('linked');
    const linkedIdentity = initializeRepositoryIdentity(linkedRoot);
    const configPath = join(root, '.workflow', 'config.json');
    const link = {
      name: 'library',
      path: linkedRoot,
      repo_id: linkedIdentity.repo_id,
      share: ['knowhow'],
    };
    writeFileSync(configPath, JSON.stringify({ workspaces: { linked: [link] } }, null, 2));
    writeFileSync(
      join(linkedRoot, '.workflow', 'knowhow', 'TIP-revoked-cache.md'),
      '---\ntitle: Revoked cache sentinel\ncategory: security\n---\n\nrevoked cache sentinel authorization',
    );
    const nested = join(root, 'packages', 'feature', 'src');
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);

    const beforeRevocation = await runUnifiedSearch('revoked cache sentinel authorization', {
      limit: 20,
      skipEmbedding: true,
      deferImpressions: true,
    });
    expect(beforeRevocation).toContainEqual(expect.objectContaining({
      title: 'Revoked cache sentinel',
      workspace: 'library',
    }));

    writeFileSync(configPath, JSON.stringify({
      workspaces: { linked: [{ ...link, share: [] }] },
    }, null, 2));

    const afterRevocation = await runUnifiedSearch('revoked cache sentinel authorization', {
      limit: 20,
      skipEmbedding: true,
      deferImpressions: true,
    });
    expect(afterRevocation.map(result => result.title)).not.toContain('Revoked cache sentinel');
  });
});
