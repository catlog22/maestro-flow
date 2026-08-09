import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractCode } from '../extraction/code/code-extractor.js';
import {
  EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
  ExternalSurfaceManifestError,
  ExternalSurfaceManifestValidationFailure,
} from '../extraction/code/external/external-surface-manifest.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-exact-scan-'));
  roots.push(root);
  mkdirSync(join(root, '.workflow', 'kg'), { recursive: true });
  return root;
}

function writeManifest(root: string, files: unknown[]): void {
  writeFileSync(join(root, '.workflow', 'kg', 'external-surfaces.json'), JSON.stringify({
    schema_version: EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
    files,
  }, null, 2));
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('exact external file scan', () => {
  it('indexes only the listed ignored header and never follows its imports or plugin', async () => {
    const root = makeProject();
    const podDir = join(root, 'Pods', 'Module');
    mkdirSync(podDir, { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'Pods/\n');
    writeFileSync(join(root, '.maestroignore'), 'Vendor/\n');
    const exactPath = join(podDir, 'A.h');
    const siblingPath = join(podDir, 'B.h');
    writeFileSync(exactPath, [
      '#import "B.h"',
      '@interface ExternalBase : NSObject',
      '@end',
      '',
    ].join('\n'));
    writeFileSync(siblingPath, '@interface UnlistedSibling : NSObject\n@end\n');
    writeFileSync(join(root, 'Visible.swift'), 'class Visible {}\n');

    writeManifest(root, [{
      module: 'Module',
      language: 'objc',
      path: 'Pods/Module/A.h',
    }]);

    const loadedSentinelPath = join(root, 'plugin-loaded');
    const runSentinelPath = join(root, 'plugin-ran');
    const extractorDir = join(root, '.workflow', 'kg', 'extractors');
    mkdirSync(extractorDir, { recursive: true });
    writeFileSync(join(root, '.workflow', 'kg', 'extractors.yaml'), JSON.stringify({
      version: 1,
      defaults: { onError: 'fail' },
      plugins: [{
        id: 'must-not-run-for-external',
        languages: ['objc'],
        filePatterns: ['Pods/**/*.h'],
        mode: 'script',
        script: { module: 'sentinel.mjs' },
      }],
    }));
    writeFileSync(join(extractorDir, 'sentinel.mjs'), [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(loadedSentinelPath)}, 'loaded');`,
      'export function extract() {',
      `  writeFileSync(${JSON.stringify(runSentinelPath)}, 'ran');`,
      "  return { symbols: [], references: [], edges: [] };",
      '}',
      '',
    ].join('\n'));

    const { results, stats } = await extractCode({
      projectRoot: root,
      srcDir: root,
      includeTests: true,
      createMaestroIgnore: false,
      allowExtractorScripts: true,
    });

    expect(stats.filesScanned).toBe(2);
    expect(results).toHaveLength(2);
    const externalResult = results.find(result => result.fileRecord.path === realpathSync(exactPath));
    expect(externalResult?.fileRecord.language).toBe('objc');
    expect(externalResult?.nodes.length).toBeGreaterThan(0);
    expect(externalResult?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'ExternalBase',
        language: 'objc',
        metadata: expect.objectContaining({
          externalSurface: true,
          module: 'Module',
          language: 'objc',
          externalSurfacePath: 'Pods/Module/A.h',
          externalSurfaceSchemaVersion: EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
        }),
      }),
    ]));
    expect(externalResult?.references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        referenceKind: 'imports',
        referenceName: 'B.h',
        filePath: realpathSync(exactPath),
        language: 'objc',
      }),
    ]));
    expect(results.flatMap(result => result.nodes).some(node => node.name === 'UnlistedSibling')).toBe(false);
    expect(results.some(result => result.fileRecord.path === realpathSync(siblingPath))).toBe(false);
    expect(existsSync(loadedSentinelPath)).toBe(true);
    expect(existsSync(runSentinelPath)).toBe(false);
  });

  it('does not recurse an ignored 7,515-file Pods root to collect one exact header', async () => {
    const root = makeProject();
    const podDir = join(root, 'Pods', 'HugeFramework');
    mkdirSync(podDir, { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'Pods/\n');
    writeFileSync(join(root, '.maestroignore'), 'Pods/\n');
    const exactPath = join(podDir, 'Header0.h');
    for (let index = 0; index < 7_515; index++) {
      writeFileSync(
        join(podDir, `Header${index}.h`),
        index === 0
          ? '@interface OnlyExactHeader : NSObject\n@end\n'
          : `@interface IgnoredHeader${index} : NSObject\n@end\n`,
      );
    }
    writeManifest(root, [{
      module: 'HugeFramework',
      language: 'objc',
      path: 'Pods/HugeFramework/Header0.h',
    }]);

    const { results, stats } = await extractCode({
      projectRoot: root,
      srcDir: root,
      createMaestroIgnore: false,
    });

    expect(stats.filesScanned).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0].fileRecord.path).toBe(realpathSync(exactPath));
    expect(results.flatMap(result => result.nodes).map(node => node.name))
      .toContain('OnlyExactHeader');
    expect(results.flatMap(result => result.nodes).some(node => node.name.startsWith('IgnoredHeader')))
      .toBe(false);
  });

  it('fails before progress or extraction when the fixed manifest is unsafe', async () => {
    const root = makeProject();
    writeFileSync(join(root, 'Visible.swift'), 'class Visible {}\n');
    writeManifest(root, [{
      module: 'Module',
      language: 'objc',
      path: '../Escape.h',
    }]);
    const progress: string[] = [];

    await expect(extractCode({
      projectRoot: root,
      srcDir: root,
      onProgress: file => { progress.push(file); },
    })).rejects.toBeInstanceOf(ExternalSurfaceManifestValidationFailure);
    expect(progress).toEqual([]);
    expect(existsSync(join(root, '.maestroignore'))).toBe(false);
  });

  it('fails closed when an exact file identity is replaced after collection', async () => {
    const root = makeProject();
    const outsideRoot = makeProject();
    const exactDir = join(root, 'Pods', 'Module');
    const exactPath = join(exactDir, 'A.h');
    const outsidePath = join(outsideRoot, 'Outside.h');
    mkdirSync(exactDir, { recursive: true });
    writeFileSync(exactPath, '@interface Original : NSObject\n@end\n');
    writeFileSync(outsidePath, '@interface Escaped : NSObject\n@end\n');
    writeFileSync(join(root, '.gitignore'), 'Pods/\n');
    writeManifest(root, [{
      module: 'Module',
      language: 'objc',
      path: 'Pods/Module/A.h',
    }]);

    await expect(extractCode({
      projectRoot: root,
      srcDir: root,
      createMaestroIgnore: false,
      onProgress: file => {
        if (file !== realpathSync(exactPath)) return;
        rmSync(exactPath);
        symlinkSync(outsidePath, exactPath);
      },
    })).rejects.toBeInstanceOf(ExternalSurfaceManifestError);
  });
});
