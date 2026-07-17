#!/usr/bin/env node
// ---------------------------------------------------------------------------
// convert-claude-to-agy.mjs
//
// Generates the .agy/ source mirror from .claude/. Outputs:
//   .agy/skills/<name>/         ← from .claude/commands/<name>.md
//   .agy/skills/<name>/         ← from .claude/skills/<name>/ (directory copy)
//   .agy/agents/<name>.md       ← from .claude/agents/<name>.md
//
// Conversions applied:
//   - 9 simple tool-name replacements (regex)
//   - Sub-agent orchestration rewrite (Agent → invoke_subagent) with
//     a "## Sub-Agent Registration" preamble injected at the top of each
//     SKILL.md that spawns sub-agents
//   - Frontmatter allowed-tools list rewrite
//   - Annotation comments where semantics differ (TaskCreate, SendMessage
//     ConversationId, team_msg JSONL fallback, etc.)
//
// Idempotent — wipes .agy/ at the start.
//
// Usage:
//   node scripts/convert-claude-to-agy.mjs
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);

const CLAUDE_DIR = join(REPO_ROOT, '.claude');
const AGY_DIR = join(REPO_ROOT, '.agy');

const CLAUDE_COMMANDS = join(CLAUDE_DIR, 'commands');
const CLAUDE_SKILLS = join(CLAUDE_DIR, 'skills');
const CLAUDE_AGENTS = join(CLAUDE_DIR, 'agents');

const AGY_SKILLS = join(AGY_DIR, 'skills');
const AGY_AGENTS = join(AGY_DIR, 'agents');

// ---------------------------------------------------------------------------
// Simple tool-name replacements — applied to body text and to allowed-tools.
// Order matters: longer/more-specific patterns first to avoid double-rewriting.
// ---------------------------------------------------------------------------

// Body replacements: split into TWO tiers.
//   - "unambiguous" patterns include `(` or `{` — safe everywhere
//   - "frontmatter-only" names are the bare CamelCase that would mangle prose
// Body conversion only applies the unambiguous tier so plain English verbs
// ("Read the docs", "Write the file") stay intact.

// Two tiers of body replacements:
//   Tier A: AMBIGUOUS Claude tool names that overlap with English verbs
//           (Read, Write, Edit, Bash, Grep, Glob) — only rewrite when
//           clearly a call site (followed by `(`).
//   Tier B: UNAMBIGUOUS CamelCase tool names (SendMessage, AskUserQuestion,
//           MCP-namespaced tools) — safe to rewrite bare-word everywhere.
const BODY_REPLACEMENTS = [
  // Platform-specific: rewrite ralph skills --platform claude → --platform agy
  [/ralph skills --platform claude\b/g, 'ralph skills --platform agy'],
  // Tier B — bare-word, unambiguous
  [/\bmcp__exa__web_search_exa\b/g, 'search_web'],
  [/\bSendMessage\b/g, 'send_message'],
  [/\bAskUserQuestion\b/g, 'ask_question'],
  // Tier A — call-site only (require open paren)
  [/\bRead\s*\(/g, 'view_file('],
  [/\bWrite\s*\(/g, 'write_to_file('],
  [/\bEdit\s*\(/g, 'replace_file_content('],
  [/\bBash\s*\(/g, 'run_command('],
  [/\bGrep\s*\(/g, 'grep_search('],
  [/\bGlob\s*\(/g, 'grep_search('],
];

// Used only when rewriting allowed-tools frontmatter.
const FRONTMATTER_TOOL_MAP = {
  'SendMessage': 'send_message',
  'AskUserQuestion': 'ask_question',
  'Read': 'view_file',
  'Write': 'write_to_file',
  'Edit': 'replace_file_content',
  'Bash': 'run_command',
  'Grep': 'grep_search',
  'Glob': 'grep_search',
  'mcp__exa__web_search_exa': 'search_web',
};

// Tools that have to be removed from allowed-tools because they have no
// direct agy equivalent (their behaviour is achieved via file IO).
const REMOVED_TOOLS = new Set([
  'TeamCreate', 'TeamDelete',
  'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'TodoWrite',
  'Skill',
  // mcp__ccw-tools__team_msg becomes file IO; drop from declared tools.
  'mcp__ccw-tools__team_msg',
]);

// Tools added when sub-agent orchestration is present.
const SUBAGENT_TOOLS = ['define_subagent', 'invoke_subagent', 'send_message', 'manage_subagents'];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function rmrf(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function walkFiles(dir, accumulator = []) {
  if (!existsSync(dir)) return accumulator;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, accumulator);
    else if (entry.isFile()) accumulator.push(full);
  }
  return accumulator;
}

// ---------------------------------------------------------------------------
// Frontmatter parser. Use the project YAML dependency so nested Run contracts,
// flow-style arrays, quoted scalars, and future schema additions round-trip.
// ---------------------------------------------------------------------------

function splitFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: null, raw: '', body: content };
  }
  const end = content.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: null, raw: '', body: content };
  // CRLF worktrees: the closing "\r\n---" match leaves a lone trailing "\r"
  // on the last frontmatter line — strip it or YAML.parse rejects flow arrays.
  const raw = content.slice(4, end).replace(/\r\n/g, '\n').replace(/\r$/, '');
  const afterMarker = content.indexOf('\n', end + 4);
  const body = afterMarker >= 0 ? content.slice(afterMarker + 1) : '';
  const parsed = YAML.parse(raw);
  if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('Skill frontmatter must be a YAML mapping');
  }
  return { frontmatter: parsed ?? {}, raw, body };
}

function rewriteAllowedTools(tools) {
  if (!tools) return null;
  const list = Array.isArray(tools)
    ? tools
    : String(tools).split(',').map(s => s.trim()).filter(Boolean);

  const out = new Set();
  let hasAgent = false;

  for (const entry of list) {
    // Strip parameterization suffix like "(*)" or "(write|edit)"
    const name = entry.replace(/\(.*\)$/, '').trim();
    if (!name) continue;

    if (REMOVED_TOOLS.has(name)) continue;

    if (name === 'Agent') {
      hasAgent = true;
      for (const t of SUBAGENT_TOOLS) out.add(t);
      continue;
    }

    const mapped = FRONTMATTER_TOOL_MAP[name] ?? name;
    out.add(mapped);
  }

  return { tools: Array.from(out).sort(), hasAgent };
}

// ---------------------------------------------------------------------------
// Body conversions
// ---------------------------------------------------------------------------

function applySimpleBodyReplacements(body) {
  let out = body;
  for (const [pattern, replacement] of BODY_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Detect Agent() calls in the body — flags whether we need a registration preamble.
function detectAgentCalls(body) {
  // Matches Agent({ ... }) or Agent(subagent_type=..., ...) with rough captures.
  const calls = [];
  const re = /Agent\s*\(\s*(?:\{[^}]*\}|[^)]*)\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const snippet = m[0];
    const subagentMatch = snippet.match(/subagent_type\s*[:=]\s*["']([^"']+)["']/);
    if (subagentMatch) calls.push(subagentMatch[1]);
  }
  return Array.from(new Set(calls));
}

// Rewrite Agent(...) call sites → invoke_subagent([{...}]).
// Pass 1 — extracts subagent_type / prompt and emits a tidy schema-shaped call.
// Pass 2 — catch-all rename for anything that escaped pass 1 (prose mentions,
//          multi-line calls with nested braces, generator templates).
function rewriteAgentCalls(body) {
  let out = body.replace(
    /Agent\s*\(\s*(\{[^}]*\}|subagent_type[\s\S]*?)\)/g,
    (full, inner) => {
      const typeMatch = inner.match(/subagent_type\s*[:=]\s*["']([^"']+)["']/);
      const promptMatch = inner.match(/prompt\s*[:=]\s*["']([^"']*)["']/);
      const nameMatch = inner.match(/\bname\s*[:=]\s*["']([^"']+)["']/);
      const teamMatch = inner.match(/team_name\s*[:=]\s*["']([^"']+)["']/);

      const type = typeMatch ? typeMatch[1] : '<TypeName>';
      const role = nameMatch ? nameMatch[1] : (teamMatch ? teamMatch[1] : '<Role>');
      const prompt = promptMatch ? promptMatch[1] : '<Prompt>';

      return `invoke_subagent([{ TypeName: "${type}", Role: "${role}", Prompt: "${prompt}", Workspace: "inherit" }])`;
    }
  );
  // Catch-all: residual `Agent(` in prose / generator templates.
  out = out.replace(/\bAgent\s*\(/g, 'invoke_subagent(');
  return out;
}

// Rewrite Skill(skill="X", args="Y") → view_file(SKILL.md) + inline-execute.
//
// Antigravity has no Skill() tool — agents cannot programmatically call
// another skill. The equivalent is to `view_file` the target SKILL.md and
// execute its instructions inline in the current agent context. Args are
// passed as conceptual input variables in the prose annotation.
//
// Handles both function-style (skill=..., args=...) and JS-object style
// ({ skill: ..., args: ... }).
function rewriteSkillCalls(body) {
  let out = body;

  // JS-object form first (more specific). Matches Skill({ skill: "X", args: "Y" })
  // and Skill({ skill: "X" }).
  out = out.replace(
    /Skill\s*\(\s*\{\s*skill\s*:\s*["']([^"']+)["'](?:\s*,\s*args\s*:\s*["']([^"']*)["'])?\s*\}\s*\)/g,
    (_full, name, args) => formatInlineSkill(name, args)
  );

  // Function-style form. Matches Skill(skill="X", args="Y") and Skill(skill="X").
  out = out.replace(
    /Skill\s*\(\s*skill\s*=\s*["']([^"']+)["'](?:\s*,\s*args\s*=\s*["']([^"']*)["'])?\s*\)/g,
    (_full, name, args) => formatInlineSkill(name, args)
  );

  return out;
}

function formatInlineSkill(name, args) {
  const argLine = args ? ` (args: ${JSON.stringify(args)})` : '';
  // Inline form — compact, fits in tables/state-machine DO clauses.
  return `view_file(AbsolutePath="<agy-skills-dir>/${name}/SKILL.md") + execute inline${argLine}`;
}

const SUB_AGENT_PREAMBLE = (typeNames) => `\n## Sub-Agent Registration (Antigravity)\n\n` +
`Before any \`invoke_subagent\` call below, register each sub-agent type once per session by reading the system_prompt from \`<agy-agents-dir>/<name>.md\` and passing it to \`define_subagent\`. The \`<agy-agents-dir>\` is:\n` +
`- global install: \`~/.gemini/antigravity-cli/agents/\`\n` +
`- workspace install: \`<project>/.agents/agents/\`\n\n` +
typeNames.map(n => `- \`define_subagent(name="${n}", description="<from agents/${n}.md frontmatter>", system_prompt=<contents of agents/${n}.md body>, enable_write_tools=true, enable_mcp_tools=true, enable_subagent_tools=false)\``).join('\n') +
`\n\n**ConversationId tracking**: \`invoke_subagent\` returns a ConversationId per spawned instance. Subsequent \`send_message(Recipient=<ConversationId>, Message=...)\` calls require that ConversationId — never use the role name as the recipient.\n\n` +
`---\n`;

const CONVERSION_NOTES = '';

// ---------------------------------------------------------------------------
// File conversion
// ---------------------------------------------------------------------------

function convertText(content, opts = {}) {
  const { isSkillOrCommand = true } = opts;
  const { frontmatter, body } = splitFrontmatter(content);

  // Detect sub-agent types only for skills/commands (so we only inject the
  // registration preamble on orchestrators, not on agent leaf files).
  let hasAgent = false;
  let subAgentTypes = [];
  if (isSkillOrCommand) {
    subAgentTypes = detectAgentCalls(body);
    if (subAgentTypes.length > 0) hasAgent = true;
  }

  // Always rewrite Agent(...) and Skill(...) call sites + apply simple
  // replacements. Agent files have prose mentions of these that also need
  // updating; skills/commands have the actual call sites.
  let convertedBody = rewriteAgentCalls(body);
  convertedBody = rewriteSkillCalls(convertedBody);
  convertedBody = applySimpleBodyReplacements(convertedBody);

  // Frontmatter rewrite
  let newFrontmatter = null;
  if (frontmatter) {
    const fmOut = { ...frontmatter };
    if (fmOut['allowed-tools']) {
      const r = rewriteAllowedTools(fmOut['allowed-tools']);
      if (r) {
        if (r.hasAgent || hasAgent) {
          for (const t of SUBAGENT_TOOLS) {
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
  const preamble = subAgentTypes.length > 0 ? SUB_AGENT_PREAMBLE(subAgentTypes) : '';
  return fmBlock + preamble + convertedBody + (isSkillOrCommand ? CONVERSION_NOTES : '');
}

function serializeFrontmatter(fm) {
  return `---\n${YAML.stringify(fm).trimEnd()}\n---\n`;
}

// ---------------------------------------------------------------------------
// Per-tree converters
// ---------------------------------------------------------------------------

let stats = { commands: 0, skills: 0, agents: 0, otherFiles: 0 };

function convertCommands() {
  if (!existsSync(CLAUDE_COMMANDS)) return;
  for (const entry of readdirSync(CLAUDE_COMMANDS, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const name = entry.name.replace(/\.md$/, '');
    const src = join(CLAUDE_COMMANDS, entry.name);
    const destDir = join(AGY_SKILLS, name);
    const dest = join(destDir, 'SKILL.md');
    ensureDir(destDir);
    const out = convertText(readFileSync(src, 'utf8'), { isSkillOrCommand: true });
    writeFileSync(dest, out, 'utf8');
    stats.commands++;
  }
}

function convertSkills() {
  if (!existsSync(CLAUDE_SKILLS)) return;
  for (const entry of readdirSync(CLAUDE_SKILLS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const srcRoot = join(CLAUDE_SKILLS, skillName);
    const destRoot = join(AGY_SKILLS, skillName);
    for (const fp of walkFiles(srcRoot)) {
      const rel = relative(srcRoot, fp);
      const dest = join(destRoot, rel);
      ensureDir(dirname(dest));
      if (fp.endsWith('.md')) {
        const isMain = basename(fp) === 'SKILL.md' || rel.includes('role.md') || /\.md$/.test(fp);
        const out = convertText(readFileSync(fp, 'utf8'), { isSkillOrCommand: isMain });
        writeFileSync(dest, out, 'utf8');
        stats.otherFiles++;
      } else {
        // Non-md file — straight copy
        writeFileSync(dest, readFileSync(fp));
        stats.otherFiles++;
      }
    }
    stats.skills++;
  }
}

function convertAgents() {
  if (!existsSync(CLAUDE_AGENTS)) return;
  for (const entry of readdirSync(CLAUDE_AGENTS, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const src = join(CLAUDE_AGENTS, entry.name);
    const dest = join(AGY_AGENTS, entry.name);
    ensureDir(dirname(dest));
    // Agents: their body becomes a `system_prompt` for define_subagent.
    // We DO apply simple tool-name replacements to the body so prose mentions
    // agy tool names, but we do NOT add the sub-agent registration preamble
    // (agent files are leaves, not orchestrators).
    const out = convertText(readFileSync(src, 'utf8'), { isSkillOrCommand: false });
    writeFileSync(dest, out, 'utf8');
    stats.agents++;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.error(`Converting .claude/ → .agy/`);
  console.error(`  source: ${CLAUDE_DIR}`);
  console.error(`  target: ${AGY_DIR}`);

  rmrf(AGY_DIR);
  ensureDir(AGY_SKILLS);
  ensureDir(AGY_AGENTS);

  convertCommands();
  convertSkills();
  convertAgents();

  console.error('');
  console.error(`Done.`);
  console.error(`  commands → skills: ${stats.commands}`);
  console.error(`  skills (dirs):     ${stats.skills}`);
  console.error(`  agents:            ${stats.agents}`);
  console.error(`  other md/files:    ${stats.otherFiles}`);
  console.error('');
  console.error(`Next: spot-check .agy/skills/team-coordinate/SKILL.md and .agy/agents/team-worker.md`);
}

main();
