import type { Pane } from '@rmux/sdk';
import type { AgentConfig, AgentTool, AskOptions } from './types.js';
import { stripAnsi } from './utils/output-cleaner.js';
import { execSync } from 'node:child_process';

function rmuxExec(args: string): string {
  try {
    return execSync(`rmux ${args}`, { encoding: 'utf-8', timeout: 10_000 }).trim();
  } catch (e: any) {
    return e.stdout?.trim() ?? '';
  }
}

export function getDefaultMarker(tool: AgentTool): string | RegExp {
  switch (tool) {
    case 'claude':
      return /[❯>]\s*$/;
    case 'codex':
      return /[$>]\s*$/;
    case 'gemini':
      return /[>$]\s*$/;
    case 'opencode':
      return /[>$]\s*$/;
    case 'shell':
      return /[$#>]\s*$/;
  }
}

function resolveExePath(name: string): string {
  if (process.platform !== 'win32') return name;
  const npmDir = process.env.APPDATA
    ? `${process.env.APPDATA}\\npm\\node_modules`
    : '';
  const paths: Record<string, string> = {
    claude: `${npmDir}\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
    codex: `${npmDir}\\@openai\\codex\\bin\\codex.exe`,
  };
  return paths[name] ?? name;
}

export function getLaunchCommand(config: AgentConfig): string {
  switch (config.tool) {
    case 'claude': {
      const exe = config.launchCommand ?? resolveExePath('claude');
      const prefix = process.platform === 'win32' ? `& '${exe}'` : exe;
      const settingsFlag = config.settings ? ` --settings '${config.settings}'` : '';
      return `${prefix} --dangerously-skip-permissions --permission-mode bypassPermissions${settingsFlag}${config.model ? ` --model ${config.model}` : ''}`;
    }
    case 'codex': {
      const exe = config.launchCommand ?? 'codex';
      return `${exe} --dangerously-bypass-approvals-and-sandbox${config.model ? ` --model ${config.model}` : ''}`;
    }
    case 'gemini':
      return 'gemini --skip-trust --approval-mode yolo';
    case 'opencode':
      return 'opencode';
    case 'shell':
      return config.launchCommand ?? (process.platform === 'win32' ? 'cmd.exe' : 'bash');
  }
}

export function isCliAgent(tool: AgentTool): boolean {
  return tool !== 'shell';
}

const SEND_ENTER_DELAY = 150;

function matchesMarker(text: string, marker: string | RegExp): boolean {
  if (typeof marker === 'string') {
    return text.includes(marker);
  }
  return marker.test(text);
}

let sentinelCounter = 0;
function nextSentinel(): string {
  return `__RD${++sentinelCounter}__`;
}

export class Agent {
  readonly name: string;
  readonly pane: Pane;
  readonly config: AgentConfig;
  readonly target: string;

  private completionMarker: string | RegExp;
  private _alive = true;

  constructor(pane: Pane, config: AgentConfig, target?: string) {
    this.pane = pane;
    this.name = config.name;
    this.config = config;
    this.target = target ?? pane.target;
    this.completionMarker = config.completionMarker ?? getDefaultMarker(config.tool);
  }

  get alive(): boolean { return this._alive; }

  private sendKeysLiteral(text: string): void {
    rmuxExec(`send-keys -t ${this.target} -l "${text.replace(/"/g, '\\"')}"`);
  }

  private sendKeysRaw(key: string): void {
    rmuxExec(`send-keys -t ${this.target} ${key}`);
  }

  private capturePane(scrollback = 200): string {
    return rmuxExec(`capture-pane -p -t ${this.target} -S -${scrollback}`);
  }

  async interrupt(): Promise<void> {
    await this.pane.sendKeys('C-c');
  }

  async kill(): Promise<void> {
    this._alive = false;
    await this.pane.close();
  }

  async ask(prompt: string, opts?: AskOptions): Promise<string> {
    const timeout = opts?.timeout ?? 120_000;

    if (this.config.tool === 'shell') {
      return this.askShell(prompt, timeout);
    }
    return this.askCli(prompt, timeout);
  }

  private async askShell(prompt: string, timeout: number): Promise<string> {
    const sentinel = nextSentinel();
    const fullCmd = `${prompt} && echo ${sentinel}`;

    await this.pane.sendText(fullCmd);
    await sleep(SEND_ENTER_DELAY);
    await this.pane.sendKeys('Enter');
    await this.pane.waitForText(sentinel, { timeout });

    const snap = await this.pane.snapshot();
    const lines = snap.lines.filter(l => l.trim());

    const cmdIdx = lines.findLastIndex(l => l.includes(prompt.trim().slice(0, 30)));
    const sentinelIdx = lines.findIndex((l, i) => i > cmdIdx && l.trim() === sentinel);

    if (sentinelIdx === -1 || cmdIdx === -1) {
      return lines
        .filter(l => !l.includes(sentinel) && !l.includes('__RD'))
        .join('\n');
    }

    const outputLines = lines
      .slice(cmdIdx + 1, sentinelIdx)
      .filter(l => !l.includes('__RD'));
    return outputLines.join('\n');
  }

  private async askCli(prompt: string, timeout: number): Promise<string> {
    const beforeText = this.capturePane();

    this.sendKeysLiteral(prompt);
    await sleep(SEND_ENTER_DELAY);
    this.sendKeysRaw('C-m');

    let stableCount = 0;
    let lastSnap = '';

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await sleep(2000);
      const current = this.capturePane();
      const lines = current.split('\n').filter(l => l.trim());

      if (lines.length === 0) continue;

      const hasNewContent = current.length > beforeText.length;
      const markerFound = lines.some(l => matchesMarker(l.trim(), this.completionMarker));

      if (hasNewContent && markerFound && current.includes(prompt.trim().slice(0, 20))) {
        if (current === lastSnap) {
          stableCount++;
          if (stableCount >= 1) {
            return this.extractCliResponse(current, beforeText, prompt);
          }
        } else {
          stableCount = 0;
          lastSnap = current;
        }
      } else {
        stableCount = 0;
        lastSnap = current;
      }
    }
    throw new Error(`Agent "${this.name}" ask() timed out after ${timeout}ms`);
  }

  private extractCliResponse(current: string, beforeText: string, prompt: string): string {
    const lines = current.split('\n').filter(l => l.trim());
    const beforeLines = beforeText.split('\n').filter(l => l.trim());

    const promptSnippet = prompt.trim().slice(0, 30);
    const echoIdx = lines.findLastIndex(l => l.includes(promptSnippet));
    const startIdx = echoIdx >= 0 ? echoIdx + 1 : beforeLines.length;

    const resultLines = lines.slice(startIdx).filter(l => {
      const t = l.trim();
      if (!t) return false;
      if (matchesMarker(t, this.completionMarker)) return false;
      if (/^[─━═┄┅┈┉─]{4,}$/.test(t)) return false;
      if (t.startsWith('⏵') || t.startsWith('←')) return false;
      if (/^[✻✓◉⏵▶].*(?:for \d+s|Crunched|Worked|Cogitated|Unravelling|Pondering)/.test(t)) return false;
      return true;
    });
    return resultLines.join('\n');
  }

  async send(prompt: string): Promise<void> {
    if (isCliAgent(this.config.tool)) {
      this.sendKeysLiteral(prompt);
      await sleep(SEND_ENTER_DELAY);
      this.sendKeysRaw('C-m');
    } else {
      await this.pane.sendText(prompt);
      await sleep(SEND_ENTER_DELAY);
      await this.pane.sendKeys('Enter');
    }
  }

  async isIdle(): Promise<boolean> {
    const text = this.capturePane(10);
    const lines = text.split('\n').filter(l => l.trim());
    return lines.some(l => matchesMarker(l.trim(), this.completionMarker));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
