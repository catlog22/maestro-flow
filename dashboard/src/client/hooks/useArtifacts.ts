import { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// FileNode — tree structure returned by the artifacts API
// ---------------------------------------------------------------------------

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// ---------------------------------------------------------------------------
// useArtifacts — fetches directory tree and file content from artifacts API
// ---------------------------------------------------------------------------

export interface UseArtifactsReturn {
  tree: FileNode[];
  selectedPath: string | null;
  content: string | null;
  loading: boolean;
  treeLoading: boolean;
  error: string | null;
  selectFile: (path: string) => void;
  refreshTree: () => void;
}

export function useArtifacts(): UseArtifactsReturn {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch tree on mount
  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await fetch(`${API_ENDPOINTS.ARTIFACTS}/?tree=true`);
      if (!res.ok) {
        setError(`Failed to load tree: ${res.status}`);
        return;
      }
      const data: FileNode[] = await res.json();
      setTree(data);
      setError(null);
    } catch {
      setError('Failed to connect to server');
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Fetch file content when a file is selected
  const selectFile = useCallback(async (path: string) => {
    setSelectedPath(path);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_ENDPOINTS.ARTIFACTS}/${path}`);
      if (!res.ok) {
        setError(`Failed to load file: ${res.status}`);
        setContent(null);
        return;
      }
      const text = await res.text();
      setContent(text);
    } catch {
      setError('Failed to fetch file content');
      setContent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    tree,
    selectedPath,
    content,
    loading,
    treeLoading,
    error,
    selectFile,
    refreshTree: fetchTree,
  };
}
