import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstallFlowConfig } from '../tui/install-ui/types.js';

const originalMaestroHome = process.env.MAESTRO_HOME;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalCodexHome = process.env.CODEX_HOME;
const originalClaudeHome = process.env.CLAUDE_HOME;
const testHome = mkdtempSync(join(tmpdir(), 'maestro-executor-test-'));
const projectPath = join(testHome, 'project');
const packageRoot = join(testHome, 'package');
let executor: typeof import('./install-executor.js');
let manifestApi: typeof import('./manifest.js');
let installCommandApi: typeof import('../commands/install.js');

beforeAll(async () => {
  process.env.MAESTRO_HOME = join(testHome, 'maestro-home');
  process.env.HOME = join(testHome, 'home');
  process.env.USERPROFILE = join(testHome, 'home');
  process.env.CODEX_HOME = join(testHome, 'codex-home');
  process.env.CLAUDE_HOME = join(testHome, 'claude-home');
  mkdirSync(join(packageRoot, '.claude', 'agents'), { recursive: true });
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(packageRoot, '.claude', 'agents', 'agent.md'), [
    '---',
    'name: agent',
    'description: generated install agent',
    'allowed-tools: [Read]',
    '---',
    '',
    '# Agent',
    'Read the assigned files.',
  ].join('\n'));
  vi.resetModules();
  executor = await import('./install-executor.js');
  manifestApi = await import('./manifest.js');
  installCommandApi = await import('../commands/install.js');
});

afterAll(() => {
  if (originalMaestroHome === undefined) delete process.env.MAESTRO_HOME;
  else process.env.MAESTRO_HOME = originalMaestroHome;
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalCodexHome;
  if (originalClaudeHome === undefined) delete process.env.CLAUDE_HOME; else process.env.CLAUDE_HOME = originalClaudeHome;
  rmSync(testHome, { recursive: true, force: true });
});

function config(selectedComponentIds: string[]): InstallFlowConfig {
  return {
    mode: 'project',
    projectPath,
    installComponents: true,
    installHooks: false,
    installMcp: false,
    installCodexHooks: false,
    codexHookLevel: 'none',
    installCodexMcp: false,
    codexMcpTools: [],
    codexMcpProjectRoot: '',
    installAgyHooks: false,
    agyHookLevel: 'none',
    installExtraMcp: false,
    extraMcpTargetIds: [],
    genericHookLevels: {},
    installStatusline: false,
    statuslineTheme: 'notion',
    hookLevel: 'none',
    componentCount: selectedComponentIds.length,
    fileCount: 1,
    mcpToolCount: 0,
    selectedComponentIds,
    mcpTools: [],
    mcpProjectRoot: '',
    backupClaudeMd: false,
    backupAll: false,
  };
}

describe('executeInstallPipeline additive semantics', () => {
  it('removes retired quick step files while preserving active workflow assets', async () => {
    const globalPrepare = join(process.env.MAESTRO_HOME!, 'prepare');
    const globalWorkflows = join(process.env.MAESTRO_HOME!, 'workflows');
    const globalCommands = join(process.env.HOME!, '.claude', 'commands');
    mkdirSync(globalPrepare, { recursive: true });
    mkdirSync(globalWorkflows, { recursive: true });
    mkdirSync(globalCommands, { recursive: true });
    writeFileSync(join(globalPrepare, 'quick.md'), '---\nname: quick\n---\n');
    writeFileSync(join(globalWorkflows, 'quick.md'), '# Workflow: Quick\n');
    writeFileSync(join(globalCommands, 'maestro-quick.md'), 'generated-by: maestro install entry-commands\n');
    mkdirSync(join(packageRoot, 'prepare'), { recursive: true });
    mkdirSync(join(packageRoot, 'workflows'), { recursive: true });
    writeFileSync(join(packageRoot, 'prepare', 'analyze.md'), '---\nname: analyze\n---\n');
    writeFileSync(join(packageRoot, 'workflows', 'analyze.md'), '# Workflow: Analyze\n');

    await executor.executeInstallPipeline({
      config: { ...config(['prepare', 'workflows']), mode: 'global' },
      pkgRoot: packageRoot,
      version: 'test',
    });

    expect(existsSync(join(globalPrepare, 'quick.md'))).toBe(false);
    expect(existsSync(join(globalWorkflows, 'quick.md'))).toBe(false);
    expect(existsSync(join(globalCommands, 'maestro-quick.md'))).toBe(false);
    expect(existsSync(join(globalPrepare, 'analyze.md'))).toBe(true);
    expect(existsSync(join(globalWorkflows, 'analyze.md'))).toBe(true);
  }, 15_000);

  it('gives explicit profile disable precedence and preserves omitted plugin state', () => {
    const disabledCustom = {
      enabled: false,
      basePreset: 'minimal' as const,
      selectedHooks: ['session-context'],
      isCustom: true,
    };
    expect(installCommandApi.enabledCustomHookSelection(disabledCustom)).toBeUndefined();
    expect(installCommandApi.profilePluginPlatformState(undefined, 'codex')).toBeUndefined();
    expect(installCommandApi.profilePluginPlatformState({ enabled: false, claude: true, codex: true }, 'codex')).toBe(false);
    expect(installCommandApi.profilePluginPlatformState({ enabled: true, claude: false, codex: true }, 'claude')).toBe(false);
  });

  it('preserves prior ownership and config during a partial component install', async () => {
    const priorFile = join(projectPath, '.claude', 'commands', 'prior.md');
    mkdirSync(join(projectPath, '.claude', 'commands'), { recursive: true });
    writeFileSync(priorFile, 'prior');

    const prior = manifestApi.createManifest('project', projectPath, {
      selectedComponentIds: ['commands'],
    });
    manifestApi.addFile(prior, priorFile);
    manifestApi.recordCodexHooks(prior, {
      settingsPath: join(projectPath, '.codex', 'hooks.json'),
      installed: ['session-context'],
      level: 'minimal',
    });
    manifestApi.saveManifest(prior);

    await executor.executeInstallPipeline({
      config: config(['codex-agents']),
      pkgRoot: packageRoot,
      version: 'test',
    });

    const current = manifestApi.findManifest('project', projectPath);
    const installedAgent = join(projectPath, '.codex', 'agents', 'agent.toml');
    expect(current?.selectedComponentIds).toEqual(
      expect.arrayContaining(['commands', 'codex-agents']),
    );
    expect(current?.hooks?.codex?.installed).toEqual(['session-context']);
    expect(current?.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([priorFile, installedAgent]),
    );
    expect(existsSync(priorFile)).toBe(true);
    expect(existsSync(installedAgent)).toBe(true);
    expect(readFileSync(installedAgent, 'utf8')).toContain('developer_instructions = """');
    expect(current?.entries.some((entry) => entry.path.startsWith(process.env.MAESTRO_HOME!))).toBe(false);
    const shared = manifestApi.findManifest('global', process.env.MAESTRO_HOME!);
    expect(shared?.entries.map((entry) => entry.path)).toContain(
      join(process.env.MAESTRO_HOME!, 'version.json'),
    );
  });

  it('clears explicitly disabled config while preserving additive component ownership', async () => {
    const prior = manifestApi.createManifest('project', projectPath, {
      hookLevel: 'minimal',
      selectedComponentIds: ['commands'],
    });
    manifestApi.addFile(prior, join(projectPath, '.claude', 'commands', 'prior.md'));
    manifestApi.recordClaudeHooks(prior, { settingsPath: join(projectPath, 'claude.json'), installed: ['a'], level: 'minimal' });
    manifestApi.recordCodexHooks(prior, { settingsPath: join(projectPath, 'codex.json'), installed: ['b'], level: 'minimal' });
    manifestApi.recordAgyHooks(prior, { settingsPath: join(projectPath, 'agy.json'), installed: ['c'], level: 'minimal' });
    manifestApi.recordGenericHooks(prior, 'cursor', { settingsPath: join(projectPath, 'cursor.json'), installed: ['d'], level: 'minimal' });
    manifestApi.recordStatusline(prior, { settingsPath: join(projectPath, 'claude.json'), theme: 'notion' });
    manifestApi.recordClaudeMcp(prior, { configPath: join(projectPath, 'claude-mcp.json'), serverName: 'maestro-tools' });
    manifestApi.recordCodexMcp(prior, { configPath: join(projectPath, 'config.toml'), serverName: 'maestro-tools' });
    manifestApi.recordExtraMcp(prior, { targetId: 'cursor', configPath: join(projectPath, 'cursor-mcp.json'), serverName: 'maestro-tools' });
    manifestApi.saveManifest(prior);

    await executor.executeInstallPipeline({
      config: {
        ...config([]),
        installComponents: false,
        explicitlyDisabled: {
          claudeHooks: true, claudeMcp: true,
          codexHooks: true, codexMcp: true, agyHooks: true,
          genericHooks: ['cursor'], extraMcp: true, statusline: true,
        },
      },
      pkgRoot: packageRoot,
      version: 'test',
    });

    const current = manifestApi.findManifest('project', projectPath);
    expect(current?.selectedComponentIds).toEqual(['commands']);
    expect(current?.entries.map((entry) => entry.path)).toContain(
      join(projectPath, '.claude', 'commands', 'prior.md'),
    );
    expect(current?.hooks).toBeUndefined();
    expect(current?.statusline).toBeUndefined();
    expect(current?.mcp).toBeUndefined();
  });

  it('rejects unsafe generic hook removal without dropping its record', async () => {
    const prior = manifestApi.createManifest('project', projectPath, {
      selectedComponentIds: ['commands'],
    });
    manifestApi.recordGenericHooks(prior, 'legacy-unknown', {
      settingsPath: join(projectPath, 'legacy-hooks.json'),
      installed: ['session-context'],
      level: 'minimal',
    });
    manifestApi.saveManifest(prior);

    await expect(executor.executeInstallPipeline({
      config: {
        ...config([]),
        installComponents: false,
        explicitlyDisabled: { genericHooks: ['legacy-unknown'] },
      },
      pkgRoot: packageRoot,
      version: 'test',
    })).rejects.toThrow('Cannot safely remove generic hooks for unknown platforms: legacy-unknown');

    const current = manifestApi.findManifest('project', projectPath);
    expect(current?.id).toBe(prior.id);
    expect(current?.hooks?.generic?.['legacy-unknown']?.installed).toEqual(['session-context']);
  });

  it('validates unknown generic platforms before removing any other subsystem', async () => {
    const claudeSettingsPath = join(projectPath, 'mixed-claude-settings.json');
    const originalSettings = JSON.stringify({
      hooks: {
        PreToolUse: [{
          matcher: 'Agent',
          hooks: [{ type: 'command', command: 'maestro hooks run spec-injector' }],
        }],
      },
    }, null, 2);
    writeFileSync(claudeSettingsPath, originalSettings);

    const prior = manifestApi.createManifest('project', projectPath, {
      selectedComponentIds: ['commands'],
    });
    manifestApi.recordClaudeHooks(prior, {
      settingsPath: claudeSettingsPath,
      installed: ['spec-injector'],
      level: 'minimal',
    });
    manifestApi.recordGenericHooks(prior, 'legacy-unknown', {
      settingsPath: join(projectPath, 'legacy-hooks.json'),
      installed: ['session-context'],
      level: 'minimal',
    });
    manifestApi.saveManifest(prior);

    await expect(executor.executeInstallPipeline({
      config: {
        ...config([]),
        installComponents: false,
        explicitlyDisabled: {
          claudeHooks: true,
          genericHooks: ['legacy-unknown'],
        },
      },
      pkgRoot: packageRoot,
      version: 'test',
    })).rejects.toThrow('Cannot safely remove generic hooks for unknown platforms: legacy-unknown');

    expect(readFileSync(claudeSettingsPath, 'utf8')).toBe(originalSettings);
    const current = manifestApi.findManifest('project', projectPath);
    expect(current?.id).toBe(prior.id);
    expect(current?.hooks?.claude?.installed).toEqual(['spec-injector']);
    expect(current?.hooks?.generic?.['legacy-unknown']?.installed).toEqual(['session-context']);
  });

  it('keeps the concurrent manifest and non-component ownership on CAS failure', async () => {
    const ownedFile = join(projectPath, '.claude', 'commands', 'owned.md');
    const prior = manifestApi.createManifest('project', projectPath, {
      selectedComponentIds: ['commands'],
    });
    manifestApi.addFile(prior, ownedFile);
    manifestApi.recordCodexHooks(prior, {
      settingsPath: join(projectPath, '.codex', 'hooks.json'),
      installed: ['session-context'],
      level: 'minimal',
    });
    manifestApi.saveManifest(prior);

    let concurrentId = '';
    await expect(executor.executeInstallPipeline({
      config: { ...config([]), installComponents: false },
      pkgRoot: packageRoot,
      version: 'test',
      onProgress: (step, status) => {
        if (step !== 'manifest' || status !== 'active' || concurrentId) return;
        const concurrent = manifestApi.createManifest('project', projectPath, {
          selectedComponentIds: ['commands'],
        });
        manifestApi.addFile(concurrent, ownedFile);
        manifestApi.recordCodexHooks(concurrent, prior.hooks!.codex!);
        manifestApi.saveManifest(concurrent);
        concurrentId = concurrent.id;
      },
    })).rejects.toThrow('changed concurrently');

    const current = manifestApi.findManifest('project', projectPath);
    expect(current?.id).toBe(concurrentId);
    expect(current?.entries.map((entry) => entry.path)).toContain(ownedFile);
    expect(current?.hooks?.codex?.installed).toEqual(['session-context']);
  });
});
