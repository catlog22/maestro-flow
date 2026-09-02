// 必须第一个 import：把 MAESTRO_HOME 指到隔离临时目录（ESM 按序求值）
import './isolate-maestro-home.js';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { paths } from '../../config/paths.js';
import { runChildScopeHook, type ChildRecord } from '../child-scope.js';

/**
 * markStoppedAcrossFiles 的唯一性约束（fs 级回归）:
 * agentType 不是跨会话身份——两个并行父会话各有一条同类型 running 时,
 * Grok 的 agentType-only stop 不得回标任何一边;只有全表匹配唯一才回标。
 */

function makeRunning(sessionId: string, agentType: string): ChildRecord {
  return {
    v: 1,
    id: `child-${sessionId}`,
    host: 'grok',
    host_session_id: sessionId,
    maestro_session_id: null,
    kind: 'host_subagent',
    platform_handle: { agent_id: null, agent_type: agentType, job_id: null },
    status: 'running',
    spawned_at: new Date().toISOString(),
    stopped_at: null,
    source: 'subagent-start',
  };
}

function writeRegistry(sessionId: string, records: ChildRecord[]): string {
  const dir = join(paths.data, 'child-scope', 'grok');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return file;
}

function readRegistry(file: string): ChildRecord[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChildRecord);
}

function grokStopPayload(agentType: string): string {
  // 子会话内触发的 stop:sessionId 是子会话,登记在父会话文件里
  return JSON.stringify({ hookEventName: 'subagent_stop', sessionId: 'child-session-x', subagentType: agentType });
}

describe('markStoppedAcrossFiles (fs 级)', () => {
  it('agentType-only 匹配不唯一时误标保护:两边都保持 running', async () => {
    const f1 = writeRegistry('parent-dup-1', [makeRunning('parent-dup-1', 'explore')]);
    const f2 = writeRegistry('parent-dup-2', [makeRunning('parent-dup-2', 'explore')]);

    await runChildScopeHook(grokStopPayload('explore'));

    expect(readRegistry(f1)[0].status).toBe('running');
    expect(readRegistry(f2)[0].status).toBe('running');
  });

  it('agentType-only 匹配唯一时正常跨会话回标', async () => {
    const f1 = writeRegistry('parent-uniq-1', [makeRunning('parent-uniq-1', 'plan')]);

    await runChildScopeHook(grokStopPayload('plan'));

    const records = readRegistry(f1);
    expect(records[0].status).toBe('stopped');
    expect(records[0].stopped_at).not.toBeNull();
  });
});
