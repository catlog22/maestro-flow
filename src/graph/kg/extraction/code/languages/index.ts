// src/graph/kg/extraction/code/languages/index.ts
// 19 语言提取器注册表
// 参考: codegraph/src/extraction/languages/*.ts (逐文件复用)

import {
  makeCodeNodeId,
  makeFileNodeId,
  makeImportReference as makeStrictImportReference,
  type ExtractedReference,
  type LanguageExtractor,
} from '../tree-sitter-types.js';
import type { Language } from '../../../db/types.js';
import {
  makeStructuralReferenceKey,
  type ImportReference,
  type StructuralOwnerReference,
  type StructuralTypeReference,
} from '../../../resolution/structural-reference.js';
import { typescriptExtractor, javascriptExtractor, tsxExtractor, jsxExtractor } from './typescript.js';
import { SOURCE_EXTENSION_TO_LANGUAGE, sourceExtension } from '../supported-source-extensions.js';

/** Backward-compatible import fact for the generic unresolved-ref pipeline. */
function makeImportReference(
  filePath: string,
  rawTarget: string,
  line: number,
  column: number,
  _importKind: string = 'module',
  languageOverride?: Language,
): ExtractedReference {
  return {
    fromSymbolName: '<file>',
    fromSymbolId: makeFileNodeId(filePath),
    referenceName: rawTarget,
    referenceKind: 'imports',
    line,
    col: column,
    filePath,
    language: languageOverride ?? detectLanguageFromPath(filePath),
  };
}

// ---------------------------------------------------------------------------
// 基础提取器模板 — 用于尚未移植的语言 (复用通用逻辑)
// ---------------------------------------------------------------------------

function createGenericExtractor(language: Language, grammarName: string, nodeTypeMap: Record<string, string>): LanguageExtractor {
  return {
    language,
    grammarName,
    nodeTypeMap,
    extract(tree, sourceCode, filePath): ReturnType<LanguageExtractor['extract']> {
      // 通用提取: 遍历 AST, 按 nodeTypeMap 映射符号
      const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
      const references: import('../tree-sitter-types.js').ExtractedReference[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rootNode = (tree as any).rootNode;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const walk = (node: any, parentQualifiedName: string): void => {
        const kind = nodeTypeMap[node.type];
        const startRow = (node.startPosition?.row ?? 0) + 1;
        const endRow = (node.endPosition?.row ?? 0) + 1;

        if (kind) {
          // 通用 name 提取: 查找 name/identifier 子节点
          const nameNode = node.childForFieldName?.('name') ??
            node.children?.find((c: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
              c.type === 'identifier' || c.type === 'name' || c.type === 'type_identifier');

          if (nameNode?.text) {
            const name = nameNode.text;
            const qualifiedName = parentQualifiedName ? `${parentQualifiedName}.${name}` : name;
            symbols.push({
              kind, name, qualifiedName, filePath, language,
              startLine: startRow, endLine: endRow,
              startColumn: (node.startPosition?.column ?? 0) + 1,
              endColumn: (node.endPosition?.column ?? 0) + 1,
              docstring: '', signature: '',
              visibility: '', isExported: false, isAsync: false,
              isStatic: false, isAbstract: false,
              decorators: [], typeParameters: [],
            });

            // 递归子节点
            for (const child of node.namedChildren ?? []) {
              walk(child, qualifiedName);
            }
            return;
          }
        }

        for (const child of node.namedChildren ?? []) {
          walk(child, parentQualifiedName);
        }
      };

      walk(rootNode, '');
      return { symbols, references, structuralReferences: [], edges: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// 语言提取器注册表
// ---------------------------------------------------------------------------

const EXTRACTOR_REGISTRY: Map<Language, LanguageExtractor> = new Map();

// 已完整移植的提取器
EXTRACTOR_REGISTRY.set('typescript', typescriptExtractor);
EXTRACTOR_REGISTRY.set('javascript', javascriptExtractor);
EXTRACTOR_REGISTRY.set('tsx', tsxExtractor);
EXTRACTOR_REGISTRY.set('jsx', jsxExtractor);

// ---------------------------------------------------------------------------
// 专用提取器辅助 — 基于 createGenericExtractor 增强
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/** 查找子节点 (按 field name 或 type) */
function findChild(node: AnyNode, fieldOrType: string): AnyNode | null {
  return node.childForFieldName?.(fieldOrType) ??
    node.children?.find((c: AnyNode) => c.type === fieldOrType) ?? null;
}

/** 提取节点名 */
function nodeName(node: AnyNode): string | null {
  const n = node.childForFieldName?.('name') ??
    node.children?.find((c: AnyNode) =>
      c.type === 'identifier' || c.type === 'name' || c.type === 'type_identifier'
      || c.type === 'simple_identifier' || c.type === 'field_identifier');
  return n?.text ?? null;
}

/** 取节点第一行文本作为 signature */
function firstLine(node: AnyNode, maxLen = 200): string {
  return (node.text || '').split('\n')[0]?.trim().substring(0, maxLen) ?? '';
}

/** 检查子节点列表是否包含某个 type */
function hasChildType(node: AnyNode, type: string): boolean {
  return node.children?.some((c: AnyNode) => c.type === type) ?? false;
}

/** 收集所有特定 type 的子节点 text */
function collectChildTexts(node: AnyNode, type: string): string[] {
  return (node.children ?? []).filter((c: AnyNode) => c.type === type).map((c: AnyNode) => c.text);
}

/** 获取前一个兄弟节点 (comment 提取用) */
function prevSibling(node: AnyNode): AnyNode | null {
  return node.previousNamedSibling ?? null;
}

/** 通用 make symbol */
function sym(
  kind: string, name: string, qualifiedName: string, filePath: string, lang: Language,
  node: AnyNode, extra: Partial<import('../tree-sitter-types.js').ExtractedSymbol> = {},
): import('../tree-sitter-types.js').ExtractedSymbol {
  return {
    kind, name, qualifiedName, filePath, language: lang,
    startLine: (node.startPosition?.row ?? 0) + 1,
    endLine: (node.endPosition?.row ?? 0) + 1,
    startColumn: (node.startPosition?.column ?? 0) + 1,
    endColumn: (node.endPosition?.column ?? 0) + 1,
    docstring: '', signature: '', visibility: '',
    isExported: false, isAsync: false, isStatic: false, isAbstract: false,
    decorators: [], typeParameters: [],
    ...extra,
  };
}

/** 从 modifier 列表提取可见性/标志 — Java/C#/Kotlin/PHP 等 C-family 语言通用 */
function extractCFamilyModifiers(node: AnyNode): {
  visibility: string; isStatic: boolean; isAbstract: boolean; isAsync: boolean; isExported: boolean;
} {
  let visibility = '', isStatic = false, isAbstract = false, isAsync = false, isExported = false;
  const mods = node.childForFieldName?.('modifiers') ?? findChild(node, 'modifier');
  for (const m of (mods?.children ?? mods?.namedChildren ?? [])) {
    const t = m.type === 'modifier' ? m.text : m.type;
    switch (t) {
      case 'public': visibility = 'public'; break;
      case 'private': visibility = 'private'; break;
      case 'protected': visibility = 'protected'; break;
      case 'internal': visibility = 'internal'; break;
      case 'static': isStatic = true; break;
      case 'abstract': isAbstract = true; break;
      case 'async': isAsync = true; break;
      case 'export': isExported = true; break;
      case 'virtual': break; // C# virtual
      default: break;
    }
  }
  return { visibility, isStatic, isAbstract, isAsync, isExported };
}

/** 提取装饰器/注解名 — 适用于 decorator/annotation 子节点 */
function extractDecorators(node: AnyNode, decoratorType = 'decorator'): string[] {
  const decorators: string[] = [];
  for (const c of (node.namedChildren ?? [])) {
    if (c.type === decoratorType || c.type === 'annotation' || c.type === 'attribute') {
      const nameNode = c.childForFieldName?.('name') ??
        c.children?.find((x: AnyNode) => x.type === 'identifier' || x.type === 'scoped_identifier');
      decorators.push(nameNode?.text ?? c.text);
    }
  }
  // 也检查父 decorated_definition
  if (node.parent?.type === 'decorated_definition') {
    for (const c of (node.parent.namedChildren ?? [])) {
      if (c.type === 'decorator') {
        const nameNode = c.childForFieldName?.('name') ?? findChild(c, 'identifier');
        decorators.push(nameNode?.text ?? c.text);
      }
    }
  }
  return decorators;
}

// ---------------------------------------------------------------------------
// 1. Python — decorators, async def, docstrings, visibility, imports
// ---------------------------------------------------------------------------

const PYTHON_NODE_MAP: Record<string, string> = {
  'function_definition': 'function', 'class_definition': 'class',
  'decorated_definition': '_decorated', // 中间节点, 展开处理
  'import_statement': 'import', 'import_from_statement': 'import',
};

EXTRACTOR_REGISTRY.set('python', {
  language: 'python' as Language, grammarName: 'python', nodeTypeMap: PYTHON_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'python' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — helper(x) / obj.method(y) (call.function → identifier|attribute)
      if (type === 'call') {
        const fn = node.childForFieldName?.('function');
        let callee: string | null = null;
        if (fn) {
          if (fn.type === 'identifier') {
            callee = fn.text;
          } else if (fn.type === 'attribute') {
            const kids = fn.namedChildren ?? [];
            const last = kids[kids.length - 1];
            callee = last?.type === 'identifier' ? last.text : null;
          }
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      // decorated_definition — 展开内部定义, 收集装饰器
      if (type === 'decorated_definition') {
        const decos: string[] = [];
        let inner: AnyNode | null = null;
        for (const c of (node.namedChildren ?? [])) {
          if (c.type === 'decorator') {
            const n = c.childForFieldName?.('name') ?? findChild(c, 'identifier') ?? findChild(c, 'attribute');
            decos.push(n?.text ?? c.text.replace(/^@/, ''));
          } else {
            inner = c;
          }
        }
        if (inner) {
          // 传递装饰器到内部处理
          (inner as AnyNode).__decos = decos;
          walk(inner, parent);
        }
        return;
      }

      if (type === 'function_definition' || type === 'class_definition') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isMethod = type === 'function_definition' && parent !== '';
        const kind = isMethod ? 'method' : (type === 'function_definition' ? 'function' : 'class');

        // 继承引用 — class B(A, C) → superclasses 字段
        if (type === 'class_definition') {
          const supers = node.childForFieldName?.('superclasses');
          for (const sc of (supers?.namedChildren ?? [])) {
            if (sc.type === 'identifier' || sc.type === 'attribute') {
              const baseName = sc.type === 'attribute'
                ? (sc.namedChildren?.[sc.namedChildren.length - 1]?.text ?? sc.text)
                : sc.text;
              if (baseName && baseName !== name) {
                references.push({
                  fromSymbolName: '<file>', fromSymbolId: fileNodeId,
                  referenceName: baseName, referenceKind: 'extends',
                  line: (sc.startPosition?.row ?? 0) + 1, col: (sc.startPosition?.column ?? 0) + 1,
                  filePath, language: lang,
                });
              }
            }
          }
        }

        // decorators
        const decos: string[] = node.__decos ?? [];
        const isAsync = hasChildType(node, 'async');
        const isStatic = decos.includes('staticmethod') || decos.includes('classmethod');
        const isAbstract = decos.includes('abstractmethod');
        const isProperty = decos.includes('property');
        const visibility = name.startsWith('__') && !name.endsWith('__') ? 'private' :
          name.startsWith('_') ? 'protected' : 'public';

        // docstring: first expression_statement > string in body
        let docstring = '';
        const body = findChild(node, 'body') ?? findChild(node, 'block');
        if (body) {
          const firstStmt = body.namedChildren?.[0];
          if (firstStmt?.type === 'expression_statement') {
            const strNode = firstStmt.namedChildren?.[0];
            if (strNode?.type === 'string' || strNode?.type === 'concatenated_string') {
              docstring = strNode.text.replace(/^['\"]{1,3}|['\"]{1,3}$/g, '').trim();
            }
          }
        }

        symbols.push(sym(isProperty ? 'property' : kind, name, qn, filePath, lang, node, {
          visibility, isAsync, isStatic, isAbstract,
          decorators: decos, docstring,
          signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      // import
      if (type === 'import_statement' || type === 'import_from_statement') {
        const mod = findChild(node, 'module_name') ?? findChild(node, 'dotted_name');
        references.push(makeImportReference(filePath, mod?.text ?? node.text,
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1));
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 2. Go — receiver methods, interfaces, structs, goroutine, imports
// ---------------------------------------------------------------------------

const GO_NODE_MAP: Record<string, string> = {
  'function_declaration': 'function', 'method_declaration': 'method',
  'type_declaration': 'type_alias', 'type_spec': 'type_alias',
  'struct_type': 'struct', 'interface_type': 'interface',
  'import_declaration': 'import', 'import_spec': 'import',
};

EXTRACTOR_REGISTRY.set('go', {
  language: 'go' as Language, grammarName: 'go', nodeTypeMap: GO_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'go' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — helper(x) / obj.Method(y) / pkg.Fn(x)
      if (type === 'call_expression') {
        const fn = node.childForFieldName?.('function');
        let callee: string | null = null;
        if (fn) {
          if (fn.type === 'identifier') {
            callee = fn.text;
          } else if (fn.type === 'selector_expression') {
            const ids = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'field_identifier');
            callee = ids[ids.length - 1]?.text ?? null;
          } else {
            callee = fn.text;
          }
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      if (type === 'function_declaration') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isExported = name[0] === name[0].toUpperCase() && name[0] !== '_';
        symbols.push(sym('function', name, qn, filePath, lang, node, {
          isExported, visibility: isExported ? 'public' : 'package',
          signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      if (type === 'method_declaration') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        // 提取 receiver type: func (r *ReceiverType) Name()
        const receiver = node.childForFieldName?.('receiver');
        let receiverType = '';
        if (receiver) {
          const paramList = receiver.namedChildren ?? [];
          for (const p of paramList) {
            const typeNode = p.childForFieldName?.('type') ?? findChild(p, 'type_identifier') ?? findChild(p, 'pointer_type');
            if (typeNode) {
              receiverType = typeNode.text.replace(/^\*/, '');
              break;
            }
          }
        }
        const qn = receiverType ? `${receiverType}.${name}` : (parent ? `${parent}.${name}` : name);
        const isExported = name[0] === name[0].toUpperCase() && name[0] !== '_';
        symbols.push(sym('method', name, qn, filePath, lang, node, {
          isExported, visibility: isExported ? 'public' : 'package',
          signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      if (type === 'type_spec') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isExported = name[0] === name[0].toUpperCase() && name[0] !== '_';
        // 判断 struct vs interface vs type_alias
        const bodyType = node.namedChildren?.find((c: AnyNode) =>
          c.type === 'struct_type' || c.type === 'interface_type');
        const kind = bodyType?.type === 'struct_type' ? 'struct' :
          bodyType?.type === 'interface_type' ? 'interface' : 'type_alias';
        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          isExported, visibility: isExported ? 'public' : 'package',
          signature: firstLine(node),
        }));
        // 遍历 struct/interface 内部 field + 嵌入类型引用
        // (Go 组合: struct 嵌入 → extends; interface 嵌入 → implements)
        if (bodyType) {
          const embeds: AnyNode[] = [];
          if (bodyType.type === 'struct_type') {
            const fl = findChild(bodyType, 'field_declaration_list');
            for (const fd of (fl?.namedChildren ?? [])) {
              if (fd.type === 'field_declaration' && !fd.childForFieldName?.('name')) embeds.push(fd);
            }
          } else if (bodyType.type === 'interface_type') {
            for (const ce of (bodyType.namedChildren ?? [])) {
              if (ce.type === 'constraint_elem') embeds.push(ce);
            }
          }
          for (const emb of embeds) {
            const typeNode = findChild(emb, 'type_identifier') ?? findChild(emb, 'qualified_type') ?? findChild(emb, 'pointer_type');
            let baseName: string | null = null;
            if (typeNode) {
              if (typeNode.type === 'qualified_type') {
                baseName = typeNode.text.split('.').pop() ?? typeNode.text;
              } else if (typeNode.type === 'pointer_type') {
                baseName = typeNode.namedChildren?.[0]?.text ?? typeNode.text.replace(/^\*/, '');
              } else {
                baseName = typeNode.text;
              }
            }
            if (baseName && baseName !== name) {
              references.push({
                fromSymbolName: '<file>', fromSymbolId: fileNodeId,
                referenceName: baseName,
                referenceKind: bodyType.type === 'struct_type' ? 'extends' : 'implements',
                line: (emb.startPosition?.row ?? 0) + 1, col: (emb.startPosition?.column ?? 0) + 1,
                filePath, language: lang,
              });
            }
          }
          walkChildren(bodyType, qn);
        }
        return;
      }

      if (type === 'import_spec') {
        const path = findChild(node, 'path') ?? node.namedChildren?.[node.namedChildren.length - 1];
        references.push(makeImportReference(filePath, (path?.text ?? '').replace(/"/g, ''),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1));
        return;
      }

      // go func() — goroutine detection
      if (type === 'go_statement') {
        const fnNode = findChild(node, 'func_literal') ?? findChild(node, 'call_expression');
        if (fnNode) {
          symbols.push(sym('function', '<goroutine>', parent ? `${parent}.<goroutine>` : '<goroutine>',
            filePath, lang, node, { isAsync: true, signature: firstLine(node) }));
        }
        walkChildren(node, parent);
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 3. Java — annotations, visibility, extends/implements, generics, imports
// ---------------------------------------------------------------------------

const JAVA_NODE_MAP: Record<string, string> = {
  'method_declaration': 'method', 'constructor_declaration': 'method',
  'class_declaration': 'class', 'interface_declaration': 'interface',
  'enum_declaration': 'enum', 'enum_constant': 'enum_member',
  'annotation_type_declaration': 'interface',
  'import_declaration': 'import', 'field_declaration': 'field',
  'record_declaration': 'class',
};

EXTRACTOR_REGISTRY.set('java', {
  language: 'java' as Language, grammarName: 'java', nodeTypeMap: JAVA_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'java' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const edges: Array<{ source: string; target: string; kind: string; line?: number }> = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = JAVA_NODE_MAP[type];

      // calls 引用 — method_invocation / object_creation_expression
      if (type === 'method_invocation' || type === 'object_creation_expression') {
        const calleeNode = node.childForFieldName?.('name') ?? node.childForFieldName?.('type');
        const calleeText = calleeNode?.text ?? '';
        const callee = calleeText ? (calleeText.includes('.') ? calleeText.split('.').pop() ?? '' : calleeText) : '';
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      if (kind === 'import') {
        const scopedId = findChild(node, 'scoped_identifier');
        references.push(makeImportReference(filePath,
          scopedId?.text ?? node.text.replace(/^import\s+|;$/g, '').trim(),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1));
        return;
      }

      if (kind && kind !== 'import') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const mods = extractCFamilyModifiers(node);
        const decos = extractDecorators(node, 'marker_annotation');
        // Also check 'annotation' type
        for (const c of (node.namedChildren ?? [])) {
          if (c.type === 'annotation' || c.type === 'marker_annotation') {
            const dn = c.childForFieldName?.('name') ?? findChild(c, 'identifier');
            if (dn?.text && !decos.includes(dn.text)) decos.push(dn.text);
          }
        }

        // generic type parameters
        const typeParams: string[] = [];
        const tpNode = findChild(node, 'type_parameters');
        if (tpNode) typeParams.push(tpNode.text);

        // extends / implements 引用 (替代裸名 edges — 端点需为合法节点 ID,
        // 裸名边会被 orchestrator JOIN 过滤丢弃; 引用经 code-resolution 按名解析)
        if (type === 'class_declaration' || type === 'interface_declaration' ||
            type === 'enum_declaration' || type === 'record_declaration') {
          const superclass = node.childForFieldName?.('superclass');
          if (superclass) {
            const scChild = superclass.namedChildren?.find((c: AnyNode) =>
              c.type === 'type_identifier' || c.type === 'generic_type');
            const superName = scChild?.type === 'generic_type'
              ? findChild(scChild, 'type_identifier')?.text ?? null
              : scChild?.text ?? null;
            if (superName && superName !== name) {
              references.push({
                fromSymbolName: '<file>', fromSymbolId: fileNodeId,
                referenceName: superName, referenceKind: 'extends',
                line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
                filePath, language: lang,
              });
            }
          }
          // interface_declaration 的 extends 是 extends_interfaces 子节点 (无 interfaces 字段)
          const ifacesNode = node.childForFieldName?.('interfaces') ?? findChild(node, 'extends_interfaces');
          if (ifacesNode) {
            const ifaceKind = type === 'interface_declaration' ? 'extends' : 'implements';
            const typeNames: string[] = [];
            const collectTypes = (n: AnyNode): void => {
              for (const c of (n.namedChildren ?? [])) {
                if (c.type === 'type_identifier') typeNames.push(c.text);
                else if (c.type === 'generic_type') {
                  const ti = findChild(c, 'type_identifier');
                  if (ti) typeNames.push(ti.text);
                } else collectTypes(c);
              }
            };
            collectTypes(ifacesNode);
            for (const tname of typeNames) {
              if (tname === name) continue;
              references.push({
                fromSymbolName: '<file>', fromSymbolId: fileNodeId,
                referenceName: tname, referenceKind: ifaceKind,
                line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
                filePath, language: lang,
              });
            }
          }
        }

        // docstring from preceding comment
        let docstring = '';
        const prev = prevSibling(node);
        if (prev?.type === 'block_comment' || prev?.type === 'comment') {
          docstring = prev.text.replace(/^\/\*\*?|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').trim();
        }

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          ...mods, decorators: decos, typeParameters: typeParams,
          signature: firstLine(node), docstring,
        }));
        walkChildren(node, qn);
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges };
  },
});

// ---------------------------------------------------------------------------
// 4. Rust — impl blocks, pub visibility, traits, async fn, use, derive
// ---------------------------------------------------------------------------

const RUST_NODE_MAP: Record<string, string> = {
  'function_item': 'function', 'struct_item': 'struct', 'enum_item': 'enum',
  'trait_item': 'trait', 'impl_item': '_impl', 'type_item': 'type_alias',
  'use_declaration': 'import', 'mod_item': 'module',
  'const_item': 'variable', 'static_item': 'variable',
  'macro_definition': 'function',
};

EXTRACTOR_REGISTRY.set('rust', {
  language: 'rust' as Language, grammarName: 'rust', nodeTypeMap: RUST_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'rust' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const edges: Array<{ source: string; target: string; kind: string; line?: number }> = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — helper(x) / obj.method(y) / std::io::read(x)
      if (type === 'call_expression') {
        const fn = node.childForFieldName?.('function');
        let callee: string | null = null;
        if (fn) {
          if (fn.type === 'identifier') callee = fn.text;
          else if (fn.type === 'field_expression') {
            const ids = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'field_identifier');
            callee = ids[ids.length - 1]?.text ?? null;
          } else if (fn.type === 'scoped_identifier') {
            const segs = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'identifier');
            callee = segs[segs.length - 1]?.text ?? null;
          } else {
            callee = fn.text;
          }
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      if (type === 'use_declaration') {
        const arg = findChild(node, 'use_list') ?? findChild(node, 'scoped_identifier') ?? findChild(node, 'identifier');
        references.push(makeImportReference(filePath,
          arg?.text ?? node.text.replace(/^use\s+|;$/g, '').trim(),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1));
        return;
      }

      if (type === 'impl_item') {
        // impl Type { ... } or impl Trait for Type { ... }
        const typeName = node.childForFieldName?.('type')?.text?.replace(/^\*/, '') ?? '';
        const traitNode = node.childForFieldName?.('trait');
        const implParent = typeName || parent;

        if (traitNode) {
          // 泛型 trait (impl Vec<T> for C) 取 < 前裸名, 否则 code-resolution 按名匹配不到
          let traitName = traitNode.text ?? '';
          const nameNode = traitNode.childForFieldName?.('name') ??
            traitNode.namedChildren?.find((c: AnyNode) => c.type === 'type_identifier');
          if (nameNode?.text) traitName = nameNode.text;
          if (traitName.includes('<')) traitName = traitName.slice(0, traitName.indexOf('<'));
          if (traitName) {
            edges.push({ source: typeName, target: traitName, kind: 'implements',
              line: (node.startPosition?.row ?? 0) + 1 });
          }
        }

        // 遍历 impl body
        const body = findChild(node, 'declaration_list');
        if (body) {
          for (const c of (body.namedChildren ?? [])) walk(c, implParent);
        }
        return;
      }

      if (type === 'function_item') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = parent ? 'method' : 'function';

        // visibility
        const visNode = findChild(node, 'visibility_modifier');
        const visibility = visNode ? (visNode.text === 'pub' ? 'public' : visNode.text.includes('crate') ? 'pub(crate)' : visNode.text) : '';
        const isExported = visibility === 'public';
        const isAsync = hasChildType(node, 'async');

        // derive/attribute decorators on parent or self
        const decos = extractDecorators(node, 'attribute_item');

        // doc comment
        let docstring = '';
        const prev = prevSibling(node);
        if (prev?.type === 'line_comment' && prev.text.startsWith('///')) {
          docstring = prev.text.replace(/^\/\/\/\s?/, '').trim();
        }

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          visibility, isExported, isAsync, decorators: decos,
          signature: firstLine(node), docstring,
        }));
        walkChildren(node, qn);
        return;
      }

      if (type === 'struct_item' || type === 'enum_item' || type === 'trait_item' || type === 'mod_item') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = type === 'struct_item' ? 'struct' : type === 'enum_item' ? 'enum' :
          type === 'trait_item' ? 'trait' : 'module';
        const visNode = findChild(node, 'visibility_modifier');
        const visibility = visNode ? (visNode.text === 'pub' ? 'public' : visNode.text) : '';
        const isExported = visibility === 'public';

        // derive macros as decorators
        const decos: string[] = [];
        const prev = prevSibling(node);
        if (prev?.type === 'attribute_item' && prev.text.includes('derive')) {
          const match = prev.text.match(/derive\(([^)]+)\)/);
          if (match) decos.push(...match[1].split(',').map((s: string) => s.trim()));
        }

        // generic type params
        const typeParams: string[] = [];
        const tpNode = findChild(node, 'type_parameters');
        if (tpNode) typeParams.push(tpNode.text);

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          visibility, isExported, decorators: decos, typeParameters: typeParams,
          signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges };
  },
});

// ---------------------------------------------------------------------------
// 5. C# — visibility, modifiers, attributes, namespace, using, properties
// ---------------------------------------------------------------------------

const CSHARP_NODE_MAP: Record<string, string> = {
  'method_declaration': 'method', 'constructor_declaration': 'method',
  'class_declaration': 'class', 'interface_declaration': 'interface',
  'enum_declaration': 'enum', 'struct_declaration': 'struct',
  'namespace_declaration': 'namespace', 'record_declaration': 'class',
  'property_declaration': 'property', 'field_declaration': 'field',
  'using_directive': 'import', 'delegate_declaration': 'type_alias',
  'event_declaration': 'property',
};

EXTRACTOR_REGISTRY.set('csharp', {
  language: 'csharp' as Language, grammarName: 'c_sharp', nodeTypeMap: CSHARP_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'csharp' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = CSHARP_NODE_MAP[type];

      // calls 引用 — helper(x) / obj.Method(y) / new Foo()
      if (type === 'invocation_expression') {
        const fn = node.childForFieldName?.('function');
        let callee: string | null = null;
        if (fn) {
          if (fn.type === 'identifier') callee = fn.text;
          else if (fn.type === 'member_access_expression') callee = fn.childForFieldName?.('name')?.text ?? null;
          else callee = fn.text;
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }
      if (type === 'object_creation_expression') {
        const typeNode = node.childForFieldName?.('type') ?? node.namedChildren?.[0];
        let ctorName = typeNode?.text ?? null;
        if (ctorName?.includes('<')) ctorName = ctorName.slice(0, ctorName.indexOf('<'));
        if (ctorName) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: ctorName, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      if (type === 'using_directive') {
        const nameNode = findChild(node, 'qualified_name') ?? findChild(node, 'identifier');
        references.push(makeImportReference(filePath,
          nameNode?.text ?? node.text.replace(/^using\s+|;$/g, '').trim(),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1));
        return;
      }

      if (kind && kind !== 'import') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const mods = extractCFamilyModifiers(node);

        // attributes as decorators [Attribute]
        const decos: string[] = [];
        for (const c of (node.namedChildren ?? [])) {
          if (c.type === 'attribute_list') {
            for (const attr of (c.namedChildren ?? [])) {
              const attrName = findChild(attr, 'identifier') ?? findChild(attr, 'qualified_name');
              if (attrName) decos.push(attrName.text);
            }
          }
        }

        // async Task methods
        let isAsync = mods.isAsync;
        if (!isAsync && type === 'method_declaration') {
          const returnType = node.childForFieldName?.('type')?.text ?? '';
          if (returnType.startsWith('Task') || returnType.startsWith('ValueTask') || returnType.startsWith('async')) {
            isAsync = true;
          }
        }

        // base_list → 首位基类 = extends, 其余接口 = implements (C# 语义: 基类至多一个且必在首位)
        if (type === 'class_declaration' || type === 'interface_declaration' ||
            type === 'struct_declaration' || type === 'record_declaration') {
          const baseList = findChild(node, 'base_list');
          if (baseList) {
            (baseList.namedChildren ?? []).forEach((b: AnyNode, i: number) => {
              const nameNode = b.namedChildren?.find((c: AnyNode) => c.type === 'identifier') ?? b;
              let baseName = nameNode?.text ?? b.text ?? '';
              if (baseName.includes('<')) baseName = baseName.slice(0, baseName.indexOf('<'));
              if (baseName && baseName !== name) {
                references.push({
                  fromSymbolName: '<file>', fromSymbolId: fileNodeId,
                  referenceName: baseName,
                  referenceKind: i === 0 ? 'extends' : 'implements',
                  line: (b.startPosition?.row ?? 0) + 1, col: (b.startPosition?.column ?? 0) + 1,
                  filePath, language: lang,
                });
              }
            });
          }
        }

        // doc comment
        let docstring = '';
        const prev = prevSibling(node);
        if (prev?.type === 'comment' && prev.text.startsWith('///')) {
          docstring = prev.text.replace(/\/\/\/\s?/g, '').trim();
        }

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          ...mods, isAsync, decorators: decos,
          signature: firstLine(node), docstring,
        }));
        walkChildren(node, qn);
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 6. Ruby — attr_*, module, def self., include/extend, visibility sections
// ---------------------------------------------------------------------------

const RUBY_NODE_MAP: Record<string, string> = {
  'method': 'method', 'singleton_method': 'method',
  'class': 'class', 'module': 'module',
  'call': '_call', // include/extend/attr_* 检测
  'assignment': 'variable',
};

EXTRACTOR_REGISTRY.set('ruby', {
  language: 'ruby' as Language, grammarName: 'ruby', nodeTypeMap: RUBY_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'ruby' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    let currentVisibility = 'public';
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      if (type === 'class' || type === 'module') {
        const name = nodeName(node) ?? findChild(node, 'constant')?.text;
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = type === 'class' ? 'class' : 'module';
        const savedVis = currentVisibility;
        currentVisibility = 'public';

        // 继承引用 — class B < A / class C < ::NS::Base
        if (type === 'class') {
          const sup = node.childForFieldName?.('superclass');
          const supName = sup?.namedChildren?.[0]?.text?.split('::').pop()
            ?? sup?.text?.replace(/^<\s*/, '')?.split('::').pop() ?? null;
          if (supName && supName !== name) {
            references.push({
              fromSymbolName: '<file>', fromSymbolId: fileNodeId,
              referenceName: supName, referenceKind: 'extends',
              line: (sup.startPosition?.row ?? 0) + 1, col: (sup.startPosition?.column ?? 0) + 1,
              filePath, language: lang,
            });
          }
        }

        symbols.push(sym(kind, name, qn, filePath, lang, node, { signature: firstLine(node) }));
        walkChildren(node, qn);
        currentVisibility = savedVis;
        return;
      }

      if (type === 'method') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;

        // doc comment
        let docstring = '';
        const prev = prevSibling(node);
        if (prev?.type === 'comment') {
          docstring = prev.text.replace(/^#\s?/, '').trim();
        }

        symbols.push(sym('method', name, qn, filePath, lang, node, {
          visibility: currentVisibility, signature: firstLine(node), docstring,
        }));
        walkChildren(node, qn);
        return;
      }

      if (type === 'singleton_method') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        symbols.push(sym('method', name, qn, filePath, lang, node, {
          isStatic: true, visibility: 'public', signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      if (type === 'call' || type === 'identifier') {
        const hasReceiver = node.childForFieldName?.('receiver') != null;
        // 被调用名: call 用 method 字段 (无 receiver 的裸调用同样走此字段);
        // 避免 nodeName 取第一个 identifier 误取接收者 (obj.method → 'obj')
        const methodName = type === 'call'
          ? (node.childForFieldName?.('method')?.text ?? nodeName(node) ?? node.text)
          : (nodeName(node) ?? node.text);
        // visibility modifiers
        if (!hasReceiver && ['private', 'protected', 'public'].includes(methodName)) {
          currentVisibility = methodName;
          return;
        }
        // attr_accessor/reader/writer → properties
        if (!hasReceiver && ['attr_accessor', 'attr_reader', 'attr_writer'].includes(methodName)) {
          const args = findChild(node, 'argument_list');
          for (const arg of (args?.namedChildren ?? [])) {
            if (arg.type === 'simple_symbol' || arg.type === 'symbol') {
              const propName = arg.text.replace(/^:/, '');
              symbols.push(sym('property', propName, parent ? `${parent}.${propName}` : propName,
                filePath, lang, node, { visibility: currentVisibility }));
            }
          }
          return;
        }
        // include/extend → mixin references; prepend/require variants → imports
        if (!hasReceiver && ['include', 'extend', 'prepend', 'require', 'require_relative'].includes(methodName)) {
          const args = findChild(node, 'argument_list');
          for (const arg of (args?.namedChildren ?? [])) {
            if (methodName === 'require' || methodName === 'require_relative') {
              references.push(makeImportReference(filePath,
                arg.text.replace(/['"]/g, '').replace(/^:/, ''),
                (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1,
                methodName));
            } else {
              references.push({
                fromSymbolName: parent || '<module>',
                fromSymbolId: `${filePath}:${parent || '<module>'}`,
                referenceName: arg.text.replace(/['"]/g, '').replace(/^:/, ''),
                referenceKind: methodName === 'prepend' ? 'imports' : 'mixes_in',
                line: (node.startPosition?.row ?? 0) + 1,
                col: (node.startPosition?.column ?? 0) + 1,
                filePath,
                language: lang,
              });
            }
          }
          return;
        }
        // 普通方法调用 → calls 引用 (helper(x) / obj.method(x) — 带 receiver 也收集, 由解析阶段按名过滤)
        if (type === 'call' && methodName) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: methodName, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 7. Swift — visibility, modifiers, protocols, decorators, async, imports
// ---------------------------------------------------------------------------

const SWIFT_NODE_MAP: Record<string, string> = {
  'function_declaration': 'function', 'protocol_function_declaration': 'function',
  'class_declaration': 'class', 'protocol_declaration': 'protocol',
  'typealias_declaration': 'type_alias', 'property_declaration': 'property',
  'protocol_property_declaration': 'property', 'variable_declaration': 'property',
  'import_declaration': 'import', 'init_declaration': 'method',
  'deinit_declaration': 'method', 'subscript_declaration': 'method',
  // tree-sitter-swift 实际语法: enum 为 class_declaration + enum_class_body + enum_entry
  'enum_entry': 'enum_member',
};

function swiftDeclarationKind(node: AnyNode): string | null {
  if (node.type !== 'class_declaration') return SWIFT_NODE_MAP[node.type] ?? null;
  const declarationKind = node.childForFieldName?.('declaration_kind')?.text ?? 'class';
  if (declarationKind === 'struct') return 'struct';
  if (declarationKind === 'enum') return 'enum';
  // UnifiedNodeKind 暂无 actor；actor 是引用语义，映射为 class 并通过 decorator 保真。
  if (declarationKind === 'actor') return 'class';
  if (declarationKind === 'extension') return null;
  return 'class';
}

function swiftNodeName(node: AnyNode): string | null {
  const type = node.type;
  const fallback = type === 'init_declaration' ? 'init'
    : type === 'deinit_declaration' ? 'deinit'
      : type === 'subscript_declaration' ? 'subscript'
        : null;
  const rawName = nodeName(node) ?? fallback;
  if (!rawName) return null;
  // 当前 Swift grammar 把 protocol property 的 var/let 一并放进 name field。
  return type === 'protocol_property_declaration'
    ? rawName.replace(/^(?:var|let)\s+/, '')
    : rawName;
}

function swiftNominalType(node: AnyNode): string | null {
  const text = node.childForFieldName?.('inherits_from')?.text?.trim() ?? '';
  return text.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/)?.[1] ?? null;
}

/**
 * tree-sitter-swift 把 #if/#elseif/#else/#endif 暴露为平级 directive，
 * 因此按行维护条件栈，给 structural ref 保留原始 directive 文本。
 */
function swiftCompilationConditions(sourceCode: string): Map<number, string> {
  const conditions = new Map<number, string>();
  const stack: string[] = [];
  const lines = sourceCode.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const directive = lines[index].trim();
    if (/^#if\s+\S/.test(directive)) {
      stack.push(directive);
      continue;
    }
    if (/^#elseif\s+\S/.test(directive) || directive === '#else') {
      if (stack.length > 0) stack[stack.length - 1] = directive;
      continue;
    }
    if (directive === '#endif') {
      stack.pop();
      continue;
    }
    if (stack.length > 0) conditions.set(index + 1, stack.join('\n'));
  }

  return conditions;
}

interface SwiftInheritanceCandidate {
  sourceQualifiedName: string;
  sourceDeclarationKind: string;
  targetName: string;
  line: number;
  col: number;
  compilationCondition?: string;
}

interface SwiftExtensionOwnershipCandidate {
  ownerQualifiedName: string;
  memberQualifiedName: string;
  line: number;
  col: number;
  compilationCondition?: string;
}

interface SwiftEdgeCandidate {
  source: string;
  target: string;
  kind: string;
  line: number;
  col: number;
}

EXTRACTOR_REGISTRY.set('swift', {
  language: 'swift' as Language, grammarName: 'swift', nodeTypeMap: SWIFT_NODE_MAP,
  extract(tree, sourceCode, filePath) {
    const lang = 'swift' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const importReferences: ImportReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);
    const structuralReferences: Array<StructuralTypeReference | StructuralOwnerReference> = [];
    const edgeCandidates: SwiftEdgeCandidate[] = [];
    const inheritanceCandidates: SwiftInheritanceCandidate[] = [];
    const extensionOwnershipCandidates: SwiftExtensionOwnershipCandidate[] = [];
    const compilationConditions = swiftCompilationConditions(sourceCode);

    const walk = (node: AnyNode, parent: string, extensionOwner: string | null): void => {
      const type = node.type;

      // calls 引用 — helper(id) / items.joined() (tree-sitter-swift 新语法:
      // call_expression 直接子为 simple_identifier 或 navigation_expression)
      if (type === 'call_expression' || type === 'function_call_expression') {
        const fn = node.childForFieldName?.('function') ?? node.namedChildren?.[0];
        let callee: string | null = null;
        if (fn) {
          if (fn.type === 'simple_identifier' || fn.type === 'identifier') {
            callee = fn.text;
          } else if (fn.type === 'navigation_expression') {
            // items.joined() → 最后一个 navigation_suffix 的 simple_identifier
            const suffixes = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'navigation_suffix');
            const last = suffixes[suffixes.length - 1]?.namedChildren?.find((c: AnyNode) => c.type === 'simple_identifier');
            callee = last?.text ?? null;
          } else if (fn.type === 'user_type') {
            callee = fn.text;
          }
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      if (type === 'import_declaration') {
        const rawTarget = node.text.replace(
          /^import\s+(?:(?:typealias|struct|class|enum|protocol|var|let|func)\s+)?/,
          '',
        ).trim();
        const line = (node.startPosition?.row ?? 0) + 1;
        const column = (node.startPosition?.column ?? 0) + 1;
        references.push(makeImportReference(filePath, rawTarget, line, column));
        importReferences.push(makeStrictImportReference(filePath, rawTarget, line, column));
        return;
      }

      const declarationKind = type === 'class_declaration'
        ? node.childForFieldName?.('declaration_kind')?.text ?? 'class'
        : type === 'protocol_declaration' ? 'protocol' : '';

      if (declarationKind === 'extension') {
        const extensionName = swiftNodeName(node);
        if (!extensionName) { walkChildren(node, parent, extensionOwner); return; }
        const owner = parent ? `${parent}.${extensionName}` : extensionName;
        collectInheritance(node, owner, declarationKind);
        // extension 是 owner context，不是第二个 nominal declaration；否则同 ID 会覆盖原声明。
        walkChildren(node, owner, owner);
        return;
      }

      const kind = swiftDeclarationKind(node);
      if (kind && kind !== 'import') {
        const name = swiftNodeName(node);
        if (!name) { walkChildren(node, parent, extensionOwner); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isMethod = parent !== '' && (
          type === 'function_declaration'
          || type === 'protocol_function_declaration'
          || type === 'init_declaration'
          || type === 'deinit_declaration'
          || type === 'subscript_declaration'
        );
        const finalKind = isMethod ? 'method' : kind;

        // modifiers: public/private/fileprivate/internal/static/class
        let visibility = '', isStatic = false, isAsync = false;
        for (const c of (node.namedChildren ?? [])) {
          const modText = c.type === 'modifier' ? c.text : c.type;
          if (['public', 'private', 'fileprivate', 'internal', 'open'].includes(modText)) visibility = modText;
          if (modText === 'static' || modText === 'class') isStatic = true;
          if (modText === 'async') isAsync = true;
        }

        // @objc, @IBAction etc. as decorators
        const decos: string[] = declarationKind === 'actor' ? ['actor'] : [];
        for (const c of (node.namedChildren ?? [])) {
          if (c.type === 'attribute') {
            const attrName = findChild(c, 'user_type') ?? findChild(c, 'identifier');
            const decorator = attrName?.text ?? c.text.replace(/^@/, '');
            if (!decos.includes(decorator)) decos.push(decorator);
          }
        }

        // doc comment
        let docstring = '';
        const prev = prevSibling(node);
        if (prev?.type === 'comment' && prev.text.startsWith('///')) {
          docstring = prev.text.replace(/\/\/\/\s?/g, '').trim();
        }

        symbols.push(sym(finalKind, name, qn, filePath, lang, node, {
          visibility, isStatic, isAsync, decorators: decos,
          signature: firstLine(node), docstring,
        }));

        if (parent) {
          const ownership = {
            memberQualifiedName: qn,
            ownerQualifiedName: parent,
            line: (node.startPosition?.row ?? 0) + 1,
            col: (node.startPosition?.column ?? 0) + 1,
            compilationCondition: compilationConditions.get((node.startPosition?.row ?? 0) + 1),
          };
          if (extensionOwner === parent) {
            extensionOwnershipCandidates.push(ownership);
          } else {
            edgeCandidates.push({
              source: makeCodeNodeId(filePath, parent),
              target: makeCodeNodeId(filePath, qn),
              kind: 'contains',
              line: ownership.line,
              col: ownership.col,
            });
          }
        }

        if (declarationKind) collectInheritance(node, qn, declarationKind);
        walkChildren(node, qn, extensionOwner);
        return;
      }

      walkChildren(node, parent, extensionOwner);
    };

    const collectInheritance = (
      node: AnyNode,
      sourceQualifiedName: string,
      sourceDeclarationKind: string,
    ): void => {
      for (const child of (node.namedChildren ?? [])) {
        if (child.type !== 'inheritance_specifier') continue;
        const targetName = swiftNominalType(child);
        if (!targetName || targetName === 'AnyObject') continue;
        const line = (child.startPosition?.row ?? 0) + 1;
        inheritanceCandidates.push({
          sourceQualifiedName,
          sourceDeclarationKind,
          targetName,
          line,
          col: (child.startPosition?.column ?? 0) + 1,
          compilationCondition: compilationConditions.get(line),
        });
      }
    };

    const walkChildren = (node: AnyNode, parent: string, extensionOwner: string | null): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent, extensionOwner);
    };

    walk((tree as AnyNode).rootNode, '', null);

    const typeSymbols = symbols.filter(symbol => ['class', 'struct', 'enum', 'protocol'].includes(symbol.kind));
    const typesByQualifiedName = new Map<string, typeof typeSymbols>();
    const typesByName = new Map<string, typeof typeSymbols>();
    for (const symbol of typeSymbols) {
      const qualified = typesByQualifiedName.get(symbol.qualifiedName) ?? [];
      qualified.push(symbol);
      typesByQualifiedName.set(symbol.qualifiedName, qualified);
      const named = typesByName.get(symbol.name) ?? [];
      named.push(symbol);
      typesByName.set(symbol.name, named);
    }

    const resolveLocalType = (
      sourceQualifiedName: string,
      targetName: string,
    ): typeof typeSymbols[number] | null => {
      const scopes = sourceQualifiedName.split('.');
      scopes.pop();
      while (scopes.length > 0) {
        const scoped = typesByQualifiedName.get(`${scopes.join('.')}.${targetName}`) ?? [];
        if (scoped.length > 0) return scoped.length === 1 ? scoped[0] : null;
        scopes.pop();
      }

      const exact = typesByQualifiedName.get(targetName) ?? [];
      if (exact.length > 0) return exact.length === 1 ? exact[0] : null;
      // 带 module 的名字必须保持精确，禁止只取尾部组件猜测目标。
      if (targetName.includes('.')) return null;
      const named = typesByName.get(targetName) ?? [];
      return named.length === 1 ? named[0] : null;
    };

    // `import class UIKit.UIView` 等专用 import 保留完整 ref，
    // 但 resolver hint 只使用所属 module（`UIKit`）。
    const moduleHints = [...new Set(importReferences
      .map(reference => reference.rawTarget.split('.')[0])
      .filter(Boolean))];
    const makeTypeReference = (
      candidate: SwiftInheritanceCandidate,
      source: typeof symbols[number],
    ): StructuralTypeReference => {
      const anchorNodeId = makeCodeNodeId(filePath, source.qualifiedName);
      const keyInput = {
        normalizedOriginPath: filePath,
        anchorNodeId,
        relationHint: 'inherits-or-conforms' as const,
        edgeOrientation: 'anchor-to-target' as const,
        rawTargetName: candidate.targetName,
        line: candidate.line,
        column: candidate.col,
      };
      return {
        kind: 'type',
        refKey: makeStructuralReferenceKey(keyInput),
        anchorNodeId,
        anchorQualifiedName: source.qualifiedName,
        rawTargetName: candidate.targetName,
        sourceDeclarationKind: candidate.sourceDeclarationKind,
        relationHint: 'inherits-or-conforms',
        edgeOrientation: 'anchor-to-target',
        lookupScope: 'project-and-external',
        targetKindHints: ['class', 'struct', 'protocol', 'enum'],
        targetLanguageHints: ['swift', 'objc'],
        moduleHints,
        targetFileHints: [],
        origin: { filePath, language: 'swift', line: candidate.line, column: candidate.col },
        ...(candidate.compilationCondition
          ? { compilationCondition: candidate.compilationCondition }
          : {}),
        evidenceProvenance: 'tree-sitter',
      };
    };

    const makeOwnerReference = (
      candidate: SwiftExtensionOwnershipCandidate,
      member: typeof symbols[number],
    ): StructuralOwnerReference => {
      const anchorNodeId = makeCodeNodeId(filePath, member.qualifiedName);
      const keyInput = {
        normalizedOriginPath: filePath,
        anchorNodeId,
        relationHint: 'contains-owner' as const,
        edgeOrientation: 'target-to-anchor' as const,
        rawTargetName: candidate.ownerQualifiedName,
        line: candidate.line,
        column: candidate.col,
      };
      return {
        kind: 'owner',
        refKey: makeStructuralReferenceKey(keyInput),
        anchorNodeId,
        anchorQualifiedName: member.qualifiedName,
        rawTargetName: candidate.ownerQualifiedName,
        sourceDeclarationKind: 'extension',
        relationHint: 'contains-owner',
        edgeOrientation: 'target-to-anchor',
        lookupScope: 'project-and-external',
        targetKindHints: ['class', 'struct', 'protocol', 'enum'],
        targetLanguageHints: ['swift', 'objc'],
        moduleHints,
        targetFileHints: [],
        origin: { filePath, language: 'swift', line: candidate.line, column: candidate.col },
        ...(candidate.compilationCondition
          ? { compilationCondition: candidate.compilationCondition }
          : {}),
        evidenceProvenance: 'tree-sitter',
      };
    };

    const symbolsByQualifiedName = new Map<string, typeof symbols>();
    for (const symbol of symbols) {
      const values = symbolsByQualifiedName.get(symbol.qualifiedName) ?? [];
      values.push(symbol);
      symbolsByQualifiedName.set(symbol.qualifiedName, values);
    }

    for (const candidate of inheritanceCandidates) {
      const sources = symbolsByQualifiedName.get(candidate.sourceQualifiedName) ?? [];
      if (sources.length !== 1) continue;
      const source = sources[0];
      const target = resolveLocalType(candidate.sourceQualifiedName, candidate.targetName);
      if (!target) {
        structuralReferences.push(makeTypeReference(candidate, source));
        continue;
      }

      const edgeKind = target.kind === 'protocol'
        ? source.kind === 'protocol' ? 'extends' : 'implements'
        : source.kind === 'class' && target.kind === 'class' ? 'extends' : null;
      if (!edgeKind) continue;
      edgeCandidates.push({
        source: makeCodeNodeId(filePath, source.qualifiedName),
        target: makeCodeNodeId(filePath, target.qualifiedName),
        kind: edgeKind,
        line: candidate.line,
        col: candidate.col,
      });
    }

    for (const candidate of extensionOwnershipCandidates) {
      const members = symbolsByQualifiedName.get(candidate.memberQualifiedName) ?? [];
      if (members.length !== 1) continue;
      const member = members[0];
      const owner = resolveLocalType(candidate.memberQualifiedName, candidate.ownerQualifiedName);
      if (!owner) {
        structuralReferences.push(makeOwnerReference(candidate, member));
        continue;
      }
      edgeCandidates.push({
        source: makeCodeNodeId(filePath, owner.qualifiedName),
        target: makeCodeNodeId(filePath, member.qualifiedName),
        kind: 'contains',
        line: candidate.line,
        col: candidate.col,
      });
    }

    const symbolIds = new Set(symbols.map(symbol => makeCodeNodeId(filePath, symbol.qualifiedName)));
    const seenEdges = new Set<string>();
    const edges = edgeCandidates.filter(edge => {
      if (!symbolIds.has(edge.source) || !symbolIds.has(edge.target)) return false;
      const key = `${edge.source}\0${edge.target}\0${edge.kind}`;
      if (seenEdges.has(key)) return false;
      seenEdges.add(key);
      return true;
    });

    return { symbols, references, importReferences, structuralReferences, edges };
  },
});

// ---------------------------------------------------------------------------
// 8. Kotlin — fun, data class, object, suspend, annotations, override
// ---------------------------------------------------------------------------

const KOTLIN_NODE_MAP: Record<string, string> = {
  'function_declaration': 'function', 'class_declaration': 'class',
  'object_declaration': 'class', 'interface_declaration': 'interface',
  'companion_object': 'class', 'property_declaration': 'property',
  'import_header': 'import', 'enum_entry': 'enum_member',
  'type_alias': 'type_alias',
};

EXTRACTOR_REGISTRY.set('kotlin', {
  language: 'kotlin' as Language, grammarName: 'kotlin', nodeTypeMap: KOTLIN_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'kotlin' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = KOTLIN_NODE_MAP[type];

      // calls 引用 — 本 grammar 无字段, 按位置取 namedChildren[0]
      // helper(x) → simple_identifier; obj.method(y) → navigation_expression 末段
      if (type === 'call_expression') {
        const fn = node.namedChildren?.[0];
        let callee: string | null = null;
        if (fn?.type === 'simple_identifier') {
          callee = fn.text;
        } else if (fn?.type === 'navigation_expression') {
          const suffixes = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'navigation_suffix');
          const lastSuffix = suffixes[suffixes.length - 1];
          callee = lastSuffix?.namedChildren?.find((c: AnyNode) => c.type === 'simple_identifier')?.text ?? null;
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      if (type === 'import_header') {
        const id = findChild(node, 'identifier') ?? findChild(node, 'scoped_identifier');
        references.push(makeImportReference(filePath,
          id?.text ?? node.text.replace(/^import\s+/, '').trim(),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1));
        return;
      }

      if (kind && kind !== 'import') {
        const name = nodeName(node) ?? (type === 'companion_object' ? 'Companion' : null);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isMethod = parent !== '' && type === 'function_declaration';
        const finalKind = isMethod ? 'method' : kind;

        // 继承/实现引用 — delegation_specifier 列表 (首个=extends, 其余=implements)
        if (type === 'class_declaration' || type === 'interface_declaration' || type === 'object_declaration') {
          const delegations = (node.namedChildren ?? []).filter((c: AnyNode) => c.type === 'delegation_specifier');
          delegations.forEach((spec: AnyNode, i: number) => {
            const ci = spec.namedChildren?.find((c: AnyNode) =>
              c.type === 'constructor_invocation' || c.type === 'explicit_delegation');
            const ut = ci
              ? ci.namedChildren?.find((c: AnyNode) => c.type === 'user_type')
              : spec.namedChildren?.find((c: AnyNode) => c.type === 'user_type');
            const parentName = ut?.namedChildren?.find((c: AnyNode) => c.type === 'type_identifier')?.text ?? null;
            if (parentName && parentName !== name) {
              references.push({
                fromSymbolName: '<file>', fromSymbolId: fileNodeId,
                referenceName: parentName, referenceKind: i === 0 ? 'extends' : 'implements',
                line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
                filePath, language: lang,
              });
            }
          });
        }

        // modifiers: visibility, suspend, override, data, abstract
        let visibility = '', isAsync = false, isStatic = false, isAbstract = false;
        const decos: string[] = [];
        for (const c of (node.namedChildren ?? [])) {
          if (c.type === 'modifiers' || c.type === 'modifier') {
            for (const m of (c.namedChildren ?? [c])) {
              const mt = m.type === 'visibility_modifier' ? m.text :
                m.type === 'inheritance_modifier' ? m.text : m.text;
              if (['public', 'private', 'protected', 'internal'].includes(mt)) visibility = mt;
              if (mt === 'suspend') isAsync = true;
              if (mt === 'abstract') isAbstract = true;
              if (mt === 'override') decos.push('override');
              if (mt === 'data') decos.push('data');
            }
          }
          if (c.type === 'annotation') {
            const aName = findChild(c, 'user_type') ?? findChild(c, 'identifier');
            decos.push(aName?.text ?? c.text.replace(/^@/, ''));
          }
        }

        // doc comment
        let docstring = '';
        const prev = prevSibling(node);
        if (prev?.type === 'multiline_comment' && prev.text.startsWith('/**')) {
          docstring = prev.text.replace(/^\/\*\*|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').trim();
        }

        symbols.push(sym(finalKind, name, qn, filePath, lang, node, {
          visibility, isAsync, isStatic, isAbstract, decorators: decos,
          signature: firstLine(node), docstring,
        }));
        walkChildren(node, qn);
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 9. PHP — visibility, modifiers, namespace, use, traits, docblocks
// ---------------------------------------------------------------------------

const PHP_NODE_MAP: Record<string, string> = {
  'function_definition': 'function', 'method_declaration': 'method',
  'class_declaration': 'class', 'interface_declaration': 'interface',
  'trait_declaration': 'trait', 'enum_declaration': 'enum',
  'namespace_definition': 'namespace', 'property_declaration': 'property',
  'const_declaration': 'variable', 'enum_case': 'enum_member',
  'use_declaration': 'import', 'namespace_use_declaration': 'import',
};

EXTRACTOR_REGISTRY.set('php', {
  language: 'php' as Language, grammarName: 'php', nodeTypeMap: PHP_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'php' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = PHP_NODE_MAP[type];

      // calls 引用 — helper($x) / $obj->method($y) / A::staticCall($z)
      if (type === 'function_call_expression' || type === 'member_call_expression' || type === 'scoped_call_expression') {
        let callee: string | null = null;
        if (type === 'function_call_expression') {
          const fn = node.childForFieldName?.('function');
          callee = fn ? (fn.text.split('\\').pop() || null) : null;
        } else {
          callee = node.childForFieldName?.('name')?.text ?? null;
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      if (type === 'namespace_use_declaration' || type === 'use_declaration') {
        const nameNode = findChild(node, 'qualified_name') ?? findChild(node, 'name');
        references.push(makeImportReference(filePath,
          nameNode?.text ?? node.text.replace(/^use\s+|;$/g, '').trim(),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1));
        return;
      }

      if (kind && kind !== 'import') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const mods = extractCFamilyModifiers(node);

        // docblock
        let docstring = '';
        const prev = prevSibling(node);
        if (prev?.type === 'comment' && prev.text.startsWith('/**')) {
          const raw = prev.text.replace(/^\/\*\*|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').trim();
          docstring = raw;
        }

        // 继承/实现引用 — base_clause(extends) / class_interface_clause(implements)
        // 注意: 这两个是子节点类型而非 field (childForFieldName 返回 NULL)
        if (type === 'class_declaration' || type === 'interface_declaration' || type === 'enum_declaration') {
          const clauses: Array<[string, string]> = [
            ['base_clause', 'extends'],
            ['class_interface_clause', 'implements'],
          ];
          for (const [clauseType, refKind] of clauses) {
            const clause = findChild(node, clauseType);
            if (!clause) continue;
            for (const c of (clause.namedChildren ?? [])) {
              if (c.type === 'name' || c.type === 'qualified_name') {
                const target = c.text.split('\\').pop();
                if (target && target !== name) {
                  references.push({
                    fromSymbolName: '<file>', fromSymbolId: fileNodeId,
                    referenceName: target, referenceKind: refKind,
                    line: (c.startPosition?.row ?? 0) + 1, col: (c.startPosition?.column ?? 0) + 1,
                    filePath, language: lang,
                  });
                }
              }
            }
          }
        }

        // class traits (use TraitName;)
        if (type === 'class_declaration' || type === 'trait_declaration') {
          const body = findChild(node, 'declaration_list');
          if (body) {
            for (const c of (body.namedChildren ?? [])) {
              if (c.type === 'use_declaration') {
                const traitName = findChild(c, 'qualified_name') ?? findChild(c, 'name');
                references.push({
                  fromSymbolName: qn,
                  fromSymbolId: `${filePath}:${qn}`,
                  referenceName: traitName?.text ?? c.text.replace(/^use\s+|;$/g, '').trim(),
                  referenceKind: 'mixes_in',
                  line: (c.startPosition?.row ?? 0) + 1,
                  col: (c.startPosition?.column ?? 0) + 1,
                  filePath,
                  language: lang,
                });
              }
            }
          }
        }

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          ...mods, signature: firstLine(node), docstring,
        }));
        walkChildren(node, qn);
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 10. C — functions, structs, enums, unions, typedefs, macros, static visibility
// ---------------------------------------------------------------------------

const C_NODE_MAP: Record<string, string> = {
  'function_definition': 'function', 'struct_specifier': 'struct',
  'enum_specifier': 'enum', 'union_specifier': 'struct',
  'type_definition': 'type_alias', 'preproc_function_def': 'function',
  'preproc_def': 'constant', 'declaration': '_decl',
};

EXTRACTOR_REGISTRY.set('c', {
  language: 'c' as Language, grammarName: 'c', nodeTypeMap: C_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'c' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — helper(x) / obj->method(y) / obj.method(y)
      if (type === 'call_expression') {
        const fn = node.childForFieldName?.('function') ?? node.namedChildren?.[0];
        let callee: string | null = null;
        if (fn) {
          if (fn.type === 'identifier') {
            callee = fn.text;
          } else if (fn.type === 'field_expression') {
            const ids = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'field_identifier');
            callee = ids[ids.length - 1]?.text ?? null;
          } else {
            callee = fn.text;
          }
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      // #include → import reference
      if (type === 'preproc_include') {
        const path = findChild(node, 'string_literal') ?? findChild(node, 'system_lib_string');
        references.push(makeImportReference(filePath, (path?.text ?? '').replace(/[<>"]/g, ''),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1, 'header', lang));
        return;
      }

      // #define NAME value → constant
      if (type === 'preproc_def') {
        const name = nodeName(node);
        if (!name) return;
        // skip header guards (e.g. #define FOO_H_)
        if (name.endsWith('_H') || name.endsWith('_H_') || name.endsWith('_INCLUDED')) return;
        const qn = parent ? `${parent}.${name}` : name;
        symbols.push(sym('constant', name, qn, filePath, lang, node, {
          isExported: true, signature: firstLine(node),
        }));
        return;
      }

      // #define NAME(...) → macro function
      if (type === 'preproc_function_def') {
        const name = nodeName(node);
        if (!name) return;
        const qn = parent ? `${parent}.${name}` : name;
        symbols.push(sym('function', name, qn, filePath, lang, node, {
          isExported: true, signature: firstLine(node),
          decorators: ['macro'],
        }));
        return;
      }

      if (type === 'function_definition') {
        const declarator = findChild(node, 'declarator') ?? node;
        const name = nodeName(declarator);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;

        // static → file-local (private)
        const isStatic = node.text?.trimStart().startsWith('static') ?? false;
        const visibility = isStatic ? 'private' : 'public';

        // doc comment
        let docstring = '';
        const prev = prevSibling(node);
        if (prev?.type === 'comment') docstring = prev.text.replace(/^\/\*\*?|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').trim();

        symbols.push(sym('function', name, qn, filePath, lang, node, {
          visibility, isStatic, isExported: !isStatic,
          signature: firstLine(node), docstring,
        }));
        walkChildren(node, qn);
        return;
      }

      if (type === 'struct_specifier' || type === 'union_specifier' || type === 'enum_specifier') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = type === 'enum_specifier' ? 'enum' : 'struct';
        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          isExported: true, signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      // typedef — detect function pointer typedefs
      if (type === 'type_definition') {
        const declarator = findChild(node, 'type_identifier') ?? findChild(node, 'declarator');
        const name = declarator?.text ?? nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isFnPtr = node.text?.includes('(*)') ?? false;
        symbols.push(sym('type_alias', name, qn, filePath, lang, node, {
          isExported: true, signature: firstLine(node),
          decorators: isFnPtr ? ['function_pointer'] : [],
        }));
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 11. C++ — classes, templates, namespaces, public/private/protected, virtual
// ---------------------------------------------------------------------------

const CPP_NODE_MAP: Record<string, string> = {
  'function_definition': 'function', 'class_specifier': 'class',
  'struct_specifier': 'struct', 'enum_specifier': 'enum',
  'namespace_definition': 'namespace', 'template_declaration': '_template',
  'field_declaration': 'field', 'type_definition': 'type_alias',
  'declaration': '_decl',
};

EXTRACTOR_REGISTRY.set('cpp', {
  language: 'cpp' as Language, grammarName: 'cpp', nodeTypeMap: CPP_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'cpp' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const edges: Array<{ source: string; target: string; kind: string; line?: number }> = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string, sectionVisibility?: string): void => {
      const type = node.type;

      // calls 引用 — helper(x) / obj->method(y) / obj.method(y)
      if (type === 'call_expression') {
        const fn = node.childForFieldName?.('function') ?? node.namedChildren?.[0];
        let callee: string | null = null;
        if (fn) {
          if (fn.type === 'identifier') callee = fn.text;
          else if (fn.type === 'field_expression') {
            const ids = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'field_identifier');
            callee = ids[ids.length - 1]?.text ?? null;
          } else callee = fn.text;
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      // #include → import
      if (type === 'preproc_include') {
        const path = findChild(node, 'string_literal') ?? findChild(node, 'system_lib_string');
        references.push(makeImportReference(filePath, (path?.text ?? '').replace(/[<>"]/g, ''),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1, 'header', lang));
        return;
      }

      // namespace
      if (type === 'namespace_definition') {
        const name = nodeName(node) ?? '<anonymous>';
        const qn = parent ? `${parent}.${name}` : name;
        symbols.push(sym('namespace', name, qn, filePath, lang, node, { signature: firstLine(node) }));
        const body = findChild(node, 'declaration_list');
        if (body) for (const c of (body.namedChildren ?? [])) walk(c, qn);
        return;
      }

      // template_declaration — unwrap, pass template params to inner
      if (type === 'template_declaration') {
        const params = findChild(node, 'template_parameter_list');
        const inner = node.namedChildren?.find((c: AnyNode) =>
          c.type === 'function_definition' || c.type === 'class_specifier' || c.type === 'struct_specifier' || c.type === 'declaration');
        if (inner) {
          (inner as AnyNode).__templateParams = params?.text ?? '';
          walk(inner, parent, sectionVisibility);
        }
        return;
      }

      // class / struct
      if (type === 'class_specifier' || type === 'struct_specifier') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = type === 'class_specifier' ? 'class' : 'struct';
        const typeParams: string[] = node.__templateParams ? [node.__templateParams] : [];

        // base class clause — 裸名 edges 由通用层转为 file 锚点引用 (code-resolution 按名解析)
        // 修正: 模板基类 (A<int>) 取 < 前裸名; 跳过 access_specifier
        const baseClause = findChild(node, 'base_class_clause');
        if (baseClause) {
          for (const base of (baseClause.namedChildren ?? [])) {
            if (base.type === 'access_specifier') continue;
            const nameNode = base.childForFieldName?.('name') ??
              (base.type === 'type_identifier' ? base : base.namedChildren?.find((c: AnyNode) => c.type === 'type_identifier'));
            let baseName = nameNode?.text ?? base.text ?? '';
            if (baseName.includes('<')) baseName = baseName.slice(0, baseName.indexOf('<'));
            baseName = baseName.replace(/(public|private|protected|virtual)\s+/g, '').trim();
            if (baseName && baseName !== name) edges.push({ source: qn, target: baseName, kind: 'extends', line: (node.startPosition?.row ?? 0) + 1 });
          }
        }

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          isExported: true, typeParameters: typeParams, signature: firstLine(node),
        }));

        // walk body with access specifier tracking (default: private for class, public for struct)
        const body = findChild(node, 'field_declaration_list');
        let curVis = type === 'class_specifier' ? 'private' : 'public';
        if (body) {
          for (const c of (body.namedChildren ?? [])) {
            if (c.type === 'access_specifier') { curVis = c.text.replace(':', '').trim(); continue; }
            walk(c, qn, curVis);
          }
        }
        return;
      }

      // function definition / method
      if (type === 'function_definition') {
        const declarator = findChild(node, 'declarator') ?? node;
        const name = nodeName(declarator);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isMethod = !!parent && sectionVisibility !== undefined;
        const kind = isMethod ? 'method' : 'function';

        const isStatic = node.text?.trimStart().startsWith('static') ?? false;
        const isVirtual = node.text?.includes('virtual ') ?? false;
        const isOverride = node.text?.includes(' override') ?? false;
        const decos: string[] = [];
        if (isVirtual) decos.push('virtual');
        if (isOverride) decos.push('override');

        const typeParams: string[] = node.__templateParams ? [node.__templateParams] : [];

        // constructor/destructor detection
        const isConstructor = name === parent?.split('.').pop();
        const isDestructor = name.startsWith('~');
        if (isConstructor) decos.push('constructor');
        if (isDestructor) decos.push('destructor');

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          visibility: sectionVisibility ?? (isStatic ? 'private' : ''),
          isStatic, isExported: !isStatic,
          decorators: decos, typeParameters: typeParams,
          signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges };
  },
});

// ---------------------------------------------------------------------------
// 12. Dart — class with mixins/implements, factory, async, annotations, imports
// ---------------------------------------------------------------------------

const DART_NODE_MAP: Record<string, string> = {
  'function_signature': 'function', 'method_signature': 'method',
  'class_definition': 'class', 'enum_declaration': 'enum',
  'mixin_declaration': 'trait', 'extension_declaration': 'class',
  'type_alias': 'type_alias', 'function_body': '_skip',
};

EXTRACTOR_REGISTRY.set('dart', {
  language: 'dart' as Language, grammarName: 'dart', nodeTypeMap: DART_NODE_MAP,
  extract(tree, sourceCode, filePath) {
    const lang = 'dart' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    // Dart tree-sitter grammars vary; also scan source lines for import/part/export
    const lines = sourceCode.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const importMatch = line.match(/^(?:import|export|part|part\s+of)\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        references.push(makeImportReference(filePath, importMatch[1], i + 1, 1));
      }
    }

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — akavel grammar: 调用 = identifier + selector(argument_part) 兄弟链
      if (type === 'selector' && node.namedChildren?.[0]?.type === 'argument_part') {
        const prev = node.previousNamedSibling;
        let callee: string | null = null;
        if (prev) {
          if (prev.type === 'identifier') callee = prev.text;
          else if (prev.type === 'unconditional_assignable_selector' || prev.type === 'conditional_assignable_selector') {
            callee = prev.namedChildren?.find((c: AnyNode) => c.type === 'identifier')?.text ?? null;
          } else if (prev.type === 'selector') {
            callee = prev.namedChildren?.[0]?.namedChildren?.find((c: AnyNode) => c.type === 'identifier')?.text ?? null;
          }
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }
      // 新语法兜底
      if (type === 'function_expression' || type === 'method_invocation') {
        const fn = node.childForFieldName?.('function') ?? node.namedChildren?.[0];
        const callee = fn?.type === 'identifier' ? fn.text : fn?.text ?? null;
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }
      // new Foo() → 构造调用
      if (type === 'new_expression') {
        const typeNode = node.namedChildren?.find((c: AnyNode) => c.type === 'type_identifier');
        if (typeNode?.text) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: typeNode.text, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      if (type === 'class_definition' || type === 'mixin_declaration' || type === 'enum_declaration' || type === 'extension_declaration') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = type === 'mixin_declaration' ? 'trait' : type === 'enum_declaration' ? 'enum' : 'class';

        // annotations (@override, @deprecated, etc.)
        const decos = extractDecorators(node, 'annotation');

        // 继承/实现引用 — superclass 字段 = extends; interfaces 字段 = implements
        const superNode = node.childForFieldName?.('superclass') ?? findChild(node, 'superclass');
        if (superNode) {
          const extType = superNode.namedChildren?.find((c: AnyNode) => c.type === 'type_identifier');
          if (extType?.text && extType.text !== name) {
            references.push({
              fromSymbolName: '<file>', fromSymbolId: fileNodeId,
              referenceName: extType.text, referenceKind: 'extends',
              line: (superNode.startPosition?.row ?? 0) + 1, col: (superNode.startPosition?.column ?? 0) + 1,
              filePath, language: lang,
            });
          }
          const mixins = superNode.namedChildren?.find((c: AnyNode) => c.type === 'mixins');
          for (const m of (mixins?.namedChildren ?? [])) {
            if (m.type === 'type_identifier' && m.text !== name) {
              references.push({
                fromSymbolName: '<file>', fromSymbolId: fileNodeId,
                referenceName: m.text, referenceKind: 'implements',
                line: (m.startPosition?.row ?? 0) + 1, col: (m.startPosition?.column ?? 0) + 1,
                filePath, language: lang,
              });
            }
          }
        }
        const ifaceNode = node.childForFieldName?.('interfaces') ?? findChild(node, 'interfaces');
        for (const it of (ifaceNode?.namedChildren ?? [])) {
          if (it.type === 'type_identifier' && it.text !== name) {
            references.push({
              fromSymbolName: '<file>', fromSymbolId: fileNodeId,
              referenceName: it.text, referenceKind: 'implements',
              line: (it.startPosition?.row ?? 0) + 1, col: (it.startPosition?.column ?? 0) + 1,
              filePath, language: lang,
            });
          }
        }

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          isExported: !name.startsWith('_'), decorators: decos,
          visibility: name.startsWith('_') ? 'private' : 'public',
          signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      // function / method declarations (tree-sitter may use different node types)
      if (type === 'function_signature' || type === 'method_signature' ||
          type === 'function_declaration' || type === 'method_declaration') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isMethod = parent !== '' || type.includes('method');

        // factory / async / async* / sync* detection from source text
        const text = node.text ?? '';
        const isFactory = text.trimStart().startsWith('factory');
        const isAsync = text.includes('async');
        const decos = extractDecorators(node, 'annotation');
        if (isFactory) decos.push('factory');

        symbols.push(sym(isMethod ? 'method' : 'function', name, qn, filePath, lang, node, {
          visibility: name.startsWith('_') ? 'private' : 'public',
          isExported: !name.startsWith('_'), isAsync, decorators: decos,
          signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      // field declarations: late final Type name;
      if (type === 'declaration' || type === 'initialized_variable_definition') {
        if (parent) {
          const name = nodeName(node);
          if (name) {
            const qn = `${parent}.${name}`;
            const text = node.text ?? '';
            const isLate = text.includes('late ');
            const isFinal = text.includes('final ');
            const isStatic = text.includes('static ');
            const decos: string[] = [];
            if (isLate) decos.push('late');
            if (isFinal) decos.push('final');
            symbols.push(sym('property', name, qn, filePath, lang, node, {
              visibility: name.startsWith('_') ? 'private' : 'public',
              isStatic, decorators: decos, signature: firstLine(node),
            }));
          }
        }
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 13. Svelte — script block functions, exported props, reactive $:, imports
// ---------------------------------------------------------------------------

const SVELTE_NODE_MAP: Record<string, string> = {
  'element': 'component', 'script_element': '_script',
};

EXTRACTOR_REGISTRY.set('svelte', {
  language: 'svelte' as Language, grammarName: 'svelte', nodeTypeMap: SVELTE_NODE_MAP,
  extract(tree, sourceCode, filePath) {
    const lang = 'svelte' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];

    // Svelte tree-sitter is limited — scan source for JS patterns inside <script>
    const lines = sourceCode.split('\n');
    let inScript = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('<script')) { inScript = true; continue; }
      if (line.startsWith('</script')) { inScript = false; continue; }
      if (!inScript) continue;

      // import statements
      const importMatch = line.match(/^import\s+.+\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        references.push(makeImportReference(filePath, importMatch[1], i + 1, 1));
        continue;
      }

      // export let propName — component prop
      const propMatch = line.match(/^export\s+let\s+(\w+)/);
      if (propMatch) {
        symbols.push(sym('property', propMatch[1], propMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { isExported: true, visibility: 'public', decorators: ['prop'] }));
        continue;
      }

      // function declarations
      const fnMatch = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (fnMatch) {
        symbols.push(sym('function', fnMatch[1], fnMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { isExported: line.startsWith('export'), isAsync: line.includes('async '),
            signature: line }));
        continue;
      }

      // reactive $: statement
      const reactiveMatch = line.match(/^\$:\s+(?:let\s+)?(\w+)/);
      if (reactiveMatch) {
        symbols.push(sym('variable', reactiveMatch[1], reactiveMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { decorators: ['reactive'] }));
        continue;
      }
    }

    // Also walk the AST for component elements
    const walkAst = (node: AnyNode): void => {
      if (node.type === 'element') {
        const tag = findChild(node, 'start_tag') ?? findChild(node, 'self_closing_tag');
        const tagName = findChild(tag, 'tag_name')?.text;
        if (tagName && tagName[0] === tagName[0].toUpperCase()) {
          symbols.push(sym('component', tagName, tagName, filePath, lang, node, { signature: firstLine(node) }));
        }
      }
      for (const c of (node.namedChildren ?? [])) walkAst(c);
    };
    walkAst((tree as AnyNode).rootNode);

    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 14. Vue — script setup, defineProps/defineEmits, ref/reactive/computed, imports
// ---------------------------------------------------------------------------

const VUE_NODE_MAP: Record<string, string> = {
  'element': 'component', 'start_tag': '_tag',
};

EXTRACTOR_REGISTRY.set('vue', {
  language: 'vue' as Language, grammarName: 'vue', nodeTypeMap: VUE_NODE_MAP,
  extract(tree, sourceCode, filePath) {
    const lang = 'vue' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];

    // Vue tree-sitter coverage is limited — scan source for patterns
    const lines = sourceCode.split('\n');
    let inScript = false;
    let isSetup = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/<script[^>]*>/)) {
        inScript = true;
        isSetup = line.includes('setup');
        continue;
      }
      if (line.startsWith('</script')) { inScript = false; continue; }
      if (!inScript) continue;

      // import statements
      const importMatch = line.match(/^import\s+.+\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        references.push(makeImportReference(filePath, importMatch[1], i + 1, 1));
        continue;
      }

      // defineProps / defineEmits / defineExpose
      const defineMatch = line.match(/(?:const\s+\w+\s*=\s*)?(defineProps|defineEmits|defineExpose)\s*[<(]/);
      if (defineMatch) {
        symbols.push(sym('function', defineMatch[1], defineMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { decorators: ['component_contract'], signature: line }));
        continue;
      }

      // ref / reactive / computed declarations
      const reactiveMatch = line.match(/(?:const|let)\s+(\w+)\s*=\s*(ref|reactive|computed)\s*[<(]/);
      if (reactiveMatch) {
        symbols.push(sym('variable', reactiveMatch[1], reactiveMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { decorators: [reactiveMatch[2]], signature: line }));
        continue;
      }

      // composables (use* functions)
      const composableMatch = line.match(/(?:const|let)\s+(\w+)\s*=\s+(use\w+)\s*\(/);
      if (composableMatch) {
        references.push({
          fromSymbolName: '<module>',
          fromSymbolId: `${filePath}:<module>`,
          referenceName: composableMatch[2],
          referenceKind: 'calls',
          line: i + 1,
          col: 1,
          filePath,
          language: lang,
        });
        continue;
      }

      // function declarations inside script
      const fnMatch = line.match(/^(?:async\s+)?function\s+(\w+)/);
      if (fnMatch) {
        symbols.push(sym('function', fnMatch[1], fnMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { isAsync: line.includes('async '), signature: line }));
        continue;
      }
    }

    // Mark component as script setup if detected
    if (isSetup) {
      symbols.push(sym('component', '<script setup>', '<script setup>', filePath, lang,
        { startPosition: { row: 0, column: 0 }, endPosition: { row: lines.length - 1, column: 0 } },
        { decorators: ['script_setup'] }));
    }

    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 15. Liquid — template tags: render/include, section, assign/capture, schema
// ---------------------------------------------------------------------------

const LIQUID_NODE_MAP: Record<string, string> = {
  'tag': '_tag', 'raw_tag': '_tag',
};

EXTRACTOR_REGISTRY.set('liquid', {
  language: 'liquid' as Language, grammarName: 'liquid', nodeTypeMap: LIQUID_NODE_MAP,
  extract(_tree, sourceCode, filePath) {
    const lang = 'liquid' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];

    // Liquid has limited tree-sitter support — regex-based extraction
    const lines = sourceCode.split('\n');
    let inSchema = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // {% render 'snippet' %} / {% include 'snippet' %} → import
      const renderMatch = line.match(/\{%[-]?\s*(render|include)\s+['"]([^'"]+)['"]/);
      if (renderMatch) {
        references.push(makeImportReference(filePath, renderMatch[2], i + 1, 1, renderMatch[1]));
        continue;
      }

      // {% section 'name' %} → component/module
      const sectionMatch = line.match(/\{%[-]?\s*section\s+['"]([^'"]+)['"]/);
      if (sectionMatch) {
        symbols.push(sym('component', sectionMatch[1], sectionMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { decorators: ['section'], signature: line }));
        continue;
      }

      // {% assign name = ... %} → variable
      const assignMatch = line.match(/\{%[-]?\s*assign\s+(\w+)\s*=/);
      if (assignMatch) {
        symbols.push(sym('variable', assignMatch[1], assignMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { signature: line }));
        continue;
      }

      // {% capture name %} → variable
      const captureMatch = line.match(/\{%[-]?\s*capture\s+(\w+)/);
      if (captureMatch) {
        symbols.push(sym('variable', captureMatch[1], captureMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { decorators: ['capture'], signature: line }));
        continue;
      }

      // {% schema %} JSON block detection
      if (line.match(/\{%[-]?\s*schema\s*[-]?%\}/)) {
        inSchema = true;
        symbols.push(sym('variable', '<schema>', '<schema>', filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { decorators: ['schema_block'] }));
        continue;
      }
      if (line.match(/\{%[-]?\s*endschema\s*[-]?%\}/)) { inSchema = false; continue; }
    }

    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 16. Pascal — procedure/function, unit/program, uses, class/record/interface
// ---------------------------------------------------------------------------

const PASCAL_NODE_MAP: Record<string, string> = {
  'procedure_declaration': 'function', 'function_declaration': 'function',
  'class_declaration': 'class', 'record_declaration': 'struct',
  'interface_declaration': 'interface',
};

EXTRACTOR_REGISTRY.set('pascal', {
  language: 'pascal' as Language, grammarName: 'pascal', nodeTypeMap: PASCAL_NODE_MAP,
  extract(tree, sourceCode, filePath) {
    const lang = 'pascal' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];

    // Pascal tree-sitter is immature — regex-based extraction
    const lines = sourceCode.split('\n');
    let currentClass = '';
    let currentVisibility = 'public';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // unit/program/library → module
      const unitMatch = line.match(/^(unit|program|library)\s+(\w+)/i);
      if (unitMatch) {
        symbols.push(sym('module', unitMatch[2], unitMatch[2], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { decorators: [unitMatch[1].toLowerCase()], signature: line }));
        continue;
      }

      // uses clause → imports
      const usesMatch = line.match(/^uses\s+(.+)/i);
      if (usesMatch) {
        const units = usesMatch[1].replace(/;$/, '').split(',').map(s => s.trim()).filter(Boolean);
        for (const u of units) {
          references.push(makeImportReference(filePath, u, i + 1, 1, 'unit'));
        }
        continue;
      }

      // class / record / interface (object)
      const classMatch = line.match(/^(\w+)\s*=\s*(class|record|interface)\b/i);
      if (classMatch) {
        const name = classMatch[1];
        const kind = classMatch[2].toLowerCase() === 'class' ? 'class' :
          classMatch[2].toLowerCase() === 'interface' ? 'interface' : 'struct';
        currentClass = name;
        currentVisibility = 'public';
        symbols.push(sym(kind, name, name, filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { signature: line }));
        continue;
      }

      // visibility sections inside class
      if (/^\b(public|private|protected|published)\b/i.test(line)) {
        currentVisibility = line.replace(/\s*$/, '').toLowerCase();
        continue;
      }

      // end of class
      if (currentClass && /^end\s*;/i.test(line)) { currentClass = ''; continue; }

      // procedure / function
      const fnMatch = line.match(/^(procedure|function|constructor|destructor)\s+(?:(\w+)\.)?(\w+)/i);
      if (fnMatch) {
        const fnType = fnMatch[1].toLowerCase();
        const owner = fnMatch[2] || currentClass;
        const name = fnMatch[3];
        const qn = owner ? `${owner}.${name}` : name;
        const kind = owner ? 'method' : 'function';
        const decos: string[] = [];
        if (fnType === 'constructor') decos.push('constructor');
        if (fnType === 'destructor') decos.push('destructor');
        symbols.push(sym(kind, name, qn, filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { visibility: owner ? currentVisibility : '', decorators: decos, signature: line }));
        continue;
      }

      // type declarations (simple: TFoo = Integer)
      const typeMatch = line.match(/^(\w+)\s*=\s*(?!class\b|record\b|interface\b)(\w+)/i);
      if (typeMatch && !currentClass) {
        symbols.push(sym('type_alias', typeMatch[1], typeMatch[1], filePath, lang,
          { startPosition: { row: i, column: 0 }, endPosition: { row: i, column: line.length } },
          { signature: line }));
      }
    }

    // calls 引用 — 真实 AST 遍历 (vendored tree-sitter-pascal.wasm)
    // 调用节点类型为 exprCall, 被调者 = 首个 named child:
    //   identifier (writeln/sqrt/IntToStr) 或 exprDot (TForm1.Button1Click → 末位 identifier 即方法名)
    const pascalRoot = (tree as AnyNode | null | undefined)?.rootNode;
    if (pascalRoot) {
      const fileNodeId = makeFileNodeId(filePath);
      const walkPascal = (node: AnyNode): void => {
        if (node.type === 'exprCall') {
          const fn = node.namedChildren?.[0];
          let callee: string | null = null;
          if (fn) {
            if (fn.type === 'identifier') {
              callee = fn.text;
            } else if (fn.type === 'exprDot') {
              const ids = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'identifier');
              callee = ids[ids.length - 1]?.text ?? null;
            }
          }
          if (callee) {
            references.push({
              fromSymbolName: '<file>',
              fromSymbolId: fileNodeId,
              referenceName: callee,
              referenceKind: 'calls',
              line: (node.startPosition?.row ?? 0) + 1,
              col: (node.startPosition?.column ?? 0) + 1,
              filePath,
              language: lang,
            });
          }
        }
        for (const c of node.namedChildren ?? []) walkPascal(c);
      };
      walkPascal(pascalRoot);
    }

    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 17. Scala — def/val/var, object, trait, case class, implicit/lazy, imports
// ---------------------------------------------------------------------------

const SCALA_NODE_MAP: Record<string, string> = {
  'function_definition': 'function', 'class_definition': 'class',
  'object_definition': 'class', 'trait_definition': 'trait',
  'val_definition': 'property', 'var_definition': 'property',
  'type_definition': 'type_alias', 'import_declaration': 'import',
};

EXTRACTOR_REGISTRY.set('scala', {
  language: 'scala' as Language, grammarName: 'scala', nodeTypeMap: SCALA_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'scala' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — call_expression (function 字段: identifier/generic_function/field_expression/operator_identifier)
      if (type === 'call_expression') {
        const fn = node.childForFieldName?.('function') ?? node.namedChildren?.[0];
        let callee: string | null = null;
        if (fn) {
          if (fn.type === 'identifier') callee = fn.text;
          else if (fn.type === 'generic_function') {
            callee = fn.childForFieldName?.('function')?.text ?? fn.namedChildren?.[0]?.text ?? null;
          } else if (fn.type === 'field_expression') {
            callee = fn.childForFieldName?.('field')?.text ?? null;
          } else if (fn.type === 'operator_identifier') {
            callee = fn.text;
          }
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      // import
      if (type === 'import_declaration') {
        const path = node.namedChildren?.[0];
        references.push(makeImportReference(filePath,
          path?.text ?? node.text.replace(/^import\s+/, '').trim(),
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1));
        return;
      }

      // class / object / trait
      if (type === 'class_definition' || type === 'object_definition' || type === 'trait_definition') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = type === 'trait_definition' ? 'trait' :
          type === 'object_definition' ? 'class' : 'class';
        const text = node.text ?? '';
        const isCaseClass = text.trimStart().startsWith('case class');
        const decos: string[] = [];
        if (isCaseClass) decos.push('case');
        if (type === 'object_definition') decos.push('object');
        // annotations
        decos.push(...extractDecorators(node, 'annotation'));

        // modifiers
        const isAbstract = text.includes('abstract ');
        const isSealed = text.includes('sealed ');
        if (isSealed) decos.push('sealed');

        // 继承/实现引用 — extends_clause 是位置子节点 (无字段), 递归收集全部父类型
        // (兼容 vendored compound_type 平铺与新版 with 子句两种 grammar)
        const ext = node.namedChildren?.find((c: AnyNode) => c.type === 'extends_clause');
        if (ext) {
          const parentNames: string[] = [];
          const collectTypes = (n: AnyNode | null | undefined): void => {
            if (!n) return;
            if (n.type === 'type_identifier') { parentNames.push(n.text); return; }
            if (n.type === 'generic_type') {
              const ti = findChild(n, 'type_identifier');
              if (ti) parentNames.push(ti.text);
              return;
            }
            for (const c of (n.namedChildren ?? [])) collectTypes(c);
          };
          collectTypes(ext);
          parentNames.forEach((pn, i) => {
            if (pn === name) return;
            references.push({
              fromSymbolName: '<file>', fromSymbolId: fileNodeId,
              referenceName: pn, referenceKind: i === 0 ? 'extends' : 'implements',
              line: (ext.startPosition?.row ?? 0) + 1, col: (ext.startPosition?.column ?? 0) + 1,
              filePath, language: lang,
            });
          });
        }

        symbols.push(sym(kind, name, qn, filePath, lang, node, {
          isAbstract, decorators: decos, isStatic: type === 'object_definition',
          signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      // def (function / method)
      if (type === 'function_definition') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isMethod = parent !== '';
        const text = node.text ?? '';
        const isImplicit = text.includes('implicit ');
        const decos: string[] = [];
        if (isImplicit) decos.push('implicit');
        decos.push(...extractDecorators(node, 'annotation'));

        const visibility = text.includes('private ') ? 'private' :
          text.includes('protected ') ? 'protected' : 'public';

        symbols.push(sym(isMethod ? 'method' : 'function', name, qn, filePath, lang, node, {
          visibility, decorators: decos, signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      // val / var
      if (type === 'val_definition' || type === 'var_definition') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const text = node.text ?? '';
        const isLazy = text.includes('lazy ');
        const isImplicit = text.includes('implicit ');
        const decos: string[] = [];
        if (isLazy) decos.push('lazy');
        if (isImplicit) decos.push('implicit');
        if (type === 'var_definition') decos.push('var');

        symbols.push(sym('property', name, qn, filePath, lang, node, {
          decorators: decos, signature: firstLine(node),
        }));
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 18. Lua — function (global/local), require, module pattern, tables
// ---------------------------------------------------------------------------

/** Lua/Luau 被调用名 — 兼容两种 grammar 形状:
 *  tree-sitter-wasms lua: call.function → variable (最后一个 identifier / name 字段)
 *  vendored lua/luau:    function_call.name → identifier | dot_index_expression | method_index_expression */
function extractLuaCallee(node: AnyNode): string | null {
  const fn = node.childForFieldName?.('function');
  if (fn) {
    if (fn.type === 'variable') {
      const kids = fn.namedChildren ?? [];
      const last = kids[kids.length - 1];
      if (last?.type === 'identifier') return last.text;
      const n = fn.childForFieldName?.('name');
      return n?.text ?? null;
    }
    return fn.text ?? null;
  }
  const nameNode = node.childForFieldName?.('name');
  if (!nameNode) return null;
  if (nameNode.type === 'identifier') return nameNode.text;
  const kids = nameNode.namedChildren ?? [];
  const last = kids[kids.length - 1];
  if (last?.type === 'identifier') return last.text;
  return nameNode.text.split(/[.:]/).pop() ?? null;
}

/** 取调用参数中第一个字符串字面量 (require 模块名) — 兼容 arguments / argument_list 子树 */
function firstStringArg(node: AnyNode): string | null {
  const args = node.childForFieldName?.('arguments')
    ?? node.children?.find((c: AnyNode) => c.type === 'arguments' || c.type === 'argument_list');
  const stack: AnyNode[] = args ? [args] : [];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.type === 'string') return cur.text.replace(/['"]/g, '');
    for (const c of (cur.namedChildren ?? [])) stack.push(c);
  }
  return null;
}

const LUA_NODE_MAP: Record<string, string> = {
  'function_declaration': 'function', 'function_definition': 'function',
  'local_function': 'function', 'assignment_statement': '_assign',
  'local_variable_declaration': '_local',
};

EXTRACTOR_REGISTRY.set('lua', {
  language: 'lua' as Language, grammarName: 'lua', nodeTypeMap: LUA_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'lua' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — helper(x) / obj:method(x) / obj.method(x); require('m') → imports
      if (type === 'function_call' || type === 'call') {
        const callee = extractLuaCallee(node);
        if (callee === 'require') {
          const mod = firstStringArg(node) ?? '';
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: mod, referenceKind: 'imports',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
          return;
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      // function declarations (global and local)
      if (type === 'function_declaration' || type === 'local_function') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isLocal = type === 'local_function';
        symbols.push(sym('function', name, qn, filePath, lang, node, {
          visibility: isLocal ? 'private' : 'public',
          isExported: !isLocal, signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      // require('module') → import
      if (type === 'function_call' || type === 'call') {
        const fnName = nodeName(node) ?? findChild(node, 'identifier')?.text;
        if (fnName === 'require') {
          const args = findChild(node, 'arguments') ?? findChild(node, 'argument_list');
          const strArg = args?.namedChildren?.[0] ?? findChild(node, 'string');
          references.push(makeImportReference(filePath,
            (strArg?.text ?? '').replace(/['"]/g, ''),
            (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1,
            'require'));
          return;
        }
      }

      // assignment: M = {} (module pattern) or M.fn = function()
      if (type === 'assignment_statement') {
        const lhs = node.namedChildren?.[0];
        const rhs = node.namedChildren?.[1] ?? findChild(node, 'expression_list')?.namedChildren?.[0];
        if (rhs?.type === 'function_definition' || rhs?.type === 'function') {
          // M.fn = function(...) → method
          const name = lhs?.text ?? '';
          if (name.includes('.')) {
            const parts = name.split('.');
            const fnName = parts.pop() ?? '';
            const ownerName = parts.join('.');
            symbols.push(sym('method', fnName, name, filePath, lang, node, {
              signature: firstLine(node),
            }));
          } else if (name) {
            symbols.push(sym('function', name, name, filePath, lang, node, {
              signature: firstLine(node),
            }));
          }
          return;
        }
        // M = {} table constructor → module pattern
        if (rhs?.type === 'table_constructor' && lhs?.type === 'identifier') {
          symbols.push(sym('module', lhs.text, lhs.text, filePath, lang, node, {
            decorators: ['module_table'], signature: firstLine(node),
          }));
          return;
        }
      }

      // return M at top level — module export indicator (skip, already captured)

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 19. Luau — Lua + type declarations, export type, strict mode
// ---------------------------------------------------------------------------

const LUAU_NODE_MAP: Record<string, string> = {
  'function_declaration': 'function', 'function_definition': 'function',
  'local_function': 'function', 'assignment_statement': '_assign',
  'local_variable_declaration': '_local',
  'type_declaration': 'type_alias',
};

EXTRACTOR_REGISTRY.set('luau', {
  language: 'luau' as Language, grammarName: 'luau', nodeTypeMap: LUAU_NODE_MAP,
  extract(tree, sourceCode, filePath) {
    const lang = 'luau' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const fileNodeId = makeFileNodeId(filePath);

    // Detect strict mode from first line
    const firstSrcLine = sourceCode.split('\n')[0]?.trim() ?? '';
    const isStrict = firstSrcLine.includes('--!strict');

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — helper(x) / obj:method(x) / obj.method(x); require('m') → imports
      if (type === 'function_call' || type === 'call') {
        const callee = extractLuaCallee(node);
        if (callee === 'require') {
          const mod = firstStringArg(node) ?? '';
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: mod, referenceKind: 'imports',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
          return;
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }

      // function declarations
      if (type === 'function_declaration' || type === 'local_function') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isLocal = type === 'local_function';
        symbols.push(sym('function', name, qn, filePath, lang, node, {
          visibility: isLocal ? 'private' : 'public',
          isExported: !isLocal, signature: firstLine(node),
          decorators: isStrict ? ['strict'] : [],
        }));
        walkChildren(node, qn);
        return;
      }

      // type declaration (Luau-specific)
      if (type === 'type_declaration') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const text = node.text ?? '';
        const isExportType = text.trimStart().startsWith('export type');
        symbols.push(sym('type_alias', name, qn, filePath, lang, node, {
          isExported: isExportType,
          visibility: isExportType ? 'public' : 'private',
          decorators: isExportType ? ['export_type'] : [],
          signature: firstLine(node),
        }));
        return;
      }

      // require
      if (type === 'function_call' || type === 'call') {
        const fnName = nodeName(node) ?? findChild(node, 'identifier')?.text;
        if (fnName === 'require') {
          const args = findChild(node, 'arguments') ?? findChild(node, 'argument_list');
          const strArg = args?.namedChildren?.[0] ?? findChild(node, 'string');
          references.push(makeImportReference(filePath,
            (strArg?.text ?? '').replace(/['"]/g, ''),
            (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1,
            'require'));
          return;
        }
      }
      // assignment: M.fn = function() or M = {}
      if (type === 'assignment_statement') {
        const lhs = node.namedChildren?.[0];
        const rhs = node.namedChildren?.[1] ?? findChild(node, 'expression_list')?.namedChildren?.[0];
        if (rhs?.type === 'function_definition' || rhs?.type === 'function') {
          const name = lhs?.text ?? '';
          if (name.includes('.')) {
            const parts = name.split('.');
            const fnName = parts.pop() ?? '';
            symbols.push(sym('method', fnName, name, filePath, lang, node, { signature: firstLine(node) }));
          } else if (name) {
            symbols.push(sym('function', name, name, filePath, lang, node, { signature: firstLine(node) }));
          }
          return;
        }
        if (rhs?.type === 'table_constructor' && lhs?.type === 'identifier') {
          symbols.push(sym('module', lhs.text, lhs.text, filePath, lang, node, {
            decorators: ['module_table'], signature: firstLine(node),
          }));
          return;
        }
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 20. Obj-C — @interface/@implementation/@protocol, -/+ methods, @property, #import
// ---------------------------------------------------------------------------

const OBJC_NODE_MAP: Record<string, string> = {
  'class_interface': 'class', 'class_implementation': 'class',
  'protocol_declaration': 'protocol',
  'method_declaration': 'method', 'method_definition': 'method',
  'property_declaration': 'property',
};

interface ObjCCategoryIdentity {
  isCategory: boolean;
  name: string;
  endIndex: number | null;
}

interface ObjCStructuralCandidate {
  sourceQualifiedName: string;
  sourceDeclarationKind: 'class' | 'protocol' | 'category';
  targetName: string;
  relationHint: 'extends' | 'implements' | 'decorates';
  targetKindHints: Array<'class' | 'protocol'>;
  line: number;
  col: number;
  priority: number;
  compilationCondition?: string;
}

interface ObjCEdgeCandidate {
  source: string;
  target: string;
  kind: string;
  line: number;
  col: number;
}

function objcDeclarationNameNode(node: AnyNode): AnyNode | null {
  return (node.namedChildren ?? []).find((child: AnyNode) => child.type === 'identifier') ?? null;
}

/** 保留 tree-sitter-objc 无法放进 identifier field 的宏 category 原文。 */
function objcCategoryIdentity(node: AnyNode, nameNode: AnyNode): ObjCCategoryIdentity {
  const categoryNode = node.childForFieldName?.('category');
  const text = node.text ?? '';
  const localNameEnd = Math.max(0, (nameNode.endIndex ?? node.startIndex) - (node.startIndex ?? 0));
  let cursor = localNameEnd;
  while (/\s/.test(text[cursor] ?? '')) cursor++;
  if (text[cursor] !== '(') {
    return categoryNode?.text
      ? { isCategory: true, name: categoryNode.text.trim(), endIndex: categoryNode.endIndex }
      : { isCategory: false, name: '', endIndex: null };
  }

  const categoryStart = cursor;
  let depth = 0;
  for (; cursor < text.length; cursor++) {
    if (text[cursor] === '(') depth++;
    if (text[cursor] !== ')') continue;
    depth--;
    if (depth !== 0) continue;
    return {
      isCategory: true,
      name: text.slice(categoryStart + 1, cursor).trim(),
      endIndex: (node.startIndex ?? 0) + cursor + 1,
    };
  }
  return { isCategory: false, name: '', endIndex: null };
}

function splitObjCTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let angle = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let index = 0; index < value.length; index++) {
    switch (value[index]) {
      case '<': angle++; break;
      case '>': angle = Math.max(0, angle - 1); break;
      case '(': paren++; break;
      case ')': paren = Math.max(0, paren - 1); break;
      case '[': bracket++; break;
      case ']': bracket = Math.max(0, bracket - 1); break;
      case '{': brace++; break;
      case '}': brace = Math.max(0, brace - 1); break;
      case ',':
        if (angle === 0 && paren === 0 && bracket === 0 && brace === 0) {
          parts.push(value.slice(start, index).trim());
          start = index + 1;
        }
        break;
      default: break;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function objcTypeNamesFromList(node: AnyNode): string[] {
  const text = (node.text ?? '').trim().replace(/^</, '').replace(/>$/, '');
  return splitObjCTopLevel(text).flatMap(part => {
    const match = part.match(/^(?:(?:__covariant|__contravariant)\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/);
    return match ? [match[1]] : [];
  });
}

function objcProtocolListNodes(
  node: AnyNode,
  nameNode: AnyNode,
  superclassNode: AnyNode | null,
  category: ObjCCategoryIdentity,
): AnyNode[] {
  const directLists = (node.namedChildren ?? []).filter((child: AnyNode) =>
    child.type === 'protocol_reference_list' || child.type === 'parameterized_arguments');
  if (node.type === 'protocol_declaration') return directLists;

  const explicitLists = directLists.filter((child: AnyNode) => child.type === 'protocol_reference_list');
  const parameterized = directLists.filter((child: AnyNode) => child.type === 'parameterized_arguments');
  if (category.isCategory) {
    const categoryEnd = category.endIndex ?? nameNode.endIndex ?? node.startIndex ?? 0;
    return [...explicitLists, ...parameterized.filter((child: AnyNode) =>
      (child.startIndex ?? 0) >= categoryEnd)];
  }
  if (superclassNode) {
    const afterSuperclass = parameterized.filter((child: AnyNode) =>
      (child.startIndex ?? 0) >= (superclassNode.endIndex ?? 0));
    return [...explicitLists, ...(afterSuperclass.length > 1
      ? [afterSuperclass[afterSuperclass.length - 1]]
      : afterSuperclass)];
  }
  return [...explicitLists, ...parameterized.filter((child: AnyNode) =>
    (child.startIndex ?? 0) >= (nameNode.endIndex ?? 0))];
}

const OBJC_DECLARATOR_NODE_TYPES = new Set([
  'array_declarator',
  'attributed_declarator',
  'block_pointer_declarator',
  'function_declarator',
  'init_declarator',
  'parenthesized_declarator',
  'pointer_declarator',
]);

/** 沿嵌套 C declarator 找到最终的 property identifier。 */
function objcDeclaratorIdentifier(node: AnyNode): string | null {
  if (node.type === 'identifier' || node.type === 'field_identifier') {
    return /^[A-Za-z_]\w*$/.test(node.text ?? '') ? node.text : null;
  }
  const fieldDeclarator = node.childForFieldName?.('declarator');
  if (fieldDeclarator && fieldDeclarator !== node) {
    const name = objcDeclaratorIdentifier(fieldDeclarator);
    if (name) return name;
  }
  for (const child of (node.namedChildren ?? [])) {
    if (!OBJC_DECLARATOR_NODE_TYPES.has(child.type)) continue;
    const name = objcDeclaratorIdentifier(child);
    if (name) return name;
  }
  for (const child of (node.namedChildren ?? [])) {
    if (child.type !== 'identifier' && child.type !== 'field_identifier') continue;
    const name = objcDeclaratorIdentifier(child);
    if (name) return name;
  }
  return null;
}

function objcFallbackPropertyNames(node: AnyNode): string[] {
  let declaration = (node.text ?? '').replace(/^\s*@property\b/, '').trim().replace(/;\s*$/, '');
  if (declaration.startsWith('(')) {
    let depth = 0;
    for (let index = 0; index < declaration.length; index++) {
      if (declaration[index] === '(') depth++;
      if (declaration[index] !== ')') continue;
      depth--;
      if (depth !== 0) continue;
      declaration = declaration.slice(index + 1).trim();
      break;
    }
  }
  return splitObjCTopLevel(declaration).flatMap(part => {
    const block = part.match(/\(\s*\^\s*([A-Za-z_]\w*)/);
    if (block) return [block[1]];
    const array = part.match(/([A-Za-z_]\w*)\s*\[/);
    if (array) return [array[1]];
    const parenthesized = part.match(/\(\s*([A-Za-z_]\w*)\s*\)\s*$/);
    if (parenthesized) return [parenthesized[1]];
    const identifiers = [...part.matchAll(/[A-Za-z_]\w*/g)];
    return identifiers.length > 0 ? [identifiers[identifiers.length - 1][0]] : [];
  });
}

function objcPropertyNames(node: AnyNode): string[] {
  const names: string[] = [];
  for (const declaration of (node.namedChildren ?? [])) {
    if (declaration.type === 'struct_declaration') {
      for (const declarator of (declaration.namedChildren ?? [])) {
        if (declarator.type !== 'struct_declarator') continue;
        const name = objcDeclaratorIdentifier(declarator);
        if (name) names.push(name);
      }
    } else if (declaration.type === 'atomic_declaration') {
      const name = objcDeclaratorIdentifier(declaration);
      if (name) names.push(name);
    }
  }
  return [...new Set(names.length > 0 ? names : objcFallbackPropertyNames(node))];
}

function objcMethodSelector(node: AnyNode): string | null {
  const parameters = (node.namedChildren ?? [])
    .filter((child: AnyNode) => child.type === 'method_parameter')
    .sort((left: AnyNode, right: AnyNode) => (left.startIndex ?? 0) - (right.startIndex ?? 0));
  if (parameters.length === 0) {
    return (node.namedChildren ?? []).find((child: AnyNode) => child.type === 'identifier')?.text ?? null;
  }
  const text = node.text ?? '';
  const nodeStart = node.startIndex ?? 0;
  let previousEnd = nodeStart;
  const pieces: string[] = [];
  for (const parameter of parameters) {
    const gap = text.slice(
      Math.max(0, previousEnd - nodeStart),
      Math.max(0, (parameter.startIndex ?? nodeStart) - nodeStart),
    );
    const identifiers = [...gap.matchAll(/[A-Za-z_]\w*/g)];
    const piece = identifiers[identifiers.length - 1]?.[0];
    if (!piece) return null;
    pieces.push(`${piece}:`);
    previousEnd = parameter.endIndex ?? previousEnd;
  }
  return pieces.join('');
}

function objcCompilationConditions(sourceCode: string): Map<number, string> {
  const conditions = new Map<number, string>();
  const stack: string[] = [];
  const lines = sourceCode.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const directive = lines[index].trim();
    if (/^#\s*(?:if|ifdef|ifndef)\b/.test(directive)) {
      stack.push(directive);
      continue;
    }
    if (/^#\s*(?:elif|elifdef|elifndef)\b/.test(directive) || /^#\s*else\b/.test(directive)) {
      if (stack.length > 0) stack[stack.length - 1] = directive;
      continue;
    }
    if (/^#\s*endif\b/.test(directive)) {
      stack.pop();
      continue;
    }
    if (stack.length > 0) conditions.set(index + 1, stack.join('\n'));
  }
  return conditions;
}

function objcSwiftRuntimeIdentity(sourceCode: string, node: AnyNode): string | null {
  const start = Math.max(0, (node.startIndex ?? 0) - 1024);
  const prefix = sourceCode.slice(start, node.startIndex ?? 0);
  const matches = [...prefix.matchAll(/SWIFT_CLASS\s*\(\s*"([^"]+)"\s*\)/g)];
  const match = matches[matches.length - 1];
  if (!match || match.index === undefined) return null;
  const trailing = prefix.slice(match.index + match[0].length);
  if (/@(?:interface|protocol|implementation)\b/.test(trailing)) return null;
  return match[1];
}

function extractObjCImportReferences(
  sourceCode: string,
  filePath: string,
): ImportReference[] {
  const references: ImportReference[] = [];
  for (const [index, sourceLine] of sourceCode.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    const header = line.match(/^#\s*(import|include)\s*(?:<([^>]+)>|"([^"]+)"|([A-Za-z_]\w*))/);
    if (header) {
      const rawTarget = header[2] ?? header[3] ?? header[4];
      if (!rawTarget) continue;
      references.push(makeStrictImportReference(
        filePath,
        rawTarget,
        index + 1,
        Math.max(1, sourceLine.search(/\S/) + 1),
        header[1] === 'import' ? 'objc-import' : 'include',
      ));
      continue;
    }
    const module = line.match(/^@import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/);
    if (module) {
      references.push(makeStrictImportReference(
        filePath,
        module[1],
        index + 1,
        Math.max(1, sourceLine.search(/\S/) + 1),
        'module',
      ));
    }
  }
  return references;
}

EXTRACTOR_REGISTRY.set('objc', {
  language: 'objc' as Language, grammarName: 'objc', nodeTypeMap: OBJC_NODE_MAP,
  extract(tree, sourceCode, filePath) {
    const lang = 'objc' as Language;
    type ObjCSymbol = import('../tree-sitter-types.js').ExtractedSymbol;
    const symbolCandidates = new Map<string, { symbol: ObjCSymbol; priority: number }>();
    const importReferences = extractObjCImportReferences(sourceCode, filePath);
    const references: ExtractedReference[] = importReferences.map(reference => ({
      fromSymbolName: '<file>',
      fromSymbolId: makeFileNodeId(filePath),
      referenceName: reference.rawTarget,
      referenceKind: 'imports',
      line: reference.line,
      col: reference.column,
      filePath,
      language: lang,
    }));
    const fileNodeId = makeFileNodeId(filePath);
    const structuralCandidates = new Map<string, ObjCStructuralCandidate>();
    const structuralReferences: StructuralTypeReference[] = [];
    const edgeCandidates: ObjCEdgeCandidate[] = [];
    const compilationConditions = objcCompilationConditions(sourceCode);

    const emitSymbol = (symbol: ObjCSymbol, priority: number): void => {
      const existing = symbolCandidates.get(symbol.qualifiedName);
      if (!existing || priority > existing.priority) {
        symbolCandidates.set(symbol.qualifiedName, { symbol, priority });
      }
    };

    const emitStructuralCandidate = (candidate: ObjCStructuralCandidate): void => {
      const key = [candidate.sourceQualifiedName, candidate.relationHint, candidate.targetName].join('\0');
      const existing = structuralCandidates.get(key);
      if (!existing || candidate.priority > existing.priority) structuralCandidates.set(key, candidate);
    };

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // calls 引用 — [obj method] / helper(x)
      if (type === 'message_expression') {
        const receiver = node.childForFieldName?.('receiver');
        const kids = node.namedChildren ?? [];
        const ids = kids.filter((c: AnyNode) => c.type === 'identifier');
        // receiver 之后第一个 identifier 即方法名 (childForFieldName 返回新包装对象, 按 text 定位)
        let callee: string | null = null;
        if (receiver) {
          const ridx = kids.findIndex((c: AnyNode) => c.type === 'identifier' && c.text === receiver.text);
          callee = ids.slice(ridx + 1)[0]?.text ?? null;
        } else if (ids.length > 1) {
          callee = ids[1]?.text ?? null; // 无 receiver 字段: 跳过首个 identifier (接收者)
        } else {
          callee = ids[0]?.text ?? null;
        }
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }
      if (type === 'call_expression') {
        const fn = node.childForFieldName?.('function') ?? node.namedChildren?.[0];
        const callee = fn?.type === 'identifier' ? fn.text : fn?.text ?? null;
        if (callee) {
          references.push({
            fromSymbolName: '<file>', fromSymbolId: fileNodeId,
            referenceName: callee, referenceKind: 'calls',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
        }
      }
      if (type === 'class_interface' || type === 'class_implementation' ||
          type === 'protocol_declaration') {
        const nameNode = objcDeclarationNameNode(node);
        if (!nameNode?.text) { walkChildren(node, parent); return; }

        const category: ObjCCategoryIdentity = type === 'protocol_declaration'
          ? { isCategory: false, name: '', endIndex: null }
          : objcCategoryIdentity(node, nameNode);
        const displayName = category.isCategory
          ? `${nameNode.text} (${category.name})`
          : nameNode.text;
        const qn = parent ? `${parent}.${displayName}` : displayName;
        const isProtocol = type === 'protocol_declaration';
        const isImplementation = type === 'class_implementation';
        const declarationPriority = isImplementation ? 20 : 30;
        const decorators = category.isCategory ? ['category'] : [];
        decorators.push(isImplementation ? 'implementation' : 'interface');

        const swiftRuntimeIdentity = !category.isCategory && !isProtocol
          ? objcSwiftRuntimeIdentity(sourceCode, node)
          : null;
        emitSymbol(sym(isProtocol ? 'protocol' : 'class', displayName, qn, filePath, lang, node, {
          isExported: true, decorators, signature: firstLine(node),
          ...(swiftRuntimeIdentity
            ? { metadata: { swiftRuntimeIdentity } }
            : {}),
        }), declarationPriority);

        const conditionFor = (candidateNode: AnyNode): string | undefined =>
          compilationConditions.get((candidateNode.startPosition?.row ?? 0) + 1);
        const superclassNode = isProtocol ? null : node.childForFieldName?.('superclass') ?? null;
        if (!category.isCategory && superclassNode?.text) {
          emitStructuralCandidate({
            sourceQualifiedName: qn,
            sourceDeclarationKind: 'class',
            targetName: superclassNode.text,
            relationHint: 'extends',
            targetKindHints: ['class'],
            line: (superclassNode.startPosition?.row ?? 0) + 1,
            col: (superclassNode.startPosition?.column ?? 0) + 1,
            priority: declarationPriority,
            compilationCondition: conditionFor(superclassNode),
          });
        }
        if (category.isCategory) {
          emitStructuralCandidate({
            sourceQualifiedName: qn,
            sourceDeclarationKind: 'category',
            targetName: nameNode.text,
            relationHint: 'decorates',
            targetKindHints: ['class'],
            line: (nameNode.startPosition?.row ?? 0) + 1,
            col: (nameNode.startPosition?.column ?? 0) + 1,
            priority: declarationPriority,
            compilationCondition: conditionFor(nameNode),
          });
        }
        for (const list of objcProtocolListNodes(node, nameNode, superclassNode, category)) {
          for (const protocolName of objcTypeNamesFromList(list)) {
            emitStructuralCandidate({
              sourceQualifiedName: qn,
              sourceDeclarationKind: isProtocol ? 'protocol' : category.isCategory ? 'category' : 'class',
              targetName: protocolName,
              relationHint: isProtocol ? 'extends' : 'implements',
              targetKindHints: ['protocol'],
              line: (list.startPosition?.row ?? 0) + 1,
              col: (list.startPosition?.column ?? 0) + 1,
              priority: declarationPriority,
              compilationCondition: conditionFor(list),
            });
          }
        }
        walkChildren(node, qn);
        return;
      }

      if (type === 'method_declaration' || type === 'method_definition') {
        const name = objcMethodSelector(node);
        if (!name) return;
        const qn = parent ? `${parent}.${name}` : name;
        const text = (node.text ?? '').trimStart();
        const isStatic = text.startsWith('+');
        const isInstance = text.startsWith('-');

        emitSymbol(sym('method', name, qn, filePath, lang, node, {
          isStatic, visibility: 'public',
          decorators: isInstance ? ['instance'] : isStatic ? ['class_method'] : [],
          signature: firstLine(node),
        }), type === 'method_declaration' ? 30 : 20);
        if (parent) {
          edgeCandidates.push({
            source: makeCodeNodeId(filePath, parent),
            target: makeCodeNodeId(filePath, qn),
            kind: 'contains',
            line: (node.startPosition?.row ?? 0) + 1,
            col: (node.startPosition?.column ?? 0) + 1,
          });
        }
        // 方法体继续遍历，收集 message_expression / call_expression。
        walkChildren(node, qn);
        return;
      }

      if (type === 'property_declaration') {
        const attributes = findChild(node, 'property_attributes_declaration');
        const isStatic = attributes?.namedChildren?.some((child: AnyNode) =>
          child.type === 'property_attribute' && child.text === 'class') ?? false;
        for (const name of objcPropertyNames(node)) {
          const qn = parent ? `${parent}.${name}` : name;
          emitSymbol(sym('property', name, qn, filePath, lang, node, {
            isStatic,
            visibility: 'public',
            decorators: isStatic ? ['class_property'] : [],
            signature: firstLine(node),
          }), 30);
          if (parent) {
            edgeCandidates.push({
              source: makeCodeNodeId(filePath, parent),
              target: makeCodeNodeId(filePath, qn),
              kind: 'contains',
              line: (node.startPosition?.row ?? 0) + 1,
              col: (node.startPosition?.column ?? 0) + 1,
            });
          }
        }
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    // Objective-C headers commonly expose C declarations beside classes. Reuse
    // the compatible C AST surface so content-aware routing does not erase them.
    if (/\.h$/i.test(filePath)) {
      const cSurface = EXTRACTOR_REGISTRY.get('c')?.extract(tree, sourceCode, filePath);
      for (const symbol of cSurface?.symbols ?? []) emitSymbol(symbol, 10);
    }
    const symbols = [...symbolCandidates.values()].map(candidate => candidate.symbol);
    const symbolsByQualifiedName = new Map(symbols.map(symbol => [symbol.qualifiedName, symbol]));
    const nominalSymbols = symbols.filter(symbol =>
      (symbol.kind === 'class' || symbol.kind === 'protocol') && !symbol.decorators.includes('category'));
    const nominalByName = new Map<string, ObjCSymbol[]>();
    for (const symbol of nominalSymbols) {
      const candidates = nominalByName.get(symbol.name) ?? [];
      candidates.push(symbol);
      nominalByName.set(symbol.name, candidates);
    }

    const resolveLocalNominal = (candidate: ObjCStructuralCandidate): ObjCSymbol | null => {
      const exact = symbolsByQualifiedName.get(candidate.targetName);
      const candidates = exact ? [exact] : candidate.targetName.includes('.')
        ? []
        : nominalByName.get(candidate.targetName) ?? [];
      const matching = candidates.filter(symbol => candidate.targetKindHints.includes(
        symbol.kind as 'class' | 'protocol'));
      return matching.length === 1 ? matching[0] : null;
    };

    const moduleHints = [...new Set(importReferences.flatMap(reference => {
      if (reference.importKind === 'module') return [reference.rawTarget.split('.')[0]];
      return reference.rawTarget.includes('/') ? [reference.rawTarget.split('/')[0]] : [];
    }).filter(Boolean))];

    for (const candidate of structuralCandidates.values()) {
      const source = symbolsByQualifiedName.get(candidate.sourceQualifiedName);
      if (!source) continue;
      const target = resolveLocalNominal(candidate);
      if (target) {
        edgeCandidates.push({
          source: makeCodeNodeId(filePath, source.qualifiedName),
          target: makeCodeNodeId(filePath, target.qualifiedName),
          kind: candidate.relationHint,
          line: candidate.line,
          col: candidate.col,
        });
        continue;
      }

      const anchorNodeId = makeCodeNodeId(filePath, source.qualifiedName);
      const keyInput = {
        normalizedOriginPath: filePath,
        anchorNodeId,
        relationHint: candidate.relationHint,
        edgeOrientation: 'anchor-to-target' as const,
        rawTargetName: candidate.targetName,
        line: candidate.line,
        column: candidate.col,
      };
      structuralReferences.push({
        kind: 'type',
        refKey: makeStructuralReferenceKey(keyInput),
        anchorNodeId,
        anchorQualifiedName: source.qualifiedName,
        rawTargetName: candidate.targetName,
        sourceDeclarationKind: candidate.sourceDeclarationKind,
        relationHint: candidate.relationHint,
        edgeOrientation: 'anchor-to-target',
        lookupScope: 'project-and-external',
        targetKindHints: candidate.targetKindHints,
        targetLanguageHints: ['objc', 'swift'],
        moduleHints,
        targetFileHints: [],
        origin: { filePath, language: 'objc', line: candidate.line, column: candidate.col },
        ...(candidate.compilationCondition
          ? { compilationCondition: candidate.compilationCondition }
          : {}),
        evidenceProvenance: 'tree-sitter',
      });
    }

    const symbolIds = new Set(symbols.map(symbol => makeCodeNodeId(filePath, symbol.qualifiedName)));
    const seenEdges = new Set<string>();
    const edges = edgeCandidates.filter(edge => {
      if (!symbolIds.has(edge.source) || !symbolIds.has(edge.target)) return false;
      const key = `${edge.source}\0${edge.target}\0${edge.kind}`;
      if (seenEdges.has(key)) return false;
      seenEdges.add(key);
      return true;
    });
    const seenReferences = new Set<string>();
    return {
      symbols,
      references,
      importReferences,
      structuralReferences: structuralReferences.filter(reference => {
        if (seenReferences.has(reference.refKey)) return false;
        seenReferences.add(reference.refKey);
        return true;
      }),
      edges,
    };
  },
});

// ---------------------------------------------------------------------------
// 23. Zig — 容器匿名、名字来自父级 const；方法/字段/enum variant/@import/test
// ---------------------------------------------------------------------------

/**
 * Zig 没有 `struct Foo {}` 内联名字语法，容器一律匿名：`pub const Foo = struct {}`。
 * 符号名只能从父级 variable_declaration 的 identifier 取，这是 Zig 不能复用
 * createGenericExtractor (它靠 node.childForFieldName('name')) 的根本原因。
 */
const ZIG_CONTAINER_KINDS: Record<string, string> = {
  struct_declaration: 'struct',
  enum_declaration: 'enum',
  // 标记联合的 variant 带载荷类型，按容器建模比按枚举成员更贴近 field 语义；
  // opaque 是不定布局的前向声明类型。两者都归到既有 kind，不新造。
  union_declaration: 'struct',
  opaque_declaration: 'struct',
};

/** 类型别名的右值形态：`const T = []u8` / `const T = std.mem.Allocator`。 */
const ZIG_TYPE_VALUE_NODES = new Set([
  'identifier', 'reference_expression', 'field_expression', 'builtin_type',
  'slice_type', 'pointer_type', 'optional_type', 'nullable_type',
  'error_union_type', 'error_set_type', 'anyframe_type', 'tuple_literal',
]);

const ZIG_NODE_MAP: Record<string, string> = {
  'function_declaration': 'function',
  'variable_declaration': 'constant',
  'struct_declaration': 'struct',
  'enum_declaration': 'enum',
  'union_declaration': 'struct',
  'opaque_declaration': 'struct',
  'container_field': 'field',
  'test_declaration': 'function',
};

EXTRACTOR_REGISTRY.set('zig', {
  language: 'zig' as Language, grammarName: 'zig', nodeTypeMap: ZIG_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'zig' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];
    const edges: Array<{ source: string; target: string; kind: string; line?: number }> = [];
    const fileNodeId = makeFileNodeId(filePath);
    const seenReferences = new Set<string>();

    const addReference = (
      referenceKind: string, referenceName: string,
      line: number, col: number, fromSymbolId: string, fromSymbolName: string,
    ): void => {
      const key = `${referenceKind}\0${referenceName}\0${line}\0${col}`;
      if (seenReferences.has(key)) return;
      seenReferences.add(key);
      references.push({
        fromSymbolName, fromSymbolId, referenceName, referenceKind, line, col,
        filePath, language: lang,
      });
    };

    // Zig 的 const 绑定既承载名字也承载 @import，两者都在 variable_declaration 下。
    const zigImportPath = (node: AnyNode): string | null => {
      for (const c of (node.namedChildren ?? [])) {
        if (c.type === 'builtin_function') {
          const head = c.childForFieldName?.('function') ?? c.namedChildren?.[0];
          if (head?.type !== 'builtin_identifier' || head.text !== '@import') continue;
          const args = c.childForFieldName?.('arguments')
            ?? c.namedChildren?.find((x: AnyNode) => x.type === 'arguments');
          const str = args?.namedChildren?.find((x: AnyNode) => x.type === 'string');
          const content = str?.namedChildren?.find((x: AnyNode) => x.type === 'string_content');
          const raw = content?.text ?? str?.text?.replace(/^"|"$/g, '');
          if (raw) return raw;
        }
        if (c.type === 'ERROR' || c.type === 'MISSING') continue;
      }
      return null;
    };

    const zigBindingName = (node: AnyNode): string | null =>
      node.namedChildren?.find((c: AnyNode) => c.type === 'identifier')?.text ?? null;

    const isPublic = (node: AnyNode): boolean =>
      node.children?.some((c: AnyNode) => c.type === 'pub') ?? false;

    const docComment = (node: AnyNode): string => {
      const prev = prevSibling(node);
      if (prev?.type !== 'comment' || !prev.text.startsWith('///')) return '';
      return prev.text.split('\n').map((l: string) => l.replace(/^\/\/\/\s?/, '')).join(' ').trim();
    };

    // 函数体内的局部 const / 解析产物 (`counter += 1` 会被识别成
    // variable_declaration) 都不是声明，必须按父节点类型挡掉。
    const isDeclarationScope = (node: AnyNode): boolean => {
      const p = node.parent?.type;
      return p === 'source_file'
        || p === 'struct_declaration' || p === 'enum_declaration'
        || p === 'union_declaration' || p === 'opaque_declaration';
    };

    const calleeName = (fn: AnyNode | null | undefined): string | null => {
      if (!fn) return null;
      if (fn.type === 'identifier') return fn.text;
      if (fn.type === 'field_expression') {
        const ids = (fn.namedChildren ?? []).filter((c: AnyNode) => c.type === 'identifier');
        return ids[ids.length - 1]?.text ?? null;
      }
      if (fn.type === 'builtin_identifier') return fn.text.replace(/^@/, '');
      // await/try/comptime 包裹调用：`try foo()`、`await bar()`
      if (fn.type === 'call_expression' || fn.type === 'try_expression'
        || fn.type === 'await_expression' || fn.type === 'error_union_infiltration') {
        return calleeName(fn.childForFieldName?.('function') ?? fn.namedChildren?.[0]);
      }
      return null;
    };

    const walkFn = (node: AnyNode, owner: string): void => {
      const name = node.childForFieldName?.('name')?.text ?? nodeName(node);
      if (!name) { walkChildren(node, owner); return; }
      const qn = owner ? `${owner}.${name}` : name;
      const exported = isPublic(node);
      symbols.push(sym(owner ? 'method' : 'function', name, qn, filePath, lang, node, {
        visibility: exported ? 'public' : 'internal',
        isExported: exported,
        docstring: docComment(node),
        signature: firstLine(node),
      }));
      // contains 层级由 code-extractor 按 qualifiedName 统一派生，提取器不重复发边。
      walkBody(node, qn);
    };

    const walkContainer = (node: AnyNode, name: string, decl: AnyNode): void => {
      const kind = ZIG_CONTAINER_KINDS[node.type] ?? 'struct';
      const qn = name;
      const exported = isPublic(decl);
      symbols.push(sym(kind, name, qn, filePath, lang, node, {
        visibility: exported ? 'public' : 'internal',
        isExported: exported,
        docstring: docComment(decl),
        signature: firstLine(decl),
      }));

      const isEnum = node.type === 'enum_declaration';
      for (const c of (node.namedChildren ?? [])) {
        if (c.type === 'container_field') {
          // 空容器 `struct {}` 会让 grammar 插入一个 text 为空的 MISSING identifier，
          // 这里必须静默跳过而不是产出匿名符号污染图。
          const fieldName = c.childForFieldName?.('name')?.text;
          if (!fieldName) continue;
          symbols.push(sym(isEnum ? 'enum_member' : 'field', fieldName, `${qn}.${fieldName}`, filePath, lang, c, {
            signature: firstLine(c),
          }));
          const valueType = c.childForFieldName?.('type');
          if (valueType) {
            const target = [...(valueType.text ?? '').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)]
              .map(m => m[0]).filter(t => /^[A-Z]/.test(t));
            for (const t of target) addReference('references', t,
              (c.startPosition?.row ?? 0) + 1, (c.startPosition?.column ?? 0) + 1,
              fileNodeId, '<file>');
          }
          continue;
        }
        if (c.type === 'function_declaration') { walkFn(c, qn); continue; }
        // enum 的显式 tag type、嵌套容器等仍需下钻
        walk(c, '');
      }
    };

    const walk = (node: AnyNode, owner: string): void => {
      const type = node.type;

      if (type === 'call_expression') {
        const callee = calleeName(node.childForFieldName?.('function'));
        if (callee) addReference('calls', callee,
          (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1,
          owner ? makeCodeNodeId(filePath, owner) : fileNodeId, owner || '<file>');
      }

      if (type === 'variable_declaration' && isDeclarationScope(node)) {
        const name = zigBindingName(node);
        if (name) {
          const exported = isPublic(node);
          const importPath = zigImportPath(node);
          if (importPath) {
            references.push({
              fromSymbolName: '<file>', fromSymbolId: fileNodeId,
              referenceName: importPath, referenceKind: 'imports',
              line: (node.startPosition?.row ?? 0) + 1,
              col: (node.startPosition?.column ?? 0) + 1,
              filePath, language: lang,
            });
            // `const std = @import("std")` 是模块别名，文件节点已代表该模块，
            // 再产出 constant 节点只会制造噪声。
            return;
          }
          const container = node.namedChildren?.find(
            (c: AnyNode) => ZIG_CONTAINER_KINDS[c.type] !== undefined);
          if (container) {
            walkContainer(container, name, node);
            return;
          }
          // `const NAME: T = V` 的 namedChildren 依次为 identifier / 声明类型 / 值，
          // 末位就是初始化表达式；没有 `=` 时（`var x: T;`）末位只是声明类型。
          const named = node.namedChildren ?? [];
          const value = named.length > 1 ? named[named.length - 1] : null;
          const hasInitializer = node.children?.some((c: AnyNode) => c.type === '=') ?? false;
          const isVar = node.children?.some((c: AnyNode) => c.type === 'var') ?? false;
          const isTypeAlias = !isVar && hasInitializer && !!value
            && ZIG_TYPE_VALUE_NODES.has(value.type);
          symbols.push(sym(
            isTypeAlias ? 'type_alias' : (isVar ? 'variable' : 'constant'),
            name, name, filePath, lang, node, {
              visibility: exported ? 'public' : 'internal',
              isExported: exported,
              docstring: docComment(node),
              signature: firstLine(node),
            }));
          if (isTypeAlias && value?.text) {
            for (const m of value.text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
              if (/^[A-Z]/.test(m[0]) && m[0] !== name) {
                addReference('references', m[0],
                  (node.startPosition?.row ?? 0) + 1, (node.startPosition?.column ?? 0) + 1,
                  fileNodeId, '<file>');
              }
            }
          }
          walkBody(node, owner);
          return;
        }
      }

      if (type === 'function_declaration') { walkFn(node, owner); return; }

      // 容器也可能直接出现在 source_file 下 (例如 fn 返回值里的 struct 字面量)
      if (ZIG_CONTAINER_KINDS[type]) {
        const owner2 = owner || nodeName(node);
        if (owner2) walkContainer(node, owner2, node);
        else walkChildren(node, owner);
        return;
      }

      if (type === 'test_declaration') {
        const str = node.namedChildren?.find((c: AnyNode) => c.type === 'string');
        const label = str?.namedChildren?.find((c: AnyNode) => c.type === 'string_content')?.text
          ?? str?.text?.replace(/^"|"$/g, '') ?? 'anonymous';
        const qn = `test ${label}`;
        symbols.push(sym('function', qn, qn, filePath, lang, node, {
          visibility: 'internal', isExported: false, signature: firstLine(node),
        }));
        walkBody(node, qn);
        return;
      }

      walkChildren(node, owner);
    };

    const walkChildren = (node: AnyNode, owner: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, owner);
    };

    // 声明体内部的下钻：不再改变 owner，但继续采集调用。
    const walkBody = (node: AnyNode, owner: string): void => {
      const body = node.childForFieldName?.('body') ?? node.children?.find((c: AnyNode) => c.type === 'block');
      if (body) { for (const c of (body.namedChildren ?? [])) walk(c, owner); }
      for (const c of (node.namedChildren ?? [])) {
        if (c === body) continue;
        if (ZIG_CONTAINER_KINDS[c.type]) continue;  // 已按容器处理过
        if (c.type === 'parameters') continue;
        walk(c, owner);
      }
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, structuralReferences: [], edges };
  },
});

// ---------------------------------------------------------------------------
// 查询 API
// ---------------------------------------------------------------------------

export function getExtractor(language: Language): LanguageExtractor | null {
  return EXTRACTOR_REGISTRY.get(language) ?? null;
}

export function getAllExtractors(): Map<Language, LanguageExtractor> {
  return EXTRACTOR_REGISTRY;
}

export function getSupportedLanguages(): Language[] {
  return [...EXTRACTOR_REGISTRY.keys()];
}

export function detectLanguageFromPath(filePath: string): Language {
  return SOURCE_EXTENSION_TO_LANGUAGE[sourceExtension(filePath)] ?? 'unknown';
}

// file-level-only 语言 (无 tree-sitter grammar, 但仍索引文件级)
export const FILE_LEVEL_ONLY_LANGUAGES: Set<Language> = new Set<Language>([
  'yaml' as Language, 'twig' as Language, 'properties' as Language,
]);

export function isFileLevelOnlyLanguage(language: Language): boolean {
  return FILE_LEVEL_ONLY_LANGUAGES.has(language);
}
