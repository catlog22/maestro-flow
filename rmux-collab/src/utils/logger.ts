import { appendFileSync } from 'node:fs';
import type { InteractionLog } from '../types.js';

export class Logger {
  private logs: InteractionLog[] = [];
  private filePath?: string;

  constructor(opts?: { filePath?: string }) {
    this.filePath = opts?.filePath;
  }

  record(entry: Omit<InteractionLog, 'timestamp'>): void {
    const full = { ...entry, timestamp: Date.now() };
    this.logs.push(full);
    if (this.filePath) {
      appendFileSync(this.filePath, JSON.stringify(full) + '\n');
    }
  }

  setFilePath(path: string): void {
    this.filePath = path;
  }

  getAll(): readonly InteractionLog[] {
    return this.logs;
  }

  clear(): void {
    this.logs = [];
  }
}
