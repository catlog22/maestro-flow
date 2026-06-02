import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const MAX_FILE_SIZE = 1_048_576; // 1 MB

export function computeFileHash(absolutePath: string): string | null {
  try {
    const stat = statSync(absolutePath);
    if (stat.size > MAX_FILE_SIZE) return null;
    const content = readFileSync(absolutePath);
    return createHash('sha256').update(content).digest('hex');
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
