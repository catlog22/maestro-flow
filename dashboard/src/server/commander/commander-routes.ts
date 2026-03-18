// ---------------------------------------------------------------------------
// Commander REST API routes — start, stop, pause, status, config
// ---------------------------------------------------------------------------

import { Hono } from 'hono';

import type { CommanderAgent } from './commander-agent.js';
import type { CommanderConfig } from '../../shared/commander-types.js';

/**
 * Commander routes following the Hono factory pattern.
 *
 * POST  /api/commander/start   start the commander tick loop
 * POST  /api/commander/stop    stop the commander tick loop
 * POST  /api/commander/pause   pause/resume the commander
 * GET   /api/commander/status  current commander state
 * PUT   /api/commander/config  update commander config
 */
export function createCommanderRoutes(commanderAgent: CommanderAgent): Hono {
  const app = new Hono();

  // POST /api/commander/start — start the commander tick loop
  app.post('/api/commander/start', async (c) => {
    try {
      await commanderAgent.start();
      return c.json({ ok: true, state: commanderAgent.getState() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/commander/stop — stop the commander tick loop
  app.post('/api/commander/stop', (c) => {
    try {
      commanderAgent.stop();
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/commander/pause — toggle pause/resume
  app.post('/api/commander/pause', (c) => {
    try {
      const state = commanderAgent.getState();
      if (state.status === 'paused') {
        commanderAgent.resume();
      } else {
        commanderAgent.pause();
      }
      return c.json({ ok: true, state: commanderAgent.getState() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/commander/status — current state snapshot
  app.get('/api/commander/status', (c) => {
    return c.json(commanderAgent.getState());
  });

  // PUT /api/commander/config — update commander config
  app.put('/api/commander/config', async (c) => {
    try {
      const body = await c.req.json<Partial<CommanderConfig>>();
      commanderAgent.updateConfig(body);
      return c.json({ ok: true, config: commanderAgent.getConfig() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
