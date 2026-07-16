import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../config/paths.js';
import { COMPONENT_DEFS } from './component-defs.js';
import { addFile, createManifest, findManifest, saveManifest } from './manifest.js';

export interface WorkflowsInstallResult {
  sourceDir: string;
  targetDir: string;
  filesInstalled: number;
  dirsCreated: number;
  installedFiles: string[];
}

function copyDirectory(sourceDir: string, targetDir: string): { files: number; dirs: number; installedFiles: string[] } {
  let files = 0;
  let dirs = 0;
  const installedFiles: string[] = [];
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
      installedFiles.push(...nested.installedFiles);
    } else if (entry.isFile()) {
      copyFileSync(source, target);
      files++;
      installedFiles.push(target);
    }
  }
  return { files, dirs, installedFiles };
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
    installedFiles: copied.installedFiles,
  };
}

export function installPrepareFiles(
  packageRoot: string,
  targetDir = paths.prepare,
): WorkflowsInstallResult {
  const sourceDir = join(packageRoot, 'prepare');
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { sourceDir, targetDir, filesInstalled: 0, dirsCreated: 0, installedFiles: [] };
  }
  const copied = copyDirectory(sourceDir, targetDir);
  return { sourceDir, targetDir, filesInstalled: copied.files, dirsCreated: copied.dirs, installedFiles: copied.installedFiles };
}

export function installRefFiles(
  packageRoot: string,
  targetDir = paths.ref,
): WorkflowsInstallResult {
  const sourceDir = join(packageRoot, 'ref');
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { sourceDir, targetDir, filesInstalled: 0, dirsCreated: 0, installedFiles: [] };
  }
  const copied = copyDirectory(sourceDir, targetDir);
  return { sourceDir, targetDir, filesInstalled: copied.files, dirsCreated: copied.dirs, installedFiles: copied.installedFiles };
}

export function installAllStepContent(packageRoot: string): {
  workflows: WorkflowsInstallResult;
  prepare: WorkflowsInstallResult;
  ref: WorkflowsInstallResult;
} {
  const result = {
    workflows: installWorkflowsOnly(packageRoot),
    prepare: installPrepareFiles(packageRoot),
    ref: installRefFiles(packageRoot),
  };

  // This direct subcommand is intentionally overwrite-only. Record only the
  // source-relative files it just copied and merge them into prior ownership;
  // target-only files remain untouched and unowned.
  const prior = findManifest('global', paths.home);
  const selectedIds = new Set(prior?.selectedComponentIds ?? []);
  if (result.workflows.filesInstalled > 0) selectedIds.add('workflows');
  if (result.prepare.filesInstalled > 0) selectedIds.add('prepare');
  if (result.ref.filesInstalled > 0) selectedIds.add('ref');
  const manifest = createManifest('global', paths.home, {
    hookLevel: prior?.hookLevel,
    selectedComponentIds: Array.from(selectedIds),
    knownComponentIds: COMPONENT_DEFS.map((def) => def.id),
  });
  if (prior) {
    manifest.entries = prior.entries.map((entry) => ({ ...entry }));
    if (prior.disabledItems) manifest.disabledItems = [...prior.disabledItems];
    if (prior.hooks) manifest.hooks = JSON.parse(JSON.stringify(prior.hooks));
    if (prior.statusline) manifest.statusline = { ...prior.statusline };
    if (prior.mcp) manifest.mcp = JSON.parse(JSON.stringify(prior.mcp));
    if (prior.plugin) manifest.plugin = { ...prior.plugin };
  }
  for (const filePath of [
    ...result.workflows.installedFiles,
    ...result.prepare.installedFiles,
    ...result.ref.installedFiles,
  ]) {
    addFile(manifest, filePath);
  }
  saveManifest(manifest, { expectedPriorId: prior?.id ?? null });

  return result;
}
