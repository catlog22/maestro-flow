// ---------------------------------------------------------------------------
// embedding-status.ts — Query embedding system state for TUI display
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { EmbeddingStatus } from './EmbeddingConfig.js';

const API_CONFIG_PATH = join(homedir(), '.maestro', 'api-embedding.json');

export async function getEmbeddingStatus(projectRoot: string): Promise<EmbeddingStatus> {
  const apiMode = existsSync(API_CONFIG_PATH);
  let modelId = 'Xenova/multilingual-e5-small';
  let dimension = 384;

  if (apiMode) {
    try {
      const cfg = JSON.parse(readFileSync(API_CONFIG_PATH, 'utf-8'));
      modelId = cfg.model || modelId;
      dimension = cfg.dimensions || 1024;
    } catch { /* use defaults */ }
  }

  const { detectDevice, isModelCached, getHardwareInfo, getLocalModelPath } = await import('#maestro-dashboard/wiki/embedding.js');
  const localPath = getLocalModelPath();
  if (!apiMode && localPath) {
    modelId = localPath;
  }
  const hw = await getHardwareInfo();
  const cached = isModelCached();

  // Wiki index status
  let wikiIndexDocs = 0;
  let wikiIndexBuiltAt: string | null = null;
  try {
    const { loadEmbeddingIndex } = await import('#maestro-dashboard/wiki/embedding.js');
    const wikiIdx = loadEmbeddingIndex(join(projectRoot, '.workflow'));
    if (wikiIdx) {
      wikiIndexDocs = wikiIdx.docIds.length;
      wikiIndexBuiltAt = wikiIdx.builtAt ? new Date(wikiIdx.builtAt).toLocaleDateString() : null;
    }
  } catch { /* ignore */ }

  // Code index status
  let codeIndexNodes = 0;
  let codeIndexBuiltAt: string | null = null;
  try {
    const { loadCodeEmbeddingIndex } = await import('../../graph/kg/embedding/code-embedding.js');
    const codeIdx = loadCodeEmbeddingIndex(join(projectRoot, '.workflow', 'kg'));
    if (codeIdx) {
      codeIndexNodes = codeIdx.nodeIds.length;
      codeIndexBuiltAt = codeIdx.builtAt ? new Date(codeIdx.builtAt).toLocaleDateString() : null;
    }
  } catch { /* ignore */ }

  return {
    mode: apiMode ? 'api' : 'local',
    modelId,
    modelCached: cached,
    dimension,
    device: hw.selectedDevice.device,
    dtype: hw.selectedDevice.dtype,
    batchSize: hw.selectedDevice.batchSize,
    gpuAvailable: hw.gpuAvailable,
    wikiIndexDocs,
    wikiIndexBuiltAt,
    codeIndexNodes,
    codeIndexBuiltAt,
  };
}

export async function downloadLocalModel(
  onProgress?: (pct: number) => void,
): Promise<void> {
  const { setProgressCallback, embedTexts } = await import('#maestro-dashboard/wiki/embedding.js');

  if (onProgress) {
    setProgressCallback((info) => {
      if (info.progress !== undefined) {
        onProgress(Math.round(info.progress));
      }
    });
  }

  await embedTexts(['warmup']);
}

export function switchToApiMode(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextLength?: number;
  concurrency?: number;
}): void {
  mkdirSync(join(homedir(), '.maestro'), { recursive: true });
  writeFileSync(API_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function switchToLocalMode(): void {
  if (existsSync(API_CONFIG_PATH)) {
    renameSync(API_CONFIG_PATH, API_CONFIG_PATH + '.bak');
  }
}
