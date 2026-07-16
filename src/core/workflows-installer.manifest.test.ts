import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalMaestroHome = process.env.MAESTRO_HOME;
const testHome = mkdtempSync(join(tmpdir(), 'maestro-workflows-manifest-test-'));
const packageRoot = join(testHome, 'package');
let installer: typeof import('./workflows-installer.js');
let manifestApi: typeof import('./manifest.js');

beforeAll(async () => {
  process.env.MAESTRO_HOME = testHome;
  for (const dir of ['workflows', 'prepare', 'ref']) {
    mkdirSync(join(packageRoot, dir), { recursive: true });
    writeFileSync(join(packageRoot, dir, `${dir}.md`), dir);
  }
  vi.resetModules();
  installer = await import('./workflows-installer.js');
  manifestApi = await import('./manifest.js');
});

afterAll(() => {
  if (originalMaestroHome === undefined) delete process.env.MAESTRO_HOME;
  else process.env.MAESTRO_HOME = originalMaestroHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe('installAllStepContent manifest integration', () => {
  it('merges copied ownership while preserving target-only files and prior state', () => {
    const targetOnly = join(testHome, 'workflows', 'custom-global-only.md');
    mkdirSync(join(testHome, 'workflows'), { recursive: true });
    writeFileSync(targetOnly, 'keep');

    const prior = manifestApi.createManifest('global', testHome, {
      selectedComponentIds: ['commands'],
    });
    manifestApi.saveManifest(prior);

    installer.installAllStepContent(packageRoot);

    const current = manifestApi.findManifest('global', testHome);
    expect(current?.selectedComponentIds).toEqual(
      expect.arrayContaining(['commands', 'workflows', 'prepare', 'ref']),
    );
    expect(current?.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        join(testHome, 'workflows', 'workflows.md'),
        join(testHome, 'prepare', 'prepare.md'),
        join(testHome, 'ref', 'ref.md'),
      ]),
    );
    expect(current?.entries.some((entry) => entry.path === targetOnly)).toBe(false);
    expect(existsSync(targetOnly)).toBe(true);
  });
});
