import { readFile, writeFile, readdir, stat, access, constants, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Settings routes — config file read/write
// ---------------------------------------------------------------------------

/** Paths for settings files */
function getConfigPaths(workflowRoot: string) {
  return {
    cliTools: resolve(homedir(), '.maestro', 'cli-tools.json'),
    dashboardConfig: resolve(workflowRoot, 'config.json'),
    specDir: resolve(workflowRoot, '.spec'),
  };
}

export function createSettingsRoutes(workflowRoot: string): Hono {
  const app = new Hono();
  const paths = getConfigPaths(workflowRoot);

  // Load LINEAR_API_KEY from config at startup
  void (async () => {
    try {
      const raw = await readFile(paths.dashboardConfig, 'utf-8');
      const json = JSON.parse(raw) as Record<string, unknown>;
      const settings = json['settings'] as Record<string, unknown> | undefined;
      const linear = settings?.['linear'] as Record<string, unknown> | undefined;
      const apiKey = typeof linear?.['apiKey'] === 'string' ? linear['apiKey'] : '';
      if (apiKey && !process.env.LINEAR_API_KEY) {
        process.env.LINEAR_API_KEY = apiKey;
      }
    } catch {
      // Config not found — skip
    }
  })();

  // -----------------------------------------------------------------------
  // GET /api/settings — read all config
  // -----------------------------------------------------------------------
  app.get('/api/settings', async (c) => {
    const result: Record<string, unknown> = {
      general: { theme: 'system', language: 'en' },
      agents: {},
      cliTools: '{}',
    };

    // Read dashboard config
    try {
      const raw = await readFile(paths.dashboardConfig, 'utf-8');
      const json = JSON.parse(raw) as Record<string, unknown>;
      if (json['settings']) {
        const settings = json['settings'] as Record<string, unknown>;
        if (settings['general']) result['general'] = settings['general'];
        if (settings['agents']) result['agents'] = settings['agents'];
      }
    } catch {
      // Config file missing — use defaults
    }

    // Read cli-tools.json
    try {
      const raw = await readFile(paths.cliTools, 'utf-8');
      // Validate it's valid JSON
      JSON.parse(raw);
      result['cliTools'] = raw;
    } catch {
      result['cliTools'] = '{}';
    }

    // Read linear settings
    try {
      const raw = await readFile(paths.dashboardConfig, 'utf-8');
      const json = JSON.parse(raw) as Record<string, unknown>;
      if (json['settings']) {
        const settings = json['settings'] as Record<string, unknown>;
        if (settings['linear']) {
          const linear = settings['linear'] as Record<string, unknown>;
          const apiKey = typeof linear['apiKey'] === 'string' ? linear['apiKey'] : '';
          result['linear'] = {
            apiKey: apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : '',
            configured: !!apiKey,
          };
        }
      }
    } catch {
      // Already handled above
    }
    if (!result['linear']) {
      result['linear'] = { apiKey: '', configured: false };
    }

    return c.json(result);
  });

  // -----------------------------------------------------------------------
  // PUT /api/settings/general — write dashboard general config
  // -----------------------------------------------------------------------
  app.put('/api/settings/general', async (c) => {
    try {
      const body = await c.req.json();

      // Read existing config
      let config: Record<string, unknown> = {};
      try {
        const raw = await readFile(paths.dashboardConfig, 'utf-8');
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Start with empty config
      }

      // Merge settings
      const settings = (config['settings'] ?? {}) as Record<string, unknown>;
      settings['general'] = body;
      config['settings'] = settings;

      await writeFile(paths.dashboardConfig, JSON.stringify(config, null, 2), 'utf-8');
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Write failed';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // PUT /api/settings/agents — write agent config
  // -----------------------------------------------------------------------
  app.put('/api/settings/agents', async (c) => {
    try {
      const body = await c.req.json();

      let config: Record<string, unknown> = {};
      try {
        const raw = await readFile(paths.dashboardConfig, 'utf-8');
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Start with empty config
      }

      const settings = (config['settings'] ?? {}) as Record<string, unknown>;
      settings['agents'] = body;
      config['settings'] = settings;

      await writeFile(paths.dashboardConfig, JSON.stringify(config, null, 2), 'utf-8');
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Write failed';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // PUT /api/settings/cli-tools — write cli-tools.json
  // -----------------------------------------------------------------------
  app.put('/api/settings/cli-tools', async (c) => {
    try {
      const body = (await c.req.json()) as { content: string };
      const content = body.content;

      // Validate JSON structure
      const parsed = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) {
        return c.json({ ok: false, error: 'Invalid JSON: must be an object' }, 400);
      }

      // Check write permission
      try {
        await access(paths.cliTools, constants.W_OK);
      } catch {
        return c.json(
          { ok: false, error: 'Cannot write to cli-tools.json: file is read-only or inaccessible' },
          403,
        );
      }

      await writeFile(paths.cliTools, JSON.stringify(parsed, null, 2), 'utf-8');
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Write failed';
      if (message.includes('JSON')) {
        return c.json({ ok: false, error: `Invalid JSON: ${message}` }, 400);
      }
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // PUT /api/settings/linear — write Linear API Key
  // -----------------------------------------------------------------------
  app.put('/api/settings/linear', async (c) => {
    try {
      const body = await c.req.json() as { apiKey?: string };
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

      let config: Record<string, unknown> = {};
      try {
        const raw = await readFile(paths.dashboardConfig, 'utf-8');
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Start with empty config
      }

      const settings = (config['settings'] ?? {}) as Record<string, unknown>;
      settings['linear'] = { apiKey };
      config['settings'] = settings;

      await writeFile(paths.dashboardConfig, JSON.stringify(config, null, 2), 'utf-8');

      // Also set the env var so linear routes pick it up immediately
      if (apiKey) {
        process.env.LINEAR_API_KEY = apiKey;
      } else {
        delete process.env.LINEAR_API_KEY;
      }

      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Write failed';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/settings/specs — list .workflow/.spec/ directories
  // -----------------------------------------------------------------------
  app.get('/api/settings/specs', async (c) => {
    try {
      const entries = await readdir(paths.specDir, { withFileTypes: true }).catch(() => []);
      const specs: { name: string; path: string; createdAt?: string }[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = join(paths.specDir, entry.name);
          let createdAt: string | undefined;
          try {
            const info = await stat(fullPath);
            createdAt = info.birthtime.toISOString();
          } catch {
            // Skip stat errors
          }
          specs.push({
            name: entry.name,
            path: `.workflow/.spec/${entry.name}`,
            createdAt,
          });
        }
      }

      // Sort by name descending (newest date-based names first)
      specs.sort((a, b) => b.name.localeCompare(a.name));

      return c.json({ specs });
    } catch {
      return c.json({ specs: [] });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/language/chinese-response — check status
  // -----------------------------------------------------------------------
  app.get('/api/language/chinese-response', async (c) => {
    try {
      const userClaudePath = join(homedir(), '.claude', 'CLAUDE.md');
      const userCodexPath = join(homedir(), '.codex', 'AGENTS.md');
      const chineseRefPattern = /@.*chinese-response\.md/i;
      const chineseSectionPattern = /## 中文回复/;
      const oldCodexRefPattern = /- \*\*中文回复准则\*\*:\s*@.*chinese-response\.md/i;

      let claudeEnabled = false;
      let codexEnabled = false;
      let codexNeedsMigration = false;

      if (existsSync(userClaudePath)) {
        const content = readFileSync(userClaudePath, 'utf8');
        claudeEnabled = chineseRefPattern.test(content);
      }

      if (existsSync(userCodexPath)) {
        const content = readFileSync(userCodexPath, 'utf8');
        codexEnabled = chineseSectionPattern.test(content);
        if (codexEnabled && oldCodexRefPattern.test(content)) {
          codexNeedsMigration = true;
        }
      }

      const guidelinesPath = join(homedir(), '.maestro', 'workflows', 'chinese-response.md');
      const guidelinesExists = existsSync(guidelinesPath);

      return c.json({ claudeEnabled, codexEnabled, codexNeedsMigration, guidelinesExists });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/language/chinese-response — toggle on/off
  // -----------------------------------------------------------------------
  app.post('/api/language/chinese-response', async (c) => {
    try {
      const body = await c.req.json() as { enabled: boolean; target: 'claude' | 'codex' };
      const { enabled, target = 'claude' } = body;

      if (typeof enabled !== 'boolean') {
        return c.json({ error: 'Missing or invalid enabled parameter' }, 400);
      }

      const guidelinesPath = join(homedir(), '.maestro', 'workflows', 'chinese-response.md');
      if (!existsSync(guidelinesPath)) {
        return c.json({ error: 'Chinese response guidelines file not found at ~/.maestro/workflows/chinese-response.md' }, 404);
      }

      const guidelinesRef = '~/.maestro/workflows/chinese-response.md';
      const isCodex = target === 'codex';
      const targetDir = isCodex ? join(homedir(), '.codex') : join(homedir(), '.claude');
      const targetFile = isCodex ? join(targetDir, 'AGENTS.md') : join(targetDir, 'CLAUDE.md');

      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      let content = '';
      if (existsSync(targetFile)) {
        content = readFileSync(targetFile, 'utf8');
      } else {
        content = isCodex ? '# Codex Code Guidelines\n\n' : '# Claude Instructions\n\n';
      }

      if (isCodex) {
        const chineseSectionRe = /\n*## 中文回复\n[\s\S]*?(?=\n## |$)/;
        const oldRefRe = /- \*\*中文回复准则\*\*:\s*@.*chinese-response\.md/i;

        if (enabled) {
          const hasSection = chineseSectionRe.test(content);
          if (hasSection) {
            const hasOldRef = oldRefRe.test(content);
            if (hasOldRef) {
              content = content.replace(chineseSectionRe, '\n').replace(/\n{3,}/g, '\n\n').trim();
              if (content) content += '\n';
              const chineseContent = readFileSync(guidelinesPath, 'utf8');
              content = content.trimEnd() + '\n\n## 中文回复\n\n' + chineseContent + '\n';
              writeFileSync(targetFile, content, 'utf8');
              return c.json({ success: true, enabled, migrated: true });
            }
            return c.json({ success: true, message: 'Already enabled' });
          }
          const chineseContent = readFileSync(guidelinesPath, 'utf8');
          content = content.trimEnd() + '\n\n## 中文回复\n\n' + chineseContent + '\n';
        } else {
          content = content.replace(chineseSectionRe, '\n').replace(/\n{3,}/g, '\n\n').trim();
          if (content) content += '\n';
        }
      } else {
        const chineseRefLine = `- **中文回复准则**: @${guidelinesRef}`;
        const chineseRefRe = /^- \*\*中文回复准则\*\*:.*chinese-response\.md.*$/gm;
        const chineseSectionRe = /\n*## 中文回复\n+- \*\*中文回复准则\*\*:.*chinese-response\.md.*\n*/gm;

        if (enabled) {
          if (chineseRefRe.test(content)) {
            return c.json({ success: true, message: 'Already enabled' });
          }
          content = content.trimEnd() + '\n\n## 中文回复\n\n' + chineseRefLine + '\n';
        } else {
          content = content.replace(chineseSectionRe, '\n').replace(/\n{3,}/g, '\n\n').trim();
          if (content) content += '\n';
        }
      }

      writeFileSync(targetFile, content, 'utf8');
      return c.json({ success: true, enabled, target });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  return app;
}
