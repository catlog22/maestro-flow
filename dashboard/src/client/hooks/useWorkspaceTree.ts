import { useState, useEffect, useCallback } from 'react';
import type { FileNode } from './useArtifacts.js';

export function useWorkspaceTree() {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workspace?tree=true');
      if (res.ok) {
        setTree(await res.json());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  return { tree, loading, refreshTree: fetchTree };
}
