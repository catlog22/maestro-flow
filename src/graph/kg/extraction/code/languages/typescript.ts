// src/graph/kg/extraction/code/languages/typescript.ts
// TypeScript/JavaScript 语言提取器
// 参考: codegraph/src/extraction/languages/typescript.ts

import { makeImportReference, type LanguageExtractor, type LanguageExtractionResult, type ExtractedSymbol, type ExtractedReference } from '../tree-sitter-types.js';
import type { Language } from '../../../db/types.js';
import type { ImportReference } from '../../../resolution/structural-reference.js';
import { makeCodeNodeId, makeFileNodeId } from '../tree-sitter-types.js';

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
// 注意: arrow_function 无 name 字段, 绝不可回退取第一个 identifier (那是参数名),
// 否则 `item => ...` 会被误建为名为 item 的假函数符号。具名箭头函数
// (const f = (...) => ...) 由 variable_declarator 分支负责建符号。
function extractName(node: any): string | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const nameNode = node.childForFieldName?.('name');
  if (nameNode) return nameNode.text;
  if (node.type === 'arrow_function' || node.type === 'function_expression' || node.type === 'function') {
    return null;
  }
  const fallback = node.children?.find((c: any) => c.type === 'identifier' || c.type === 'type_identifier'); // eslint-disable-line @typescript-eslint/no-explicit-any
  return fallback ? fallback.text : null;
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

// 从 call_expression / JSX 元素提取被调用名 (calls 引用)
function collectCallReference(
  node: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  filePath: string,
  language: Language,
  references: ExtractedReference[],
): void {
  const startRow = node.startPosition.row + 1;
  const col = node.startPosition.column + 1;
  const fileNodeId = makeFileNodeId(filePath);

  let callee: string | null = null;
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName?.('function') ?? node.namedChildren?.[0];
    if (fn) {
      if (fn.type === 'identifier') {
        callee = fn.text;
      } else if (fn.type === 'member_expression') {
        // obj.method() → 记录 method; this.method() / super.method() 也记录 (解析阶段过滤)
        const prop = fn.childForFieldName?.('property');
        if (prop && (prop.type === 'property_identifier' || prop.type === 'identifier' || prop.type === 'private_property_identifier')) {
          callee = prop.text;
        }
      }
    }
  } else if (node.type === 'jsx_self_closing_element' || node.type === 'jsx_opening_element') {
    // <Foo /> / <ns.Foo> → 记录 Foo
    const name = node.childForFieldName?.('name');
    if (name && (name.type === 'identifier' || name.type === 'nested_identifier')) {
      const text = name.text ?? '';
      callee = text.split('.').pop() || null;
    }
  }

  if (callee) {
    references.push({
      fromSymbolName: '<file>',
      fromSymbolId: fileNodeId,
      referenceName: callee,
      referenceKind: 'calls',
      line: startRow,
      col,
      filePath,
      language,
    });
  }
}

// 构建一条 contains 边 (父符号 → 子符号)
function pushContainsEdge(
  edges: LanguageExtractionResult['edges'],
  filePath: string,
  parentQualifiedName: string,
  qualifiedName: string,
  line: number,
): void {
  if (!parentQualifiedName) return;
  edges.push({
    source: makeCodeNodeId(filePath, parentQualifiedName),
    target: makeCodeNodeId(filePath, qualifiedName),
    kind: 'contains',
    line,
  });
}

function pushSymbol(
  node: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  kind: string,
  name: string,
  filePath: string,
  language: Language,
  parentQualifiedName: string,
  symbols: ExtractedSymbol[],
  edges: LanguageExtractionResult['edges'],
): string | null {
  const startRow = node.startPosition.row + 1;
  const endRow = node.endPosition.row + 1;
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

  pushContainsEdge(edges, filePath, parentQualifiedName, qualifiedName, startRow);
  return qualifiedName;
}

function traverse(
  node: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  filePath: string,
  language: Language,
  symbols: ExtractedSymbol[],
  references: ExtractedReference[],
  importReferences: ImportReference[],
  edges: LanguageExtractionResult['edges'],
  parentQualifiedName: string,
): void {
  const startRow = node.startPosition.row + 1;  // tree-sitter 0-indexed → 1-indexed
  const endRow = node.endPosition.row + 1;

  // calls / JSX 引用收集 (call_expression / jsx 元素)
  if (node.type === 'call_expression' || node.type === 'jsx_self_closing_element' || node.type === 'jsx_opening_element') {
    collectCallReference(node, filePath, language, references);
  }

  // 具名箭头函数 / 函数表达式: const f = (...) => ... — 从 variable_declarator 取 name
  // (arrow_function 本身不建符号, 避免参数名被误取)
  if (node.type === 'variable_declarator') {
    const value = node.childForFieldName?.('value');
    if (value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
      const name = node.childForFieldName?.('name')?.text;
      if (name) {
        const qualifiedName = pushSymbol(node, 'function', name, filePath, language, parentQualifiedName, symbols, edges);
        if (qualifiedName) {
          traverseChildren(value, filePath, language, symbols, references, importReferences, edges, qualifiedName);
        }
      }
    }
  }

  // arrow_function 自身永不建符号 (参数名会被误取)
  if (node.type === 'arrow_function' || node.type === 'function_expression') {
    traverseChildren(node, filePath, language, symbols, references, importReferences, edges, parentQualifiedName);
    return;
  }

  const kind = TS_NODE_TYPE_MAP[node.type];

  if (kind && kind !== 'import' && kind !== 'export') {
    const name = extractName(node);
    if (name) {
      const qualifiedName = pushSymbol(node, kind, name, filePath, language, parentQualifiedName, symbols, edges);
      if (!qualifiedName) return;

      // 递归处理子节点 (类成员等)
      const childFields = node.namedChildren ?? [];
      for (const child of childFields) {
        // body 块内的声明作为子符号
        if (['class_body', 'object', 'block', 'declaration_list', 'statement_block'].includes(child.type)) {
          traverseChildren(child, filePath, language, symbols, references, importReferences, edges, qualifiedName);
        } else if (TS_NODE_TYPE_MAP[child.type] || child.type === 'variable_declarator') {
          traverse(child, filePath, language, symbols, references, importReferences, edges, qualifiedName);
        } else {
          traverseChildren(child, filePath, language, symbols, references, importReferences, edges, qualifiedName);
        }
      }
      return;
    }
  }

  // import_statement — 记录引用 (from 锚点 = 本文件 file 节点)
  if (node.type === 'import_statement') {
    const sourceNode = node.childForFieldName?.('source');
    if (sourceNode) {
      const rawTarget = sourceNode.text.replace(/['"]/g, '');
      references.push({
        fromSymbolName: '<file>',
        fromSymbolId: makeFileNodeId(filePath),
        referenceName: rawTarget,
        referenceKind: 'imports',
        line: startRow,
        col: node.startPosition.column + 1,
        filePath,
        language,
      });
      importReferences.push(makeImportReference(
        filePath, rawTarget, startRow, node.startPosition.column + 1,
      ));
    }
  }

  traverseChildren(node, filePath, language, symbols, references, importReferences, edges, parentQualifiedName);
}

function traverseChildren(
  node: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  filePath: string,
  language: Language,
  symbols: ExtractedSymbol[],
  references: ExtractedReference[],
  importReferences: ImportReference[],
  edges: LanguageExtractionResult['edges'],
  parentQualifiedName: string,
): void {
  for (const child of node.namedChildren ?? []) {
    traverse(child, filePath, language, symbols, references, importReferences, edges, parentQualifiedName);
  }
}

function extractTypeScriptFamily(
  tree: Parameters<LanguageExtractor['extract']>[0],
  filePath: string,
  language: Language,
): LanguageExtractionResult {
    const symbols: ExtractedSymbol[] = [];
    const references: ExtractedReference[] = [];
    const importReferences: ImportReference[] = [];
    const edges: LanguageExtractionResult['edges'] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rootNode = (tree as any).rootNode;
    traverse(rootNode, filePath, language, symbols, references, importReferences, edges, '');

    return { symbols, references, importReferences, structuralReferences: [], edges };
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
