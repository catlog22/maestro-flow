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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // #include → import reference
      if (type === 'preproc_include') {
        const path = findChild(node, 'string_literal') ?? findChild(node, 'system_lib_string');
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: (path?.text ?? '').replace(/[<>"]/g, ''),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
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
    return { symbols, references, edges: [] };
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

    const walk = (node: AnyNode, parent: string, sectionVisibility?: string): void => {
      const type = node.type;

      // #include → import
      if (type === 'preproc_include') {
        const path = findChild(node, 'string_literal') ?? findChild(node, 'system_lib_string');
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: (path?.text ?? '').replace(/[<>"]/g, ''),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
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

        // base class clause
        const baseClause = findChild(node, 'base_class_clause');
        if (baseClause) {
          for (const base of (baseClause.namedChildren ?? [])) {
            const baseName = findChild(base, 'type_identifier')?.text ?? base.text?.replace(/\b(public|private|protected|virtual)\s+/g, '').trim();
            if (baseName) edges.push({ source: qn, target: baseName, kind: 'extends', line: (node.startPosition?.row ?? 0) + 1 });
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
    return { symbols, references, edges };
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

    // Dart tree-sitter grammars vary; also scan source lines for import/part/export
    const lines = sourceCode.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const importMatch = line.match(/^(?:import|export|part|part\s+of)\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: importMatch[1], referenceKind: 'imports',
          line: i + 1, col: 1, filePath, language: lang,
        });
      }
    }

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      if (type === 'class_definition' || type === 'mixin_declaration' || type === 'enum_declaration' || type === 'extension_declaration') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        const kind = type === 'mixin_declaration' ? 'trait' : type === 'enum_declaration' ? 'enum' : 'class';

        // annotations (@override, @deprecated, etc.)
        const decos = extractDecorators(node, 'annotation');

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
    return { symbols, references, edges: [] };
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
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: importMatch[1], referenceKind: 'imports',
          line: i + 1, col: 1, filePath, language: lang,
        });
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

    return { symbols, references, edges: [] };
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
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: importMatch[1], referenceKind: 'imports',
          line: i + 1, col: 1, filePath, language: lang,
        });
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
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: composableMatch[2], referenceKind: 'calls',
          line: i + 1, col: 1, filePath, language: lang,
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

    return { symbols, references, edges: [] };
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
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: renderMatch[2], referenceKind: 'imports',
          line: i + 1, col: 1, filePath, language: lang,
        });
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

    return { symbols, references, edges: [] };
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
  extract(_tree, sourceCode, filePath) {
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
          references.push({
            fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
            referenceName: u, referenceKind: 'imports',
            line: i + 1, col: 1, filePath, language: lang,
          });
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

    return { symbols, references, edges: [] };
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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // import
      if (type === 'import_declaration') {
        const path = node.namedChildren?.[0];
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: path?.text ?? node.text.replace(/^import\s+/, '').trim(),
          referenceKind: 'imports',
          line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
          filePath, language: lang,
        });
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
    return { symbols, references, edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 18. Lua — function (global/local), require, module pattern, tables
// ---------------------------------------------------------------------------

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

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

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
          references.push({
            fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
            referenceName: (strArg?.text ?? '').replace(/['"]/g, ''),
            referenceKind: 'imports',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
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
    return { symbols, references, edges: [] };
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

    // Detect strict mode from first line
    const firstSrcLine = sourceCode.split('\n')[0]?.trim() ?? '';
    const isStrict = firstSrcLine.includes('--!strict');

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

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
          references.push({
            fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
            referenceName: (strArg?.text ?? '').replace(/['"]/g, ''),
            referenceKind: 'imports',
            line: (node.startPosition?.row ?? 0) + 1, col: (node.startPosition?.column ?? 0) + 1,
            filePath, language: lang,
          });
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
    return { symbols, references, edges: [] };
  },
});

// ---------------------------------------------------------------------------
// 20. Obj-C — @interface/@implementation/@protocol, -/+ methods, @property, #import
// ---------------------------------------------------------------------------

const OBJC_NODE_MAP: Record<string, string> = {
  'class_interface': 'class', 'class_implementation': 'class',
  'protocol_declaration': 'interface', 'category_interface': 'class',
  'category_implementation': 'class',
  'method_declaration': 'method', 'method_definition': 'method',
  'property_declaration': 'property',
};

EXTRACTOR_REGISTRY.set('objc', {
  language: 'objc' as Language, grammarName: 'objc', nodeTypeMap: OBJC_NODE_MAP,
  extract(tree, sourceCode, filePath) {
    const lang = 'objc' as Language;
    const symbols: import('../tree-sitter-types.js').ExtractedSymbol[] = [];
    const references: import('../tree-sitter-types.js').ExtractedReference[] = [];

    // #import / @import from source lines (tree-sitter coverage varies)
    const lines = sourceCode.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const importMatch = line.match(/^(?:#import|@import|#include)\s+[<"]([^>"]+)[>"]/);
      if (importMatch) {
        references.push({
          fromSymbolName: '<module>', fromSymbolId: `${filePath}:<module>`,
          referenceName: importMatch[1], referenceKind: 'imports',
          line: i + 1, col: 1, filePath, language: lang,
        });
      }
    }

    const walk = (node: AnyNode, parent: string): void => {
      const type = node.type;

      // @interface ClassName (Category) / @interface ClassName / @implementation / @protocol
      if (type === 'class_interface' || type === 'class_implementation' ||
          type === 'protocol_declaration' || type === 'category_interface' ||
          type === 'category_implementation') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }

        // detect category: ClassName (CategoryName)
        const categoryName = findChild(node, 'category_name')?.text;
        const displayName = categoryName ? `${name} (${categoryName})` : name;
        const qn = parent ? `${parent}.${displayName}` : displayName;

        const kind = type === 'protocol_declaration' ? 'interface' : 'class';
        const decos: string[] = [];
        if (categoryName) decos.push('category');
        if (type === 'class_implementation' || type === 'category_implementation') decos.push('implementation');

        symbols.push(sym(kind, displayName, qn, filePath, lang, node, {
          isExported: true, decorators: decos, signature: firstLine(node),
        }));
        walkChildren(node, qn);
        return;
      }

      // method: - (void)instanceMethod or + (void)classMethod
      if (type === 'method_declaration' || type === 'method_definition') {
        // method name from selector
        const selector = findChild(node, 'selector') ?? findChild(node, 'keyword_selector');
        const name = selector?.text ?? nodeName(node) ?? '<method>';
        const qn = parent ? `${parent}.${name}` : name;

        // - or + prefix for instance vs class method
        const text = (node.text ?? '').trimStart();
        const isStatic = text.startsWith('+');
        const isInstance = text.startsWith('-');

        symbols.push(sym('method', name, qn, filePath, lang, node, {
          isStatic, visibility: 'public',
          decorators: isInstance ? ['instance'] : isStatic ? ['class_method'] : [],
          signature: firstLine(node),
        }));
        return;
      }

      // @property
      if (type === 'property_declaration') {
        const name = nodeName(node);
        if (!name) { walkChildren(node, parent); return; }
        const qn = parent ? `${parent}.${name}` : name;
        symbols.push(sym('property', name, qn, filePath, lang, node, {
          visibility: 'public', signature: firstLine(node),
        }));
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