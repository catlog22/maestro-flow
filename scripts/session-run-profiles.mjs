import YAML from 'yaml';

export const RUN_MODE_REF = '@~/.maestro/workflows/run-mode.md';
export const RUN_MODE_LITE_REF = '@~/.maestro/workflows/run-mode-lite.md';
export const CODEX_RUN_REF = '@~/.maestro/workflows/codex-run-mode.md';
export const SESSION_MODES = ['run', 'none', 'brief', 'bootstrap', 'deprecated'];

export function parseFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const parsed = YAML.parse(match[1]);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

export function sessionMode(text, metadata = parseFrontmatter(text)) {
  return metadata?.['session-mode']
    ?? text.match(/^<!-- session-mode:\s*([^ ]+)\s*-->/m)?.[1]
    ?? null;
}

function normalizedPath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Classify lifecycle ownership without forcing child prompts to duplicate the
 * canonical protocol. The returned errors are stable diagnostics shared by
 * source and mirror lint.
 */
export function classifySessionRunProfile({ path, kind, text, metadata = parseFrontmatter(text) }) {
  const relativePath = normalizedPath(path);
  const mode = sessionMode(text, metadata);
  const hasFull = text.includes(RUN_MODE_REF);
  const hasLite = text.includes(RUN_MODE_LITE_REF);
  const errors = [];

  if (hasFull && hasLite) errors.push('references both full and lite lifecycle workflows');

  if (kind === 'skill-child') {
    const profile = hasFull || hasLite ? 'inherited-neutral' : 'child-neutral';
    return { profile, mode, hasFull, hasLite, errors };
  }

  if (kind === 'workflow') {
    if (relativePath.endsWith('/workflows/run-mode.md') || relativePath === 'workflows/run-mode.md') {
      return { profile: 'canonical-full', mode, hasFull, hasLite, errors };
    }
    if (relativePath.endsWith('/workflows/run-mode-lite.md') || relativePath === 'workflows/run-mode-lite.md') {
      return { profile: 'canonical-lite', mode, hasFull, hasLite, errors };
    }
    if (relativePath.endsWith('/workflows/task-tracking.md') || relativePath === 'workflows/task-tracking.md') {
      return { profile: 'neutral', mode, hasFull, hasLite, errors };
    }
    if (mode === 'inherited') {
      const directAssociation = typeof metadata?.prepare === 'string' && metadata.prepare.length > 0;
      if (!directAssociation && !hasFull && !hasLite) {
        errors.push('inherited workflow missing canonical Run reference');
      }
      return { profile: 'inherited-neutral', mode, hasFull, hasLite, errors };
    }
    return { profile: 'neutral', mode, hasFull, hasLite, errors };
  }

  if (mode === 'run') {
    if (!hasFull && !hasLite) errors.push('run mode missing canonical workflow reference');
    return { profile: hasLite && !hasFull ? 'lite' : 'full', mode, hasFull, hasLite, errors };
  }

  return { profile: hasFull || hasLite ? 'inherited-neutral' : 'neutral', mode, hasFull, hasLite, errors };
}
