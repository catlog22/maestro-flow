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
import {
  applyCodexAgentOverrides,
  assertNoUnsupportedCodexTaskBoardTokens,
} from './codex-agent-overrides.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildStats {
  commands: number;
  skills: number;
  agents: number;
  files: number;
}

/** Body replacement pair: regex pattern + replacement string or replacer function. */
type BodyReplacement = [RegExp, string] | [RegExp, (...args: string[]) => string];

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
    } else if (/^".*"$/.test(value)) {
      // Unescape double-quoted scalars so serializeFrontmatter's re-escaping
      // round-trips instead of compounding (\" → \\\" on every pass).
      out[key] = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    } else {
      out[key] = value.replace(/^["']|["']$/g, '');
    }
    i++;
  }
  return out;
}

function yamlNeedsQuoting(s: string): boolean {
  if (!s) return false;
  // `"` and `\` must force quoting — parseSimpleYaml unescapes quoted scalars,
  // so emitting them bare would strip characters on the next parse pass.
  return /["\\\[\]{}#*&!|>,]/.test(s) || /:\s/.test(s) || /^'|'$/.test(s);
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
    } else if (typeof value === 'string' && yamlNeedsQuoting(value)) {
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      lines.push(`${key}: "${escaped}"`);
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
    grok: {
      tool: 'spawn_subagent',
      fields: {
        prompt: 'prompt',
        description: 'description',
        subagent_type: 'subagent_type',
        run_in_background: 'background',
        isolation: 'isolation',
        name: null,
        model: null,
        mode: null,
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
  const message = args ? `Execute skill ${name}, args: ${args}` : `Execute skill ${name}`;
  return `${fm.tool}({ ${fm.fields.skill}: "${taskName}", ${fm.fields.args}: ${JSON.stringify(message)} })`;
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
  if (profile.removedTools.has(tok)) return null;
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

/** 引号是否被转义:前置反斜杠为奇数个才算转义(偶数个是字面反斜杠,引号闭合)。 */
function isQuoteEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let k = index - 1; k >= 0 && text[k] === '\\'; k--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * 把 `{...}` 内部文本按顶层逗号切成 key: value 字段。
 * 值原样保留(字面量/表达式/多行均可),brace/paren 深度跟踪防误切。
 */
function splitTopLevelFields(inner: string): Array<{ key: string; value: string }> {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let inStr: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inStr) {
      if (ch === inStr && !isQuoteEscaped(inner, i)) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  const fields: Array<{ key: string; value: string }> = [];
  for (const part of parts) {
    const m = part.match(/^\s*([A-Za-z_][\w]*)\s*[:=]\s*([\s\S]*?)\s*$/);
    if (m) fields.push({ key: m[1], value: m[2] });
  }
  return fields;
}

/**
 * Agent() 调用点按 TOOL_FIELD_MAP.Agent.grok 逐字段重写:
 * run_in_background→background,name/model/mode 等不支持字段丢弃,
 * 未知字段与表达式值原样保留(不产生丢弃字段后的空调用);
 * 残余裸 `Agent(` 统一改名为 grok 原生工具。
 */
function rewriteAgentCallSitesGrok(body: string): string {
  const fm = TOOL_FIELD_MAP.Agent.grok;
  let out = '';
  let i = 0;
  const callRe = /\bAgent\s*\(\s*\{/g;
  for (;;) {
    callRe.lastIndex = i;
    const m = callRe.exec(body);
    if (!m) { out += body.slice(i); break; }
    const objStart = m.index + m[0].length - 1; // 指向 {
    // 平衡扫描找匹配的 }(跳过字符串字面量)
    let depth = 0;
    let j = objStart;
    let inStr: string | null = null;
    for (; j < body.length; j++) {
      const ch = body[j];
      if (inStr) {
        if (ch === inStr && !isQuoteEscaped(body, j)) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) { out += body.slice(i); break; } // 未闭合,放弃改写
    let k = j + 1;
    while (k < body.length && /\s/.test(body[k])) k++;
    if (body[k] !== ')') { out += body.slice(i, k); i = k; continue; }

    const mapped: string[] = [];
    for (const f of splitTopLevelFields(body.slice(objStart + 1, j))) {
      const target: string | null | undefined = fm.fields[f.key];
      if (target === null) continue; // grok 不支持的字段,丢弃
      mapped.push(`${target ?? f.key}: ${f.value}`); // 未知字段原样保留
    }
    out += body.slice(i, m.index) + `${fm.tool}({ ${mapped.join(', ')} })`;
    i = k + 1;
  }
  return out.replace(/\bAgent\s*\(/g, `${fm.tool}(`);
}

/**
 * Grok 转换:字段级 Agent() 重写 + 受限 allowed-tools 按正文检测补子代理工具。
 * bodyReplacements 里的 `Agent(`→`spawn_subagent(` 兜底盘在此之后执行,不再命中。
 */
function convertTextGrok(
  content: string,
  profile: ConversionProfile,
  isSkillOrCommand = true,
): string {
  const { frontmatter, body } = splitFrontmatter(content);

  let hasAgent = false;
  if (isSkillOrCommand) {
    hasAgent = detectAgentCalls(body).length > 0 || /\bAgent\s*\(/.test(body);
  }

  const convertedBody = applyBodyReplacements(rewriteAgentCallSitesGrok(body), profile);

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

function convertTextCodex(
  content: string,
  profile: ConversionProfile,
  isSkillOrCommand: boolean,
): string {
  const { frontmatter, body } = splitFrontmatter(content);

  let hasAgent = false;
  let hasPlan = false;
  if (isSkillOrCommand) {
    const agentRefs = detectAgentCalls(body);
    if (agentRefs.length > 0 || /\bAgent\s*\(/.test(body)) hasAgent = true;
    if (/\b(?:TaskCreate|TaskUpdate|TodoWrite)\b/.test(body)) hasPlan = true;
    // Already-converted content (e.g. hand-tuned .codex.md overrides passing
    // through the runtime transformer) carries these notes — don't re-inject.
    if (body.includes('**Agent timeout**')) hasAgent = false;
    if (body.includes('**Plan tracking**')) hasPlan = false;
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
    ? '\n> **Agent timeout**: `spawn_agent` 异步执行且无内置超时 — 除明确短任务外一律 `spawn_agent` 后立即 `wait_agent({ timeout_ms: 3600000 })`（上限 1 小时）阻塞等待，绝不依赖 30000 默认值；`timed_out: true` 且 Agent 未完成时再次 `wait_agent` 续等，不丢弃。批量场景使用 `spawn_agents_on_csv({ max_runtime_seconds: 3600, ... })`。\n'
    : '';
  const planNote = hasPlan
    ? '\n> **Plan tracking**: codex 无 TaskCreate/TaskUpdate/TodoWrite 任务板。进度清单用 `update_plan({ explanation?, plan: [{ step, status }] })` 维护（整体提交步骤数组，status: `pending` | `in_progress` | `completed`），权威状态始终在 session 工件中；依赖/认领（addBlockedBy/owner）是工件字段，不是工具参数。\n'
    : '';
  return fmBlock + agentNote + planNote + stripToolTags(convertedBody);
}

/** Injected note lines mention Claude tool names literally (e.g. "codex 无
 * TaskCreate/... 任务板") — shield them from word-level replacements so a
 * second pass over already-converted content leaves them intact. */
const INJECTED_NOTE_LINE = /^> \*\*(?:Plan tracking|Agent timeout)\*\*:.*$/gm;

function applyBodyReplacements(body: string, profile: ConversionProfile): string {
  const shielded: string[] = [];
  let out = body.replace(INJECTED_NOTE_LINE, line => {
    shielded.push(line);
    return `\0NOTE${shielded.length - 1}\0`;
  });
  for (const [pattern, replacement] of profile.bodyReplacements) {
    out = out.replace(pattern, replacement as string);
  }
  return out.replace(/\0NOTE(\d+)\0/g, (_m, i: string) => shielded[Number(i)]);
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
    [/maestro skills --platform claude\b/g, 'maestro skills --platform agy'],
    [/<task_tracking>[\s\S]*?<\/task_tracking>/g, ''],
    [/\bmaestro run (prepare|skill|brief)\b(?![^\n`]*--platform)/g, 'maestro run $1 --platform agy'],
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
//   <!-- @task -->            TaskCreate/Update → update_plan
//   <!-- @msg -->             SendMessage    → send_message / followup_task
//   <!-- @skill -->           Skill()        → inline execution
// Tags are semantic anchors — placed before tool calls in .claude/ source
// files so the converter can locate substitution points reliably.
// ---------------------------------------------------------------------------

const CODEX_TASK_TRACKING_BLOCK = `<task_tracking>

**时机与操作**（plan 是 session 权威状态的 UI 镜像，不替代 session 状态）：

| 时机 | 操作 | 示例 |
|------|------|------|
| Session 创建后 | update_plan 初始化步骤清单 | \`update_plan({ plan: [{ step: "Step {index}: {step.skill}", status: "pending" }, ...] })\` |
| Step 派发时 | update_plan 标记当前 step | \`update_plan({ plan: [..., 当前 step status: "in_progress"] })\` |
| Step 完成时 | update_plan 标记完成 | \`update_plan({ plan: [..., 该 step status: "completed"] })\` |
| Step 失败时 | update_plan + explanation 说明 | \`update_plan({ explanation: "Step {index} failed: {reason}", plan: [...] })\` |

</task_tracking>`;

const CODEX_PROFILE: ConversionProfile = {
  bodyReplacements: [
    [/maestro skills --platform claude\b/g, 'maestro skills --platform codex'],
    [/<task_tracking>[\s\S]*?<\/task_tracking>/g, CODEX_TASK_TRACKING_BLOCK],
    // v3 removed the standalone run prepare/skill dispatchers and the
    // --platform option on run brief; only the skills catalog keeps a platform.
    [/\bmaestro run (prepare|skill)\b(?![^\n`]*--platform)/g, 'maestro run $1 --platform codex'],
    [/\bAskUserQuestion\b/g, 'request_user_input'],
    [/\bSendMessage\s*\(\s*\{\s*to:/g, 'followup_task({ target:'],
    [/\bSendMessage\b/g, 'send_message'],
    [/\bTaskCreate\b/g, 'update_plan'],
    [/\bTaskUpdate\b/g, 'update_plan'],
    [/\bTaskList\s*\(\s*\)/g, 'list_agents()'],
    [/\bTaskList\b/g, 'list_agents'],
    [/\bTaskGet\b/g, 'wait_agent'],
    [/\bTaskStop\b/g, 'interrupt_agent'],
    [/\bTodoWrite\b/g, 'update_plan'],
    // Enforce max_runtime_seconds: 3600 on spawn_agents_on_csv calls.
    // Lookahead is bounded by the call's `})` closer (tempered token), so a
    // `)` inside a string argument neither ends the scan nor causes re-injection.
    [/spawn_agents_on_csv\s*\(\s*\{(?!(?:(?!\}\s*\))[\s\S])*?max_runtime_seconds)/g, 'spawn_agents_on_csv({ max_runtime_seconds: 3600,'],
    // Enforce timeout_ms: 3600000 (max) on wait_agent calls
    [/wait_agent\s*\(\s*\{(?!(?:(?!\}\s*\))[\s\S])*?timeout_ms)/g, 'wait_agent({ timeout_ms: 3600000,'],
    [/wait_agent\s*\(\s*\)/g, 'wait_agent({ timeout_ms: 3600000 })'],
  ],
  frontmatterToolMap: {
    AskUserQuestion: 'request_user_input',
    SendMessage: 'send_message',
    Agent: 'spawn_agent',
    TaskCreate: 'update_plan',
    TaskUpdate: 'update_plan',
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

const PI_HOST_MIRROR_BLOCK = `<host_mirror>

**镜像协议**（状态对账由插件自动完成，LLM 只保留两个语义动作）：

| 动作 | 工具调用 | 说明 |
|------|----------|------|
| 步进 | \`todo({ action: "next" })\` | 激活下一步 + 注入上游摘要 + 绑定 skill |
| 完成宣告 | \`goal done\` | 触发前置校验（chain 全 completed + gates 无 failed）+ verifier |

- 禁止手工 \`todo({ action: "create" })\` / \`todo({ action: "update" })\` 镜像任务——bridge 从 session.json 自动物化
- goal 由 bridge 从 session intent + definition_of_done 自动派生
- 压缩恢复后首个动作：\`maestro run brief <run-id>\` 重挂协议

</host_mirror>`;

const PI_TEAMMATE_CONTRACT_BLOCK = `<teammate_contract>

- \`background: false\` is the default. Use foreground dispatch whenever the result determines the current answer or next action.
- Use \`background: true\` only for independent work. If this turn must consume a background result, call \`observe\` exactly once with \`action: "wait"\` and a bounded timeout before continuing; never continue independently while the result is pending.
- Otherwise end the turn and wait for the automatic \`teammate-complete\` notification. Do not rely on \`SendMessage\`, \`team_msg\`, or hook callbacks as completion signals.
- Never silently ignore an unfinished dispatch.

</teammate_contract>`;

const PI_PROFILE: ConversionProfile = {
  bodyReplacements: [
    [
      /\b(maestro skills\b[^\n`]*?--platform)\s+(?:claude|\{target_platform\})/g,
      '$1 pi',
    ],
    [/<task_tracking>[\s\S]*?<\/task_tracking>/g, PI_HOST_MIRROR_BLOCK],
    [
      /\b(maestro (?:run (?:start|create|prepare|skill|brief)|session (?:start|create)))\b([^\n`]*?--platform)\s+(?:claude|\{target_platform\})/g,
      '$1$2 pi',
    ],
    [
      /\bmaestro run (start|create|prepare|skill|brief)\b(?![^\n`]*--platform)/g,
      'maestro run $1 --platform pi',
    ],
    [
      /\bmaestro session (start|create)\b(?![^\n`]*--platform)/g,
      'maestro session $1 --platform pi',
    ],
    [/\bTaskCreate\s*\(\s*\{([^}]*)\}\s*\)/g, (_m: string, params: string) => `todo({ action: "create", ${params.trim()} })`],
    [/\bTaskUpdate\s*\(\s*\{([^}]*)\}\s*\)/g, (_m: string, params: string) => `todo({ action: "update", ${params.trim()} })`],
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
  subagentTools: ['teammate', 'observe'],
  rewriteAgentCalls: true,
  rewriteSkillCalls: false,
  snakeCaseUnknown: false,
};

// ---------------------------------------------------------------------------
// Pi-specific: Agent() → teammate() call-site rewriting
// ---------------------------------------------------------------------------

// Claude-era subagent_type names → current teammate-agent-catalog roles.
// Unknown names pass through (they may be project-registered roles).
const SUBAGENT_AGENT_MAP: Record<string, string> = {
  'universal-executor': 'general',
  'general-purpose': 'general',
  'Explore': 'explorer',
  'delegate': 'general',
  'cli-explore-agent': 'cli-explore-agent',
  'team-worker': 'team-worker',
  'team-supervisor': 'team-supervisor',
};

function mapSubagentAgent(name: string | undefined): string {
  return name ? (SUBAGENT_AGENT_MAP[name] ?? name) : 'general';
}

function extractQuotedFieldPi(source: string, fieldName: string): string | null {
  const match = new RegExp(`\\b${fieldName}\\s*[:=]\\s*`).exec(source);
  if (!match) return null;
  const start = match.index + match[0].length;

  if (source.startsWith('\\`', start)) {
    const end = source.lastIndexOf('\\`');
    return end > start ? source.slice(start, end + 2) : null;
  }

  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  if (quote === '`') {
    const end = source.lastIndexOf('`');
    return end > start ? source.slice(start, end + 1) : null;
  }

  let escaped = false;
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) return source.slice(start, index + 1);
  }
  return null;
}

function rewriteLegacyTeammateInnerPi(inner: string): string | null {
  const hasSubagent = /\bsubagent_type\s*[:=]/.test(inner);
  const isDelegate = /\bagent\s*[:=]\s*["']delegate["']/.test(inner);
  const hasLegacyTask = /\btask\s*[:=]/.test(inner) && !/\btasks\s*[:=]/.test(inner);
  if (!hasSubagent && !isDelegate && !hasLegacyTask) return null;

  const subType = inner.match(/\bsubagent_type\s*[:=]\s*["']([^"']+)["']/)?.[1];
  const agentField = inner.match(/\bagent\s*[:=]\s*["']([^"']+)["']/)?.[1];
  const agent = subType
    ? mapSubagentAgent(subType)
    : (agentField && agentField !== 'delegate' ? mapSubagentAgent(agentField) : 'general');

  const taskType = extractQuotedFieldPi(inner, 'taskType');
  const name = extractQuotedFieldPi(inner, 'name');
  const description = extractQuotedFieldPi(inner, 'description');
  const background = inner.match(/\b(?:run_in_background|background)\s*[:=]\s*([^,\r\n]+)/)?.[1]?.trim();
  const cwd = extractQuotedFieldPi(inner, 'cwd');
  const model = extractQuotedFieldPi(inner, 'model');
  const thinking = extractQuotedFieldPi(inner, 'thinking');
  const task = extractQuotedFieldPi(inner, 'task');
  const prompt = extractQuotedFieldPi(inner, 'prompt');

  const parts: string[] = [`agent: "${agent}"`];
  if (taskType) parts.push(`taskType: ${taskType}`);

  const taskParts: string[] = [];
  if (name) taskParts.push(`name: ${name}`);
  const bodyVal = task ?? prompt;
  if (bodyVal) taskParts.push(`prompt: ${bodyVal}`);
  if (description) taskParts.push(`description: ${description}`);
  if (taskParts.length) parts.push(`tasks: [{ ${taskParts.join(', ')} }]`);

  if (task && prompt) parts.push(`/* --rule ${prompt} */`);
  if (background) parts.push(`background: ${background}`);
  if (cwd) parts.push(`cwd: ${cwd}`);
  if (model) parts.push(`model: ${model}`);
  if (thinking) parts.push(`thinking: ${thinking}`);

  return `teammate({ ${parts.join(', ')} })`;
}

function rewriteAgentCallSitesPi(body: string): string {
  const normalized = body.replace(/\bAgent\s*\(/g, 'teammate(');
  const newline = normalized.includes('\r\n') ? '\r\n' : '\n';
  const lines = normalized.split(/\r?\n/);
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const singleLine = line.replace(
      /teammate\(\s*\{(.*?)\}\)/g,
      (_full: string, inner: string) => rewriteLegacyTeammateInnerPi(inner) ?? _full,
    );
    if (singleLine !== line) {
      out.push(singleLine);
      index++;
      continue;
    }

    const open = line.match(/^(\s*)(.*?)\bteammate\(\s*\{\s*$/);
    if (!open) {
      out.push(line);
      index++;
      continue;
    }

    const indent = open[1] ?? '';
    const prefix = open[2] ?? '';
    let inTemplate = false;
    let cursor = index + 1;
    let suffix = '';
    let closed = false;
    while (cursor < lines.length) {
      const current = lines[cursor] ?? '';
      for (let charIndex = 0; charIndex < current.length; charIndex++) {
        if (current[charIndex] !== '`') continue;
        let slashCount = 0;
        for (let prev = charIndex - 1; prev >= 0 && current[prev] === '\\'; prev--) slashCount++;
        if (slashCount % 2 === 0) inTemplate = !inTemplate;
      }
      const close = !inTemplate ? current.match(/^\s*\}\)\s*(.*)$/) : null;
      if (close) {
        suffix = close[1] ?? '';
        closed = true;
        break;
      }
      cursor++;
    }

    if (!closed) {
      out.push(line);
      index++;
      continue;
    }

    const inner = lines.slice(index + 1, cursor).join('\n');
    const rewritten = rewriteLegacyTeammateInnerPi(inner);
    if (!rewritten) out.push(...lines.slice(index, cursor + 1));
    else out.push(`${indent}${prefix}${rewritten}${suffix}`);
    index = cursor + 1;
  }

  return out.join(newline);
}

// ---------------------------------------------------------------------------
// Pi-specific: maestro delegate/explore CLI → teammate() tool rewriting
// ---------------------------------------------------------------------------

/** Parse `--key value` pairs from a delegate CLI options string. */
function parseDelegateOptions(optsStr: string): Record<string, string> {
  const opts: Record<string, string> = {};
  // Value chars include <> for placeholders like issue-<issueId> and <tool>
  const re = /--([\w][\w-]*)(?:\s+((?!--)[\w./${}"'\\:@<>-]+(?:\s+(?!--)[\w./${}"'\\:@<>-]+)*))?/g;
  let m;
  while ((m = re.exec(optsStr)) !== null) {
    // Strip trailing quotes/backslashes that leak from Bash string delimiters
    const val = m[2]?.trim().replace(/["'`\\]+$/, '') ?? 'true';
    opts[m[1]] = val;
  }
  return opts;
}

/** Map delegate `--mode` to teammate `taskType`. */
function delegateModeToTaskType(mode: string | undefined): string {
  if (mode === 'write') return 'development';
  return 'analysis';
}

/** Format a `teammate({...})` call from a parsed delegate prompt + options. */
function formatTeammateCall(prompt: string, opts: Record<string, string>): string {
  const taskType = delegateModeToTaskType(opts['mode']);
  const parts: string[] = ['agent: "general"'];

  parts.push(`taskType: "${taskType}"`);

  const taskParts: string[] = [];
  if (opts['id']) taskParts.push(`name: "${opts['id']}"`);

  const cleanPrompt = prompt.trim();
  if (cleanPrompt && cleanPrompt !== '<PROMPT>') {
    const escaped = cleanPrompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    taskParts.push(`prompt: "${escaped}"`);
  } else {
    taskParts.push('prompt: "<PROMPT>"');
  }

  parts.push(`tasks: [{ ${taskParts.join(', ')} }]`);

  if (opts['cd']) parts.push(`cwd: "${opts['cd']}"`);
  if (opts['rule']) parts.push(`/* --rule ${opts['rule']}: inline the template content into prompt */`);
  if (opts['to']) parts.push(`/* --to ${opts['to']}: set model via model-availability */`);
  if (opts['resume']) parts.push('/* --resume: no teammate equivalent; re-dispatch or use resident agent */');

  return `teammate({ ${parts.join(', ')} })`;
}

/**
 * Rewrite `maestro delegate` / `maestro explore` CLI calls → `teammate()` tool calls.
 *
 * Handles three tiers:
 *   1. Full CLI call with quoted prompt: `maestro delegate "..." --to agy --mode analysis`
 *   2. Prose / table inline without prompt: `` `maestro delegate --mode analysis` ``
 *   3. `maestro explore "..."` → `teammate({ agent: "explorer" })`
 *
 * Also normalises `run_in_background` → `background` and prose mentions.
 */
function rewriteDelegateCallsPi(body: string): string {
  let out = body;

  // Tier 0: escaped-quote delegate calls — Bash("maestro delegate \\\"...\\\" ...")
  // Must run BEFORE tier 1 because the general regex backtracks incorrectly on \\\" delimiters.
  out = out.replace(
    /maestro delegate\s+\\+"([\s\S]*?)\\+"((?:\s+--[\w-]+(?:\s+(?!--)[\S]+)?)*)/g,
    (_full, prompt, optsStr: string) => {
      const opts = parseDelegateOptions(optsStr);
      return formatTeammateCall(prompt, opts);
    },
  );

  // Tier 1: maestro delegate "PROMPT" [options] — full CLI call with quoted prompt
  // Supports single, double, and backtick quotes; prompt may span lines.
  out = out.replace(
    /maestro delegate\s+(["'`])([\s\S]*?)\1((?:\s+--[\w-]+(?:\s+(?!--)[\S]+)?)*)/g,
    (_full, _q, prompt, optsStr: string) => {
      const opts = parseDelegateOptions(optsStr);
      return formatTeammateCall(prompt, opts);
    },
  );

  // Tier 2: maestro explore "PROMPT" [options]
  out = out.replace(
    /maestro explore\s+(["'`])([\s\S]*?)\1((?:\s+--[\w-]+(?:\s+(?!--)[\S]+)?)*)/g,
    (_full, _q, prompt, _optsStr: string) => {
      const escaped = prompt.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      return `teammate({ agent: "explorer", tasks: [{ prompt: "${escaped}" }] })`;
    },
  );

  // Tier 3: prose / table inline — `maestro delegate --mode analysis` (no quoted prompt)
  // Must run AFTER tier 1 so it only catches residual references.
  // Value chars include <> for placeholders like issue-<issueId>.
  out = out.replace(
    /maestro delegate((?:\s+--[\w-]+(?:\s+[\w./${}"'<>-]+)?)*)/g,
    (_full, optsStr: string) => {
      if (!optsStr.trim()) return 'teammate';
      const opts = parseDelegateOptions(optsStr);
      const parts: string[] = [`agent: "general"`, `taskType: "${delegateModeToTaskType(opts['mode'])}"`];
      if (opts['rule']) parts.push(`/* --rule ${opts['rule']} */`);
      if (opts['to']) parts.push(`/* --to ${opts['to']} */`);
      if (opts['id']) parts.push(`/* --id ${opts['id']} */`);
      return `teammate({ ${parts.join(', ')} })`;
    },
  );

  // Tier 4: bare `maestro explore` prose reference (no quoted prompt)
  out = out.replace(/\bmaestro explore\b/g, 'teammate({ agent: "explorer" })');

  // Tier 5: Bash({ command: "maestro delegate ...", run_in_background: true })
  // → the delegate part is already rewritten by tier 1/3; fix the wrapper.
  out = out.replace(/\brun_in_background\s*:\s*true/g, 'background: true');
  out = out.replace(/\brun_in_background\s*:\s*false/g, 'background: false');

  // Tier 6: section headers / prose mentions
  out = out.replace(/Execute via maestro delegate (\w+)/gi, 'Execute via teammate ($1)');
  out = out.replace(/via maestro delegate/g, 'via teammate');
  out = out.replace(/maestro delegate message/g, 'teammate-send');

  return out;
}

function rewriteTeammateWaitSemanticsPi(body: string): string {
  let out = body;
  const waitText = 'wait for the automatic teammate-complete notification (or call observe exactly once with action="wait" when this turn must consume the result)';
  out = out.replace(/wait for hook callback/gi, waitText);
  out = out.replace(/\bSendMessage callback\b/g, 'teammate-complete notification');
  out = out.replace(/\bOn callback\b/g, 'On teammate-complete notification');
  out = out.replace(/\bworker callbacks\b/gi, 'teammate-complete notifications');
  out = out.replace(/\bworker callback\b/gi, 'teammate-complete notification');
  out = out.replace(/\bwait for callbacks\b/gi, 'wait for teammate-complete notifications');
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
  convertedBody = rewriteDelegateCallsPi(convertedBody);
  convertedBody = rewriteTeammateWaitSemanticsPi(convertedBody);
  convertedBody = applyBodyReplacements(convertedBody, profile);

  let newFrontmatter: ParsedFrontmatter | null = null;
  let frontmatterUsesTeammate = false;
  if (frontmatter) {
    const fmOut = { ...frontmatter };
    if (fmOut['allowed-tools']) {
      const r = rewriteAllowedToolsAgy(fmOut['allowed-tools'], profile, hasAgent);
      if (r) {
        if (r.hasAgent || hasAgent) {
          for (const t of profile.subagentTools) {
            if (!r.tools.includes(t)) r.tools.push(t);
          }
        }
        if (r.tools.includes('teammate') && !r.tools.includes('observe')) {
          r.tools.push('observe');
        }
        frontmatterUsesTeammate = r.tools.includes('teammate');
        r.tools.sort();
        fmOut['allowed-tools'] = r.tools;
      }
    }
    newFrontmatter = fmOut;
  }

  const usesTeammate = frontmatterUsesTeammate || /\bteammate\s*\(/.test(convertedBody);
  if (isSkillOrCommand && frontmatter && usesTeammate && !convertedBody.includes('<teammate_contract>')) {
    convertedBody = `${PI_TEAMMATE_CONTRACT_BLOCK}\n\n${convertedBody.replace(/^\r?\n/, '')}`;
  }

  const fmBlock = newFrontmatter ? serializeFrontmatter(newFrontmatter) : '';
  return fmBlock + stripToolTags(convertedBody);
}

// ---------------------------------------------------------------------------
// Agents Standard profile
// ---------------------------------------------------------------------------

const STD_TASK_TRACKING_BLOCK = `<task_tracking>

**时机与操作**（goal 是 session 权威状态的 UI 镜像，不替代 session 状态）：

| 时机 | 操作 | 示例 |
|------|------|------|
| Session 创建后 | create_task session goal | \`create_task({ description: "所有 steps completed", subject: "Session: {intent_summary}" })\` |
| Step 派发时 | create_task step goal | \`create_task({ description: "{step.stage} 完成", subject: "Step {index}: {step.skill}" })\` |
| Step 完成时 | update_task step goal | \`update_task({ taskId: step_goal_id, status: "completed" })\` |
| 子目标全完成时 | update_task session goal | \`update_task({ taskId: session_goal_id, status: "completed" })\` |
| Step 失败时 | update_task step goal | \`update_task({ taskId: step_goal_id, status: "failed" })\` |

</task_tracking>`;

const AGENTS_STANDARD_PROFILE: ConversionProfile = {
  bodyReplacements: [
    [/maestro skills --platform claude\b/g, 'maestro skills --platform agent'],
    [/<task_tracking>[\s\S]*?<\/task_tracking>/g, STD_TASK_TRACKING_BLOCK],
    [/\bmaestro run (prepare|skill|brief)\b(?![^\n`]*--platform)/g, 'maestro run $1 --platform agents-standard'],
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
// Grok profile — xAI Grok Build native tools
//
// Grok 原生工具集（docs/user-guide）：read_file / write_file / search_replace /
// grep / list_dir / run_terminal_command / web_search / web_fetch / monitor /
// spawn_subagent / get_command_or_subagent_output / kill_command_or_subagent /
// wait_commands_or_subagents / create_goal / update_goal / get_goal。
// 无 update_plan / invoke_skill / delegate_subagent / task 系列工具；
// 子代理深度限制为 1（嵌套 spawn 直接失败）。
// ---------------------------------------------------------------------------

const GROK_TASK_TRACKING_BLOCK = `<task_tracking>

Grok 无独立 task 跟踪工具（无 update_plan / create_task / track_tasks）。Session/Step 进度以 session artifacts 为权威状态。仅在用户明确要求、或 step 声明 \`goal: true\`（视为工作流显式授权）时使用 goal 工具：\`create_goal({ objective, token_budget? })\` / \`update_goal({ status })\` / \`get_goal({})\`（单一活跃 goal）。

</task_tracking>`;

const GROK_PROFILE: ConversionProfile = {
  bodyReplacements: [
    [/maestro skills --platform claude\b/g, 'maestro skills --platform grok'],
    [/<task_tracking>[\s\S]*?<\/task_tracking>/g, GROK_TASK_TRACKING_BLOCK],
    [/\bmaestro run (prepare|skill|brief)\b(?![^\n`]*--platform)/g, 'maestro run $1 --platform grok'],
    // 深度限制 1：凡含多 agent 编排段的 agent 文件，补嵌套 spawn 失败警告
    [/## Multi-Agent Orchestration\n/, '## Multi-Agent Orchestration\n\n> **Grok depth limit 1**：本 executor 若以子代理身份运行，调用 `spawn_subagent` 会因 depth-limit 直接失败。此时不得嵌套派发，应在返回结果中声明 wave 需求（`needs_wave` + worker 任务清单），由父会话（顶层）执行 spawn 并用 `wait_commands_or_subagents` 等齐。\n'],
    // 其他平台的子代理工具名（若源文本混入）→ grok 原生
    [/\bdelegate_subagent\b/g, 'spawn_subagent'],
    [/\bspawn_agent\b/g, 'spawn_subagent'],
    [/\bwait_agent\b/g, 'get_command_or_subagent_output'],
    [/\binterrupt_agent\b/g, 'kill_command_or_subagent'],
    [/\bWebSearch\b/g, 'web_search'],
    [/\bWebFetch\b/g, 'web_fetch'],
    [/\bMonitor\b/g, 'monitor'],
    [/\bLSP\b/g, 'lsp'],
    [/\bRead\s*\(/g, 'read_file('],
    [/\bWrite\s*\(/g, 'write_file('],
    [/\bEdit\s*\(/g, 'search_replace('],
    [/\bMultiEdit\s*\(/g, 'search_replace('],
    [/\bBash\s*\(/g, 'run_terminal_command('],
    [/\bPowerShell\s*\(/g, 'run_terminal_command('],
    [/\bGrep\s*\(/g, 'grep('],
    [/\bGlob\s*\(/g, 'list_dir('],
    [/\bAgent\s*\(/g, 'spawn_subagent('],
    [/\bTaskStop\s*\(/g, 'kill_command_or_subagent('],
    [/\bTaskOutput\s*\(/g, 'get_command_or_subagent_output('],
  ],
  frontmatterToolMap: {
    Read: 'read_file',
    Write: 'write_file',
    Edit: 'search_replace',
    MultiEdit: 'search_replace',
    Bash: 'run_terminal_command',
    PowerShell: 'run_terminal_command',
    Grep: 'grep',
    Glob: 'list_dir',
    Agent: 'spawn_subagent',
    TaskStop: 'kill_command_or_subagent',
    TaskOutput: 'get_command_or_subagent_output',
    WebSearch: 'web_search',
    WebFetch: 'web_fetch',
    Monitor: 'monitor',
    LSP: 'lsp',
  },
  removedTools: new Set([
    // grok 无对应工具：skills 走 /slash 或自动触发，无 task 跟踪工具，无 teams
    'Skill',
    'TodoWrite',
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet',
    'AskUserQuestion',
    'SendMessage',
    'TeamCreate',
    'TeamDelete',
    'NotebookEdit',
  ]),
  subagentTools: [
    'spawn_subagent',
    'get_command_or_subagent_output',
    'kill_command_or_subagent',
    'wait_commands_or_subagents',
  ],
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
  grok: '.grok.md',
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
// Codex TOML agent builder — converts .claude/agents/*.md → .codex/agents/*.toml
// ---------------------------------------------------------------------------

const WRITE_TOOLS = new Set(['Write', 'Edit', 'Bash', 'Agent', 'Skill']);

function deriveSandboxMode(tools: string[]): string {
  return tools.some(t => WRITE_TOOLS.has(t)) ? 'workspace-write' : 'read-only';
}

function escapeToml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
}

function buildCodexAgentsToml(
  claudeDir: string,
  targetAgentsDir: string,
): BuildStats {
  const agentsDir = join(claudeDir, 'agents');
  const overrideDir = join(dirname(claudeDir), '.codex', 'agent-overrides');
  const stats: BuildStats = { commands: 0, skills: 0, agents: 0, files: 0 };

  if (!existsSync(agentsDir)) return stats;

  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const src = join(agentsDir, entry.name);
    const raw = readFileSync(src, 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw);

    const agentName = entry.name.replace(/\.md$/, '');
    const name = (frontmatter?.name as string ?? agentName)
      .replace(/[-\s]+/g, '_').toLowerCase();
    const desc = frontmatter?.description as string ?? '';

    const toolsList = Array.isArray(frontmatter?.['allowed-tools'])
      ? frontmatter['allowed-tools'] as string[]
      : typeof frontmatter?.['allowed-tools'] === 'string'
        ? (frontmatter['allowed-tools'] as string).split(',').map(s => s.trim()).filter(Boolean)
        : [];

    const sandbox = deriveSandboxMode(toolsList);

    const overriddenBody = applyCodexAgentOverrides(agentName, body, overrideDir);
    assertNoUnsupportedCodexTaskBoardTokens(agentName, overriddenBody);

    let convertedBody = rewriteAgentCallSitesCodex(overriddenBody);
    convertedBody = rewriteSkillCallSitesCodex(convertedBody);
    convertedBody = applyBodyReplacements(convertedBody, CODEX_PROFILE);
    convertedBody = stripToolTags(convertedBody);

    const tomlName = entry.name.replace(/\.md$/, '');
    const dest = join(targetAgentsDir, `${tomlName}.toml`);
    ensureDir(dirname(dest));

    const toml = [
      `name = "${escapeToml(name)}"`,
      `description = "${escapeToml(desc)}"`,
      `sandbox_mode = "${sandbox}"`,
      '',
      `developer_instructions = """`,
      convertedBody.trimEnd(),
      `"""`,
      '',
    ].join('\n');

    writeFileSync(dest, toml, 'utf8');
    stats.agents++;
    stats.files++;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Supported platform identifiers for runtime content transformation. */
export type TargetPlatform = 'claude' | 'codex' | 'agy' | 'agents-standard' | 'pi' | 'grok';

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
    case 'grok':
      return convertTextGrok(content, GROK_PROFILE);
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

/** Build grok skills (commands + skills) only — no agents. */
export function buildGrokSkills(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildSkillsOnly(claudeDir, targetDir, GROK_PROFILE, convertTextGrok);
  return { files: stats.files };
}

/** Build grok agents only — no skills/commands. */
export function buildGrokAgents(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildAgentsOnly(claudeDir, targetDir, GROK_PROFILE, convertTextGrok);
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

/** Build Codex agents as TOML — subagent model conversion. */
export function buildCodexAgents(
  claudeDir: string,
  targetDir: string,
): { files: number } {
  const stats = buildCodexAgentsToml(claudeDir, targetDir);
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
