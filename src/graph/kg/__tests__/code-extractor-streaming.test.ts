import { describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractCode, forEachCodeExtractionResult } from '../extraction/code/code-extractor.js';
import { getTreeSitterEngine } from '../extraction/code/tree-sitter.js';
import type { ExtractionResult } from '../db/types.js';

describe('MaestroGraph code extractor streaming', () => {
  it('emits each extraction result without breaking extractCode compatibility', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-stream-'));
    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'app.yml'), 'service:\n  name: demo\n');

      const streamed: ExtractionResult[] = [];
      const stats = await forEachCodeExtractionResult({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
      }, (result) => {
        streamed.push(result);
      });

      expect(streamed).toHaveLength(1);
      expect(stats.filesScanned).toBe(1);
      expect(stats.filesExtracted).toBe(1);
      expect(stats.nodesCreated).toBe(1);
      expect(stats.edgesCreated).toBe(0);
      expect(streamed[0].fileRecord.nodeCount).toBe(1);

      const collected = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
      });

      expect(collected.results).toHaveLength(1);
      expect(collected.stats.nodesCreated).toBe(stats.nodesCreated);
      expect(collected.results[0].nodes[0].kind).toBe('file');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the content-aware final language for file records and extracted nodes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-header-language-'));
    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'DemoObject.h'), [
        '#import <Foundation/Foundation.h>',
        'typedef struct DemoValue { int raw; } DemoValue;',
        '@interface DemoObject : NSObject',
        '@property(nonatomic) NSInteger value;',
        '- (void)refresh;',
        '@end',
      ].join('\n'));
      writeFileSync(join(srcDir, 'PlainC.h'), [
        'typedef struct PlainC {',
        '  int value;',
        '} PlainC;',
      ].join('\n'));

      const streamed: ExtractionResult[] = [];
      const stats = await forEachCodeExtractionResult({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
      }, result => {
        streamed.push(result);
      });

      expect(stats.filesScanned).toBe(2);
      expect(stats.filesExtracted).toBe(2);

      const objcResult = streamed.find(result => result.fileRecord.path.endsWith('/DemoObject.h'));
      const cResult = streamed.find(result => result.fileRecord.path.endsWith('/PlainC.h'));
      expect(objcResult?.fileRecord.language).toBe('objc');
      expect(objcResult?.nodes.some(node => node.kind === 'class' && node.name === 'DemoObject')).toBe(true);
      expect(objcResult?.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'type_alias', name: 'DemoValue', language: 'c' }),
      ]));
      expect(objcResult?.nodes.length).toBeGreaterThan(0);
      expect(objcResult?.nodes.find(node => node.name === 'DemoObject')?.language).toBe('objc');

      expect(cResult?.fileRecord.language).toBe('c');
      expect(cResult?.nodes.some(node => ['class', 'interface', 'protocol'].includes(node.kind))).toBe(false);
      expect(cResult?.nodes.every(node => node.language === 'c')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves JavaScript and TypeScript languages for Vue and Svelte references', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-sfc-language-'));
    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'FeatureJs.vue'), [
        '<script setup>',
        "import { helper } from '@/vue-js'",
        '</script>',
      ].join('\n'));
      writeFileSync(join(srcDir, 'FeatureTs.vue'), [
        '<script setup lang="ts">',
        "import { helper } from '@/vue-ts'",
        '</script>',
      ].join('\n'));
      writeFileSync(join(srcDir, 'FeatureJs.svelte'), [
        '<script>',
        "import { helper } from '@/svelte-js'",
        '</script>',
      ].join('\n'));
      writeFileSync(join(srcDir, 'FeatureTs.svelte'), [
        '<script lang="ts">',
        "import { helper } from '@/svelte-ts'",
        '</script>',
      ].join('\n'));

      const extraction = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
      });
      const embeddedImports = extraction.results.flatMap(result => result.references ?? [])
        .filter(reference => reference.referenceName.startsWith('@/'))
        .map(reference => [reference.referenceName, reference.language]);

      expect(embeddedImports).toEqual(expect.arrayContaining([
        ['@/vue-js', 'javascript'],
        ['@/vue-ts', 'typescript'],
        ['@/svelte-js', 'javascript'],
        ['@/svelte-ts', 'typescript'],
      ]));
      expect(embeddedImports).toHaveLength(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      framework: 'Vue',
      fileName: 'Feature.vue',
      source: '<script>\nconst value = 1\n</script>\n',
    },
    {
      framework: 'Svelte',
      fileName: 'Feature.svelte',
      source: '<script>\nconst value = 1\n</script>\n',
    },
  ])('keeps $framework embedded parse failures best-effort unless the scan is atomic', async fixture => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-sfc-error-'));
    const engine = getTreeSitterEngine();
    vi.spyOn(engine, 'isAvailable').mockReturnValue(true);
    const parse = vi.spyOn(engine, 'parse').mockRejectedValue(new Error('injected embedded parse failure'));
    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, fixture.fileName), fixture.source);

      const bestEffort = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
      });
      expect(bestEffort.results).toHaveLength(1);
      expect(bestEffort.stats.filesExtracted).toBe(1);
      expect(bestEffort.stats.errors).toEqual([]);

      await expect(extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
        failOnSkippedFile: true,
      })).rejects.toThrow(`${fixture.framework} embedded script parse failed`);
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies plugin fail and warn policies at the file extraction boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-plugin-error-'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const srcDir = join(root, 'src');
      const workflowDir = join(root, '.workflow', 'kg');
      const extractorDir = join(workflowDir, 'extractors');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(extractorDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'app.ts'), 'export function coreValue(): number { return 1; }\n');
      writeFileSync(join(extractorDir, 'failing.mjs'), [
        'export function extract() {',
        "  throw new Error('injected plugin failure');",
        '}',
        '',
      ].join('\n'));

      const writeConfig = (onError: 'fail' | 'warn'): void => {
        writeFileSync(join(workflowDir, 'extractors.yaml'), JSON.stringify({
          version: 1,
          defaults: { onError },
          plugins: [{
            id: 'failing-plugin',
            languages: ['typescript'],
            filePatterns: ['src/app.ts'],
            mode: 'script',
            script: { module: 'failing.mjs' },
          }],
        }));
      };

      writeConfig('fail');
      const failed = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
        allowExtractorScripts: true,
      });
      expect(failed.results).toEqual([]);
      expect(failed.stats.filesExtracted).toBe(0);
      expect(failed.stats.filesSkipped).toBe(1);
      expect(failed.stats.errors).toEqual([
        expect.objectContaining({
          message: 'Script plugin failing-plugin failed: module failing.mjs export extract: injected plugin failure',
        }),
      ]);

      let atomicError: unknown;
      try {
        await extractCode({
          projectRoot: root,
          srcDir,
          createMaestroIgnore: false,
          allowExtractorScripts: true,
          failOnSkippedFile: true,
        });
      } catch (error) {
        atomicError = error;
      }
      expect(atomicError).toBeInstanceOf(Error);
      expect((atomicError as Error).message).toContain('Script plugin failing-plugin failed');
      expect((atomicError as Error).cause).toEqual(
        expect.objectContaining({ message: 'injected plugin failure' }),
      );

      writeConfig('warn');
      stderr.mockClear();
      const warned = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
        allowExtractorScripts: true,
      });
      expect(warned.results).toHaveLength(1);
      expect(warned.stats.filesExtracted).toBe(1);
      expect(warned.stats.filesSkipped).toBe(0);
      expect(warned.stats.errors).toEqual([]);
      expect(warned.results[0].nodes.some(node => node.name === 'coreValue')).toBe(true);
      expect(stderr).toHaveBeenCalledWith(
        '[MaestroGraph] Extractor plugin warning: Script plugin failing-plugin failed: ' +
        'module failing.mjs export extract: injected plugin failure\n',
      );
    } finally {
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails an atomic scan on an invalid declarative regex and keeps warn best-effort', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-plugin-regex-error-'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const srcDir = join(root, 'src');
      const workflowDir = join(root, '.workflow', 'kg');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(workflowDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'app.ts'), [
        'export function coreValue(): number { return 1; }',
        '// PLUGIN_GOOD',
        '',
      ].join('\n'));

      const writeConfig = (onError: 'fail' | 'warn'): void => {
        writeFileSync(join(workflowDir, 'extractors.yaml'), JSON.stringify({
          version: 1,
          defaults: { onError },
          plugins: [{
            id: 'declarative-regex-plugin',
            languages: ['typescript'],
            filePatterns: ['src/app.ts'],
            mode: 'declarative',
            declarative: {
              rules: [
                {
                  id: 'invalid-regex',
                  match: { type: 'regex', pattern: '[' },
                  extract: { kind: 'constant', name: '$1' },
                },
                {
                  id: 'valid-regex',
                  match: { type: 'regex', pattern: 'PLUGIN_(\\w+)' },
                  extract: { kind: 'constant', name: '$1' },
                },
              ],
            },
          }],
        }));
      };

      writeConfig('fail');
      let atomicError: unknown;
      try {
        await extractCode({
          projectRoot: root,
          srcDir,
          createMaestroIgnore: false,
          failOnSkippedFile: true,
        });
      } catch (error) {
        atomicError = error;
      }
      expect(atomicError).toBeInstanceOf(Error);
      expect((atomicError as Error).message).toContain('Plugin declarative-regex-plugin failed');
      const ruleFailure = (atomicError as Error).cause;
      expect(ruleFailure).toEqual(expect.objectContaining({
        message: expect.stringContaining(
          'Declarative plugin declarative-regex-plugin rule invalid-regex failed',
        ),
      }));
      expect((ruleFailure as Error).cause).toBeInstanceOf(SyntaxError);

      writeConfig('warn');
      stderr.mockClear();
      const warned = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
        failOnSkippedFile: true,
      });
      expect(warned.results).toHaveLength(1);
      expect(warned.stats.filesExtracted).toBe(1);
      expect(warned.stats.filesSkipped).toBe(0);
      expect(warned.results[0].nodes.map(node => node.name)).toEqual(
        expect.arrayContaining(['coreValue', 'GOOD']),
      );
      const warnings = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(warnings).toContain(
        'Extractor plugin warning: Declarative plugin declarative-regex-plugin ' +
        'rule invalid-regex failed: Invalid regular expression',
      );
    } finally {
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed on invalid plugin definitions and skips only the invalid plugin under warn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-plugin-definition-error-'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const srcDir = join(root, 'src');
      const workflowDir = join(root, '.workflow', 'kg');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(workflowDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'app.ts'), [
        'export function coreValue(): number { return 1; }',
        '// PLUGIN_GOOD',
        '',
      ].join('\n'));

      const writeConfig = (onError: 'fail' | 'warn'): void => {
        writeFileSync(join(workflowDir, 'extractors.yaml'), JSON.stringify({
          version: 1,
          defaults: { onError },
          plugins: [
            {
              id: 'invalid-definition',
              languages: ['typescript'],
              filePatterns: ['src/app.ts'],
              mode: 'declarative',
              declarative: {
                rules: [{
                  id: 'missing-kind',
                  match: { type: 'regex', pattern: 'PLUGIN_(\\w+)' },
                  extract: { name: '$1' },
                }],
              },
            },
            {
              id: 'valid-definition',
              languages: ['typescript'],
              filePatterns: ['src/app.ts'],
              mode: 'declarative',
              declarative: {
                rules: [{
                  id: 'valid-regex',
                  match: { type: 'regex', pattern: 'PLUGIN_(\\w+)' },
                  extract: { kind: 'constant', name: '$1' },
                }],
              },
            },
          ],
        }));
      };

      writeConfig('fail');
      await expect(extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
        failOnSkippedFile: true,
      })).rejects.toThrow('Invalid extractor plugin config');

      writeConfig('warn');
      stderr.mockClear();
      const warned = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
        failOnSkippedFile: true,
      });
      expect(warned.results).toHaveLength(1);
      expect(warned.stats.filesExtracted).toBe(1);
      expect(warned.stats.filesSkipped).toBe(0);
      expect(warned.results[0].nodes.map(node => node.name)).toEqual(
        expect.arrayContaining(['coreValue', 'GOOD']),
      );
      expect(stderr).toHaveBeenCalledWith(
        '[MaestroGraph] Extractor plugin warning: Invalid config skipped: ' +
        'plugin invalid-definition.declarative.rules[0].extract.kind must be a non-empty string\n',
      );
    } finally {
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits stable warnings for every script plugin best-effort failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-plugin-warnings-'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const srcDir = join(root, 'src');
      const workflowDir = join(root, '.workflow', 'kg');
      const extractorDir = join(workflowDir, 'extractors');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(extractorDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'app.ts'), 'export function coreValue(): number { return 1; }\n');
      writeFileSync(join(extractorDir, 'syntax-error.mjs'), 'export function extract( {\n');
      writeFileSync(join(extractorDir, 'missing-export.mjs'), 'export const other = true;\n');
      writeFileSync(join(extractorDir, 'runtime.mjs'), [
        'export function extract() {',
        "  throw new Error('configured runtime boom');",
        '}',
        '',
      ].join('\n'));
      writeFileSync(join(extractorDir, 'standalone-missing-export.mjs'), 'export const helper = true;\n');
      writeFileSync(join(extractorDir, 'standalone-runtime.mjs'), [
        'export function extract() {',
        "  throw new Error('standalone runtime boom');",
        '}',
        '',
      ].join('\n'));
      writeFileSync(join(workflowDir, 'extractors.yaml'), JSON.stringify({
        version: 1,
        defaults: { onError: 'warn' },
        plugins: [
          {
            id: 'syntax-plugin',
            languages: ['typescript'],
            mode: 'script',
            script: { module: 'syntax-error.mjs' },
          },
          {
            id: 'missing-module-plugin',
            languages: ['typescript'],
            mode: 'script',
            script: { module: 'missing.mjs' },
          },
          {
            id: 'missing-export-plugin',
            languages: ['typescript'],
            mode: 'script',
            script: { module: 'missing-export.mjs', export: 'customExtract' },
          },
          {
            id: 'runtime-plugin',
            languages: ['typescript'],
            mode: 'script',
            script: { module: 'runtime.mjs' },
          },
        ],
      }));

      const warned = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
        allowExtractorScripts: true,
        failOnSkippedFile: true,
      });

      expect(warned.results).toHaveLength(1);
      expect(warned.stats.filesExtracted).toBe(1);
      expect(warned.stats.filesSkipped).toBe(0);
      expect(warned.stats.errors).toEqual([]);
      expect(warned.results[0].nodes.some(node => node.name === 'coreValue')).toBe(true);

      const warnings = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(warnings).toMatch(
        /Script plugin syntax-error\.mjs failed to load \(plugin syntax-plugin\): [^\n]+/,
      );
      expect(warnings).toContain(
        'Script plugin syntax-plugin module syntax-error.mjs is not loaded',
      );
      expect(warnings).toContain(
        'Script plugin missing-module-plugin module missing.mjs is not loaded',
      );
      expect(warnings).toContain(
        'Script plugin missing-export-plugin failed: ' +
        'module missing-export.mjs export customExtract is not a function',
      );
      expect(warnings).toContain(
        'Script plugin runtime-plugin failed: module runtime.mjs export extract: configured runtime boom',
      );
      expect(warnings).toContain(
        'Standalone script plugin standalone-missing-export.mjs has no extract export',
      );
      expect(warnings).toContain(
        'Standalone script plugin standalone-runtime.mjs failed: export extract: standalone runtime boom',
      );
    } finally {
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'missing module',
      moduleName: 'missing.mjs',
      moduleSource: null,
      exportName: undefined,
      expectedError: 'Script plugin fixture-plugin module missing.mjs is not loaded',
      hasCause: false,
    },
    {
      label: 'module syntax error',
      moduleName: 'syntax-error.mjs',
      moduleSource: 'export function extract( {\n',
      exportName: undefined,
      expectedError: 'Script plugin syntax-error.mjs failed to load',
      hasCause: true,
    },
    {
      label: 'missing configured export',
      moduleName: 'missing-export.mjs',
      moduleSource: 'export function extract() { return { symbols: [] }; }\n',
      exportName: 'customExtract',
      expectedError: 'Script plugin fixture-plugin failed',
      hasCause: false,
    },
  ])('fails an atomic scan on plugin $label', async fixture => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-plugin-load-error-'));
    try {
      const srcDir = join(root, 'src');
      const workflowDir = join(root, '.workflow', 'kg');
      const extractorDir = join(workflowDir, 'extractors');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(extractorDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'app.ts'), 'export const value = 1;\n');
      if (fixture.moduleSource !== null) {
        writeFileSync(join(extractorDir, fixture.moduleName), fixture.moduleSource);
      }
      writeFileSync(join(workflowDir, 'extractors.yaml'), JSON.stringify({
        version: 1,
        defaults: { onError: 'fail' },
        plugins: [{
          id: 'fixture-plugin',
          languages: ['typescript'],
          filePatterns: ['src/app.ts'],
          mode: 'script',
          script: {
            module: fixture.moduleName,
            ...(fixture.exportName ? { export: fixture.exportName } : {}),
          },
        }],
      }));

      let atomicError: unknown;
      try {
        await extractCode({
          projectRoot: root,
          srcDir,
          createMaestroIgnore: false,
          allowExtractorScripts: true,
          failOnSkippedFile: true,
        });
      } catch (error) {
        atomicError = error;
      }
      expect(atomicError).toBeInstanceOf(Error);
      expect((atomicError as Error).message).toContain(fixture.expectedError);
      if (fixture.hasCause) {
        expect((atomicError as Error).cause).toBeInstanceOf(Error);
      } else {
        expect((atomicError as Error).cause).toBeUndefined();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails an atomic scan when a standalone script plugin throws under fail policy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-standalone-plugin-error-'));
    try {
      const srcDir = join(root, 'src');
      const workflowDir = join(root, '.workflow', 'kg');
      const extractorDir = join(workflowDir, 'extractors');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(extractorDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'app.ts'), 'export const value = 1;\n');
      writeFileSync(join(extractorDir, 'standalone.mjs'), [
        'export function extract() {',
        "  throw new Error('standalone failure');",
        '}',
        '',
      ].join('\n'));
      writeFileSync(join(workflowDir, 'extractors.yaml'), JSON.stringify({
        version: 1,
        defaults: { onError: 'fail' },
        plugins: [{
          id: 'matching-declarative-plugin',
          languages: ['typescript'],
          filePatterns: ['src/app.ts'],
          mode: 'declarative',
          declarative: {
            rules: [{
              id: 'value',
              match: { type: 'regex', pattern: 'NO_MATCH' },
              extract: { kind: 'constant', name: '$1' },
            }],
          },
        }],
      }));

      let atomicError: unknown;
      try {
        await extractCode({
          projectRoot: root,
          srcDir,
          createMaestroIgnore: false,
          allowExtractorScripts: true,
          failOnSkippedFile: true,
        });
      } catch (error) {
        atomicError = error;
      }
      expect(atomicError).toBeInstanceOf(Error);
      expect((atomicError as Error).message).toContain('Standalone script plugin standalone.mjs failed');
      expect((atomicError as Error).cause).toEqual(
        expect.objectContaining({ message: 'standalone failure' }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('scans Delphi form extensions and retains event handler calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-dfm-scan-'));
    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(srcDir, 'Main.dfm'), [
        'object MainForm: TMainForm',
        '  OnClick = HandleClick',
        'end',
      ].join('\n'));
      writeFileSync(join(srcDir, 'Mobile.fmx'), [
        'object MobileForm: TMobileForm',
        '  OnCreate = HandleCreate',
        'end',
      ].join('\n'));

      const extraction = await extractCode({
        projectRoot: root,
        srcDir,
        createMaestroIgnore: false,
      });
      expect(extraction.stats.filesScanned).toBe(2);
      expect(extraction.results.map(result => result.fileRecord.language)).toEqual(['pascal', 'pascal']);
      expect(extraction.results.flatMap(result => result.references ?? [])).toEqual(expect.arrayContaining([
        expect.objectContaining({ referenceKind: 'calls', referenceName: 'HandleClick', language: 'pascal' }),
        expect.objectContaining({ referenceKind: 'calls', referenceName: 'HandleCreate', language: 'pascal' }),
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the parent directory as the default standalone project root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-code-project-root-'));
    try {
      const srcDir = join(root, 'src');
      mkdirSync(join(root, '.workflow', 'kg'), { recursive: true });
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(root, '.maestroignore'), '');
      writeFileSync(join(root, '.workflow', 'kg', 'extractors.yaml'), JSON.stringify({
        version: 1,
        plugins: [{
          id: 'root-plugin',
          languages: ['typescript'],
          filePatterns: ['src/app.ts'],
          mode: 'declarative',
          declarative: {
            rules: [{
              id: 'fixture-token',
              match: { type: 'regex', pattern: 'PLUGIN_(\\w+)' },
              extract: { kind: 'constant', name: '$1', qualifiedName: '$1' },
            }],
          },
        }],
      }));
      writeFileSync(join(srcDir, 'app.ts'), 'export const PLUGIN_TOKEN = 1;\n');
      writeFileSync(join(srcDir, '.maestroignore'), 'ignored.ts\n');
      writeFileSync(join(srcDir, 'ignored.ts'), 'export const IGNORED = 1;\n');

      const extraction = await extractCode({ srcDir, createMaestroIgnore: false });
      expect(extraction.results.flatMap(result => result.nodes)
        .some(node => node.name === 'TOKEN')).toBe(true);
      expect(extraction.results.some(result => result.fileRecord.path.endsWith('/ignored.ts'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows an implicit srcDir symlink whose target is outside its logical parent', async () => {
    const container = mkdtempSync(join(tmpdir(), 'maestro-code-implicit-alias-'));
    const actualSrc = mkdtempSync(join(tmpdir(), 'maestro-code-implicit-target-'));
    const aliasSrc = join(container, 'src');
    try {
      writeFileSync(join(actualSrc, 'app.yml'), 'service:\n  name: demo\n');
      symlinkSync(actualSrc, aliasSrc, 'dir');

      const extraction = await extractCode({
        srcDir: aliasSrc,
        createMaestroIgnore: false,
      });

      expect(extraction.results).toHaveLength(1);
      expect(extraction.results[0].fileRecord.path).toBe(realpathSync(join(actualSrc, 'app.yml')));
    } finally {
      rmSync(container, { recursive: true, force: true });
      rmSync(actualSrc, { recursive: true, force: true });
    }
  });

  it('uses one canonical scan-plan identity for alias paths and scheduled reads', async () => {
    const container = mkdtempSync(join(tmpdir(), 'maestro-code-scan-plan-'));
    const actualRoot = join(container, 'actual');
    const aliasRoot = join(container, 'project');
    const actualFile = join(actualRoot, 'src', 'app.yml');
    let unavailableFile = '';
    let movedScheduledFile = false;
    try {
      mkdirSync(join(actualRoot, 'src'), { recursive: true });
      symlinkSync(actualRoot, aliasRoot, 'dir');
      writeFileSync(actualFile, 'service:\n  name: demo\n');
      const canonicalFile = realpathSync(actualFile);
      const progressPaths: string[] = [];
      const streamed: ExtractionResult[] = [];

      await forEachCodeExtractionResult({
        projectRoot: aliasRoot,
        srcDir: join(aliasRoot, 'src'),
        createMaestroIgnore: false,
        failOnSkippedFile: true,
        onProgress: file => progressPaths.push(file),
      }, result => {
        streamed.push(result);
      });

      expect(progressPaths).toEqual([canonicalFile]);
      expect(streamed[0].fileRecord.path).toBe(canonicalFile);
      expect(streamed[0].nodes.map(node => node.filePath)).toEqual([canonicalFile]);

      unavailableFile = `${canonicalFile}-unavailable`;
      await expect(forEachCodeExtractionResult({
        projectRoot: aliasRoot,
        srcDir: join(aliasRoot, 'src'),
        createMaestroIgnore: false,
        failOnSkippedFile: true,
        onProgress: file => {
          if (file !== canonicalFile || movedScheduledFile) return;
          renameSync(canonicalFile, unavailableFile);
          movedScheduledFile = true;
        },
      }, () => {})).rejects.toThrow();
      expect(movedScheduledFile).toBe(true);
    } finally {
      if (movedScheduledFile) renameSync(unavailableFile, actualFile);
      rmSync(container, { recursive: true, force: true });
    }
  });
});
