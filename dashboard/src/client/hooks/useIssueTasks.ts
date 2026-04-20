import { useState, useEffect } from 'react';
import type { TaskCard } from '@/shared/types.js';
import { normalizeTask } from '@/shared/normalize-task.js';

// ---------------------------------------------------------------------------
// useIssueTasks — fetches TASK files linked to an issue via task_refs
// ---------------------------------------------------------------------------

interface UseIssueTasksResult {
  tasks: TaskCard[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetch tasks associated with an issue (via task_refs + task_plan_dir).
 * Returns empty array when issue has no linked tasks.
 */
export function useIssueTasks(issueId: string | null): UseIssueTasksResult {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!issueId) {
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/issues/${encodeURIComponent(issueId)}/tasks`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: unknown[]) => {
        if (!cancelled) {
          setTasks(data.map(normalizeTask));
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [issueId]);

  return { tasks, loading, error };
}
