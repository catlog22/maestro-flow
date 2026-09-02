// 落点从 .grok/AGENTS.md 迁到 .grok/rules/maestro.md 后，剥掉旧文件里的 Maestro 段。
// 用户正文保留；剥空则删除，避免 Grok 把两套指令都灌进上下文。
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hasAnyMarkers, removeAllSections } from './tag-injector.js';

export type StripLegacyGrokAgentsResult = 'stripped' | 'deleted' | 'absent' | 'untouched';

export function grokDirFromRulesMaestroPath(dest: string): string | null {
  const norm = dest.replace(/\\/g, '/');
  if (!norm.endsWith('/.grok/rules/maestro.md') && !norm.endsWith('.grok/rules/maestro.md')) {
    return null;
  }
  return dirname(dirname(dest));
}

export function legacyGrokAgentsPath(grokDir: string): string {
  return join(grokDir, 'AGENTS.md');
}

export function stripLegacyGrokAgentsMd(filePath: string): StripLegacyGrokAgentsResult {
  if (!existsSync(filePath)) return 'absent';

  const content = readFileSync(filePath, 'utf-8');
  if (!hasAnyMarkers(content)) return 'untouched';

  const cleaned = removeAllSections(content);
  if (!cleaned || cleaned.trim() === '') {
    unlinkSync(filePath);
    return 'deleted';
  }

  const next = cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`;
  writeFileSync(filePath, next, 'utf-8');
  return 'stripped';
}

export function stripLegacyGrokAgentsAtGrokDir(grokDir: string): StripLegacyGrokAgentsResult {
  return stripLegacyGrokAgentsMd(legacyGrokAgentsPath(grokDir));
}
