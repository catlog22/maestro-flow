import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeRepositoryIdentity } from '../../repository/context.js';
import { handler } from '../store-knowhow.js';

describe('store-knowhow atomic creation', () => {
  let root: string;
  let previousRoot: string | undefined;
  let repoId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'maestro-store-knowhow-'));
    previousRoot = process.env.MAESTRO_PROJECT_ROOT;
    process.env.MAESTRO_PROJECT_ROOT = root;
    repoId = initializeRepositoryIdentity(root, { repoName: 'Test repo' }).repo_id;
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.MAESTRO_PROJECT_ROOT;
    else process.env.MAESTRO_PROJECT_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  it('writes canonical-only metadata while accepting legacy aliases', async () => {
    const result = await handler({
      operation: 'add',
      type: 'decision',
      title: 'Canonical payload',
      body: 'First useful paragraph.\n\nMore detail.',
      keywords: ['auth'],
      tags: ['security'],
      category: 'architecture-decision',
      specCategory: 'arch',
      source: 'issue:42',
      lang: 'typescript',
      status: 'accepted',
      assetType: 'api-contract',
      codePaths: ['src/auth/token.ts'],
      appliesToRepoIds: [repoId],
      tool: true,
    });

    expect(result.success).toBe(true);
    const filename = (result.result as { filename: string }).filename;
    const document = readFileSync(join(root, '.workflow', 'knowhow', filename), 'utf-8');
    expect(document).toContain('category: arch');
    expect(document).toContain('keywords:\n  - auth\n  - security\n  - architecture-decision\n  - api-contract');
    expect(document).toContain('sourceRef: "issue:42"');
    expect(document).toContain('language: typescript');
    expect(document).toContain('decisionState: accepted');
    expect(document).toContain('lifecycleStatus: active');
    expect(document).toContain('relatedPaths:\n  - src/auth/token.ts');
    expect(document).toContain(`appliesToRepoIds:\n  - ${repoId}`);
    expect(document).not.toMatch(/^tags:/m);
    expect(document).not.toMatch(/^specCategory:/m);
    expect(document).not.toMatch(/^source:/m);
    expect(document).not.toMatch(/^lang:/m);
    expect(document).not.toMatch(/^status:/m);
    expect(document).not.toMatch(/^assetType:/m);
    expect(document).not.toMatch(/^codePaths:/m);
  });

  it('accepts project-relative related paths for every Knowhow type', async () => {
    const result = await handler({
      operation: 'add',
      type: 'tip',
      title: 'Related tip',
      content: 'Applies to a source path.',
      relatedPaths: ['src\\utils\\frontmatter.ts'],
    });

    expect(result.success).toBe(true);
    const filename = (result.result as { filename: string }).filename;
    const document = readFileSync(join(root, '.workflow', 'knowhow', filename), 'utf-8');
    expect(document).toContain('  - src/utils/frontmatter.ts');
  });

  it.each(['/absolute/file.ts', '../outside.ts', 'C:\\absolute\\file.ts'])(
    'rejects non-project-relative related path %s',
    async (relatedPath) => {
      const result = await handler({
        operation: 'add',
        type: 'tip',
        title: `Invalid ${relatedPath}`,
        content: 'Must reject invalid paths.',
        relatedPaths: [relatedPath],
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/project-relative|traverse outside/);
    },
  );

  it('rejects an unknown target repository ID without mutation', async () => {
    const result = await handler({
      operation: 'add',
      targetRepoId: '00000000-0000-4000-8000-000000000000',
      type: 'tip',
      title: 'Must not write',
      content: 'Unknown target.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
    expect(existsSync(join(root, '.workflow', 'knowhow'))).toBe(false);
  });

  it('writes to an explicitly authorized linked repository and fails closed after revocation', async () => {
    const linkedRoot = mkdtempSync(join(tmpdir(), 'maestro-store-knowhow-linked-'));
    try {
      const linkedId = initializeRepositoryIdentity(linkedRoot, { repoName: 'Linked' }).repo_id;
      const configPath = join(root, '.workflow', 'config.json');
      const writeConfig = (write: string[]) => writeFileSync(configPath, JSON.stringify({
        workspaces: { linked: [{
          name: 'library', path: linkedRoot, repo_id: linkedId,
          share: ['knowhow'], write,
        }] },
      }));
      writeConfig(['knowhow']);
      const created = await handler({
        operation: 'add', targetRepoId: linkedId, explicitId: 'tip-20260901-linked-write',
        type: 'tip', title: 'Linked write', content: 'Authorized content.',
        appliesToRepoIds: [linkedId],
      });
      expect(created.success).toBe(true);
      const file = join(linkedRoot, '.workflow', 'knowhow', 'TIP-20260901-linked-write.md');
      const document = readFileSync(file, 'utf8');
      expect(document).toContain(`appliesToRepoIds:\n  - ${linkedId}`);
      expect(document).not.toMatch(/library|workspaceId|linkedRoot/);

      writeConfig([]);
      const before = readdirSync(join(linkedRoot, '.workflow', 'knowhow'));
      const denied = await handler({
        operation: 'add', targetRepoId: linkedId, explicitId: 'tip-20260901-revoked',
        type: 'tip', title: 'Revoked', content: 'Must not appear.',
      });
      expect(denied.success).toBe(false);
      expect(denied.error).toContain('does not grant write capability');
      expect(readdirSync(join(linkedRoot, '.workflow', 'knowhow'))).toEqual(before);
    } finally {
      rmSync(linkedRoot, { recursive: true, force: true });
    }
  });

  it('keeps linked lifecycle supersede within one explicitly authorized target', async () => {
    const linkedRoot = mkdtempSync(join(tmpdir(), 'maestro-store-knowhow-lifecycle-linked-'));
    try {
      const linkedId = initializeRepositoryIdentity(linkedRoot, { repoName: 'Linked' }).repo_id;
      writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
        workspaces: { linked: [{
          name: 'library', path: linkedRoot, repo_id: linkedId,
          share: ['knowhow'], write: ['knowhow'],
        }] },
      }));
      for (const stem of ['tip-20260901-old', 'tip-20260901-new']) {
        expect((await handler({
          operation: 'add', targetRepoId: linkedId, explicitId: stem,
          type: 'tip', title: stem, content: `${stem} content`,
        })).success).toBe(true);
      }
      const oldId = 'knowhow-tip-20260901-old';
      const newId = 'knowhow-tip-20260901-new';
      const superseded = await handler({
        operation: 'supersede', targetRepoId: linkedId, oldId, newId,
      });
      expect(superseded.success).toBe(true);
      const history = await handler({ operation: 'history', targetRepoId: linkedId, id: oldId });
      expect(history).toMatchObject({
        success: true,
        result: { entries: [{ id: oldId }, { id: newId }] },
      });

      expect((await handler({
        operation: 'add', explicitId: 'tip-20260901-current-only',
        type: 'tip', title: 'Current only', content: 'Different repository.',
      })).success).toBe(true);
      const oldBefore = readFileSync(
        join(linkedRoot, '.workflow', 'knowhow', 'TIP-20260901-old.md'), 'utf8',
      );
      const crossRepo = await handler({
        operation: 'supersede', targetRepoId: linkedId, oldId: newId,
        newId: 'knowhow-tip-20260901-current-only',
      });
      expect(crossRepo.success).toBe(false);
      expect(crossRepo.error).toContain('not found');
      expect(readFileSync(
        join(linkedRoot, '.workflow', 'knowhow', 'TIP-20260901-old.md'), 'utf8',
      )).toBe(oldBefore);
    } finally {
      rmSync(linkedRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects a linked knowhow symlink escape without changing the outside directory', async () => {
    const linkedRoot = mkdtempSync(join(tmpdir(), 'maestro-store-knowhow-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'maestro-store-knowhow-outside-'));
    try {
      const linkedId = initializeRepositoryIdentity(linkedRoot, { repoName: 'Linked' }).repo_id;
      try {
        symlinkSync(outside, join(linkedRoot, '.workflow', 'knowhow'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return;
      }
      writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
        workspaces: { linked: [{
          name: 'library', path: linkedRoot, repo_id: linkedId,
          share: ['knowhow'], write: ['knowhow'],
        }] },
      }));
      const result = await handler({
        operation: 'add', targetRepoId: linkedId, explicitId: 'tip-20260901-escape',
        type: 'tip', title: 'Escape', content: 'Must not appear.',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symbolic link|junction/);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(linkedRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('replay equality includes canonical lifecycle and applicability fields', async () => {
    const id = 'tip-20260901-replay-fields';
    const base = {
      operation: 'add', type: 'tip', explicitId: id, title: 'Replay fields',
      content: 'Canonical content.', appliesToRepoIds: [repoId], lifecycleStatus: 'active',
    } as const;
    expect((await handler(base)).success).toBe(true);
    expect((await handler(base)).success).toBe(true);

    const conflict = await handler({ ...base, lifecycleStatus: 'deprecated' });
    expect(conflict.success).toBe(false);
    expect(conflict.error).toContain('CALLER_PAYLOAD_CONFLICT');
  });

  it('does not overwrite an existing same-day entry with the same title', async () => {
    const first = await handler({
      operation: 'add',
      type: 'tip',
      title: 'Atomic lifecycle policy',
      body: 'original body',
    });
    const second = await handler({
      operation: 'add',
      type: 'tip',
      title: 'Atomic lifecycle policy',
      body: 'replacement body',
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.error).toContain('already exists');

    const filename = (first.result as { filename: string }).filename;
    const filePath = join(root, '.workflow', 'knowhow', filename);
    expect(readFileSync(filePath, 'utf-8')).toContain('original body');
    expect(readFileSync(filePath, 'utf-8')).not.toContain('replacement body');
    expect(existsSync(`${filePath}.lock`)).toBe(false);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });
});
