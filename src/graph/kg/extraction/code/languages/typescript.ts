// src/graph/kg/extraction/code/languages/typescript.ts
// TypeScript/JavaScript 语言提取器
// 参考: codegraph/src/extraction/languages/typescript.ts

import type { LanguageExtractor, LanguageExtractionResult, ExtractedSymbol, ExtractedReference } from '../tree-sitter-types.js';
import type { Language } from '../../../db/types.js';

// TypeScript tree-sitter 节点类型 → 符号 kind 映射
const TS_NODE_TYPE_MAP: Record<string, string> = {
  'function_declaration': 'function',
  'function_signature': 'function',
  'generator_function_declaration': 'function',
  'arrow_function': 'function',
  'method_definition': 'method',
  'method_signature': 'method',
  'class_declaration': 'class',
  'class': 'class',
  'interface_declaration': 'interface',
  'type_alias_declaration': 'type_alias',
  'enum_declaration': 'enum',
  'enum_assignment': 'enum_member',
  'variable_declaration': 'variable',
  'lexical_declaration': 'variable',
  'export_statement': 'export',
  'import_statement': 'import',
  'property_signature': 'property',
  'property_declaration': 'property',
  'field_definition': 'field',
  'get_accessor': 'method',
  'set_accessor': 'method',
  'abstract_method_signature': 'method',
  'abstract_class_declaration': 'class',
  'namespace_declaration': 'namespace',
  'module_declaration': 'module',
};

// 提取符号名 — 处理各种 TS/JS 节点
function extractName(node: any): string | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const nameNode = node.childForFieldName?.('name') ?? node.children?.find((c: any) => c.type === 'identifier' || c.type === 'type_identifier'); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (nameNode) return nameNode.text;
  return null;
}

// 提取修饰符 (export/static/async/abstract)
function extractModifiers(node: any): { isExported: boolean; isStatic: boolean; isAsync: boolean; isAbstract: boolean; visibility: string } { // eslint-disable-line @typescript-eslint/no-explicit-any
  let isExported = false, isStatic = false, isAsync = false, isAbstract = false;
  let visibility = '';

  // 检查父节点是否是 export_statement
  const parent = node.parent;
  if (parent && parent.type === 'export_statement') {
    isExported = true;
  }

  // 检查 modifiers 子节点 (class method 的修饰符)
  const modifiersNode = node.childForFieldName?.('modifiers');
  if (modifiersNode) {
    for (const mod of modifiersNode.children ?? []) {
      switch (mod.type) {
        case 'export': isExported = true; break;
        case 'static': isStatic = true; break;
        case 'async': isAsync = true; break;
        case 'abstract': isAbstract = true; break;
        case 'public': visibility = 'public'; break;
        case 'private': visibility = 'private'; break;
        case 'protected': visibility = 'protected'; break;
        case 'readonly': break;
      }
    }
  }

  // 检查 async 关键字 (arrow function)
  if (!isAsync) {
    const firstChild = node.children?.[0];
    if (firstChild?.type === 'async') isAsync = true;
  }

  return { isExported, isStatic, isAsync, isAbstract, visibility };
}

function traverse(
  node: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  filePath: string,
  language: Language,
  symbols: ExtractedSymbol[],
  references: ExtractedReference[],
  parentQualifiedName: string,
): void {
  const kind = TS_NODE_TYPE_MAP[node.type];
  const startRow = node.startPosition.row + 1;  // tree-sitter 0-indexed → 1-indexed
  const endRow = node.endPosition.row + 1;

  if (kind && kind !== 'import' && kind !== 'export') {
    const name = extractName(node);
    if (name) {
      const qualifiedName = parentQualifiedName ? `${parentQualifiedName}.${name}` : name;
      const mods = extractModifiers(node);

      // 提取 signature (简化版 — 取节点第一行文本)
      const nodeText = node.text || '';
      const firstLine = nodeText.split('\n')[0]?.trim().substring(0, 200) ?? '';

      symbols.push({
        kind,
        name,
        qualifiedName,
        filePath,
        language,
        startLine: startRow,
        endLine: endRow,
        startColumn: node.startPosition.column + 1,
        endColumn: node.endPosition.column + 1,
        docstring: '',  // TODO: 提取 JSDoc 注释
        signature: firstLine,
        visibility: mods.visibility,
        isExported: mods.isExported,
        isAsync: mods.isAsync,
        isStatic: mods.isStatic,
        isAbstract: mods.isAbstract,
        decorators: [],  // TODO: 提取 @decorator
        typeParameters: [],  // TODO: 提取 <T>
      });

      // 递归处理子节点 (类成员等)
      const childFields = node.namedChildren ?? [];
      for (const child of childFields) {
        // body 块内的声明作为子符号
        if (['class_body', 'object', 'block', 'declaration_list', 'statement_block'].includes(child.type)) {
          traverseChildren(child, filePath, language, symbols, references, qualifiedName);
        } else if (TS_NODE_TYPE_MAP[child.type]) {
          traverse(child, filePath, language, symbols, references, qualifiedName);
        } else {
          traverseChildren(child, filePath, language, symbols, references, qualifiedName);
        }
      }
      return;
    }
  }

  // import_statement — 记录引用
  if (node.type === 'import_statement') {
    const sourceNode = node.childForFieldName?.('source');
    if (sourceNode) {
      references.push({
        fromSymbolName: '<module>',
        fromSymbolId: `${filePath}:<module>`,
        referenceName: sourceNode.text.replace(/['"]/g, ''),
        referenceKind: 'imports',
        line: startRow,
        col: node.startPosition.column + 1,
        filePath,
        language,
      });
    }
  }

  traverseChildren(node, filePath, language, symbols, references, parentQualifiedName);
}

function traverseChildren(
  node: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  filePath: string,
  language: Language,
  symbols: ExtractedSymbol[],
  references: ExtractedReference[],
  parentQualifiedName: string,
): void {
  for (const child of node.namedChildren ?? []) {
    traverse(child, filePath, language, symbols, references, parentQualifiedName);
  }
}

function extractTypeScriptFamily(
  tree: Parameters<LanguageExtractor['extract']>[0],
  filePath: string,
  language: Language,
): LanguageExtractionResult {
    const symbols: ExtractedSymbol[] = [];
    const references: ExtractedReference[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rootNode = (tree as any).rootNode;
    traverse(rootNode, filePath, language, symbols, references, '');

    return { symbols, references, edges: [] };
}

export const typescriptExtractor: LanguageExtractor = {
  language: 'typescript' as Language,
  grammarName: 'typescript',
  nodeTypeMap: TS_NODE_TYPE_MAP,
  extract(tree, _sourceCode, filePath): LanguageExtractionResult {
    return extractTypeScriptFamily(tree, filePath, 'typescript' as Language);
  },
};

// JavaScript 复用 TypeScript 提取器 (语法兼容)
export const javascriptExtractor: LanguageExtractor = {
  ...typescriptExtractor,
  language: 'javascript' as Language,
  extract(tree, _sourceCode, filePath): LanguageExtractionResult {
    return extractTypeScriptFamily(tree, filePath, 'javascript' as Language);
  },
};

export const tsxExtractor: LanguageExtractor = {
  ...typescriptExtractor,
  language: 'tsx' as Language,
  extract(tree, _sourceCode, filePath): LanguageExtractionResult {
    return extractTypeScriptFamily(tree, filePath, 'tsx' as Language);
  },
};

export const jsxExtractor: LanguageExtractor = {
  ...javascriptExtractor,
  language: 'jsx' as Language,
  extract(tree, _sourceCode, filePath): LanguageExtractionResult {
    return extractTypeScriptFamily(tree, filePath, 'jsx' as Language);
  },
};
