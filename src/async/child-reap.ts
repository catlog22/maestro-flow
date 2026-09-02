/**
 * Maestro Child Reap — SessionEnd / StopCancelled / session complete 的扫尾（P1）
 *
 * 只回收 **Maestro 拥有** 的资源，幂等、best-effort、永不抛出：
 *   1. delegate-broker 非终态 job → requestCancel（幂等标记语义）
 *      命中条件：metadata.sessionId 匹配结束的宿主会话，或 metadata.maestroSessionId
 *      匹配，或 workerPid 已死（进程不存在）。
 *      team_agent 的 worker 本身就是 delegate job（jobId = {session_id}-{role}），
 *      由本步覆盖，无需单独扫 members.json（保留其作为可审计记录）。
 *   2. 死 team 目录 GC：~/.claude/teams/<name>/config.json 的 leadSessionId
 *      在 ~/.claude/sessions/<pid>.json 活会话中找不到（或 pid 已死）→ 删目录
 *      （Claude Code #32730 残留）。
 *   3. /tmp/maestro-notify-*.jsonl 压缩：已读项清除，全读则删文件。
 *
 * 明确不做：杀宿主内部子代理进程（Claude Agent / Grok spawn_subagent），
 * 那是宿主内核的事；这里只做 Maestro 侧记账与自有资源回收。
 */

import { closeSync, constants, existsSync, fstatSync, ftruncateSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

import { createDefaultDelegateBroker } from './delegate-broker.js';
import { NOTIFY_PREFIX } from '../hooks/constants.js';

export interface ReapInput {
  host: string;
  hostSessionId: string;
  /** 调用方 maestro session id（session complete 路径传入） */
  maestroSessionId?: string | null;
}

export interface ReapReport {
  cancelledJobs: string[];
  removedTeams: string[];
  compactedNotifyFiles: string[];
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** 进程是否存活（pid 不存在 → false；无权限探测 → 视为存活，保守不杀） */
function pidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. delegate jobs
// ---------------------------------------------------------------------------

function reapDelegateJobs(input: ReapInput, report: ReapReport): void {
  const broker = createDefaultDelegateBroker();
  for (const job of broker.listJobs()) {
    if (TERMINAL_STATUSES.has(job.status)) continue;
    if (job.metadata?.cancelRequestedAt) continue;
    const meta = job.metadata ?? {};
    const sessionMatch = typeof meta.sessionId === 'string' && meta.sessionId === input.hostSessionId;
    const maestroMatch = Boolean(input.maestroSessionId)
      && typeof meta.maestroSessionId === 'string'
      && meta.maestroSessionId === input.maestroSessionId;
    const workerDead = meta.workerPid !== undefined && !pidAlive(meta.workerPid);
    if (!sessionMatch && !maestroMatch && !workerDead) continue;
    try {
      broker.requestCancel({
        jobId: job.jobId,
        requestedBy: 'child-reap',
        reason: `Host session ended (${input.host}:${input.hostSessionId})`,
      });
      report.cancelledJobs.push(job.jobId);
    } catch { /* 单个 job 失败不阻塞其余 */ }
  }
}

// ---------------------------------------------------------------------------
// 2. 死 team 目录 GC
// ---------------------------------------------------------------------------

/** 活会话集合；sessions 目录不可读时返回 null（调用方应中止 GC，防止误判全灭） */
function liveClaudeSessionIds(claudeDir: string): Set<string> | null {
  const live = new Set<string>();
  const sessionsDir = join(claudeDir, 'sessions');
  let files: string[] = [];
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  for (const f of files) {
    const data = readJsonFile(join(sessionsDir, f));
    if (!data || typeof data.sessionId !== 'string') continue;
    // sessions 文件可能因崩溃残留：pid 死了就不算活会话
    if (data.pid !== undefined && !pidAlive(data.pid)) continue;
    live.add(data.sessionId);
  }
  return live;
}

function gcDeadTeams(report: ReapReport): void {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const teamsDir = join(claudeDir, 'teams');
  let entries: string[] = [];
  try {
    entries = readdirSync(teamsDir);
  } catch {
    return;
  }
  if (entries.length === 0) return;
  const liveSessions = liveClaudeSessionIds(claudeDir);
  // sessions 目录不可读 → 无法判定活性，中止 GC（否则会把活 team 全删）
  if (liveSessions === null) return;
  for (const name of entries) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;
    const dir = join(teamsDir, name);
    const config = readJsonFile(join(dir, 'config.json'));
    // 无 config 或缺 leadSessionId：状态未知，保守保留
    if (!config || typeof config.leadSessionId !== 'string') continue;
    if (liveSessions.has(config.leadSessionId)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      report.removedTeams.push(name);
    } catch { /* 删除失败留待下轮 */ }
  }
}

// ---------------------------------------------------------------------------
// 3. notify 文件压缩
// ---------------------------------------------------------------------------

function compactNotifyFiles(report: ReapReport): void {
  const dir = tmpdir();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith(NOTIFY_PREFIX) && f.endsWith('.jsonl'));
  } catch {
    return;
  }
  for (const f of files) {
    const path = join(dir, f);
    // 共享 tmpdir 安全:O_NOFOLLOW 拒符号链接、O_NONBLOCK 防 FIFO 阻塞;
    // 读写都走同一 fd,不经路径二次解析,杜绝交换攻击(CWE-59/CWE-400)
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch {
      continue;
    }
    try {
      if (!fstatSync(fd).isFile()) continue;
      const lines = readFileSync(fd, 'utf8').split('\n').filter(Boolean);
      const unread = lines.filter((line) => {
        try { return !(JSON.parse(line) as { read?: boolean }).read; } catch { return true; }
      });
      if (unread.length === lines.length) continue; // 无已读项
      if (unread.length === 0) {
        // unlink 不跟随最终符号链接,删的是条目本身
        rmSync(path, { force: true });
      } else {
        ftruncateSync(fd, 0);
        writeSync(fd, unread.join('\n') + '\n', 0, 'utf8');
      }
      report.compactedNotifyFiles.push(f);
    } catch { /* 单文件失败不阻塞其余 */ } finally {
      try { closeSync(fd); } catch { /* 已关闭则忽略 */ }
    }
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 幂等扫尾：任何步骤失败都静默跳过，可安全重复调用。 */
export async function reapBestEffort(input: ReapInput): Promise<ReapReport> {
  const report: ReapReport = { cancelledJobs: [], removedTeams: [], compactedNotifyFiles: [] };
  try { reapDelegateJobs(input, report); } catch { /* best-effort */ }
  try { gcDeadTeams(report); } catch { /* best-effort */ }
  try { compactNotifyFiles(report); } catch { /* best-effort */ }
  return report;
}
