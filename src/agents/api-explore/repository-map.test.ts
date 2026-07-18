import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRepositoryMap,
  extractRepositoryMapFocusPaths,
  extractExplicitFilePaths,
  normalizeRepositoryMapDepth,
} from './repository-map.js';
import { buildSystemPrompt } from './system-prompt.js';

const tempDirs: string[] = [];

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-repo-map-'));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildRepositoryMap', () => {
  it('renders a deterministic depth-limited tree and respects project ignore files', () => {
    const root = createRepository();
    mkdirSync(join(root, 'src', 'nested'), { recursive: true });
    mkdirSync(join(root, 'ignored'), { recursive: true });
    mkdirSync(join(root, 'private'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), 'export {};');
    writeFileSync(join(root, 'src', 'nested', 'deep.ts'), 'export {};');
    writeFileSync(join(root, 'README.md'), '# test');
    writeFileSync(join(root, 'ignored', 'secret.ts'), '');
    writeFileSync(join(root, 'private', 'secret.ts'), '');
    writeFileSync(join(root, '.gitignore'), 'ignored/\n');
    writeFileSync(join(root, '.maestroignore'), 'private/\n');

    const result = buildRepositoryMap(root, { targetDepth: 2, maxBytes: 4096 });

    expect(result.depth).toBe(2);
    expect(result.fellBack).toBe(false);
    expect(result.tree).toContain('├── src/');
    expect(result.tree).toContain('│   ├── nested/');
    expect(result.tree).toContain('│   └── index.ts');
    expect(result.tree).toContain('README.md');
    expect(result.tree).not.toContain('deep.ts');
    expect(result.tree).not.toContain('ignored/');
    expect(result.tree).not.toContain('private/');
  });

  it('automatically reduces depth when the requested map exceeds its byte budget', () => {
    const root = createRepository();
    mkdirSync(join(root, 'wide'), { recursive: true });
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(root, 'wide', `very-long-file-name-${i}.ts`), '');
    }

    const result = buildRepositoryMap(root, { targetDepth: 2, maxBytes: 256 });

    expect(result.depth).toBe(1);
    expect(result.fellBack).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.tree).toContain('└── wide/');
    expect(result.tree).not.toContain('very-long-file-name');
  });

  it('clamps configured depth to the supported range', () => {
    expect(normalizeRepositoryMapDepth(0)).toBe(1);
    expect(normalizeRepositoryMapDepth(99)).toBe(6);
    expect(normalizeRepositoryMapDepth(Number.NaN)).toBe(3);
  });

  it('marks and bounds a depth-one map that still exceeds the byte budget', () => {
    const root = createRepository();
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(root, `root-file-with-a-long-name-${i}.ts`), '');
    }

    const result = buildRepositoryMap(root, { targetDepth: 1, maxBytes: 256 });

    expect(result.depth).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.tree).toContain('repository map truncated');
    expect(result.sizeBytes).toBeLessThanOrEqual(256);
  });

  it('prioritizes and expands structured SCOPE paths beyond the overview depth', () => {
    const root = createRepository();
    mkdirSync(join(root, 'src', 'agents', 'api-explore'), { recursive: true });
    mkdirSync(join(root, 'unrelated', 'nested'), { recursive: true });
    writeFileSync(join(root, 'src', 'agents', 'api-explore', 'tools.ts'), 'export {};');
    writeFileSync(join(root, 'src', 'agents', 'api-explore', 'agent-loop.ts'), 'export {};');
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(root, 'unrelated', 'nested', `noise-${i}.ts`), '');
    }

    const focusPaths = extractRepositoryMapFocusPaths([
      'FIND: tool execution\nSCOPE: src/agents/api-explore/\nEXPECTED: file:line',
    ]);
    const result = buildRepositoryMap(root, { targetDepth: 1, maxBytes: 1024, focusPaths });

    expect(focusPaths).toEqual(['src/agents/api-explore/']);
    expect(result.tree).toContain('src/');
    expect(result.tree).toContain('agents/');
    expect(result.tree).toContain('api-explore/');
    expect(result.tree).toContain('tools.ts');
    expect(result.tree).toContain('agent-loop.ts');
    expect(result.tree).not.toContain('noise-0.ts');
  });

  it('extracts SCOPE paths from CLI prompts containing literal escaped field breaks', () => {
    expect(extractRepositoryMapFocusPaths([
      'FIND: proxy chain\\nSCOPE: src/config/, src/agents/api-explore/\\nEXPECTED: file:line',
    ])).toEqual(['src/config/', 'src/agents/api-explore/']);
  });

  it('keeps ignored exact files named outside SCOPE as required direct-read targets', () => {
    const root = createRepository();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'docs/\n');
    writeFileSync(join(root, 'docs', 'audit.md'), '# audit');
    const prompt = 'FIND: verify IDs from docs/audit.md\nSCOPE: src/\nEXPECTED: evidence';
    const focusPaths = extractRepositoryMapFocusPaths([prompt]);
    const result = buildRepositoryMap(root, { focusPaths });

    expect(extractExplicitFilePaths(prompt)).toEqual(['docs/audit.md']);
    expect(focusPaths).toContain('docs/audit.md');
    expect(result.tree).not.toContain('docs/');
    expect(result.directReadPaths).toEqual(['docs/audit.md']);
  });
});

describe('buildSystemPrompt', () => {
  it('puts the repository map before search instructions and explains how to use it', () => {
    const repositoryMap = {
      tree: 'project/\n└── src/',
      depth: 1,
      sizeBytes: 24,
      fellBack: false,
      truncated: false,
    };

    const prompt = buildSystemPrompt('/project', repositoryMap, 5);

    expect(prompt).toContain('## Repository map (overview depth 1)');
    expect(prompt).toContain('choose precise Batch Search paths');
    expect(prompt).toContain('at most **5 Batch rounds**');
    expect(prompt.indexOf('project/\n└── src/')).toBeLessThan(prompt.indexOf('## Search query syntax'));
  });
});
