// src/graph/kg/extraction/code/languages/index.ts
// 19 语言提取器注册表
// 参考: codegraph/src/extraction/languages/*.ts (逐文件复用)

import type { LanguageExtractor } from '../tree-sitter-types.js';
import type { Language } from '../../../db/types.js';
import { typescriptExtractor, javascriptExtractor, tsxExtractor } from './typescript.js';

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
      return { symbols, references, edges: [] };
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
EXTRACTOR_REGISTRY.set('jsx', { ...javascriptExtractor, language: 'jsx' as Language });

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
      c.type === 'identifier' || c.type === 'name' || c.type === 'type_identifier');
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

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
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: mod?.text ?? node.text, referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, edges: [] };
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

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
        // 遍历 struct/interface 内部 field
        if (bodyType) walkChildren(bodyType, qn);
        return;
      }

      if (type === 'import_spec') {
        const path = findChild(node, 'path') ?? node.namedChildren?.[node.namedChildren.length - 1];
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: (path?.text ?? '').replace(/"/g, ''),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
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
    return { symbols, references, edges: [] };
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = JAVA_NODE_MAP[type];

      if (kind === 'import') {
        const scopedId = findChild(node, 'scoped_identifier');
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: scopedId?.text ?? node.text.replace(/^import\s+|;$/g, '').trim(),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
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

        // extends / implements edges
        const superclass = findChild(node, 'superclass');
        if (superclass) {
          const superName = findChild(superclass, 'type_identifier')?.text ?? superclass.text;
          edges.push({ source: qn, target: superName, kind: 'extends', line: (node.startPosition?.row ?? 0) + 1 });
        }
        const interfaces = findChild(node, 'interfaces') ?? findChild(node, 'super_interfaces');
        if (interfaces) {
          for (const iface of (interfaces.namedChildren ?? [])) {
            const ifaceName = findChild(iface, 'type_identifier')?.text ?? iface.text;
            edges.push({ source: qn, target: ifaceName, kind: 'implements', line: (node.startPosition?.row ?? 0) + 1 });
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
    return { symbols, references, edges };
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      if (type === 'use_declaration') {
        const arg = findChild(node, 'use_list') ?? findChild(node, 'scoped_identifier') ?? findChild(node, 'identifier');
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: arg?.text ?? node.text.replace(/^use\s+|;$/g, '').trim(),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
        return;
      }

      if (type === 'impl_item') {
        // impl Type { ... } or impl Trait for Type { ... }
        const typeName = node.childForFieldName?.('type')?.text?.replace(/^\*/, '') ?? '';
        const traitNode = node.childForFieldName?.('trait');
        const implParent = typeName || parent;

        if (traitNode) {
          edges.push({ source: typeName, target: traitNode.text, kind: 'implements',
            line: (node.startPosition?.row ?? 0) + 1 });
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
    return { symbols, references, edges };
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = CSHARP_NODE_MAP[type];

      if (type === 'using_directive') {
        const nameNode = findChild(node, 'qualified_name') ?? findChild(node, 'identifier');
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: nameNode?.text ?? node.text.replace(/^using\s+|;$/g, '').trim(),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
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
    return { symbols, references, edges: [] };
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      if (type === 'class' || type === 'module') {
        const name = nodeName(node) ?? findChild(node, 'constant')?.text;
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = type === 'class' ? 'class' : 'module';
        const savedVis = currentVisibility;
        currentVisibility = 'public';
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
        const methodName = nodeName(node) ?? node.text;
        // visibility modifiers
        if (['private', 'protected', 'public'].includes(methodName)) {
          currentVisibility = methodName;
          return;
        }
        // attr_accessor/reader/writer → properties
        if (['attr_accessor', 'attr_reader', 'attr_writer'].includes(methodName)) {
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
        // include/extend/prepend → import references
        if (['include', 'extend', 'prepend', 'require', 'require_relative'].includes(methodName)) {
          const args = findChild(node, 'argument_list');
          for (const arg of (args?.namedChildren ?? [])) {
            references.push({
              fromSymbolName: parent || '<module>', fromSymbolId: `${filePath}:${parent || '<module>'}`,
              referenceName: arg.text.replace(/['"]/g, '').replace(/^:/, ''),
              referenceKind: methodName === 'include' || methodName === 'extend' ? 'mixes_in' : 'imports',
              line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
              filePath, language: lang,
            });
          }
          return;
        }
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 7. Swift — visibility, modifiers, protocols, decorators, async, imports
// ---------------------------------------------------------------------------

const SWIFT_NODE_MAP: Record<string, string> = {
  'function_declaration': 'function', 'class_declaration': 'class',
  'struct_declaration': 'struct', 'protocol_declaration': 'protocol',
  'enum_declaration': 'enum', 'extension_declaration': 'class',
  'typealias_declaration': 'type_alias', 'variable_declaration': 'property',
  'import_declaration': 'import', 'init_declaration': 'method',
  'deinit_declaration': 'method', 'subscript_declaration': 'method',
};

EXTRACTOR_REGISTRY.set('swift', {
  language: 'swift' as Language, grammarName: 'swift', nodeTypeMap: SWIFT_NODE_MAP,
  extract(tree, _src, filePath) {
    const lang = 'swift' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = SWIFT_NODE_MAP[type];

      if (type === 'import_declaration') {
        const mod = node.namedChildren?.find((c: AnyNode) => c.type === 'identifier');
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: mod?.text ?? node.text.replace(/^import\s+/, '').trim(),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
        return;
      }

      if (kind && kind !== 'import') {
        const name = nodeName(node) ?? (type === 'init_declaration' ? 'init' : type === 'deinit_declaration' ? 'deinit' : null);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isMethod = parent !== '' && (type === 'function_declaration' || type === 'init_declaration' || type === 'deinit_declaration' || type === 'subscript_declaration');
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
        const decos: string[] = [];
        for (const c of (node.namedChildren ?? [])) {
          if (c.type === 'attribute') {
            const attrName = findChild(c, 'user_type') ?? findChild(c, 'identifier');
            decos.push(attrName?.text ?? c.text.replace(/^@/, ''));
          }
        }

        // protocol conformance
        const conformance = findChild(node, 'type_inheritance_clause');
        if (conformance) {
          for (const t of (conformance.namedChildren ?? [])) {
            if (t.type === 'user_type' || t.type === 'type_identifier') {
              // recorded as edge later if needed
            }
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
        walkChildren(node, qn);
        return;
      }

      walkChildren(node, parent);
    };

    const walkChildren = (node: AnyNode, parent: string): void => {
      for (const c of (node.namedChildren ?? [])) walk(c, parent);
    };

    walk((tree as AnyNode).rootNode, '');
    return { symbols, references, edges: [] };
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = KOTLIN_NODE_MAP[type];

      if (type === 'import_header') {
        const id = findChild(node, 'identifier') ?? findChild(node, 'scoped_identifier');
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: id?.text ?? node.text.replace(/^import\s+/, '').trim(),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
        return;
      }

      if (kind && kind !== 'import') {
        const name = nodeName(node) ?? (type === 'companion_object' ? 'Companion' : null);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const isMethod = parent !== '' && type === 'function_declaration';
        const finalKind = isMethod ? 'method' : kind;

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
    return { symbols, references, edges: [] };
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;
      const kind = PHP_NODE_MAP[type];

      if (type === 'namespace_use_declaration' || type === 'use_declaration') {
        const nameNode = findChild(node, 'qualified_name') ?? findChild(node, 'name');
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: nameNode?.text ?? node.text.replace(/^use\s+|;$/g, '').trim(),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
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

        // class traits (use TraitName;)
        if (type === 'class_declaration' || type === 'trait_declaration') {
          const body = findChild(node, 'declaration_list');
          if (body) {
            for (const c of (body.namedChildren ?? [])) {
              if (c.type === 'use_declaration') {
                const traitName = findChild(c, 'qualified_name') ?? findChild(c, 'name');
                references.push({
                  fromSymbolName: qn, fromSymbolId: `${filePath}:${qn}`,
                  referenceName: traitName?.text ?? c.text.replace(/^use\s+|;$/g, '').trim(),
                  referenceKind: 'mixes_in',
                  line: (c.startPosition?.row ?? 0) + 1, col: (c.startPosition?.column ?? 0) + 1,
                  filePath, language: lang,
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
    return { symbols, references, edges: [] };
  },
});

// 保留通用提取器的语言 (C, C++ 等无需特化)
EXTRACTOR_REGISTRY.set('c', createGenericExtractor('c' as Language, 'c', {
  'function_definition': 'function', 'struct_specifier': 'struct',
  'enum_specifier': 'enum', 'type_definition': 'type_alias',
  'preproc_function_def': 'function',
}));
EXTRACTOR_REGISTRY.set('cpp', createGenericExtractor('cpp' as Language, 'cpp', {
  'function_definition': 'function', 'class_specifier': 'class',
  'struct_specifier': 'struct', 'namespace_definition': 'namespace',
}));
EXTRACTOR_REGISTRY.set('dart', createGenericExtractor('dart' as Language, 'dart', {
  'function_signature': 'function', 'method_signature': 'method',
  'class_definition': 'class',
}));
EXTRACTOR_REGISTRY.set('svelte', createGenericExtractor('svelte' as Language, 'svelte', {
  'element': 'component', 'script_element': 'function',
}));
EXTRACTOR_REGISTRY.set('vue', createGenericExtractor('vue' as Language, 'vue', {
  'element': 'component', 'start_tag': 'component',
}));
EXTRACTOR_REGISTRY.set('liquid', createGenericExtractor('liquid' as Language, 'liquid', {}));
EXTRACTOR_REGISTRY.set('pascal', createGenericExtractor('pascal' as Language, 'pascal', {}));
EXTRACTOR_REGISTRY.set('scala', createGenericExtractor('scala' as Language, 'scala', {
  'function_definition': 'function', 'class_definition': 'class',
  'object_definition': 'class', 'trait_definition': 'trait',
}));
EXTRACTOR_REGISTRY.set('lua', createGenericExtractor('lua' as Language, 'lua', {
  'function_declaration': 'function', 'function_definition': 'function',
}));
EXTRACTOR_REGISTRY.set('luau', createGenericExtractor('luau' as Language, 'luau', {
  'function_declaration': 'function', 'function_definition': 'function',
}));
EXTRACTOR_REGISTRY.set('objc', createGenericExtractor('objc' as Language, 'objc', {
  'method_definition': 'method', 'class_declaration': 'class',
  'protocol_declaration': 'protocol',
}));

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

// 文件扩展名 → 语言映射
const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
  '.mjs': 'javascript', '.cjs': 'javascript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.cs': 'csharp', '.php': 'php', '.rb': 'ruby',
  '.swift': 'swift', '.kt': 'kotlin', '.kts': 'kotlin', '.dart': 'dart',
  '.svelte': 'svelte', '.vue': 'vue', '.liquid': 'liquid',
  '.pas': 'pascal', '.scala': 'scala', '.sc': 'scala',
  '.lua': 'lua', '.m': 'objc', '.mm': 'objc',
  '.yaml': 'yaml', '.yml': 'yaml', '.twig': 'twig',
  '.xml': 'xml', '.properties': 'properties',
};

export function detectLanguageFromPath(filePath: string): Language {
  const normalized = filePath.replace(/\\/g, '/');
  const ext = normalized.substring(normalized.lastIndexOf('.')).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown';
}

// file-level-only 语言 (无 tree-sitter grammar, 但仍索引文件级)
export const FILE_LEVEL_ONLY_LANGUAGES: Set<Language> = new Set<Language>([
  'yaml' as Language, 'twig' as Language, 'properties' as Language,
]);

export function isFileLevelOnlyLanguage(language: Language): boolean {
  return FILE_LEVEL_ONLY_LANGUAGES.has(language);
}