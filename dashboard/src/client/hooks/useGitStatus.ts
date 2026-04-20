import { useState, useEffect, useCallback, useRef } from 'react';

interface FileStatus {
  path: string;
  status: string;
}

interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

interface GitStatusData {
  branch: string;
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: string[];
  commits: CommitInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGitStatus(pollInterval = 15000): GitStatusData {
  const [branch, setBranch] = useState('');
  const [staged, setStaged] = useState<FileStatus[]>([]);
  const [unstaged, setUnstaged] = useState<FileStatus[]>([]);
  const [untracked, setUntracked] = useState<string[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, logRes] = await Promise.all([
        fetch('/api/git/status'),
        fetch('/api/git/log?limit=8'),
      ]);

      if (!mountedRef.current) return;

      if (statusRes.ok) {
        const data = await statusRes.json();
        if (data.error) {
          setError(data.error);
        } else {
          setBranch(data.branch ?? '');
          setStaged(data.staged ?? []);
          setUnstaged(data.unstaged ?? []);
          setUntracked(data.untracked ?? []);
        }
      } else {
        setError(`Status fetch failed (${statusRes.status})`);
      }

      if (logRes.ok) {
        const data = await logRes.json();
        if (!data.error) {
          setCommits(data.commits ?? []);
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const timer = setInterval(fetchAll, pollInterval);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchAll, pollInterval]);

  return { branch, staged, unstaged, untracked, commits, loading, error, refresh: fetchAll };
}
