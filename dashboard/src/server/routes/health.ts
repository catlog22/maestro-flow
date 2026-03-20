import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Hono } from 'hono';

import type { StateManager } from '../state/state-manager.js';

export function createHealthRoute(workflowRoot: string, stateManager?: StateManager): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      workspace: workflowRoot,
    });
  });

  app.post('/api/shutdown', (c) => {
    // Respond before shutting down so the client sees success
    setTimeout(() => {
      console.log('Shutdown requested via API, exiting...');
      process.exit(0);
    }, 200);
    return c.json({ status: 'shutting_down' });
  });

  app.post('/api/workspace', async (c) => {
    if (!stateManager) {
      return c.json({ error: 'stateManager not available' }, 500);
    }

    let body: { path?: string };
    try {
      body = await c.req.json<{ path?: string }>();
    } catch {
      return c.json({ error: 'invalid path' }, 400);
    }

    const newPath = body?.path;
    if (!newPath || !existsSync(join(newPath, '.workflow'))) {
      return c.json({ error: 'invalid path' }, 400);
    }

    try {
      await stateManager.resetForNewWorkspace(newPath);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already in progress')) {
        return c.json({ error: 'Workspace switch already in progress' }, 429);
      }
      throw err;
    }
    return c.json({ status: 'ok', workspace: newPath });
  });

  return app;
}
