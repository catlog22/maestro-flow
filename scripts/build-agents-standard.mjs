#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-agents-standard.mjs
//
// Builds the Agent Skills open-standard mirror at `.agents/` directly from
// `.claude/`. Independent of `.agy/` — uses its own neutral tool-name map.
//
// Reference: https://github.com/agentskills/agentskills
//
// Output:
//   .agents/skills/<name>/SKILL.md       ← from .claude/commands/<name>.md
//   .agents/skills/<name>/               ← from .claude/skills/<name>/ (dir copy + body rewrite)
//   .agents/agents/<name>.md             ← from .claude/agents/<name>.md
//
// Conversions applied:
//   - Tier B (bare CamelCase Claude tool names) → snake_case neutral verbs
//   - Tier A (Read, Write, Edit, Bash, Grep, Glob) call sites → neutral verbs
//   - Agent(...) → delegate_subagent(...)
//   - Skill(...) → invoke_skill(...)
//   - Frontmatter allowed-tools list rewritten via the same map
//   - Claude-only orchestration tools (TodoWrite, TaskCreate/Update/List, etc.)
//     mapped to generic equivalents
//
// Default: NOT installed. .agents/ is gitignored. Run manually:
//   node scripts/build-agents-standard.mjs
//
// Consumers (verified 2026-05):
//   .agents/skills/  is auto-discovered by:
//     - OpenAI Codex, Kiro (IDE + CLI), Gemini CLI, GitHub CLI (skills)
//   Tools using private paths (NOT this mirror):
//     - Claude Code (.claude/), Qoder (.qoder/), Trae (.trae/),
//       Cursor (.cursor/), Roo Code (.roo/),
//       GitHub Copilot web (.github/skills/), VS 2026 (.copilot/skills/)
//
// Idempotent — wipes .agents/ at start.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);

const CLAUDE_DIR = join(REPO_ROOT, '.claude');
const AGENTS_DIR = join(REPO_ROOT, '.agents');

const CLAUDE_COMMANDS = join(CLAUDE_DIR, 'commands');
const CLAUDE_SKILLS = join(CLAUDE_DIR, 'skills');
const CLAUDE_AGENTS = join(CLAUDE_DIR, 'agents');

const AGENTS_SKILLS = join(AGENTS_DIR, 'skills');
const AGENTS_AGENTS = join(AGENTS_DIR, 'agents');

// ---------------------------------------------------------------------------
// Replacement maps — neutral Agent Skills standard verbs
// ---------------------------------------------------------------------------

// Body replacements: two tiers.
//   Tier B: UNAMBIGUOUS CamelCase tool names — bare-word safe.
//   Tier A: AMBIGUOUS names that overlap English verbs — call-site only.
const BODY_REPLACEMENTS = [
  // Tier B — bare unambiguous CamelCase
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

  // Tier A — call-site only (require open paren) so prose stays intact
  [/\bRead\s*\(/g, 'read_file('],
  [/\bWrite\s*\(/g, 'write_file('],
  [/\bEdit\s*\(/g, 'edit_file('],
  [/\bBash\s*\(/g, 'shell('],
  [/\bGrep\s*\(/g, 'search('],
  [/\bGlob\s*\(/g, 'find_files('],
  [/\bAgent\s*\(/g, 'delegate_subagent('],
  [/\bSkill\s*\(/g, 'invoke_skill('],
  [/\bPowerShell\s*\(/g, 'shell('],
];

// Frontmatter allowed-tools map: bare-word, no parens.
const FRONTMATTER_TOOL_MAP = {
  // Tier B
  'AskUserQuestion': 'ask_user',
  'SendMessage': 'send_message',
  'ExitPlanMode': 'exit_plan_mode',
  'ExitWorktree': 'exit_worktree',
  'EnterPlanMode': 'enter_plan_mode',
  'EnterWorktree': 'enter_worktree',
  'TodoWrite': 'track_tasks',
  'TaskCreate': 'create_task',
  'TaskUpdate': 'update_task',
  'TaskList': 'list_tasks',
  'TaskGet': 'get_task',
  'WebSearch': 'web_search',
  'WebFetch': 'web_fetch',
  'NotebookEdit': 'edit_notebook',
  'Monitor': 'monitor_process',
  'PushNotification': 'push_notification',
  'RemoteTrigger': 'remote_trigger',
  'ScheduleWakeup': 'schedule_wakeup',
  'CronCreate': 'cron_create',
  'CronDelete': 'cron_delete',
  'CronList': 'cron_list',
  'ToolSearch': 'tool_search',
  'TeamCreate': 'create_team',
  'TeamDelete': 'delete_team',
  // Tier A
  'Read': 'read_file',
  'Write': 'write_file',
  'Edit': 'edit_file',
  'Bash': 'shell',
  'PowerShell': 'shell',
  'Grep': 'search',
  'Glob': 'find_files',
  'Agent': 'delegate_subagent',
  'Skill': 'invoke_skill',
};

// MCP tools (`mcp__*`) are passed through untouched — universal across CLIs.

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function rmrf(dir) { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }
function ensureDir(dir) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Frontmatter handling (minimal YAML subset)
// ---------------------------------------------------------------------------

function splitFrontmatter(content) {
  let headLen;
  if (content.startsWith('---\r\n')) headLen = 5;
  else if (content.startsWith('---\n')) headLen = 4;
  else return { rawFm: null, body: content };
  const end = content.indexOf('\n---', headLen);
  if (end < 0) return { rawFm: null, body: content };
  // Normalise CRLF, drop any stray CR (last item before closing fence may keep one),
  // strip any leading newline (from CRLF→LF normalisation).
  const rawFm = content.slice(headLen, end)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/^\n+/, '');
  const afterMarker = content.indexOf('\n', end + 4);
  const body = afterMarker >= 0 ? content.slice(afterMarker + 1) : '';
  return { rawFm, body };
}

// Rewrite the `allowed-tools` list in the raw frontmatter text. Two shapes:
//   inline:  allowed-tools: A, B, C
//   block :  allowed-tools:\n  - A\n  - B
function rewriteAllowedTools(rawFm) {
  if (!rawFm) return rawFm;
  const lines = rawFm.split('\n');
  let i = 0;
  const out = [];
  while (i < lines.length) {
    const line = lines[i];
    const inlineMatch = line.match(/^(allowed-tools\s*:\s*)(.*)$/);
    if (inlineMatch) {
      const prefix = inlineMatch[1];
      const value = inlineMatch[2].trim();
      // Block form: value empty
      if (value === '') {
        // Strip any trailing whitespace, keep just `allowed-tools:`
        out.push(`${prefix.replace(/\s+$/, '')}`);
        i += 1;
        // Consume list items
        while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
          const itemMatch = lines[i].match(/^(\s+-\s+)(.+)$/);
          if (itemMatch) {
            const indent = itemMatch[1];
            const tok = itemMatch[2].trim();
            const mapped = mapToolToken(tok);
            if (mapped !== null) out.push(`${indent}${mapped}`);
          }
          i += 1;
        }
        continue;
      }
      // Inline form
      const tokens = value.split(',').map(t => t.trim()).filter(Boolean);
      const mapped = tokens.map(mapToolToken).filter(t => t !== null);
      out.push(`${prefix}${mapped.join(', ')}`);
    } else {
      out.push(line);
    }
    i += 1;
  }
  return out.join('\n');
}

function mapToolToken(tok) {
  if (FRONTMATTER_TOOL_MAP[tok]) return FRONTMATTER_TOOL_MAP[tok];
  if (tok.startsWith('mcp__')) return tok;            // pass-through MCP
  if (/^[a-z][a-z0-9_]*$/.test(tok)) return tok;       // already standard
  // Unknown CamelCase → conservative snake_case
  return tok.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

// ---------------------------------------------------------------------------
// Body rewriting
// ---------------------------------------------------------------------------

function rewriteBody(body) {
  let out = body;
  for (const [pattern, replacement] of BODY_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// File pipeline
// ---------------------------------------------------------------------------

function convertContent(content, { addStandardHeader } = {}) {
  const { rawFm, body } = splitFrontmatter(content);
  if (rawFm === null) {
    // No frontmatter → just body rewrite
    return rewriteBody(content);
  }
  const newFm = rewriteAllowedTools(rawFm);
  const newBody = rewriteBody(body);
  const header = addStandardHeader
    ? '\n<!-- Open-standard mirror generated by scripts/build-agents-standard.mjs — do not edit; re-run after editing .claude/ source. -->\n'
    : '';
  return `---\n${newFm}\n---${header}\n${newBody}`;
}

function copyAsSkillMd(srcPath, dstPath) {
  const content = readFileSync(srcPath, 'utf8');
  const converted = convertContent(content, { addStandardHeader: true });
  ensureDir(dirname(dstPath));
  writeFileSync(dstPath, converted);
}

function convertSkillsDir(srcDir, dstDir) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      ensureDir(dst);
      convertSkillsDir(src, dst);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.md')) {
        copyAsSkillMd(src, dst);
      } else {
        // Auxiliary file: copy bytes verbatim
        writeFileSync(dst, readFileSync(src));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(CLAUDE_DIR)) {
  console.error('Error: .claude/ source not found.');
  process.exit(1);
}

console.log('Building Agent Skills open-standard mirror: .claude/ → .agents/');
console.log(`  source: ${CLAUDE_DIR}`);
console.log(`  target: ${AGENTS_DIR}`);

rmrf(AGENTS_DIR);
ensureDir(AGENTS_DIR);
ensureDir(AGENTS_SKILLS);
ensureDir(AGENTS_AGENTS);

// 1. commands → skills/<name>/SKILL.md
let commandCount = 0;
if (existsSync(CLAUDE_COMMANDS)) {
  for (const entry of readdirSync(CLAUDE_COMMANDS, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const name = entry.name.replace(/\.md$/, '');
    const src = join(CLAUDE_COMMANDS, entry.name);
    const dst = join(AGENTS_SKILLS, name, 'SKILL.md');
    copyAsSkillMd(src, dst);
    commandCount += 1;
  }
}

// 2. skills/ (directories) → skills/<name>/ recursively
let skillCount = 0;
if (existsSync(CLAUDE_SKILLS)) {
  for (const entry of readdirSync(CLAUDE_SKILLS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = join(CLAUDE_SKILLS, entry.name);
    const dst = join(AGENTS_SKILLS, entry.name);
    ensureDir(dst);
    convertSkillsDir(src, dst);
    skillCount += 1;
  }
}

// 3. agents/ → agents/<name>.md (with rewrites; auxiliary files passthrough)
let agentCount = 0;
if (existsSync(CLAUDE_AGENTS)) {
  for (const entry of readdirSync(CLAUDE_AGENTS, { withFileTypes: true })) {
    const src = join(CLAUDE_AGENTS, entry.name);
    const dst = join(AGENTS_AGENTS, entry.name);
    if (entry.isFile()) {
      if (entry.name.endsWith('.md')) copyAsSkillMd(src, dst);
      else writeFileSync(dst, readFileSync(src));
    } else if (entry.isDirectory()) {
      ensureDir(dst);
      convertSkillsDir(src, dst);
    }
    agentCount += 1;
  }
}

// 4. README
const readme = `# .agents/ — Agent Skills Open Standard Mirror

Generated by \`scripts/build-agents-standard.mjs\` from \`.claude/\`.
Do NOT edit by hand; re-run the script after editing \`.claude/\` sources.

## Layout

- \`skills/<name>/SKILL.md\` — open-standard skill definitions
- \`agents/<name>.md\` — sub-agent role specs

## Conversion rules

| Claude tool | Standard verb |
|-------------|---------------|
| \`AskUserQuestion\` | \`ask_user\` |
| \`Agent(...)\` | \`delegate_subagent(...)\` |
| \`Skill(...)\` | \`invoke_skill(...)\` |
| \`Read/Write/Edit\` | \`read_file/write_file/edit_file\` |
| \`Bash/PowerShell\` | \`shell\` |
| \`Grep/Glob\` | \`search/find_files\` |
| \`TodoWrite/TaskCreate\` | \`track_tasks/create_task\` |
| \`WebSearch/WebFetch\` | \`web_search/web_fetch\` |
| \`mcp__*\` | passthrough (MCP is universal) |

Frontmatter \`allowed-tools\` rewritten with the same map.

## Consumers

CLIs that auto-discover \`.agents/skills/\` walking up from CWD to repo root:

- OpenAI Codex
- Kiro (IDE + CLI)
- Gemini CLI
- GitHub CLI (skills subcommand)

CLIs with their own conventions (NOT served by this mirror):

| CLI / IDE | Path |
|-----------|------|
| Claude Code | \`.claude/skills/\` |
| Qoder | \`.qoder/skills/\` + \`~/.qoder/skills/\` |
| Trae | \`.trae/skills/\` + \`~/.trae/skills/\` |
| Cursor | \`.cursor/\` |
| Roo Code | \`.roo/\` |
| GitHub Copilot (web) | \`.github/skills/\` |
| GitHub Copilot (VS 2026) | \`.copilot/skills/\` |

## Rebuild

\`\`\`bash
node scripts/build-agents-standard.mjs
\`\`\`

Default: NOT installed. \`.agents/\` is gitignored.
`;
writeFileSync(join(AGENTS_DIR, 'README.md'), readme);

console.log('');
console.log('Done.');
console.log(`  commands → skills:  ${commandCount}`);
console.log(`  skills (dirs):      ${skillCount}`);
console.log(`  agents:             ${agentCount}`);
console.log('');
console.log('Note: .agents/ is gitignored (opt-in mirror).');
console.log('Next: spot-check .agents/skills/maestro-ralph/SKILL.md');
