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

// 提取 JSDoc 注释 — 符号前导的 /** ... */ comment 节点
function extractDocstring(node: any): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 导出声明的 JSDoc 挂在 export_statement 父节点之前，而非声明节点本身。
  let target = node;
  if (target.parent && target.parent.type === 'export_statement') {
    target = target.parent;
  }
  const prev = target.previousNamedSibling ?? target.previousSibling;
  if (!prev || prev.type !== 'comment') return '';
  const text: string = prev.text || '';
  if (!text.startsWith('/**')) return '';
  // 剥离注释标记: /** 、 */ 、每行前导 *
  return text
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

// 提取装饰器名称
// 装饰器可能位于: (a) export_statement 的直接子节点 (导出类/函数),
// (b) 声明节点自身子节点或 modifiers 字段 (方法/参数装饰器)。
// '@Component({...})' → 'Component'; '@Injectable' → 'Injectable'
function extractDecorators(node: any): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const decorators: string[] = [];
  const seen = new Set<string>();

  const addDecorator = (raw: string): void => {
    const name = raw.replace(/^@/, '').split(/[(\s]/)[0];
    if (name && !seen.has(name)) {
      seen.add(name);
      decorators.push(name);
    }
  };

  const collectFrom = (container: any): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!container) return;
    for (const child of container.children ?? []) {
      if (child.type === 'decorator') addDecorator(child.text || '');
    }
    const modifiersNode = container.childForFieldName?.('modifiers');
    if (modifiersNode) {
      for (const mod of modifiersNode.children ?? []) {
        if (mod.type === 'decorator') addDecorator(mod.text || '');
      }
    }
  };

  collectFrom(node);
  if (node.parent && node.parent.type === 'export_statement') {
    collectFrom(node.parent);
  }
  return decorators;
}

// 提取泛型参数名 — <T, U extends X> → ['T', 'U']
function extractTypeParameters(node: any): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const typeParamsNode = node.childForFieldName?.('type_parameters');
  if (!typeParamsNode) return [];
  const names: string[] = [];
  for (const tp of typeParamsNode.namedChildren ?? []) {
    if (tp.type === 'type_parameter') {
      const nameNode = tp.childForFieldName?.('name');
      const name = nameNode?.text ?? tp.children?.find((c: any) => c.type === 'type_identifier')?.text; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (name) names.push(name);
    }
  }
  return names;
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
        docstring: extractDocstring(node),
        signature: firstLine,
        visibility: mods.visibility,
        isExported: mods.isExported,
        isAsync: mods.isAsync,
        isStatic: mods.isStatic,
        isAbstract: mods.isAbstract,
        decorators: extractDecorators(node),
        typeParameters: extractTypeParameters(node),
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
