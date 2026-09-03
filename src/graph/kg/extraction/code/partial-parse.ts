// src/graph/kg/extraction/code/partial-parse.ts
// tree-sitter 报告非致命语法错误时，把它记成可诊断的 diagnostic。
//
// 这里曾经是逐语言硬编码的 `language === 'objc' && /\.mm$/` 分支，并且在
// parse-worker.ts 与 worker-parser.ts 各写了一遍。任何 grammar 只要对某个合法
// 构造报错（例如 tree-sitter-zig 对空 `struct {}` / `union {}` 会插入
// MISSING identifier），该语言的仓库就会看起来和完全解析一模一样。
// 统一在这里判定，两个调用点共用。

import type { Language } from '../../db/types.js';
import type { LanguageExtractionResult } from './tree-sitter-types.js';

/** 保持既有 Objective-C 文案不变，它有自己的回归测试锚定这个字符串。 */
function grammarLabel(language: Language, filePath: string): string {
  if (language === 'objc' && /\.mm$/i.test(filePath)) {
    return 'objcxx-partial-parse: tree-sitter Objective-C grammar reported syntax errors';
  }
  return `${language}-partial-parse: tree-sitter ${language} grammar reported syntax errors`;
}

/**
 * 把 `tree.rootNode.hasError` 附加到提取结果上。返回同一对象以便链式使用。
 * diagnostics 只写入 files 表的 errors 列，不影响入库，因此对任何语言都安全。
 */
export function withPartialParseDiagnostics(
  result: LanguageExtractionResult,
  language: Language,
  filePath: string,
  treeHasError: boolean,
): LanguageExtractionResult {
  if (!treeHasError) return result;
  result.diagnostics = [...(result.diagnostics ?? []), grammarLabel(language, filePath)];
  return result;
}

/** 从未知形状的 tree 上安全读取 hasError（web-tree-sitter 的 typing 不含该字段）。 */
export function treeReportsError(tree: unknown): boolean {
  return (tree as { rootNode?: { hasError?: boolean } })?.rootNode?.hasError === true;
}
