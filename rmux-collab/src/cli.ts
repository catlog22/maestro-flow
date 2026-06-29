#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Coordinator } from './coordinator.js';
import type { CoordinatorConfig, ChannelConfig } from './types.js';

interface CliConfig {
  channels: ChannelConfig[];
}

async function loadConfig(path: string): Promise<CliConfig> {
  const abs = resolve(path);
  const mod = await import(pathToFileURL(abs).href);
  return mod.default ?? mod;
}

function usage(): never {
  console.log(`
rmux-collab — Multi-agent collaboration via rmux channels

Usage:
  rmux-collab start <config.ts>       Start coordinator with config
  rmux-collab ask <channel> <agent> "<prompt>"
  rmux-collab broadcast <channel> "<prompt>"
  rmux-collab list                    List active sessions
  rmux-collab stop                    Stop all sessions

Config file exports: { channels: ChannelConfig[] }
`);
  process.exit(0);
}

async function main() {
  const [,, cmd, ...args] = process.argv;

  if (!cmd || cmd === '--help' || cmd === '-h') usage();

  switch (cmd) {
    case 'start': {
      const configPath = args[0];
      if (!configPath) { console.error('Missing config path'); process.exit(1); }

      const config = await loadConfig(configPath);
      console.log(`Starting coordinator with ${config.channels.length} channel(s)...`);

      const coord = await Coordinator.create({ channels: config.channels });

      for (const [name, ch] of [...(coord as any).channels]) {
        console.log(`  Channel "${name}": ${[...ch.agents.keys()].join(', ')}`);
      }

      console.log('\nCoordinator running. Press Ctrl+C to stop.');
      await new Promise<void>(resolve => {
        process.on('SIGINT', async () => {
          console.log('\nShutting down...');
          await coord.shutdown();
          resolve();
        });
      });
      break;
    }

    case 'ask': {
      const [channel, agent, prompt] = args;
      if (!channel || !agent || !prompt) {
        console.error('Usage: rmux-collab ask <channel> <agent> "<prompt>"');
        process.exit(1);
      }
      const coord = await Coordinator.create();
      await coord.addChannel({ name: channel, agents: [{ name: agent, tool: 'shell', completionMarker: '>' }] });
      const result = await coord.ask(channel, agent, prompt);
      console.log(result.output);
      await coord.shutdown();
      break;
    }

    case 'broadcast': {
      const [channel, prompt] = args;
      if (!channel || !prompt) {
        console.error('Usage: rmux-collab broadcast <channel> "<prompt>"');
        process.exit(1);
      }
      // Attach to existing session
      const { Rmux } = await import('@rmux/sdk');
      const rmux = new Rmux();
      const sessions = await rmux.listSessions();
      const found = sessions.find((s: any) => s.name === channel);
      if (!found) { console.error(`Channel "${channel}" not found`); process.exit(1); }
      console.log(`Broadcasting to channel "${channel}"...`);
      await rmux.sendText(channel, prompt);
      break;
    }

    case 'list': {
      const { Rmux } = await import('@rmux/sdk');
      const rmux = new Rmux();
      const sessions = await rmux.listSessions();
      if (sessions.length === 0) { console.log('No active sessions'); break; }
      for (const s of sessions) {
        const name = (s as any).session_name ?? 'unknown';
        const windows = (s as any).session_windows ?? 0;
        console.log(`  ${name} (${windows} window${windows !== 1 ? 's' : ''})`);
      }
      break;
    }

    case 'stop': {
      const { Rmux } = await import('@rmux/sdk');
      const rmux = new Rmux();
      const sessions = await rmux.sessions();
      for (const s of sessions) {
        await s.kill();
        console.log(`  Killed: ${s.name}`);
      }
      console.log('All sessions stopped.');
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
