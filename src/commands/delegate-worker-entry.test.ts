import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDetachedDelegateWorkerArgs, type DelegateExecutionRequest } from './delegate.js';

function makeRequest(): DelegateExecutionRequest {
  return {
    prompt: 'ping',
    tool: 'claude',
    mode: 'analysis',
    workDir: process.cwd(),
    execId: 'cld-test-entry',
    backend: 'direct',
    repositoryContext: {
      currentRepoId: '11111111-1111-4111-8111-111111111111',
      currentRepoName: 'actor',
      currentProjectRoot: process.cwd(),
      identityPersisted: true,
      linkedRepositories: [],
    },
  };
}

describe('detached delegate worker entry script', () => {
  it('defaults to the package CLI entry (bin/maestro.js), not argv[1]', () => {
    // MCP server 进程里 argv[1] 是 bin/maestro-mcp.js：worker 必须以
    // CLI 入口启动，否则 delegate --worker 永不执行、job 卡 queued。
    const request = makeRequest();
    expect(request.repositoryContext.currentProjectRoot).toBe(request.workDir);
    const args = buildDetachedDelegateWorkerArgs(request);
    const entry = args[0];
    expect(entry).toMatch(/bin[\\/]maestro\.js$/);
    expect(entry).not.toMatch(/maestro-mcp\.js$/);
    expect(existsSync(entry)).toBe(true);
    expect(args.slice(1, 3)).toEqual(['delegate', 'ping']);
    expect(args).toContain('--worker');
  });

  it('honours an explicit entryScript override', () => {
    const args = buildDetachedDelegateWorkerArgs(makeRequest(), 'custom-entry.js');
    expect(args[0]).toBe('custom-entry.js');
  });
});
