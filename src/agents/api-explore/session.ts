import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExploreResult } from './runner.js';

export interface ExploreSession {
  id: string;
  startedAt: string;
  cwd: string;
  prompts: string[];
  endpoints: string[];
  totalJobs: number;
  concurrency: number;
  maxTurns: number;
  durationMs: number;
  results: ExploreResult[];
  moa?: {
    preset: string;
    referenceEndpoints: string[];
    results: Array<{
      prompt: string;
      degraded: boolean;
      content: string;
      referenceSummaries: Array<{
        endpointName: string;
        model: string;
        ok: boolean;
        error?: string;
      }>;
    }>;
  };
}

function exploreDir(cwd: string): string {
  return join(cwd, '.workflow', 'explore');
}

export function generateSessionId(): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const rand = Math.random().toString(36).slice(2, 6);
  return `exp-${ts}-${rand}`;
}

export function saveSession(session: ExploreSession, outputDir?: string): string {
  const dir = outputDir ?? exploreDir(session.cwd);
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${session.id}.json`);
  writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return filePath;
}

export function loadSession(cwd: string, sessionId: string, outputDir?: string): ExploreSession | null {
  const dir = outputDir ?? exploreDir(cwd);
  const filePath = join(dir, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ExploreSession;
  } catch {
    return null;
  }
}

export function listSessions(cwd: string, outputDir?: string): Array<{ id: string; startedAt: string; prompts: number; durationMs: number }> {
  const dir = outputDir ?? exploreDir(cwd);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.startsWith('exp-') && f.endsWith('.json'))
    .map(f => {
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as ExploreSession;
        return { id: raw.id, startedAt: raw.startedAt, prompts: raw.prompts.length, durationMs: raw.durationMs };
      } catch {
        return null;
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
