/**
 * Maestro Child Scope — 子代理生命周期登记（Join / Reap / Unregister 的观察面）
 *
 * 事件来源：Claude Code / Grok 的 hooks stdin JSON（两家字段命名都兼容）。
 *   SubagentStart        → 登记 host_subagent（running）
 *   PreToolUse(Agent|spawn_subagent|Task) → 无 Start 事件时的补登记
 *   SubagentStop         → 按 agent id / subagentType 标 stopped（stop_hook_active 直接退出）
 *   SessionEnd           → 父会话结束：running 全标 orphan + reap Maestro 拥有的资源；
 *                          子会话结束（带 subagentType）：补标 stopped
 *   StopCancelled        → 父会话回合被取消：running 全标 orphan + reap
 *
 * 设计原则：
 *   - Fail-open：任何异常静默通过，绝不阻塞宿主工具调用与会话（同 team-monitor）。
 *   - 一行一事：{paths.data}/child-scope/{host}/{host_session_id}.jsonl，rename 原子写。
 *     并发说明：并行子代理同时 Stop 时多个 hook 进程读-改-写同一文件存在竞态，
 *     可能丢失个别 mark 事件（fail-open 语义，方案层面接受）——丢失的 running
 *     记录会在 30min 后标 orphan 自愈，不演化为永久脏状态。
 *   - 观察与回收解耦：登记只记账；SessionEnd/StopCancelled 才调 reapBestEffort
 *     回收 Maestro 拥有的资源（delegate job / team member / 死 team 目录）。
 *   - Purge 对齐 delegate-broker：终态 2h 清除，running 超 30min 标 orphan。
 *   - 不杀宿主内部子代理进程（v1 非目标），只对账。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { paths } from '../config/paths.js';
import { logHookWarn } from './hook-logger.js';

// ---------------------------------------------------------------------------
// 类型与常量
// ---------------------------------------------------------------------------

export interface ChildRecord {
  v: 1;
  id: string;
  host: string;
  host_session_id: string;
  maestro_session_id: string | null;
  kind: 'host_subagent' | 'delegate' | 'team_member' | 'team_shell';
  platform_handle: { agent_id: string | null; agent_type: string | null; job_id: string | null };
  status: 'running' | 'stopped' | 'cancelled' | 'orphan';
  spawned_at: string;
  stopped_at: string | null;
  source: 'subagent-start' | 'pretool-agent' | 'subagent-stop' | 'delegate' | 'team-mcp';
}

interface NormalizedPayload {
  event: string;
  sessionId: string;
  agentId: string | null;
  agentType: string | null;
  toolName: string | null;
  stopHookActive: boolean;
  host: string;
}

/** 对齐 delegate-broker DEFAULT_PURGE_MAX_AGE_MS（2h） */
const PURGE_TERMINAL_MS = 2 * 60 * 60 * 1000;
/** 对齐 delegate-broker DEFAULT_TIMEOUT_MS（30min） */
const ORPHAN_RUNNING_MS = 30 * 60 * 1000;
/** PreToolUse 与 SubagentStart 的去重窗口 */
const ADOPT_WINDOW_MS = 15_000;

const SPAWN_TOOLS = new Set(['Agent', 'spawn_subagent', 'Task']);

// ---------------------------------------------------------------------------
// 纯函数（可测）
// ---------------------------------------------------------------------------

/** Claude 用 snake_case、Grok 用 camelCase，统一归一化事件名与字段，并推断宿主。 */
export function normalizePayload(p: Record<string, unknown>): NormalizedPayload {
  const rawEvent = String(p.hook_event_name || p.hookEventName || '');
  const event = rawEvent.toLowerCase().replace(/[^a-z]/g, '');
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    event: event === 'subagentend' ? 'subagentstop' : event,
    sessionId: String(p.session_id || p.sessionId || 'unknown'),
    agentId: str(p.agent_id) ?? str(p.agentId) ?? str(p.subagent_id) ?? str(p.subagentId),
    agentType: str(p.agent_type) ?? str(p.agentType) ?? str(p.subagent_type) ?? str(p.subagentType),
    toolName: str(p.tool_name) ?? str(p.toolName),
    stopHookActive: Boolean(p.stop_hook_active ?? p.stopHookActive),
    // camelCase 命名是 Grok 载荷特征；snake_case 为 Claude
    host: p.hookEventName !== undefined ? 'grok' : 'claude',
  };
}

function isTerminal(r: ChildRecord): boolean {
  return r.status === 'stopped' || r.status === 'cancelled' || r.status === 'orphan';
}

function ageMs(r: ChildRecord, nowMs: number): number {
  return nowMs - (Date.parse(r.stopped_at || r.spawned_at || '') || 0);
}

/** 终态 2h 清除；running 超 30min 标 orphan。返回是否有变化。 */
export function purgeRecords(records: ChildRecord[], nowMs: number): boolean {
  let changed = false;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (isTerminal(r) && ageMs(r, nowMs) > PURGE_TERMINAL_MS) {
      records.splice(i, 1);
      changed = true;
    } else if (r.status === 'running' && ageMs(r, nowMs) > ORPHAN_RUNNING_MS) {
      r.status = 'orphan';
      changed = true;
    }
  }
  return changed;
}

function makeRecord(ctx: {
  host: string;
  sessionId: string;
  kind: ChildRecord['kind'];
  agentId: string | null;
  agentType: string | null;
  source: ChildRecord['source'];
  now: string;
  pid?: number;
}): ChildRecord {
  return {
    v: 1,
    id: `child-${ctx.agentId || `${ctx.source}-${Date.now()}-${ctx.pid ?? 0}`}`,
    host: ctx.host,
    host_session_id: ctx.sessionId,
    maestro_session_id: null,
    kind: ctx.kind,
    platform_handle: { agent_id: ctx.agentId, agent_type: ctx.agentType, job_id: null },
    status: 'running',
    spawned_at: ctx.now,
    stopped_at: null,
    source: ctx.source,
  };
}

/** 登记；PreToolUse 的补登记由随后的 SubagentStart 收养。返回是否有变化。 */
export function registerRecord(
  records: ChildRecord[],
  ctx: Parameters<typeof makeRecord>[0],
): boolean {
  const nowMs = Date.parse(ctx.now);
  if (ctx.agentId && records.some((r) => r.status === 'running' && r.platform_handle.agent_id === ctx.agentId)) {
    return false; // 同 agent 重复 Start
  }
  const recent = [...records].reverse().find((r) =>
    r.status === 'running' && nowMs - Date.parse(r.spawned_at) < ADOPT_WINDOW_MS);
  if (ctx.source === 'subagent-start') {
    // Start 事件晚于 PreToolUse 到达：收养补登记的那条。
    // 注意：recent 也可能是 15s 窗口内**另一个并行子代理**的 Start 记录——
    // 不得因此跳过本次登记（否则并行 wave 中第二个起的子代理永不登记，
    // 其 Stop 又会错标第一个，表现为「task 完成不更新状态」）。
    if (recent && recent.source === 'pretool-agent' && !recent.platform_handle.agent_id) {
      recent.platform_handle.agent_id = ctx.agentId;
      recent.platform_handle.agent_type = ctx.agentType ?? recent.platform_handle.agent_type;
      recent.source = 'subagent-start';
      recent.id = `child-${ctx.agentId || recent.id}`;
      return true;
    }
  }
  if (ctx.source === 'pretool-agent' && recent) return false; // Start 已先行登记（或无 Start 宿主的重复 pretool）
  records.push(makeRecord(ctx));
  return true;
}

/** 标 stopped：优先按 agent_id，其次按 agentType 最近一条，最后兜底最近一条 running/orphan。 */
export function markRecordStopped(
  records: ChildRecord[],
  ctx: { agentId: string | null; agentType: string | null; now: string },
  opts?: { requireIdentity?: boolean },
): boolean {
  const candidates = records.filter((r) => r.status === 'running' || r.status === 'orphan');
  let target: ChildRecord | undefined;
  if (ctx.agentId) target = candidates.find((r) => r.platform_handle.agent_id === ctx.agentId);
  if (!target && ctx.agentType) {
    target = [...candidates].reverse().find((r) => r.platform_handle.agent_type === ctx.agentType);
  }
  // requireIdentity：跨会话回标时禁止盲兜底（见 markStoppedAcrossFiles）
  if (!target && !opts?.requireIdentity) target = candidates[candidates.length - 1];
  if (!target) return false;
  target.status = 'stopped';
  target.stopped_at = ctx.now;
  return true;
}

function orphanAllRunning(records: ChildRecord[]): boolean {
  let changed = false;
  for (const r of records) {
    if (r.status === 'running') { r.status = 'orphan'; changed = true; }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// 登记表 IO（rename 原子写，失败静默）
// ---------------------------------------------------------------------------

function registryDir(host: string): string {
  return join(paths.data, 'child-scope', host);
}

function registryFile(host: string, sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(registryDir(host), `${safe}.jsonl`);
}

function loadRecords(file: string): ChildRecord[] {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line) as ChildRecord; } catch { return null; } })
      .filter((r): r is ChildRecord => Boolean(r && r.id));
  } catch {
    return [];
  }
}

function saveRecords(file: string, records: ChildRecord[]): void {
  const tmp = `${file}.tmp-${process.pid}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  renameSync(tmp, file);
}

/**
 * Grok 的 SubagentStop/子 SessionEnd 在子会话内触发（sessionId 是子的），需跨文件回找父会话登记。
 * 跨会话回标必须持有身份线索（agentId 或 agentType）才允许命中——
 * 禁止无差别兜底：否则会把**另一个并行父会话**的同类型 running 记录误标 stopped。
 *
 * agentType 不是跨会话身份：两个并行父会话可能各有一条同类型 running。
 * agentType-only 匹配只有在**全表唯一**时才回标；不唯一则保留记录，
 * 等稳定身份（agentId）或孤儿清理（30min）处理。
 */
function markStoppedAcrossFiles(
  host: string,
  ownFile: string,
  ctx: { agentId: string | null; agentType: string | null; now: string },
): boolean {
  if (!ctx.agentId && !ctx.agentType) return false;
  let files: string[];
  try {
    files = readdirSync(registryDir(host)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }

  const isLive = (r: ChildRecord): boolean => r.status === 'running' || r.status === 'orphan';

  // agentId 是稳定身份：命中即唯一，直接回标
  if (ctx.agentId) {
    for (const f of files) {
      const file = join(registryDir(host), f);
      if (file === ownFile) continue;
      const records = loadRecords(file);
      purgeRecords(records, Date.now());
      const target = records.find((r) => isLive(r) && r.platform_handle.agent_id === ctx.agentId);
      if (!target) continue;
      target.status = 'stopped';
      target.stopped_at = ctx.now;
      try { saveRecords(file, records); } catch { /* fail-open */ }
      return true;
    }
    return false;
  }

  // agentType-only：先收集全部匹配，唯一才回标
  const hits: Array<{ file: string; records: ChildRecord[]; target: ChildRecord }> = [];
  for (const f of files) {
    const file = join(registryDir(host), f);
    if (file === ownFile) continue;
    const records = loadRecords(file);
    purgeRecords(records, Date.now());
    for (const r of records) {
      if (isLive(r) && r.platform_handle.agent_type === ctx.agentType) {
        hits.push({ file, records, target: r });
      }
    }
  }
  if (hits.length !== 1) return false;
  const hit = hits[0];
  hit.target.status = 'stopped';
  hit.target.stopped_at = ctx.now;
  try { saveRecords(hit.file, hit.records); } catch { /* fail-open */ }
  return true;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 处理一条 hook stdin 原始 JSON。永不抛出。
 * `stop_hook_active=true` 的 SubagentStop 零副作用（防重入环）。
 */
export async function runChildScopeHook(raw: string): Promise<void> {
  try {
    if (!raw.trim()) return;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { return; }
    const ctx = normalizePayload(payload);
    const now = new Date().toISOString();

    if (ctx.event === 'subagentstop' && ctx.stopHookActive) return;

    const file = registryFile(ctx.host, ctx.sessionId);
    const records = loadRecords(file);
    let changed = purgeRecords(records, Date.now());

    switch (ctx.event) {
      case 'subagentstart':
        changed = registerRecord(records, {
          host: ctx.host, sessionId: ctx.sessionId, kind: 'host_subagent',
          agentId: ctx.agentId, agentType: ctx.agentType, source: 'subagent-start', now, pid: process.pid,
        }) || changed;
        break;
      case 'pretooluse':
        if (ctx.toolName && SPAWN_TOOLS.has(ctx.toolName)) {
          changed = registerRecord(records, {
            host: ctx.host, sessionId: ctx.sessionId, kind: 'host_subagent',
            agentId: null, agentType: null, source: 'pretool-agent', now, pid: process.pid,
          }) || changed;
        }
        break;
      case 'subagentstop':
        if (!markRecordStopped(records, { agentId: ctx.agentId, agentType: ctx.agentType, now })) {
          if (!markStoppedAcrossFiles(ctx.host, file, { agentId: ctx.agentId, agentType: ctx.agentType, now })) {
            records.push({
              ...makeRecord({
                host: ctx.host, sessionId: ctx.sessionId, kind: 'host_subagent',
                agentId: ctx.agentId, agentType: ctx.agentType, source: 'subagent-stop', now, pid: process.pid,
              }),
              status: 'stopped',
              stopped_at: now,
            });
          }
        }
        changed = true;
        break;
      case 'sessionend':
      case 'stopcancelled':
        if (ctx.agentType) {
          // 子会话 teardown：等价于该子代理终止
          if (!markRecordStopped(records, { agentId: ctx.agentId, agentType: ctx.agentType, now })) {
            markStoppedAcrossFiles(ctx.host, file, { agentId: ctx.agentId, agentType: ctx.agentType, now });
          }
          changed = true;
        } else {
          // 父会话结束/取消：标 orphan + 回收 Maestro 拥有的资源（best-effort）
          changed = orphanAllRunning(records) || changed;
          try {
            const { reapBestEffort } = await import('../async/child-reap.js');
            await reapBestEffort({ host: ctx.host, hostSessionId: ctx.sessionId });
          } catch { /* reap 失败不影响登记 */ }
        }
        break;
      default:
        return;
    }

    if (changed) {
      try { saveRecords(file, records); } catch { /* fail-open */ }
    }
  } catch (err) {
    logHookWarn('child-scope', `hook failed (ignored): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 只读查询：某宿主会话当前仍 running 的子代理（供 statusline / session status 展示）。 */
export function listLiveChildren(host: string, hostSessionId: string): ChildRecord[] {
  try {
    const file = registryFile(host, hostSessionId);
    if (!existsSync(file)) return [];
    const nowMs = Date.now();
    // 只读路径不落盘,但同样应用孤儿龄规则:漏标 stop 的 running
    // 超过 ORPHAN_RUNNING_MS 不计入 live,否则 statusline 会永久显示
    return loadRecords(file).filter((r) => r.status === 'running' && ageMs(r, nowMs) <= ORPHAN_RUNNING_MS);
  } catch {
    return [];
  }
}
