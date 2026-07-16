// ---------------------------------------------------------------------------
// reinstall-workflows.test.ts — test profile generation and merge logic
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { createManifest, recordClaudeHooks, recordCodexHooks, recordGenericHooks, recordStatusline, recordClaudeMcp, recordExtraMcp } from '../core/manifest.js';
import { manifestToProfile } from '../core/install-profile.js';
import { mergeNewDefaults, migrateComponentIds, COMPONENT_DEFS } from '../core/component-defs.js';

// ---------------------------------------------------------------------------
// manifestToProfile
// ---------------------------------------------------------------------------

describe('manifestToProfile', () => {
  it('should convert a global manifest with hooks and components', () => {
    const m = createManifest('global', '/home/user/.maestro', {
      hookLevel: 'standard',
      selectedComponentIds: ['workflows', 'commands', 'skills'],
    });
    recordClaudeHooks(m, {
      settingsPath: '/home/user/.claude/settings.json',
      installed: ['spec-injector', 'delegate-monitor'],
      level: 'standard',
    });

    const profile = manifestToProfile(m);

    expect(profile.scope).toBe('global');
    expect(profile.components.selectedIds).toEqual(['workflows', 'commands', 'skills']);
    expect(profile.claude.hooks.enabled).toBe(true);
    expect(profile.claude.hooks.basePreset).toBe('standard');
    expect(profile.claude.hooks.selectedHooks).toEqual(['spec-injector', 'delegate-monitor']);
  });

  it('should handle manifest without hooks records (legacy)', () => {
    const m = createManifest('global', '/home/user/.maestro', {
      hookLevel: 'full',
    });

    const profile = manifestToProfile(m);

    expect(profile.claude.hooks.enabled).toBe(false);
    expect(profile.claude.hooks.basePreset).toBe('full');
  });

  it('should preserve statusline and MCP config', () => {
    const m = createManifest('global', '/home/user/.maestro');
    recordStatusline(m, { settingsPath: '/settings.json', theme: 'minimal' });
    recordClaudeMcp(m, { configPath: '/home/.claude.json', serverName: 'maestro-tools' });
    recordExtraMcp(m, { targetId: 'cursor', configPath: '/home/.cursor/mcp.json', serverName: 'maestro-tools' });

    const profile = manifestToProfile(m);

    expect(profile.claude.statusline.enabled).toBe(true);
    expect(profile.claude.statusline.theme).toBe('minimal');
    expect(profile.claude.mcp.enabled).toBe(true);
    expect(profile.extraMcp.enabled).toBe(true);
    expect(profile.extraMcp.targetIds).toEqual(['cursor']);
  });

  it('should handle project scope manifest', () => {
    const m = createManifest('project', '/workspace/my-project', {
      selectedComponentIds: ['commands', 'agents'],
    });

    const profile = manifestToProfile(m);

    expect(profile.scope).toBe('project');
    expect(profile.components.selectedIds).toEqual(['commands', 'agents']);
  });

  it('should preserve codex hooks', () => {
    const m = createManifest('global', '/home/user/.maestro');
    recordCodexHooks(m, {
      settingsPath: '/home/.codex/config.toml',
      installed: ['hook-a', 'hook-b'],
      level: 'minimal',
    });

    const profile = manifestToProfile(m);

    expect(profile.codex.hooks.enabled).toBe(true);
    expect(profile.codex.hooks.basePreset).toBe('minimal');
    expect(profile.codex.hooks.selectedHooks).toEqual(['hook-a', 'hook-b']);
  });

  it('should not infer MCP or statusline from hooks on a v2 manifest', () => {
    const m = createManifest('global', '/home/user/.maestro');
    recordClaudeHooks(m, {
      settingsPath: '/home/.claude/settings.json',
      installed: ['spec-injector'],
      level: 'minimal',
    });

    const profile = manifestToProfile(m);

    expect(profile.claude.hooks.enabled).toBe(true);
    expect(profile.claude.mcp.enabled).toBe(false);
    expect(profile.codex.mcp.enabled).toBe(false);
    expect(profile.claude.statusline.enabled).toBe(false);
  });

  it('should preserve an explicit empty component selection', () => {
    const m = createManifest('global', '/home/user/.maestro', {
      selectedComponentIds: [],
      knownComponentIds: COMPONENT_DEFS.map(d => d.id),
    });

    const profile = manifestToProfile(m);

    expect(profile.components.enabled).toBe(false);
    expect(profile.components.selectedIds).toEqual([]);
    expect(profile.components.knownIds).toEqual(COMPONENT_DEFS.map(d => d.id));
  });

  it('should preserve generic platform hook levels', () => {
    const m = createManifest('global', '/home/user/.maestro');
    recordGenericHooks(m, 'cursor', {
      settingsPath: '/home/.cursor/hooks.json',
      installed: ['session-context'],
      level: 'minimal',
    });

    expect(manifestToProfile(m).genericHooks).toEqual({ cursor: 'minimal' });
  });
});

// ---------------------------------------------------------------------------
// mergeNewDefaults
// ---------------------------------------------------------------------------

describe('mergeNewDefaults', () => {
  it('should preserve existing valid IDs', () => {
    const existing = ['workflows', 'templates', 'commands'];
    const result = mergeNewDefaults(existing);

    expect(result).toContain('workflows');
    expect(result).toContain('templates');
    expect(result).toContain('commands');
  });

  it('should add new default-selected components not in existing list', () => {
    const existing = ['commands'];
    const known = COMPONENT_DEFS.map(d => d.id).filter(id => id !== 'agents');
    const result = mergeNewDefaults(existing, known);

    // 'agents' is genuinely new and belongs to the already-selected Claude platform.
    expect(result).toContain('agents');
  });

  it('should preserve an old manifest exactly when its known catalog is unavailable', () => {
    const result = mergeNewDefaults(['workflows']);
    expect(result).toEqual(['workflows']);
  });

  it('should NOT add components with defaultSelected: false', () => {
    const existing = ['workflows'];
    const known = COMPONENT_DEFS.map(d => d.id).filter(id => id !== 'skills-extra-team');
    const result = mergeNewDefaults(existing, known);

    // These have defaultSelected: false — should NOT be auto-added
    expect(result).not.toContain('commands-odyssey');
    expect(result).not.toContain('commands-learn');
    expect(result).not.toContain('skills-extra-team');
    expect(result).not.toContain('skills-scholar');
    expect(result).not.toContain('skills-meta');
  });

  it('should not duplicate IDs already in the list', () => {
    const allDefaultIds = COMPONENT_DEFS
      .filter(d => d.defaultSelected !== false)
      .map(d => d.id);
    const result = mergeNewDefaults(allDefaultIds, COMPONENT_DEFS.map(d => d.id));

    const unique = new Set(result);
    expect(result.length).toBe(unique.size);
  });

  it('should migrate legacy IDs before merging', () => {
    // A legacy skill name that maps to a group bundle
    const existing = ['workflows', 'team-brainstorm'];
    const result = mergeNewDefaults(existing);

    // 'team-brainstorm' should be migrated to 'skills-extra-team'
    expect(result).toContain('skills-extra-team');
    // Original invalid ID should not be in result
    expect(result).not.toContain('team-brainstorm');
  });
});

// ---------------------------------------------------------------------------
// Spawn args construction (simulated)
// ---------------------------------------------------------------------------

describe('reinstall spawn args', () => {
  function buildReinstallArgs(manifest: ReturnType<typeof createManifest>): string[] {
    const args = ['install', '--import', '/tmp/profile.json', '--upgrade'];
    if (manifest.scope === 'global') {
      args.push('--global');
    } else {
      args.push('--path', manifest.targetPath);
    }
    return args;
  }

  it('should include --upgrade flag for global installs', () => {
    const m = createManifest('global', '/home/user/.maestro');
    const args = buildReinstallArgs(m);

    expect(args).toContain('--upgrade');
    expect(args).toContain('--global');
    expect(args).not.toContain('--path');
  });

  it('should include --path for project installs', () => {
    const m = createManifest('project', '/workspace/my-project');
    const args = buildReinstallArgs(m);

    expect(args).toContain('--upgrade');
    expect(args).toContain('--path');
    expect(args).toContain('/workspace/my-project');
    expect(args).not.toContain('--global');
  });

  it('should always use --import instead of CLI arg reconstruction', () => {
    const m = createManifest('global', '/home/user/.maestro', {
      hookLevel: 'full',
      selectedComponentIds: ['workflows', 'commands', 'skills', 'agents'],
    });
    const args = buildReinstallArgs(m);

    // Should NOT contain direct --hooks or --components flags
    expect(args).toContain('--import');
    expect(args).not.toContain('--hooks');
    expect(args).not.toContain('--components');
    expect(args).not.toContain('--force');
  });
});
