// src/graph/kg/extraction/code/svelte-extractor.ts
// Svelte 提取器: script 块 + 模板函数调用 + PascalCase 组件引用
// Svelte 5 rune 过滤 ($state/$derived/$effect 不产生节点)
// 参考: codegraph/src/extraction/svelte-extractor.ts

import type { LanguageExtractionResult, ExtractedSymbol, ExtractedReference } from './tree-sitter-types.js';
import type { Language } from '../../db/types.js';
import { getTreeSitterEngine } from './tree-sitter.js';

// Svelte 5 runes — 这些是编译器指令, 不产生符号
const SVELTE_RUNES = new Set([
  '$state', '$derived', '$effect', '$props', '$bindable',
  '$inspect', '$host', '$effect.pre', '$effect.root',
]);

interface SvelteBlock {
  type: 'script' | 'markup' | 'style';
  content: string;
  startLine: number;
  lang?: string;
}

function parseSvelte(source: string): SvelteBlock[] {
  const blocks: SvelteBlock[] = [];

  // <script> 块
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/;
  const scriptMatch = source.match(scriptRegex);
  if (scriptMatch) {
    const fullMatchIndex = scriptMatch.index ?? 0;
    const startLine = source.substring(0, fullMatchIndex).split('\n').length;
    const tagEnd = source.indexOf('>', fullMatchIndex);
    const contentStart = source.substring(0, tagEnd + 1).split('\n').length;
    const langMatch = scriptMatch[1].match(/lang=["'](\w+)["']/);

    blocks.push({
      type: 'script',
      content: scriptMatch[2],
      startLine: contentStart,
      lang: langMatch?.[1],
    });
  }

  return blocks;
}

export async function extractSvelte(
  source: string,
  filePath: string,
): Promise<LanguageExtractionResult> {
  const blocks = parseSvelte(source);
  const symbols: ExtractedSymbol[] = [];
  const references: ExtractedReference[] = [];
  const edges: Array<{ source: string; target: string; kind: string }> = [];

  const engine = getTreeSitterEngine();

  for (const block of blocks) {
    if (block.type === 'script' && block.content.trim()) {
      const lang: Language = (block.lang === 'ts' || block.lang === 'typescript')
        ? 'typescript' as Language
        : 'javascript' as Language;

      if (engine.isAvailable()) {
        try {
          const tree = await engine.parse(block.content, lang);
          if (tree) {
            try {
              const { typescriptExtractor } = await import('./languages/typescript.js');
              const result = typescriptExtractor.extract(tree, block.content, filePath);

              for (const sym of result.symbols) {
                // 过滤 Svelte 5 runes
                if (SVELTE_RUNES.has(sym.name)) continue;

                sym.startLine += block.startLine - 1;
                sym.endLine += block.startLine - 1;
                symbols.push(sym);
              }
              for (const ref of result.references) {
                ref.line += block.startLine - 1;
                references.push(ref);
              }
            } finally {
              tree.delete();
            }
          }
        } catch (err) {
          if (process.env.MAESTRO_DEBUG === '1') console.warn('[MaestroGraph] Svelte script parse error:', err);
        }
      }
    }
  }

  // 从模板提取 PascalCase 组件引用
  const componentRegex = /<([A-Z][a-zA-Z0-9]*)/g;
  let compMatch: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((compMatch = componentRegex.exec(source)) !== null) {
    const componentName = compMatch[1];
    if (!seen.has(componentName) && !SVELTE_RUNES.has(componentName)) {
      seen.add(componentName);
      const line = source.substring(0, compMatch.index).split('\n').length;
      references.push({
        fromSymbolName: '<markup>',
        fromSymbolId: `${filePath}:<markup>`,
        referenceName: componentName,
        referenceKind: 'imports',
        line,
        col: compMatch.index + 1,
        filePath,
        language: 'svelte' as Language,
      });
    }
  }

  return { symbols, references, edges };
}
