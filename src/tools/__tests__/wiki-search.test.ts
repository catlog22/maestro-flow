import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../search/daemon-client.js', () => ({
  tryDaemonSearch: vi.fn(async () => null),
  spawnDaemon: vi.fn(async () => undefined),
}));

import { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import { handler as wikiSearch } from '../wiki-search.js';

const REPO_A = '11111111-1111-4111-8111-111111111111';
const REPO_B = '22222222-2222-4222-8222-222222222222';
const REPO_C = '33333333-3333-4333-8333-333333333333';
const REPO_D = '44444444-4444-4444-8444-444444444444';
const roots: string[] = [];
const originalCwd = process.cwd();

function repo(name: string, id: string): string {
  const root = mkdtempSync(join(tmpdir(), `maestro-applicability-${name}-`));
  roots.push(root);
  const workflow = join(root, '.workflow');
  mkdirSync(join(workflow, 'knowhow'), { recursive: true });
  writeFileSync(join(workflow, 'repository.json'), JSON.stringify({
    schema_version: 'repository-identity/1.0', repo_id: id, repo_name: name,
    created_at: '2026-01-01T00:00:00.000Z',
  }));
  return workflow;
}

function knowhow(
  workflow: string,
  file: string,
  applies?: string[],
  title = 'Shared sentinel',
): void {
  const applicability = applies
    ? `appliesToRepoIds:\n${applies.map(id => `  - ${id}`).join('\n')}\n`
    : '';
  writeFileSync(join(workflow, 'knowhow', file), `---\ntitle: ${title}\ncategory: coding\n${applicability}---\n\nrepository applicability sentinel`);
}

afterEach(() => {
  process.chdir(originalCwd);
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('wiki-search cached authority', () => {
  it('refreshes cached linked entries after identity, path, and sharing changes', async () => {
    const hostWorkflow = repo('host', REPO_B);
    const linkedWorkflow = repo('linked', REPO_A);
    const replacementWorkflow = repo('replacement', REPO_D);
    const hostRoot = join(hostWorkflow, '..');
    const linkedRoot = join(linkedWorkflow, '..');
    const replacementRoot = join(replacementWorkflow, '..');
    knowhow(linkedWorkflow, 'TIP-revoked.md');
    knowhow(replacementWorkflow, 'TIP-replacement.md', undefined, 'Replacement sentinel');
    const link = {
      name: 'library',
      path: linkedRoot,
      repo_id: REPO_A,
      share: ['knowhow'],
    };
    const configPath = join(hostWorkflow, 'config.json');
    writeFileSync(configPath, JSON.stringify({ workspaces: { linked: [link] } }, null, 2));
    process.chdir(hostRoot);

    const before = await wikiSearch({
      query: 'repository applicability sentinel',
      limit: 20,
      skipEmbedding: true,
    });
    expect(before.success).toBe(true);
    expect((before.result as { results: Array<{ title: string; alias: string }> }).results)
      .toContainEqual(expect.objectContaining({ title: 'Shared sentinel', alias: 'library' }));

    // A changed live identity invalidates the cached repo_id advertised by the
    // host link, so the old linked entries must disappear immediately.
    writeFileSync(join(linkedWorkflow, 'repository.json'), JSON.stringify({
      schema_version: 'repository-identity/1.0', repo_id: REPO_C, repo_name: 'linked-reseeded',
      created_at: '2026-01-02T00:00:00.000Z',
    }));
    const afterIdentityChange = await wikiSearch({
      query: 'repository applicability sentinel', limit: 20, skipEmbedding: true,
    });
    expect((afterIdentityChange.result as { results: Array<{ title: string }> }).results.map(result => result.title))
      .not.toContain('Shared sentinel');

    // Repointing the same alias to a newly authorized repository must rebuild
    // the index instead of retaining entries from the previous path.
    const replacementLink = {
      ...link,
      path: replacementRoot,
      repo_id: REPO_D,
    };
    writeFileSync(configPath, JSON.stringify({
      workspaces: { linked: [replacementLink] },
    }, null, 2));
    const afterPathChange = await wikiSearch({
      query: 'repository applicability sentinel', limit: 20, skipEmbedding: true,
    });
    const pathTitles = (afterPathChange.result as { results: Array<{ title: string }> }).results
      .map(result => result.title);
    expect(pathTitles).toContain('Replacement sentinel');
    expect(pathTitles).not.toContain('Shared sentinel');

    writeFileSync(configPath, JSON.stringify({
      workspaces: { linked: [{ ...replacementLink, share: [] }] },
    }, null, 2));
    const afterRevocation = await wikiSearch({
      query: 'repository applicability sentinel', limit: 20, skipEmbedding: true,
    });
    expect(afterRevocation.success).toBe(true);
    expect((afterRevocation.result as { results: Array<{ title: string }> }).results.map(result => result.title))
      .not.toContain('Replacement sentinel');
  });
});

describe('wiki repository applicability', () => {
  it('filters scoped entries by target repo while retaining legacy-unscoped visibility and stable fences', async () => {
    const a = repo('A', REPO_A);
    const b = repo('B', REPO_B);
    knowhow(a, 'TIP-a-only.md', [REPO_A]);
    knowhow(a, 'TIP-both.md', [REPO_A, REPO_B]);
    knowhow(a, 'TIP-legacy.md');

    const indexer = new WikiIndexer({
      workflowRoot: b,
      persistence: 'memory-only',
      linkedWorkspaces: [{ name: 'a', workflowRoot: a, shareTypes: ['knowhow'], repoId: REPO_A, repoName: 'A' }],
    });
    const index = await indexer.get();
    const linked = index.entries.filter(entry => entry.source.workspace === 'a');
    expect(linked.every(entry => entry.repoId === REPO_A && entry.workspaceFence === `repo:${REPO_A}`)).toBe(true);

    const forB = await indexer.search('repository applicability sentinel', 20, {
      skipEmbedding: true,
      filters: { applicableRepoId: REPO_B },
    });
    expect(forB.map(entry => entry.id)).toEqual(expect.arrayContaining([
      'ws:a:knowhow-tip-both',
      'ws:a:knowhow-tip-legacy',
    ]));
    expect(forB.map(entry => entry.id)).not.toContain('ws:a:knowhow-tip-a-only');

    const forA = await indexer.search('repository applicability sentinel', 20, {
      skipEmbedding: true,
      filters: { repoId: REPO_A, applicableRepoId: REPO_A },
    });
    expect(forA.map(entry => entry.id)).toEqual(expect.arrayContaining([
      'ws:a:knowhow-tip-a-only',
      'ws:a:knowhow-tip-both',
      'ws:a:knowhow-tip-legacy',
    ]));
  });
});
