import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
  EXTERNAL_SURFACE_MAX_ENTRIES,
  EXTERNAL_SURFACE_MAX_FILE_SIZE,
  collectExactFiles,
  loadExternalSurfaceManifest,
  validateExternalSurfaceManifest,
} from '../extraction/code/external/external-surface-manifest.js';
import { registerKgCommands } from '../surface/cli.js';

const roots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-external-surface-'));
  roots.push(root);
  mkdirSync(join(root, '.workflow', 'kg'), { recursive: true });
  return root;
}

function writeHeader(root: string, path = 'Pods/Module/A.h', source = '@interface A : NSObject\n@end\n'): string {
  const filePath = join(root, ...path.split('/'));
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, source, 'utf-8');
  return filePath;
}

function entry(path = 'Pods/Module/A.h', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    module: 'Module',
    language: 'objc',
    path,
    ...overrides,
  };
}

function document(files: unknown[] = [entry()]): Record<string, unknown> {
  return {
    schema_version: EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
    files,
  };
}

function writeManifest(root: string, value: unknown): string {
  const configPath = join(root, '.workflow', 'kg', 'external-surfaces.json');
  writeFileSync(
    configPath,
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
    'utf-8',
  );
  return configPath;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('external surface manifest', () => {
  it('treats a missing fixed carrier as an empty allowlist', () => {
    const root = makeProject();
    const result = validateExternalSurfaceManifest(root);

    expect(result).toEqual({
      schemaVersion: EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
      configPath: join(realpathSync(root), '.workflow', 'kg', 'external-surfaces.json'),
      configured: 0,
      resolved: 0,
      errors: [],
      digest: null,
      files: [],
    });
    expect(loadExternalSurfaceManifest(root).files).toEqual([]);
  });

  it('resolves an ignored exact header with a canonical path and stable digest', () => {
    const root = makeProject();
    const headerPath = writeHeader(root);
    const configPath = writeManifest(root, document());

    const result = validateExternalSurfaceManifest(root);

    expect(result.errors).toEqual([]);
    expect(result.configured).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.configPath).toBe(realpathSync(configPath));
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.files).toEqual([expect.objectContaining({
      module: 'Module',
      language: 'objc',
      configuredPath: 'Pods/Module/A.h',
      canonicalPath: realpathSync(headerPath),
    })]);
  });

  it.each([
    ['absolute path', '/tmp/A.h', 'unsafe-path'],
    ['parent traversal', '../A.h', 'unsafe-path'],
    ['glob star', 'Pods/Module/*.h', 'unsafe-path'],
    ['glob question', 'Pods/Module/A?.h', 'unsafe-path'],
    ['glob negation', 'Pods/Module/!A.h', 'unsafe-path'],
    ['extglob', 'Pods/Module/@(A|B).h', 'unsafe-path'],
    ['directory spelling', 'Pods/Module/', 'unsafe-path'],
    ['unsupported extension', 'Pods/Module/A.hpp', 'unsupported-extension'],
    ['empty path', '', 'invalid-path'],
    ['NUL path', 'Pods/Module/A\0.h', 'invalid-path'],
  ])('rejects %s before filesystem collection', (_label, path, code) => {
    const root = makeProject();
    writeManifest(root, document([entry(path)]));

    const result = validateExternalSurfaceManifest(root);

    expect(result.resolved).toBe(0);
    expect(result.errors[0]?.code).toBe(code);
    expect(() => loadExternalSurfaceManifest(root)).toThrow(/external surface manifest/i);
  });

  it.each([
    ['invalid module', document([entry('Pods/Module/A.h', { module: 'bad-module' })]), 'invalid-module'],
    ['unsupported language', document([entry('Pods/Module/A.h', { language: 'cpp' })]), 'unsupported-language'],
    ['future schema', { ...document(), schema_version: 'kg-external-surfaces/2.0' }, 'unsupported-schema-version'],
    ['unknown root field', { ...document(), extra: true }, 'unknown-field'],
    ['unknown entry field', document([entry('Pods/Module/A.h', { extra: true })]), 'unknown-field'],
    ['missing entry field', document([{ module: 'Module', language: 'objc' }]), 'missing-field'],
  ])('rejects %s with a typed error', (_label, value, code) => {
    const root = makeProject();
    writeManifest(root, value);

    const result = validateExternalSurfaceManifest(root);

    expect(result.errors[0]?.code).toBe(code);
    expect(result.resolved).toBe(0);
  });

  it('rejects malformed JSON and preserves a digest for diagnostics', () => {
    const root = makeProject();
    writeManifest(root, '{"schema_version":');

    const result = validateExternalSurfaceManifest(root);

    expect(result.errors).toEqual([expect.objectContaining({ code: 'invalid-json' })]);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects more than the fixed entry cap before touching the entries', () => {
    const root = makeProject();
    writeManifest(root, document(Array.from(
      { length: EXTERNAL_SURFACE_MAX_ENTRIES + 1 },
      (_, index) => entry(`Pods/Module/File${index}.h`),
    )));

    const result = validateExternalSurfaceManifest(root);

    expect(result.configured).toBe(EXTERNAL_SURFACE_MAX_ENTRIES + 1);
    expect(result.errors[0]?.code).toBe('too-many-files');
  });

  it('rejects directory and oversized-file targets as non-indexable exact surfaces', () => {
    const directoryRoot = makeProject();
    mkdirSync(join(directoryRoot, 'Pods', 'Directory.h'), { recursive: true });
    writeManifest(directoryRoot, document([entry('Pods/Directory.h')]));
    expect(validateExternalSurfaceManifest(directoryRoot).errors[0]?.code).toBe('file-not-regular');

    const largeRoot = makeProject();
    const largePath = writeHeader(largeRoot);
    writeFileSync(largePath, Buffer.alloc(EXTERNAL_SURFACE_MAX_FILE_SIZE + 1));
    writeManifest(largeRoot, document());
    expect(validateExternalSurfaceManifest(largeRoot).errors[0]?.code).toBe('file-too-large');
  });

  it('rejects a symlink escape and duplicate canonical realpaths', () => {
    const escapeRoot = makeProject();
    const outsideRoot = makeProject();
    const outsideHeader = writeHeader(outsideRoot, 'Outside.h');
    mkdirSync(join(escapeRoot, 'Pods', 'Module'), { recursive: true });
    symlinkSync(outsideHeader, join(escapeRoot, 'Pods', 'Module', 'Escape.h'));
    writeManifest(escapeRoot, document([entry('Pods/Module/Escape.h')]));
    expect(validateExternalSurfaceManifest(escapeRoot).errors[0]?.code).toBe('file-outside-project');

    const duplicateRoot = makeProject();
    const original = writeHeader(duplicateRoot);
    symlinkSync(original, join(duplicateRoot, 'Pods', 'Module', 'Alias.h'));
    writeManifest(duplicateRoot, document([
      entry('Pods/Module/A.h'),
      entry('Pods/Module/Alias.h'),
    ]));
    expect(validateExternalSurfaceManifest(duplicateRoot).errors[0]?.code)
      .toBe('duplicate-canonical-file');
    expect(() => collectExactFiles(duplicateRoot, [
      entry('Pods/Module/A.h'),
      entry('Pods/Module/Alias.h'),
    ])).toThrow(/same file/);
  });

  if (process.platform !== 'win32') {
    it('rejects a FIFO instead of attempting to read it', () => {
      const root = makeProject();
      const fifoPath = join(root, 'Pods', 'Module', 'Pipe.h');
      mkdirSync(resolve(fifoPath, '..'), { recursive: true });
      execFileSync('mkfifo', [fifoPath]);
      writeManifest(root, document([entry('Pods/Module/Pipe.h')]));

      expect(validateExternalSurfaceManifest(root).errors[0]?.code).toBe('file-not-regular');
    });
  }

  it('ships only an empty strict template and no project instance side effect', () => {
    const template = JSON.parse(readFileSync(resolve('templates/external-surfaces.json'), 'utf-8'));

    expect(template).toEqual({
      schema_version: EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
      files: [],
    });
    expect(Object.keys(template)).toEqual(['schema_version', 'files']);
  });

  it('registers only the fixed validate CLI surface and returns nonzero JSON on error', async () => {
    const root = makeProject();
    writeManifest(root, '{bad json');
    const program = new Command();
    program.exitOverride();
    registerKgCommands(program);
    const kg = program.commands.find(command => command.name() === 'kg');
    const external = kg?.commands.find(command => command.name() === 'external-surfaces');
    const validate = external?.commands.find(command => command.name() === 'validate');
    const help = `${external?.helpInformation() ?? ''}\n${validate?.helpInformation() ?? ''}`;
    expect(help).not.toContain('--external-file');
    expect(help).not.toContain('--external-dir');
    expect(validate?.options.map(option => option.flags)).toEqual(['--json']);

    const previousCwd = process.cwd();
    const previousExitCode = process.exitCode;
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(value => { output.push(String(value)); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
    try {
      process.chdir(root);
      await program.parseAsync([
        'node',
        'maestro',
        'kg',
        'external-surfaces',
        'validate',
        '--json',
      ]);
      expect(process.exitCode).toBe(1);
      const payload = JSON.parse(output.join('\n'));
      expect(Object.keys(payload)).toEqual([
        'schemaVersion',
        'configPath',
        'configured',
        'resolved',
        'errors',
        'digest',
      ]);
      expect(payload).toEqual(expect.objectContaining({
        schemaVersion: EXTERNAL_SURFACE_MANIFEST_SCHEMA_VERSION,
        configPath: realpathSync(join(root, '.workflow', 'kg', 'external-surfaces.json')),
        configured: 0,
        resolved: 0,
        errors: [expect.objectContaining({ code: 'invalid-json' })],
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }));
    } finally {
      process.chdir(previousCwd);
      process.exitCode = previousExitCode;
    }
  });
});
