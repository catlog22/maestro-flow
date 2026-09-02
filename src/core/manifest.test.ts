// ---------------------------------------------------------------------------
// manifest.test.ts — tests for manifest creation with install options
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// cleanManifestFiles — content-managed cleanup safety (issue #24)
// ---------------------------------------------------------------------------

describe('cleanManifestFiles content-managed safety', () => {
  const dirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-clean-'));
    dirs.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function cleanupManifest(entries: Array<{ path: string; type: 'file' | 'dir'; hash?: string }>) {
    const m = manifestApi.createManifest('project', tempDir(), {});
    m.entries = entries;
    return manifestApi.cleanManifestFiles(m);
  }

  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

  it('preserves a marker-free user file instead of deleting it', () => {
    const dir = tempDir();
    const fp = join(dir, 'AGENTS.md');
    writeFileSync(fp, '# My own instructions\n');

    const result = cleanupManifest([{ path: fp, type: 'file' }]);

    expect(result.preserved).toBe(1);
    expect(result.removed).toBe(0);
    expect(existsSync(fp)).toBe(true);
    expect(readFileSync(fp, 'utf8')).toBe('# My own instructions\n');
  });

  it('removes only Maestro sections from a mixed user file', () => {
    const dir = tempDir();
    const fp = join(dir, 'AGENTS.md');
    writeFileSync(fp, [
      '# User section',
      '',
      '<!-- maestro:start section="core" -->',
      '# Maestro content',
      '<!-- maestro:end section="core" -->',
      '',
    ].join('\n'));

    const result = cleanupManifest([{ path: fp, type: 'file' }]);

    expect(result.removed).toBe(1);
    expect(existsSync(fp)).toBe(true);
    const after = readFileSync(fp, 'utf8');
    expect(after).toContain('# User section');
    expect(after).not.toContain('maestro:start');
    expect(after).not.toContain('maestro:end');
  });

  it('removes Maestro sections from a hash-mismatched mixed user file', () => {
    const dir = tempDir();
    const fp = join(dir, 'AGENTS.md');
    const installed = [
      '# Original user section',
      '',
      '<!-- maestro:start section="core" -->',
      '# Maestro content',
      '<!-- maestro:end section="core" -->',
      '',
    ].join('\n');
    writeFileSync(fp, installed.replace('# Original user section', '# User section edited after install'));

    const result = cleanupManifest([{ path: fp, type: 'file', hash: sha256(installed) }]);

    expect(result.removed).toBe(1);
    expect(result.preserved).toBe(0);
    expect(existsSync(fp)).toBe(true);
    const after = readFileSync(fp, 'utf8');
    expect(after).toContain('# User section edited after install');
    expect(after).not.toContain('Maestro content');
    expect(after).not.toContain('maestro:start');
  });

  it('deletes a file containing only Maestro sections', () => {
    const dir = tempDir();
    const fp = join(dir, 'AGENTS.md');
    writeFileSync(fp, [
      '<!-- maestro:start section="core" -->',
      '# Maestro content',
      '<!-- maestro:end section="core" -->',
      '',
    ].join('\n'));

    const result = cleanupManifest([{ path: fp, type: 'file' }]);

    expect(result.removed).toBe(1);
    expect(existsSync(fp)).toBe(false);
  });

  it('preserves a file whose content changed since install (hash mismatch)', () => {
    const dir = tempDir();
    const fp = join(dir, 'AGENTS.md');
    const original = '<!-- maestro:start section="core" -->\n# Maestro\n<!-- maestro:end section="core" -->\n';
    writeFileSync(fp, '# user replaced this file\n');

    const result = cleanupManifest([{ path: fp, type: 'file', hash: sha256(original) }]);

    expect(result.preserved).toBe(1);
    expect(result.removed).toBe(0);
    expect(existsSync(fp)).toBe(true);
    expect(readFileSync(fp, 'utf8')).toBe('# user replaced this file\n');
  });

  it('treats copilot-instructions.md as content-managed (not hard-deleted)', () => {
    const dir = tempDir();
    const fp = join(dir, 'copilot-instructions.md');
    writeFileSync(fp, [
      'user note',
      '',
      '<!-- maestro:start section="core" -->',
      '# Maestro',
      '<!-- maestro:end section="core" -->',
      '',
    ].join('\n'));

    const result = cleanupManifest([{ path: fp, type: 'file' }]);

    expect(result.removed).toBe(1);
    expect(existsSync(fp)).toBe(true);
    expect(readFileSync(fp, 'utf8')).toContain('user note');
    expect(readFileSync(fp, 'utf8')).not.toContain('maestro:start');
  });

  it('treats maestro.md as content-managed (not hard-deleted)', () => {
    const dir = tempDir();
    const fp = join(dir, 'maestro.md');
    writeFileSync(fp, [
      'user note',
      '',
      '<!-- maestro:start section="core" -->',
      '# Maestro',
      '<!-- maestro:end section="core" -->',
      '',
    ].join('\n'));

    const result = cleanupManifest([{ path: fp, type: 'file' }]);

    expect(result.removed).toBe(1);
    expect(existsSync(fp)).toBe(true);
    expect(readFileSync(fp, 'utf8')).toContain('user note');
    expect(readFileSync(fp, 'utf8')).not.toContain('maestro:start');
  });

  it('preserves a marker-free copilot-instructions.md', () => {
    const dir = tempDir();
    const fp = join(dir, 'copilot-instructions.md');
    writeFileSync(fp, '# user file\n');

    const result = cleanupManifest([{ path: fp, type: 'file' }]);

    expect(result.preserved).toBe(1);
    expect(existsSync(fp)).toBe(true);
  });

  it('is safe across repeated cleanups of the same stale manifest', () => {
    const dir = tempDir();
    const fp = join(dir, 'AGENTS.md');
    writeFileSync(fp, [
      '# User section',
      '',
      '<!-- maestro:start section="core" -->',
      '# Maestro content',
      '<!-- maestro:end section="core" -->',
      '',
    ].join('\n'));
    const m = manifestApi.createManifest('project', dir, {});
    m.entries = [{ path: fp, type: 'file' }];

    const first = manifestApi.cleanManifestFiles(m);
    expect(first.removed).toBe(1);
    expect(existsSync(fp)).toBe(true);

    // A second cleanup of the same (now stale) manifest must never delete the
    // remaining user content.
    const second = manifestApi.cleanManifestFiles(m);
    expect(existsSync(fp)).toBe(true);
    expect(readFileSync(fp, 'utf8')).toContain('# User section');
    expect(second.preserved).toBeGreaterThan(0);
  });
});
