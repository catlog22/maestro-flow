import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const MAX_FILE_SIZE = 1_048_576; // 1 MB

export interface HashFileOptions {
  /** 将 hex 摘要截断到指定字符数；省略则返回完整摘要。 */
  truncate?: number;
}

/**
 * 共享的底层文件哈希 — 单一 SHA-256 实现，被 content-hash（完整摘要）与
 * kg/sync/incremental-sync（截断摘要）两处复用。读取错误时抛出，由调用方
 * 各自包裹以保留其错误/大小契约。
 */
export function hashFile(absolutePath: string, options?: HashFileOptions): string {
  const content = readFileSync(absolutePath);
  const hex = createHash('sha256').update(content).digest('hex');
  return options?.truncate ? hex.substring(0, options.truncate) : hex;
}

export function computeFileHash(absolutePath: string): string | null {
  try {
    const stat = statSync(absolutePath);
    if (stat.size > MAX_FILE_SIZE) return null;
    return hashFile(absolutePath);
  } catch {
    return null;
  }
}

export function computeFileHashes(
  files: Array<{ absolutePath: string; relPath: string }>,
): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const file of files) {
    const hash = computeFileHash(file.absolutePath);
    if (hash) hashes.set(file.relPath, hash);
  }
  return hashes;
}

export function isFileTooLarge(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).size > MAX_FILE_SIZE;
  } catch {
    return false;
  }
}
