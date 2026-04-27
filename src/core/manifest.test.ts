// ---------------------------------------------------------------------------
// manifest.test.ts — tests for manifest creation with install options
// ---------------------------------------------------------------------------

import { describe, it, expect, afterAll } from 'vitest';
import { createManifest, saveManifest, getAllManifests } from './manifest.js';
import { paths } from '../config/paths.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

describe('createManifest', () => {
  it('should store hookLevel and selectedComponentIds', () => {
    const m = createManifest('global', paths.home, {
      hookLevel: 'full',
      selectedComponentIds: ['workflows', 'commands', 'skills'],
    });

    expect(m.scope).toBe('global');
    expect(m.targetPath).toBe(paths.home);
    expect(m.hookLevel).toBe('full');
    expect(m.selectedComponentIds).toEqual(['workflows', 'commands', 'skills']);
  });

  it('should omit options when not provided', () => {
    const m = createManifest('project', '/tmp/test-project');

    expect(m.hookLevel).toBeUndefined();
    expect(m.selectedComponentIds).toBeUndefined();
  });

  it('should store hookLevel with none', () => {
    const m = createManifest('global', paths.home, { hookLevel: 'none' });

    expect(m.hookLevel).toBe('none');
  });
});

describe('manifest save/load round-trip', () => {
  // Use a temp directory to avoid affecting real manifests
  const testDir = join(paths.home, 'manifests');
  let savedIds: string[] = [];

  it('should persist and restore hookLevel and selectedComponentIds', () => {
    const m = createManifest('global', paths.home, {
      hookLevel: 'standard',
      selectedComponentIds: ['workflows', 'commands', 'agents', 'skills'],
    });
    m.entries.push({ path: '/tmp/test/a.txt', type: 'file' });

    // Save
    const fp = saveManifest(m);
    savedIds.push(m.id);
    expect(existsSync(fp)).toBe(true);

    // Reload
    const all = getAllManifests();
    const reloaded = all.find(x => x.id === m.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.hookLevel).toBe('standard');
    expect(reloaded!.selectedComponentIds).toEqual(['workflows', 'commands', 'agents', 'skills']);
    expect(reloaded!.scope).toBe('global');
    expect(reloaded!.targetPath).toBe(paths.home);
  });

  it('should handle manifests without hookLevel (backward compat)', () => {
    // Simulate older manifest format by creating one without opts
    const m = createManifest('project', '/tmp/legacy-project');
    m.entries.push({ path: '/tmp/legacy/a.txt', type: 'file' });
    const fp = saveManifest(m);
    savedIds.push(m.id);

    const all = getAllManifests();
    const reloaded = all.find(x => x.id === m.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.hookLevel).toBeUndefined();
    expect(reloaded!.selectedComponentIds).toBeUndefined();
  });

  // Cleanup
  afterAll(() => {
    for (const id of savedIds) {
      const fp = join(testDir, `${id}.json`);
      if (existsSync(fp)) unlinkSync(fp);
    }
  });
});
