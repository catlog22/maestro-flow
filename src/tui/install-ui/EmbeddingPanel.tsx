import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { C, SYM } from '../shared/index.js';
import type { EmbeddingStatus } from './EmbeddingConfig.js';

// ---------------------------------------------------------------------------
// EmbeddingPanel — Interactive embedding model management (async state)
// ---------------------------------------------------------------------------

interface EmbeddingPanelProps {
  onDone: () => void;
}

type Action = 'download' | 'rebuild' | 'switch';

export function EmbeddingPanel({ onDone }: EmbeddingPanelProps) {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  const actions: Array<{ id: Action; label: string }> = status?.mode === 'local'
    ? [
        { id: 'download', label: status?.modelCached ? 'Re-download model' : 'Download model (~465MB)' },
        { id: 'rebuild', label: 'Rebuild code embedding index' },
        { id: 'switch', label: 'Switch to API mode' },
      ]
    : [
        { id: 'switch', label: 'Switch to local mode' },
        { id: 'rebuild', label: 'Rebuild code embedding index' },
      ];

  useEffect(() => {
    import('./embedding-status.js').then(({ getEmbeddingStatus }) =>
      getEmbeddingStatus(process.cwd()).then(s => { setStatus(s); setLoading(false); })
    ).catch(() => setLoading(false));
  }, []);

  const runAction = useCallback(async (action: Action) => {
    const { getEmbeddingStatus, downloadLocalModel, switchToLocalMode } = await import('./embedding-status.js');
    const projectRoot = process.cwd();

    if (action === 'download') {
      setBusy('Downloading model...');
      try {
        await downloadLocalModel((pct) => setBusy(`Downloading... ${pct}%`));
        setMessage('Model downloaded');
      } catch (e: unknown) {
        setMessage(`Download failed: ${e instanceof Error ? e.message : e}`);
      }
    } else if (action === 'rebuild') {
      setBusy('Building code embedding index...');
      try {
        const { MaestroGraph } = await import('../../graph/kg/engine.js');
        if (MaestroGraph.isInitialized(projectRoot)) {
          const mg = await MaestroGraph.open(projectRoot);
          try {
            const idx = await mg.buildCodeEmbeddings();
            setMessage(`Index built: ${idx.nodeIds.length} nodes, ${idx.dimension}d`);
          } finally { mg.close(); }
        } else {
          setMessage('KG not initialized. Run: maestro kg init');
        }
      } catch (e: unknown) {
        setMessage(`Build failed: ${e instanceof Error ? e.message : e}`);
      }
    } else if (action === 'switch') {
      if (status?.mode === 'local') {
        setMessage('To switch to API mode, create ~/.maestro/api-embedding.json');
      } else {
        switchToLocalMode();
        setMessage('Switched to local mode');
      }
    }

    setBusy(null);
    const newStatus = await getEmbeddingStatus(projectRoot);
    setStatus(newStatus);
  }, [status]);

  useInput((input, key) => {
    if (busy) return;
    if (key.escape || key.leftArrow) { onDone(); return; }
    if (key.upArrow) setCursor(i => Math.max(0, i - 1));
    else if (key.downArrow) setCursor(i => Math.min(actions.length - 1, i + 1));
    else if (key.return || input === ' ') {
      const action = actions[cursor];
      if (action) runAction(action.id);
    } else {
      const num = parseInt(input, 10);
      if (num >= 1 && num <= actions.length) {
        setCursor(num - 1);
        runAction(actions[num - 1].id);
      }
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column">
        <Text bold color={C.primary}>Embedding Model</Text>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={C.primary}>Embedding Model Management</Text>

      {status && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>Mode:   </Text>
            <Text bold color={status.mode === 'local' ? C.success : C.accent}>
              {status.mode === 'local' ? 'Local (ONNX)' : 'API (External)'}
            </Text>
          </Box>
          <Box>
            <Text dimColor>Model:  </Text>
            <Text>{status.modelId}</Text>
          </Box>
          <Box>
            <Text dimColor>Dim:    </Text>
            <Text>{status.dimension}d</Text>
          </Box>
          {status.mode === 'local' && (
            <>
              <Box>
                <Text dimColor>Cached: </Text>
                <Text color={status.modelCached ? C.success : C.warning}>
                  {status.modelCached ? 'Yes' : 'No'}
                </Text>
              </Box>
              <Box>
                <Text dimColor>Device: </Text>
                <Text>{status.device}/{status.dtype} batch={status.batchSize}</Text>
                <Text color={status.gpuAvailable ? C.success : C.neutral}>
                  {status.gpuAvailable ? ' (GPU)' : ' (CPU)'}
                </Text>
              </Box>
            </>
          )}
          <Box>
            <Text dimColor>Wiki:   </Text>
            <Text>{status.wikiIndexDocs > 0 ? `${status.wikiIndexDocs} docs` : 'not built'}</Text>
          </Box>
          <Box>
            <Text dimColor>Code:   </Text>
            <Text>{status.codeIndexNodes > 0 ? `${status.codeIndexNodes} nodes` : 'not built'}</Text>
          </Box>
        </Box>
      )}

      {busy && (
        <Box marginTop={1}>
          <Text color={C.warning}>{busy}</Text>
        </Box>
      )}

      {message && !busy && (
        <Box marginTop={1}>
          <Text color={C.success}>{message}</Text>
        </Box>
      )}

      {!busy && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Actions:</Text>
          {actions.map((a, i) => (
            <Box key={a.id}>
              <Text color={cursor === i ? C.primary : C.neutral}>[{i + 1}]</Text>
              <Text color={cursor === i ? C.primary : undefined} bold={cursor === i}> {a.label}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>[Up/Down] Navigate  [Enter/1-{actions.length}] Run  [Esc] Back</Text>
      </Box>
    </Box>
  );
}
