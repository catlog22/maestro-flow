import { createContext, useContext, useState, useMemo } from 'react';

export type DocVersion = 'v1' | 'v2';

export interface VersionState {
  version: DocVersion;
  setVersion: (v: DocVersion) => void;
  isV2: boolean;
}

const VERSION_STORAGE_KEY = 'docs-site-version';
const DEFAULT_VERSION: DocVersion = 'v2';

export const VersionContext = createContext<VersionState | null>(null);

export function useVersion(): VersionState {
  const ctx = useContext(VersionContext);
  if (!ctx) throw new Error('useVersion must be used within VersionProvider');
  return ctx;
}

export function VersionProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersionState] = useState<DocVersion>(() => {
    try {
      const stored = localStorage.getItem(VERSION_STORAGE_KEY);
      if (stored === 'v1' || stored === 'v2') return stored;
    } catch {}
    return DEFAULT_VERSION;
  });

  const setVersion = useMemo(
    () => (v: DocVersion) => {
      try { localStorage.setItem(VERSION_STORAGE_KEY, v); } catch {}
      setVersionState(v);
    },
    [],
  );

  const value: VersionState = useMemo(
    () => ({ version, setVersion, isV2: version === 'v2' }),
    [version, setVersion],
  );

  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>;
}
