import { readFile, writeFile, readdir, stat, access, constants } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Settings routes — config file read/write
// ---------------------------------------------------------------------------

/** Paths for settings files */
function getConfigPaths(workflowRoot: string) {
  return {
    cliTools: resolve(homedir(), '.claude', 'cli-tools.json'),
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

  return app;
}
