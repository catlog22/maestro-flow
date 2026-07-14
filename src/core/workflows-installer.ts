import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../config/paths.js';

export interface WorkflowsInstallResult {
  sourceDir: string;
  targetDir: string;
  filesInstalled: number;
  dirsCreated: number;
}

function copyDirectory(sourceDir: string, targetDir: string): { files: number; dirs: number } {
  let files = 0;
  let dirs = 0;
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
    dirs++;
  }
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      const nested = copyDirectory(source, target);
      files += nested.files;
      dirs += nested.dirs;
    } else if (entry.isFile()) {
      copyFileSync(source, target);
      files++;
    }
  }
  return { files, dirs };
}

export function installWorkflowsOnly(
  packageRoot: string,
  targetDir = paths.workflows,
): WorkflowsInstallResult {
  const sourceDir = join(packageRoot, 'workflows');
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`Maestro workflows directory not found: ${sourceDir}`);
  }
  const copied = copyDirectory(sourceDir, targetDir);
  return {
    sourceDir,
    targetDir,
    filesInstalled: copied.files,
    dirsCreated: copied.dirs,
  };
}

export function installPrepareFiles(
  packageRoot: string,
  targetDir = paths.prepare,
): WorkflowsInstallResult {
  const sourceDir = join(packageRoot, 'prepare');
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { sourceDir, targetDir, filesInstalled: 0, dirsCreated: 0 };
  }
  const copied = copyDirectory(sourceDir, targetDir);
  return { sourceDir, targetDir, filesInstalled: copied.files, dirsCreated: copied.dirs };
}

export function installRefFiles(
  packageRoot: string,
  targetDir = paths.ref,
): WorkflowsInstallResult {
  const sourceDir = join(packageRoot, 'ref');
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { sourceDir, targetDir, filesInstalled: 0, dirsCreated: 0 };
  }
  const copied = copyDirectory(sourceDir, targetDir);
  return { sourceDir, targetDir, filesInstalled: copied.files, dirsCreated: copied.dirs };
}

export function installAllStepContent(packageRoot: string): {
  workflows: WorkflowsInstallResult;
  prepare: WorkflowsInstallResult;
  ref: WorkflowsInstallResult;
} {
  return {
    workflows: installWorkflowsOnly(packageRoot),
    prepare: installPrepareFiles(packageRoot),
    ref: installRefFiles(packageRoot),
  };
}
