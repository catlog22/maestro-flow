import fs from 'node:fs';
import path from 'node:path';
import { getCritiqueDir } from './paths.js';

const SLUG_MAX = 50;

export function slugFromTarget(resolved: string | null | undefined, { cwd = process.cwd() }: { cwd?: string } = {}): string | null {
  if (!resolved || typeof resolved !== 'string') return null;
  const trimmed = resolved.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try { url = new URL(trimmed); } catch { return null; }
    const hostPath = `${url.hostname}${url.pathname}`;
    return kebab(hostPath);
  }

  const abs = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
  let rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    rel = path.basename(abs);
  }
  if (!rel || rel === '.' || rel === '') return null;
  return kebab(rel);
}

function kebab(s: string): string | null {
  const slug = s
    .toLowerCase()
    .replace(/[/\\.]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return null;
  return slug.length <= SLUG_MAX ? slug : slug.slice(slug.length - SLUG_MAX).replace(/^-/, '');
}

export function nowFilenameStamp(date = new Date()): string {
  const iso = date.toISOString();
  return iso.replace(/[:.]/g, '-').replace(/-\d+Z$/, 'Z');
}

export interface SnapshotMeta {
  [key: string]: string | number | boolean | null | undefined;
}

export interface WriteSnapshotOptions {
  slug: string;
  meta?: SnapshotMeta;
  body: string;
  cwd?: string;
  now?: Date;
}

export function writeSnapshot(opts: WriteSnapshotOptions): string {
  const { slug, meta = {}, body, cwd = process.cwd(), now = new Date() } = opts;
  if (!slug) throw new Error('writeSnapshot requires a slug');
  const dir = getCritiqueDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = nowFilenameStamp(now);
  const filePath = path.join(dir, `${timestamp}__${slug}.md`);
  const front = serializeFrontmatter({ ...meta, timestamp, slug });
  fs.writeFileSync(filePath, `${front}\n${body.trim()}\n`, 'utf-8');
  return filePath;
}

function serializeFrontmatter(obj: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const str = typeof value === 'string' ? value : String(value);
    const needsQuotes = typeof value === 'string' && /[:#]/.test(str);
    lines.push(`${key}: ${needsQuotes ? JSON.stringify(str) : str}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function parseFrontmatter(text: string): Record<string, string | number> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string | number> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    let value: string | number = line.slice(colon + 1).trim();
    if (/^".*"$/.test(value as string)) {
      try { value = JSON.parse(value as string) as string; } catch { /* leave as-is */ }
    } else if (/^-?\d+$/.test(value as string)) {
      value = Number(value);
    }
    out[key] = value;
  }
  return out;
}

function listSnapshotsForSlug(slug: string, cwd: string): string[] {
  const dir = getCritiqueDir(cwd);
  if (!fs.existsSync(dir)) return [];
  const suffix = `__${slug}.md`;
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => path.join(dir, f));
}

export interface LatestSnapshot {
  path: string;
  body: string;
  meta: Record<string, string | number>;
}

export function readLatestSnapshot(slug: string, { cwd = process.cwd() }: { cwd?: string } = {}): LatestSnapshot | null {
  const all = listSnapshotsForSlug(slug, cwd);
  if (!all.length) return null;
  const latest = all[all.length - 1];
  const body = fs.readFileSync(latest, 'utf-8');
  return { path: latest, body, meta: parseFrontmatter(body) };
}

export function readTrend(slug: string, { limit = 5, cwd = process.cwd() }: { limit?: number; cwd?: string } = {}): Record<string, string | number>[] {
  const all = listSnapshotsForSlug(slug, cwd);
  const slice = all.slice(-limit);
  return slice.map((file) => parseFrontmatter(fs.readFileSync(file, 'utf-8')));
}
