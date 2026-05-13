import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HEADER_SCAN_BYTES = 300;
const HEADER_MARKERS = [
  /@generated\b/i,
  /\bGENERATED\s+FILE\b/,
  /\bAUTO-?GENERATED\b/i,
  /\bDO\s+NOT\s+EDIT\b/i,
];

export function isGeneratedFile(filePath: string, options: { cwd?: string } = {}): boolean {
  const cwd = options.cwd || process.cwd();
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

  if (isGitIgnored(absPath, cwd)) return true;
  if (hasGeneratedHeader(absPath)) return true;
  return false;
}

function isGitIgnored(absPath: string, cwd: string): boolean {
  try {
    execSync(`git check-ignore --quiet ${JSON.stringify(absPath)}`, {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function hasGeneratedHeader(absPath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(HEADER_SCAN_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEADER_SCAN_BYTES, 0);
    const head = buf.slice(0, bytesRead).toString('utf-8');
    return HEADER_MARKERS.some((re) => re.test(head));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}
