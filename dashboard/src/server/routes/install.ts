/**
 * Install Routes — Interactive install wizard API endpoints.
 *
 * Dashboard web UI counterpart of CLI `maestro install` (src/commands/install.ts).
 * Uses the same manifest format and storage path (~/.maestro/manifests/).
 */
import { Hono } from 'hono';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';
// ---------------------------------------------------------------------------
// Addon Registry — inline to avoid circular build dependency
// ---------------------------------------------------------------------------

interface AddonTarget {
  harness: string;
  srcPath: string;
  destPath: string;
}

interface AddonDef {
  id: string;
  name: string;
  description: string;
  repo: string;
  branch: string;
  targets: AddonTarget[];
  homepage?: string;
  tags?: string[];
}

const ADDON_REGISTRY: AddonDef[] = [
  {
    id: 'impeccable',
    name: 'Impeccable',
    description: 'Production-grade frontend design — 23 commands for UI craft, critique, polish, and iteration',
    repo: 'pbakaus/impeccable',
    branch: 'main',
    targets: [
      { harness: 'claude', srcPath: '.claude/skills/impeccable', destPath: '.claude/skills/impeccable' },
      { harness: 'codex', srcPath: '.codex/agents', destPath: '.codex/agents' },
    ],
    homepage: 'https://impeccable.style',
    tags: ['design', 'frontend', 'ui', 'ux'],
  },
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    description: 'Design intelligence — 50+ styles, 97 palettes, 57 font pairings, 99 UX guidelines across 9 stacks',
    repo: 'nextlevelbuilder/ui-ux-pro-max-skill',
    branch: 'main',
    targets: [
      { harness: 'claude', srcPath: '.claude/skills/ui-ux-pro-max', destPath: '.claude/skills/ui-ux-pro-max' },
      { harness: 'codex', srcPath: '.claude/skills/ui-ux-pro-max', destPath: '.codex/skills/ui-ux-pro-max' },
    ],
    homepage: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    tags: ['design', 'ui', 'ux', 'tokens', 'typography'],
  },
];
import {
  resolveSourceDir,
  scanAvailableSources,
  scanDisabledItems,
  restoreDisabledState,
  copyDirectory,
  injectDocFile,
  createManifest,
  saveManifest,
  findManifest,
  getAllManifests,
  createBackup,
  getPackageVersion,
  writeVersionFile,
  COMPONENT_DEFS,
  MAESTRO_HOME,
  type Manifest,
  type DetectionResult,
  type InstallResult,
} from './install-utils.js';

// ---------------------------------------------------------------------------
// MCP config helpers (reuse patterns from mcp.ts)
// ---------------------------------------------------------------------------

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');

function addGlobalMcpServer(name: string, config: unknown): { success?: boolean; error?: string } {
  try {
    if (!existsSync(CLAUDE_CONFIG_PATH)) {
      writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify({ mcpServers: {} }, null, 2), 'utf-8');
    }
    const cc = JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'));
    if (!cc.mcpServers) cc.mcpServers = {};
    cc.mcpServers[name] = config;
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(cc, null, 2), 'utf-8');
    return { success: true };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function addProjectMcpServer(projectPath: string, name: string, config: unknown): { success?: boolean; error?: string } {
  try {
    const fp = join(projectPath, '.mcp.json');
    let mj: Record<string, unknown> = { mcpServers: {} };
    if (existsSync(fp)) {
      mj = JSON.parse(readFileSync(fp, 'utf-8'));
      if (!mj.mcpServers) mj.mcpServers = {};
    }
    (mj.mcpServers as Record<string, unknown>)[name] = config;
    writeFileSync(fp, JSON.stringify(mj, null, 2), 'utf-8');
    return { success: true };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createInstallRoutes(): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------
  // POST /api/install/detect — Pre-install scan
  // -------------------------------------------------------------------

  app.post('/api/install/detect', async (c) => {
    const body = await c.req.json<{ mode: 'global' | 'project'; projectPath?: string }>();
    const { mode, projectPath } = body;

    if (!mode || (mode !== 'global' && mode !== 'project')) {
      return c.json({ error: 'mode must be "global" or "project"' }, 400);
    }
    if (mode === 'project' && (!projectPath || !projectPath.trim())) {
      return c.json({ error: 'projectPath required for project mode' }, 400);
    }

    const thisDir = dirname(fileURLToPath(import.meta.url));
    const sourceDir = resolveSourceDir(thisDir);
    if (!sourceDir) {
      return c.json({ error: 'Could not find maestro package root' }, 500);
    }

    const components = scanAvailableSources(sourceDir, mode, projectPath);
    const targetPath = mode === 'global' ? MAESTRO_HOME : projectPath!;
    const existingManifest = findManifest(mode, targetPath);
    const targetBase = mode === 'global' ? homedir() : projectPath!;
    const disabledItems = scanDisabledItems(targetBase);

    const result: DetectionResult = {
      sourceDir,
      components,
      existingManifest,
      disabledItems,
    };

    return c.json(result);
  });

  // -------------------------------------------------------------------
  // POST /api/install/execute — Perform installation
  // -------------------------------------------------------------------

  app.post('/api/install/execute', async (c) => {
    const body = await c.req.json<{
      mode: 'global' | 'project';
      projectPath?: string;
      components: string[];
      backup: boolean;
      mcpConfig?: {
        enabled: boolean;
        enabledTools?: string[];
        projectRoot?: string;
      };
    }>();

    const { mode, projectPath, components, backup, mcpConfig } = body;

    if (!mode || !components?.length) {
      return c.json({ error: 'mode and components required' }, 400);
    }
    if (mode === 'project' && (!projectPath || !projectPath.trim())) {
      return c.json({ error: 'projectPath required for project mode' }, 400);
    }

    try {
      const thisDir = dirname(fileURLToPath(import.meta.url));
      const sourceDir = resolveSourceDir(thisDir);
      if (!sourceDir) {
        return c.json({ error: 'Could not find maestro package root' } satisfies Partial<InstallResult>, 500);
      }

      const targetBase = mode === 'global' ? homedir() : projectPath!;
      const targetPath = mode === 'global' ? MAESTRO_HOME : projectPath!;

      // Backup existing manifest if requested
      if (backup) {
        const existing = findManifest(mode, targetPath);
        if (existing) createBackup(existing);
      }

      // Scan disabled items before overwriting
      const disabledItems = scanDisabledItems(targetBase);

      // Create manifest (same format as CLI `maestro install`)
      const manifest = createManifest(mode, targetPath);

      const stats = { files: 0, dirs: 0, skipped: 0 };
      const migrationWarnings: string[] = [];

      for (const compId of components) {
        if (compId === 'mcp') continue;

        const def = COMPONENT_DEFS.find((d: { id: string }) => d.id === compId);
        if (!def) continue;

        const src = join(sourceDir, def.sourcePath);
        const dest = def.target(mode, projectPath ?? '');

        if (!existsSync(src)) continue;

        if (def.inject) {
          const r = injectDocFile(src, dest, stats, manifest, def.section);
          if (r.warning) migrationWarnings.push(r.warning);
        } else {
          const { files, dirs } = copyDirectory(src, dest, manifest);
          stats.files += files;
          stats.dirs += dirs;
        }
      }

      // Restore disabled state
      const disabledRestored = restoreDisabledState(disabledItems, targetBase);

      // Write version file (same as CLI)
      const version = getPackageVersion(sourceDir);
      writeVersionFile(MAESTRO_HOME, version);

      // Register MCP config if requested
      let mcpRegistered = false;
      if (mcpConfig?.enabled && components.includes('mcp')) {
        const isWin = process.platform === 'win32';
        const env: Record<string, string> = {
          MAESTRO_ENABLED_TOOLS: mcpConfig.enabledTools?.join(',') ?? 'write_file,edit_file,read_file,read_many_files,team_msg,store_knowhow',
        };
        if (mcpConfig.projectRoot) env.MAESTRO_PROJECT_ROOT = mcpConfig.projectRoot;

        const serverConfig = {
          command: isWin ? 'cmd' : 'npx',
          args: isWin ? ['/c', 'npx', '-y', 'maestro-mcp'] : ['-y', 'maestro-mcp'],
          env,
        };

        const mcpResult =
          mode === 'project' && projectPath
            ? addProjectMcpServer(projectPath, 'maestro-tools', serverConfig)
            : addGlobalMcpServer('maestro-tools', serverConfig);

        mcpRegistered = 'success' in mcpResult && mcpResult.success === true;
      }

      // Save manifest (replaces old one for same scope+targetPath)
      const manifestPath = saveManifest(manifest);

      const result: InstallResult = {
        success: true,
        filesInstalled: stats.files,
        dirsCreated: stats.dirs,
        manifestPath,
        disabledItemsRestored: disabledRestored,
        mcpRegistered,
        components,
        migrationWarnings: migrationWarnings.length > 0 ? migrationWarnings : undefined,
      };

      return c.json(result);
    } catch (error: unknown) {
      return c.json({
        success: false,
        filesInstalled: 0,
        dirsCreated: 0,
        manifestPath: '',
        disabledItemsRestored: 0,
        mcpRegistered: false,
        components: [],
        error: (error as Error).message,
      } satisfies InstallResult, 500);
    }
  });

  // -------------------------------------------------------------------
  // GET /api/install/manifests — List existing installations
  // -------------------------------------------------------------------

  app.get('/api/install/manifests', (c) => {
    return c.json({ manifests: getAllManifests() });
  });

  // -------------------------------------------------------------------
  // GET /api/install/addons — List available addons with install status
  // -------------------------------------------------------------------

  app.get('/api/install/addons', (c) => {
    const mode = (c.req.query('mode') ?? 'global') as 'global' | 'project';
    const projectPath = c.req.query('projectPath') ?? '';
    const targetBase = mode === 'global' ? homedir() : projectPath;

    const addons = ADDON_REGISTRY.map((addon) => {
      // Check install status per harness
      const harnesses: Record<string, boolean> = {};
      for (const t of addon.targets) {
        const destDir = join(targetBase, t.destPath);
        harnesses[t.harness] = existsSync(destDir) && (
          existsSync(join(destDir, 'SKILL.md')) || existsSync(join(destDir, 'AGENTS.md')) ||
          // For dirs without SKILL.md (e.g. codex agents), check any file exists
          existsSync(destDir)
        );
      }
      return {
        id: addon.id,
        name: addon.name,
        description: addon.description,
        repo: addon.repo,
        homepage: addon.homepage,
        tags: addon.tags,
        harnesses,
        installed: Object.values(harnesses).some(Boolean),
      };
    });

    return c.json({ addons });
  });

  // -------------------------------------------------------------------
  // POST /api/install/addon — Install an addon from GitHub
  // -------------------------------------------------------------------

  app.post('/api/install/addon', async (c) => {
    const body = await c.req.json<{
      addonId: string;
      mode: 'global' | 'project';
      projectPath?: string;
      harnesses?: string[];  // ['claude', 'codex'] — default: all available
    }>();

    const { addonId, mode, projectPath, harnesses: requestedHarnesses } = body;
    const addon = ADDON_REGISTRY.find((a) => a.id === addonId);
    if (!addon) {
      return c.json({ success: false, error: `Addon "${addonId}" not found in registry` }, 404);
    }

    const targetBase = mode === 'global' ? homedir() : projectPath!;

    // Filter targets by requested harnesses (default: all)
    const targets = requestedHarnesses?.length
      ? addon.targets.filter((t) => requestedHarnesses.includes(t.harness))
      : addon.targets;

    if (targets.length === 0) {
      return c.json({ success: false, error: 'No matching harness targets' }, 400);
    }

    try {
      // Clone repo to temp dir (shallow, depth 1)
      const tmp = join(tmpdir(), `maestro-addon-${addonId}-${Date.now()}`);
      mkdirSync(tmp, { recursive: true });

      execSync(
        `git clone --depth 1 --branch ${addon.branch} https://github.com/${addon.repo}.git "${tmp}"`,
        { stdio: 'pipe', timeout: 60_000 },
      );

      // Copy each target
      const installed: string[] = [];
      for (const target of targets) {
        const srcDir = join(tmp, target.srcPath);
        const destDir = join(targetBase, target.destPath);

        if (!existsSync(srcDir)) continue;

        mkdirSync(destDir, { recursive: true });
        cpSync(srcDir, destDir, { recursive: true });
        installed.push(`${target.harness}: ${target.destPath}`);
      }

      // Cleanup temp
      rmSync(tmp, { recursive: true, force: true });

      return c.json({
        success: true,
        addon: addon.id,
        installed,
        message: `${addon.name} installed: ${installed.join(', ')}`,
      });
    } catch (error: unknown) {
      return c.json({
        success: false,
        error: `Failed to install ${addon.name}: ${(error as Error).message}`,
      }, 500);
    }
  });

  return app;
}
