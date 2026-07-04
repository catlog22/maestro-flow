import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { C, SYM } from '../shared/index.js';

// ---------------------------------------------------------------------------
// EmbeddingConfig — Local model management panel
//
// Shows: mode (local/api), model status, hardware, download trigger
// Controls: 1-3 actions, y/n mode toggle
// ---------------------------------------------------------------------------

export interface EmbeddingStatus {
  mode: 'local' | 'api';
  modelId: string;
  modelCached: boolean;
  dimension: number;
  device: string;
  dtype: string;
  batchSize: number;
  gpuAvailable: boolean;
  wikiIndexDocs: number;
  wikiIndexBuiltAt: string | null;
  codeIndexNodes: number;
  codeIndexBuiltAt: string | null;
}

interface EmbeddingConfigProps {
  status: EmbeddingStatus | null;
  downloading: boolean;
  downloadProgress: number;
  onDownloadModel: () => void;
  onSwitchMode: (mode: 'local' | 'api') => void;
  onRebuildIndex: () => void;
}

export function EmbeddingConfig({
  status, downloading, downloadProgress,
  onDownloadModel, onSwitchMode, onRebuildIndex,
}: EmbeddingConfigProps) {
  const [cursor, setCursor] = useState(0);
  const actions = status?.mode === 'local'
    ? ['download', 'rebuild', 'switch-api'] as const
    : ['switch-local', 'rebuild'] as const;

  useInput((input, key) => {
    if (key.upArrow) setCursor(i => Math.max(0, i - 1));
    else if (key.downArrow) setCursor(i => Math.min(actions.length - 1, i + 1));
    else if (input === ' ' || key.return) {
      const action = actions[cursor];
      if (action === 'download') onDownloadModel();
      else if (action === 'rebuild') onRebuildIndex();
      else if (action === 'switch-api') onSwitchMode('api');
      else if (action === 'switch-local') onSwitchMode('local');
    } else {
      const num = parseInt(input, 10);
      if (num >= 1 && num <= actions.length) {
        setCursor(num - 1);
        const action = actions[num - 1];
        if (action === 'download') onDownloadModel();
        else if (action === 'rebuild') onRebuildIndex();
        else if (action === 'switch-api') onSwitchMode('api');
        else if (action === 'switch-local') onSwitchMode('local');
      }
    }
  });

  if (!status) {
    return (
      <Box flexDirection="column">
        <Text bold color={C.primary}>Embedding Model</Text>
        <Text dimColor>Loading status...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={C.primary}>Embedding Model Management</Text>

      {/* Status section */}
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text>Mode: </Text>
          <Text bold color={status.mode === 'local' ? C.success : C.accent}>
            {status.mode === 'local' ? 'Local (ONNX)' : 'API (External)'}
          </Text>
        </Box>
        <Box>
          <Text>Model: </Text>
          <Text color={C.primary}>{status.modelId}</Text>
        </Box>
        <Box>
          <Text>Dimension: </Text>
          <Text>{status.dimension}d</Text>
        </Box>
        {status.mode === 'local' && (
          <>
            <Box>
              <Text>Cached: </Text>
              <Text color={status.modelCached ? C.success : C.error}>
                {status.modelCached ? 'Yes' : 'No (needs download ~465MB)'}
              </Text>
            </Box>
            <Box>
              <Text>Device: </Text>
              <Text color={status.gpuAvailable ? C.success : C.neutral}>
                {status.device}/{status.dtype} batch={status.batchSize}
                {status.gpuAvailable ? ' (GPU)' : ' (CPU)'}
              </Text>
            </Box>
          </>
        )}
      </Box>

      {/* Index status */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={C.primary}>Index Status</Text>
        <Box>
          <Text>Wiki: </Text>
          <Text color={status.wikiIndexDocs > 0 ? C.success : C.neutral}>
            {status.wikiIndexDocs > 0
              ? `${status.wikiIndexDocs} docs (${status.wikiIndexBuiltAt})`
              : 'Not built'}
          </Text>
        </Box>
        <Box>
          <Text>Code: </Text>
          <Text color={status.codeIndexNodes > 0 ? C.success : C.neutral}>
            {status.codeIndexNodes > 0
              ? `${status.codeIndexNodes} nodes (${status.codeIndexBuiltAt})`
              : 'Not built'}
          </Text>
        </Box>
      </Box>

      {/* Download progress */}
      {downloading && (
        <Box marginTop={1}>
          <Text color={C.warning}>
            Downloading... {downloadProgress > 0 ? `${downloadProgress}%` : ''}
          </Text>
        </Box>
      )}

      {/* Actions */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={C.primary}>Actions</Text>
        {actions.map((action, i) => {
          const hl = cursor === i;
          const label = action === 'download' ? 'Download local model (~465MB)'
            : action === 'rebuild' ? 'Rebuild embedding index'
            : action === 'switch-api' ? 'Switch to API mode'
            : 'Switch to local mode';
          return (
            <Box key={action}>
              <Text color={hl ? C.primary : C.neutral}>[{i + 1}]</Text>
              <Text color={hl ? C.primary : undefined} bold={hl}> {label}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [Up/Down] Navigate  [Space/Enter/1-{actions.length}] Execute  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
}
