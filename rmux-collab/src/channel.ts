import { Rmux, PaneSet } from '@rmux/sdk';
import type { Session } from '@rmux/sdk';
import type { AgentResult, AskOptions, ChannelConfig } from './types.js';
import { Agent, getLaunchCommand, getDefaultMarker, isCliAgent } from './agent.js';
import { broadcastCollect } from './patterns/broadcast-collect.js';
import { openTerminalWindow } from './utils/terminal.js';
import { execSync } from 'node:child_process';

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'NODE_PATH' || k === 'NODE_OPTIONS') continue;
    env[k] = v;
  }
  return env;
}

function rmuxCmd(args: string): string {
  try {
    return execSync(`rmux ${args}`, { encoding: 'utf-8', timeout: 10_000, env: cleanEnv() }).trim();
  } catch (e: any) {
    return e.stdout?.trim() ?? '';
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class Channel {
  readonly name: string;
  readonly agents: Map<string, Agent> = new Map();

  private rmux: Rmux;
  private sessionNames: string[] = [];

  private constructor(name: string, rmux: Rmux) {
    this.name = name;
    this.rmux = rmux;
  }

  static async create(rmux: Rmux, config: ChannelConfig): Promise<Channel> {
    const channel = new Channel(config.name, rmux);
    const visible = config.visible ?? true;

    for (const agentConfig of config.agents) {
      const sessionName = `${config.name}-${agentConfig.name}`;
      channel.sessionNames.push(sessionName);

      rmuxCmd(`kill-session -t ${sessionName}`);
      const shell = process.platform === 'win32' ? 'pwsh' : '';
      rmuxCmd(`new-session -d -s ${sessionName} -n ${agentConfig.name} ${shell}`);

      const target = `${sessionName}:0.0`;
      const command = getLaunchCommand(agentConfig);
      const cwd = agentConfig.cwd ?? config.cwd;

      // Wait for shell to be ready (pwsh profile loading takes ~2-3s)
      if (isCliAgent(agentConfig.tool)) {
        await sleep(4000);
      } else {
        await sleep(1000);
      }

      const escaped = command.replace(/"/g, '\\"');
      const home = process.env.USERPROFILE ?? process.env.HOME ?? '.';
      const targetDir = cwd ?? (isCliAgent(agentConfig.tool) ? home : undefined);

      if (process.platform === 'win32') {
        if (targetDir) {
          rmuxCmd(`send-keys -t ${target} -l "Set-Location '${targetDir}'; ${escaped}"`);
        } else {
          rmuxCmd(`send-keys -t ${target} -l "${escaped}"`);
        }
      } else {
        const prefix = targetDir ? `cd '${targetDir}' && ` : '';
        rmuxCmd(`send-keys -t ${target} -l "${prefix}${escaped}"`);
      }
      await sleep(200);
      rmuxCmd(`send-keys -t ${target} C-m`);

      if (visible) {
        openTerminalWindow(sessionName, `[${config.name}] ${agentConfig.name}`);
      }

      const session = rmux.session(sessionName);
      const pane = session.pane(0, 0);
      const agent = new Agent(pane, agentConfig, target);
      channel.agents.set(agentConfig.name, agent);

      const marker = agentConfig.completionMarker ?? getDefaultMarker(agentConfig.tool);
      const markerStr = typeof marker === 'string' ? marker : '>';
      const waitTimeout = isCliAgent(agentConfig.tool) ? 30_000 : 10_000;

      try {
        const deadline = Date.now() + waitTimeout;
        while (Date.now() < deadline) {
          await sleep(1000);
          const cap = rmuxCmd(`capture-pane -p -t ${target}`);
          if (cap.includes(markerStr) || (typeof marker !== 'string' && marker.test(cap))) {
            break;
          }
        }
      } catch {}
    }

    return channel;
  }

  get(name: string): Agent {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent "${name}" not found in channel "${this.name}"`);
    }
    return agent;
  }

  paneSet(): PaneSet {
    const panes = [...this.agents.values()].map(a => a.pane);
    return new PaneSet(panes);
  }

  async broadcast(prompt: string, opts?: AskOptions): Promise<AgentResult[]> {
    return broadcastCollect([...this.agents.values()], prompt, opts);
  }

  async destroy(): Promise<void> {
    for (const name of this.sessionNames) {
      rmuxCmd(`kill-session -t ${name}`);
    }
    this.sessionNames = [];
    this.agents.clear();
  }
}
