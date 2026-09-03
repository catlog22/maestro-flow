import { describe, it, expect } from 'vitest';
import {
  emptyCoverageTotals,
  addUnsupportedExtensions,
  summarizeCodeSyncCoverage,
  unsupportedLanguageWarning,
  partialParseWarning,
  type CoverageTotals,
} from '../extraction/code-sync-coverage.js';

// ---------------------------------------------------------------------------
// 回归背景：扩展名未注册的文件在计入 filesScanned 之前就被丢弃，导致
// `maestro kg sync --source codegraph --src src` 对一个 551 文件的 Zig 仓库
// 打印 "+0 nodes" 并以 0 退出。这些测试锁住"零索引必须可见"。
// ---------------------------------------------------------------------------

function totalsWithUnsupported(ext: string, count: number): CoverageTotals {
  const totals = emptyCoverageTotals();
  totals.filesUnsupported = count;
  addUnsupportedExtensions(totals, { [ext]: count });
  return totals;
}

describe('code sync coverage', () => {
  it('names the skipped extension when a directed scan indexed nothing', () => {
    const totals = totalsWithUnsupported('.zig', 551);
    const warning = unsupportedLanguageWarning(totals);
    expect(warning).toContain('.zig (551)');
    expect(warning).toContain('supported-source-extensions.ts');
  });

  it('stays silent when files were scanned, even if some extensions were skipped', () => {
    const totals = totalsWithUnsupported('.md', 40);
    totals.filesScanned = 120;
    expect(unsupportedLanguageWarning(totals)).toBeNull();
  });

  it('stays silent for a genuinely empty directory (nothing found at all)', () => {
    // 没有文件被丢弃时索引为空是正确结果，不是故障。
    expect(unsupportedLanguageWarning(emptyCoverageTotals())).toBeNull();
  });

  it('truncates the extension histogram instead of dumping thousands of keys', () => {
    const totals = emptyCoverageTotals();
    const histogram: Record<string, number> = {};
    for (let i = 0; i < 30; i++) histogram[`.ext${i}`] = i + 1;
    totals.filesUnsupported = 465;
    addUnsupportedExtensions(totals, histogram);

    const summary = summarizeCodeSyncCoverage(totals);
    expect(Object.keys(summary.unsupportedExtensions).length).toBe(8);
    // 降序：最大的桶必须留在报告里
    expect(summary.unsupportedExtensions['.ext29']).toBe(30);
    const warning = unsupportedLanguageWarning(totals);
    expect(warning).toContain('+22 more');
  });

  it('reports partial-parse coverage so a partially parsed language is distinguishable', () => {
    const totals = emptyCoverageTotals();
    totals.filesScanned = 551;
    totals.filesExtracted = 551;
    totals.filesPartialParse = 29;
    const warning = partialParseWarning(totals);
    expect(warning).toContain('29/551');
    expect(warning).toContain('5.3%');
  });

  it('does not report partial parses for a scan that produced nothing', () => {
    const totals = emptyCoverageTotals();
    totals.filesPartialParse = 3;
    expect(partialParseWarning(totals)).toBeNull();
  });

  it('accumulates per-directory stats into one coverage summary', () => {
    const totals = emptyCoverageTotals();
    for (const stats of [
      { filesScanned: 10, filesExtracted: 10, filesUnsupported: 2, unsupportedExtensions: { '.zig': 2 } },
      { filesScanned: 0, filesExtracted: 0, filesUnsupported: 5, unsupportedExtensions: { '.zig': 4, '.md': 1 } },
    ]) {
      totals.filesScanned += stats.filesScanned;
      totals.filesExtracted += stats.filesExtracted;
      totals.filesUnsupported += stats.filesUnsupported;
      addUnsupportedExtensions(totals, stats.unsupportedExtensions);
    }
    const summary = summarizeCodeSyncCoverage(totals);
    expect(summary.filesScanned).toBe(10);
    expect(summary.filesUnsupported).toBe(7);
    expect(summary.unsupportedExtensions['.zig']).toBe(6);
  });
});
