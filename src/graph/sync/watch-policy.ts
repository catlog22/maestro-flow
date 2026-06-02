import { existsSync, readFileSync } from 'node:fs';

export function watchDisabledReason(projectRoot: string): string | null {
  if (isWsl2Mount(projectRoot)) {
    return 'WSL2 /mnt/ mount detected — inotify is unreliable on Windows filesystem mounts';
  }
  if (isNetworkMount(projectRoot)) {
    return 'Network mount detected (NFS/SMB) — file watching is unreliable';
  }
  return null;
}

function isWsl2Mount(projectRoot: string): boolean {
  if (process.platform !== 'linux') return false;
  if (projectRoot.startsWith('/mnt/') && projectRoot.length > 5) {
    const drive = projectRoot[5];
    if (drive && /[a-z]/i.test(drive)) return isWsl2();
  }
  return false;
}

function isWsl2(): boolean {
  try {
    if (!existsSync('/proc/version')) return false;
    const version = readFileSync('/proc/version', 'utf-8').toLowerCase();
    return version.includes('microsoft');
  } catch {
    return false;
  }
}

function isNetworkMount(projectRoot: string): boolean {
  if (process.platform === 'win32') {
    return projectRoot.startsWith('\\\\') || /^\/\//.test(projectRoot);
  }
  return false;
}
