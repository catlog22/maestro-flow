// ---------------------------------------------------------------------------
// reinstall-workflows.test.ts — test command construction from manifest data
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { createManifest } from '../core/manifest.js';

/**
 * Simulates the reinstallWorkflows command construction logic without actual exec.
 * The real function is in update.ts but we test the manifest→command mapping.
 */
function buildReinstallCommands(manifests: ReturnType<typeof createManifest>[]): string[] {
  const seen = new Set<string>();
  const deduped: { scope: string; targetPath: string; hookLevel: string }[] = [];

  for (const m of manifests) {
    const key = `${m.scope}:${m.targetPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ scope: m.scope, targetPath: m.targetPath, hookLevel: m.hookLevel ?? 'none' });
  }

  const commands: string[] = [];
  for (const { scope, targetPath, hookLevel } of deduped) {
    const hooksArg = hookLevel !== 'none' ? ` --hooks ${hookLevel}` : '';
    if (scope === 'global') {
      commands.push(`maestro install --force --global${hooksArg}`);
    } else {
      commands.push(`maestro install --force --path "${targetPath}"${hooksArg}`);
    }
  }
  return commands;
}

describe('reinstallWorkflows command construction', () => {
  it('should generate correct command with hookLevel from manifest', () => {
    const m = createManifest('global', '/home/user/.maestro', {
      hookLevel: 'full',
      selectedComponentIds: ['workflows', 'commands', 'skills'],
    });

    const cmds = buildReinstallCommands([m]);
    expect(cmds).toEqual(['maestro install --force --global --hooks full']);
  });

  it('should omit --hooks when hookLevel is none', () => {
    const m = createManifest('global', '/home/user/.maestro', { hookLevel: 'none' });

    const cmds = buildReinstallCommands([m]);
    expect(cmds).toEqual(['maestro install --force --global']);
  });

  it('should handle project scope with hooks', () => {
    const m = createManifest('project', '/workspace/my-project', {
      hookLevel: 'standard',
    });

    const cmds = buildReinstallCommands([m]);
    expect(cmds).toEqual(['maestro install --force --path "/workspace/my-project" --hooks standard']);
  });

  it('should handle backward compat (no hookLevel in manifest)', () => {
    const m = createManifest('project', '/workspace/old-project');
    // No opts → hookLevel is undefined

    const cmds = buildReinstallCommands([m]);
    expect(cmds).toEqual(['maestro install --force --path "/workspace/old-project"']);
  });

  it('should deduplicate by scope + targetPath', () => {
    const m1 = createManifest('global', '/home/user/.maestro', { hookLevel: 'minimal' });
    const m2 = createManifest('global', '/home/user/.maestro', { hookLevel: 'full' });
    // sort by installedAt desc (latest first → m2 first)
    const manifests = [m2, m1]; // m2 has newer timestamp

    const cmds = buildReinstallCommands(manifests);
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toContain('--hooks full'); // latest wins
  });

  it('should handle mixed global + project manifests', () => {
    const mGlobal = createManifest('global', '/home/user/.maestro', { hookLevel: 'full' });
    const mProj1 = createManifest('project', '/workspace/a', { hookLevel: 'standard' });
    const mProj2 = createManifest('project', '/workspace/b', { hookLevel: 'none' });

    const cmds = buildReinstallCommands([mGlobal, mProj1, mProj2]);
    expect(cmds).toEqual([
      'maestro install --force --global --hooks full',
      'maestro install --force --path "/workspace/a" --hooks standard',
      'maestro install --force --path "/workspace/b"',
    ]);
  });
});
