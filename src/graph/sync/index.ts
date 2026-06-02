export { computeFileHash, computeFileHashes, isFileTooLarge } from './content-hash.js';
export { IncrementalSync } from './incremental-sync.js';
export type { SyncResult } from './incremental-sync.js';
export { FileWatcher, LockUnavailableError } from './watcher.js';
export type { WatchOptions, PendingFile } from './watcher.js';
export { watchDisabledReason } from './watch-policy.js';
