// ---------------------------------------------------------------------------
// Component Definitions — single source of truth for CLI and Dashboard.
//
// Both `maestro install` (CLI) and the Dashboard wizard import from here.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { paths } from '../config/paths.js';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentDef {
  id: string;
  label: string;
  description: string;
  sourcePath: string;
  /** Resolve target path based on mode and project path */
  target: (mode: 'global' | 'project', projectPath: string) => string;
  /** Always installs to global location regardless of mode */
  alwaysGlobal: boolean;
  /** Use tag injection instead of file copy (for doc files like CLAUDE.md) */
  inject?: boolean;
  /** Section name for tag injection (default: "core") */
  section?: string;
  /**
   * Default selection on a fresh install (no prior manifest).
   * Omit (undefined) = true (selected by default — backward compat).
   * `false` = opt-in only; user must explicitly tick to install.
   */
  defaultSelected?: boolean;
  /**
   * Build callback — when present, the install pipeline calls this instead of
   * copyRecursive. Receives the `.claude` directory (source of truth) and the
   * resolved target directory. Returns file count for stats tracking.
   */
  build?: (claudeDir: string, targetDir: string) => { files: number };
  /**
   * Override directory used by `scanComponents` to count source files.
   * When omitted, `sourcePath` is used as before (backward compat).
   */
  sourceCountDir?: string;
  /**
   * Filter for top-level entries in the source directory.
   * When present, only entries where this returns true are copied/counted.
   * Receives the entry name (filename or directory name).
   */
  fileFilter?: (name: string) => boolean;
  /**
   * UI grouping category for ComponentGrid.
   * Components sharing the same category display under a shared header.
   */
  category?: string;
}

// ---------------------------------------------------------------------------
// Skill registries — built-in vs optional extras
// ---------------------------------------------------------------------------

const BUILTIN_TEAM_SKILLS = new Set([
  'team-adversarial-swarm', 'team-coordinate', 'team-executor',
  'team-lifecycle-v4', 'team-quality-assurance', 'team-review',
  'team-swarm', 'team-tech-debt', 'team-testing',
]);

interface OptionalSkillEntry {
  name: string;
  label: string;
  description: string;
}

const EXTRA_TEAM_SKILLS: OptionalSkillEntry[] = [
  { name: 'team-arch-opt', label: 'Team Arch Opt', description: 'Architecture optimization' },
  { name: 'team-brainstorm', label: 'Team Brainstorm', description: 'Multi-role brainstorming' },
  { name: 'team-designer', label: 'Team Designer', description: 'Team skill scaffolding' },
  { name: 'team-frontend', label: 'Team Frontend', description: 'Frontend development' },
  { name: 'team-frontend-debug', label: 'Team Frontend Debug', description: 'Chrome DevTools debugging' },
  { name: 'team-interactive-craft', label: 'Team Interactive', description: 'Interactive components' },
  { name: 'team-issue', label: 'Team Issue', description: 'Issue resolution pipeline' },
  { name: 'team-motion-design', label: 'Team Motion', description: 'Animation & motion design' },
  { name: 'team-perf-opt', label: 'Team Perf Opt', description: 'Performance optimization' },
  { name: 'team-planex', label: 'Team Planex', description: 'Plan-and-execute pipeline' },
  { name: 'team-roadmap-dev', label: 'Team Roadmap', description: 'Roadmap-driven development' },
  { name: 'team-ui-polish', label: 'Team UI Polish', description: 'UI design quality fixes' },
  { name: 'team-uidesign', label: 'Team UI Design', description: 'Design tokens & audit' },
  { name: 'team-ultra-analyze', label: 'Team Ultra Analyze', description: 'Deep collaborative analysis' },
  { name: 'team-ux-improve', label: 'Team UX Improve', description: 'UX interaction fixes' },
  { name: 'team-visual-a11y', label: 'Team Visual A11y', description: 'Visual accessibility QA' },
];

const SCHOLAR_SKILLS: OptionalSkillEntry[] = [
  { name: 'scholar-anti-ai-writing', label: 'Anti-AI Writing', description: 'Remove AI writing patterns' },
  { name: 'scholar-citation-verify', label: 'Citation Verify', description: 'Citation verification' },
  { name: 'scholar-experiment', label: 'Experiment Analysis', description: 'Experimental results analysis' },
  { name: 'scholar-ideation', label: 'Research Ideation', description: 'Research gap analysis & planning' },
  { name: 'scholar-latex-organizer', label: 'LaTeX Organizer', description: 'LaTeX template cleanup' },
  { name: 'scholar-publish', label: 'Scholar Publish', description: 'Post-acceptance preparation' },
  { name: 'scholar-rebuttal-pro', label: 'Rebuttal Pro', description: 'Review response with CLI analysis' },
  { name: 'scholar-review', label: 'Scholar Review', description: 'Paper review & rebuttal' },
  { name: 'scholar-thesis-docx', label: 'Thesis DOCX', description: 'Thesis Word formatting' },
  { name: 'scholar-writing', label: 'Scholar Writing', description: 'End-to-end paper writing' },
];

const META_SKILLS: OptionalSkillEntry[] = [
  { name: 'skill-generator', label: 'Skill Generator', description: 'Create new Claude Code skills' },
  { name: 'skill-simplify', label: 'Skill Simplify', description: 'Simplify skills with integrity check' },
  { name: 'skill-tuning', label: 'Skill Tuning', description: 'Diagnose and optimize skill issues' },
  { name: 'prompt-generator', label: 'Prompt Generator', description: 'Generate/convert prompt files' },
  { name: 'delegation-check', label: 'Delegation Check', description: 'Check delegation prompt contracts' },
];

const NON_CORE_SKILL_NAMES = new Set([
  ...BUILTIN_TEAM_SKILLS,
  ...EXTRA_TEAM_SKILLS.map((s) => s.name),
  ...SCHOLAR_SKILLS.map((s) => s.name),
  ...META_SKILLS.map((s) => s.name),
]);

const EXTRA_TEAM_SKILL_NAMES = new Set(EXTRA_TEAM_SKILLS.map((s) => s.name));
const SCHOLAR_SKILL_NAMES = new Set(SCHOLAR_SKILLS.map((s) => s.name));
const META_SKILL_NAMES = new Set(META_SKILLS.map((s) => s.name));

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const COMPONENT_DEFS: ComponentDef[] = [
  {
    id: 'workflows',
    label: 'Workflows',
    description: 'Workflow definitions (~/.maestro/workflows/)',
    sourcePath: 'workflows',
    target: () => join(paths.home, 'workflows'),
    alwaysGlobal: true,
  },
  {
    id: 'templates',
    label: 'Templates',
    description: 'Prompt & task templates (~/.maestro/templates/)',
    sourcePath: 'templates',
    target: () => join(paths.home, 'templates'),
    alwaysGlobal: true,
  },
  {
    id: 'chains',
    label: 'Chains',
    description: 'Coordinate chain graphs (~/.maestro/chains/)',
    sourcePath: 'chains',
    target: () => join(paths.home, 'chains'),
    alwaysGlobal: true,
  },
  {
    id: 'overlays',
    label: 'Overlays',
    description: 'Command overlay packs (~/.maestro/overlays/_shipped/)',
    sourcePath: join('overlays', '_shipped'),
    target: () => join(paths.home, 'overlays', '_shipped'),
    alwaysGlobal: true,
  },
  {
    id: 'commands',
    label: 'Commands (Core)',
    description: 'Core maestro/manage/spec/quality commands',
    sourcePath: join('.claude', 'commands'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'commands')
        : join(projectPath, '.claude', 'commands'),
    alwaysGlobal: false,
    category: 'commands',
    fileFilter: (name) => !name.startsWith('odyssey-') && !name.startsWith('learn-'),
  },
  {
    id: 'commands-odyssey',
    label: 'Odyssey Commands',
    description: 'Long-running cycles: debug, improve, planex, review, UI',
    sourcePath: join('.claude', 'commands'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'commands')
        : join(projectPath, '.claude', 'commands'),
    alwaysGlobal: false,
    category: 'commands',
    defaultSelected: false,
    fileFilter: (name) => name.startsWith('odyssey-'),
  },
  {
    id: 'commands-learn',
    label: 'Learn Commands',
    description: 'Knowledge extraction: decompose, follow, investigate',
    sourcePath: join('.claude', 'commands'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'commands')
        : join(projectPath, '.claude', 'commands'),
    alwaysGlobal: false,
    category: 'commands',
    defaultSelected: false,
    fileFilter: (name) => name.startsWith('learn-'),
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Agent definitions',
    sourcePath: join('.claude', 'agents'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'agents')
        : join(projectPath, '.claude', 'agents'),
    alwaysGlobal: false,
  },
  {
    id: 'skills',
    label: 'Skills (Core)',
    description: 'Core workflow and utility skills',
    sourcePath: join('.claude', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'skills')
        : join(projectPath, '.claude', 'skills'),
    alwaysGlobal: false,
    category: 'skills',
    fileFilter: (name) => !NON_CORE_SKILL_NAMES.has(name),
  },
  {
    id: 'skills-team',
    label: 'Team Skills (Built-in)',
    description: 'Built-in team skills (coordinate, review, testing, etc.)',
    sourcePath: join('.claude', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'skills')
        : join(projectPath, '.claude', 'skills'),
    alwaysGlobal: false,
    category: 'skills',
    fileFilter: (name) => BUILTIN_TEAM_SKILLS.has(name),
  },
  {
    id: 'claude-md',
    label: 'CLAUDE.md',
    description: 'Project instructions file',
    sourcePath: join('workflows', 'claude-instructions.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'CLAUDE.md')
        : join(projectPath, '.claude', 'CLAUDE.md'),
    alwaysGlobal: false,
    inject: true,
  },
  {
    id: 'codex-agents-md',
    label: 'Codex AGENTS.md',
    description: 'Codex project instructions file',
    sourcePath: join('workflows', 'codex-instructions.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.codex', 'AGENTS.md')
        : join(projectPath, '.codex', 'AGENTS.md'),
    alwaysGlobal: false,
    inject: true,
  },
  {
    id: 'claude-md-chinese',
    label: 'Chinese Response (Claude)',
    description: 'Chinese response guidelines → CLAUDE.md',
    sourcePath: join('workflows', 'chinese-response.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'CLAUDE.md')
        : join(projectPath, '.claude', 'CLAUDE.md'),
    alwaysGlobal: false,
    inject: true,
    section: 'chinese',
  },
  {
    id: 'codex-md-chinese',
    label: 'Chinese Response (Codex)',
    description: 'Chinese response guidelines → AGENTS.md',
    sourcePath: join('workflows', 'chinese-response.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.codex', 'AGENTS.md')
        : join(projectPath, '.codex', 'AGENTS.md'),
    alwaysGlobal: false,
    inject: true,
    section: 'chinese',
  },
  {
    id: 'codex-agents',
    label: 'Codex Agents',
    description: 'Codex agent definitions',
    sourcePath: join('.codex', 'agents'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.codex', 'agents')
        : join(projectPath, '.codex', 'agents'),
    alwaysGlobal: false,
  },
  {
    id: 'codex-skills',
    label: 'Codex Skills',
    description: 'Codex skill definitions',
    sourcePath: join('.codex', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.codex', 'skills')
        : join(projectPath, '.codex', 'skills'),
    alwaysGlobal: false,
  },
  // ---------------------------------------------------------------------------
  // Antigravity (agy) CLI assets
  // Source: `.claude/` — converted on-the-fly via skill-converter build callbacks.
  // Install layout uses Antigravity's own conventions:
  //   - Global skills/agents → ~/.gemini/antigravity-cli/{skills,agents}/
  //   - Workspace skills/agents → <project>/.agents/{skills,agents}/
  //   - Global context → ~/.gemini/GEMINI.md
  //   - Workspace context → <project>/AGENTS.md
  // ---------------------------------------------------------------------------
  {
    id: 'agy-context',
    label: 'Agy Context (GEMINI.md / AGENTS.md)',
    description: 'Antigravity workspace/global instructions',
    sourcePath: join('workflows', 'codex-instructions.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.gemini', 'GEMINI.md')
        : join(projectPath, 'AGENTS.md'),
    alwaysGlobal: false,
    inject: true,
  },
  {
    id: 'agy-md-chinese',
    label: 'Chinese Response (Agy)',
    description: 'Chinese response guidelines → GEMINI.md / AGENTS.md',
    sourcePath: join('workflows', 'chinese-response.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.gemini', 'GEMINI.md')
        : join(projectPath, 'AGENTS.md'),
    alwaysGlobal: false,
    inject: true,
    section: 'chinese',
  },
  {
    id: 'agy-skills',
    label: 'Agy Skills',
    description: 'Antigravity skills (commands become slash commands)',
    sourcePath: join('.claude', 'commands'),
    sourceCountDir: join('.claude', 'commands'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.gemini', 'antigravity-cli', 'skills')
        : join(projectPath, '.agents', 'skills'),
    alwaysGlobal: false,
    build: (claudeDir, targetDir) => {
      const { buildAgySkills } = require('./skill-converter.js');
      return buildAgySkills(claudeDir, targetDir);
    },
  },
  {
    id: 'agy-agents',
    label: 'Agy Sub-Agents',
    description: 'Antigravity sub-agent definitions (for define_subagent)',
    sourcePath: join('.claude', 'agents'),
    sourceCountDir: join('.claude', 'agents'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.gemini', 'antigravity-cli', 'agents')
        : join(projectPath, '.agents', 'agents'),
    alwaysGlobal: false,
    build: (claudeDir, targetDir) => {
      const { buildAgyAgents } = require('./skill-converter.js');
      return buildAgyAgents(claudeDir, targetDir);
    },
  },
  // ---------------------------------------------------------------------------
  // Open-standard agent assets (.agents/)
  //
  // Source: `.claude/` — converted on-the-fly via skill-converter build
  // callbacks with Claude-specific tool tokens neutralized. Auto-discovered
  // by Codex, Kiro, Gemini CLI, GitHub CLI, Cursor, Qoder, Trae, Roo, and
  // other .agents/-aware tools.
  // ---------------------------------------------------------------------------
  {
    id: 'agents-standard-skills',
    label: 'Agent Skills — Open Standard',
    description: 'Open-standard .agents/skills/ — portable across all .agents/-aware CLIs and IDEs',
    sourcePath: join('.claude', 'commands'),
    sourceCountDir: join('.claude', 'commands'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.agents', 'skills')
        : join(projectPath, '.agents', 'skills'),
    alwaysGlobal: false,
    build: (claudeDir, targetDir) => {
      const { buildAgentsStandardSkills } = require('./skill-converter.js');
      return buildAgentsStandardSkills(claudeDir, targetDir);
    },
  },
  {
    id: 'agents-standard-agents',
    label: 'Agent Sub-Agents — Open Standard',
    description: 'Open-standard .agents/agents/ for sub-agent role definitions',
    sourcePath: join('.claude', 'agents'),
    sourceCountDir: join('.claude', 'agents'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.agents', 'agents')
        : join(projectPath, '.agents', 'agents'),
    alwaysGlobal: false,
    build: (claudeDir, targetDir) => {
      const { buildAgentsStandardAgents } = require('./skill-converter.js');
      return buildAgentsStandardAgents(claudeDir, targetDir);
    },
  },
  // -------------------------------------------------------------------------
  // Optional skill packages — group bundles (use `install toggle` for individual control)
  // -------------------------------------------------------------------------
  {
    id: 'skills-extra-team',
    label: 'Extra Team Skills',
    description: `${EXTRA_TEAM_SKILLS.length} additional team skills (arch-opt, brainstorm, frontend, etc.)`,
    sourcePath: join('.claude', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'skills')
        : join(projectPath, '.claude', 'skills'),
    alwaysGlobal: false,
    category: 'skills',
    defaultSelected: false,
    fileFilter: (name) => EXTRA_TEAM_SKILL_NAMES.has(name),
  },
  {
    id: 'skills-scholar',
    label: 'Scholar Skills',
    description: `${SCHOLAR_SKILLS.length} academic writing & research skills`,
    sourcePath: join('.claude', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'skills')
        : join(projectPath, '.claude', 'skills'),
    alwaysGlobal: false,
    category: 'skills',
    defaultSelected: false,
    fileFilter: (name) => SCHOLAR_SKILL_NAMES.has(name),
  },
  {
    id: 'skills-meta',
    label: 'Meta Skills',
    description: `${META_SKILLS.length} skill tooling (generator, tuning, simplify, etc.)`,
    sourcePath: join('.claude', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'skills')
        : join(projectPath, '.claude', 'skills'),
    alwaysGlobal: false,
    category: 'skills',
    defaultSelected: false,
    fileFilter: (name) => META_SKILL_NAMES.has(name),
  },
];

// ---------------------------------------------------------------------------
// Manifest migration — map old individual skill IDs to new group bundles
// ---------------------------------------------------------------------------

const VALID_IDS = new Set(COMPONENT_DEFS.map((d) => d.id));

const LEGACY_SKILL_TO_GROUP = new Map<string, string>();
for (const s of EXTRA_TEAM_SKILLS) LEGACY_SKILL_TO_GROUP.set(s.name, 'skills-extra-team');
for (const s of SCHOLAR_SKILLS) LEGACY_SKILL_TO_GROUP.set(s.name, 'skills-scholar');
for (const s of META_SKILLS) LEGACY_SKILL_TO_GROUP.set(s.name, 'skills-meta');

export function migrateComponentIds(ids: string[]): string[] {
  const result = new Set<string>();
  for (const id of ids) {
    if (VALID_IDS.has(id)) {
      result.add(id);
    } else {
      const groupId = LEGACY_SKILL_TO_GROUP.get(id);
      if (groupId) result.add(groupId);
    }
  }
  return Array.from(result);
}
