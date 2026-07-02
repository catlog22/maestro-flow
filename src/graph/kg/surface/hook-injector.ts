// src/graph/kg/surface/hook-injector.ts — 统一 Hook 注入器
// 参考: plan-maestrograph.md R7 — 替代现有 5 个 hook 的单一注入器
// D5.2: 灰度切换 + D5.3: CodeGraph 共存互斥

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getKgDatabasePath } from '../db/connection.js';
import { buildContext, getAgentCategories } from '../query/context-builder.js';
import type { BuiltContext, ContextSection } from '../query/context-builder.js';
import { precheckKg } from './mcp-tools.js';

// ---------------------------------------------------------------------------
// 注入结果
// ---------------------------------------------------------------------------

export interface InjectionResult {
  inject: boolean;
  content?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// 统一注入入口
// ---------------------------------------------------------------------------

/**
 * 统一 hook 注入 — 替代现有 5 个 hook
 *
 * 现有 hook:
 *   keyword-spec-injector  (UserPromptSubmit)
 *   spec-injector          (PreToolUse:Agent)
 *   kg-context-injector    (PreToolUse:Agent)
 *   domain-injector        (集成在 keyword-spec-injector)
 *   wiki-role-loader       (集成在 spec-injector)
 *
 * 统一后:
 *   kg-unified-injector    (UserPromptSubmit + PreToolUse:Agent)
 *     → 单次 KG 查询
 *     → 按 source_type 分组组装 sections
 *     → context budget 统一管控
 *     → 输出 <maestro-context> 包含所有层
 *
 * D5.2: 灰度切换 — 通过 toggle 控制启用/禁用
 * D5.3: 共存互斥 — 当统一 hook 活跃时, 旧 hook 自动让步
 */
export async function evaluateUnifiedInjection(
  prompt: string,
  agentType: string | null,  // null = UserPromptSubmit, string = PreToolUse:Agent
  projectPath: string,
  sessionId: string,
): Promise<InjectionResult> {
  // D5.3: 互斥检测 — 检查旧 hook 是否应该让步
  if (!isUnifiedInjectorEnabled(projectPath)) {
    return { inject: false, reason: 'unified-injector-disabled' };
  }

  // Precheck — D4.4 降级策略
  const check = precheckKg(projectPath);
  if (check.status === 'uninitialized') {
    // 降级到旧 hook (如果可用)
    return { inject: false, reason: 'kg-uninitialized' };
  }

  // D6.3: 快速损坏检测
  if (!quickHealthCheck(projectPath)) {
    return { inject: false, reason: 'kg-corrupted' };
  }

  try {
    const { MaestroGraph } = await import('../engine.js');
    const mg = await MaestroGraph.open(projectPath);

    let context: Awaited<ReturnType<typeof buildContext>>;
    try {
      const queries = mg.getQueryBuilder();

      context = buildContext(queries, prompt, {
        expandDepth: 1,
        agentType: agentType ?? undefined,
      });

      if (agentType) {
        const categories = getAgentCategories(agentType);
        if (categories.length > 0) {
          const roleSpecs = queries.searchKnowledgeFTS(agentType, {
            limit: 5,
            sourceTypes: ['spec' as any], // eslint-disable-line @typescript-eslint/no-explicit-any
          });
          if (roleSpecs.length > 0) {
            context.sections.push({
              label: `role-specs[${categories.join(',')}]`,
              lines: roleSpecs.map(s => `[spec:${s.category}] ${s.name}: ${s.definition.substring(0, 200)}`),
              sourceType: 'spec',
              relevance: 5,
            });
          }
        }
      }
    } finally {
      mg.close();
    }

    if (context.sections.length === 0) {
      return { inject: false, reason: 'no-relevant-context' };
    }

    return { inject: true, content: formatMaestroContext(context) };
  } catch (err) {
    if (process.env.MAESTRO_DEBUG === '1') {
      console.warn('[MaestroGraph] Unified injection error:', err);
    }
    return { inject: false, reason: `error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// 格式化输出 — <maestro-context> 包
// ---------------------------------------------------------------------------

function formatMaestroContext(context: BuiltContext): string {
  const lines: string[] = ['<maestro-context>'];

  for (const section of context.sections) {
    lines.push(`  <section label="${section.label}">`);
    for (const line of section.lines) {
      lines.push(`    ${line}`);
    }
    lines.push('  </section>');
  }

  lines.push(`  <!-- ${context.summary.codeSymbols + context.summary.domainTerms + context.summary.specRules + context.summary.knowhowDocs} nodes, ${context.totalChars} chars -->`);
  lines.push('</maestro-context>');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// D5.2: 灰度切换
// ---------------------------------------------------------------------------

/**
 * 检查统一注入器是否启用
 * 优先级: 环境变量 > hooks config > 默认启用
 */
function isUnifiedInjectorEnabled(projectPath: string): boolean {
  // 环境变量覆盖
  if (process.env.MAESTRO_KG_UNIFIED_INJECTOR === 'false') return false;
  if (process.env.MAESTRO_KG_UNIFIED_INJECTOR === 'true') return true;

  // 检查 .workflow/hooks.json toggle
  try {
    const hooksPath = resolve(projectPath, '.workflow', 'hooks.json');
    if (existsSync(hooksPath)) {
      const config = JSON.parse(readFileSync(hooksPath, 'utf-8'));
      if (config.toggles?.kgUnifiedInjector === false) return false;
    }
  } catch { /* ignore */ }

  // 默认启用 (当 maestro.db 存在时)
  return existsSync(getKgDatabasePath(projectPath));
}

// ---------------------------------------------------------------------------
// D6.3: 快速损坏检测 (< 50ms)
// ---------------------------------------------------------------------------

const _healthCache = new Map<string, { ts: number; ok: boolean }>();
const HEALTH_CACHE_TTL = 60_000; // 60 秒

function quickHealthCheck(projectPath: string): boolean {
  const now = Date.now();
  const cacheKey = projectPath;
  const cached = _healthCache.get(cacheKey);
  if (cached && now - cached.ts < HEALTH_CACHE_TTL) {
    return cached.ok;
  }

  try {
    const dbPath = getKgDatabasePath(projectPath);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const qc = db.prepare('PRAGMA quick_check(1)').get();
    const ok = qc && (qc as Record<string, unknown>).quick_check === 'ok';
    db.close();
    _healthCache.set(cacheKey, { ts: now, ok: Boolean(ok) });
    return Boolean(ok);
  } catch {
    _healthCache.set(cacheKey, { ts: now, ok: false });
    return false;
  }
}

// ---------------------------------------------------------------------------
// D5.3: 旧 hook 互斥检测
// ---------------------------------------------------------------------------

/**
 * 供旧 hook 调用 — 检测统一注入器是否活跃
 * 如果活跃, 旧 hook 应返回 { inject: false, reason: 'deferred-to-unified' }
 */
export function isUnifiedInjectorActive(projectPath: string): boolean {
  return isUnifiedInjectorEnabled(projectPath) && existsSync(getKgDatabasePath(projectPath));
}