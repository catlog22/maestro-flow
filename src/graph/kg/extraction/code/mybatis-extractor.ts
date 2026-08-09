// src/graph/kg/extraction/code/mybatis-extractor.ts
// MyBatis XML mapper 提取器:
// select/insert/update/delete 语句 → method node
// include refid → references edge
// 参考: codegraph/src/extraction/mybatis-extractor.ts

import type { LanguageExtractionResult, ExtractedSymbol, ExtractedReference } from './tree-sitter-types.js';
import type { Language } from '../../db/types.js';

interface MybatisStatement {
  type: 'select' | 'insert' | 'update' | 'delete';
  id: string;
  resultType?: string;
  parameterType?: string;
  namespace?: string;
  startLine: number;
  endLine: number;
  content: string;
}

function parseMybatisXml(source: string): { namespace: string; statements: MybatisStatement[] } {
  const statements: MybatisStatement[] = [];
  let namespace = '';

  // 提取 namespace
  const nsMatch = source.match(/<mapper[^>]*namespace=["']([^"']+)["']/);
  if (nsMatch) namespace = nsMatch[1];

  // 提取 SQL 语句
  const stmtRegex = /<(select|insert|update|delete)([^>]*)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = stmtRegex.exec(source)) !== null) {
    const [fullMatch, type, attrs, content] = match;
    const startLine = source.substring(0, match.index).split('\n').length;
    const endLine = source.substring(0, match.index + fullMatch.length).split('\n').length;

    const idMatch = attrs.match(/id=["']([^"']+)["']/);
    const resultTypeMatch = attrs.match(/resultType=["']([^"']+)["']/);
    const paramTypeMatch = attrs.match(/parameterType=["']([^"']+)["']/);

    if (idMatch) {
      statements.push({
        type: type as MybatisStatement['type'],
        id: idMatch[1],
        resultType: resultTypeMatch?.[1],
        parameterType: paramTypeMatch?.[1],
        namespace,
        startLine,
        endLine,
        content,
      });
    }
  }

  return { namespace, statements };
}

export function extractMybatisXml(
  source: string,
  filePath: string,
): LanguageExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const references: ExtractedReference[] = [];
  const edges: Array<{ source: string; target: string; kind: string }> = [];

  const { namespace, statements } = parseMybatisXml(source);

  for (const stmt of statements) {
    const qualifiedName = namespace ? `${namespace}.${stmt.id}` : stmt.id;

    // 语句 → method node
    symbols.push({
      kind: 'method',
      name: stmt.id,
      qualifiedName,
      filePath,
      language: 'xml' as Language,
      startLine: stmt.startLine,
      endLine: stmt.endLine,
      startColumn: 1,
      endColumn: 1,
      docstring: `${stmt.type} statement`,
      signature: `${stmt.type} ${qualifiedName}(${stmt.parameterType ?? 'void'}) → ${stmt.resultType ?? 'void'}`,
      visibility: 'public',
      isExported: true,
      isAsync: false,
      isStatic: false,
      isAbstract: false,
      decorators: [],
      typeParameters: [],
    });

    // include refid → references edge
    const includeRegex = /<include\s+refid=["']([^"']+)["']/g;
    let incMatch: RegExpExecArray | null;
    while ((incMatch = includeRegex.exec(stmt.content)) !== null) {
      references.push({
        fromSymbolName: qualifiedName,
        fromSymbolId: `code:${filePath}:${qualifiedName}`,
        referenceName: incMatch[1],
        referenceKind: 'references',
        line: stmt.startLine,
        col: (incMatch.index ?? 0) + 1,
        filePath,
        language: 'xml' as Language,
      });
    }
  }

  return { symbols, references, structuralReferences: [], edges };
}
