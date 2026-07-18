import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface SectionOverrideSpec {
  id: string;
  startHeading: string;
  endHeading: string;
}

interface AgentOverrideSpec {
  file: string;
  sections: SectionOverrideSpec[];
}

const AGENT_OVERRIDE_SPECS: Record<string, AgentOverrideSpec> = {
  'team-worker': {
    file: 'team-worker.md',
    sections: [
      { id: 'assignment-lifecycle', startHeading: '### 3. Task Discovery', endHeading: '### 4. Load Upstream Context' },
      { id: 'report-and-advance', startHeading: '### 7. Report and Advance', endHeading: '## Input' },
      { id: 'input', startHeading: '## Input', endHeading: '## Output' },
      { id: 'output', startHeading: '## Output', endHeading: '## Constraints' },
    ],
  },
  'team-supervisor': {
    file: 'team-supervisor.md',
    sections: [
      { id: 'wake-cycle', startHeading: '### 3. Wake Cycle', endHeading: '### 4. Crash Recovery' },
      { id: 'crash-recovery', startHeading: '### 4. Crash Recovery', endHeading: '### 5. Shutdown' },
    ],
  },
};

const OVERRIDE_BLOCK = /<!-- codex-agent-override:start section="([^"]+)" -->\s*([\s\S]*?)\s*<!-- codex-agent-override:end section="\1" -->/g;
const UNSUPPORTED_TASK_BOARD_TOKEN = /\b(?:TaskList|TaskGet|TaskUpdate)\b/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseOverrideBlocks(content: string, file: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const match of content.matchAll(OVERRIDE_BLOCK)) {
    const [, id, body] = match;
    if (blocks.has(id)) throw new Error(`Duplicate Codex agent override section "${id}" in ${file}`);
    blocks.set(id, body.trim());
  }
  return blocks;
}

function replaceHeadingSection(
  body: string,
  section: SectionOverrideSpec,
  replacement: string,
  agentName: string,
): string {
  const pattern = new RegExp(
    `^${escapeRegExp(section.startHeading)}\\r?\\n[\\s\\S]*?(?=^${escapeRegExp(section.endHeading)}\\r?$)`,
    'm',
  );
  if (!pattern.test(body)) {
    throw new Error(
      `Codex agent override ${agentName}:${section.id} cannot find source section ` +
      `${section.startHeading} -> ${section.endHeading}`,
    );
  }
  return body.replace(pattern, `${replacement.trimEnd()}\n\n`);
}

/** Apply explicit semantic overrides before generic Codex tool-name conversion. */
export function applyCodexAgentOverrides(
  agentName: string,
  body: string,
  overrideDir: string,
): string {
  const spec = AGENT_OVERRIDE_SPECS[agentName];
  if (!spec) return body;

  const overridePath = join(overrideDir, spec.file);
  if (!existsSync(overridePath)) {
    throw new Error(`Missing required Codex agent override: ${overridePath}`);
  }
  const blocks = parseOverrideBlocks(readFileSync(overridePath, 'utf8'), overridePath);
  let result = body;
  for (const section of spec.sections) {
    const replacement = blocks.get(section.id);
    if (!replacement) {
      throw new Error(`Missing Codex agent override section "${section.id}" in ${overridePath}`);
    }
    result = replaceHeadingSection(result, section, replacement, agentName);
  }
  return result;
}

/** Codex collaboration tools are not a Claude-style shared task board. */
export function assertNoUnsupportedCodexTaskBoardTokens(agentName: string, body: string): void {
  const match = body.match(UNSUPPORTED_TASK_BOARD_TOKEN);
  if (!match) return;
  throw new Error(
    `Codex agent "${agentName}" still contains unsupported ${match[0]} semantics; ` +
    'add an explicit section override instead of applying a tool-name substitution.',
  );
}

export interface CodexAgentLintIssue {
  rule: string;
  message: string;
}

/** Lightweight TOML/content lint for generated Codex agent definitions. */
export function lintCodexAgentToml(fileName: string, content: string): CodexAgentLintIssue[] {
  const issues: CodexAgentLintIssue[] = [];
  const add = (rule: string, message: string): void => { issues.push({ rule, message: `${fileName}: ${message}` }); };

  if (!/^name\s*=\s*"[^"]+"\s*$/m.test(content)) add('toml-name', 'missing string name');
  if (!/^description\s*=\s*"[^"]*"\s*$/m.test(content)) add('toml-description', 'missing string description');
  if (!/^sandbox_mode\s*=\s*"(?:read-only|workspace-write)"\s*$/m.test(content)) {
    add('toml-sandbox', 'sandbox_mode must be read-only or workspace-write');
  }
  if (!/^developer_instructions\s*=\s*"""\s*$/m.test(content) || !/"""\s*$/.test(content)) {
    add('toml-instructions', 'developer_instructions must be a closed multiline string');
  }
  if (UNSUPPORTED_TASK_BOARD_TOKEN.test(content)) {
    add('unsupported-task-board', 'contains unsupported Claude task-board tokens');
  }
  if (/update_goal\s*\(\s*\{[\s\S]{0,240}?\b(?:taskId|task_id)\s*:/m.test(content) ||
      /update_goal\s*\(\s*\{[\s\S]{0,240}?status\s*:\s*["'](?:in_progress|completed|pending)["']/m.test(content)) {
    add('goal-task-payload', 'uses update_goal as task state');
  }
  for (const match of content.matchAll(/update_plan\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    if (!/\bplan\s*:/.test(match[1])) add('plan-without-array', 'update_plan call does not submit a plan array');
  }
  if (/wait_agent\s*\(\s*(?!\{)/m.test(content)) {
    add('positional-wait', 'wait_agent must receive an object with timeout_ms');
  }
  if (/list_agents[^\n]{0,160}(?:pending tasks?|blockedBy)|(?:pending tasks?|blockedBy)[^\n]{0,160}list_agents/i.test(content) ||
      /call\s+`?list_agents\(\)`?\s+to get all tasks|task list accessible via[^\n]*list_agents/i.test(content)) {
    add('list-agents-task-board', 'describes list_agents as a pending task/dependency board');
  }
  return issues;
}
