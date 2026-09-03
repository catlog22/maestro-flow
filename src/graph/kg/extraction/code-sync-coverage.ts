// src/graph/kg/extraction/code-sync-coverage.ts
// 代码索引覆盖率诊断 — 把“扫到 0 个可索引文件”与“这个仓库本来就没代码”区分开。
//
// 背景：扩展名未注册到任何语言的文件，过去在计入 filesScanned **之前**就被丢弃，
// 于是 orchestrator 的 `filesExtracted !== filesScanned` 守卫恒等于 0 !== 0，
// sync 打印 "+0 nodes" 并以 0 退出。调用方无法从输出判断是成功还是完全没索引。

import type { CodeSyncCoverage } from '../db/types.js';

export interface CoverageTotals {
  filesScanned: number;
  filesExtracted: number;
  filesUnsupported: number;
  filesPartialParse: number;
  unsupportedExtensions: Map<string, number>;
}

/** 扩展名分布按文件数降序截断，避免一个含大量数据的仓库把诊断行撑爆。 */
const MAX_REPORTED_EXTENSIONS = 8;

export function emptyCoverageTotals(): CoverageTotals {
  return {
    filesScanned: 0,
    filesExtracted: 0,
    filesUnsupported: 0,
    filesPartialParse: 0,
    unsupportedExtensions: new Map<string, number>(),
  };
}

export function addUnsupportedExtensions(
  totals: CoverageTotals,
  extensions: Record<string, number>,
): void {
  for (const [ext, count] of Object.entries(extensions)) {
    totals.unsupportedExtensions.set(ext, (totals.unsupportedExtensions.get(ext) ?? 0) + count);
  }
}

function topExtensions(totals: CoverageTotals): Array<[string, number]> {
  return [...totals.unsupportedExtensions.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_REPORTED_EXTENSIONS);
}

export function summarizeCodeSyncCoverage(totals: CoverageTotals): CodeSyncCoverage {
  const reported: Record<string, number> = {};
  for (const [ext, count] of topExtensions(totals)) reported[ext] = count;
  return {
    filesScanned: totals.filesScanned,
    filesExtracted: totals.filesExtracted,
    filesUnsupported: totals.filesUnsupported,
    unsupportedExtensions: reported,
    filesPartialParse: totals.filesPartialParse,
  };
}

/**
 * 没有任何文件被识别为受支持语言，但确实发现了带扩展名的文件 —— 这是
 * “语言未注册”而非“仓库没代码”的特征。返回 null 表示无需告警。
 */
export function unsupportedLanguageWarning(totals: CoverageTotals): string | null {
  if (totals.filesScanned > 0) return null;
  if (totals.filesUnsupported === 0) return null;
  const listed = topExtensions(totals)
    .map(([ext, count]) => `${ext} (${count})`)
    .join(', ');
  const truncated = totals.unsupportedExtensions.size > MAX_REPORTED_EXTENSIONS
    ? ` +${totals.unsupportedExtensions.size - MAX_REPORTED_EXTENSIONS} more`
    : '';
  return 'No file under the scanned source directories matched a registered language, '
    + `so the code graph was NOT indexed. Skipped by extension: ${listed}${truncated}. `
    + 'If these are source files, the language needs registering in '
    + 'supported-source-extensions.ts and an extractor in languages/index.ts.';
}

/**
 * 文件已入库但 grammar 报告了非致命覆盖缺口。数量必须披露，否则一个只会部分
 * 解析的语言（例如空 `struct {}` 会让 tree-sitter-zig 插入 MISSING identifier）
 * 看起来和完全解析没有任何区别。
 */
export function partialParseWarning(totals: CoverageTotals): string | null {
  if (totals.filesScanned === 0 || totals.filesPartialParse === 0) return null;
  const pct = ((totals.filesPartialParse / totals.filesScanned) * 100).toFixed(1);
  return `${totals.filesPartialParse}/${totals.filesScanned} file(s) (${pct}%) indexed with a `
    + 'non-fatal grammar parse gap; symbols inside the affected construct may be missing. '
    + 'Per-file detail is retained in the files table.';
}
