import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './system-prompt.js';
import type { RepositoryMap } from './repository-map.js';

const repositoryMap: RepositoryMap = {
  tree: 'repo/\n└── src/',
  depth: 2,
  sizeBytes: 20,
  fellBack: false,
  truncated: false,
  focusCount: 1,
};

describe('buildSystemPrompt Batch strategy', () => {
  it('keeps the hard round cap while steering ordinary work to one or two rounds', () => {
    const prompt = buildSystemPrompt('D:/repo', repositoryMap, 5);

    expect(prompt).toContain('at most **5 Batch rounds**');
    expect(prompt).toContain('narrow symbol/file lookups in 1 round');
    expect(prompt).toContain('ordinary cross-file traces in 2 rounds');
    expect(prompt).toContain('rounds 4–5 are reserve');
    expect(prompt).toContain('Command count has no hard limit');
  });

  it('prevents redundant discovery and duplicate Search plus Read evidence', () => {
    const prompt = buildSystemPrompt('D:/repo', repositoryMap, 5);

    expect(prompt).toContain('If the query names exact files, Read them directly');
    expect(prompt).toContain('Do not also Read the same region');
    expect(prompt).toContain('Never emit direct Search or Read tool calls');
    expect(prompt).toContain('files_only` returns paths whose file contents match');
    expect(prompt).toContain('Never reassign IDs from memory');
    expect(prompt).toContain('never guess offsets');
  });
});
