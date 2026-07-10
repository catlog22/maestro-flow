// ---------------------------------------------------------------------------
// Skill Converter — shared conversion logic for building platform-specific
// skill/agent trees from .claude/ source files.
//
// Used by the install pipeline to generate .agy/ (Antigravity) and .agents/
// (Open Standard) mirrors from the canonical .claude/ source.
//
// Does NOT wipe target directories — the caller manages that.
// ---------------------------------------------------------------------------

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildStats {
  commands: number;
  skills: number;
  agents: number;
  files: number;
}

/** Body replacement pair: regex pattern + replacement string. */
type BodyReplacement = [RegExp, string];

/** Platform-specific conversion configuration. */
interface ConversionProfile {
  bodyReplacements: BodyReplacement[];
  frontmatterToolMap: Record<string, string>;
  /** Tools to drop from allowed-tools (no equivalent on this platform). */
  removedTools: Set<string>;
  /** Tools injected when Agent orchestration is detected. */
  subagentTools: string[];
  /** Whether to do AST-level Agent() call rewriting (agy) vs simple regex (standard). */
  rewriteAgentCalls: boolean;
  /** Whether to do AST-level Skill() call rewriting (agy) vs simple regex (standard). */
  rewriteSkillCalls: boolean;
  /** For unknown CamelCase tokens in frontmatter: pass-through (agy) or snake_case (standard). */
  snakeCaseUnknown: boolean;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Frontmatter parser — minimal YAML subset for skill frontmatter
// ---------------------------------------------------------------------------

/** Keys that MUST stay scalar even when their value contains commas. */
const SCALAR_KEYS = new Set(['name', 'description', 'argument-hint', 'model', 'section']);
/** Keys that should always be parsed as a list of tool tokens. */
const LIST_KEYS = new Set(['allowed-tools', 'agy-subagents']);

interface ParsedFrontmatter {
  [key: string]: string | string[];
}

interface SplitResult {
  frontmatter: ParsedFrontmatter | null;
  raw: string;
  body: string;
}

function splitFrontmatter(content: string): SplitResult {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: null, raw: '', body: content };
  }
  const end = content.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: null, raw: '', body: content };
  const raw = content.slice(content.startsWith('---\r\n') ? 5 : 4, end)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/^\n+/, '');
  const afterMarker = content.indexOf('\n', end + 4);
  const body = afterMarker >= 0 ? content.slice(afterMarker + 1) : '';
  return { frontmatter: parseSimpleYaml(raw), raw, body };
}

function parseSimpleYaml(raw: string): ParsedFrontmatter {
  const out: ParsedFrontmatter = {};
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const value = m[2];
    // YAML block list following the key
    if (value === '') {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(lines[j].replace(/^\s*-\s+/, '').trim());
        j++;
      }
      if (items.length) {
        out[key] = items;
        i = j;
        continue;
      }
      out[key] = '';
      i++;
      continue;
    }
    // Block scalar markers
    if (value === '|' || value === '>') {
      const block: string[] = [];
      let k = i + 1;
      while (k < lines.length && (lines[k].startsWith('  ') || lines[k] === '')) {
        block.push(lines[k].replace(/^  /, ''));
        k++;
      }
      out[key] = block.join('\n').trim();
      i = k;
      continue;
    }
    // Inline value — only split on commas for list-like keys
    if (LIST_KEYS.has(key) && value.includes(',')) {
      out[key] = value.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      out[key] = value.replace(/^["']|["']$/g, '');
    }
    i++;
  }
  return out;
}

function serializeFrontmatter(fm: ParsedFrontmatter): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${v}`);
    } else if (typeof value === 'string' && value.includes('\n')) {
      lines.push(`${key}: |`);
      for (const ln of value.split('\n')) lines.push(`  ${ln}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Agy-specific: Agent() / Skill() call-site rewriting
// ---------------------------------------------------------------------------

function detectAgentCalls(body: string): string[] {
  const calls: string[] = [];
  const re = /Agent\s*\(\s*(?:\{[^}]*\}|[^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const snippet = m[0];
    const subagentMatch = snippet.match(/subagent_type\s*[:=]\s*["']([^"']+)["']/);
    if (subagentMatch) calls.push(subagentMatch[1]);
  }
  return Array.from(new Set(calls));
}

function rewriteAgentCallSites(body: string): string {
  let out = body.replace(
    /Agent\s*\(\s*(\{[^}]*\}|subagent_type[\s\S]*?)\)/g,
    (_full, inner: string) => {
      const typeMatch = inner.match(/subagent_type\s*[:=]\s*["']([^"']+)["']/);
      const promptMatch = inner.match(/prompt\s*[:=]\s*["']([^"']*)["']/);
      const nameMatch = inner.match(/\bname\s*[:=]\s*["']([^"']+)["']/);
      const teamMatch = inner.match(/team_name\s*[:=]\s*["']([^"']+)["']/);

      const type = typeMatch ? typeMatch[1] : '<TypeName>';
      const role = nameMatch ? nameMatch[1] : (teamMatch ? teamMatch[1] : '<Role>');
      const prompt = promptMatch ? promptMatch[1] : '<Prompt>';

      return `invoke_subagent([{ TypeName: "${type}", Role: "${role}", Prompt: "${prompt}", Workspace: "inherit" }])`;
    },
  );
  // Catch-all: residual `Agent(` in prose / generator templates.
  out = out.replace(/\bAgent\s*\(/g, 'invoke_subagent(');
  return out;
}

function rewriteSkillCallSites(body: string): string {
  let out = body;
  // JS-object form: Skill({ skill: "X", args: "Y" })
  out = out.replace(
    /Skill\s*\(\s*\{\s*skill\s*:\s*["']([^"']+)["'](?:\s*,\s*args\s*:\s*["']([^"']*)["'])?\s*\}\s*\)/g,
    (_full, name: string, args: string | undefined) => formatInlineSkill(name, args),
  );
  // Function-style form: Skill(skill="X", args="Y")
  out = out.replace(
    /Skill\s*\(\s*skill\s*=\s*["']([^"']+)["'](?:\s*,\s*args\s*=\s*["']([^"']*)["'])?\s*\)/g,
    (_full, name: string, args: string | undefined) => formatInlineSkill(name, args),
  );
  return out;
}

function formatInlineSkill(name: string, args: string | undefined): string {
  const argLine = args ? ` (args: ${JSON.stringify(args)})` : '';
  return `view_file(AbsolutePath="<agy-skills-dir>/${name}/SKILL.md") + execute inline${argLine}`;
}

function buildSubAgentPreamble(typeNames: string[]): string {
  return (
    '\n## Sub-Agent Registration (Antigravity)\n\n' +
    'Before any `invoke_subagent` call below, register each sub-agent type once per session by reading the system_prompt from `<agy-agents-dir>/<name>.md` and passing it to `define_subagent`. The `<agy-agents-dir>` is:\n' +
    '- global install: `~/.gemini/antigravity-cli/agents/`\n' +
    '- workspace install: `<project>/.agents/agents/`\n\n' +
    typeNames
      .map(
        n =>
          `- \`define_subagent(name="${n}", description="<from agents/${n}.md frontmatter>", system_prompt=<contents of agents/${n}.md body>, enable_write_tools=true, enable_mcp_tools=true, enable_subagent_tools=false)\``,
      )
      .join('\n') +
    '\n\n**ConversationId tracking**: `invoke_subagent` returns a ConversationId per spawned instance. Subsequent `send_message(Recipient=<ConversationId>, Message=...)` calls require that ConversationId — never use the role name as the recipient.\n\n' +
    '---\n'
  );
}

// ---------------------------------------------------------------------------
// Frontmatter allowed-tools rewriting
// ---------------------------------------------------------------------------

function rewriteAllowedToolsAgy(
  tools: string | string[] | undefined,
  profile: ConversionProfile,
  hasAgent: boolean,
): { tools: string[]; hasAgent: boolean } | null {
  if (!tools) return null;
  const list = Array.isArray(tools)
    ? tools
    : String(tools).split(',').map(s => s.trim()).filter(Boolean);

  const out = new Set<string>();
  let agentDetected = hasAgent;

  for (const entry of list) {
    const name = entry.replace(/\(.*\)$/, '').trim();
    if (!name) continue;
    if (profile.removedTools.has(name)) continue;
    if (name === 'Agent') {
      agentDetected = true;
      for (const t of profile.subagentTools) out.add(t);
      continue;
    }
    const mapped = profile.frontmatterToolMap[name] ?? name;
    out.add(mapped);
  }

  return { tools: Array.from(out).sort(), hasAgent: agentDetected };
}

function rewriteAllowedToolsStandard(
  rawFm: string,
  profile: ConversionProfile,
): string {
  const lines = rawFm.split('\n');
  let i = 0;
  const out: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const inlineMatch = line.match(/^(allowed-tools\s*:\s*)(.*)$/);
    if (inlineMatch) {
      const prefix = inlineMatch[1];
      const value = inlineMatch[2].trim();
      if (value === '') {
        // Block form
        out.push(`${prefix.replace(/\s+$/, '')}`);
        i += 1;
        while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
          const itemMatch = lines[i].match(/^(\s+-\s+)(.+)$/);
          if (itemMatch) {
            const indent = itemMatch[1];
            const tok = itemMatch[2].trim();
            const mapped = mapToolTokenStandard(tok, profile);
            if (mapped !== null) out.push(`${indent}${mapped}`);
          }
          i += 1;
        }
        continue;
      }
      // Inline form
      const tokens = value.split(',').map(t => t.trim()).filter(Boolean);
      const mapped = tokens
        .map(t => mapToolTokenStandard(t, profile))
        .filter((t): t is string => t !== null);
      out.push(`${prefix}${mapped.join(', ')}`);
    } else {
      out.push(line);
    }
    i += 1;
  }

  return out.join('\n');
}

function mapToolTokenStandard(tok: string, profile: ConversionProfile): string | null {
  if (profile.frontmatterToolMap[tok]) return profile.frontmatterToolMap[tok];
  if (tok.startsWith('mcp__')) return tok; // pass-through MCP
  if (/^[a-z][a-z0-9_]*$/.test(tok)) return tok; // already standard
  // Unknown CamelCase → conservative snake_case
  if (profile.snakeCaseUnknown) {
    return tok.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  }
  return tok;
}

// ---------------------------------------------------------------------------
// Content conversion — shared pipeline
// ---------------------------------------------------------------------------

function convertTextAgy(
  content: string,
  profile: ConversionProfile,
  isSkillOrCommand: boolean,
): string {
  const { frontmatter, body } = splitFrontmatter(content);

  let hasAgent = false;
  let subAgentTypes: string[] = [];
  if (isSkillOrCommand) {
    subAgentTypes = detectAgentCalls(body);
    if (subAgentTypes.length > 0) hasAgent = true;
  }

  let convertedBody = rewriteAgentCallSites(body);
  convertedBody = rewriteSkillCallSites(convertedBody);
  convertedBody = applyBodyReplacements(convertedBody, profile);

  let newFrontmatter: ParsedFrontmatter | null = null;
  if (frontmatter) {
    const fmOut = { ...frontmatter };
    if (fmOut['allowed-tools']) {
      const r = rewriteAllowedToolsAgy(fmOut['allowed-tools'], profile, hasAgent);
      if (r) {
        if (r.hasAgent || hasAgent) {
          for (const t of profile.subagentTools) {
            if (!r.tools.includes(t)) r.tools.push(t);
          }
          r.tools.sort();
        }
        fmOut['allowed-tools'] = r.tools;
      }
    }
    if (subAgentTypes.length > 0) {
      fmOut['agy-subagents'] = subAgentTypes;
    }
    newFrontmatter = fmOut;
  }

  const fmBlock = newFrontmatter ? serializeFrontmatter(newFrontmatter) : '';
  const preamble = subAgentTypes.length > 0 ? buildSubAgentPreamble(subAgentTypes) : '';
  return fmBlock + preamble + convertedBody;
}

function convertTextStandard(
  content: string,
  profile: ConversionProfile,
): string {
  const { frontmatter, raw, body } = splitFrontmatter(content);
  if (frontmatter === null) {
    return applyBodyReplacements(content, profile);
  }
  const newFm = rewriteAllowedToolsStandard(raw, profile);
  const newBody = applyBodyReplacements(body, profile);
  return `---\n${newFm}\n---\n${newBody}`;
}

function applyBodyReplacements(body: string, profile: ConversionProfile): string {
  let out = body;
  for (const [pattern, replacement] of profile.bodyReplacements) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tree builders — shared directory-walking pipeline
// ---------------------------------------------------------------------------

function buildTree(
  claudeDir: string,
  targetSkillsDir: string,
  targetAgentsDir: string,
  profile: ConversionProfile,
  convertFn: (content: string, profile: ConversionProfile, isSkillOrCommand: boolean) => string,
): BuildStats {
  const commandsDir = join(claudeDir, 'commands');
  const skillsDir = join(claudeDir, 'skills');
  const agentsDir = join(claudeDir, 'agents');

  const stats: BuildStats = { commands: 0, skills: 0, agents: 0, files: 0 };

  // 1. commands/*.md → targetSkillsDir/<name>/SKILL.md
  if (existsSync(commandsDir)) {
    for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const name = entry.name.replace(/\.md$/, '');
      const src = join(commandsDir, entry.name);
      const destDir = join(targetSkillsDir, name);
      const dest = join(destDir, 'SKILL.md');
      ensureDir(destDir);
      const out = convertFn(readFileSync(src, 'utf8'), profile, true);
      writeFileSync(dest, out, 'utf8');
      stats.commands++;
      stats.files++;
    }
  }

  // 2. skills/<name>/ → targetSkillsDir/<name>/ (recursive)
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const srcRoot = join(skillsDir, entry.name);
      const destRoot = join(targetSkillsDir, entry.name);
      for (const fp of walkFiles(srcRoot)) {
        const rel = relative(srcRoot, fp);
        const dest = join(destRoot, rel);
        ensureDir(dirname(dest));
        if (fp.endsWith('.md')) {
          const out = convertFn(readFileSync(fp, 'utf8'), profile, true);
          writeFileSync(dest, out, 'utf8');
        } else {
          writeFileSync(dest, readFileSync(fp));
        }
        stats.files++;
      }
      stats.skills++;
    }
  }

  // 3. agents/*.md → targetAgentsDir/<name>.md
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const src = join(agentsDir, entry.name);
      const dest = join(targetAgentsDir, entry.name);
      ensureDir(dirname(dest));
      const out = convertFn(readFileSync(src, 'utf8'), profile, false);
      writeFileSync(dest, out, 'utf8');
      stats.agents++;
      stats.files++;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Agy profile
// ---------------------------------------------------------------------------

const AGY_PROFILE: ConversionProfile = {
  bodyReplacements: [
    [/ralph skills --platform claude\b/g, 'ralph skills --platform agy'],
    [/\bmcp__exa__web_search_exa\b/g, 'search_web'],
    [/\bSendMessage\b/g, 'send_message'],
    [/\bAskUserQuestion\b/g, 'ask_question'],
    [/\bRead\s*\(/g, 'view_file('],
    [/\bWrite\s*\(/g, 'write_to_file('],
    [/\bEdit\s*\(/g, 'replace_file_content('],
    [/\bBash\s*\(/g, 'run_command('],
    [/\bGrep\s*\(/g, 'grep_search('],
    [/\bGlob\s*\(/g, 'grep_search('],
  ],
  frontmatterToolMap: {
    SendMessage: 'send_message',
    AskUserQuestion: 'ask_question',
    Read: 'view_file',
    Write: 'write_to_file',
    Edit: 'replace_file_content',
    Bash: 'run_command',
    Grep: 'grep_search',
    Glob: 'grep_search',
    mcp__exa__web_search_exa: 'search_web',
  },
  removedTools: new Set([
    'TeamCreate', 'TeamDelete',
    'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
    'TodoWrite',
    'Skill',
    'mcp__ccw-tools__team_msg',
  ]),
  subagentTools: ['define_subagent', 'invoke_subagent', 'send_message', 'manage_subagents'],
  rewriteAgentCalls: true,
  rewriteSkillCalls: true,
  snakeCaseUnknown: false,
};

// ---------------------------------------------------------------------------
// Agents Standard profile
// ---------------------------------------------------------------------------

const AGENTS_STANDARD_PROFILE: ConversionProfile = {
  bodyReplacements: [
    [/ralph skills --platform claude\b/g, 'ralph skills --platform agent'],
    [/\bAskUserQuestion\b/g, 'ask_user'],
    [/\bSendMessage\b/g, 'send_message'],
    [/\bExitPlanMode\b/g, 'exit_plan_mode'],
    [/\bExitWorktree\b/g, 'exit_worktree'],
    [/\bEnterPlanMode\b/g, 'enter_plan_mode'],
    [/\bEnterWorktree\b/g, 'enter_worktree'],
    [/\bTodoWrite\b/g, 'track_tasks'],
    [/\bTaskCreate\b/g, 'create_task'],
    [/\bTaskUpdate\b/g, 'update_task'],
    [/\bTaskList\b/g, 'list_tasks'],
    [/\bTaskGet\b/g, 'get_task'],
    [/\bTaskStop\b/g, 'stop_task'],
    [/\bTaskOutput\b/g, 'get_task_output'],
    [/\bWebSearch\b/g, 'web_search'],
    [/\bWebFetch\b/g, 'web_fetch'],
    [/\bNotebookEdit\b/g, 'edit_notebook'],
    [/\bMonitor\b/g, 'monitor_process'],
    [/\bPushNotification\b/g, 'push_notification'],
    [/\bRemoteTrigger\b/g, 'remote_trigger'],
    [/\bScheduleWakeup\b/g, 'schedule_wakeup'],
    [/\bCronCreate\b/g, 'cron_create'],
    [/\bCronDelete\b/g, 'cron_delete'],
    [/\bCronList\b/g, 'cron_list'],
    [/\bToolSearch\b/g, 'tool_search'],
    [/\bShareOnboardingGuide\b/g, 'share_onboarding_guide'],
    [/\bTeamCreate\b/g, 'create_team'],
    [/\bTeamDelete\b/g, 'delete_team'],
    [/\bLSP\b/g, 'lsp'],
    [/\bListMcpResourcesTool\b/g, 'list_mcp_resources'],
    [/\bReadMcpResourceTool\b/g, 'read_mcp_resource'],
    [/\bRead\s*\(/g, 'read_file('],
    [/\bWrite\s*\(/g, 'write_file('],
    [/\bEdit\s*\(/g, 'edit_file('],
    [/\bBash\s*\(/g, 'shell('],
    [/\bGrep\s*\(/g, 'search('],
    [/\bGlob\s*\(/g, 'find_files('],
    [/\bAgent\s*\(/g, 'delegate_subagent('],
    [/\bSkill\s*\(/g, 'invoke_skill('],
    [/\bPowerShell\s*\(/g, 'shell('],
  ],
  frontmatterToolMap: {
    AskUserQuestion: 'ask_user',
    SendMessage: 'send_message',
    ExitPlanMode: 'exit_plan_mode',
    ExitWorktree: 'exit_worktree',
    EnterPlanMode: 'enter_plan_mode',
    EnterWorktree: 'enter_worktree',
    TodoWrite: 'track_tasks',
    TaskCreate: 'create_task',
    TaskUpdate: 'update_task',
    TaskList: 'list_tasks',
    TaskGet: 'get_task',
    WebSearch: 'web_search',
    WebFetch: 'web_fetch',
    NotebookEdit: 'edit_notebook',
    Monitor: 'monitor_process',
    PushNotification: 'push_notification',
    RemoteTrigger: 'remote_trigger',
    ScheduleWakeup: 'schedule_wakeup',
    CronCreate: 'cron_create',
    CronDelete: 'cron_delete',
    CronList: 'cron_list',
    ToolSearch: 'tool_search',
    TeamCreate: 'create_team',
    TeamDelete: 'delete_team',
    Read: 'read_file',
    Write: 'write_file',
    Edit: 'edit_file',
    Bash: 'shell',
    PowerShell: 'shell',
    Grep: 'search',
    Glob: 'find_files',
    Agent: 'delegate_subagent',
    Skill: 'invoke_skill',
  },
  removedTools: new Set(),
  subagentTools: [],
  rewriteAgentCalls: false,
  rewriteSkillCalls: false,
  snakeCaseUnknown: true,
};

// ---------------------------------------------------------------------------
// Partial tree builders — skills-only and agents-only
// ---------------------------------------------------------------------------

function buildSkillsOnly(
  claudeDir: string,
  targetSkillsDir: string,
  profile: ConversionProfile,
  convertFn: (content: string, profile: ConversionProfile, isSkillOrCommand: boolean) => string,
): BuildStats {
  const commandsDir = join(claudeDir, 'commands');
  const skillsDir = join(claudeDir, 'skills');
  const stats: BuildStats = { commands: 0, skills: 0, agents: 0, files: 0 };

  // commands/*.md → targetSkillsDir/<name>/SKILL.md
  if (existsSync(commandsDir)) {
    for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const name = entry.name.replace(/\.md$/, '');
      const src = join(commandsDir, entry.name);
      const destDir = join(targetSkillsDir, name);
      const dest = join(destDir, 'SKILL.md');
      ensureDir(destDir);
      const out = convertFn(readFileSync(src, 'utf8'), profile, true);
      writeFileSync(dest, out, 'utf8');
      stats.commands++;
      stats.files++;
    }
  }

  // skills/<name>/ → targetSkillsDir/<name>/ (recursive)
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const srcRoot = join(skillsDir, entry.name);
      const destRoot = join(targetSkillsDir, entry.name);
      for (const fp of walkFiles(srcRoot)) {
        const rel = relative(srcRoot, fp);
        const dest = join(destRoot, rel);
        ensureDir(dirname(dest));
        if (fp.endsWith('.md')) {
          const out = convertFn(readFileSync(fp, 'utf8'), profile, true);
          writeFileSync(dest, out, 'utf8');
        } else {
          writeFileSync(dest, readFileSync(fp));
        }
        stats.files++;
      }
      stats.skills++;
    }
  }

  return stats;
}

function buildAgentsOnly(
  claudeDir: string,
  targetAgentsDir: string,
  profile: ConversionProfile,
  convertFn: (content: string, profile: ConversionProfile, isSkillOrCommand: boolean) => string,
): BuildStats {
  const agentsDir = join(claudeDir, 'agents');
  const stats: BuildStats = { commands: 0, skills: 0, agents: 0, files: 0 };

  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const src = join(agentsDir, entry.name);
      const dest = join(targetAgentsDir, entry.name);
      ensureDir(dirname(dest));
      const out = convertFn(readFileSync(src, 'utf8'), profile, false);
      writeFileSync(dest, out, 'utf8');
      stats.agents++;
      stats.files++;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildAgyTree(
  claudeDir: string,
  targetSkillsDir: string,
  targetAgentsDir: string,
): BuildStats {
  return buildTree(claudeDir, targetSkillsDir, targetAgentsDir, AGY_PROFILE, convertTextAgy);
}

export function buildAgentsStandardTree(
  claudeDir: string,
  targetSkillsDir: string,
  targetAgentsDir: string,
): BuildStats {
  return buildTree(
    claudeDir,
    targetSkillsDir,
    targetAgentsDir,
    AGENTS_STANDARD_PROFILE,
    convertTextStandard,
  );
}

// ---------------------------------------------------------------------------
// Per-component build functions — called from ComponentDef.build callbacks.
// Each builds only the skills or agents portion for its component.
// ---------------------------------------------------------------------------

/** Build agy skills (commands + skills) only — no agents. */
export function buildAgySkills(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildSkillsOnly(claudeDir, targetDir, AGY_PROFILE, convertTextAgy);
  return { files: stats.files };
}

/** Build agy agents only — no skills/commands. */
export function buildAgyAgents(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildAgentsOnly(claudeDir, targetDir, AGY_PROFILE, convertTextAgy);
  return { files: stats.files };
}

/** Build agents-standard skills (commands + skills) only — no agents. */
export function buildAgentsStandardSkills(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildSkillsOnly(claudeDir, targetDir, AGENTS_STANDARD_PROFILE, convertTextStandard);
  return { files: stats.files };
}

/** Build agents-standard agents only — no skills/commands. */
export function buildAgentsStandardAgents(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildAgentsOnly(claudeDir, targetDir, AGENTS_STANDARD_PROFILE, convertTextStandard);
  return { files: stats.files };
}

// ---------------------------------------------------------------------------
// Eve-specific conversion and building logic
// ---------------------------------------------------------------------------

function convertTextEve(content: string): string {
  const { frontmatter, body } = splitFrontmatter(content);
  if (!frontmatter) {
    return body.replace(/^\r?\n/u, '');
  }
  const eveData: Record<string, any> = {};
  if (typeof frontmatter.description === 'string') {
    eveData.description = frontmatter.description;
  }
  if (typeof frontmatter.license === 'string') {
    eveData.license = frontmatter.license;
  }
  if (frontmatter.metadata && typeof frontmatter.metadata === 'object' && !Array.isArray(frontmatter.metadata)) {
    const metadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(frontmatter.metadata)) {
      if (typeof v === 'string') {
        metadata[k] = v;
      }
    }
    if (Object.keys(metadata).length > 0) {
      eveData.metadata = metadata;
    }
  }

  const keys = Object.keys(eveData);
  if (keys.length === 0) {
    return body.replace(/^\r?\n/u, '');
  }

  const lines: string[] = ['---'];
  for (const key of keys) {
    const val = eveData[key];
    if (typeof val === 'object') {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(val)) {
        lines.push(`  ${k}: ${JSON.stringify(v)}`);
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(val)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n') + body.replace(/^\r?\n/u, '');
}

function buildEveSkillsOnly(
  claudeDir: string,
  targetSkillsDir: string,
): BuildStats {
  const commandsDir = join(claudeDir, 'commands');
  const skillsDir = join(claudeDir, 'skills');
  const stats: BuildStats = { commands: 0, skills: 0, agents: 0, files: 0 };

  // 1. commands/*.md → targetSkillsDir/<name>/<name>.md
  if (existsSync(commandsDir)) {
    for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const name = entry.name.replace(/\.md$/, '');
      const src = join(commandsDir, entry.name);
      const destDir = join(targetSkillsDir, name);
      const dest = join(destDir, `${name}.md`);
      ensureDir(destDir);
      const out = convertTextEve(readFileSync(src, 'utf8'));
      writeFileSync(dest, out, 'utf8');
      stats.commands++;
      stats.files++;
    }
  }

  // 2. skills/<name>/ → targetSkillsDir/<name>/ (recursive)
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const srcRoot = join(skillsDir, entry.name);
      const destRoot = join(targetSkillsDir, entry.name);
      for (const fp of walkFiles(srcRoot)) {
        const rel = relative(srcRoot, fp);
        const fileBase = basename(fp).toLowerCase();
        let dest = join(destRoot, rel);
        if (fileBase === 'skill.md') {
          dest = join(dirname(dest), `${entry.name}.md`);
        }
        ensureDir(dirname(dest));
        if (fp.endsWith('.md')) {
          const out = convertTextEve(readFileSync(fp, 'utf8'));
          writeFileSync(dest, out, 'utf8');
        } else {
          writeFileSync(dest, readFileSync(fp));
        }
        stats.files++;
      }
      stats.skills++;
    }
  }

  return stats;
}

/** Build Eve skills (commands + skills) with frontmatter stripping & flat file naming. */
export function buildEveSkills(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildEveSkillsOnly(claudeDir, targetDir);
  return { files: stats.files };
}

/** Build Eve agents using standard/neutral converter. */
export function buildEveAgents(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildAgentsOnly(claudeDir, targetDir, AGENTS_STANDARD_PROFILE, convertTextStandard);
  return { files: stats.files };
}
