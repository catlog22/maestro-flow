import type { Pane } from '@rmux/sdk';
import type { AgentConfig, AgentResult, AgentTool, AskOptions, OutputSegment } from './types.js';
import { stripAnsi } from './utils/output-cleaner.js';
import { execSync } from 'node:child_process';

function rmuxExec(args: string, opts?: { input?: string; timeout?: number; throwOnError?: boolean }): string {
  try {
    return execSync(`rmux ${args}`, {
      encoding: 'utf-8',
      timeout: opts?.timeout ?? 10_000,
      input: opts?.input,
    }).trim();
  } catch (e: any) {
    if (opts?.throwOnError) throw e;
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

const SEND_ENTER_DELAY = 300;

function matchesMarker(text: string, marker: string | RegExp): boolean {
  if (typeof marker === 'string') {
    return text.includes(marker);
  }
  return marker.test(text);
}

function markerToString(marker: string | RegExp): string {
  if (typeof marker === 'string') return marker;
  // Extract a simple literal from the regex for CLI usage
  const src = marker.source;
  if (src.includes('❯')) return '❯';
  if (src.includes('$')) return '$';
  if (src.includes('>')) return '>';
  return '>';
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

  private sendViaBuffer(text: string): void {
    const bufName = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    rmuxExec(`load-buffer -b ${bufName} -`, { input: text });
    rmuxExec(`paste-buffer -p -t ${this.target} -b ${bufName}`);
    rmuxExec(`delete-buffer -b ${bufName}`);
  }

  private sendKeysLiteral(text: string, pasteThreshold?: number): void {
    const threshold = pasteThreshold ?? 1024;
    if (text.length > threshold) {
      this.sendViaBuffer(text);
    } else {
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
      rmuxExec(`send-keys -t ${this.target} -l "${escaped}"`);
    }
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

  async ask(prompt: string, opts?: AskOptions): Promise<AgentResult> {
    const timeout = opts?.timeout ?? 120_000;

    if (this.config.tool === 'shell') {
      return this.askShell(prompt, timeout);
    }
    return this.askCli(prompt, timeout, opts?.pasteThreshold);
  }

  private async askShell(prompt: string, timeout: number): Promise<AgentResult> {
    const startTime = Date.now();
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

    let raw: string;
    if (sentinelIdx === -1 || cmdIdx === -1) {
      raw = lines
        .filter(l => !l.includes(sentinel) && !l.includes('__RD'))
        .join('\n');
    } else {
      raw = lines
        .slice(cmdIdx + 1, sentinelIdx)
        .filter(l => !l.includes('__RD'))
        .join('\n');
    }

    return this.buildResult(raw, startTime, 'completed', 'exact');
  }

  private async askCli(prompt: string, timeout: number, pasteThreshold?: number): Promise<AgentResult> {
    const startTime = Date.now();
    const beforeText = this.capturePane();

    this.sendKeysLiteral(prompt, pasteThreshold);
    await sleep(SEND_ENTER_DELAY);
    this.sendKeysRaw('C-m');

    const markerStr = markerToString(this.completionMarker);

    const promptSnippet = prompt.trim().slice(0, 20);

    // Strategy 1: rmux wait-pane --quiet (daemon-backed wait for output to stabilize after change)
    try {
      // First wait for content to change (agent starts processing)
      const changeDeadline = Date.now() + Math.min(timeout, 30_000);
      let changed = false;
      while (Date.now() < changeDeadline) {
        await sleep(500);
        const check = this.capturePane();
        if (check.length > beforeText.length + 20 && check !== beforeText) {
          changed = true;
          break;
        }
      }
      if (!changed) throw new Error('no new content');

      // Then wait for output to stabilize
      const remaining = Math.max(5, Math.floor((timeout - (Date.now() - startTime)) / 1000));
      rmuxExec(
        `wait-pane -t ${this.target} --quiet --stable-for 2s --timeout ${remaining}s`,
        { timeout: (remaining + 5) * 1000, throwOnError: true },
      );
      const current = this.capturePane();
      const raw = this.extractCliResponse(current, beforeText, prompt);
      return this.buildResult(raw, startTime, 'completed', 'exact');
    } catch {
      // wait-pane may not be available or timed out, try polling
    }

    // Strategy 2: Polling with marker + stability (proven reliable)
    const deadline = Date.now() + timeout;
    let stableCount = 0;
    let lastSnap = '';

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
            const raw = this.extractCliResponse(current, beforeText, prompt);
            return this.buildResult(raw, startTime, 'completed', 'observed');
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

    // Timeout: capture whatever is there and return degraded
    const current = this.capturePane();
    const raw = this.extractCliResponse(current, beforeText, prompt);
    return this.buildResult(raw, startTime, 'degraded', 'degraded');
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
      if (/Opus|Sonnet|Haiku.*\d+[kKmM]\s*[|│]/.test(t)) return false;
      if (/[░▒▓█]{3,}/.test(t)) return false;
      return true;
    });
    return resultLines.join('\n');
  }

  private classifyOutput(raw: string): OutputSegment[] {
    const lines = raw.split('\n');
    const segments: OutputSegment[] = [];
    let currentKind: OutputSegment['kind'] = 'intermediate';
    let currentLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      let kind: OutputSegment['kind'] = 'intermediate';

      if (/^[✻◉⏵].*(?:Thinking|Pondering|Reasoning)/i.test(trimmed)) {
        kind = 'thinking';
      } else if (/^[⏵▶].*(?:Tool|Read|Write|Edit|Bash|Grep|Glob)/i.test(trimmed)) {
        kind = 'tool_call';
      } else if (/^[✓].*(?:Tool|Read|Write|completed)/i.test(trimmed)) {
        kind = 'tool_result';
      } else if (trimmed && !matchesMarker(trimmed, this.completionMarker)) {
        const continuationKinds: OutputSegment['kind'][] = ['thinking', 'tool_call', 'tool_result'];
        kind = continuationKinds.includes(currentKind) ? currentKind : 'final';
      }

      if (kind !== currentKind && currentLines.length > 0) {
        segments.push({ kind: currentKind, content: currentLines.join('\n') });
        currentLines = [];
      }
      currentKind = kind;
      if (trimmed) currentLines.push(line);
    }
    if (currentLines.length > 0) {
      segments.push({ kind: currentKind, content: currentLines.join('\n') });
    }
    return segments;
  }

  private buildResult(
    raw: string,
    startTime: number,
    status: AgentResult['status'],
    confidence: AgentResult['confidence'],
  ): AgentResult {
    const segments = this.classifyOutput(raw);
    const finalSegments = segments.filter(s => s.kind === 'final');
    const output = finalSegments.map(s => s.content).join('\n');
    return {
      agent: this.name,
      status,
      confidence,
      output: output || raw,
      raw,
      segments,
      duration_ms: Date.now() - startTime,
    };
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
