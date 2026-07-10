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
   * If true, this component is always installed and cannot be deselected.
   * Core infrastructure components (workflows, templates, chains, etc.) should be mandatory.
   */
  mandatory?: boolean;
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
  /**
   * Target platform for this component. Used by TUI to group and filter components.
   * 'shared' = always visible regardless of platform selection.
   * undefined = treated as 'shared' for backward compat.
   */
  platform?: string;
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
    mandatory: true,
    platform: 'shared',
  },
  {
    id: 'templates',
    label: 'Templates',
    description: 'Prompt & task templates (~/.maestro/templates/)',
    sourcePath: 'templates',
    target: () => join(paths.home, 'templates'),
    alwaysGlobal: true,
    mandatory: true,
    platform: 'shared',
  },
  {
    id: 'chains',
    label: 'Chains',
    description: 'Coordinate chain graphs (~/.maestro/chains/)',
    sourcePath: 'chains',
    target: () => join(paths.home, 'chains'),
    alwaysGlobal: true,
    mandatory: true,
    platform: 'shared',
  },
  {
    id: 'overlays',
    label: 'Overlays',
    description: 'Command overlay packs (~/.maestro/overlays/_shipped/)',
    sourcePath: join('overlays', '_shipped'),
    target: () => join(paths.home, 'overlays', '_shipped'),
    alwaysGlobal: true,
    mandatory: true,
    platform: 'shared',
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
    mandatory: true,
    category: 'commands',
    platform: 'claude',
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
    platform: 'claude',
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
    platform: 'claude',
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
    mandatory: true,
    platform: 'claude',
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
    mandatory: true,
    category: 'skills',
    platform: 'claude',
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
    mandatory: true,
    category: 'skills',
    platform: 'claude',
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
    mandatory: true,
    inject: true,
    platform: 'claude',
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
    platform: 'codex',
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
    platform: 'claude',
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
    platform: 'codex',
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
    platform: 'codex',
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
    platform: 'codex',
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
    platform: 'agy',
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
    platform: 'agy',
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
    platform: 'agy',
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
    platform: 'agy',
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
    id: 'agents-standard-md-chinese',
    label: 'Chinese Response (Agents Standard)',
    description: 'Chinese response guidelines → .agents/AGENTS.md',
    sourcePath: join('workflows', 'chinese-response.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.agents', 'AGENTS.md')
        : join(projectPath, '.agents', 'AGENTS.md'),
    alwaysGlobal: false,
    inject: true,
    section: 'chinese',
    platform: 'agents-standard',
  },
  {
    id: 'agents-standard-context',
    label: 'Agent Context (AGENTS.md)',
    description: 'Open-standard .agents/ project instructions',
    sourcePath: join('workflows', 'codex-instructions.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.agents', 'AGENTS.md')
        : join(projectPath, '.agents', 'AGENTS.md'),
    alwaysGlobal: false,
    inject: true,
    platform: 'agents-standard',
  },
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
    platform: 'agents-standard',
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
    platform: 'agents-standard',
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
    platform: 'claude',
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
    platform: 'claude',
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
    platform: 'claude',
    defaultSelected: false,
    fileFilter: (name) => META_SKILL_NAMES.has(name),
  },
];

// ---------------------------------------------------------------------------
// Additional platform definitions — .agents/-standard compatible platforms
//
// Each entry generates context + chinese + skills + agents components that
// install to the platform's own config directory using the same converters
// as agents-standard.
// ---------------------------------------------------------------------------

export interface PlatformRegistryEntry {
  id: string;
  label: string;
  description: string;
  /** Config directory name relative to home or project (e.g. '.cursor') */
  configDir: string;
  /** Context file name (default: 'AGENTS.md') */
  contextFile?: string;
  /** Global config directory name when different from configDir (e.g. agy uses .gemini) */
  globalConfigDir?: string;
}

export const EXTRA_PLATFORMS: PlatformRegistryEntry[] = [
  { id: 'cursor',          label: 'Cursor',             description: 'Cursor AI IDE',            configDir: '.cursor' },
  { id: 'opencode',        label: 'OpenCode',           description: 'OpenCode CLI',             configDir: '.opencode' },
  { id: 'kiro',            label: 'Kiro',               description: 'AWS Kiro IDE',             configDir: '.kiro' },
  { id: 'kilo',            label: 'Kilo Code',          description: 'Kilo Code IDE',            configDir: '.kilocode' },
  { id: 'copilot',         label: 'GitHub Copilot',     description: 'GitHub Copilot agent',     configDir: '.github', contextFile: 'copilot-instructions.md' },
  { id: 'devin',           label: 'Devin',              description: 'Cognition Devin',          configDir: '.devin' },
  { id: 'qoder',           label: 'Qoder',              description: 'Qoder CLI',                configDir: '.qoder' },
  { id: 'codebuddy',       label: 'CodeBuddy',          description: 'CodeBuddy IDE',            configDir: '.codebuddy' },
  { id: 'droid',           label: 'Droid',              description: 'Factory Droid',            configDir: '.factory' },
  { id: 'pi',              label: 'Pi Agent',           description: 'Pi Agent CLI',             configDir: '.pi' },
  { id: 'trae',            label: 'Trae',               description: 'Trae AI IDE',              configDir: '.trae' },
  { id: 'roo',             label: 'Roo Code',           description: 'Roo Code IDE',             configDir: '.roo' },
  { id: 'aider-desk',      label: 'AiderDesk',          description: 'AiderDesk Agent',          configDir: '.aider-desk' },
  { id: 'amp',             label: 'Amp',                description: 'Amp Agent',                configDir: '.amp' },
  { id: 'antigravity',     label: 'Antigravity',        description: 'Antigravity Agent',        configDir: '.antigravity' },
  { id: 'antigravity-cli', label: 'Antigravity CLI',    description: 'Antigravity CLI Agent',    configDir: '.antigravity-cli' },
  { id: 'astrbot',         label: 'AstrBot',            description: 'AstrBot Agent',            configDir: '.astrbot' },
  { id: 'autohand-code',   label: 'Autohand Code CLI',  description: 'Autohand Code CLI Agent',  configDir: '.autohand', globalConfigDir: '.autohand' },
  { id: 'augment',         label: 'Augment',            description: 'Augment Agent',            configDir: '.augment' },
  { id: 'bob',             label: 'IBM Bob',            description: 'IBM Bob Agent',            configDir: '.bob' },
  { id: 'cline',           label: 'Cline',              description: 'Cline Agent',              configDir: '.cline' },
  { id: 'codearts-agent',  label: 'CodeArts Agent',     description: 'CodeArts Agent Agent',     configDir: '.codeartsdoer' },
  { id: 'codemaker',       label: 'Codemaker',          description: 'Codemaker Agent',          configDir: '.codemaker' },
  { id: 'codestudio',      label: 'Code Studio',        description: 'Code Studio Agent',        configDir: '.codestudio' },
  { id: 'command-code',    label: 'Command Code',       description: 'Command Code Agent',       configDir: '.commandcode' },
  { id: 'continue',        label: 'Continue',           description: 'Continue Agent',           configDir: '.continue' },
  { id: 'cortex',          label: 'Cortex Code',        description: 'Cortex Code Agent',        configDir: '.cortex' },
  { id: 'crush',           label: 'Crush',              description: 'Crush Agent',              configDir: '.crush' },
  { id: 'deepagents',      label: 'Deep Agents',        description: 'Deep Agents Agent',        configDir: '.deepagents' },
  { id: 'dexto',           label: 'Dexto',              description: 'Dexto Agent',              configDir: '.dexto' },
  { id: 'eve',             label: 'Eve',                description: 'Eve Agent',                configDir: 'agent' },
  { id: 'firebender',      label: 'Firebender',         description: 'Firebender Agent',         configDir: '.firebender' },
  { id: 'forgecode',       label: 'ForgeCode',          description: 'ForgeCode Agent',          configDir: '.forge' },
  { id: 'goose',           label: 'Goose',              description: 'Goose Agent',              configDir: '.goose' },
  { id: 'hermes-agent',    label: 'Hermes Agent',       description: 'Hermes Agent Agent',       configDir: '.hermes', globalConfigDir: '.hermes' },
  { id: 'inference-sh',    label: 'inference.sh',       description: 'inference.sh Agent',       configDir: '.inferencesh' },
  { id: 'jazz',            label: 'Jazz',               description: 'Jazz Agent',               configDir: '.jazz' },
  { id: 'junie',           label: 'Junie',              description: 'Junie Agent',              configDir: '.junie' },
  { id: 'iflow-cli',       label: 'iFlow CLI',          description: 'iFlow CLI Agent',          configDir: '.iflow' },
  { id: 'kimi-code-cli',   label: 'Kimi Code CLI',      description: 'Kimi Code CLI Agent',      configDir: '.kimi-code-cli' },
  { id: 'kode',            label: 'Kode',               description: 'Kode Agent',               configDir: '.kode' },
  { id: 'lingma',          label: 'Lingma',             description: 'Lingma Agent',             configDir: '.lingma' },
  { id: 'loaf',            label: 'Loaf',               description: 'Loaf Agent',               configDir: '.loaf' },
  { id: 'mcpjam',          label: 'MCPJam',             description: 'MCPJam Agent',             configDir: '.mcpjam' },
  { id: 'mistral-vibe',    label: 'Mistral Vibe',       description: 'Mistral Vibe Agent',       configDir: '.vibe', globalConfigDir: '.vibe' },
  { id: 'moxby',           label: 'Moxby',              description: 'Moxby Agent',              configDir: '.moxby' },
  { id: 'mux',             label: 'Mux',                description: 'Mux Agent',                configDir: '.mux' },
  { id: 'openhands',       label: 'OpenHands',          description: 'OpenHands Agent',          configDir: '.openhands' },
  { id: 'ona',             label: 'Ona',                description: 'Ona Agent',                configDir: '.ona' },
  { id: 'qoder-cn',        label: 'Qoder CN',           description: 'Qoder CN Agent',           configDir: '.qoder' },
  { id: 'qwen-code',       label: 'Qwen Code',          description: 'Qwen Code Agent',          configDir: '.qwen' },
  { id: 'replit',          label: 'Replit',             description: 'Replit Agent',             configDir: '.replit' },
  { id: 'reasonix',        label: 'Reasonix',           description: 'Reasonix Agent',           configDir: '.reasonix' },
  { id: 'rovodev',         label: 'Rovo Dev',           description: 'Rovo Dev Agent',           configDir: '.rovodev' },
  { id: 'tabnine-cli',     label: 'Tabnine CLI',        description: 'Tabnine CLI Agent',        configDir: '.tabnine' },
  { id: 'terramind',       label: 'Terramind',          description: 'Terramind Agent',          configDir: '.terramind' },
  { id: 'tinycloud',       label: 'Tinycloud',          description: 'Tinycloud Agent',          configDir: '.tinycloud' },
  { id: 'trae-cn',         label: 'Trae CN',            description: 'Trae CN Agent',            configDir: '.trae' },
  { id: 'warp',            label: 'Warp',               description: 'Warp Agent',               configDir: '.warp' },
  { id: 'windsurf',        label: 'Windsurf',           description: 'Windsurf Agent',           configDir: '.windsurf' },
  { id: 'zed',             label: 'Zed',                description: 'Zed Agent',                configDir: '.zed' },
  { id: 'zencoder',        label: 'Zencoder',           description: 'Zencoder Agent',           configDir: '.zencoder' },
  { id: 'zenflow',         label: 'Zenflow',            description: 'Zenflow Agent',            configDir: '.zencoder' },
  { id: 'neovate',         label: 'Neovate',            description: 'Neovate Agent',            configDir: '.neovate' },
  { id: 'pochi',           label: 'Pochi',              description: 'Pochi Agent',              configDir: '.pochi' },
  { id: 'promptscript',    label: 'PromptScript',       description: 'PromptScript Agent',       configDir: '.promptscript' },
  { id: 'adal',            label: 'AdaL',               description: 'AdaL Agent',               configDir: '.adal' },
];

function makeExtraPlatformDefs(entry: PlatformRegistryEntry): ComponentDef[] {
  const { id, configDir, contextFile = 'AGENTS.md' } = entry;
  const globalDir = entry.globalConfigDir ?? configDir;

  return [
    {
      id: `${id}-context`,
      label: `${entry.label} Context`,
      description: `${entry.label} project instructions (${contextFile})`,
      sourcePath: join('workflows', 'codex-instructions.md'),
      target: (mode, projectPath) =>
        mode === 'global'
          ? join(homedir(), globalDir, contextFile)
          : join(projectPath, configDir, contextFile),
      alwaysGlobal: false,
      inject: true,
      platform: id,
    },
    {
      id: `${id}-md-chinese`,
      label: `Chinese Response (${entry.label})`,
      description: `Chinese response guidelines → ${contextFile}`,
      sourcePath: join('workflows', 'chinese-response.md'),
      target: (mode, projectPath) =>
        mode === 'global'
          ? join(homedir(), globalDir, contextFile)
          : join(projectPath, configDir, contextFile),
      alwaysGlobal: false,
      inject: true,
      section: 'chinese',
      platform: id,
    },
    {
      id: `${id}-skills`,
      label: `${entry.label} Skills`,
      description: `${entry.label} skill definitions`,
      sourcePath: join('.claude', 'commands'),
      sourceCountDir: join('.claude', 'commands'),
      target: (mode, projectPath) =>
        mode === 'global'
          ? join(homedir(), globalDir, 'skills')
          : join(projectPath, configDir, 'skills'),
      alwaysGlobal: false,
      platform: id,
      build: (claudeDir, targetDir) => {
        if (id === 'eve') {
          const { buildEveSkills } = require('./skill-converter.js');
          return buildEveSkills(claudeDir, targetDir);
        }
        const { buildAgentsStandardSkills } = require('./skill-converter.js');
        return buildAgentsStandardSkills(claudeDir, targetDir);
      },
    },
    {
      id: `${id}-agents`,
      label: `${entry.label} Agents`,
      description: `${entry.label} agent definitions`,
      sourcePath: join('.claude', 'agents'),
      sourceCountDir: join('.claude', 'agents'),
      target: (mode, projectPath) =>
        mode === 'global'
          ? join(homedir(), globalDir, 'agents')
          : join(projectPath, configDir, 'agents'),
      alwaysGlobal: false,
      platform: id,
      build: (claudeDir, targetDir) => {
        if (id === 'eve') {
          const { buildEveAgents } = require('./skill-converter.js');
          return buildEveAgents(claudeDir, targetDir);
        }
        const { buildAgentsStandardAgents } = require('./skill-converter.js');
        return buildAgentsStandardAgents(claudeDir, targetDir);
      },
    },
  ];
}

for (const entry of EXTRA_PLATFORMS) {
  COMPONENT_DEFS.push(...makeExtraPlatformDefs(entry));
}

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

/**
 * Migrate old IDs + merge new default-selected components.
 * Used during `maestro update` reinstall so new-version components
 * with `defaultSelected !== false` are automatically included.
 */
export function mergeNewDefaults(existingIds: string[]): string[] {
  const migrated = migrateComponentIds(existingIds);
  const migratedSet = new Set(migrated);
  for (const def of COMPONENT_DEFS) {
    if (!migratedSet.has(def.id) && def.defaultSelected !== false) {
      migrated.push(def.id);
    }
  }
  return migrated;
}
