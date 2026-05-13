// Copyright 2024 Paul Bakaus (https://github.com/pbakaus/impeccable)
// Licensed under the Apache License, Version 2.0
// Modifications: Converted to TypeScript, adapted for maestro CLI architecture.

import fs from 'node:fs';
import path from 'node:path';

export const IMPECCABLE_DIR = '.workflow/impeccable';
export const LIVE_DIR = 'live';
export const CRITIQUE_DIR = 'critique';

export function getImpeccableDir(cwd = process.cwd()): string {
  return path.join(cwd, IMPECCABLE_DIR);
}

export function getDesignSidecarPath(cwd = process.cwd()): string {
  return path.join(getImpeccableDir(cwd), 'design.json');
}

export function getDesignSidecarCandidates(cwd = process.cwd(), contextDir = cwd): string[] {
  const candidates = [
    getDesignSidecarPath(cwd),
    path.join(cwd, 'DESIGN.json'),
  ];
  const contextLegacy = path.join(contextDir, 'DESIGN.json');
  if (!candidates.includes(contextLegacy)) candidates.push(contextLegacy);
  return candidates;
}

export function resolveDesignSidecarPath(cwd = process.cwd(), contextDir = cwd): string | null {
  return firstExisting(getDesignSidecarCandidates(cwd, contextDir));
}

export function getLiveDir(cwd = process.cwd()): string {
  return path.join(getImpeccableDir(cwd), LIVE_DIR);
}

export function getLiveConfigPath(cwd = process.cwd()): string {
  return path.join(getLiveDir(cwd), 'config.json');
}

export function getLegacyLiveConfigPath(scriptsDir: string): string {
  return path.join(scriptsDir, 'config.json');
}

export interface LiveServerInfo {
  pid: number;
  port: number;
  token: string;
}

export function resolveLiveConfigPath(opts: {
  cwd?: string;
  scriptsDir?: string;
  env?: Record<string, string | undefined>;
} = {}): string | null {
  const { cwd = process.cwd(), scriptsDir, env = process.env as Record<string, string | undefined> } = opts;
  if (env.IMPECCABLE_LIVE_CONFIG && env.IMPECCABLE_LIVE_CONFIG.trim()) {
    const configured = env.IMPECCABLE_LIVE_CONFIG.trim();
    return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured);
  }
  const primary = getLiveConfigPath(cwd);
  if (fs.existsSync(primary)) return primary;
  if (scriptsDir) {
    const legacy = getLegacyLiveConfigPath(scriptsDir);
    if (fs.existsSync(legacy)) return legacy;
  }
  return primary;
}

export function getLiveServerPath(cwd = process.cwd()): string {
  return path.join(getLiveDir(cwd), 'server.json');
}

export function getLegacyLiveServerPath(cwd = process.cwd()): string {
  return path.join(cwd, '.impeccable-live.json');
}

export function readLiveServerInfo(cwd = process.cwd()): { info: LiveServerInfo; path: string } | null {
  for (const filePath of [getLiveServerPath(cwd), getLegacyLiveServerPath(cwd)]) {
    try {
      return { info: JSON.parse(fs.readFileSync(filePath, 'utf-8')), path: filePath };
    } catch {
      /* try next */
    }
  }
  return null;
}

export function writeLiveServerInfo(cwd = process.cwd(), info: LiveServerInfo): string {
  const filePath = getLiveServerPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(info));
  return filePath;
}

export function removeLiveServerInfo(cwd = process.cwd()): void {
  for (const filePath of [getLiveServerPath(cwd), getLegacyLiveServerPath(cwd)]) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

export function getLiveSessionsDir(cwd = process.cwd()): string {
  return path.join(getLiveDir(cwd), 'sessions');
}

export function getLegacyLiveSessionsDir(cwd = process.cwd()): string {
  return path.join(cwd, '.impeccable-live', 'sessions');
}

export function getLiveAnnotationsDir(cwd = process.cwd()): string {
  return path.join(getLiveDir(cwd), 'annotations');
}

export function getCritiqueDir(cwd = process.cwd()): string {
  return path.join(getImpeccableDir(cwd), CRITIQUE_DIR);
}

export function getLegacyLiveAnnotationsDir(cwd = process.cwd()): string {
  return path.join(cwd, '.impeccable-live', 'annotations');
}

function firstExisting(paths: string[]): string | null {
  return paths.find((filePath) => fs.existsSync(filePath)) || null;
}
