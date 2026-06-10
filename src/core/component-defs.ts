// ---------------------------------------------------------------------------
// Component Definitions — single source of truth for CLI and Dashboard.
//
// Both `maestro install` (CLI) and the Dashboard wizard import from here.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { homedir } from 'node:os';
import { paths } from '../config/paths.js';

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
}

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
    label: 'Commands',
    description: 'Claude Code slash commands',
    sourcePath: join('.claude', 'commands'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'commands')
        : join(projectPath, '.claude', 'commands'),
    alwaysGlobal: false,
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
    label: 'Skills',
    description: 'Claude Code skills',
    sourcePath: join('.claude', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'skills')
        : join(projectPath, '.claude', 'skills'),
    alwaysGlobal: false,
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
  // Source: `.agy/` (Maestro repo mirror, generated by scripts/convert-claude-to-agy.mjs)
  // Install layout differs from the source name — `.agy/` is the repo-side mirror,
  // while the actual install target uses Antigravity's own conventions:
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
    sourcePath: join('.agy', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.gemini', 'antigravity-cli', 'skills')
        : join(projectPath, '.agents', 'skills'),
    alwaysGlobal: false,
  },
  {
    id: 'agy-agents',
    label: 'Agy Sub-Agents',
    description: 'Antigravity sub-agent definitions (for define_subagent)',
    sourcePath: join('.agy', 'agents'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.gemini', 'antigravity-cli', 'agents')
        : join(projectPath, '.agents', 'agents'),
    alwaysGlobal: false,
  },
  // ---------------------------------------------------------------------------
  // Open-standard agent assets (.agents/)
  //
  // Source: `.agents/skills/` and `.agents/agents/` — neutral mirror with
  // Claude-specific tool tokens neutralized. Generated by
  // `scripts/build-agents-standard.mjs`. Auto-discovered by Codex, Kiro,
  // Gemini CLI, GitHub CLI, Cursor, Qoder, Trae, Roo, and other .agents/-aware
  // tools. For IDE-specific install, symlink or copy from .agents/ manually.
  // ---------------------------------------------------------------------------
  {
    id: 'agents-standard-skills',
    label: 'Agent Skills — Open Standard',
    description: 'Open-standard .agents/skills/ — portable across all .agents/-aware CLIs and IDEs',
    sourcePath: join('.agents', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.agents', 'skills')
        : join(projectPath, '.agents', 'skills'),
    alwaysGlobal: false,
  },
  {
    id: 'agents-standard-agents',
    label: 'Agent Sub-Agents — Open Standard',
    description: 'Open-standard .agents/agents/ for sub-agent role definitions',
    sourcePath: join('.agents', 'agents'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.agents', 'agents')
        : join(projectPath, '.agents', 'agents'),
    alwaysGlobal: false,
  },
];
