// ---------------------------------------------------------------------------
// manifest.test.ts — tests for manifest creation with install options
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalMaestroHome = process.env.MAESTRO_HOME;
const testHome = mkdtempSync(join(tmpdir(), 'maestro-manifest-test-'));
let manifestApi: typeof import('./manifest.js');

beforeAll(async () => {
  process.env.MAESTRO_HOME = testHome;
  vi.resetModules();
  manifestApi = await import('./manifest.js');
});

afterAll(() => {
  if (originalMaestroHome === undefined) delete process.env.MAESTRO_HOME;
  else process.env.MAESTRO_HOME = originalMaestroHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe('createManifest', () => {
  it('should store hookLevel and selectedComponentIds', () => {
    const m = manifestApi.createManifest('global', testHome, {
      hookLevel: 'full',
      selectedComponentIds: ['workflows', 'commands', 'skills'],
    });

    expect(m.scope).toBe('global');
    expect(m.targetPath).toBe(testHome);
    expect(m.hookLevel).toBe('full');
    expect(m.selectedComponentIds).toEqual(['workflows', 'commands', 'skills']);
  });

  it('should omit options when not provided', () => {
    const m = manifestApi.createManifest('project', '/tmp/test-project');

    expect(m.hookLevel).toBeUndefined();
    expect(m.selectedComponentIds).toBeUndefined();
  });

  it('should store hookLevel with none', () => {
    const m = manifestApi.createManifest('global', testHome, { hookLevel: 'none' });

    expect(m.hookLevel).toBe('none');
  });
});

describe('manifest save/load round-trip', () => {
  it('should persist and restore hookLevel and selectedComponentIds', () => {
    const m = manifestApi.createManifest('global', testHome, {
      hookLevel: 'standard',
      selectedComponentIds: ['workflows', 'commands', 'agents', 'skills'],
    });
    m.entries.push({ path: '/tmp/test/a.txt', type: 'file' });

    // Save
    const fp = manifestApi.saveManifest(m);
    expect(existsSync(fp)).toBe(true);

    // Reload
    const all = manifestApi.getAllManifests();
    const reloaded = all.find(x => x.id === m.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.hookLevel).toBe('standard');
    expect(reloaded!.selectedComponentIds).toEqual(['workflows', 'commands', 'agents', 'skills']);
    expect(reloaded!.scope).toBe('global');
    expect(reloaded!.targetPath).toBe(testHome);
  });

  it('should handle manifests without hookLevel (backward compat)', () => {
    // Simulate older manifest format by creating one without opts
    const m = manifestApi.createManifest('project', '/tmp/legacy-project');
    m.entries.push({ path: '/tmp/legacy/a.txt', type: 'file' });
    manifestApi.saveManifest(m);

    const all = manifestApi.getAllManifests();
    const reloaded = all.find(x => x.id === m.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.hookLevel).toBeUndefined();
    expect(reloaded!.selectedComponentIds).toBeUndefined();
  });

  it('does not delete a previous manifest until the replacement is durable', () => {
    const first = manifestApi.createManifest('global', testHome, {
      selectedComponentIds: ['workflows'],
    });
    const firstPath = manifestApi.saveManifest(first);

    const second = manifestApi.createManifest('global', testHome, {
      selectedComponentIds: ['workflows', 'commands'],
    });
    const secondPath = manifestApi.saveManifest(second);

    expect(existsSync(secondPath)).toBe(true);
    expect(existsSync(firstPath)).toBe(false);
    expect(manifestApi.findManifest('global', testHome)?.selectedComponentIds)
      .toEqual(['workflows', 'commands']);
  });

  it('rejects a stale compare-and-swap update', () => {
    const first = manifestApi.createManifest('global', testHome, {
      selectedComponentIds: ['workflows'],
    });
    manifestApi.saveManifest(first);

    const second = manifestApi.createManifest('global', testHome, {
      selectedComponentIds: ['workflows', 'commands'],
    });
    manifestApi.saveManifest(second, { expectedPriorId: first.id });

    const stale = manifestApi.createManifest('global', testHome, {
      selectedComponentIds: ['templates'],
    });
    expect(() => manifestApi.saveManifest(stale, { expectedPriorId: first.id }))
      .toThrow(/changed concurrently/);
    expect(manifestApi.findManifest('global', testHome)?.id).toBe(second.id);
  });

  it('ignores overlay JSON stored beside installation manifests', () => {
    const overlayPath = join(testHome, 'manifests', 'overlays-global.json');
    writeFileSync(overlayPath, JSON.stringify({ version: '1.0', scope: 'global' }));

    manifestApi.getAllManifests();

    expect(existsSync(overlayPath)).toBe(true);
  });
});
