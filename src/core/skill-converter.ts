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
// Cross-platform tool field mapping — queryable at build and runtime.
// Used by rewrite functions and exposed for documentation/tooling.
// ---------------------------------------------------------------------------

/** Maps a Claude tool's parameter name to its platform equivalent. */
interface FieldMapping {
  /** Platform tool name (e.g. 'spawn_agent'). */
  tool: string;
  /** Claude param → platform param. null = dropped, string = renamed. */
  fields: Record<string, string | null>;
  /** Value transforms: 'lowercase_underscore' normalizes name to task_name. */
  transforms?: Record<string, 'lowercase_underscore' | 'identity'>;
  /** Extra params injected on the platform side. */
  inject?: Record<string, string>;
}

export const TOOL_FIELD_MAP: Record<string, Record<string, FieldMapping>> = {
  Agent: {
    codex: {
      tool: 'spawn_agent',
      fields: {
        name: 'task_name',
        prompt: 'message',
        description: 'message',
        subagent_type: 'agent_type',
        model: 'model',
        run_in_background: null,
        isolation: null,
        mode: null,
      },
      transforms: { task_name: 'lowercase_underscore' },
    },
    agy: {
      tool: 'invoke_subagent',
      fields: {
        name: 'Role',
        prompt: 'Prompt',
        subagent_type: 'TypeName',
        description: 'Prompt',
        run_in_background: null,
      },
    },
  },
  AskUserQuestion: {
    codex: {
      tool: 'request_user_input',
      fields: { questions: 'questions', annotations: 'annotations' },
    },
    agy: {
      tool: 'ask_question',
      fields: { questions: 'questions' },
    },
  },
  SendMessage: {
    codex: {
      tool: 'send_message',
      fields: { to: 'target', message: 'message' },
    },
    agy: {
      tool: 'send_message',
      fields: { to: 'Recipient', message: 'Message' },
    },
  },
  Skill: {
    codex: {
      tool: 'spawn_agent',
      fields: { skill: 'task_name', args: 'message' },
      transforms: { task_name: 'lowercase_underscore' },
    },
    agy: {
      tool: 'view_file',
      fields: { skill: 'AbsolutePath', args: null },
    },
  },
  TaskCreate: {
    codex: {
      tool: 'create_goal',
      fields: { description: 'objective', subject: 'criteria' },
    },
  },
  TaskUpdate: {
    codex: {
      tool: 'update_goal',
      fields: { taskId: 'goal_id', status: 'status' },
    },
  },
  spawn_agents_on_csv: {
    codex: {
      tool: 'spawn_agents_on_csv',
      fields: {
        csv_path: 'csv_path',
        instruction: 'instruction',
        id_column: 'id_column',
        max_concurrency: 'max_concurrency',
        output_csv_path: 'output_csv_path',
        output_schema: 'output_schema',
      },
      inject: { max_runtime_seconds: '3600' },
    },
  },
  wait_agent: {
    codex: {
      tool: 'wait_agent',
      fields: { timeout_ms: 'timeout_ms' },
      inject: { timeout_ms: '3600000' },
    },
  },
};

// ---------------------------------------------------------------------------
// Codex-specific: Agent() → spawn_agent(), Skill() → inline execution
// ---------------------------------------------------------------------------

function toSnakeCase(s: string): string {
  return s.replace(/[-\s]+/g, '_').toLowerCase();
}

function rewriteAgentCallSitesCodex(body: string): string {
  const fm = TOOL_FIELD_MAP.Agent.codex;
  let out = body.replace(
    /Agent\s*\(\s*(\{[^}]*\})\s*\)/g,
    (_full, inner: string) => {
      const nameMatch = inner.match(/\bname\s*[:=]\s*["']([^"']+)["']/);
      const promptMatch = inner.match(/prompt\s*[:=]\s*["']([^"']*)["']/);
      const descMatch = inner.match(/description\s*[:=]\s*["']([^"']*)["']/);
      const forkMatch = inner.match(/\brun_in_background\s*[:=]\s*(true|false)/);
      const typeMatch = inner.match(/\bsubagent_type\s*[:=]\s*["']([^"']+)["']/);
      const modelMatch = inner.match(/\bmodel\s*[:=]\s*["']([^"']+)["']/);

      const rawName = nameMatch?.[1] ?? '<task_name>';
      const taskName = fm.transforms?.task_name === 'lowercase_underscore'
        ? toSnakeCase(rawName)
        : rawName;
      const message = promptMatch?.[1] ?? descMatch?.[1] ?? '<message>';

      const extras: string[] = [];
      if (forkMatch?.[1] === 'true') extras.push('fork_turns: "none"');
      if (typeMatch) extras.push(`agent_type: "${toSnakeCase(typeMatch[1])}"`);
      if (modelMatch) extras.push(`model: "${modelMatch[1]}"`);
      const extraStr = extras.length > 0 ? ', ' + extras.join(', ') : '';

      return `${fm.tool}({ task_name: "${taskName}", message: "${message}"${extraStr} })`;
    },
  );
  out = out.replace(/\bAgent\s*\(/g, `${fm.tool}(`);
  return out;
}

function rewriteSkillCallSitesCodex(body: string): string {
  let out = body;
  // JS-object form: Skill({ skill: "X", args: "Y" })
  out = out.replace(
    /Skill\s*\(\s*\{\s*skill\s*:\s*["']([^"']+)["'](?:\s*,\s*args\s*:\s*["']([^"']*)["'])?\s*\}\s*\)/g,
    (_full, name: string, args: string | undefined) => formatCodexSkill(name, args),
  );
  // Function-style form: Skill(skill="X", args="Y")
  out = out.replace(
    /Skill\s*\(\s*skill\s*=\s*["']([^"']+)["'](?:\s*,\s*args\s*=\s*["']([^"']*)["'])?\s*\)/g,
    (_full, name: string, args: string | undefined) => formatCodexSkill(name, args),
  );
  // Shorthand: Skill("X")
  out = out.replace(
    /Skill\s*\(\s*["']([^"']+)["']\s*\)/g,
    (_full, name: string) => formatCodexSkill(name, undefined),
  );
  return out;
}

function formatCodexSkill(name: string, args: string | undefined): string {
  const fm = TOOL_FIELD_MAP.Skill.codex;
  const taskName = fm.transforms?.task_name === 'lowercase_underscore'
    ? toSnakeCase(name)
    : name;
  const argLine = args ? `, args: "${args}"` : '';
  return `${fm.tool}({ ${fm.fields.skill}: "${taskName}", ${fm.fields.args}: "Execute skill ${name}${argLine}" })`;
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
  return fmBlock + preamble + stripToolTags(convertedBody);
}

function convertTextStandard(
  content: string,
  profile: ConversionProfile,
): string {
  const { frontmatter, raw, body } = splitFrontmatter(content);
  if (frontmatter === null) {
    return stripToolTags(applyBodyReplacements(content, profile));
  }
  const newFm = rewriteAllowedToolsStandard(raw, profile);
  const newBody = stripToolTags(applyBodyReplacements(body, profile));
  return `---\n${newFm}\n---\n${newBody}`;
}

function convertTextCodex(
  content: string,
  profile: ConversionProfile,
  isSkillOrCommand: boolean,
): string {
  const { frontmatter, body } = splitFrontmatter(content);

  let hasAgent = false;
  if (isSkillOrCommand) {
    const agentRefs = detectAgentCalls(body);
    if (agentRefs.length > 0 || /\bAgent\s*\(/.test(body)) hasAgent = true;
  }

  let convertedBody = rewriteAgentCallSitesCodex(body);
  convertedBody = rewriteSkillCallSitesCodex(convertedBody);
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
    newFrontmatter = fmOut;
  }

  const fmBlock = newFrontmatter ? serializeFrontmatter(newFrontmatter) : '';
  const agentNote = hasAgent
    ? '\n> **Agent timeout**: `spawn_agent` 无内置超时。等待结果时使用 `wait_agent({ timeout_ms: 3600000 })`（最大值 1 小时）。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。\n'
    : '';
  return fmBlock + agentNote + stripToolTags(convertedBody);
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
// Codex profile — subagent model (spawn_agent / spawn_agents_on_csv)
//
// Tool substitution tags for command files:
//   <!-- @subagent -->       Agent()        → spawn_agent()
//   <!-- @subagent:batch -->  multi Agent()  → spawn_agents_on_csv()
//   <!-- @ask -->             AskUserQuestion → request_user_input
//   <!-- @task -->            TaskCreate/Update → create_goal/update_goal
//   <!-- @msg -->             SendMessage    → send_message / followup_task
//   <!-- @skill -->           Skill()        → inline execution
// Tags are semantic anchors — placed before tool calls in .claude/ source
// files so the converter can locate substitution points reliably.
// ---------------------------------------------------------------------------

const CODEX_PROFILE: ConversionProfile = {
  bodyReplacements: [
    [/ralph skills --platform claude\b/g, 'ralph skills --platform codex'],
    [/\bAskUserQuestion\b/g, 'request_user_input'],
    [/\bSendMessage\s*\(\s*\{\s*to:/g, 'followup_task({ target:'],
    [/\bSendMessage\b/g, 'send_message'],
    [/\bTaskCreate\b/g, 'create_goal'],
    [/\bTaskUpdate\b/g, 'update_goal'],
    [/\bTaskList\s*\(\s*\)/g, 'list_agents()'],
    [/\bTaskList\b/g, 'list_agents'],
    [/\bTaskGet\b/g, 'wait_agent'],
    [/\bTaskStop\b/g, 'interrupt_agent'],
    [/\bTodoWrite\b/g, 'update_plan'],
    // Enforce max_runtime_seconds: 3600 on spawn_agents_on_csv calls
    [/spawn_agents_on_csv\s*\(\s*\{(?![\s\S]*max_runtime_seconds)/g, 'spawn_agents_on_csv({ max_runtime_seconds: 3600,'],
    // Enforce timeout_ms: 3600000 (max) on wait_agent calls
    [/wait_agent\s*\(\s*\{(?![\s\S]*timeout_ms)/g, 'wait_agent({ timeout_ms: 3600000,'],
    [/wait_agent\s*\(\s*\)/g, 'wait_agent({ timeout_ms: 3600000 })'],
  ],
  frontmatterToolMap: {
    AskUserQuestion: 'request_user_input',
    SendMessage: 'send_message',
    Agent: 'spawn_agent',
    TaskCreate: 'create_goal',
    TaskUpdate: 'update_goal',
    TaskList: 'list_agents',
    TaskGet: 'wait_agent',
    TaskStop: 'interrupt_agent',
    TodoWrite: 'update_plan',
    Skill: 'spawn_agent',
  },
  removedTools: new Set([
    'TeamCreate', 'TeamDelete',
    'mcp__ccw-tools__team_msg',
    'ExitPlanMode', 'EnterPlanMode',
    'ExitWorktree', 'EnterWorktree',
    'NotebookEdit', 'Monitor',
    'PushNotification', 'RemoteTrigger',
    'ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList',
    'ToolSearch', 'LSP',
  ]),
  subagentTools: [
    'spawn_agent', 'send_message', 'followup_task',
    'wait_agent', 'interrupt_agent', 'list_agents',
    'spawn_agents_on_csv',
  ],
  rewriteAgentCalls: true,
  rewriteSkillCalls: true,
  snakeCaseUnknown: false,
};

// ---------------------------------------------------------------------------
// Pi profile — teammate subagent model (pi-maestro-flow)
//
// Pi tools: same file ops as Claude + teammate() for subagent + maestro() for CLI
// Install: https://github.com/catlog22/pi-maestro-flow
// ---------------------------------------------------------------------------

const PI_PROFILE: ConversionProfile = {
  bodyReplacements: [
    [/ralph skills --platform claude\b/g, 'ralph skills --platform pi'],
    [/\bTaskCreate\b/g, 'todo({ action: "create" })'],
    [/\bTaskUpdate\b/g, 'todo({ action: "update" })'],
    [/\bTaskList\s*\(\s*\)/g, 'todo({ action: "list" })'],
    [/\bTaskList\b/g, 'todo({ action: "list" })'],
    [/\bTaskGet\b/g, 'todo({ action: "get" })'],
    [/\bTaskStop\b/g, 'todo({ action: "cancel" })'],
    [/\bTodoWrite\b/g, 'todo({ action: "update" })'],
  ],
  frontmatterToolMap: {
    Agent: 'teammate',
    Workflow: 'maestro',
    TaskCreate: 'todo',
    TaskUpdate: 'todo',
    TaskList: 'todo',
    TaskGet: 'todo',
    TaskStop: 'todo',
    TodoWrite: 'todo',
  },
  removedTools: new Set([
    'TeamCreate', 'TeamDelete',
    'ExitPlanMode', 'EnterPlanMode',
    'ExitWorktree', 'EnterWorktree',
    'NotebookEdit', 'Monitor',
    'PushNotification', 'RemoteTrigger',
    'ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList',
    'ToolSearch', 'LSP',
    'PowerShell',
  ]),
  subagentTools: ['teammate'],
  rewriteAgentCalls: true,
  rewriteSkillCalls: false,
  snakeCaseUnknown: false,
};

// ---------------------------------------------------------------------------
// Pi-specific: Agent() → teammate() call-site rewriting
// ---------------------------------------------------------------------------

function rewriteAgentCallSitesPi(body: string): string {
  let out = body.replace(
    /Agent\s*\(\s*(\{[^}]*\})\s*\)/g,
    (_full, inner: string) => {
      const promptMatch = inner.match(/prompt\s*[:=]\s*["']([^"']*)["']/);
      const descMatch = inner.match(/description\s*[:=]\s*["']([^"']*)["']/);
      const nameMatch = inner.match(/\bname\s*[:=]\s*["']([^"']+)["']/);
      const typeMatch = inner.match(/\bsubagent_type\s*[:=]\s*["']([^"']+)["']/);
      const bgMatch = inner.match(/\brun_in_background\s*[:=]\s*(true|false)/);

      const parts: string[] = [];
      if (typeMatch) parts.push(`agent: "${typeMatch[1]}"`);
      if (nameMatch) parts.push(`name: "${nameMatch[1]}"`);
      if (descMatch) parts.push(`description: "${descMatch[1]}"`);
      if (promptMatch) parts.push(`prompt: "${promptMatch[1]}"`);
      if (bgMatch?.[1] === 'true') parts.push('context: "fresh"');

      return `teammate({ ${parts.join(', ')} })`;
    },
  );
  out = out.replace(/\bAgent\s*\(/g, 'teammate(');
  return out;
}

function convertTextPi(
  content: string,
  profile: ConversionProfile,
  isSkillOrCommand: boolean,
): string {
  const { frontmatter, body } = splitFrontmatter(content);

  let hasAgent = false;
  if (isSkillOrCommand) {
    if (detectAgentCalls(body).length > 0 || /\bAgent\s*\(/.test(body)) hasAgent = true;
  }

  let convertedBody = rewriteAgentCallSitesPi(body);
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
    newFrontmatter = fmOut;
  }

  const fmBlock = newFrontmatter ? serializeFrontmatter(newFrontmatter) : '';
  return fmBlock + stripToolTags(convertedBody);
}

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

/**
 * Platform suffix for prepare/workflow override files.
 * e.g. prepare/execute.codex.md takes priority over prepare/execute.md
 * when --platform codex is used at runtime.
 */
export const PLATFORM_SUFFIX: Record<string, string> = {
  codex: '.codex.md',
  agy: '.agy.md',
  pi: '.pi.md',
};

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

/** Supported platform identifiers for runtime content transformation. */
export type TargetPlatform = 'claude' | 'codex' | 'agy' | 'agents-standard' | 'pi';

/** Strip [@tag] authoring markers — they're source-only anchors, not LLM content. */
function stripToolTags(text: string): string {
  return text.replace(/\[@(?:ask|subagent|skill|msg|task)\]\s*/g, '');
}

/**
 * Runtime content transformer — applies platform-specific tool substitution
 * to raw step/prepare/workflow content without touching the filesystem.
 * `claude` is identity (strips tags only). Used by `maestro run prepare --platform`.
 */
export function transformContentForPlatform(
  content: string,
  platform: TargetPlatform,
): string {
  switch (platform) {
    case 'claude':
      return stripToolTags(content);
    case 'codex':
      return stripToolTags(convertTextCodex(content, CODEX_PROFILE, true));
    case 'agy':
      return stripToolTags(convertTextAgy(content, AGY_PROFILE, true));
    case 'agents-standard':
      return stripToolTags(convertTextStandard(content, AGENTS_STANDARD_PROFILE));
    case 'pi':
      return stripToolTags(convertTextPi(content, PI_PROFILE, true));
  }
}

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

/** Build Codex skills (commands + skills) — subagent model conversion. */
export function buildCodexSkills(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildSkillsOnly(claudeDir, targetDir, CODEX_PROFILE, convertTextCodex);
  return { files: stats.files };
}

/** Build Codex agents — subagent model conversion. */
export function buildCodexAgents(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildAgentsOnly(claudeDir, targetDir, CODEX_PROFILE, convertTextCodex);
  return { files: stats.files };
}

/** Build Codex full tree (skills + agents). */
export function buildCodexTree(
  claudeDir: string,
  targetSkillsDir: string,
  targetAgentsDir: string,
): BuildStats {
  return buildTree(claudeDir, targetSkillsDir, targetAgentsDir, CODEX_PROFILE, convertTextCodex);
}

/** Build Pi skills (commands + skills) — teammate subagent model. */
export function buildPiSkills(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildSkillsOnly(claudeDir, targetDir, PI_PROFILE, convertTextPi);
  return { files: stats.files };
}

/** Build Pi agents — teammate subagent model. */
export function buildPiAgents(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildAgentsOnly(claudeDir, targetDir, PI_PROFILE, convertTextPi);
  return { files: stats.files };
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
